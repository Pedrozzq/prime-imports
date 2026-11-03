-- =====================================================================
--  PRIME PERFUMES · COMPRAS DO MÊS (seção "Compras do mês" do CRM)
--  Rode DEPOIS do schema.sql (Supabase > SQL Editor > Run).
--  Pode rodar de novo: não apaga nada.
--
--  Lista de compras da loja por mês: o que comprar (ou o que já foi comprado),
--  de qual fornecedor, quantidade e valor. Marcar "comprado" guarda a data.
--  Só a equipe logada vê e edita (o site e os visitantes não enxergam).
-- =====================================================================

create table if not exists public.compras (
  id            uuid primary key default gen_random_uuid(),
  mes           date not null check (extract(day from mes) = 1),          -- 1º dia do mês da compra
  produto_id    uuid references public.produtos(id) on delete set null,   -- opcional (item do catálogo)
  item          text not null check (length(trim(item)) > 0),
  fornecedor    text,
  quantidade    numeric(12,2) not null default 1 check (quantidade > 0),
  valor_unit    numeric(12,2) not null default 0 check (valor_unit >= 0),
  status        text not null default 'a_comprar' check (status in ('a_comprar', 'comprado')),
  obs           text,
  criado_por    text,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  comprado_em   timestamptz                                               -- preenchido quando vira "comprado"
);

create index if not exists compras_mes_idx on public.compras (mes, status);

drop trigger if exists t_compras_upd on public.compras;
create trigger t_compras_upd before update on public.compras
for each row execute function public.tg_atualizado_em();

-- data da compra automática
create or replace function public.tg_compra_comprada() returns trigger
language plpgsql as $$
begin
  if new.status = 'comprado' and (tg_op = 'INSERT' or old.status is distinct from 'comprado') then
    new.comprado_em := now();
  elsif new.status <> 'comprado' then
    new.comprado_em := null;
  end if;
  return new;
end $$;

drop trigger if exists t_compras_comprada on public.compras;
create trigger t_compras_comprada before insert or update on public.compras
for each row execute function public.tg_compra_comprada();

alter table public.compras enable row level security;
drop policy if exists equipe_total on public.compras;
create policy equipe_total on public.compras for all to authenticated using (true) with check (true);
revoke all on public.compras from anon;
grant select, insert, update, delete on public.compras to authenticated;

-- tempo real: item adicionado/marcado por um aparece na hora para os outros
do $$ begin
  alter publication supabase_realtime add table public.compras;
exception when duplicate_object then null; when undefined_object then null;
end $$;

notify pgrst, 'reload schema';
