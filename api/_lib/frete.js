/**
 * Prime Perfumes — Regra do frete (fonte de verdade do servidor).
 *
 * Mesma regra mostrada na sacola do index.html (FRETE_GRATIS_A_PARTIR e o
 * valor fixo) e no resumo do checkout (js/checkout.js). Se mudar aqui, mude
 * lá também — mas quem decide o que é cobrado é sempre este arquivo.
 *
 * O frete grátis olha o valor dos produtos ANTES do cupom, igual à sacola.
 */

export const FRETE_VALOR = 29.9;
export const FRETE_GRATIS_A_PARTIR = 500;

/** @param {number} subtotal valor dos produtos (sem cupom) @returns {number} frete em reais */
// Produto de teste do pagamento (index.html → "teste-pagamento"): sacola só com ele não paga frete.
export const PRODUTO_TESTE = 'teste-pagamento';
export function soProdutoTeste(itens) {
    return Array.isArray(itens) && itens.length > 0 && itens.every(function (i) {
        return String((i && i.id) || '').split('|')[0] === PRODUTO_TESTE;
    });
}

export function calcularFrete(subtotal, itens) {
    if (soProdutoTeste(itens)) return 0;
    return Number(subtotal) >= FRETE_GRATIS_A_PARTIR ? 0 : FRETE_VALOR;
}
