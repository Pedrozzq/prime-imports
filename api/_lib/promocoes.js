/**
 * Prime Perfumes — Promoções automáticas (autoridade do servidor).
 *
 * Mesma lógica dos cupons (api/_lib/cupons.js): o navegador não diz quanto
 * vale o desconto; ele é calculado aqui a partir da sacola já validada pelo
 * catálogo. Se mudar a regra aqui, espelhe em descontoDecants() do index.html
 * e de js/checkout.js (usados só para o cliente ver o desconto).
 *
 * Black November — leve 3 produtos: a cada 3 produtos na sacola (qualquer item:
 * frasco, decant, cosmético ou body splash, contando a quantidade de cada um),
 * o mais barato desse grupo sai pela metade do preço. As unidades são
 * ordenadas do mais caro para o mais barato e agrupadas de 3 em 3, então o
 * desconto cai sempre sobre a unidade mais barata de cada trio.
 */

export const PROMO_DECANTS = {
    ativo: true,
    aCada: 3,
    percentual: 50,
    rotulo: 'Black November — leve 3 produtos, o de menor valor sai pela metade'
};

/** Centavos evitam erro de ponto flutuante. */
function centavos(valor) {
    return Math.round(Number(valor) * 100);
}

/**
 * Desconto (R$) da promoção "leve 3 produtos" para itens já validados pelo catálogo.
 * (O nome descontoDecants ficou da primeira versão da promoção, que valia só para decants.)
 *
 * @param {Array<{id:string, price:number, qty:number}>} itens
 * @returns {{desconto:number, rotulo:string}} `desconto` 0 = promoção não se aplica.
 */
export function descontoDecants(itens) {
    var promo = PROMO_DECANTS;
    if (!promo.ativo || !Array.isArray(itens)) return { desconto: 0, rotulo: promo.rotulo };

    var unidades = [];
    itens.forEach(function (it) {
        var qtd = Math.floor(Number(it.qty)) || 0;
        for (var i = 0; i < qtd; i++) unidades.push(centavos(it.price));
    });
    unidades.sort(function (a, b) { return b - a; });

    var descontoCent = 0;
    for (var j = promo.aCada - 1; j < unidades.length; j += promo.aCada) {
        descontoCent += Math.round(unidades[j] * promo.percentual / 100);
    }

    return { desconto: descontoCent / 100, rotulo: promo.rotulo };
}
