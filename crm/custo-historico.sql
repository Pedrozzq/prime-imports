-- =====================================================================
--  PRIME PERFUMES · CUSTO CONGELADO NO PEDIDO
--  Rode DEPOIS do margem.sql e do site-pedidos.sql (Supabase > SQL Editor > Run).
--  Pode rodar de novo sem problema.
--
--  Cada item de pedido passa a guardar o custo unitário do momento da venda
--  (custo + frete + impostos da aba Margem de lucro). Assim, mudar custo, frete,
--  imposto ou preço de um produto vale só para os PRÓXIMOS pedidos:
--    - faturamento: já usa o total gravado em cada pedido (preço da época);
--    - lucro: passa a usar o custo gravado em cada item (custo da época).
-- =====================================================================

alter table public.pedido_itens add column if not exists custo_unitario numeric(10,2);  -- null = sem custo cadastrado

-- custo atual de 1 unidade: produto simples ou combo/kit (soma dos componentes)
create or replace function public._custo_atual(p_produto uuid, p_comp jsonb) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare v_comp jsonb; k text; v text; t numeric := 0; u numeric;
begin
  v_comp := coalesce(p_comp, (select componentes from public.produtos where id = p_produto));
  if v_comp is not null and jsonb_typeof(v_comp) = 'object' then
    for k, v in select * from jsonb_each_text(v_comp) loop
      select (c.custo + c.frete) * (1 + c.taxa_pct / 100) into u
        from public.produtos p join public.produto_custos c on c.produto_id = p.id
       where p.site_id = k and c.custo is not null
       limit 1;
      if u is null then return null; end if;          -- falta custo de algum item de dentro
      t := t + u * v::numeric;
    end loop;
    return round(t, 2);
  end if;
  select (c.custo + c.frete) * (1 + c.taxa_pct / 100) into u
    from public.produto_custos c where c.produto_id = p_produto and c.custo is not null;
  return round(u, 2);
end $$;
revoke all on function public._custo_atual(uuid, jsonb) from public, anon, authenticated;

-- todo item novo (site, agente ou CRM) grava o custo daquele momento
create or replace function public.tg_item_custo() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.custo_unitario is null then
    new.custo_unitario := public._custo_atual(new.produto_id, new.componentes);
  end if;
  return new;
end $$;

drop trigger if exists t_itens_custo on public.pedido_itens;
create trigger t_itens_custo before insert on public.pedido_itens
for each row execute function public.tg_item_custo();

-- pedidos que já existem: congela com o custo cadastrado HOJE
-- (é o melhor dado disponível; daqui para frente cada venda guarda o seu)
update public.pedido_itens
   set custo_unitario = public._custo_atual(produto_id, componentes)
 where custo_unitario is null;

notify pgrst, 'reload schema';
