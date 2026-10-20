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
export function calcularFrete(subtotal) {
    return Number(subtotal) >= FRETE_GRATIS_A_PARTIR ? 0 : FRETE_VALOR;
}
