# Prime Imports BR — publicar na Vercel e receber os pedidos por e-mail

Passo a passo completo. Tudo o que é código já está pronto na pasta;
o que falta são as contas e as chaves.

---

## 1. Criar a chave do Resend (e-mail dos pedidos)

1. Acesse **https://resend.com/signup** e crie a conta **usando o e-mail
   `lojaprimeimportsbr@gmail.com`**. Isso é importante: no plano grátis, sem
   domínio verificado, o Resend só entrega para o e-mail dono da conta.
2. Confirme o e-mail de verificação que o Resend envia.
3. Vá em **API Keys → Create API Key** (permissão *Sending access* basta).
4. Copie a chave (começa com `re_`). Ela só aparece uma vez.

> **Depois, quando tiver domínio próprio:** verifique o domínio em
> *Domains* no Resend e troque `ORDER_EMAIL_FROM` para
> `Prime Imports BR <pedidos@seudominio.com.br>`. Aí você passa a poder
> enviar também a confirmação para o cliente.

---

## 2. Testar localmente (opcional, mas recomendado)

No arquivo `.env` da pasta do projeto, acrescente as linhas novas:

```
RESEND_API_KEY=re_sua_chave_aqui
ORDER_EMAIL_TO=lojaprimeimportsbr@gmail.com
ORDER_EMAIL_FROM=Prime Imports BR <onboarding@resend.dev>
```

(o `MP_ACCESS_TOKEN` já está lá). Depois:

```powershell
cd "C:\Users\Pedro\Desktop\Projetos\Lojas\Prim Imports"
vercel dev
```

Abra `http://localhost:3000`, monte uma sacola, preencha o endereço,
clique em pagar online e faça um pagamento de teste. O e-mail deve chegar
em segundos.

---

## 3. Subir para o GitHub

Se ainda não tiver o Git instalado: https://git-scm.com/download/win

```powershell
cd "C:\Users\Pedro\Desktop\Projetos\Lojas\Prim Imports"
git init
git add .
git commit -m "Loja Prime Imports: checkout Mercado Pago + e-mail de pedidos"
git branch -M main
```

Crie o repositório vazio em **https://github.com/new**
(nome sugerido: `prime-imports-br`, **privado**, sem README/licença), e então:

```powershell
git remote add origin https://github.com/SEU_USUARIO/prime-imports-br.git
git push -u origin main
```

O `.gitignore` já bloqueia `.env`, `node_modules/`, os `.bak` e o `.zip` —
sua credencial do Mercado Pago **não** vai para o GitHub.

---

## 4. Ligar o repositório na Vercel

Assim que o repositório estiver no GitHub, me avise: eu ligo o projeto na
sua conta `pedrozzq's projects` e disparo o primeiro deploy daqui.

Se preferir fazer você mesmo: **https://vercel.com/new** → *Import Git
Repository* → escolha o repositório → **Deploy**. Não mexa em Framework
Preset (fica *Other*) nem em Build Command.

---

## 5. Configurar as variáveis de ambiente na Vercel

**Project Settings → Environment Variables** — crie as quatro, marcando
*Production*, *Preview* e *Development*:

| Nome | Valor |
|---|---|
| `MP_ACCESS_TOKEN` | o Access Token de **produção** do Mercado Pago (`APP_USR-...`) |
| `RESEND_API_KEY` | a chave `re_...` do passo 1 |
| `ORDER_EMAIL_TO` | `lojaprimeimportsbr@gmail.com` |
| `ORDER_EMAIL_FROM` | `Prime Imports BR <onboarding@resend.dev>` |

Opcionalmente, uma quinta: `CHECKOUT_EMAIL_TO`, para mandar o aviso de
"cliente chegou ao checkout" para um endereço diferente dos pedidos. Sem
ela, o aviso vai para o mesmo `ORDER_EMAIL_TO`. Para desligar só esse
aviso, crie `CHECKOUT_EMAIL_OFF` com valor `1`.

Depois de salvar, vá em **Deployments → … → Redeploy** para que a função
passe a enxergar as variáveis.

---

## 6. Conferir se está funcionando

1. Abra a URL de produção, monte uma sacola, preencha o endereço e pague.
2. O e-mail chega em `lojaprimeimportsbr@gmail.com` com assunto
   `[PAGO] Pedido #123456789 — Nome — R$ 0,00`.
3. Se não chegar: **Vercel → Deployments → Functions → create-payments →
   Logs**. As mensagens são explícitas (`RESEND_API_KEY ausente`,
   `Resend 403: ...`, etc.). Confira também o spam do Gmail e marque como
   "não é spam" no primeiro e-mail.

---

## Os dois e-mails que você recebe

### 1. `[CHECKOUT]` — cliente chegou ao pagamento

Sai assim que a pessoa abre `checkout.html`, **antes de pagar**. Assunto:
`[CHECKOUT] Nome do cliente está pagando — R$ 0,00`. Traz a sacola com
itens e total, o nome e o WhatsApp, o endereço completo de entrega e um
botão que abre a conversa no WhatsApp.

É o seu aviso de carrinho abandonado: se o e-mail de pedido (abaixo) não
chegar logo em seguida, a pessoa desistiu no meio do pagamento e vale um
contato. Sai **uma vez por sacola e por sessão do navegador** — recarregar
a página de pagamento não gera um segundo e-mail.

### 2. `[PAGO]`, `[AGUARDANDO PAGAMENTO]`… — pedido criado

Um e-mail por pedido criado, **em qualquer status** — o status vem no
assunto, entre colchetes:

- `[PAGO]` — cartão aprovado, pode separar e enviar
- `[AGUARDANDO PAGAMENTO]` — Pix gerado, ainda não pago
- `[EM ANÁLISE]` — cartão em revisão do Mercado Pago
- `[RECUSADO]` — pagamento negado

Conteúdo: itens com quantidade e valor, total, nome/WhatsApp e endereço
completo de entrega, forma de pagamento e parcelas, e-mail e CPF do
pagador, e o número do pagamento para procurar no painel do Mercado Pago.
Responder ao e-mail responde direto para o cliente (`reply-to`).

---

## Como os preços são cobrados

O navegador manda a sacola, mas não manda quanto ela custa. Antes de criar o
pagamento, `api/_lib/catalogo.js` reconstrói cada item pela tabela do servidor
(`api/_lib/catalogo-dados.js`) e descarta o `price` que veio do cliente. Um
preço adulterado no DevTools não muda o valor cobrado — só aparece nos logs da
função como "Preço divergente do catálogo". Item com id desconhecido,
quantidade fracionada ou acima de 20 unidades faz o pagamento ser recusado com
HTTP 400.

A tabela é gerada do `index.html`, que continua sendo o único lugar onde você
edita preços:

```powershell
npm run catalogo
```

## Pontos de atenção

- **Pix pago depois não gera um segundo e-mail.** O aviso sai na criação do
  pagamento. Para ser avisado quando o Pix cair, é preciso configurar o
  webhook do Mercado Pago — dá para fazer depois, é meia hora de trabalho.
- **Mexeu em preço no `index.html`? Rode `npm run catalogo`.** Quem cobra é o
  servidor, a partir da tabela em `api/_lib/catalogo-dados.js`, que é gerada
  do `index.html`. Sem rodar o comando e commitar o arquivo gerado, a loja
  mostra o preço novo na vitrine e cobra o antigo no checkout — e um produto
  ou tamanho recém-criado é recusado no pagamento, porque ainda não existe na
  tabela. Vale o mesmo para produto novo, tamanho novo e decant novo.
- **Sem estoque e sem histórico.** Cada pedido existe só no e-mail e no
  painel do Mercado Pago. Se o volume crescer, o próximo passo natural é um
  banco (Vercel Postgres ou Supabase).
