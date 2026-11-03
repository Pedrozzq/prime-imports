-- =====================================================================
--  PRIME PERFUMES · CRM
--  Integração SITE → CRM: pedidos enviados pelo site (botão "Enviar pedido")
--  Rode DEPOIS do schema.sql: Supabase > SQL Editor > New query > cole tudo > Run
--  (pode rodar mais de uma vez sem problema)
-- =====================================================================

-- 1. Nova origem "site" para clientes e pedidos
alter table public.clientes drop constraint if exists clientes_origem_check;
alter table public.clientes add constraint clientes_origem_check
  check (origem in ('whatsapp','manual','loja','instagram','site'));

alter table public.pedidos drop constraint if exists pedidos_origem_check;
alter table public.pedidos add constraint pedidos_origem_check
  check (origem in ('whatsapp','manual','loja','instagram','site'));

-- 1b. Pedido feito no site com a loja FECHADA: fica registrado como "fora_horario".
--     Não baixa estoque nem conta como venda; se a equipe mudar para "novo", passa a contar.
alter table public.pedidos drop constraint if exists pedidos_status_check;
alter table public.pedidos add constraint pedidos_status_check
  check (status in ('novo','confirmado','em_preparo','saiu_entrega','entregue','cancelado','fora_horario'));

-- status que contam como venda e baixam estoque (cancelado e fora do horário não contam)
create or replace function public._conta_venda(p_status text) returns boolean
language sql immutable as $$ select coalesce(p_status not in ('cancelado','fora_horario'), true) $$;

-- horário da loja: quarta a domingo, 19h às 01h (Brasília); a noite de domingo vai até segunda 01h.
-- O mesmo do site (OPEN_DAYS / OPEN_FROM no script.js). isodow: 1 = segunda … 7 = domingo
-- Atenção: o loja-manual.sql redefine esta função (abrir/fechar a loja pelo CRM). Rodou este arquivo de novo? Rode o loja-manual.sql depois.
create or replace function public.loja_aberta() returns boolean
language sql stable as $$
  select (extract(isodow from h) in (3,4,5,6,7) and extract(hour from h) >= 19)
      or (extract(isodow from h) in (4,5,6,7,1) and extract(hour from h) < 1)
    from (select now() at time zone 'America/Sao_Paulo' as h) t
$$;

-- total de pedidos e total gasto do cliente ignoram cancelados e pedidos fora do horário
create or replace view public.clientes_resumo
with (security_invoker = true) as
select c.*,
       count(p.id) filter (where public._conta_venda(p.status))                 as total_pedidos,
       coalesce(sum(p.total) filter (where public._conta_venda(p.status)), 0)   as total_gasto,
       max(p.criado_em)                                                         as ultimo_pedido_em
from public.clientes c
left join public.pedidos p on p.cliente_id = c.id
group by c.id;

-- 2. Catálogo igual ao do site (produtos.js)
--    site_id = "id" do produto no produtos.js. O CRM cadastra os produtos novos do arquivo;
--    preço, nome e ativo são editados no CRM e o site lê daqui (site_produtos).
alter table public.produtos add column if not exists site_id text unique;
-- Estoque: quantidade disponível. Vazio (null) = sem controle de estoque (sempre disponível).
-- Chegou a 0 = o produto sai do site sozinho (volta quando o estoque for reposto no CRM).
alter table public.produtos add column if not exists estoque integer check (estoque is null or estoque >= 0);
alter table public.produtos drop column if exists em_estoque;   -- versão anterior deste arquivo
alter table public.produtos drop constraint if exists produtos_categoria_check;  -- categorias vêm do site

-- Vitrine pública: o site lê os produtos dele (nome, preço, estoque) e recebe as mudanças em tempo real.
-- A tabela produtos não tem dado sensível; clientes e pedidos continuam fechados.
drop policy if exists vitrine_publica on public.produtos;
create policy vitrine_publica on public.produtos for select to anon using (site_id is not null);
grant select on public.produtos to anon;
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.produtos; exception when duplicate_object then null; end;
  end if;
end $$;

-- os produtos de exemplo do schema.sql não existem no site: ficam inativos (não somem dos pedidos antigos)
update public.produtos set ativo = false
 where site_id is null and nome in (
   'Seda Smoking Brown King Size','Seda Zomo Perfect Slim','Seda Bem Bolado Brown','Tabaco Acrema 25g',
   'Tabaco Hi Tobacco 25g','Piteira de Papel Bem Bolado','Piteira de Vidro','Isqueiro BIC Grande',
   'Isqueiro Clipper','Dichavador de Metal 4 partes','Bandeja de Metal Média');

-- Preços/nomes/ativos que o site usa ao abrir (público: só dados de vitrine, nada de clientes)
create or replace function public.site_produtos() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', site_id, 'nome', nome, 'preco', preco, 'ativo', ativo, 'estoque', estoque)), '[]'::jsonb)
    from public.produtos where site_id is not null
$$;
revoke all on function public.site_produtos() from public;
grant execute on function public.site_produtos() to anon, authenticated;

-- O agente de WhatsApp só oferece o que tem em estoque
create or replace function public.agente_listar_produtos(p_chave text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public._agente_validar(p_chave);
  return coalesce((select jsonb_agg(jsonb_build_object('nome', nome, 'categoria', categoria, 'preco', preco, 'estoque', estoque)
                                    order by categoria, nome)
                     from public.produtos where ativo and (estoque is null or estoque > 0)), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------
-- Baixa automática de estoque
--   pedido criado (site, agente ou CRM) → desconta; pedido cancelado → devolve;
--   pedido "descancelado" → desconta de novo.
--   pedido_itens.componentes = {site_id: qtd por unidade} para combos/kits
--   (ex.: "Combo 3 Sedas King" = {"seda-king": 3}); sem componentes, desconta o próprio produto.
-- ---------------------------------------------------------------------
alter table public.pedido_itens add column if not exists componentes jsonb;
alter table public.produtos     add column if not exists componentes jsonb;  -- combos do site (o CRM preenche pelo produtos.js)

create or replace function public._mover_estoque(p_item public.pedido_itens, p_sinal int) returns void
language plpgsql security definer set search_path = public as $$
declare k text; v text; v_comp jsonb;
begin
  v_comp := coalesce(p_item.componentes, (select componentes from public.produtos where id = p_item.produto_id));
  if v_comp is not null and jsonb_typeof(v_comp) = 'object' then
    for k, v in select * from jsonb_each_text(v_comp) loop
      update public.produtos
         set estoque = greatest(estoque + p_sinal * v::int * p_item.quantidade, 0)
       where site_id = k and estoque is not null;
    end loop;
  elsif p_item.produto_id is not null then
    update public.produtos
       set estoque = greatest(estoque + p_sinal * p_item.quantidade, 0)
     where id = p_item.produto_id and estoque is not null;
  end if;
end $$;
revoke all on function public._mover_estoque(public.pedido_itens, int) from public, anon, authenticated;

create or replace function public.tg_itens_estoque() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  select status into v_status from public.pedidos where id = coalesce(new.pedido_id, old.pedido_id);
  if public._conta_venda(v_status) then                 -- pedido apagado (null) também devolve
    if tg_op = 'INSERT' then perform public._mover_estoque(new, -1);
    else perform public._mover_estoque(old, 1); end if;
  end if;
  return null;
end $$;
drop trigger if exists t_itens_estoque on public.pedido_itens;
create trigger t_itens_estoque after insert or delete on public.pedido_itens
for each row execute function public.tg_itens_estoque();

create or replace function public.tg_pedido_estoque() returns trigger
language plpgsql security definer set search_path = public as $$
declare i public.pedido_itens;
begin
  -- saiu de uma situação que conta (ex.: cancelou) → devolve; entrou (ex.: fora do horário → novo) → desconta
  if public._conta_venda(old.status) and not public._conta_venda(new.status) then
    for i in select * from public.pedido_itens where pedido_id = new.id loop perform public._mover_estoque(i, 1); end loop;
  elsif not public._conta_venda(old.status) and public._conta_venda(new.status) then
    for i in select * from public.pedido_itens where pedido_id = new.id loop perform public._mover_estoque(i, -1); end loop;
  end if;
  return null;
end $$;
drop trigger if exists t_pedido_estoque on public.pedidos;
create trigger t_pedido_estoque after update of status on public.pedidos
for each row execute function public.tg_pedido_estoque();

-- ---------------------------------------------------------------------
-- OFERTAS RELÂMPAGO (criadas no CRM, aparecem no topo do site entre início e fim)
-- ---------------------------------------------------------------------
create table if not exists public.ofertas (
  id         uuid primary key default gen_random_uuid(),
  titulo     text not null default 'Oferta relâmpago',
  subtitulo  text,
  inicio     timestamptz not null,
  fim        timestamptz not null,
  ativo      boolean not null default true,          -- false = pausada (some do site)
  criado_em  timestamptz not null default now(),
  constraint ofertas_periodo check (fim > inicio)
);
create table if not exists public.oferta_itens (
  oferta_id     uuid not null references public.ofertas(id) on delete cascade,
  site_id       text not null,                          -- "id" do produto no produtos.js
  preco_oferta  numeric(10,2) not null check (preco_oferta >= 0),
  primary key (oferta_id, site_id)
);
create index if not exists idx_ofertas_fim on public.ofertas(fim);

alter table public.ofertas      enable row level security;
alter table public.oferta_itens enable row level security;
drop policy if exists equipe_total on public.ofertas;
drop policy if exists equipe_total on public.oferta_itens;
create policy equipe_total on public.ofertas      for all to authenticated using (true) with check (true);
create policy equipe_total on public.oferta_itens for all to authenticated using (true) with check (true);
-- o site só lê (e recebe em tempo real) ofertas; não tem dado de cliente
drop policy if exists vitrine_publica on public.ofertas;
drop policy if exists vitrine_publica on public.oferta_itens;
create policy vitrine_publica on public.ofertas      for select to anon using (true);
create policy vitrine_publica on public.oferta_itens for select to anon using (true);
grant select, insert, update, delete on public.ofertas, public.oferta_itens to authenticated;
grant select on public.ofertas, public.oferta_itens to anon;
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.ofertas;      exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.oferta_itens; exception when duplicate_object then null; end;
  end if;
end $$;

-- preço de oferta valendo AGORA para um produto do site (null = sem oferta). Várias ofertas: a menor.
create or replace function public._preco_oferta(p_site_id text) returns numeric
language sql stable security definer set search_path = public as $$
  select min(i.preco_oferta)
    from public.oferta_itens i join public.ofertas o on o.id = i.oferta_id
   where i.site_id = p_site_id and o.ativo and now() >= o.inicio and now() < o.fim
$$;
revoke all on function public._preco_oferta(text) from public, anon, authenticated;

-- mesma coisa para um item de pedido, com tolerância de 2 minutos depois do fim da oferta quando
-- o cliente viu o preço dela no site (p_visto = preço que o site mandou no item)
create or replace function public._preco_oferta(p_site_id text, p_visto numeric) returns numeric
language sql stable security definer set search_path = public as $$
  select min(i.preco_oferta)
    from public.oferta_itens i join public.ofertas o on o.id = i.oferta_id
   where i.site_id = p_site_id and o.ativo and now() >= o.inicio
     and (now() < o.fim
          or (now() < o.fim + interval '2 minutes' and p_visto is not null and p_visto <= i.preco_oferta))
$$;
revoke all on function public._preco_oferta(text, numeric) from public, anon, authenticated;

-- ofertas no ar e agendadas (próximos 7 dias) para o site; "agora" acerta o relógio do celular
create or replace function public.site_ofertas() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('agora', now(), 'ofertas', coalesce(jsonb_agg(x order by x->>'inicio'), '[]'::jsonb))
    from (select jsonb_build_object('id', o.id, 'titulo', o.titulo, 'subtitulo', o.subtitulo, 'inicio', o.inicio, 'fim', o.fim,
                   'itens', coalesce((select jsonb_agg(jsonb_build_object('id', i.site_id, 'preco', i.preco_oferta))
                                        from public.oferta_itens i where i.oferta_id = o.id), '[]'::jsonb)) x
            from public.ofertas o
           where o.ativo and o.fim > now() and o.inicio < now() + interval '7 days') s
$$;
revoke all on function public.site_ofertas() from public;
grant execute on function public.site_ofertas() to anon, authenticated;

-- ---------------------------------------------------------------------
-- KIT PRIME DO MÊS (assinatura): 1 seda + 1 piteira + 1 isqueiro personalizado por um preço fixo (R$ 29,90).
--   Todo dia 1 o kit do mês é montado sozinho com os produtos de MAIOR ESTOQUE de cada categoria
--   (pg_cron às 00:01 de Brasília; se o cron não estiver ligado, o 1º acesso ao site no mês já monta).
--   No CRM (menu Kit do Mês): trocar os itens do mês, escolher quais produtos podem entrar,
--   mudar o preço e tirar o kit do site.
--   No pedido, o kit tem id "kit-mensal": preço e itens vêm daqui (nunca do navegador) e o
--   estoque baixa de cada item.
-- ---------------------------------------------------------------------
create table if not exists public.kit_config (
  id             int primary key default 1 check (id = 1),
  preco          numeric(10,2) not null default 29.90 check (preco > 0),
  ativo          boolean not null default true,    -- false = o kit some do site
  automatico     boolean not null default true,    -- dia 1 monta pelo estoque (false = repete o kit do mês anterior)
  sedas          text[] not null default '{}',     -- site_ids que podem entrar no kit (vazio = toda a categoria)
  piteiras       text[] not null default '{}',
  isqueiros      text[] not null default '{}',
  atualizado_em  timestamptz not null default now()
);
insert into public.kit_config (id) values (1) on conflict do nothing;

create table if not exists public.kit_meses (
  mes            date primary key check (extract(day from mes) = 1),   -- 1º dia do mês
  seda           text not null,                    -- site_id de cada item
  piteira        text not null,
  isqueiro       text not null,
  origem         text not null default 'auto' check (origem in ('auto','manual')),
  atualizado_em  timestamptz not null default now()
);

alter table public.kit_config enable row level security;
alter table public.kit_meses  enable row level security;
drop policy if exists equipe_total on public.kit_config;
drop policy if exists equipe_total on public.kit_meses;
create policy equipe_total on public.kit_config for all to authenticated using (true) with check (true);
create policy equipe_total on public.kit_meses  for all to authenticated using (true) with check (true);
-- o site só lê (tempo real); não tem dado de cliente
drop policy if exists vitrine_publica on public.kit_config;
drop policy if exists vitrine_publica on public.kit_meses;
create policy vitrine_publica on public.kit_config for select to anon using (true);
create policy vitrine_publica on public.kit_meses  for select to anon using (true);
grant select, insert, update, delete on public.kit_config, public.kit_meses to authenticated;
grant select on public.kit_config, public.kit_meses to anon;
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.kit_config; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.kit_meses;  exception when duplicate_object then null; end;
  end if;
end $$;

-- mês corrente no horário de Brasília (1º dia)
create or replace function public._kit_mes_atual() returns date
language sql stable as $$ select date_trunc('month', now() at time zone 'America/Sao_Paulo')::date $$;

-- produto de MAIOR ESTOQUE da categoria (ativo, com estoque, sem ser combo).
-- Empate: evita repetir o do mês anterior. Estoque vazio (sem controle) só entra se nenhum tiver estoque contado.
create or replace function public._kit_escolher(p_categoria text, p_permitidos text[], p_evitar text)
returns text language sql stable security definer set search_path = public as $$
  select site_id from public.produtos
   where site_id is not null and ativo and componentes is null and categoria = p_categoria
     and (coalesce(cardinality(p_permitidos), 0) = 0 or site_id = any(p_permitidos))
     and (estoque is null or estoque > 0)
   order by estoque desc nulls last, site_id is not distinct from p_evitar, nome
   limit 1
$$;
revoke all on function public._kit_escolher(text, text[], text) from public, anon, authenticated;

-- o que a montagem automática escolheria para um mês (não grava). Sem nada em estoque, repete o item anterior.
create or replace function public.kit_sugestao(p_mes date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_mes date := date_trunc('month', coalesce(p_mes, public._kit_mes_atual()))::date;
  c public.kit_config; a public.kit_meses;
begin
  select * into c from public.kit_config where id = 1;
  select * into a from public.kit_meses where mes < v_mes order by mes desc limit 1;
  return jsonb_build_object('mes', v_mes,
    'seda',     coalesce(public._kit_escolher('Sedas',     c.sedas,     a.seda),     a.seda),
    'piteira',  coalesce(public._kit_escolher('Piteiras',  c.piteiras,  a.piteira),  a.piteira),
    'isqueiro', coalesce(public._kit_escolher('Isqueiros', c.isqueiros, a.isqueiro), a.isqueiro));
end $$;
revoke all on function public.kit_sugestao(date) from public, anon;
grant execute on function public.kit_sugestao(date) to authenticated;

-- monta o kit do mês (roda sozinho todo dia 1). Mês já montado (ex.: definido à mão no CRM) não muda,
-- a não ser com p_refazer = true (botão "Remontar pelo estoque" no CRM).
create or replace function public.kit_montar(p_mes date default null, p_refazer boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_mes date := date_trunc('month', coalesce(p_mes, public._kit_mes_atual()))::date;
  c public.kit_config; a public.kit_meses; s jsonb;
begin
  if not p_refazer then
    if exists (select 1 from public.kit_meses where mes = v_mes) then
      return (select to_jsonb(k) from public.kit_meses k where mes = v_mes);
    end if;
    select * into c from public.kit_config where id = 1;
    if not coalesce(c.automatico, true) then                    -- automático desligado: repete o kit anterior
      select * into a from public.kit_meses where mes < v_mes order by mes desc limit 1;
      if found then
        insert into public.kit_meses (mes, seda, piteira, isqueiro, origem)
        values (v_mes, a.seda, a.piteira, a.isqueiro, 'manual') on conflict (mes) do nothing;
        return (select to_jsonb(k) from public.kit_meses k where mes = v_mes);
      end if;
    end if;
  end if;

  s := public.kit_sugestao(v_mes);
  if s->>'seda' is null or s->>'piteira' is null or s->>'isqueiro' is null then
    raise exception 'sem produto em estoque para montar o kit (precisa de 1 seda, 1 piteira e 1 isqueiro)';
  end if;
  insert into public.kit_meses as k (mes, seda, piteira, isqueiro, origem)
  values (v_mes, s->>'seda', s->>'piteira', s->>'isqueiro', 'auto')
  on conflict (mes) do update set seda = excluded.seda, piteira = excluded.piteira, isqueiro = excluded.isqueiro,
                                  origem = 'auto', atualizado_em = now()
    where p_refazer;
  return (select to_jsonb(k) from public.kit_meses k where mes = v_mes);
end $$;
revoke all on function public.kit_montar(date, boolean) from public, anon;
grant execute on function public.kit_montar(date, boolean) to authenticated;

-- kit vigente agora (o do mês; se ainda não montou, o último que existir)
create or replace function public._kit_vigente() returns public.kit_meses
language sql stable security definer set search_path = public as $$
  select * from public.kit_meses where mes <= public._kit_mes_atual() order by mes desc limit 1
$$;
revoke all on function public._kit_vigente() from public, anon, authenticated;

-- Site: kit do mês (preço e itens). No 1º acesso do mês, se o cron ainda não montou, monta aqui.
create or replace function public.site_kit() returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.kit_config; k public.kit_meses;
begin
  select * into c from public.kit_config where id = 1;
  if not found or not c.ativo then return jsonb_build_object('ativo', false); end if;
  if not exists (select 1 from public.kit_meses where mes = public._kit_mes_atual()) then
    begin perform public.kit_montar(); exception when others then null; end;   -- sem estoque: segue com o anterior
  end if;
  k := public._kit_vigente();
  if k.mes is null then return jsonb_build_object('ativo', false); end if;
  return jsonb_build_object('ativo', true, 'preco', c.preco, 'mes', public._kit_mes_atual(),
                            'seda', k.seda, 'piteira', k.piteira, 'isqueiro', k.isqueiro);
end $$;
revoke all on function public.site_kit() from public;
grant execute on function public.site_kit() to anon, authenticated;

-- Agendamento: todo dia 1 às 00:01 de Brasília (03:01 UTC). Sem pg_cron, o site monta no 1º acesso do mês.
do $$
begin
  create extension if not exists pg_cron with schema pg_catalog;
  perform cron.schedule('zoo-kit-do-mes', '1 3 1 * *', 'select public.kit_montar()');
exception when others then
  raise notice 'pg_cron indisponível (%): o kit será montado no 1º acesso ao site de cada mês', sqlerrm;
end $$;

-- já deixa o kit do mês atual montado
do $$ begin perform public.kit_montar(); exception when others then raise notice 'Kit do mês: %', sqlerrm; end $$;

-- 3. Função pública chamada pelo site (só grava, nunca devolve dados de clientes)
-- p_dados = { nome, telefone, cep, rua, numero, bairro, cidade, referencia,
--             pagamento ('Pix'|'Crédito'|'Débito'|'Dinheiro'), taxa_entrega, maior_idade,
--             itens: [ { id, produto, quantidade, preco_unitario, categoria } ] }
-- O Kit Prime do Mês vai com id "kit-mensal": preço e itens vêm do kit vigente (kit_config / kit_meses).

-- Item do pedido do site → produto do catálogo (preço/categoria vêm do CRM, não do navegador).
-- componentes: do produto (combo do catálogo) ou, no Kit do Mês, os itens do kit vigente.
create or replace function public._site_item(p_item jsonb)
returns table (id uuid, site_id text, nome text, categoria text, preco numeric, componentes jsonb)
language plpgsql stable security definer set search_path = public as $$
declare k public.kit_meses; c public.kit_config;
begin
  if p_item->>'id' = 'kit-mensal' then
    select * into c from public.kit_config where kit_config.id = 1;
    k := public._kit_vigente();
    if c.id is null or not c.ativo or k.mes is null then raise exception 'o Kit Prime do Mês não está disponível agora'; end if;
    return query
      select null::uuid, null::text,
             'Kit Prime do Mês ' || to_char(public._kit_mes_atual(), 'MM/YYYY') || ' (' ||
               concat_ws(' + ', (select x.nome from public.produtos x where x.site_id = k.seda),
                                (select x.nome from public.produtos x where x.site_id = k.piteira),
                                (select x.nome from public.produtos x where x.site_id = k.isqueiro) || ' personalizado') || ')',
             'Kit do Mês'::text, c.preco, jsonb_build_object(k.seda, 1, k.piteira, 1, k.isqueiro, 1);
    return;
  end if;
  return query
    select p.id, p.site_id, p.nome, p.categoria,
           coalesce(public._preco_oferta(p.site_id, nullif(p_item->>'preco_unitario', '')::numeric), p.preco),   -- oferta no ar (ou até 2 min depois do fim, se o cliente viu o preço dela)
           p.componentes
      from public.produtos p
     where p.ativo and (p.site_id = p_item->>'id' or lower(p.nome) = lower(trim(p_item->>'produto')))
     order by (p.site_id = p_item->>'id') desc nulls last
     limit 1;
  if not found then
    return query select null::uuid, null::text, null::text, null::text, null::numeric, null::jsonb;
  end if;
end $$;
revoke all on function public._site_item(jsonb) from public, anon, authenticated;

create or replace function public.site_registrar_pedido(p_dados jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_fone text := public._fone(p_dados->>'telefone');
  v_nome text := left(nullif(trim(p_dados->>'nome'), ''), 120);
  v_end  text;
  v_cli uuid; v_ped uuid; v_num int; v_total numeric; v_item jsonb; v_prod record;
  v_bloq boolean; v_qtd int; v_pag text;
  v_precisa jsonb := '{}'; k text; v text; v_nome_p text; v_estoque int; v_ativo boolean;
  v_fora boolean := not public.loja_aberta();   -- loja fechada agora: pedido fica "fora_horario"
begin
  -- validações básicas (a função é pública, então nada de confiar no navegador)
  if v_fone is null or length(v_fone) not between 12 and 13 then
    raise exception 'informe um WhatsApp válido com DDD';
  end if;
  if v_nome is null then raise exception 'informe seu nome'; end if;
  if coalesce((p_dados->>'maior_idade')::boolean, false) is not true then
    raise exception 'venda permitida somente para maiores de 18 anos';
  end if;
  if jsonb_typeof(p_dados->'itens') is distinct from 'array'
     or jsonb_array_length(p_dados->'itens') = 0
     or jsonb_array_length(p_dados->'itens') > 30 then
    raise exception 'pedido sem itens válidos';
  end if;

  -- estoque: soma o que o pedido consome de cada produto (combos/kits pelos componentes) e confere
  for v_item in select * from jsonb_array_elements(p_dados->'itens') loop
    v_qtd := least(greatest(coalesce((v_item->>'quantidade')::int, 1), 1), 50);
    select * into v_prod from public._site_item(v_item);
    if v_prod.componentes is not null then
      for k, v in select * from jsonb_each_text(v_prod.componentes) loop
        v_precisa := jsonb_set(v_precisa, array[k], to_jsonb(coalesce((v_precisa->>k)::int, 0) + v::int * v_qtd));
      end loop;
    elsif v_prod.site_id is not null then
      v_precisa := jsonb_set(v_precisa, array[v_prod.site_id], to_jsonb(coalesce((v_precisa->>v_prod.site_id)::int, 0) + v_qtd));
    end if;
  end loop;
  for k, v in select * from jsonb_each_text(v_precisa) loop
    select nome, estoque, ativo into v_nome_p, v_estoque, v_ativo from public.produtos where site_id = k;
    if found and (not v_ativo or v_estoque = 0) then
      raise exception 'produto esgotado: %', v_nome_p;
    elsif found and v_estoque < v::int then
      raise exception 'estoque insuficiente de %: restam %', v_nome_p, v_estoque;
    end if;
  end loop;

  v_end := left(concat_ws(', ',
             nullif(trim(concat_ws(', ', nullif(p_dados->>'rua',''), nullif(p_dados->>'numero',''))), ''),
             case when nullif(p_dados->>'cep','') is not null then 'CEP ' || (p_dados->>'cep') end), 250);

  -- cliente: cria ou completa pelo telefone (campos vazios não apagam dados)
  insert into public.clientes as c (nome, telefone, maior_idade, endereco, bairro, cidade, ponto_referencia, origem)
  values (v_nome, v_fone, true, v_end,
          left(nullif(p_dados->>'bairro',''), 80),
          coalesce(left(nullif(p_dados->>'cidade',''), 80), 'Ouro Preto'),
          left(nullif(p_dados->>'referencia',''), 200),
          'site')
  on conflict (telefone) do update set
    nome             = coalesce(excluded.nome, c.nome),
    maior_idade      = true,
    endereco         = coalesce(excluded.endereco, c.endereco),
    bairro           = coalesce(excluded.bairro, c.bairro),
    cidade           = coalesce(excluded.cidade, c.cidade),
    ponto_referencia = coalesce(excluded.ponto_referencia, c.ponto_referencia)
  returning id, bloqueado into v_cli, v_bloq;

  if v_bloq then raise exception 'não foi possível registrar o pedido pelo site'; end if;

  -- anti-spam: no máximo 3 pedidos do site por telefone a cada 10 minutos
  if (select count(*) from public.pedidos
       where cliente_id = v_cli and origem = 'site' and criado_em > now() - interval '10 minutes') >= 3 then
    raise exception 'muitos pedidos em sequência, aguarde alguns minutos';
  end if;

  v_pag := case lower(coalesce(p_dados->>'pagamento',''))
             when 'pix' then 'pix' when 'dinheiro' then 'dinheiro'
             when 'crédito' then 'cartao_credito' when 'credito' then 'cartao_credito'
             when 'débito' then 'cartao_debito'  when 'debito' then 'cartao_debito'
           end;

  insert into public.pedidos
    (cliente_id, status, tipo_entrega, endereco_entrega, forma_pagamento, taxa_entrega, observacoes, origem)
  values (
    v_cli, case when v_fora then 'fora_horario' else 'novo' end, 'entrega',
    left(concat_ws(' · ', v_end, nullif(p_dados->>'bairro',''), nullif(p_dados->>'cidade','')), 300),
    v_pag,
    least(greatest(coalesce(nullif(p_dados->>'taxa_entrega','')::numeric, 0), 0), 30),
    case when nullif(p_dados->>'referencia','') is not null then 'Referência: ' || left(p_dados->>'referencia', 200) end,
    'site')
  returning id, numero into v_ped, v_num;

  for v_item in select * from jsonb_array_elements(p_dados->'itens') loop
    v_qtd := least(greatest(coalesce((v_item->>'quantidade')::int, 1), 1), 50);
    select * into v_prod from public._site_item(v_item);

    -- a baixa de estoque acontece no trigger t_itens_estoque
    insert into public.pedido_itens (pedido_id, produto_id, produto, categoria, quantidade, preco_unitario, componentes)
    values (
      v_ped,
      v_prod.id,
      coalesce(v_prod.nome, left(trim(v_item->>'produto'), 150)),
      coalesce(v_prod.categoria, left(v_item->>'categoria', 40)),
      v_qtd,
      coalesce(v_prod.preco, greatest(coalesce(nullif(v_item->>'preco_unitario','')::numeric, 0), 0)),
      case when v_prod.id is null then v_prod.componentes end);  -- kit: guarda os itens para dar baixa
  end loop;

  select total into v_total from public.pedidos where id = v_ped;
  return jsonb_build_object('ok', true, 'numero', v_num, 'total', v_total, 'fora_horario', v_fora);
end $$;

revoke all on function public.site_registrar_pedido(jsonb) from public;
grant execute on function public.site_registrar_pedido(jsonb) to anon, authenticated;

-- Faz a API do Supabase enxergar as colunas/funções novas na hora (evita o erro "schema cache")
notify pgrst, 'reload schema';
