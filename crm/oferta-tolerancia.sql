-- =====================================================================
--  PRIME PERFUMES · CRM
--  Oferta relâmpago: tolerância de 2 minutos depois do fim.
--
--  Se o cliente montou o carrinho com o preço da oferta e o pedido chega ao banco logo
--  depois que ela acabou (ex.: clicou em "Enviar" nos últimos segundos), o pedido ainda sai
--  com o preço da oferta, que é o que ele viu na tela. Vale só por 2 minutos depois do fim
--  e só para o item que o site mandou com o preço da oferta (quem viu o preço normal paga
--  o normal). Depois disso, preço normal.
--  Rode DEPOIS do site-pedidos.sql e do kit-mensal.sql (Supabase > SQL Editor > Run).
--  Pode rodar mais de uma vez.
-- =====================================================================

-- preço de oferta para um item do pedido: a oferta no ar ou, até 2 minutos depois do fim,
-- a oferta cujo preço o cliente viu (p_visto = preço que o site mandou no item)
create or replace function public._preco_oferta(p_site_id text, p_visto numeric) returns numeric
language sql stable security definer set search_path = public as $$
  select min(i.preco_oferta)
    from public.oferta_itens i join public.ofertas o on o.id = i.oferta_id
   where i.site_id = p_site_id and o.ativo and now() >= o.inicio
     and (now() < o.fim
          or (now() < o.fim + interval '2 minutes' and p_visto is not null and p_visto <= i.preco_oferta))
$$;
revoke all on function public._preco_oferta(text, numeric) from public, anon, authenticated;

-- Item do pedido do site → produto do catálogo (mesma função do kit-mensal.sql, agora com a tolerância)
create or replace function public._site_item(p_item jsonb)
returns table (id uuid, site_id text, nome text, categoria text, preco numeric, componentes jsonb)
language plpgsql stable security definer set search_path = public as $$
declare k public.kit_meses; c public.kit_config;
begin
  if p_item->>'id' = 'kit-mensal' then
    select * into c from public.kit_config where kit_config.id = 1;
    k := public._kit_vigente();
    if c.id is null or not c.ativo or k.mes is null then raise exception 'o Kit Prime do Mês não está disponível agora'; end if;
    return query
      select null::uuid, null::text,
             'Kit Prime do Mês ' || to_char(public._kit_mes_atual(), 'MM/YYYY') || ' (' ||
               concat_ws(' + ', (select x.nome from public.produtos x where x.site_id = k.seda),
                                (select x.nome from public.produtos x where x.site_id = k.piteira),
                                (select x.nome from public.produtos x where x.site_id = k.isqueiro) || ' personalizado') || ')',
             'Kit do Mês'::text, c.preco, jsonb_build_object(k.seda, 1, k.piteira, 1, k.isqueiro, 1);
    return;
  end if;
  return query
    select p.id, p.site_id, p.nome, p.categoria,
           coalesce(public._preco_oferta(p.site_id, nullif(p_item->>'preco_unitario', '')::numeric), p.preco),
           p.componentes
      from public.produtos p
     where p.ativo and (p.site_id = p_item->>'id' or lower(p.nome) = lower(trim(p_item->>'produto')))
     order by (p.site_id = p_item->>'id') desc nulls last
     limit 1;
  if not found then
    return query select null::uuid, null::text, null::text, null::text, null::numeric, null::jsonb;
  end if;
end $$;
revoke all on function public._site_item(jsonb) from public, anon, authenticated;
