-- =====================================================================
--  PRIME PERFUMES · CRM
--  KIT PRIME DO MÊS (assinatura) — arquivo só com o kit, para rodar sozinho.
--  Supabase > SQL Editor > New query > cole TUDO > Run
--  (se aparecer o aviso de "destructive operation", confirme em "Run this query")
--  Pode rodar mais de uma vez. O mesmo conteúdo também está no site-pedidos.sql.
-- =====================================================================

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

-- O pedido do site com id "kit-mensal" pega preço e itens do kit vigente
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

-- Faz a API do Supabase enxergar as tabelas/funções novas na hora (evita o erro "schema cache")
notify pgrst, 'reload schema';

-- Conferência: deve mostrar 1 linha de configuração e o kit do mês
select 'config' as o_que, to_jsonb(c) as dados from public.kit_config c
union all
select 'kit do mês', to_jsonb(k) from public.kit_meses k;
