-- =====================================================================
--  PRIME PERFUMES · CRM
--  Atendimento: qual funcionário aceitou o pedido ("visto") e está cuidando dele
--  Rode DEPOIS do schema.sql e do site-pedidos.sql:
--  Supabase > SQL Editor > New query > cole tudo > Run (pode rodar mais de uma vez)
-- =====================================================================

-- 1. Funcionários = os logins do CRM (Authentication > Users), com um nome para aparecer nos pedidos.
--    O CRM não consegue ler auth.users, por isso o nome fica nesta tabela.
create table if not exists public.funcionarios (
  id        uuid primary key references auth.users(id) on delete cascade,
  nome      text not null,
  email     text,
  criado_em timestamptz not null default now()
);
alter table public.funcionarios enable row level security;
drop policy if exists equipe_le on public.funcionarios;
create policy equipe_le on public.funcionarios for select to authenticated using (true);
-- cada um só muda o próprio nome (pela função funcionario_definir_nome)

-- nome inicial: o "name" do cadastro, senão a parte do e-mail antes do @ (ex.: pedro@… → Pedro)
create or replace function public._nome_inicial(p_email text, p_meta jsonb) returns text
language sql immutable as $$
  select coalesce(nullif(trim(p_meta->>'name'), ''), nullif(trim(p_meta->>'nome'), ''),
                  initcap(split_part(coalesce(p_email, 'Funcionário'), '@', 1)))
$$;

-- os usuários que já existem (os 2 de hoje) viram funcionários
insert into public.funcionarios (id, nome, email)
select u.id, public._nome_inicial(u.email, u.raw_user_meta_data), u.email from auth.users u
on conflict (id) do update set email = excluded.email;

-- login novo criado depois também vira funcionário automaticamente
create or replace function public._novo_funcionario() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.funcionarios (id, nome, email)
  values (new.id, public._nome_inicial(new.email, new.raw_user_meta_data), new.email)
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists trg_novo_funcionario on auth.users;
create trigger trg_novo_funcionario after insert on auth.users
  for each row execute function public._novo_funcionario();

-- trocar o próprio nome (no CRM: clicar no nome, embaixo do menu)
create or replace function public.funcionario_definir_nome(p_nome text) returns public.funcionarios
language plpgsql security definer set search_path = public as $$
declare r public.funcionarios;
begin
  if auth.uid() is null then raise exception 'Faça login no CRM'; end if;
  if coalesce(trim(p_nome), '') = '' then raise exception 'Digite um nome'; end if;
  insert into public.funcionarios (id, nome, email)
  values (auth.uid(), trim(p_nome), (select email from auth.users where id = auth.uid()))
  on conflict (id) do update set nome = trim(p_nome)
  returning * into r;
  return r;
end $$;

-- 2. Responsável pelo pedido
alter table public.pedidos add column if not exists aceito_por uuid references public.funcionarios(id) on delete set null;
alter table public.pedidos add column if not exists aceito_em  timestamptz;
create index if not exists pedidos_aceito_por_idx on public.pedidos (aceito_por);

-- Quem tira o pedido de "Novo" (ex.: muda para "Saiu p/ entrega") sem ter aceitado antes
-- vira o responsável automaticamente, para nenhum pedido andar sem dono.
create or replace function public._pedido_auto_aceite() returns trigger
language plpgsql as $$
begin
  if new.aceito_por is null and auth.uid() is not null
     and new.status is distinct from old.status
     and new.status not in ('novo', 'fora_horario', 'cancelado')
     and exists (select 1 from public.funcionarios where id = auth.uid()) then
    new.aceito_por := auth.uid();
    new.aceito_em  := now();
  end if;
  return new;
end $$;
drop trigger if exists trg_pedido_auto_aceite on public.pedidos;
create trigger trg_pedido_auto_aceite before update on public.pedidos
  for each row execute function public._pedido_auto_aceite();

-- 3. Aceitar / assumir / liberar um pedido
--    Aceitar só funciona se ninguém aceitou ainda (dois funcionários clicando juntos: só o
--    primeiro fica). Para pegar um pedido que já é de outro, use p_assumir = true.
create or replace function public.pedido_aceitar(p_id uuid, p_assumir boolean default false)
returns public.pedidos
language plpgsql security definer set search_path = public as $$
declare r public.pedidos; dono text;
begin
  if auth.uid() is null then raise exception 'Faça login no CRM'; end if;
  if not exists (select 1 from public.funcionarios where id = auth.uid()) then
    insert into public.funcionarios (id, nome, email)
    select u.id, public._nome_inicial(u.email, u.raw_user_meta_data), u.email from auth.users u where u.id = auth.uid()
    on conflict (id) do nothing;
  end if;

  update public.pedidos set aceito_por = auth.uid(), aceito_em = now()
   where id = p_id and (aceito_por is null or p_assumir)
  returning * into r;

  if r.id is null then
    select f.nome into dono from public.pedidos p join public.funcionarios f on f.id = p.aceito_por where p.id = p_id;
    if dono is null then raise exception 'Pedido não encontrado'; end if;
    raise exception 'Este pedido já foi aceito por %', dono;
  end if;
  return r;
end $$;

-- devolver o pedido para a fila (só quem é o responsável)
create or replace function public.pedido_liberar(p_id uuid) returns public.pedidos
language plpgsql security definer set search_path = public as $$
declare r public.pedidos;
begin
  if auth.uid() is null then raise exception 'Faça login no CRM'; end if;
  update public.pedidos set aceito_por = null, aceito_em = null
   where id = p_id and aceito_por = auth.uid()
  returning * into r;
  if r.id is null then raise exception 'Só quem aceitou o pedido pode devolver para a fila'; end if;
  return r;
end $$;

revoke all on function public.pedido_aceitar(uuid, boolean), public.pedido_liberar(uuid), public.funcionario_definir_nome(text) from public, anon;
grant execute on function public.pedido_aceitar(uuid, boolean), public.pedido_liberar(uuid), public.funcionario_definir_nome(text) to authenticated;

-- confira: os funcionários e o nome que vai aparecer nos pedidos
select nome, email from public.funcionarios order by criado_em;
