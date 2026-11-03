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
