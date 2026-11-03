-- =====================================================================
--  PRIME PERFUMES · ABRIR / FECHAR A LOJA PELO CRM (fora do horário normal)
--  Rode DEPOIS do site-pedidos.sql (Supabase > SQL Editor > Run).
--  Pode rodar de novo: não apaga nada.
--
--  Horário normal: quarta a domingo, 19h às 01h (Brasília).
--  No CRM, o botão da loja (menu lateral) permite:
--    · Abrir agora  → o site aceita pedidos na hora até o horário escolhido;
--    · Fechar agora → o site para de aceitar pedidos na hora até o horário escolhido;
--    · Voltar ao horário normal.
--  Passado o horário escolhido, vale de novo o horário normal sozinho.
--  O site lê esta tabela (só modo e até quando) e atualiza na hora.
-- =====================================================================

create table if not exists public.loja_estado (
  id            int primary key default 1 check (id = 1),         -- uma linha só
  modo          text not null check (modo in ('aberta', 'fechada')),
  ate           timestamptz not null,                             -- até quando vale; depois volta ao horário normal
  atualizado_em timestamptz not null default now()
);

alter table public.loja_estado enable row level security;
drop policy if exists equipe_total on public.loja_estado;
create policy equipe_total on public.loja_estado for all to authenticated using (true) with check (true);
drop policy if exists site_le on public.loja_estado;
create policy site_le on public.loja_estado for select to anon using (true);
grant select on public.loja_estado to anon;
grant select, insert, update, delete on public.loja_estado to authenticated;

-- tempo real: abriu/fechou no CRM, o site muda na hora
do $$ begin
  alter publication supabase_realtime add table public.loja_estado;
exception when duplicate_object then null; when undefined_object then null;
end $$;

-- loja aberta agora? (usada ao gravar o pedido do site: fechada → pedido "fora do horário")
-- 1º o que foi escolhido no CRM (enquanto valer); senão o horário normal.
-- isodow: 1 = segunda … 7 = domingo; a noite de domingo vai até segunda 01h.
create or replace function public.loja_aberta() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select e.modo = 'aberta' from public.loja_estado e where e.id = 1 and e.ate > now()),
    (select (extract(isodow from h) in (3,4,5,6,7) and extract(hour from h) >= 19)
         or (extract(isodow from h) in (4,5,6,7,1) and extract(hour from h) < 1)
       from (select now() at time zone 'America/Sao_Paulo' as h) t)
  )
$$;

notify pgrst, 'reload schema';
