/**
 * Prime Perfumes — Aviso de pagamento do Mercado Pago (webhook)
 *
 * Vercel Serverless Function: POST /api/mp-webhook
 * O endereço vai em `notification_url` na preference (api/create-preference.js).
 * O Mercado Pago chama aqui sempre que um pagamento é criado ou muda de status
 * (ex.: Pix pago minutos depois, estorno). A função busca o pagamento no
 * Mercado Pago (fonte da verdade — o corpo do aviso não é confiável) e grava
 * ou atualiza o pedido no CRM (api/_lib/crm.js):
 *   aprovado → "Novo" (baixa estoque e ml dos decants)
 *   pendente → "Aguardando pagamento"
 *   recusado/estornado → "Cancelado" (devolve o estoque)
 *
 * Responde 200 rápido para o Mercado Pago não reenviar sem parar; problemas
 * ficam nos logs da função.
 *
 * Configuração: MP_ACCESS_TOKEN e CRM_CHAVE (ver api/_lib/crm.js).
 */

import { MercadoPagoConfig, Payment } from 'mercadopago';
import { registrarPagamento, dadosDoPagamento } from './_lib/crm.js';

const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const client = ACCESS_TOKEN
    ? new MercadoPagoConfig({ accessToken: ACCESS_TOKEN, options: { timeout: 5000 } })
    : null;

function idDoAviso(req) {
    var q = req.query || {};
    var body = req.body || {};
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    var tipo = String(body.type || body.topic || q.type || q.topic || '');
    if (tipo && !/payment/.test(tipo)) return '';     // merchant_order etc.: ignora
    var id = (body.data && body.data.id) || q['data.id'] || q.id || '';
    if (!id && typeof body.resource === 'string') id = body.resource.split('/').pop();
    id = String(id).trim();
    return /^\d+$/.test(id) ? id : '';
}

export default async function handler(req, res) {
    if (req.method !== 'POST' && req.method !== 'GET') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ error: 'Método não permitido.' });
    }
    var id = idDoAviso(req);
    if (!id || !client) return res.status(200).json({ ok: true, ignorado: true });

    try {
        var payment = await new Payment(client).get({ id: id });
        var r = await registrarPagamento(dadosDoPagamento(payment, null));
        return res.status(200).json({ ok: !!(r && r.ok), numero: r && r.numero, status: r && r.status });
    } catch (err) {
        console.error('mp-webhook (pagamento ' + id + '):', err && err.message);
        return res.status(200).json({ ok: false });
    }
}
