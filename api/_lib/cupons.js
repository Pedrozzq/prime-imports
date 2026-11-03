/**
 * Prime Perfumes — Cupons de desconto (autoridade do servidor).
 *
 * Mesma lógica dos preços (api/_lib/catalogo.js): o navegador manda só o
 * CÓDIGO do cupom; as regras e o valor do desconto são decididos aqui.
 * Adulterar o localStorage ou o corpo do fetch não muda um centavo — no
 * máximo o cupom é recusado e a compra segue pelo valor cheio.
 *
 * Os cupons são cadastrados no CRM (menu Cupons → tabela cupons, função
 * loja_cupom): validarCupomAoVivo() consulta lá. O objeto CUPONS abaixo é só a
 * RESERVA para quando o CRM não responder (mesma lista do index.html).
 *
 *   tipo "percentual" → `valor` é a porcentagem (ex.: 10 = 10% de desconto).
 *   tipo "fixo"       → `valor` é o desconto em reais.
 *   minimo            → subtotal mínimo (R$) para o cupom valer. 0 = sem mínimo.
 *   tetoDesconto      → desconto máximo em reais (0 = sem teto). Só faz sentido
 *                       para "percentual".
 *   ativo             → false desliga o cupom sem apagar a linha.
 *   rotulo            → texto curto mostrado ao cliente.
 */

import { cupomAoVivo } from './crm.js';

export const CUPONS = {
    PRIME10:    { tipo: 'percentual', valor: 10, minimo: 0,   tetoDesconto: 150, ativo: true, rotulo: '10% OFF' },
    PRIME15:    { tipo: 'percentual', valor: 15, minimo: 500, tetoDesconto: 300, ativo: true, rotulo: '15% OFF acima de R$ 500' },
    BEMVINDO30: { tipo: 'fixo',       valor: 30, minimo: 199, tetoDesconto: 0,   ativo: true, rotulo: 'R$ 30 OFF acima de R$ 199' }
};

/** Centavos evitam erro de ponto flutuante ao aplicar porcentagem. */
function centavos(valor) {
    return Math.round(Number(valor) * 100);
}

function brl(valor) {
    return (Number(valor) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/**
 * Valida um código de cupom contra um subtotal (R$).
 *
 * @param {string} codigoBruto  código digitado pelo cliente
 * @param {number} subtotal     soma dos itens já validados pelo catálogo
 * @returns {{ok:boolean, code:string, rotulo?:string, desconto:number, motivo?:string}}
 *   `desconto` vem em reais, já limitado ao subtotal e ao teto do cupom.
 *   `ok:false` → não aplique desconto (mas a compra pode seguir pelo valor cheio).
 */
export function validarCupom(codigoBruto, subtotal) {
    const code = String(codigoBruto == null ? '' : codigoBruto).trim().toUpperCase();
    if (!code) {
        return { ok: false, code: '', desconto: 0, motivo: 'Nenhum cupom informado.' };
    }
    const cupom = Object.prototype.hasOwnProperty.call(CUPONS, code) ? CUPONS[code] : null;
    if (!cupom || !cupom.ativo) {
        return { ok: false, code: code, desconto: 0, motivo: 'Cupom inválido ou expirado.' };
    }
    return aplicarRegra(cupom, code, subtotal);
}

/**
 * Mesma validação, com as regras do CRM (validade, limite de usos, 1 por cliente).
 * Sem resposta do CRM, cai na lista fixa (validarCupom).
 *
 * @param {string} codigoBruto
 * @param {number} subtotal
 * @param {{telefone?:string, posPagamento?:boolean}} [opcoes]
 *   posPagamento: depois de pago (e-mail/pedido) não confere prazo nem limite — o próprio pedido já é um uso
 */
export async function validarCupomAoVivo(codigoBruto, subtotal, opcoes) {
    const code = String(codigoBruto == null ? '' : codigoBruto).trim().toUpperCase();
    if (!code) return { ok: false, code: '', desconto: 0, motivo: 'Nenhum cupom informado.' };
    const o = opcoes || {};
    const r = await cupomAoVivo(code, o.telefone, o.posPagamento);
    if (r === undefined) return validarCupom(code, subtotal);
    if (!r.ok) return { ok: false, code: code, desconto: 0, motivo: r.motivo || 'Cupom inválido ou expirado.' };
    return aplicarRegra({ tipo: r.tipo, valor: Number(r.valor), minimo: Number(r.minimo) || 0,
        tetoDesconto: Number(r.teto) || 0, rotulo: r.rotulo }, code, subtotal);
}

/** Desconto de uma regra {tipo, valor, minimo, tetoDesconto, rotulo} sobre o subtotal. */
function aplicarRegra(cupom, code, subtotal) {
    const sub = Number(subtotal) || 0;

    if (sub < (cupom.minimo || 0)) {
        return {
            ok: false,
            code: code,
            desconto: 0,
            motivo: 'Este cupom vale para compras a partir de ' + brl(cupom.minimo) + '.'
        };
    }

    let descontoCent;
    if (cupom.tipo === 'percentual') {
        descontoCent = Math.round(centavos(sub) * (Number(cupom.valor) / 100));
        if (cupom.tetoDesconto > 0) {
            descontoCent = Math.min(descontoCent, centavos(cupom.tetoDesconto));
        }
    } else {
        descontoCent = centavos(cupom.valor);
    }

    // Nunca deixa o total ficar negativo nem o desconto passar do subtotal.
    descontoCent = Math.max(0, Math.min(descontoCent, centavos(sub)));

    return {
        ok: descontoCent > 0,
        code: code,
        rotulo: cupom.rotulo || code,
        desconto: descontoCent / 100,
        motivo: descontoCent > 0 ? undefined : 'Cupom sem efeito para este valor.'
    };
}
