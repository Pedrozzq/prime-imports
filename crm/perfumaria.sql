-- =====================================================================
--  PRIME PERFUMES · PERFUMARIA (decants + ajustes do CRM para perfumes)
--  Rode no Supabase > SQL Editor DEPOIS do schema.sql e do site-pedidos.sql.
--  Pode rodar de novo quantas vezes quiser.
--
--  1. Clientes: sem regra de maioridade (era da tabacaria). Data de nascimento = aniversário.
--  2. Tira do catálogo os produtos de exemplo da tabacaria que vieram no schema.sql.
--  3. Decants: cada perfume tem um frasco aberto (decant_frascos) com os ml que sobram.
--     - decant vendido (site, agente ou CRM) desconta os ml sozinho; pedido cancelado devolve;
--     - o estoque de cada decant (5/10/15 ml) = quantos ainda rendem do frasco;
--     - "Abrir frasco" no CRM soma os ml de um frasco novo e pode tirar 1 frasco lacrado do estoque.
--  Os decants são os produtos com site_id "<perfume>|Decant <N> ml" (vêm do produtos.js).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Clientes
-- ---------------------------------------------------------------------
alter table public.clientes alter column maior_idade set default true;
alter table public.clientes alter column cidade drop default;
update public.clientes set maior_idade = true where not maior_idade;

-- o agente e o site ainda mandam/conferem "maior_idade": fica sempre true para não recusar pedido
create or replace function public.tg_clientes_maior_idade() returns trigger
language plpgsql as $$
begin
  new.maior_idade := true;
  return new;
end $$;
drop trigger if exists t_clientes_maior_idade on public.clientes;
create trigger t_clientes_maior_idade before insert or update on public.clientes
for each row execute function public.tg_clientes_maior_idade();

-- ---------------------------------------------------------------------
-- 2. Produtos de exemplo da tabacaria (só os que não são do site e nunca foram vendidos)
-- ---------------------------------------------------------------------
delete from public.produtos p
 where p.site_id is null
   and p.categoria in ('Sedas','Tabacos','Piteiras','Isqueiros','Acessórios')
   and not exists (select 1 from public.pedido_itens i where i.produto_id = p.id);
update public.produtos set ativo = false
 where site_id is null and categoria in ('Sedas','Tabacos','Piteiras','Isqueiros');

-- ---------------------------------------------------------------------
-- 3. Decants
-- ---------------------------------------------------------------------
create table if not exists public.decant_frascos (
  perfume_id       text primary key,                 -- parte do site_id antes do "|" (ex.: "atheeri")
  ml_restante      numeric(7,1) not null default 0 check (ml_restante >= 0),
  ml_frasco        numeric(7,1) not null default 100 check (ml_frasco > 0),  -- tamanho do último frasco aberto
  frascos_abertos  integer not null default 0,
  aberto_em        timestamptz,
  atualizado_em    timestamptz not null default now()
);
alter table public.decant_frascos enable row level security;
drop policy if exists "equipe decant_frascos" on public.decant_frascos;
create policy "equipe decant_frascos" on public.decant_frascos
  for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.decant_frascos to authenticated;

-- ml de um decant pelo site_id ("atheeri|Decant 10 ml" → 10); 0 = não é decant
create or replace function public._decant_ml(p_site_id text) returns int
language sql immutable as $$
  select coalesce((regexp_match(coalesce(p_site_id, ''), '\|\s*decant\s+(\d+)\s*ml\s*$', 'i'))[1]::int, 0)
$$;

-- estoque de cada decant do perfume = quantos ainda rendem do frasco aberto
create or replace function public._decant_recalcular(p_perfume text) returns void
language plpgsql security definer set search_path = public as $$
declare v_ml numeric;
begin
  select ml_restante into v_ml from public.decant_frascos where perfume_id = p_perfume;
  if v_ml is null then return; end if;
  update public.produtos
     set estoque = floor(v_ml / public._decant_ml(site_id))::int
   where split_part(site_id, '|', 1) = p_perfume
     and public._decant_ml(site_id) > 0
     and estoque is distinct from floor(v_ml / public._decant_ml(site_id))::int;
end $$;
revoke all on function public._decant_recalcular(text) from public, anon, authenticated;

create or replace function public.tg_decant_frascos() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public._decant_recalcular(new.perfume_id);
  return null;
end $$;
drop trigger if exists t_decant_frascos on public.decant_frascos;
create trigger t_decant_frascos after insert or update of ml_restante on public.decant_frascos
for each row execute function public.tg_decant_frascos();

-- tira (p_sinal = -1) ou devolve (+1) os ml de um item de pedido que é decant
create or replace function public._mover_ml(p_item public.pedido_itens, p_sinal int) returns void
language plpgsql security definer set search_path = public as $$
declare v_sid text; v_ml int;
begin
  if p_item.produto_id is null then return; end if;
  select site_id into v_sid from public.produtos where id = p_item.produto_id;
  v_ml := public._decant_ml(v_sid);
  if v_ml = 0 then return; end if;
  update public.decant_frascos
     set ml_restante = greatest(ml_restante + p_sinal * v_ml * p_item.quantidade, 0),
         atualizado_em = now()
   where perfume_id = split_part(v_sid, '|', 1);
end $$;
revoke all on function public._mover_ml(public.pedido_itens, int) from public, anon, authenticated;

-- mesmas regras da baixa de estoque (site-pedidos.sql): só pedidos que contam como venda.
-- Nome "t_itens_ml" roda depois de "t_itens_estoque" (ordem alfabética), então o estoque
-- dos decants termina recalculado pelos ml.
create or replace function public.tg_itens_ml() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  select status into v_status from public.pedidos where id = coalesce(new.pedido_id, old.pedido_id);
  if public._conta_venda(v_status) then
    if tg_op = 'INSERT' then perform public._mover_ml(new, -1);
    else perform public._mover_ml(old, 1); end if;
  end if;
  return null;
end $$;
drop trigger if exists t_itens_ml on public.pedido_itens;
create trigger t_itens_ml after insert or delete on public.pedido_itens
for each row execute function public.tg_itens_ml();

create or replace function public.tg_pedido_ml() returns trigger
language plpgsql security definer set search_path = public as $$
declare i public.pedido_itens;
begin
  if public._conta_venda(old.status) and not public._conta_venda(new.status) then
    for i in select * from public.pedido_itens where pedido_id = new.id loop perform public._mover_ml(i, 1); end loop;
  elsif not public._conta_venda(old.status) and public._conta_venda(new.status) then
    for i in select * from public.pedido_itens where pedido_id = new.id loop perform public._mover_ml(i, -1); end loop;
  end if;
  return null;
end $$;
drop trigger if exists t_pedido_ml on public.pedidos;
create trigger t_pedido_ml after update of status on public.pedidos
for each row execute function public.tg_pedido_ml();

-- CRM > Decants > "Abrir frasco": soma os ml do frasco novo ao que sobrou.
-- p_frasco = produto do frasco lacrado (ex.: "atheeri|100 ml") para tirar 1 do estoque (opcional).
create or replace function public.decant_abrir_frasco(p_perfume text, p_ml numeric, p_frasco uuid default null)
returns public.decant_frascos
language plpgsql security definer set search_path = public as $$
declare r public.decant_frascos; v_est int;
begin
  if auth.uid() is null then raise exception 'faça login no CRM'; end if;
  if coalesce(p_ml, 0) <= 0 then raise exception 'informe os ml do frasco'; end if;
  if p_frasco is not null then
    select estoque into v_est from public.produtos where id = p_frasco for update;
    if v_est is not null then
      if v_est < 1 then raise exception 'sem frasco lacrado em estoque'; end if;
      update public.produtos set estoque = estoque - 1 where id = p_frasco;
    end if;
  end if;
  insert into public.decant_frascos as f (perfume_id, ml_restante, ml_frasco, frascos_abertos, aberto_em, atualizado_em)
  values (p_perfume, p_ml, p_ml, 1, now(), now())
  on conflict (perfume_id) do update
     set ml_restante = f.ml_restante + excluded.ml_restante,
         ml_frasco = excluded.ml_frasco,
         frascos_abertos = f.frascos_abertos + 1,
         aberto_em = now(), atualizado_em = now()
  returning * into r;
  return r;
end $$;
revoke all on function public.decant_abrir_frasco(text, numeric, uuid) from public, anon;
grant execute on function public.decant_abrir_frasco(text, numeric, uuid) to authenticated;

-- CRM > Decants > "Ajustar ml": grava os ml medidos no frasco
create or replace function public.decant_ajustar_ml(p_perfume text, p_ml numeric)
returns public.decant_frascos
language plpgsql security definer set search_path = public as $$
declare r public.decant_frascos;
begin
  if auth.uid() is null then raise exception 'faça login no CRM'; end if;
  insert into public.decant_frascos as f (perfume_id, ml_restante, atualizado_em)
  values (p_perfume, greatest(coalesce(p_ml, 0), 0), now())
  on conflict (perfume_id) do update set ml_restante = excluded.ml_restante, atualizado_em = now()
  returning * into r;
  return r;
end $$;
revoke all on function public.decant_ajustar_ml(text, numeric) from public, anon;
grant execute on function public.decant_ajustar_ml(text, numeric) to authenticated;

-- tempo real: o CRM atualiza a tela de Decants quando os ml mudam
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.decant_frascos; exception when duplicate_object then null; end;
  end if;
end $$;

-- =====================================================================
-- 4. LOJA ONLINE (index.html) LIGADA AO CRM
--    - o site lê preço, estoque, "no site" e ofertas daqui (loja_catalogo, público);
--    - o servidor da loja (api/ na Vercel) confere a sacola por aqui antes de cobrar;
--    - pagamento do Mercado Pago vira pedido no CRM (loja_registrar_pedido, com a chave do agente).
--      Status do pedido no CRM (valor no banco → nome na tela):
--        aguardando_pagamento → Aguardando pagamento (Pix/boleto em aberto; não baixa estoque)
--        novo                 → Pagamento aprovado   (conta como venda; baixa estoque e ml dos decants)
--        saiu_entrega         → Enviado
--        entregue             → Entregue
--        recusado             → Pagamento recusado   (não conta; Pix vencido também cai aqui)
--        cancelado            → Venda cancelada      (estorno/chargeback ou cancelada pela equipe; devolve o estoque)
-- =====================================================================
alter table public.produtos add column if not exists excluido boolean not null default false;
alter table public.pedidos add column if not exists pagamento_ref    text;
alter table public.pedidos add column if not exists pagamento_status text;
alter table public.pedidos add column if not exists cupom            text;   -- código do cupom usado (seção 5)
create unique index if not exists pedidos_pagamento_ref_key on public.pedidos (pagamento_ref) where pagamento_ref is not null;

alter table public.pedidos drop constraint if exists pedidos_status_check;
alter table public.pedidos add constraint pedidos_status_check
  check (status in ('novo','confirmado','em_preparo','saiu_entrega','entregue','cancelado','fora_horario','aguardando_pagamento','recusado'));

-- status que contam como venda e baixam estoque
create or replace function public._conta_venda(p_status text) returns boolean
language sql immutable as $$ select coalesce(p_status not in ('cancelado','fora_horario','aguardando_pagamento','recusado'), true) $$;

-- regra de frete da tabacaria (frete-gratis.sql), se tiver sido rodada: a loja manda o frete dela
drop trigger if exists t_pedidos_frete on public.pedidos;

-- Catálogo ao vivo para o site e para o servidor de pagamento (só dado de vitrine)
--   produtos: id = site_id ("khamrah|100 ml"), preco = preço normal, oferta = preço de oferta valendo agora (ou null)
create or replace function public.loja_catalogo() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'agora', now(),
    'produtos', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.site_id, 'preco', p.preco, 'ativo', p.ativo, 'estoque', p.estoque, 'oferta', public._preco_oferta(p.site_id)))
      from public.produtos p where p.site_id is not null and not p.excluido), '[]'::jsonb),
    -- ofertas relâmpago no ar: o site mostra a faixa com o cronômetro até o fim e o selo -% nos produtos
    'ofertas', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'titulo', o.titulo, 'subtitulo', o.subtitulo, 'inicio', o.inicio, 'fim', o.fim,
          'itens', coalesce((select jsonb_agg(jsonb_build_object('id', i.site_id, 'preco', i.preco_oferta)) from public.oferta_itens i where i.oferta_id = o.id), '[]'::jsonb))
        order by o.fim)
      from public.ofertas o where o.ativo and now() >= o.inicio and now() < o.fim), '[]'::jsonb),
    -- próxima oferta agendada: o site recarrega sozinho na hora em que ela começa
    'proxima', (select min(o.inicio) from public.ofertas o where o.ativo and o.inicio > now()))
$$;
revoke all on function public.loja_catalogo() from public;
grant execute on function public.loja_catalogo() to anon, authenticated;

-- ATENÇÃO: a versão atual desta função (e da loja_cupom) está no checkout-aguardando.sql — rode-o depois deste arquivo.
-- Pedido pago no site → CRM. Chamado só pelo servidor da loja (precisa da chave do agente).
-- p_dados = {ref, pagamento_status, metodo, parcelas,
--            cliente:{nome, telefone, email}, entrega:{cep, rua, numero, complemento, bairro, cidade, uf},
--            itens:[{id, nome, marca, quantidade, preco}], desconto, frete, cupom, observacoes}
-- Pode ser chamado várias vezes para o mesmo pagamento (retorno do cliente + aviso do Mercado Pago):
-- a 1ª cria o pedido, as outras só atualizam o status do pagamento.
create or replace function public.loja_registrar_pedido(p_chave text, p_dados jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ref text := nullif(trim(p_dados->>'ref'), '');
  v_pst text := lower(coalesce(nullif(p_dados->>'pagamento_status', ''), 'pending'));
  v_ok boolean; v_recusa boolean; v_estorno boolean; v_novo_st text; v_pid uuid; v_num int; v_st text; v_cli uuid; v_total numeric;
  v_tel text; v_end text; v_cid text; v_ent jsonb := coalesce(p_dados->'entrega', '{}'::jsonb); v_item jsonb; v_prod record;
begin
  perform public._agente_validar(p_chave);
  if v_ref is null then raise exception 'pagamento sem referência'; end if;
  v_ok      := v_pst in ('approved', 'authorized');
  v_recusa  := v_pst in ('rejected', 'cancelled');          -- não pagou (cartão recusado, Pix/boleto vencido)
  v_estorno := v_pst in ('refunded', 'charged_back');       -- pagou e o dinheiro voltou
  v_novo_st := case when v_ok then 'novo' when v_recusa then 'recusado' when v_estorno then 'cancelado' else 'aguardando_pagamento' end;
  perform pg_advisory_xact_lock(hashtext('loja_pedido:' || v_ref));

  -- já registrado: só acompanha o pagamento
  select id, numero into v_pid, v_num from public.pedidos where pagamento_ref = v_ref;
  if found then
    update public.pedidos set pagamento_status = v_pst,
           status = case
             when v_ok and status in ('aguardando_pagamento', 'recusado') then 'novo'
             when v_recusa and status = 'aguardando_pagamento' then 'recusado'
             when (v_estorno or v_recusa) and status in ('novo', 'confirmado', 'em_preparo', 'saiu_entrega', 'entregue') then 'cancelado'
             else status end
     where id = v_pid
     returning status, total into v_st, v_total;
    return jsonb_build_object('ok', true, 'pedido_id', v_pid, 'numero', v_num, 'status', v_st, 'total', v_total, 'novo', false);
  end if;

  if jsonb_typeof(p_dados->'itens') is distinct from 'array' or jsonb_array_length(p_dados->'itens') = 0 then
    raise exception 'pedido sem itens';
  end if;

  v_tel := public._fone(p_dados->'cliente'->>'telefone');
  if v_tel is null then v_tel := 'mp' || regexp_replace(v_ref, '\D', '', 'g'); end if;   -- sem telefone: ficha pelo nº do pagamento
  v_end := nullif(concat_ws(', ', nullif(v_ent->>'rua', ''), nullif(v_ent->>'numero', ''), nullif(v_ent->>'complemento', '')), '');
  v_cid := nullif(concat_ws(' - ', nullif(v_ent->>'cidade', ''), nullif(v_ent->>'uf', '')), '');

  insert into public.clientes as c (nome, telefone, email, endereco, bairro, cidade, origem)
  values (coalesce(nullif(trim(p_dados->'cliente'->>'nome'), ''), 'Cliente do site'), v_tel,
          nullif(trim(p_dados->'cliente'->>'email'), ''), v_end, nullif(v_ent->>'bairro', ''), v_cid, 'site')
  on conflict (telefone) do update set
    nome     = case when excluded.nome = 'Cliente do site' then c.nome else excluded.nome end,
    email    = coalesce(excluded.email, c.email),
    endereco = coalesce(excluded.endereco, c.endereco),
    bairro   = coalesce(excluded.bairro, c.bairro),
    cidade   = coalesce(excluded.cidade, c.cidade)
  returning id into v_cli;

  insert into public.pedidos (cliente_id, status, tipo_entrega, endereco_entrega, forma_pagamento, taxa_entrega, desconto,
                              observacoes, origem, pagamento_ref, pagamento_status, cupom)
  values (v_cli, v_novo_st, 'entrega',
          nullif(concat_ws(' · ', v_end, nullif(v_ent->>'bairro', ''), v_cid,
                 case when nullif(v_ent->>'cep', '') is not null then 'CEP ' || (v_ent->>'cep') end), ''),
          case lower(coalesce(p_dados->>'metodo', ''))
            when 'pix' then 'pix' when 'bank_transfer' then 'pix'
            when 'credit_card' then 'cartao_credito' when 'debit_card' then 'cartao_debito' else null end,
          greatest(coalesce(nullif(p_dados->>'frete', '')::numeric, 0), 0),
          greatest(coalesce(nullif(p_dados->>'desconto', '')::numeric, 0), 0),
          concat_ws(' · ', 'Mercado Pago #' || v_ref,
                 case when coalesce(nullif(p_dados->>'parcelas', '')::int, 1) > 1 then (p_dados->>'parcelas') || 'x no cartão' end,
                 case when nullif(p_dados->>'cupom', '') is not null then 'cupom ' || upper(p_dados->>'cupom') end,
                 nullif(p_dados->>'observacoes', '')),
          'site', v_ref, v_pst, nullif(upper(trim(coalesce(p_dados->>'cupom', ''))), ''))
  returning id, numero into v_pid, v_num;

  for v_item in select * from jsonb_array_elements(p_dados->'itens') loop
    select id, nome, categoria into v_prod from public.produtos where site_id = v_item->>'id';
    insert into public.pedido_itens (pedido_id, produto_id, produto, categoria, quantidade, preco_unitario)
    values (v_pid, v_prod.id,
            coalesce(v_prod.nome, nullif(v_item->>'nome', ''), v_item->>'id'),
            coalesce(v_prod.categoria, nullif(v_item->>'marca', '')),
            greatest(coalesce(nullif(v_item->>'quantidade', '')::int, 1), 1),
            greatest(coalesce(nullif(v_item->>'preco', '')::numeric, 0), 0));
  end loop;

  select status, total into v_st, v_total from public.pedidos where id = v_pid;
  return jsonb_build_object('ok', true, 'pedido_id', v_pid, 'numero', v_num, 'status', v_st, 'total', v_total, 'novo', true);
end $$;
revoke all on function public.loja_registrar_pedido(text, jsonb) from public;
grant execute on function public.loja_registrar_pedido(text, jsonb) to anon, authenticated;

-- =====================================================================
-- 5. CUPONS DE DESCONTO (CRM > Cupons → sacola do site e cobrança no Mercado Pago)
--    percentual (com teto opcional) ou valor fixo, compra mínima, validade, limite de usos
--    e "1 uso por cliente" (pelo WhatsApp do checkout). O site e o servidor consultam
--    loja_cupom(); a lista de códigos NÃO é pública (ninguém lista os cupons pela API).
--    Uso = pedido com o cupom que não foi cancelado (Aguardando pagamento também conta,
--    para o limite não estourar com vários Pix em aberto).
-- =====================================================================
create table if not exists public.cupons (
  codigo          text primary key check (codigo ~ '^[A-Z0-9_-]{3,24}$'),
  tipo            text not null default 'percentual' check (tipo in ('percentual', 'fixo')),
  valor           numeric(10,2) not null check (valor > 0),
  minimo          numeric(10,2) not null default 0 check (minimo >= 0),     -- compra mínima (R$, já com a promoção)
  teto            numeric(10,2) not null default 0 check (teto >= 0),       -- desconto máximo do percentual (0 = sem teto)
  rotulo          text,                                                     -- texto curto que o cliente vê
  ativo           boolean not null default true,
  inicio          timestamptz,                                              -- vazio = já vale
  fim             timestamptz,                                              -- vazio = sem prazo
  limite_usos     integer check (limite_usos is null or limite_usos > 0),   -- vazio = sem limite
  um_por_cliente  boolean not null default false,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now(),
  constraint cupons_periodo check (fim is null or inicio is null or fim > inicio),
  constraint cupons_percentual check (tipo <> 'percentual' or valor <= 100)
);
alter table public.cupons enable row level security;
drop policy if exists "equipe cupons" on public.cupons;
create policy "equipe cupons" on public.cupons for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.cupons to authenticated;
revoke all on public.cupons from anon;

-- os cupons que estavam no código do site (api/_lib/cupons.js) entram já cadastrados
insert into public.cupons (codigo, tipo, valor, minimo, teto, rotulo) values
  ('PRIME10',    'percentual', 10, 0,   150, '10% OFF'),
  ('PRIME15',    'percentual', 15, 500, 300, '15% OFF acima de R$ 500'),
  ('BEMVINDO30', 'fixo',       30, 199, 0,   'R$ 30 OFF acima de R$ 199')
on conflict (codigo) do nothing;

create index if not exists idx_pedidos_cupom on public.pedidos (cupom) where cupom is not null;

-- Regras do cupom valendo agora, para a sacola do site e para o servidor de pagamento.
--   {ok:true, codigo, tipo, valor, minimo, teto, rotulo} ou {ok:false, motivo}
--   p_telefone: confere "1 uso por cliente"; p_ignorar_limites: depois do pagamento (o próprio pedido já conta como uso)
create or replace function public.loja_cupom(p_codigo text, p_telefone text default null, p_ignorar_limites boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c public.cupons; v_cod text := upper(trim(coalesce(p_codigo, ''))); v_usos int; v_tel text := public._fone(p_telefone);
begin
  select * into c from public.cupons where codigo = v_cod;
  if not found or not c.ativo then return jsonb_build_object('ok', false, 'motivo', 'Cupom inválido ou expirado.'); end if;
  if not p_ignorar_limites then
    if c.inicio is not null and now() < c.inicio then return jsonb_build_object('ok', false, 'motivo', 'Este cupom ainda não começou a valer.'); end if;
    if c.fim is not null and now() >= c.fim then return jsonb_build_object('ok', false, 'motivo', 'Cupom inválido ou expirado.'); end if;
    if c.limite_usos is not null then
      select count(*) into v_usos from public.pedidos where cupom = v_cod and status <> 'cancelado';
      if v_usos >= c.limite_usos then return jsonb_build_object('ok', false, 'motivo', 'Este cupom já esgotou.'); end if;
    end if;
    if c.um_por_cliente and v_tel is not null and exists (
         select 1 from public.pedidos p join public.clientes cl on cl.id = p.cliente_id
          where p.cupom = v_cod and p.status <> 'cancelado' and cl.telefone = v_tel) then
      return jsonb_build_object('ok', false, 'motivo', 'Você já usou este cupom.');
    end if;
  end if;
  return jsonb_build_object('ok', true, 'codigo', c.codigo, 'tipo', c.tipo, 'valor', c.valor, 'minimo', c.minimo,
                            'teto', c.teto, 'rotulo', coalesce(nullif(c.rotulo, ''), c.codigo));
end $$;
revoke all on function public.loja_cupom(text, text, boolean) from public;
grant execute on function public.loja_cupom(text, text, boolean) to anon, authenticated;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.cupons; exception when duplicate_object then null; end;
  end if;
end $$;
