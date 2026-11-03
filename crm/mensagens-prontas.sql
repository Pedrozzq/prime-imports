-- =====================================================================
--  PRIME PERFUMES · MENSAGENS PRONTAS (aba "Mensagens prontas" do CRM)
--  Rode DEPOIS do schema.sql (Supabase > SQL Editor > Run).
--  Pode rodar de novo: não apaga nada.
--
--  Guarda os textos editados e criados no CRM. Os textos padrão ficam no
--  index.html; uma linha aqui com o mesmo id (ola, confirmado, saiu, retirada,
--  entregue, avaliar, pagamento) substitui o padrão, e ativo = false esconde.
--  No texto, {nome}, {pedido}, {itens}, {valores}... viram os dados do pedido.
-- =====================================================================

create table if not exists public.mensagens_prontas (
  id            text primary key,
  titulo        text not null,
  texto         text not null,
  uso           text not null default 'sempre' check (uso in ('sempre', 'pedido', 'sem_pedido')),
  entrega       text not null default 'todas'  check (entrega in ('todas', 'entrega', 'retirada')),
  status        text,                                   -- etapa que o CRM oferece mudar junto (ex.: saiu_entrega)
  ordem         int  not null default 0,
  ativo         boolean not null default true,
  atualizado_em timestamptz not null default now()
);

drop trigger if exists t_msgs_upd on public.mensagens_prontas;
create trigger t_msgs_upd before update on public.mensagens_prontas
for each row execute function public.tg_atualizado_em();

alter table public.mensagens_prontas enable row level security;
drop policy if exists equipe_total on public.mensagens_prontas;
create policy equipe_total on public.mensagens_prontas for all to authenticated using (true) with check (true);
revoke all on public.mensagens_prontas from anon;
grant select, insert, update, delete on public.mensagens_prontas to authenticated;
