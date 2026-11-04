-- =====================================================================
--  PRIME PERFUMES · CRM
--  Pedido "Aguardando pagamento" assim que o cliente vai para o Mercado Pago
--  Rode DEPOIS do perfumaria.sql: Supabase > SQL Editor > New query > cole tudo > Run
--  (pode rodar mais de uma vez sem problema)
--
--  Como fica:
--    1. O cliente clica em pagar no site → api/create-preference.js cadastra o cliente e cria
--       o pedido como "Aguardando pagamento" (pagamento_status = 'checkout': foi para o
--       Mercado Pago e ainda não pagou nada). Não baixa estoque.
--    2. O Mercado Pago avisa (api/mp-webhook.js) e o cliente volta (api/confirm-order.js):
--       o MESMO pedido (pela referência PRIME-…) vira "Pagamento aprovado" (baixa o estoque),
--       segue aguardando (Pix/boleto em aberto) ou "Pagamento recusado".
--    3. Se o cliente voltar para a loja e abrir um checkout novo, o checkout anterior que não
--       foi pago (nenhuma tentativa de pagamento) é apagado: não fica pedido repetido.
-- =====================================================================

-- p_dados = {ref, pagamento_id, pagamento_status, metodo, parcelas,
--            cliente:{nome, telefone, email}, entrega:{cep, rua, numero, complemento, bairro, cidade, uf},
--            itens:[{id, nome, marca, quantidade, preco}], desconto, frete, cupom, observacoes}
--   ref           = referência do checkout (PRIME-…); nos pedidos antigos, o nº do pagamento
--   pagamento_id  = nº do pagamento no Mercado Pago (acha também os pedidos gravados antes desta versão)
--   pagamento_status: 'checkout' (foi para o Mercado Pago) ou o status do Mercado Pago
create or replace function public.loja_registrar_pedido(p_chave text, p_dados jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ref text := nullif(trim(p_dados->>'ref'), '');
  v_mp  text := nullif(regexp_replace(coalesce(p_dados->>'pagamento_id', ''), '\D', '', 'g'), '');
  v_pst text := lower(coalesce(nullif(p_dados->>'pagamento_status', ''), 'pending'));
  v_checkout boolean; v_ok boolean; v_recusa boolean; v_estorno boolean; v_novo_st text;
  v_pid uuid; v_num int; v_st text; v_pst_atual text; v_obs text; v_cli uuid; v_total numeric; v_forma text;
  v_tel text; v_end text; v_cid text; v_ent jsonb := coalesce(p_dados->'entrega', '{}'::jsonb); v_item jsonb; v_prod record;
begin
  perform public._agente_validar(p_chave);
  if v_ref is null then v_ref := v_mp; end if;
  if v_ref is null then raise exception 'pagamento sem referência'; end if;
  v_checkout := v_pst = 'checkout';
  v_ok      := v_pst in ('approved', 'authorized');
  v_recusa  := v_pst in ('rejected', 'cancelled');          -- não pagou (cartão recusado, Pix/boleto vencido)
  v_estorno := v_pst in ('refunded', 'charged_back');       -- pagou e o dinheiro voltou
  v_novo_st := case when v_ok then 'novo' when v_recusa then 'recusado' when v_estorno then 'cancelado' else 'aguardando_pagamento' end;
  v_forma := case lower(coalesce(p_dados->>'metodo', ''))
               when 'pix' then 'pix' when 'bank_transfer' then 'pix'
               when 'credit_card' then 'cartao_credito' when 'debit_card' then 'cartao_debito' else null end;
  perform pg_advisory_xact_lock(hashtext('loja_pedido:' || v_ref));

  -- já registrado (pela referência do checkout ou pelo nº do pagamento): só acompanha o pagamento
  select id, numero, pagamento_status, observacoes into v_pid, v_num, v_pst_atual, v_obs
    from public.pedidos where pagamento_ref = v_ref or (v_mp is not null and pagamento_ref = v_mp)
   order by (pagamento_ref = v_ref) desc limit 1;
  if found then
    if v_checkout then   -- o mesmo checkout aberto de novo: nada muda
      select status, total into v_st, v_total from public.pedidos where id = v_pid;
      return jsonb_build_object('ok', true, 'pedido_id', v_pid, 'numero', v_num, 'status', v_st, 'total', v_total, 'novo', false);
    end if;
    -- várias tentativas no mesmo checkout (cartão recusado e depois Pix, por exemplo):
    -- uma tentativa recusada ou pendente nunca desfaz um pagamento já aprovado; só o estorno cancela.
    update public.pedidos set
           pagamento_status = case when v_pst_atual in ('approved', 'authorized') and not v_estorno then v_pst_atual else v_pst end,
           status = case
             when v_ok and status in ('aguardando_pagamento', 'recusado') then 'novo'
             when v_recusa and status = 'aguardando_pagamento' then 'recusado'
             when (v_pst in ('pending', 'in_process', 'authorized') and not v_ok) and status = 'recusado' then 'aguardando_pagamento'
             when v_estorno and status in ('novo', 'confirmado', 'em_preparo', 'saiu_entrega', 'entregue') then 'cancelado'
             else status end,
           forma_pagamento = case when v_forma is not null and (v_ok or v_pst_atual is null or v_pst_atual not in ('approved', 'authorized'))
                                  then v_forma else forma_pagamento end,
           observacoes = case when v_ok and v_mp is not null and position(v_mp in coalesce(observacoes, '')) = 0
                              then concat_ws(' · ', nullif(observacoes, ''), 'pagamento #' || v_mp ||
                                   case when coalesce(nullif(p_dados->>'parcelas', '')::int, 1) > 1 then ' em ' || (p_dados->>'parcelas') || 'x no cartão' else '' end)
                              else observacoes end
     where id = v_pid
     returning status, total into v_st, v_total;
    return jsonb_build_object('ok', true, 'pedido_id', v_pid, 'numero', v_num, 'status', v_st, 'total', v_total, 'novo', false);
  end if;

  if jsonb_typeof(p_dados->'itens') is distinct from 'array' or jsonb_array_length(p_dados->'itens') = 0 then
    raise exception 'pedido sem itens';
  end if;

  v_tel := public._fone(p_dados->'cliente'->>'telefone');
  if v_tel is null then    -- sem telefone: ficha pelo nº do pagamento (ou da referência)
    v_tel := 'mp' || coalesce(v_mp, nullif(regexp_replace(v_ref, '\W', '', 'g'), ''), md5(v_ref));
  end if;
  v_end := nullif(concat_ws(', ', nullif(v_ent->>'rua', ''), nullif(v_ent->>'numero', ''), nullif(v_ent->>'complemento', '')), '');
  v_cid := nullif(concat_ws(' - ', nullif(v_ent->>'cidade', ''), nullif(v_ent->>'uf', '')), '');

  insert into public.clientes as c (nome, telefone, email, endereco, bairro, cidade, origem)
  values (coalesce(nullif(trim(p_dados->'cliente'->>'nome'), ''), 'Cliente do site'), v_tel,
          nullif(trim(p_dados->'cliente'->>'email'), ''), v_end, nullif(v_ent->>'bairro', ''), v_cid, 'site')
  on conflict (telefone) do update set
    nome     = case when excluded.nome = 'Cliente do site' then c.nome else excluded.nome end,
    email    = coalesce(excluded.email, c.email),
    endereco = coalesce(excluded.endereco, c.endereco),
    bairro   = coalesce(excluded.bairro, c.bairro),
    cidade   = coalesce(excluded.cidade, c.cidade)
  returning id into v_cli;

  -- checkout novo do mesmo cliente: o anterior que nem chegou a ter tentativa de pagamento sai
  if v_checkout then
    delete from public.pedidos
     where cliente_id = v_cli and origem = 'site' and status = 'aguardando_pagamento' and pagamento_status = 'checkout';
  end if;

  insert into public.pedidos (cliente_id, status, tipo_entrega, endereco_entrega, forma_pagamento, taxa_entrega, desconto,
                              observacoes, origem, pagamento_ref, pagamento_status, cupom)
  values (v_cli, v_novo_st, 'entrega',
          nullif(concat_ws(' · ', v_end, nullif(v_ent->>'bairro', ''), v_cid,
                 case when nullif(v_ent->>'cep', '') is not null then 'CEP ' || (v_ent->>'cep') end), ''),
          v_forma,
          greatest(coalesce(nullif(p_dados->>'frete', '')::numeric, 0), 0),
          greatest(coalesce(nullif(p_dados->>'desconto', '')::numeric, 0), 0),
          concat_ws(' · ', 'Mercado Pago ' || v_ref,
                 case when v_mp is not null and v_mp <> v_ref then 'pagamento #' || v_mp end,
                 case when coalesce(nullif(p_dados->>'parcelas', '')::int, 1) > 1 then (p_dados->>'parcelas') || 'x no cartão' end,
                 case when nullif(p_dados->>'cupom', '') is not null then 'cupom ' || upper(p_dados->>'cupom') end,
                 nullif(p_dados->>'observacoes', '')),
          'site', v_ref, v_pst, nullif(upper(trim(coalesce(p_dados->>'cupom', ''))), ''))
  returning id, numero into v_pid, v_num;

  for v_item in select * from jsonb_array_elements(p_dados->'itens') loop
    select id, nome, categoria into v_prod from public.produtos where site_id = v_item->>'id';
    insert into public.pedido_itens (pedido_id, produto_id, produto, categoria, quantidade, preco_unitario)
    values (v_pid, v_prod.id,
            coalesce(v_prod.nome, nullif(v_item->>'nome', ''), v_item->>'id'),
            coalesce(v_prod.categoria, nullif(v_item->>'marca', '')),
            greatest(coalesce(nullif(v_item->>'quantidade', '')::int, 1), 1),
            greatest(coalesce(nullif(v_item->>'preco', '')::numeric, 0), 0));
  end loop;

  select status, total into v_st, v_total from public.pedidos where id = v_pid;
  return jsonb_build_object('ok', true, 'pedido_id', v_pid, 'numero', v_num, 'status', v_st, 'total', v_total, 'novo', true);
end $$;
revoke all on function public.loja_registrar_pedido(text, jsonb) from public;
grant execute on function public.loja_registrar_pedido(text, jsonb) to anon, authenticated;

-- Cupom: checkout aberto e não pago (pagamento_status = 'checkout') não gasta o cupom,
-- senão quem desiste no Mercado Pago e volta depois ouviria "Você já usou este cupom".
create or replace function public.loja_cupom(p_codigo text, p_telefone text default null, p_ignorar_limites boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c public.cupons; v_cod text := upper(trim(coalesce(p_codigo, ''))); v_usos int; v_tel text := public._fone(p_telefone);
begin
  select * into c from public.cupons where codigo = v_cod;
  if not found or not c.ativo then return jsonb_build_object('ok', false, 'motivo', 'Cupom inválido ou expirado.'); end if;
  if not p_ignorar_limites then
    if c.inicio is not null and now() < c.inicio then return jsonb_build_object('ok', false, 'motivo', 'Este cupom ainda não começou a valer.'); end if;
    if c.fim is not null and now() >= c.fim then return jsonb_build_object('ok', false, 'motivo', 'Cupom inválido ou expirado.'); end if;
    if c.limite_usos is not null then
      select count(*) into v_usos from public.pedidos
       where cupom = v_cod and status <> 'cancelado' and coalesce(pagamento_status, '') <> 'checkout';
      if v_usos >= c.limite_usos then return jsonb_build_object('ok', false, 'motivo', 'Este cupom já esgotou.'); end if;
    end if;
    if c.um_por_cliente and v_tel is not null and exists (
         select 1 from public.pedidos p join public.clientes cl on cl.id = p.cliente_id
          where p.cupom = v_cod and p.status <> 'cancelado' and coalesce(p.pagamento_status, '') <> 'checkout' and cl.telefone = v_tel) then
      return jsonb_build_object('ok', false, 'motivo', 'Você já usou este cupom.');
    end if;
  end if;
  return jsonb_build_object('ok', true, 'codigo', c.codigo, 'tipo', c.tipo, 'valor', c.valor, 'minimo', c.minimo,
                            'teto', c.teto, 'rotulo', coalesce(nullif(c.rotulo, ''), c.codigo));
end $$;
revoke all on function public.loja_cupom(text, text, boolean) from public;
grant execute on function public.loja_cupom(text, text, boolean) to anon, authenticated;
