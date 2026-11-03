/**
 * Prime Perfumes — Gerador do catálogo do servidor.
 *
 * Lê a constante PRODUTOS de index.html (a fonte única de verdade dos preços)
 * e escreve api/_lib/catalogo-dados.js com a tabela que a função de pagamento
 * usa para cobrar. O front-end continua editável como sempre; depois de mexer
 * em preço, tamanho ou produto no index.html, rode:
 *
 *     npm run catalogo
 *
 * Sem isso, o servidor continua cobrando os preços antigos — e recusa qualquer
 * item novo que ainda não esteja na tabela.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const ORIGEM = join(RAIZ, 'index.html');
const DESTINO = join(RAIZ, 'api', '_lib', 'catalogo-dados.js');
// Catálogo do CRM (crm/index.html): uma linha por variante, no mesmo id do carrinho
const DESTINO_CRM = join(RAIZ, 'crm', 'produtos.js');

const html = readFileSync(ORIGEM, 'utf8');

const inicio = html.indexOf('const PRODUTOS = [');
if (inicio === -1) {
    throw new Error('Não encontrei "const PRODUTOS = [" em index.html.');
}
const abre = html.indexOf('[', inicio);
const fecha = html.indexOf('\n];', abre);
if (fecha === -1) {
    throw new Error('Não encontrei o fechamento do array PRODUTOS em index.html.');
}

const literal = html.slice(abre, fecha + 2);

// O literal é JS puro do próprio projeto (não vem de fora), então avaliá-lo
// aqui é seguro e evita reescrever à mão 25 produtos com preços e multiplicadores.
const PRODUTOS = new Function('return ' + literal + ';')();

if (!Array.isArray(PRODUTOS) || !PRODUTOS.length) {
    throw new Error('PRODUTOS foi lido mas veio vazio.');
}

const catalogo = {};
const crm = [];
let variantes = 0;

for (const p of PRODUTOS) {
    if (!p || !p.id) continue;
    const tamanhos = Array.isArray(p.tamanhos) && p.tamanhos.length
        ? p.tamanhos
        : [{ ml: 'único', mult: 1 }];

    for (const t of tamanhos) {
        // Mesma chave e mesmo arredondamento que o carrinho do index.html usa,
        // para que o item enviado pelo navegador case exatamente com a tabela.
        const chave = p.id + '|' + t.ml;
        const preco = t.preco != null ? t.preco : Math.round(p.preco * t.mult * 100) / 100;

        catalogo[chave] = {
            nome: p.nome + ' (' + t.ml + ')',
            marca: p.marca || '',
            preco: preco
        };
        crm.push({ id: chave, name: catalogo[chave].nome, category: p.marca || 'Outros', price: preco });
        variantes++;
    }
}

const linhas = Object.keys(catalogo).sort().map(function (chave) {
    const item = catalogo[chave];
    return '    ' + JSON.stringify(chave) + ': { nome: ' + JSON.stringify(item.nome) +
        ', marca: ' + JSON.stringify(item.marca) + ', preco: ' + item.preco.toFixed(2) + ' }';
});

const saida = `/**
 * Prime Perfumes — Tabela de preços do servidor. ARQUIVO GERADO.
 *
 * Não edite à mão: rode "npm run catalogo" depois de alterar os preços no
 * index.html. A chave é "<id do produto>|<tamanho>", exatamente como o
 * carrinho do front-end monta.
 *
 * Gerado a partir de index.html — ${PRODUTOS.length} produtos, ${variantes} variantes.
 */

export const CATALOGO = {
${linhas.join(',\n')}
};
`;

mkdirSync(dirname(DESTINO), { recursive: true });
writeFileSync(DESTINO, saida, 'utf8');

const saidaCrm = `// =====================================================================
//  PRIME PERFUMES · CATÁLOGO DO CRM — ARQUIVO GERADO.
//  Não edite à mão: rode "npm run catalogo" depois de alterar PRODUTOS no index.html.
//  Cada tamanho (100 ml, decants) é um produto no CRM; o id é "<id do produto>|<tamanho>",
//  o mesmo que o carrinho do site usa. Ao abrir, o CRM cadastra os novos e inativa os que saíram.
//  Gerado a partir de index.html — ${PRODUTOS.length} produtos, ${variantes} variantes.
// =====================================================================
window.ZOO_CATALOGO = ${JSON.stringify(crm.sort((a, b) => a.id.localeCompare(b.id)), null, 1)};
window.ZOO_PRODUTOS = window.ZOO_CATALOGO;
`;
mkdirSync(dirname(DESTINO_CRM), { recursive: true });
writeFileSync(DESTINO_CRM, saidaCrm, 'utf8');

console.log('catalogo-dados.js gerado: ' + PRODUTOS.length + ' produtos, ' + variantes + ' variantes.');
