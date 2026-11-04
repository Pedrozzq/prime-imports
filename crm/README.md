# Prime Perfumes · CRM

CRM com login para clientes e pedidos, alimentado automaticamente pelo agente de WhatsApp (n8n).

CRM de perfumaria da Prime (dourado `#D4AF37` + brasão), com perfumes, decants, clientes e pedidos. Abre em `/crm/`.

> **Rode o `perfumaria.sql`** no Supabase (SQL Editor, depois do `schema.sql` e do `site-pedidos.sql`). Ele liga o controle de ml dos decants, tira as regras e os produtos de exemplo da tabacaria e deixa o aniversário no lugar da maioridade.

```
crm/
├── index.html            ← o CRM (arquivo único, é só hospedar)
├── config.js             ← URL e anon key do Supabase + dados da loja (ZOO_LOJA)
├── produtos.js           ← catálogo do CRM, GERADO por "npm run catalogo" a partir do index.html do site
├── img/                  ← brasão e favicons do CRM
├── schema.sql e *.sql    ← banco: tabelas, segurança, funções do agente
├── supabase/functions/   ← funções de WhatsApp e notificações (push)
└── README.md
```

> **Prime:** o `config.js` e o `produtos.js` ficam dentro de `crm/` (na Zoo ficavam na pasta do site).
> Cada tamanho de perfume (100 ml, Decant 5/10/15 ml) vira um produto no CRM, com o id `"<id>|<tamanho>"`.
> Depois de mudar preço/produto no `index.html` do site, rode `npm run catalogo` — ele atualiza o
> `api/_lib/catalogo-dados.js` **e** o `crm/produtos.js`.

**O que tem no CRM**

- Login com e-mail e senha (Supabase Auth)
- **Visão geral**: faturamento do mês, pedidos de hoje, ticket médio, pedidos em andamento, melhores clientes, vendas por categoria
- **Clientes**: nome, telefone, e-mail, endereço, **quantidade de pedidos**, **total gasto**, último pedido, busca, ordenação e exportação CSV
- **Ficha do cliente**: dados, produtos favoritos e **histórico completo de pedidos com os itens**
- **Pedidos**: filtro por status, troca de status direto na lista, pedido manual
- **Perfumes**: frascos e kits por marca, com preço e estoque editáveis na lista, vendas dos últimos 30 dias, valor do estoque, filtros (estoque baixo, esgotados, fora do site) e ordenação por mais vendidos
- **Decants**: um frasco aberto por perfume, com os **ml que sobram**, quantos decants de 5/10/15 ml ainda rendem, preço de cada tamanho e **lucro por decant** (pelo custo por ml do frasco da Margem de lucro). Cada decant vendido desconta os ml sozinho (cancelou, devolve), e o estoque de cada tamanho é recalculado pelos ml. **Abrir frasco** soma um frasco novo e pode tirar 1 frasco lacrado do estoque; **Ajustar ml** corrige depois de medir. Frasco com menos de 15 ml aparece como *acabando*.
- **Clientes**: aniversário (com aviso e botão *Mandar parabéns* no WhatsApp), aniversariantes do mês e preferências olfativas (tags como Amadeirado, Doce, Árabes)
- **Margem de lucro**: a planilha *Prime Perfumes - Por Secoes* dentro do CRM. Custo, frete, impostos, lucro líquido e margem de cada produto, editáveis direto na tabela, com fornecedor, custo pela caixa, preço pela margem desejada e exportação CSV. Rode o `margem.sql` (depois do `site-pedidos.sql`). Os custos ficam na tabela `produto_custos`, que só a equipe logada lê (a tabela `produtos` é pública para a vitrine do site).
- **Mensagens prontas**: textos com os dados do pedido para copiar ou abrir no WhatsApp. Dá para editar os textos, criar novos e excluir direto no CRM (botões **Editar** e **+ Nova mensagem**); variáveis como `{nome}`, `{pedido}`, `{itens}` e `{valores}` viram os dados do pedido. Rode o `mensagens-prontas.sql` uma vez para os textos ficarem salvos para toda a equipe.
- **Atendimento (quem aceitou o pedido)**: cada pedido em aberto tem o botão **✓ Aceitar**; quem aceita vira o responsável e o nome aparece na Visão geral, em Pedidos (coluna *Atendente*, abas *Meus* e *Sem atendente*) e no detalhe (com **Devolver para a fila** e **Assumir pedido**). Se dois funcionários clicarem juntos, só o primeiro fica. Quem muda o status de um pedido sem dono vira o responsável automaticamente. A seção **Atendimento** (menu lateral) mostra o ranking de quem atendeu mais pedidos (pedidos, faturamento, clientes e tempo médio para aceitar), por mês, últimos 30 dias ou tudo; a ficha do cliente mostra **Atendido por** e quem atendeu cada pedido do histórico. No status do pedido aparece uma etapa para cada funcionário (ex.: **Atendimento (Lino)**, **Atendimento (Pedro)**): escolher uma deixa o pedido com aquele responsável; escolher **Novo** devolve para a fila. Os funcionários são os logins do CRM; cada um troca o próprio nome clicando nele, embaixo do menu. Rode o `atendimento.sql` (depois do `site-pedidos.sql`). Sem ele, o CRM funciona normalmente, só sem essa parte.
- **Entrega agendada pelo site**: com a loja fechada, o cliente escolhe no site a faixa de 1 hora (19h às 01h) do mesmo dia (só em dia de funcionamento) e só então o pedido entra no CRM, como *Fora do horário*, com a tag **Agendado p/ sex, 07/11 · 20h às 21h** e a faixa **Fora do horário de atendimento** na Visão geral, em Pedidos e no detalhe (e também nas observações). O banco recusa horários fora do funcionamento ou que já passaram. Rode o `agendamento.sql` (depois do `site-pedidos.sql`). Sem ele, o site grava o pedido sem o horário.
- **Frete grátis acima de R$ 35 garantido pelo banco**: nos pedidos do site, o frete é refeito pelo servidor sempre que o subtotal muda (>= R$ 35 grátis; abaixo, R$ 9,90), em vez de confiar no valor calculado no navegador. Rode o `frete-gratis.sql` (depois do `site-pedidos.sql`); ele também zera o frete dos pedidos do site já gravados com subtotal >= R$ 35.
- **Oferta relâmpago com 2 minutos de tolerância**: se o cliente montou o carrinho com o preço da oferta e o pedido chega ao banco até 2 minutos depois do fim dela, ainda vale o preço da oferta (só para os itens que o site mandou com esse preço). Rode o `oferta-tolerancia.sql` (depois do `site-pedidos.sql` e do `kit-mensal.sql`).
- **Agente WhatsApp**: chave secreta e exemplos prontos de chamada
- Atualiza **em tempo real**: quando o agente grava um pedido, ele aparece na tela com aviso

Abra o `index.html` direto no navegador para ver o **modo demonstração** (dados fictícios, qualquer login entra).

---

## 1. Configurar o Supabase (5 min)

1. Crie um projeto em [supabase.com](https://supabase.com) (pode usar o mesmo projeto da Saturno, mas um separado é mais organizado).
2. **SQL Editor → New query** → cole todo o `supabase/schema.sql` → **Run**.
3. **Authentication → Sign In / Providers → Email**: desative **"Allow new users to sign up"** (só quem você criar entra).
4. **Authentication → Users → Add user → Create new user**: crie o login de cada pessoa da equipe (marque *Auto Confirm User*).
5. **Project Settings → API**: copie a **Project URL** e a **anon public key**.
6. No arquivo `crm/config.js`, troque:

```js
SUPABASE_URL: 'https://SEU-PROJETO.supabase.co',
SUPABASE_ANON_KEY: 'SUA-ANON-KEY'
```

> A anon key pode ficar no HTML: todas as tabelas estão protegidas por RLS e só usuários logados leem os dados.

## 2. Publicar o CRM

Qualquer hospedagem de site estático serve:

- **Vercel**: `vercel deploy` na pasta, ou arraste a pasta em vercel.com/new
- **Netlify**: arraste a pasta em app.netlify.com/drop
- **EasyPanel**: app do tipo *Static* apontando para a pasta

Depois, em **Supabase → Authentication → URL Configuration**, coloque o domínio do CRM em *Site URL*.

## 3. Conectar o agente de WhatsApp (n8n)

Pegue a **chave do agente** na aba *Agente WhatsApp* do CRM (depois de logado).

Todas as chamadas são `POST` para `https://SEU-PROJETO.supabase.co/rest/v1/rpc/<funcao>` com os headers:

```
apikey: SUA-ANON-KEY
Content-Type: application/json
```

| Função | Quando usar | Body |
|---|---|---|
| `agente_buscar_cliente` | Início da conversa | `{"p_chave":"…","p_telefone":"5531999998888"}` |
| `agente_salvar_cliente` | Sempre que coletar um dado novo | `{"p_chave":"…","p_dados":{"telefone":"…","nome":"…","email":"…","endereco":"…","bairro":"…","maior_idade":true}}` |
| `agente_listar_produtos` | Cliente pergunta preço / o que tem | `{"p_chave":"…"}` |
| `agente_registrar_pedido` | Pedido fechado | ver abaixo |
| `agente_status_pedido` | "Cadê meu pedido?" | `{"p_chave":"…","p_telefone":"…","p_numero":null}` |

**Registrar pedido** — grava/atualiza o cliente e cria o pedido numa única chamada:

```json
{
  "p_chave": "SUA_CHAVE_DO_AGENTE",
  "p_dados": {
    "telefone": "31999998888",
    "nome": "João Silva",
    "email": "joao@email.com",
    "maior_idade": true,
    "endereco": "Rua Direita, 100",
    "bairro": "Centro",
    "ponto_referencia": "Perto da praça",
    "tipo_entrega": "entrega",
    "forma_pagamento": "pix",
    "troco_para": null,
    "taxa_entrega": 5,
    "observacoes": "Interfone quebrado, ligar",
    "itens": [
      { "produto": "Seda Zomo Perfect Slim", "quantidade": 3 },
      { "produto": "Isqueiro Clipper", "quantidade": 1 },
      { "produto": "Produto fora do catálogo", "quantidade": 1, "preco_unitario": 12.5 }
    ]
  }
}
```

Resposta: `{"ok": true, "numero": 1001, "total": 34.00, "pedido_id": "…", "cliente_id": "…"}`

Regras automáticas:

- **Telefone** é normalizado (aceita `(31) 99999-8888`, `+55 31…`, etc.) e identifica o cliente — não duplica.
- Campos vazios **não apagam** dados já salvos.
- Se o nome do item bater com o catálogo, o **preço e a categoria vêm do catálogo**; senão, usa `preco_unitario`.
- `forma_pagamento`: `pix`, `dinheiro`, `cartao_credito`, `cartao_debito` · `tipo_entrega`: `entrega` ou `retirada`.
- **Maioridade**: o pedido só é aceito se `maior_idade: true` ou `data_nascimento` indicar 18+. Menor de 18 é recusado (venda de produtos de tabacaria a menores é proibida). Clientes marcados como **bloqueado** no CRM também são recusados.
- Erros voltam com HTTP 400 (ou 403 para chave inválida) e uma mensagem em `message` — o agente pode repassar ou encaminhar para humano.

### No n8n (AI Agent)

Crie uma **HTTP Request Tool** para cada função acima, com:

- Method `POST`, URL `https://SEU-PROJETO.supabase.co/rest/v1/rpc/agente_registrar_pedido`
- Headers `apikey` e `Content-Type`
- Body JSON com `p_chave` fixo e os demais campos preenchidos pelo modelo (`{{ $fromAI('itens', 'lista de itens', 'json') }}`, etc.)
- O telefone pode vir direto do webhook do WhatsApp/Chatwoot em vez de pedir ao modelo.

Trecho sugerido para o prompt do agente:

```
No início de cada conversa, use buscar_cliente com o telefone do contato.
Se o cliente já existe, cumprimente pelo nome e, se fizer sentido, ofereça repetir o último pedido.
Antes de fechar qualquer venda, confirme que o cliente tem 18 anos ou mais.
Colete nome, endereço com bairro e forma de pagamento (e e-mail, se o cliente quiser informar).
Ao fechar, chame registrar_pedido e informe ao cliente o número do pedido e o total retornados.
Nunca invente preços: consulte listar_produtos.
```

## Status dos pedidos

`novo` → `confirmado` → `em_preparo` → `saiu_entrega` → `entregue` (ou `cancelado`)

Pedidos cancelados não entram na contagem de pedidos nem no total gasto do cliente.

---

## 4. Site → CRM (pedidos do site entram sozinhos)

Arquivos compartilhados na pasta do site (`Prime Perfumes/`):

| Arquivo | O que é |
|---|---|
| `config.js` | URL e anon key do Supabase — **usado pelo site e pelo CRM** (o CRM não tem mais a config dentro do `index.html`) |
| `produtos.js` | Cadastro dos produtos do site (foto, descrição, tag, categoria). Produto novo incluído aqui é cadastrado no CRM ao abrir (botão *Buscar novos do site*) |

1. **SQL Editor**: rode `site-pedidos.sql` (depois do `schema.sql`).
2. Preencha `config.js` com a Project URL e a anon key.
3. Pronto: no site, ao clicar em **Enviar pedido**, o pedido é gravado no CRM (cliente pelo WhatsApp informado, itens, entrega, pagamento, frete) e o WhatsApp abre com a mensagem já com o **número do pedido** (`Pedido #1001`). Se o CRM estiver fora do ar, o WhatsApp abre do mesmo jeito.

Detalhes:
- O checkout ganhou o campo **WhatsApp** (obrigatório) — é ele que identifica o cliente no CRM.
- Preços: produtos do catálogo e o Kit do Mês usam o preço do CRM, não o que vem do navegador.
- Anti-spam: no máximo 3 pedidos do site por telefone a cada 10 minutos.
- O CRM mostra a origem (*Site*, *WhatsApp*, *Manual*) no aviso de novo pedido e na lista de clientes.
- **Tela Produtos do CRM, por categoria** (Sedas, Cigarros, Isqueiros…): preço, estoque e "No site" são editados direto na lista. Tudo muda **no site na hora**, sem recarregar (Supabase Realtime).
- **Estoque**: número de unidades. Vazio = sem controle (∞). Cada pedido (site, agente ou CRM) **dá baixa sozinho**; pedido cancelado **devolve**. Chegou a **0**, o produto **sai do site**; repondo o estoque, ele volta.
- Estoque baixo (até 3) aparece em amarelo e num aviso "Repor estoque" no topo da tela.
- O site não deixa colocar no carrinho mais do que tem em estoque, e o pedido é recusado se o estoque acabar no meio da compra.
- Combos (ex.: *Combo 3 Sedas King*) usam o preço e o estoque dos itens: acabou a seda, o combo sai do site.
- Sem CRM configurado (ou fora do ar), o site usa os preços do `produtos.js`.
- Produto novo: inclua no `produtos.js` (com foto etc.) e abra o CRM. Não troque o `id` de um produto que já vendeu.

## 4b. Loja online (index.html) ligada ao CRM

O que muda no CRM vale na loja em até 1 minuto, sem publicar o site:

| No CRM | Na loja |
|---|---|
| Preço (Perfumes / Decants) | Preço do tamanho na vitrine, na sacola e no **valor cobrado** no Mercado Pago |
| Estoque | Não deixa pôr na sacola mais do que tem; estoque 0 tira o tamanho da loja |
| "No site" desligado | O tamanho some (sem nenhum tamanho, some o perfume) |
| Oferta relâmpago no ar | Preço de oferta com o antigo riscado, selo -%, produtos em **Promoções** |
| — | Pagamento aprovado vira pedido **Novo** no CRM e baixa o estoque e os ml dos decants |
| — | Cliente clicou em pagar e foi para o Mercado Pago: o cliente é cadastrado e o pedido entra na hora como **Aguardando pagamento** (com o `checkout-aguardando.sql`); quando o Mercado Pago responder, o mesmo pedido vira **Pagamento aprovado**, segue aguardando ou fica **Pagamento recusado**. Se o cliente abrir outro checkout sem ter pago o anterior, o anterior some (sem pedido repetido) |
| — | Pix/boleto ainda não pago: pedido **Aguardando pagamento** (não baixa estoque); vira Novo quando o Mercado Pago aprova; recusado/estornado vira Cancelado |

Configurar (uma vez):
1. **SQL Editor**: rode o `perfumaria.sql` (depois do `site-pedidos.sql`).
   Depois rode o `checkout-aguardando.sql` (pedido *Aguardando pagamento* assim que o cliente vai para o Mercado Pago).
2. **Chave**: no SQL Editor, `select chave from public.agente_config;` e copie o valor.
3. **Vercel** (projeto do site) → Settings → Environment Variables: crie `CRM_CHAVE` com essa chave e faça um novo deploy.

Sem a `CRM_CHAVE`, a loja já mostra preço/estoque/ofertas do CRM, mas os pedidos não entram no CRM (continuam só por e-mail).
Se o CRM ficar fora do ar, a loja vende pelos preços escritos no `index.html`.
Cupons e a promoção leve 3 / leve 5 continuam no código (`api/_lib/cupons.js` e `promocoes.js`).

**Funil do site** (CRM > Google Analytics): Visitas → Viu produto → Pôs na sacola → Iniciou checkout (eventos do Google Analytics enviados pelo `js/crm-loja.js`) → Foi para o Mercado Pago → Pagou (pedidos do CRM). Ao lado, **Clientes do site**: quem comprou no período, primeira compra × já tinham comprado, ticket médio, quantos pagaram no Mercado Pago e a lista de quem foi pagar e não pagou (com atalho para o WhatsApp). O site também manda ao Analytics os eventos `add_payment_info` (foi para o Mercado Pago) e `purchase` (pagamento aprovado, na `checkout.html`).

## 5. WhatsApp Business dentro do CRM

Menu **WhatsApp**: caixa de entrada com as conversas, chat em tempo real, respostas rápidas, botão *Conversar* na ficha do cliente e chave **Agente automático** por conversa.

Usa a **API oficial (Cloud API) da Meta**. O token fica numa Edge Function do Supabase, nunca no navegador.

1. **SQL Editor**: rode `whatsapp.sql`.
2. Instale a [Supabase CLI](https://supabase.com/docs/guides/cli), e dentro da pasta `crm`:
   ```
   supabase login
   supabase link --project-ref SEU-PROJETO
   supabase functions deploy whatsapp --no-verify-jwt
   supabase secrets set WHATSAPP_TOKEN=... WHATSAPP_PHONE_NUMBER_ID=... WHATSAPP_VERIFY_TOKEN=uma-senha-qualquer WHATSAPP_APP_SECRET=...
   ```
3. Na Meta (developers.facebook.com > seu app > WhatsApp > Configuração > Webhook): URL `https://SEU-PROJETO.supabase.co/functions/v1/whatsapp`, token de verificação = `WHATSAPP_VERIFY_TOKEN`, assine o campo **messages**.
4. O botão **Conexão** na tela WhatsApp mostra o que já está configurado e repete esses passos.

Regras da Meta que o CRM já respeita:
- **Janela de 24 h**: texto livre só até 24 h após a última mensagem do cliente. Fora disso (ou para iniciar conversa), o CRM pede um **modelo aprovado** (WhatsApp Manager > Modelos de mensagem).
- Um número na Cloud API sai do app WhatsApp Business do celular (a não ser que você ative a *coexistência* na Meta).

**Agente n8n junto:** a Meta só aceita um webhook por app. Coloque a URL do webhook do n8n em `FORWARD_WEBHOOK_URL` (secret) e a função repassa cada mensagem para o agente. Quando um atendente responde pelo CRM, o agente é **pausado naquela conversa** (a chave *Agente automático* religa).

## 6. Etiqueta de envio (impressora térmica)

Em **Pedidos**: botão **Etiqueta** em cada linha, ou marque vários pedidos e clique em **Imprimir etiquetas (N)** no topo. No detalhe do pedido também tem **Imprimir etiqueta**.

- Baixa um **PDF 10 × 15 cm (100 × 150 mm)**, o tamanho da etiqueta do Mercado Livre. Vários pedidos saem num PDF só, uma etiqueta por página.
- Só preto e branco puro, com código de barras do nº do pedido em vetor (nítido em 203/300 dpi).
- Tem: nº do pedido, data, destinatário, telefone, endereço, **bairro em destaque**, referência, forma de pagamento, **valor a cobrar e troco**, observações, itens, remetente e o aviso de venda só para maiores de 18 anos.
- Dados do remetente: `window.ZOO_LOJA` no `config.js` (nome, cidade e WhatsApp da loja).
- Pedidos com etiqueta já impressa ganham a marca *Etiqueta ✓* na lista (guardada no navegador).

**Na hora de imprimir** (Zebra, Elgin L42, Argox etc.):
1. Abra o PDF e use Ctrl+P, escolhendo a impressora térmica.
2. Tamanho do papel: **100 × 150 mm** (ou 4 × 6 pol).
3. Escala: **Tamanho real / 100%**, sem "Ajustar à página". Margens: **Nenhuma**.

## 7. Ofertas relâmpago

Menu **Ofertas** no CRM → **+ Nova oferta relâmpago**:
- Título (aparece grande no topo do site) e frase de apoio opcional.
- **Começa** e **Termina** (data e hora), com atalhos: 1 h, 2 h, 3 h, 6 h, até 01h, começar agora.
- Marque os produtos e defina o preço de oferta de cada um, ou um **% de desconto** para todos os marcados. Combos e produtos esgotados não entram.

No site:
- **No ar** (entre início e fim): a seção 1 do topo vira a vitrine da oferta, com título, "até X% off", contagem regressiva e os produtos com preço antigo riscado e selo de desconto. No celular, os produtos aparecem numa faixa logo abaixo do título.
- O preço de oferta vale no carrinho e também **no pedido gravado** (o servidor confere o horário). O Kit do Mês e os combos seguem o preço normal.
- **Agendada** (próximas 24 h): o selo do topo mostra "Oferta relâmpago começa em…".
- Na hora de começar ou terminar, o site muda sozinho, sem recarregar. Pausar, encerrar ou editar no CRM também muda o site na hora.

Obs.: o agente de WhatsApp (n8n) ainda usa o preço normal.

## 9. Notificações no celular (pedidos, conversas, atualizações)

Avisos que chegam **mesmo com o CRM fechado**, como notificação de app:

| Tipo | Quando chega |
|---|---|
| **Pedidos novos** | Pedido do site, do agente ou do CRM (e pedido feito com a loja fechada) |
| **Conversas do WhatsApp** | Cada mensagem de cliente (várias da mesma conversa se juntam numa notificação) |
| **Atualizações** | Status de pedido mudou, estoque ficou baixo (3 ou menos) ou esgotou |

Tocar na notificação abre o CRM na tela certa. O ícone do app mostra o número de pedidos novos + mensagens não lidas. Quem faz uma mudança no CRM não recebe aviso da própria ação.

### Configurar (uma vez)

1. **SQL Editor**: rode `notificacoes.sql` (depois do `whatsapp.sql`). Ele já aponta para o projeto da Prime (`omfsonnubkmuuqekeoev`); se for outro projeto, troque o endereço no `insert into public.push_config`.
2. **Chaves VAPID** (no computador, na pasta `crm`):
   ```
   npx web-push generate-vapid-keys
   ```
3. **Publicar a função e guardar as chaves** (as duas chaves da etapa 2; o e-mail é só contato para a Apple/Google):
   ```
   supabase functions deploy push --no-verify-jwt
   supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:seu@email.com
   ```
   Sem a CLI: Supabase > Edge Functions > Deploy a new function > `push` (cole o `supabase/functions/push/index.ts`, desmarque *Verify JWT*) e Edge Functions > Secrets.
4. Publique o site (o `manifest.webmanifest` e o `sw.js` precisam ir junto do `index.html`).

> Nunca troque as chaves VAPID depois: todos os celulares precisariam ativar de novo.

### No iPhone (cada pessoa da equipe)

O iPhone só notifica o CRM **instalado pelo Safari** (iOS 16.4 ou mais novo). Atalho criado pelo app **Atalhos** não recebe notificação.

1. Apague o ícone antigo do CRM, se ele foi criado pelo app Atalhos.
2. Abra o endereço do CRM no **Safari** > **Compartilhar** > **Adicionar à Tela de Início**.
3. Abra o CRM pelo novo ícone, faça login e toque em **Ativar notificações** (aparece um cartão na primeira vez; depois fica no menu ☰, embaixo).
4. Aceite o pedido de permissão. Chega uma notificação de teste.

No menu **Notificações** dá para escolher os tipos, mandar um teste ou desligar. No Android e no computador (Chrome, Edge, Safari) funciona direto pelo navegador, sem instalar.

**Não chegou?** Confira: Ajustes > Notificações > Prime CRM ligado; modo Foco/Não Perturbe desligado; em Supabase > Edge Functions > push > Logs aparece cada envio.

### Cupons de desconto (menu Cupons)

Crie, pause e edite os cupons da sacola do site: porcentagem (com teto) ou valor fixo, compra mínima,
validade, limite de usos e 1 uso por cliente. Vale na hora: a sacola e o servidor do Mercado Pago
consultam a função `loja_cupom` (perfumaria.sql, seção 5). Sem resposta do CRM, valem os cupons
fixos de `api/_lib/cupons.js`.

### Status do pedido

Aguardando pagamento → Pagamento aprovado → Enviado → Entregue, além de Pagamento recusado e
Venda cancelada. O Mercado Pago muda sozinho: Pix pago vira "Pagamento aprovado", cartão
recusado ou Pix vencido vira "Pagamento recusado", e estorno vira "Venda cancelada" (o estoque volta).
Só "Pagamento aprovado", "Enviado" e "Entregue" contam como venda e baixam estoque.

### Google Analytics dentro do CRM (menu Site → Google Analytics)

Visitantes, visitas, engajamento, quem está no site agora, de onde vêm, aparelhos, cidades,
páginas, eventos, funil de compra, horários de pico e a conversão do site (vendas do CRM ÷ visitas).
Os dados vêm do GA4 (G-EC7NP05FJV) pelo `api/ga-relatorio.js`, e só quem está logado no CRM consegue ver.

1. Google Cloud Console: crie um projeto, ative a **Google Analytics Data API**, crie uma conta de serviço e baixe a chave **JSON**.
2. Google Analytics → Administrador → Gerenciamento de acesso à propriedade → adicione o e-mail da conta de serviço como **Leitor**.
3. Google Analytics → Administrador → Detalhes da propriedade → copie o **ID da propriedade** (só números).
4. Vercel → Settings → Environment Variables: `GA_PROPERTY_ID` = o número e `GA_CREDENTIALS` = o JSON inteiro. Depois, faça um novo deploy.

O site passa a mandar os eventos `view_item`, `add_to_cart` e `begin_checkout` (pelo `js/crm-loja.js`) para o funil.
