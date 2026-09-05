# Prime Imports BR — Guia para agentes

Site estático (HTML + Tailwind via CDN + JS puro) da Prime Imports, perfumaria de luxo online. Sem build step, sem framework — cada página é um `.html` autocontido (`<style>` inline própria), com alguns arquivos compartilhados em `css/` e `js/` (ex.: `css/buttons.css`, `js/cart.js`).

## Fluxo de trabalho: Issues + Pull Requests (obrigatório)

Qualquer tarefa feita neste repositório — **Correção** (bug fix), **Melhoria** (improvement) ou **Nova função** (new feature) — deve seguir este fluxo, independente de qual agente/modelo esteja executando o trabalho:

1. **Abrir uma Issue no GitHub antes de começar o trabalho**, descrevendo a tarefa. Use um destes rótulos/prefixos no título ou labels do repositório:
   - `Correção` / `bug` — algo quebrado que precisa ser consertado.
   - `Melhoria` / `enhancement` — ajuste ou refinamento em algo que já existe.
   - `Nova função` / `feature` — funcionalidade nova.
2. **Trabalhar em uma branch dedicada** para a Issue (ex.: `fix/carrinho-imagem-atheeri`, `feat/marquee-marcas`), nunca commitando diretamente em `main`/`master`.
3. **Abrir um Pull Request** com as mudanças, e **mencionar a Issue correspondente na descrição do PR** (ex.: `Closes #12` ou `Refs #12`), para que o GitHub vincule e feche a Issue automaticamente no merge.
4. **Deploys acontecem via merge do PR** — não há push direto para a branch de produção fora desse fluxo.

Se o repositório Git ainda não existir, ou não houver remoto no GitHub configurado, ou a GitHub CLI (`gh`) não estiver instalada/autenticada, **pare e avise o usuário** em vez de tentar criar repositório, instalar ferramentas ou autenticar silenciosamente — essas são ações que exigem confirmação explícita do usuário.

## Convenções do projeto

- Sem framework/build: edições são feitas direto nos arquivos `.html`, `css/*.css`, `js/*.js`.
- Paleta de marca: dourado `#D4AF37` (`brand-gold`), `#F3E5AB` (`brand-gold-light`), `#AA8529` (`brand-gold-dark`), fundo `#0a0a0a`/`#171717` (`brand-black`/`brand-dark`).
- Botões: usar as classes compartilhadas de `css/buttons.css` (`.btn-venus`, `.btn-venus-solid`, `.btn-venus-row`) para manter a estética consistente em todo o site.
- **Preços: `index.html` é a fonte única.** Depois de alterar `PRODUTOS` (preço,
  tamanho, `mult` de decant, produto novo), rode `npm run catalogo` e commite o
  `api/_lib/catalogo-dados.js` gerado — é essa tabela que o servidor usa para
  cobrar. Nunca edite o arquivo gerado à mão, e nunca faça a função de pagamento
  confiar no `price` que vem do navegador.
- Carrinho (`js/cart.js`) é compartilhado por todas as páginas; qualquer botão de "adicionar à sacola" precisa dos atributos `data-cart-add`, `data-cart-id`, `data-cart-name`, `data-cart-brand`, `data-cart-price`, `data-cart-image`.
