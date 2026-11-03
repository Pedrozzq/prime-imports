-- =====================================================================
--  PRIME PERFUMES · CRM
--  WhatsApp Business (API oficial da Meta) dentro do CRM: conversas e mensagens
--  Rode DEPOIS do schema.sql: Supabase > SQL Editor > New query > cole tudo > Run
--  (pode rodar mais de uma vez sem problema)
-- =====================================================================

create table if not exists public.wa_conversas (
  id                 uuid primary key default gen_random_uuid(),
  telefone           text not null unique,              -- wa_id do contato, só dígitos (ex: 5531999998888)
  nome               text,                              -- nome do perfil no WhatsApp
  cliente_id         uuid references public.clientes(id) on delete set null,
  ultima_msg         text,
  ultima_msg_em      timestamptz,
  ultima_entrada_em  timestamptz,                       -- última msg DO cliente (janela de 24 h da Meta)
  nao_lidas          integer not null default 0,
  bot_pausado        boolean not null default false,    -- true = atendente humano assumiu (não repassa ao agente/n8n)
  criado_em          timestamptz not null default now()
);

create table if not exists public.wa_mensagens (
  id             uuid primary key default gen_random_uuid(),
  conversa_id    uuid not null references public.wa_conversas(id) on delete cascade,
  wa_message_id  text unique,
  direcao        text not null check (direcao in ('entrada','saida')),
  tipo           text not null default 'text',          -- text, image, audio, document, template, ...
  texto          text,
  status         text not null default 'recebida'
                 check (status in ('recebida','enviando','enviada','entregue','lida','falhou')),
  erro           text,
  enviado_por    uuid,                                   -- usuário do CRM que respondeu
  criado_em      timestamptz not null default now()
);

create index if not exists idx_wa_conv_ultima on public.wa_conversas(ultima_msg_em desc);
create index if not exists idx_wa_msg_conv    on public.wa_mensagens(conversa_id, criado_em);

-- Segurança: só a equipe logada lê/responde. O webhook grava com a service role (Edge Function).
alter table public.wa_conversas enable row level security;
alter table public.wa_mensagens enable row level security;
drop policy if exists equipe_total on public.wa_conversas;
drop policy if exists equipe_total on public.wa_mensagens;
create policy equipe_total on public.wa_conversas for all to authenticated using (true) with check (true);
create policy equipe_total on public.wa_mensagens for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.wa_conversas, public.wa_mensagens to authenticated;

-- Liga a conversa ao cliente do CRM pelo telefone.
-- No Brasil o WhatsApp às vezes entrega o número sem o 9 (553199998888): testa as duas formas.
create or replace function public.wa_cliente_por_telefone(p_tel text) returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.clientes
   where telefone in (
     p_tel,
     case when p_tel ~ '^55\d{10}$' then substr(p_tel, 1, 4) || '9' || substr(p_tel, 5) end,
     case when p_tel ~ '^55\d{2}9\d{8}$' then substr(p_tel, 1, 4) || substr(p_tel, 6) end)
   limit 1
$$;
revoke all on function public.wa_cliente_por_telefone(text) from public, anon;
grant execute on function public.wa_cliente_por_telefone(text) to authenticated, service_role;

-- Novo cliente cadastrado (pelo site, agente ou CRM) já aparece ligado à conversa existente
create or replace function public.tg_wa_vincular_cliente() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.wa_conversas
     set cliente_id = new.id
   where cliente_id is null
     and public.wa_cliente_por_telefone(telefone) = new.id;
  return null;
end $$;
drop trigger if exists t_wa_vincular_cliente on public.clientes;
create trigger t_wa_vincular_cliente after insert or update of telefone on public.clientes
for each row execute function public.tg_wa_vincular_cliente();

-- Tempo real: mensagens novas aparecem no CRM na hora
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.wa_conversas; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.wa_mensagens; exception when duplicate_object then null; end;
  end if;
end $$;
