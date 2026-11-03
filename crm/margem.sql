-- =====================================================================
--  PRIME PERFUMES · MARGEM DE LUCRO (aba "Margem de lucro" do CRM)
--  Rode DEPOIS do schema.sql e do site-pedidos.sql (Supabase > SQL Editor > Run).
--  Pode rodar de novo: não apaga nada e não sobrescreve custos já editados no CRM.
--
--  O custo fica numa tabela SEPARADA de produtos de propósito: a tabela produtos é
--  pública (vitrine do site, policy vitrine_publica), então qualquer coluna nela
--  poderia ser lida por visitantes. produto_custos só é visível para a equipe logada.
-- =====================================================================

create table if not exists public.produto_custos (
  produto_id    uuid primary key references public.produtos(id) on delete cascade,
  custo         numeric(10,2) check (custo >= 0),                       -- custo unitário (vazio = não informado)
  frete         numeric(10,2) not null default 0 check (frete >= 0),
  taxa_pct      numeric(6,2)  not null default 0 check (taxa_pct >= 0),  -- impostos/taxas (%) sobre custo + frete
  fornecedor    text,                                                   -- nome ou link
  atualizado_em timestamptz not null default now()
);

drop trigger if exists t_custos_upd on public.produto_custos;
create trigger t_custos_upd before update on public.produto_custos
for each row execute function public.tg_atualizado_em();

alter table public.produto_custos enable row level security;
drop policy if exists equipe_total on public.produto_custos;
create policy equipe_total on public.produto_custos for all to authenticated using (true) with check (true);
revoke all on public.produto_custos from anon;
grant select, insert, update, delete on public.produto_custos to authenticated;

-- ---------------------------------------------------------------------
-- Custos da planilha "Prime Perfumes - Por Secoes" para os produtos que já estão no site
-- (os produtos do site entram no CRM sozinhos ao fazer login; se algum ainda não existir,
--  abra o CRM uma vez e rode este arquivo de novo)
-- ---------------------------------------------------------------------
insert into public.produto_custos (produto_id, custo, fornecedor)
select p.id, v.custo, v.fornecedor
  from (values
    ('seda-king',             0.90::numeric, null::text),
    ('seda-elements',         3.96, null),
    ('piteira-squadafum',     2.75, null),
    ('piteira-cremaria',      1.61, null),
    ('piteira-tonabe',        3.20, null),
    ('yanking-un',            0.90, null),
    ('porto-faria-un',        1.05, null),
    ('isqueiro-max',          0.84, null),
    ('bic',                   4.50, 'https://fumotopiadistribuidora.com.br/produtos/isqueiro-bic-grande-cartela/'),
    ('clipper-caveira',       3.68, null),
    ('dichavador-amsterdam', 27.90, null),
    ('dichavador-gold',      35.00, null),   -- caixa c/6 por R$ 210,00 (lista de compras da planilha)
    ('dichavador-cubo-magico',27.27, null),
    ('cinzeiro-neon',        19.00, null),   -- "Cinzeiro" da planilha
    ('dichavador-bem-bolado', 8.41, 'https://fumotopiadistribuidora.com.br/produtos/display-c-7-triturador-bem-bolado-pequeno-4cm-policarbonato-preto-11ngk/'),
    ('vinho-merlot',         21.67, null)
  ) v(site_id, custo, fornecedor)
  join public.produtos p on p.site_id = v.site_id
on conflict (produto_id) do nothing;

-- Produtos da planilha que não estão no site: entram só no CRM, INATIVOS
-- (não aparecem no site nem para o agente até alguém ativar em Produtos)
with planilha(nome, categoria, custo, preco, fornecedor) as (values
    ('Tabaco Tonabê Mandupi',           'Tabacos',       7.78::numeric, 24.90::numeric, null::text),
    ('Tabaco Parvathi',                 'Tabacos',      10.83, 29.90, null),
    ('Tabaco Acrema Blend',             'Tabacos',      11.00, 27.90, null),
    ('Maçarico Moon Recarregável',      'Isqueiros',     9.10, 24.90, 'https://fumotopiadistribuidora.com.br/produtos/macarico-moon-recarregavel-unidade-hp-k100-mh174/'),
    ('Charuto Quorum Maduro Churchill', 'Cigarros',     37.70, 89.90, null),
    ('Cigarro Malboro Gold',            'Cigarros',      null,  0.00, null),
    ('Vinho do Sol - Jorge',            'Conveniência', 30.00, 64.90, null),
    ('Incenso',                         'Outros',        0.90,  4.90, null),
    ('Avaliação Google',                'Outros',       17.75, 59.90, null),
    ('Cuia',                            'Outros',        7.50, 17.90, null)
), novos as (
  insert into public.produtos (nome, categoria, preco, ativo)
  select pl.nome, pl.categoria, pl.preco, false from planilha pl
   where not exists (select 1 from public.produtos p where lower(p.nome) = lower(pl.nome))
  returning id, nome
)
insert into public.produto_custos (produto_id, custo, fornecedor)
select n.id, pl.custo, pl.fornecedor from novos n join planilha pl on pl.nome = n.nome
on conflict (produto_id) do nothing;

-- a API do Supabase passa a enxergar a tabela nova na hora (sem isso o CRM pode
-- mostrar "Could not find the table 'public.produto_custos' in the schema cache")
-- Produto excluído no CRM (Margem de lucro → Excluir): sai do CRM e do site (fica inativo),
-- mas continua no banco para o histórico dos pedidos e não volta na sincronização com o produtos.js
alter table public.produtos add column if not exists excluido boolean not null default false;

notify pgrst, 'reload schema';
