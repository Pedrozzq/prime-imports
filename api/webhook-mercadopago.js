/**
 * Prime Imports — Webhook do Mercado Pago (notificação server-to-server)
 *
 * Vercel Serverless Function: POST /api/webhook-mercadopago
 *
 * O Checkout Pro já avisa a loja por e-mail quando o cliente VOLTA para o site
 * depois de pagar (api/confirm-order.js, disparado pelas back_urls). Mas quando
 * o cliente paga um Pix/boleto DEPOIS de fechar a aba — ou simplesmente não
 * retorna — esse retorno nunca acontece. Este endpoint é o caminho que não
 * depende do navegador: o Mercado Pago chama esta URL toda vez que um pagamento
 * muda de status.
 *
 * Fluxo:
 *   1. (Opcional) valida a assinatura `x-signature` com MP_WEBHOOK_SECRET.
 *   2. Extrai o id do pagamento da notificação (formato webhook ou IPN legado).
 *   3. Busca o pagamento no Mercado Pago (fonte da verdade).
 *   4. Se o status merece aviso (approved / refunded / charged_back), reconstrói
 *      o pedido a partir do `metadata` que api/create-preference.js gravou na
 *      preference e dispara o e-mail (api/_lib/order-email.js → Resend).
 *
 * Responde 200 no caminho normal para o Mercado Pago não ficar reenviando.
 * Só devolve erro (>=400) quando faz sentido o Mercado Pago tentar de novo
 * (falha ao buscar o pagamento) ou quando a chamada é inválida (assinatura
 * errada → 401).
 *
 * Configuração (Vercel → Project Settings → Environment Variables):
 *   MP_ACCESS_TOKEN   (obrigatória)
 *   MP_WEBHOOK_SECRET (opcional, recomendada) — chave secreta do webhook,
 *                     copiada do painel do Mercado Pago. Sem ela o endpoint
 *                     ainda funciona, mas aceita qualquer POST.
 *   RESEND_API_KEY, ORDER_EMAIL_TO, ORDER_EMAIL_FROM (para o e-mail do pedido)
 */

import crypto from 'node:crypto';
import { MercadoPagoConfig, Payment } from 'mercadopago';
import { enviarEmailPedido } from './_lib/order-email.js';
import { validarSacola } from './_lib/catalogo.js';
import { validarCupom } from './_lib/cupons.js';

const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const WEBHOOK_SECRET = process.env.MP_WEBHOOK_SECRET;

const client = ACCESS_TOKEN
    ? new MercadoPagoConfig({ accessToken: ACCESS_TOKEN, options: { timeout: 5000 } })
    : null;

// Status que geram e-mail para a loja. `approved` é o que interessa (Pix/boleto
// compensados); estorno e chargeback a loja também precisa saber. `pending`,
// `in_process`, `rejected` e afins não viram e-mail — ou já foram cobertos pelo
// aviso de checkout / retorno, ou seriam só ruído.
const STATUS_COM_EMAIL = ['approved', 'refunded', 'charged_back'];

// Dedupe best-effort: o Mercado Pago reenvia a mesma notificação várias vezes
// (e manda uma a cada mudança de status). Enquanto a função está "quente" na
// Vercel, esse Set evita reprocessar o mesmo par pagamento+status. Não é
// perfeito (instância nova = Set vazio), mas mata a enxurrada de retentativas.
const jaProcessados = new Set();

/** Lê o corpo como objeto, aceitando string JSON. */
function corpo(req) {
    var b = req.body || {};
    if (typeof b === 'string') {
        try { b = JSON.parse(b); } catch (e) { b = {}; }
    }
    return b && typeof b === 'object' ? b : {};
}

/**
 * Valida o header `x-signature` do Mercado Pago.
 * Doc: manifest = "id:<data.id>;request-id:<x-request-id>;ts:<ts>;" com
 * HMAC-SHA256(segredo) conferido contra o campo v1 da assinatura.
 * Sem MP_WEBHOOK_SECRET configurado, não dá para validar — segue em frente.
 */
function assinaturaOk(req) {
    if (!WEBHOOK_SECRET) return { ok: true, checou: false };

    var header = String((req.headers && req.headers['x-signature']) || '');
    var requestId = String((req.headers && req.headers['x-request-id']) || '');
    var partes = {};
    header.split(',').forEach(function (kv) {
        var i = kv.indexOf('=');
        if (i > 0) partes[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
    });
    var ts = partes.ts;
    var v1 = partes.v1;
    if (!ts || !v1) return { ok: false, checou: true };

    var q = req.query || {};
    var dataId = String(q['data.id'] || q.id || '');
    // Mercado Pago manda usar minúsculo quando o id tem letras.
    if (/[a-zA-Z]/.test(dataId)) dataId = dataId.toLowerCase();

    var manifest = 'id:' + dataId + ';request-id:' + requestId + ';ts:' + ts + ';';
    var esperado = crypto.createHmac('sha256', WEBHOOK_SECRET).update(manifest).digest('hex');

    var a = Buffer.from(esperado, 'utf8');
    var b = Buffer.from(v1, 'utf8');
    var ok = a.length === b.length && crypto.timingSafeEqual(a, b);
    return { ok: ok, checou: true };
}

/** Extrai { tipo, paymentId } dos formatos de notificação do Mercado Pago. */
function alvoDaNotificacao(req, body) {
    var q = req.query || {};
    var tipo = String(q.type || q.topic || body.type || body.topic || '').toLowerCase();

    var bruto = q['data.id'] || q.id ||
        (body.data && body.data.id) || body.id || '';
    var paymentId = String(bruto).replace(/\D/g, '');

    return { tipo: tipo, paymentId: paymentId };
}

/** Monta os campos de pagamento que o e-mail do pedido espera. */
function pagamentoParaEmail(payment, paymentId) {
    return {
        id: payment.id != null ? payment.id : (paymentId || 's/ id'),
        status: payment.status || 'pending',
        status_detail: payment.status_detail || 'webhook',
        payment_method_id: payment.payment_method_id || '',
        payment_type_id: payment.payment_type_id || '',
        installments: payment.installments || null,
        payer: payment.payer || null
    };
}

function formDataSintetico(payment) {
    return {
        payment_method_id: payment.payment_method_id || '',
        installments: payment.installments || undefined,
        payer: payment.payer
            ? {
                email: payment.payer.email,
                first_name: payment.payer.first_name,
                last_name: payment.payer.last_name,
                identification: payment.payer.identification
            }
            : {}
    };
}

/**
 * Reconstrói itens/subtotal/total a partir do `metadata` da preference. O preço
 * volta a ser lido do catálogo (validarSacola) — o que veio no metadata é só id
 * e quantidade. Se o metadata não vier utilizável, cai para o que o próprio
 * Mercado Pago informa (additional_info.items + transaction_amount).
 */
function reconstruirPedido(payment) {
    var meta = (payment && payment.metadata) || {};
    var entrega = meta.entrega && typeof meta.entrega === 'object' ? meta.entrega : {};

    var sacola = validarSacola(Array.isArray(meta.sacola) ? meta.sacola : []);
    if (!sacola.erros.length && sacola.itens.length) {
        var subtotal = sacola.total;
        var cupom = validarCupom(meta.cupom, subtotal);
        var cupomAplicado = (cupom.ok && cupom.desconto > 0) ? cupom : null;
        var total = cupomAplicado
            ? Math.round((subtotal - cupomAplicado.desconto) * 100) / 100
            : subtotal;
        return { itens: sacola.itens, entrega: entrega, subtotal: subtotal, cupom: cupomAplicado, total: total };
    }

    // Fallback: metadata inutilizável. Usa o que o Mercado Pago devolve.
    var infoItens = (payment && payment.additional_info && payment.additional_info.items) || [];
    var itens = infoItens.map(function (it) {
        return {
            name: it.title || it.id || 'Item',
            brand: '',
            price: Number(it.unit_price) || 0,
            qty: Number(it.quantity) || 1
        };
    });
    var valor = Number(payment && payment.transaction_amount) || 0;
    return { itens: itens, entrega: entrega, subtotal: valor, cupom: null, total: valor };
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ error: 'Método não permitido. Use POST.' });
    }

    if (!client) {
        console.error('webhook-mercadopago: MP_ACCESS_TOKEN não configurado.');
        return res.status(500).json({ error: 'Configuração de pagamento ausente no servidor.' });
    }

    var assinatura = assinaturaOk(req);
    if (!assinatura.ok) {
        console.warn('webhook-mercadopago: assinatura x-signature inválida — chamada recusada.');
        return res.status(401).json({ error: 'Assinatura inválida.' });
    }
    if (!assinatura.checou) {
        console.warn('webhook-mercadopago: MP_WEBHOOK_SECRET ausente — aceitando sem validar a assinatura.');
    }

    var body = corpo(req);
    var alvo = alvoDaNotificacao(req, body);

    // Só tratamos pagamentos. merchant_order, plan, subscription etc. → ok, ignora.
    if (alvo.tipo && alvo.tipo !== 'payment') {
        return res.status(200).json({ ok: true, ignored: alvo.tipo });
    }
    if (!alvo.paymentId) {
        console.warn('webhook-mercadopago: notificação sem id de pagamento.', JSON.stringify(body).slice(0, 300));
        return res.status(200).json({ ok: true, ignored: 'sem-id' });
    }

    // Busca o pagamento. Falha aqui → 500 para o Mercado Pago tentar de novo.
    var payment;
    try {
        payment = await new Payment(client).get({ id: alvo.paymentId });
    } catch (err) {
        console.error('webhook-mercadopago: erro ao buscar pagamento ' + alvo.paymentId + ':', err && err.message);
        return res.status(500).json({ error: 'Não foi possível consultar o pagamento.' });
    }

    var status = (payment && payment.status) || 'unknown';

    if (STATUS_COM_EMAIL.indexOf(status) === -1) {
        return res.status(200).json({ ok: true, id: alvo.paymentId, status: status, emailed: false });
    }

    var chave = alvo.paymentId + ':' + status;
    if (jaProcessados.has(chave)) {
        return res.status(200).json({ ok: true, id: alvo.paymentId, status: status, duplicate: true });
    }
    jaProcessados.add(chave);
    if (jaProcessados.size > 500) jaProcessados.clear();

    try {
        var pedido = reconstruirPedido(payment);

        await enviarEmailPedido({
            payment: pagamentoParaEmail(payment, alvo.paymentId),
            formData: formDataSintetico(payment),
            items: pedido.itens,
            entrega: pedido.entrega,
            subtotal: pedido.subtotal,
            cupom: pedido.cupom,
            total: pedido.total
        });

        console.log('webhook-mercadopago: e-mail enviado (pagamento ' + alvo.paymentId + ', status ' + status + ').');
        return res.status(200).json({ ok: true, id: alvo.paymentId, status: status, emailed: true });
    } catch (err) {
        // Já marcamos a chave como processada; libera para uma retentativa valer.
        jaProcessados.delete(chave);
        console.error('webhook-mercadopago: erro ao montar/enviar o e-mail do pedido:', err && err.message);
        return res.status(500).json({ error: 'Falha ao processar a notificação.' });
    }
}
