-- =====================================================================
--  PRIME PERFUMES · CRM
--  Schema completo para Supabase (Postgres)
--  Como usar: Supabase > SQL Editor > New query > cole tudo > Run
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. TABELAS
-- ---------------------------------------------------------------------

create table if not exists public.clientes (
  id                 uuid primary key default gen_random_uuid(),
  nome               text not null,
  telefone           text not null unique,          -- só dígitos, ex: 5531999998888
  email              text,
  data_nascimento    date,
  maior_idade        boolean not null default false, -- confirmado pelo agente/atendente
  endereco           text,
  bairro             text,
  cidade             text default 'Ouro Preto',
  ponto_referencia   text,
  observacoes        text,
  tags               text[] not null default '{}',
  origem             text not null default 'whatsapp' check (origem in ('whatsapp','manual','loja','instagram')),
  bloqueado          boolean not null default false,
  criado_em          timestamptz not null default now(),
  atualizado_em      timestamptz not null default now()
);

create table if not exists public.produtos (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null,
  categoria  text not null default 'Acessórios'
             check (categoria in ('Sedas','Tabacos','Piteiras','Isqueiros','Acessórios','Outros')),
  preco      numeric(10,2) not null default 0 check (preco >= 0),
  ativo      boolean not null default true,
  criado_em  timestamptz not null default now()
);

create sequence if not exists public.pedidos_numero_seq start 1001;

create table if not exists public.pedidos (
  id               uuid primary key default gen_random_uuid(),
  numero           integer not null unique default nextval('public.pedidos_numero_seq'),
  cliente_id       uuid not null references public.clientes(id) on delete restrict,
  status           text not null default 'novo'
                   check (status in ('novo','confirmado','em_preparo','saiu_entrega','entregue','cancelado')),
  tipo_entrega     text not null default 'entrega' check (tipo_entrega in ('entrega','retirada')),
  endereco_entrega text,
  forma_pagamento  text check (forma_pagamento in ('pix','dinheiro','cartao_credito','cartao_debito')),
  troco_para       numeric(10,2),
  subtotal         numeric(10,2) not null default 0,
  desconto         numeric(10,2) not null default 0 check (desconto >= 0),
  taxa_entrega     numeric(10,2) not null default 0 check (taxa_entrega >= 0),
  total            numeric(10,2) not null default 0,
  observacoes      text,
  origem           text not null default 'whatsapp' check (origem in ('whatsapp','manual','loja','instagram')),
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now()
);

create table if not exists public.pedido_itens (
  id              uuid primary key default gen_random_uuid(),
  pedido_id       uuid not null references public.pedidos(id) on delete cascade,
  produto_id      uuid references public.produtos(id) on delete set null,
  produto         text not null,                 -- nome gravado no momento da venda
  categoria       text,
  quantidade      integer not null default 1 check (quantidade > 0),
  preco_unitario  numeric(10,2) not null default 0 check (preco_unitario >= 0),
  subtotal        numeric(10,2) generated always as (quantidade * preco_unitario) stored
);

-- Chave secreta que o agente de WhatsApp usa (não é exposta pela API)
create table if not exists public.agente_config (
  id     int primary key default 1 check (id = 1),
  chave  text not null default encode(gen_random_bytes(24), 'hex')
);
insert into public.agente_config (id) values (1) on conflict do nothing;

create index if not exists idx_pedidos_cliente on public.pedidos(cliente_id);
create index if not exists idx_pedidos_status  on public.pedidos(status);
create index if not exists idx_pedidos_criado  on public.pedidos(criado_em desc);
create index if not exists idx_itens_pedido    on public.pedido_itens(pedido_id);
create index if not exists idx_clientes_nome   on public.clientes(lower(nome));

-- ---------------------------------------------------------------------
-- 2. TRIGGERS (totais e datas automáticas)
-- ---------------------------------------------------------------------

create or replace function public.tg_atualizado_em() returns trigger
language plpgsql as $$
begin new.atualizado_em := now(); return new; end $$;

drop trigger if exists t_clientes_upd on public.clientes;
create trigger t_clientes_upd before update on public.clientes
for each row execute function public.tg_atualizado_em();

-- total do pedido = subtotal - desconto + taxa (nunca negativo)
create or replace function public.tg_pedido_total() returns trigger
language plpgsql as $$
begin
  new.total := greatest(0, coalesce(new.subtotal,0) - coalesce(new.desconto,0) + coalesce(new.taxa_entrega,0));
  new.atualizado_em := now();
  return new;
end $$;

drop trigger if exists t_pedidos_total on public.pedidos;
create trigger t_pedidos_total before insert or update on public.pedidos
for each row execute function public.tg_pedido_total();

-- subtotal do pedido = soma dos itens
create or replace function public.tg_itens_recalc() returns trigger
language plpgsql as $$
declare pid uuid := coalesce(new.pedido_id, old.pedido_id);
begin
  update public.pedidos
     set subtotal = coalesce((select sum(subtotal) from public.pedido_itens where pedido_id = pid), 0)
   where id = pid;
  return null;
end $$;

drop trigger if exists t_itens_recalc on public.pedido_itens;
create trigger t_itens_recalc after insert or update or delete on public.pedido_itens
for each row execute function public.tg_itens_recalc();

-- ---------------------------------------------------------------------
-- 3. VIEW: resumo do cliente (qtd. de pedidos, total gasto, último pedido)
-- ---------------------------------------------------------------------

create or replace view public.clientes_resumo
with (security_invoker = true) as
select c.*,
       count(p.id) filter (where p.status <> 'cancelado')                 as total_pedidos,
       coalesce(sum(p.total) filter (where p.status <> 'cancelado'), 0)   as total_gasto,
       max(p.criado_em)                                                   as ultimo_pedido_em
from public.clientes c
left join public.pedidos p on p.cliente_id = c.id
group by c.id;

-- ---------------------------------------------------------------------
-- 4. SEGURANÇA (RLS): só usuários logados no CRM acessam os dados
-- ---------------------------------------------------------------------

alter table public.clientes      enable row level security;
alter table public.produtos      enable row level security;
alter table public.pedidos       enable row level security;
alter table public.pedido_itens  enable row level security;
alter table public.agente_config enable row level security;   -- sem policy = ninguém lê pela API

do $$
declare t text;
begin
  foreach t in array array['clientes','produtos','pedidos','pedido_itens'] loop
    execute format('drop policy if exists equipe_total on public.%I', t);
    execute format('create policy equipe_total on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

revoke all on public.agente_config from anon, authenticated;
grant select, insert, update, delete on public.clientes, public.produtos, public.pedidos, public.pedido_itens to authenticated;
grant select on public.clientes_resumo to authenticated;
grant usage on sequence public.pedidos_numero_seq to authenticated;

-- ---------------------------------------------------------------------
-- 5. FUNÇÕES DO AGENTE DE WHATSAPP (chamadas via /rest/v1/rpc/...)
--    Todas exigem p_chave = agente_config.chave
-- ---------------------------------------------------------------------

create or replace function public._agente_validar(p_chave text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_chave is null or not exists (select 1 from public.agente_config where chave = p_chave) then
    raise exception 'chave do agente inválida' using errcode = '28000';
  end if;
end $$;

-- Normaliza telefone: só dígitos e sempre com DDI 55 (ex: 5531999998888)
create or replace function public._fone(p text) returns text
language sql immutable as $$
  select case
    when d is null then null
    when length(d) in (10, 11) then '55' || d
    else d end
  from (select nullif(regexp_replace(coalesce(p,''), '\D', '', 'g'), '') d) x
$$;

-- 5.1 Buscar cliente pelo telefone (com histórico) --------------------
create or replace function public.agente_buscar_cliente(p_chave text, p_telefone text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  perform public._agente_validar(p_chave);
  select jsonb_build_object(
           'encontrado', true,
           'cliente', to_jsonb(cr) - 'tags',
           'ultimos_pedidos', coalesce((
             select jsonb_agg(x order by x->>'criado_em' desc) from (
               select jsonb_build_object(
                        'numero', p.numero, 'status', p.status, 'total', p.total,
                        'criado_em', p.criado_em,
                        'itens', (select jsonb_agg(jsonb_build_object('produto', i.produto, 'quantidade', i.quantidade))
                                    from public.pedido_itens i where i.pedido_id = p.id)) x
               from public.pedidos p where p.cliente_id = cr.id
               order by p.criado_em desc limit 5) s), '[]'::jsonb))
    into r
    from public.clientes_resumo cr
   where cr.telefone = public._fone(p_telefone);
  return coalesce(r, jsonb_build_object('encontrado', false));
end $$;

-- 5.2 Criar/atualizar cliente (upsert pelo telefone) ------------------
create or replace function public.agente_salvar_cliente(p_chave text, p_dados jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_fone text := public._fone(p_dados->>'telefone'); v_id uuid;
begin
  perform public._agente_validar(p_chave);
  if v_fone is null then raise exception 'telefone é obrigatório'; end if;

  insert into public.clientes as c
    (nome, telefone, email, data_nascimento, maior_idade, endereco, bairro, cidade, ponto_referencia, observacoes, origem)
  values (
    coalesce(nullif(p_dados->>'nome',''), 'Cliente WhatsApp'),
    v_fone,
    nullif(lower(p_dados->>'email'),''),
    nullif(p_dados->>'data_nascimento','')::date,
    coalesce((p_dados->>'maior_idade')::boolean, false),
    nullif(p_dados->>'endereco',''),
    nullif(p_dados->>'bairro',''),
    coalesce(nullif(p_dados->>'cidade',''), 'Ouro Preto'),
    nullif(p_dados->>'ponto_referencia',''),
    nullif(p_dados->>'observacoes',''),
    'whatsapp')
  on conflict (telefone) do update set
    nome             = coalesce(nullif(excluded.nome,'Cliente WhatsApp'), c.nome),
    email            = coalesce(excluded.email, c.email),
    data_nascimento  = coalesce(excluded.data_nascimento, c.data_nascimento),
    maior_idade      = c.maior_idade or excluded.maior_idade,
    endereco         = coalesce(excluded.endereco, c.endereco),
    bairro           = coalesce(excluded.bairro, c.bairro),
    cidade           = coalesce(nullif(p_dados->>'cidade',''), c.cidade),
    ponto_referencia = coalesce(excluded.ponto_referencia, c.ponto_referencia),
    observacoes      = coalesce(excluded.observacoes, c.observacoes)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'cliente_id', v_id);
end $$;

-- 5.3 Registrar pedido completo ---------------------------------------
-- p_dados = { telefone, nome, email, endereco, ..., maior_idade,
--             tipo_entrega, forma_pagamento, troco_para, taxa_entrega, desconto, observacoes,
--             itens: [ { produto, quantidade, preco_unitario?, categoria? } ] }
create or replace function public.agente_registrar_pedido(p_chave text, p_dados jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cli uuid; v_ped uuid; v_num int; v_total numeric; v_item jsonb; v_prod record;
  v_nasc date; v_maior boolean; v_bloq boolean; v_end text;
begin
  perform public._agente_validar(p_chave);

  if jsonb_typeof(p_dados->'itens') <> 'array' or jsonb_array_length(p_dados->'itens') = 0 then
    raise exception 'o pedido precisa ter ao menos 1 item';
  end if;

  v_cli := (public.agente_salvar_cliente(p_chave, p_dados)->>'cliente_id')::uuid;
  select data_nascimento, maior_idade, bloqueado, endereco into v_nasc, v_maior, v_bloq, v_end
    from public.clientes where id = v_cli;

  -- Venda de produtos de tabacaria é proibida para menores de 18 anos
  if v_nasc is not null and v_nasc > (current_date - interval '18 years') then
    raise exception 'cliente menor de 18 anos — venda não permitida';
  end if;
  if not v_maior and v_nasc is null then
    raise exception 'confirme a maioridade (18+) do cliente antes de registrar o pedido';
  end if;
  if v_bloq then raise exception 'cliente bloqueado — encaminhe para atendimento humano'; end if;

  insert into public.pedidos
    (cliente_id, tipo_entrega, endereco_entrega, forma_pagamento, troco_para, taxa_entrega, desconto, observacoes, origem)
  values (
    v_cli,
    coalesce(nullif(p_dados->>'tipo_entrega',''), 'entrega'),
    coalesce(nullif(p_dados->>'endereco_entrega',''), v_end),
    nullif(p_dados->>'forma_pagamento',''),
    nullif(p_dados->>'troco_para','')::numeric,
    coalesce(nullif(p_dados->>'taxa_entrega','')::numeric, 0),
    coalesce(nullif(p_dados->>'desconto','')::numeric, 0),
    nullif(p_dados->>'observacoes',''),
    'whatsapp')
  returning id, numero into v_ped, v_num;

  for v_item in select * from jsonb_array_elements(p_dados->'itens') loop
    -- tenta casar com o catálogo para pegar preço/categoria
    select id, nome, categoria, preco into v_prod
      from public.produtos
     where ativo and lower(nome) = lower(trim(v_item->>'produto'))
     limit 1;

    insert into public.pedido_itens (pedido_id, produto_id, produto, categoria, quantidade, preco_unitario)
    values (
      v_ped,
      v_prod.id,
      coalesce(v_prod.nome, trim(v_item->>'produto')),
      coalesce(v_item->>'categoria', v_prod.categoria),
      coalesce((v_item->>'quantidade')::int, 1),
      coalesce(nullif(v_item->>'preco_unitario','')::numeric, v_prod.preco, 0));
  end loop;

  select total into v_total from public.pedidos where id = v_ped;
  return jsonb_build_object('ok', true, 'pedido_id', v_ped, 'numero', v_num, 'total', v_total, 'cliente_id', v_cli);
end $$;

-- 5.4 Catálogo para o agente consultar preços -------------------------
create or replace function public.agente_listar_produtos(p_chave text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public._agente_validar(p_chave);
  return coalesce((select jsonb_agg(jsonb_build_object('nome', nome, 'categoria', categoria, 'preco', preco) order by categoria, nome)
                     from public.produtos where ativo), '[]'::jsonb);
end $$;

-- 5.5 Consultar status de um pedido -----------------------------------
create or replace function public.agente_status_pedido(p_chave text, p_telefone text, p_numero int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  perform public._agente_validar(p_chave);
  select jsonb_build_object('numero', p.numero, 'status', p.status, 'total', p.total, 'criado_em', p.criado_em)
    into r
    from public.pedidos p join public.clientes c on c.id = p.cliente_id
   where c.telefone = public._fone(p_telefone)
     and (p_numero is null or p.numero = p_numero)
   order by p.criado_em desc limit 1;
  return coalesce(r, jsonb_build_object('encontrado', false));
end $$;

-- Permissões: o agente usa a anon key + p_chave; funções internas ficam fechadas
revoke all on function public._agente_validar(text) from public, anon, authenticated;
grant execute on function public.agente_buscar_cliente(text,text)          to anon, authenticated;
grant execute on function public.agente_salvar_cliente(text,jsonb)         to anon, authenticated;
grant execute on function public.agente_registrar_pedido(text,jsonb)       to anon, authenticated;
grant execute on function public.agente_listar_produtos(text)              to anon, authenticated;
grant execute on function public.agente_status_pedido(text,text,int)       to anon, authenticated;

-- Para a tela "Integração" do CRM mostrar a chave (só para usuários logados)
create or replace function public.ver_chave_agente() returns text
language sql security definer set search_path = public as $$
  select chave from public.agente_config where id = 1 and auth.uid() is not null
$$;
create or replace function public.gerar_nova_chave_agente() returns text
language plpgsql security definer set search_path = public as $$
declare k text;
begin
  if auth.uid() is null then raise exception 'não autenticado'; end if;
  update public.agente_config set chave = encode(gen_random_bytes(24), 'hex') where id = 1 returning chave into k;
  return k;
end $$;
revoke all on function public.ver_chave_agente()        from public, anon;
revoke all on function public.gerar_nova_chave_agente() from public, anon;
grant execute on function public.ver_chave_agente()        to authenticated;
grant execute on function public.gerar_nova_chave_agente() to authenticated;

-- ---------------------------------------------------------------------
-- 6. TEMPO REAL: pedidos do WhatsApp aparecem no CRM sem recarregar
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.pedidos;  exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.clientes; exception when duplicate_object then null; end;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 7. CATÁLOGO INICIAL (edite os preços depois pelo CRM)
-- ---------------------------------------------------------------------
insert into public.produtos (nome, categoria, preco)
select * from (values
  ('Seda Smoking Brown King Size', 'Sedas',      6.00),
  ('Seda Zomo Perfect Slim',       'Sedas',      5.00),
  ('Seda Bem Bolado Brown',        'Sedas',      5.50),
  ('Tabaco Acrema 25g',            'Tabacos',   18.00),
  ('Tabaco Hi Tobacco 25g',        'Tabacos',   22.00),
  ('Piteira de Papel Bem Bolado',  'Piteiras',   4.00),
  ('Piteira de Vidro',             'Piteiras',  15.00),
  ('Isqueiro BIC Grande',          'Isqueiros',  9.00),
  ('Isqueiro Clipper',             'Isqueiros', 14.00),
  ('Dichavador de Metal 4 partes', 'Acessórios', 35.00),
  ('Bandeja de Metal Média',       'Acessórios', 28.00)
) v(nome, categoria, preco)
where not exists (select 1 from public.produtos);
