/**
 * Prime Imports — Criação de pagamentos (Mercado Pago Payment Brick)
 *
 * Vercel Serverless Function: POST /api/create-payments
 * Recebe o `formData` gerado pelo Payment Brick (js/checkout.js) e cria o
 * pagamento via SDK oficial do Mercado Pago, usando o Access Token secreto
 * (nunca exposto no front-end — lido de process.env.MP_ACCESS_TOKEN).
 *
 * O valor cobrado NUNCA vem do navegador: api/_lib/catalogo.js reconstrói a
 * sacola a partir da tabela de preços do servidor (gerada do index.html por
 * "npm run catalogo"). O `price` enviado pelo cliente é descartado — no máximo
 * vira um aviso no log quando não bate.
 *
 * Depois de criar o pagamento, envia o resumo do pedido por e-mail para a loja
 * (api/_lib/order-email.js → Resend). Uma falha no e-mail nunca derruba o
 * pagamento: ela só aparece nos logs da função.
 *
 * Configuração necessária (não versionada):
 *   - Local: preencha ".env" (veja ".env.example").
 *   - Vercel: Project Settings → Environment Variables:
 *       MP_ACCESS_TOKEN, RESEND_API_KEY, ORDER_EMAIL_TO, ORDER_EMAIL_FROM
 */

import crypto from 'node:crypto';
import { MercadoPagoConfig, Payment } from 'mercadopago';
import { enviarEmailPedido } from './_lib/order-email.js';
import { validarSacola } from './_lib/catalogo.js';
import { validarCupom } from './_lib/cupons.js';

const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

// Config/cliente só é criado se o token existir — evita crash na cold start
// e permite responder com um erro claro caso a env var não esteja setada.
const client = ACCESS_TOKEN
    ? new MercadoPagoConfig({ accessToken: ACCESS_TOKEN, options: { timeout: 5000 } })
    : null;

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ error: 'Método não permitido. Use POST.' });
    }

    if (!client) {
        console.error('MP_ACCESS_TOKEN não configurado nas variáveis de ambiente.');
        return res.status(500).json({ error: 'Configuração de pagamento ausente no servidor.' });
    }

    try {
        var body = req.body || {};
        var formData = body.formData || body; // aceita tanto {formData:{...}} quanto o formData "cru"
        var items = Array.isArray(body.items) ? body.items : [];
        var entrega = body.entrega && typeof body.entrega === 'object' ? body.entrega : {};

        if (!formData || !formData.payment_method_id || !formData.transaction_amount) {
            return res.status(400).json({ error: 'Dados de pagamento incompletos.' });
        }

        // Reconstrói a sacola pelos preços do servidor. A partir daqui, `items`
        // e `formData.transaction_amount` do cliente não valem mais nada.
        var sacola = validarSacola(items);

        if (sacola.erros.length) {
            console.warn('Sacola recusada na validação:', sacola.erros.join(' | '));
            return res.status(400).json({
                error: 'Não foi possível conferir os itens da sacola. Volte à loja e monte o pedido novamente.',
                detail: sacola.erros
            });
        }

        // Preço adulterado não derruba a compra — ela segue pelo valor correto —,
        // mas fica registrado para você ver quem tentou.
        if (sacola.divergencias.length) {
            console.warn(
                'Preço divergente do catálogo (cobrando o oficial):',
                JSON.stringify(sacola.divergencias)
            );
        }

        items = sacola.itens;
        var subtotal = sacola.total;
        var transactionAmount = subtotal;

        // Cupom: o cliente manda só o código; o desconto é decidido aqui.
        // Um código inválido não derruba a compra — ela segue pelo valor cheio.
        var cupom = validarCupom(body.cupom, subtotal);
        if (cupom.ok && cupom.desconto > 0) {
            transactionAmount = Math.round((subtotal - cupom.desconto) * 100) / 100;
        } else if (body.cupom) {
            console.warn('Cupom recusado (' + (cupom.code || '(vazio)') + '):', cupom.motivo);
        }

        if (!(transactionAmount > 0)) {
            return res.status(400).json({ error: 'Valor do pedido inválido.' });
        }

        var paymentBody = {
            transaction_amount: transactionAmount,
            description: 'Compra Prime Imports BR',
            payment_method_id: formData.payment_method_id,
            payer: {
                email: formData.payer && formData.payer.email,
                identification: formData.payer && formData.payer.identification
                    ? {
                        type: formData.payer.identification.type,
                        number: formData.payer.identification.number
                    }
                    : undefined,
                first_name: formData.payer && formData.payer.first_name,
                last_name: formData.payer && formData.payer.last_name
            }
        };

        // Campos exclusivos de cartão (crédito/débito) — Pix e boleto não os enviam.
        if (formData.token) paymentBody.token = formData.token;
        if (formData.issuer_id) paymentBody.issuer_id = formData.issuer_id;
        if (formData.installments) paymentBody.installments = Number(formData.installments);

        var payment = new Payment(client);
        var result = await payment.create({
            body: paymentBody,
            requestOptions: { idempotencyKey: crypto.randomUUID() }
        });

        // Aviso de pedido para a loja. Aguardamos o envio porque, em serverless,
        // trabalho iniciado depois da resposta pode ser cortado — mas o resultado
        // não interfere no que o cliente recebe.
        await enviarEmailPedido({
            payment: result,
            formData: formData,
            items: items,
            entrega: entrega,
            subtotal: subtotal,
            cupom: (cupom.ok && cupom.desconto > 0) ? cupom : null,
            total: transactionAmount
        });

        return res.status(201).json({
            id: result.id,
            status: result.status,
            status_detail: result.status_detail,
            payment_method_id: result.payment_method_id,
            point_of_interaction: result.point_of_interaction || null
        });
    } catch (err) {
        console.error('Erro ao criar pagamento no Mercado Pago:', err && err.message, err && err.cause);
        return res.status(500).json({
            error: 'Não foi possível processar o pagamento.',
            detail: err && err.message
        });
    }
}
