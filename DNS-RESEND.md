# Zona DNS — primeimportsperfumes.com.br

Cinco registros no total: dois apontam o site para a **Vercel**, três verificam
o domínio no **Resend**. O painel é Registro.br → Meus Domínios →
primeimportsperfumes.com.br → **Configurar zona DNS** (modo avançado).

O modo avançado **não aceita `@` nem `*`**. Para a raiz do domínio, o campo
*Nome* fica **vazio** — o painel completa sozinho com `.primeimportsperfumes.com.br`.

---

## 1. Apague os 5 registros atuais

Eles apontam o domínio para o GitHub Pages, onde o checkout não funciona
(GitHub Pages só serve arquivos estáticos, então `/api/create-payments` e
`/api/notify-checkout` retornam 404).

| Tipo | Nome | Dados |
|---|---|---|
| `A` | primeimportsperfumes.com.br | `185.199.108.153` |
| `A` | primeimportsperfumes.com.br | `185.199.109.153` |
| `A` | primeimportsperfumes.com.br | `185.199.110.153` |
| `A` | primeimportsperfumes.com.br | `185.199.111.153` |
| `CNAME` | www.primeimportsperfumes.com.br | `pedrozzq.github.io` |

Clique no **✕** de cada linha. Elas ficam marcadas para remoção (o ✕ vira uma
setinha de desfazer) e só somem de verdade quando você salvar.

## 2. Adicione os 5 novos

Clique em **NOVA ENTRADA** para cada um.

### Site na Vercel

| Tipo | Nome | Dados |
|---|---|---|
| `A` | *(deixe vazio)* | `216.198.79.1` |
| `CNAME` | `www` | `7222333c88dc263a.vercel-dns-017.com.` |

O ponto final no valor do CNAME faz parte do registro — mantenha.

### Verificação do Resend

| Tipo | Nome | Dados |
|---|---|---|
| `CNAME` | `rsend` | `rsend-sae1.forge.rmta.net` |
| `CNAME` | `send` | `send.forge.rmta.net` |
| `TXT` | `resend._domainkey` | *(o valor longo abaixo)* |

Valor do TXT — uma linha só, sem espaços nem quebras:

```
p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDa2Ar9KwsJikJWKNFZlInsbS1S2B9rMCF0R3hApB7ojZZ2Jsk29NsysBwHqQuBkZd4oDvoI5EZLQfD/pC1xLFJgb4S9t9EJq9iCOrVuVvrzcxrLa+DGFjPReDL93p6TK695EO4Xtok7gR4OD2iBKBgnN/FBYibS+3urfVDJz4y2QIDAQAB
```

## 3. SALVAR ALTERAÇÕES

O botão verde no fim do quadro da zona (não confunda com o SALVAR ALTERAÇÕES
da seção *Contatos*, mais acima).

---

## O MX que o Resend mostra — não adicione

O painel do Resend exibe um quarto registro:

| Tipo | Nome | Dados | Prioridade |
|---|---|---|---|
| `MX` | `@` | `inbound-smtp.sa-east-1.amazonaws.com` | 0 |

Ele serve só para **receber** e-mail pelo Resend e sequestra o recebimento do
domínio inteiro. Se um dia você criar um `contato@primeimportsperfumes.com.br`
no Google Workspace, no Zoho ou no seu provedor, esse MX briga com o deles e
você deixa de receber mensagens. Para sair do spam ao **enviar**, os cinco
registros acima bastam.

---

## Depois de salvar

O Registro.br publica a zona em alguns minutos. Então:

1. **Resend** → Domains → primeimportsperfumes.com.br → **Verify**.
2. **Vercel** → projeto prime-imports → Settings → Domains → **Refresh**
   nos dois domínios. O certificado SSL é emitido automaticamente.
3. Quando o Resend marcar **Verified**, troque na Vercel a variável
   `ORDER_EMAIL_FROM` para:

   ```
   Prime Imports BR <pedidos@primeimportsperfumes.com.br>
   ```

   e faça um redeploy. É essa troca que efetivamente tira do spam — os avisos
   passam a sair do seu domínio, assinados por DKIM — e libera mandar e-mail
   para o próprio cliente, não só para a caixa dona da conta Resend.

## Recomendado depois: DMARC

Com o DKIM verificado, vale um registro de política. Comece em modo observação,
sem risco de bloquear nada:

| Tipo | Nome | Dados |
|---|---|---|
| `TXT` | `_dmarc` | `v=DMARC1; p=none; rua=mailto:lojaprimeimportsbr@gmail.com` |
