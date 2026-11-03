-- =====================================================================
--  PRIME PERFUMES · CRM
--  Entrega agendada: com a loja fechada, o cliente escolhe no site a faixa de horário (só para o
--  MESMO DIA, dentro do horário da Prime) e só então o pedido é gravado no CRM.
--  Rode DEPOIS do site-pedidos.sql:
--  Supabase > SQL Editor > New query > cole tudo > Run (pode rodar mais de uma vez)
-- =====================================================================

-- 1. Quando o cliente quer receber (início da faixa de 1 hora, ex.: sexta 20:00 = "20h às 21h")
alter table public.pedidos add column if not exists agendado_para timestamptz;
create index if not exists pedidos_agendado_para_idx on public.pedidos (agendado_para) where agendado_para is not null;

-- 2. O horário escolhido está dentro do funcionamento? (quarta a domingo, 19h à 01h, Brasília;
--    a noite de domingo vai até segunda 01h). Faixas de hora cheia: 19h, 20h … 00h.
create or replace function public._horario_entrega_valido(t timestamptz) returns boolean
language sql immutable as $$
  select extract(minute from h) = 0 and extract(second from h) = 0
     and ((extract(isodow from h) in (3,4,5,6,7) and extract(hour from h) between 19 and 23)
       or (extract(isodow from h) in (4,5,6,7,1) and extract(hour from h) = 0))
    from (select t at time zone 'America/Sao_Paulo' as h) x
$$;

-- 3. Pedido agendado pelo site: valida o horário, grava o pedido (a mesma função do pedido
--    normal, com estoque, cliente e anti-spam) e guarda o agendamento.
--    Com a loja fechada o pedido entra como "Fora do horário" (não baixa estoque); a equipe muda
--    para "Novo" quando for atender. Se para o servidor a loja estiver aberta, vira pedido normal.
create or replace function public.site_agendar_pedido(p_dados jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_quando timestamptz;
  r jsonb;
begin
  begin
    v_quando := nullif(p_dados->>'agendado_para', '')::timestamptz;
  exception when others then
    raise exception 'escolha um horário de entrega válido';
  end;
  -- só para o MESMO DIA: a noite de funcionamento escolhida tem de ser a de hoje (Brasília).
  -- A faixa das 00h é da madrugada seguinte, por isso "menos 1 hora" antes de pegar a data.
  if v_quando is null or v_quando <= now()
     or not public._horario_entrega_valido(v_quando)
     or ((v_quando at time zone 'America/Sao_Paulo') - interval '1 hour')::date
        <> (now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'escolha um horário de entrega válido';
  end if;

  r := public.site_registrar_pedido(p_dados);

  if coalesce((r->>'fora_horario')::boolean, false) then
    update public.pedidos
       set agendado_para = v_quando,
           observacoes = concat_ws(' · ',
             'Entrega agendada: ' || to_char(v_quando at time zone 'America/Sao_Paulo', 'DD/MM "às" HH24"h"'),
             observacoes)
     where numero = (r->>'numero')::int;
    r := r || jsonb_build_object('agendado_para', v_quando);
  end if;
  return r;
end $$;

revoke all on function public.site_agendar_pedido(jsonb) from public;
grant execute on function public.site_agendar_pedido(jsonb) to anon, authenticated;
