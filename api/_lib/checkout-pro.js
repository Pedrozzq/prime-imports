/**
 * Prime Perfumes — Helpers do Checkout Pro (pagamento na página do Mercado Pago).
 *
 * No Checkout Pro o cliente é redirecionado para o ambiente do próprio Mercado
 * Pago (o `init_point` de uma "preference"). Aqui ficam as funções que montam
 * essa preference a partir da sacola JÁ validada pelo catálogo
 * (api/_lib/catalogo.js) e pelo cupom (api/_lib/cupons.js) — o navegador nunca
 * decide preço nem desconto.
 */

/** URL pública da loja, para o Mercado Pago saber para onde devolver o cliente. */
export function baseUrlDeRequest(req) {
    var fixa = process.env.PUBLIC_BASE_URL;
    if (fixa) return String(fixa).replace(/\/+$/, '');
    var headers = (req && req.headers) || {};
    var proto = String(headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
    var host = headers['x-forwarded-host'] || headers.host || 'localhost:3000';
    return proto + '://' + host;
}

/** Quebra "João da Silva" em { first_name: 'João', last_name: 'da Silva' }. */
function parteNome(nomeCompleto) {
    var limpo = String(nomeCompleto || '').trim().replace(/\s+/g, ' ');
    if (!limpo) return {};
    var pos = limpo.indexOf(' ');
    if (pos === -1) return { first_name: limpo };
    return { first_name: limpo.slice(0, pos), last_name: limpo.slice(pos + 1) };
}

/** "(11) 98888-7777" -> { area_code: '11', number: '988887777' } */
function parteTelefone(fone) {
    var digitos = String(fone || '').replace(/\D+/g, '');
    if (digitos.length < 10) return undefined;
    return { area_code: digitos.slice(0, 2), number: digitos.slice(2) };
}

/**
 * Prefill do pagador na tela do Mercado Pago, a partir do endereço que o
 * cliente já preencheu na sacola da loja. Tudo é opcional: o Mercado Pago
 * completa o que faltar (inclusive o e-mail, que a loja não coleta).
 */
export function montarPayer(entrega) {
    var e = entrega && typeof entrega === 'object' ? entrega : {};
    var nome = parteNome(e.nome);
    var payer = {};
    if (nome.first_name) payer.name = nome.first_name;
    if (nome.last_name) payer.surname = nome.last_name;
    var fone = parteTelefone(e.fone);
    if (fone) payer.phone = fone;

    var cep = String(e.cep || '').replace(/\D+/g, '');
    if (cep || e.rua) {
        payer.address = {};
        if (cep) payer.address.zip_code = cep;
        if (e.rua) payer.address.street_name = e.rua;
        if (e.numero) payer.address.street_number = String(e.numero);
    }
    return payer;
}

/**
 * Linhas ("items") da preference.
 *
 * Sem cupom: uma linha por item do catálogo (nome, marca, quantidade, preço
 * oficial) — o cliente vê a sacola detalhada na tela do Mercado Pago.
 *
 * Com cupom: uma única linha com o total JÁ com desconto. Assim o Mercado Pago
 * cobra exatamente `total` (o Checkout Pro não tem campo de desconto e não
 * aceita preço negativo, então distribuir centavos por item só traria erro de
 * arredondamento). O detalhamento continua no e-mail do pedido.
 */
export function itensPreferencia(itens, total, descontoReais, cupomCodigo) {
    var desconto = Number(descontoReais) || 0;

    if (desconto > 0) {
        var qtd = itens.reduce(function (soma, it) { return soma + (Number(it.qty) || 0); }, 0);
        return [{
            id: 'pedido-prime',
            title: 'Pedido Prime Perfumes — ' + qtd + ' item(ns)'
                + (cupomCodigo ? ' (cupom ' + String(cupomCodigo).toUpperCase() + ')' : ''),
            quantity: 1,
            currency_id: 'BRL',
            unit_price: Math.round(Number(total) * 100) / 100
        }];
    }

    return itens.map(function (it) {
        return {
            id: String(it.id || it.name),
            title: it.name + (it.brand ? ' — ' + it.brand : ''),
            quantity: Number(it.qty) || 1,
            currency_id: 'BRL',
            unit_price: Math.round(Number(it.price) * 100) / 100
        };
    });
}
