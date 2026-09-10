/**
 * Prime Imports — Confirmação do pedido após o Checkout Pro
 *
 * Vercel Serverless Function: POST /api/confirm-order
 * Chamada por js/checkout.js quando o cliente volta do Mercado Pago pela
 * back_url de sucesso (ou de pendente, no caso de Pix/boleto). Recebe o
 * `payment_id` que o Mercado Pago anexou na URL de retorno e a sacola que
 * ainda está no navegador.
 *
 * Busca o pagamento no Mercado Pago (fonte da verdade), reconfere a sacola
 * pelos preços do servidor e dispara o e-mail do pedido para a loja
 * (api/_lib/order-email.js → Resend).
 *
 * Responde sempre 200 para não travar a tela de "obrigado" do cliente —
 * qualquer problema fica só nos logs da função. O aviso de "cliente chegou ao
 * checkout" continua em api/notify-checkout.js, então mesmo que este passo
 * falhe a loja já foi avisada da intenção de compra.
 *
 * Configuração (Vercel → Project Settings → Environment Variables):
 *   MP_ACCESS_TOKEN, RESEND_API_KEY, ORDER_EMAIL_TO, ORDER_EMAIL_FROM
 */

import { MercadoPagoConfig, Payment } from 'mercadopago';
import { enviarEmailPedido } from './_lib/order-email.js';
import { validarSacola } from './_lib/catalogo.js';
import { validarCupom } from './_lib/cupons.js';

const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

const client = ACCESS_TOKEN
    ? new MercadoPagoConfig({ accessToken: ACCESS_TOKEN, options: { timeout: 5000 } })
    : null;

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ error: 'Método não permitido. Use POST.' });
    }

    try {
        var body = req.body || {};
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch (e) { body = {}; }
        }

        var paymentId = String(body.payment_id || body.paymentId || '').trim();
        var items = Array.isArray(body.items) ? body.items : [];
        var entrega = body.entrega && typeof body.entrega === 'object' ? body.entrega : {};

        // Pagamento real no Mercado Pago (quando temos um id numérico e token).
        var payment = {};
        if (client && /^\d+$/.test(paymentId)) {
            try {
                var p = new Payment(client);
                payment = await p.get({ id: paymentId });
            } catch (e) {
                console.warn('Não foi possível buscar o pagamento ' + paymentId + ':', e && e.message);
            }
        }

        // Reconstrói a sacola pelos preços do servidor (mesma regra do checkout).
        var sacola = validarSacola(items);
        if (sacola.erros.length || !sacola.itens.length) {
            console.warn(
                'confirm-order sem sacola válida (payment ' + (paymentId || 's/ id') + '):',
                sacola.erros.join(' | ')
            );
            return res.status(200).json({
                ok: false,
                status: payment.status || 'unknown',
                reason: 'sacola-invalida'
            });
        }

        var subtotal = sacola.total;
        var total = subtotal;
        var cupom = validarCupom(body.cupom, subtotal);
        var cupomAplicado = (cupom.ok && cupom.desconto > 0) ? cupom : null;
        if (cupomAplicado) {
            total = Math.round((subtotal - cupomAplicado.desconto) * 100) / 100;
        }

        var pagamentoParaEmail = {
            id: payment.id != null ? payment.id : (paymentId || body.external_reference || 's/ id'),
            status: payment.status || 'pending',
            status_detail: payment.status_detail || 'retorno_checkout_pro',
            payment_method_id: payment.payment_method_id || '',
            payment_type_id: payment.payment_type_id || '',
            installments: payment.installments || null,
            payer: payment.payer || null
        };

        var formDataSintetico = {
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

        await enviarEmailPedido({
            payment: pagamentoParaEmail,
            formData: formDataSintetico,
            items: sacola.itens,
            entrega: entrega,
            subtotal: subtotal,
            cupom: cupomAplicado,
            total: total
        });

        return res.status(200).json({
            ok: true,
            id: pagamentoParaEmail.id,
            status: pagamentoParaEmail.status
        });
    } catch (err) {
        console.error('Erro em confirm-order:', err && err.message);
        return res.status(200).json({ ok: false, error: err && err.message });
    }
}
