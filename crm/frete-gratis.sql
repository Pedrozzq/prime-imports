-- =====================================================================
--  PRIME PERFUMES · CRM
--  Frete grátis acima de R$ 35 decidido pelo SERVIDOR (pedidos do site).
--
--  Antes, o frete era calculado no navegador do cliente, com os preços que o site tinha
--  carregado, e o banco só gravava o valor recebido. Como o banco recalcula o subtotal com
--  os preços dele (CRM, oferta relâmpago, combos), os dois podiam discordar: o site achava
--  que o pedido estava abaixo de R$ 35 e mandava R$ 9,90 de frete, e no CRM o subtotal
--  ficava acima de R$ 35, com o frete cobrado.
--
--  Agora, sempre que o subtotal de um pedido do site muda (os itens entram um a um), o frete
--  é refeito: subtotal >= R$ 35 → grátis; abaixo → R$ 9,90.
--  Rode DEPOIS do site-pedidos.sql (Supabase > SQL Editor > Run). Pode rodar mais de uma vez.
-- =====================================================================

create or replace function public.tg_pedido_frete_site() returns trigger
language plpgsql as $$
begin
  if new.origem = 'site' and new.tipo_entrega = 'entrega'
     and new.subtotal is distinct from old.subtotal and coalesce(new.subtotal, 0) > 0 then
    new.taxa_entrega := case when new.subtotal >= 35 then 0 else 9.90 end;
  end if;
  return new;
end $$;

-- o nome começa com "t_pedidos_frete" para rodar ANTES do t_pedidos_total (ordem alfabética),
-- assim o total já sai com o frete certo
drop trigger if exists t_pedidos_frete on public.pedidos;
create trigger t_pedidos_frete before update on public.pedidos
for each row execute function public.tg_pedido_frete_site();

-- Corrige os pedidos do site que já foram gravados com frete indevido (subtotal >= R$ 35)
update public.pedidos
   set taxa_entrega = 0
 where origem = 'site' and subtotal >= 35 and taxa_entrega > 0
   and status <> 'cancelado';
