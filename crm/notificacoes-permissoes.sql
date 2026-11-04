-- =====================================================================
--  PRIME PERFUMES · CRM — Permissões da função "push" (notificações)
--  A Edge Function usa o service_role para ler os aparelhos inscritos
--  (push_inscricoes), o segredo (push_config) e os dados do aviso
--  (pedidos, clientes, wa_mensagens, wa_conversas, tarefas).
--  Sem estas permissões ela recebe "permission denied" e não envia nada.
--  Rode uma vez no SQL Editor do Supabase. Pode rodar de novo sem problema.
-- =====================================================================
grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- tabelas criadas no futuro também já nascem liberadas para o service_role
alter default privileges in schema public grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public grant usage, select on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;
