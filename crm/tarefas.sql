-- =====================================================================
--  PRIME PERFUMES · TAREFAS (seção "Tarefas" da Visão geral do CRM)
--  Rode DEPOIS do schema.sql (Supabase > SQL Editor > Run).
--  Pode rodar de novo: não apaga nada.
--
--  Lista de tarefas da equipe, com prioridade (alta, média, baixa) e
--  status (a fazer, fazendo, feita), alterados direto na Visão geral.
--  Só a equipe logada vê e edita (o site e os visitantes não enxergam).
-- =====================================================================

create table if not exists public.tarefas (
  id            uuid primary key default gen_random_uuid(),
  titulo        text not null check (length(trim(titulo)) > 0),
  descricao     text,
  prioridade    text not null default 'media'   check (prioridade in ('alta', 'media', 'baixa')),
  status        text not null default 'a_fazer' check (status in ('a_fazer', 'fazendo', 'feita')),
  prazo         date,                                     -- opcional
  responsavel   text,                                     -- nome de quem vai fazer (opcional)
  criado_por    text,                                     -- nome de quem criou no CRM
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  concluida_em  timestamptz                               -- preenchido quando vira "feita"
);

create index if not exists tarefas_status_idx on public.tarefas (status, prioridade);

drop trigger if exists t_tarefas_upd on public.tarefas;
create trigger t_tarefas_upd before update on public.tarefas
for each row execute function public.tg_atualizado_em();

-- data de conclusão automática
create or replace function public.tg_tarefa_concluida() returns trigger
language plpgsql as $$
begin
  if new.status = 'feita' and (tg_op = 'INSERT' or old.status is distinct from 'feita') then
    new.concluida_em := now();
  elsif new.status <> 'feita' then
    new.concluida_em := null;
  end if;
  return new;
end $$;

drop trigger if exists t_tarefas_concluida on public.tarefas;
create trigger t_tarefas_concluida before insert or update on public.tarefas
for each row execute function public.tg_tarefa_concluida();

alter table public.tarefas enable row level security;
drop policy if exists equipe_total on public.tarefas;
create policy equipe_total on public.tarefas for all to authenticated using (true) with check (true);
revoke all on public.tarefas from anon;
grant select, insert, update, delete on public.tarefas to authenticated;

-- tempo real: tarefa criada/alterada por um aparece na hora para os outros
do $$ begin
  alter publication supabase_realtime add table public.tarefas;
exception when duplicate_object then null; when undefined_object then null;
end $$;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- Notificação no celular quando alguém cria uma tarefa (usa o notificacoes.sql).
-- Vai para TODOS os aparelhos inscritos, inclusive os de quem criou (assim o
-- celular avisa mesmo quando a tarefa foi criada no computador com o mesmo login).
-- Se o notificacoes.sql ainda não foi rodado, este trecho só avisa e segue;
-- rode este arquivo de novo depois.
-- ---------------------------------------------------------------------
create or replace function public.tg_push_tarefa() returns trigger
language plpgsql security definer set search_path = public as $$
declare c public.push_config;
begin
  select * into c from public.push_config where id = 1;
  if c.url is null or not exists (select 1 from public.push_inscricoes where 'tarefas' = any(tipos)) then return null; end if;
  perform net.http_post(
    url := c.url,
    body := jsonb_build_object('evento', 'tarefa_nova', 'id', new.id, 'ator', null, 'extra', '{}'::jsonb),  -- ator nulo: ninguém fica de fora
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-segredo', c.segredo),
    timeout_milliseconds := 8000);
  return null;
exception when others then
  raise warning 'tg_push_tarefa: %', sqlerrm;   -- notificação nunca impede de salvar a tarefa
  return null;
end $$;

do $$
begin
  if to_regclass('public.push_config') is not null then
    drop trigger if exists t_push_tarefa on public.tarefas;
    create trigger t_push_tarefa after insert on public.tarefas
    for each row execute function public.tg_push_tarefa();
    -- aparelhos já inscritos passam a receber "Tarefas novas" (dá para desligar em Ativar notificações)
    update public.push_inscricoes set tipos = array_append(tipos, 'tarefas') where not ('tarefas' = any(tipos));
    alter table public.push_inscricoes alter column tipos set default '{pedidos,whatsapp,atualizacoes,tarefas}';
  else
    raise notice 'push_config não existe (falta o notificacoes.sql): aviso de tarefas no celular fica para depois';
  end if;
end $$;
