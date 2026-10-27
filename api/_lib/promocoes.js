/**
 * Prime Perfumes — Promoções automáticas (autoridade do servidor).
 *
 * Mesma lógica dos cupons (api/_lib/cupons.js): o navegador não diz quanto
 * vale o desconto; ele é calculado aqui a partir da sacola já validada pelo
 * catálogo. Se mudar a regra aqui, espelhe em descontoPorItem() do index.html
 * e em getPromo() de js/checkout.js (usados só para o cliente ver o desconto).
 *
 * Black November — duas promoções que não se somam no mesmo grupo (qualquer item:
 * frasco, decant, cosmético ou body splash, contando a quantidade de cada um).
 * As unidades são ordenadas do mais caro para o mais barato e agrupadas de 5 em 5:
 *   - leve 5 (grupo completo de 5): o mais barato sai de graça;
 *   - leve 3 (grupo que sobra com 3 ou 4): o mais barato sai pela metade;
 *   - grupo que sobra com 1 ou 2: sem desconto.
 * Ex.: R$500, 400, 300 → R$150 de desconto; R$500, 400, 300, 200, 100 → R$100 de desconto.
 */

export const PROMO_DECANTS = {
    ativo: true,
    aCada: 3,          // a partir de 3: o mais barato com `percentual` de desconto
    gratisCom: 5,      // com 5: o mais barato de graça
    percentual: 50,
    rotulo: 'Black November — leve 3, o de menor valor sai pela metade; ou leve 5, o de menor valor sai de graça'
};

/** Centavos evitam erro de ponto flutuante. */
function centavos(valor) {
    return Math.round(Number(valor) * 100);
}

/**
 * Desconto em centavos de cada unidade, na mesma ordem de `unidades`
 * (já ordenadas do mais caro para o mais barato).
 * @param {number[]} unidades
 * @returns {number[]}
 */
export function descontosDasUnidades(unidades) {
    var promo = PROMO_DECANTS;
    var desc = unidades.map(function () { return 0; });
    for (var ini = 0; ini < unidades.length; ini += promo.gratisCom) {
        var fim = Math.min(ini + promo.gratisCom, unidades.length) - 1;   // índice do mais barato do grupo
        var tamanho = fim - ini + 1;
        if (tamanho === promo.gratisCom) {
            desc[fim] = unidades[fim];
        } else if (tamanho >= promo.aCada) {
            desc[fim] = Math.round(unidades[fim] * promo.percentual / 100);
        }
    }
    return desc;
}

/**
 * Desconto (R$) da promoção Black November para itens já validados pelo catálogo.
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

    var descontoCent = descontosDasUnidades(unidades).reduce(function (s, d) { return s + d; }, 0);
    return { desconto: descontoCent / 100, rotulo: promo.rotulo };
}
