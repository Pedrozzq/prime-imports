-- =====================================================================
--  PRIME PERFUMES · CRM
--  Notificações no celular (Web Push): pedido novo, mensagem no WhatsApp
--  e atualizações (status de pedido, estoque acabando) chegam mesmo com o
--  CRM fechado.
--  Rode DEPOIS do schema.sql, site-pedidos.sql e whatsapp.sql:
--  Supabase > SQL Editor > New query > cole tudo > Run
--  (pode rodar mais de uma vez sem problema)
--
--  Quem envia é a Edge Function "push" (supabase/functions/push).
--  Os gatilhos abaixo só avisam a função: nunca atrasam nem bloqueiam um pedido.
-- =====================================================================

-- pg_net: deixa o banco chamar a Edge Function (Database > Extensions > pg_net)
create extension if not exists pg_net;

-- 1. Aparelhos inscritos: um por celular/navegador de cada pessoa da equipe
create table if not exists public.push_inscricoes (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  endpoint       text not null unique,                   -- endereço de entrega da Apple/Google/Mozilla
  p256dh         text not null,
  auth           text not null,
  dispositivo    text,                                   -- ex.: "iPhone", para mostrar no CRM
  tipos          text[] not null default '{pedidos,whatsapp,atualizacoes}',
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
create index if not exists idx_push_user on public.push_inscricoes(user_id);

alter table public.push_inscricoes enable row level security;
drop policy if exists push_proprio on public.push_inscricoes;
-- cada pessoa vê e apaga só os próprios aparelhos
create policy push_proprio on public.push_inscricoes for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, delete on public.push_inscricoes to authenticated;

-- Inscrever / atualizar este aparelho (se o celular trocou de login, passa para o usuário atual)
create or replace function public.push_registrar(p_endpoint text, p_p256dh text, p_auth text, p_dispositivo text, p_tipos text[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Faça login no CRM'; end if;
  insert into public.push_inscricoes (user_id, endpoint, p256dh, auth, dispositivo, tipos)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, p_dispositivo, coalesce(p_tipos, '{pedidos,whatsapp,atualizacoes}'))
  on conflict (endpoint) do update
     set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
         dispositivo = excluded.dispositivo, tipos = excluded.tipos, atualizado_em = now();
end $$;
revoke all on function public.push_registrar(text, text, text, text, text[]) from public, anon;
grant execute on function public.push_registrar(text, text, text, text, text[]) to authenticated;

-- 2. Configuração interna: endereço da Edge Function e senha que só o banco e a função conhecem.
--    Ninguém de fora lê esta tabela (RLS sem políticas).
create table if not exists public.push_config (
  id       integer primary key default 1 check (id = 1),
  url      text not null,
  segredo  text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
);
alter table public.push_config enable row level security;
revoke all on public.push_config from anon, authenticated;
-- Endereço da função "push" no projeto da Prime (omfsonnubkmuuqekeoev).
-- Rodar de novo corrige o endereço (antes vinha o do projeto da tabacaria).
insert into public.push_config (id, url)
values (1, 'https://omfsonnubkmuuqekeoev.supabase.co/functions/v1/push')
on conflict (id) do update set url = excluded.url;

-- 3. Avisa a Edge Function (assíncrono: o pg_net envia depois que a transação termina)
--    ator = quem fez a mudança no CRM; essa pessoa não é notificada da própria ação.
create or replace function public.push_disparar(p_evento text, p_id uuid, p_extra jsonb default '{}')
returns void language plpgsql security definer set search_path = public as $$
declare c public.push_config;
begin
  select * into c from public.push_config where id = 1;
  if c.url is null or not exists (select 1 from public.push_inscricoes) then return; end if;
  perform net.http_post(
    url := c.url,
    body := jsonb_build_object('evento', p_evento, 'id', p_id, 'ator', auth.uid(), 'extra', p_extra),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-segredo', c.segredo),
    timeout_milliseconds := 8000);
exception when others then
  raise warning 'push_disparar: %', sqlerrm;   -- notificação nunca derruba um pedido
end $$;
revoke all on function public.push_disparar(text, uuid, jsonb) from public, anon, authenticated;

-- Pedido novo (site, agente, CRM) e mudança de status
create or replace function public.tg_push_pedidos() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.push_disparar('pedido_novo', new.id);
  elsif new.status is distinct from old.status then
    perform public.push_disparar('pedido_status', new.id, jsonb_build_object('de', old.status, 'para', new.status));
  end if;
  return null;
end $$;
drop trigger if exists t_push_pedidos on public.pedidos;
create trigger t_push_pedidos after insert or update of status on public.pedidos
for each row execute function public.tg_push_pedidos();

-- Mensagem do cliente no WhatsApp
-- (só se o whatsapp.sql já foi rodado; rodou depois? rode este arquivo de novo)
create or replace function public.tg_push_wa() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.direcao = 'entrada' then perform public.push_disparar('wa_entrada', new.id); end if;
  return null;
end $$;
do $$
begin
  if to_regclass('public.wa_mensagens') is not null then
    drop trigger if exists t_push_wa on public.wa_mensagens;
    create trigger t_push_wa after insert on public.wa_mensagens
    for each row execute function public.tg_push_wa();
  else
    raise notice 'wa_mensagens não existe (falta o whatsapp.sql): aviso de conversas fica para depois';
  end if;
end $$;

-- Estoque: avisa quando entra na faixa "repor" (3 ou menos) e quando esgota (0)
-- (a coluna estoque vem do site-pedidos.sql)
create or replace function public.tg_push_estoque() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.estoque is not null and new.estoque <= 3
     and (old.estoque is null or old.estoque > 3 or (new.estoque = 0 and old.estoque > 0)) then
    perform public.push_disparar('estoque', new.id, jsonb_build_object('nome', new.nome, 'estoque', new.estoque));
  end if;
  return null;
end $$;
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'produtos' and column_name = 'estoque') then
    drop trigger if exists t_push_estoque on public.produtos;
    create trigger t_push_estoque after update of estoque on public.produtos
    for each row execute function public.tg_push_estoque();
  else
    raise notice 'produtos.estoque não existe (falta o site-pedidos.sql): aviso de estoque fica para depois';
  end if;
end $$;
