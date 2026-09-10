/**
 * Prime Imports — Criação da preference do Checkout Pro
 *
 * Vercel Serverless Function: POST /api/create-preference
 * Recebe a sacola (itens + endereço + código de cupom), confere tudo pelos
 * preços do servidor (api/_lib/catalogo.js e api/_lib/cupons.js) e cria uma
 * "preference" no Mercado Pago via SDK oficial, com o Access Token secreto
 * (nunca exposto no front-end — lido de process.env.MP_ACCESS_TOKEN).
 *
 * Devolve `init_point`: a URL do ambiente de pagamento do PRÓPRIO Mercado Pago
 * (cartão, Pix, boleto), para onde o navegador (js/checkout.js) redireciona.
 * Ao concluir, o cliente volta para checkout.html pelas `back_urls`.
 *
 * O valor e o desconto NUNCA vêm do navegador: são reconstruídos aqui, igual
 * ao fluxo antigo do Payment Brick.
 *
 * Configuração (Vercel → Project Settings → Environment Variables):
 *   MP_ACCESS_TOKEN  (obrigatória)
 *   PUBLIC_BASE_URL  (opcional) ex.: https://primeimportsbr.com.br — se ausente,
 *                    usa o protocolo/host da própria requisição.
 */

import { MercadoPagoConfig, Preference } from 'mercadopago';
import { validarSacola } from './_lib/catalogo.js';
import { validarCupom } from './_lib/cupons.js';
import { baseUrlDeRequest, montarPayer, itensPreferencia } from './_lib/checkout-pro.js';

const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

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
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch (e) { body = {}; }
        }

        var items = Array.isArray(body.items) ? body.items : [];
        var entrega = body.entrega && typeof body.entrega === 'object' ? body.entrega : {};

        // Reconstrói a sacola pelos preços do servidor. A partir daqui, o que o
        // cliente disse sobre preço não vale mais nada.
        var sacola = validarSacola(items);
        if (sacola.erros.length) {
            console.warn('Sacola recusada na validação:', sacola.erros.join(' | '));
            return res.status(400).json({
                error: 'Não foi possível conferir os itens da sacola. Volte à loja e monte o pedido novamente.',
                detail: sacola.erros
            });
        }
        if (sacola.divergencias.length) {
            console.warn(
                'Preço divergente do catálogo (cobrando o oficial):',
                JSON.stringify(sacola.divergencias)
            );
        }

        var subtotal = sacola.total;
        var total = subtotal;

        // Cupom: o cliente manda só o código; o desconto é decidido aqui.
        var cupom = validarCupom(body.cupom, subtotal);
        var descontoAplicado = 0;
        if (cupom.ok && cupom.desconto > 0) {
            descontoAplicado = cupom.desconto;
            total = Math.round((subtotal - cupom.desconto) * 100) / 100;
        } else if (body.cupom) {
            console.warn('Cupom recusado (' + (cupom.code || '(vazio)') + '):', cupom.motivo);
        }

        if (!(total > 0)) {
            return res.status(400).json({ error: 'Valor do pedido inválido.' });
        }

        var base = baseUrlDeRequest(req);
        var ehHttps = base.indexOf('https://') === 0;
        var referencia = 'PRIME-' + Date.now().toString(36).toUpperCase();

        var prefBody = {
            items: itensPreferencia(sacola.itens, total, descontoAplicado, cupom.code),
            payer: montarPayer(entrega),
            back_urls: {
                success: base + '/checkout.html?mp=success',
                failure: base + '/checkout.html?mp=failure',
                pending: base + '/checkout.html?mp=pending'
            },
            statement_descriptor: 'PRIMEIMPORTS',
            external_reference: referencia,
            metadata: {
                referencia: referencia,
                cupom: descontoAplicado > 0 ? cupom.code : null,
                subtotal: subtotal,
                total: total
            }
        };
        // auto_return exige back_urls https válidas; em `vercel dev` (http) o
        // Mercado Pago recusa a preference se mandarmos auto_return.
        if (ehHttps) prefBody.auto_return = 'approved';

        var preference = new Preference(client);
        var pref = await preference.create({ body: prefBody });

        var url = ehHttps
            ? (pref.init_point || pref.sandbox_init_point)
            : (pref.sandbox_init_point || pref.init_point);

        if (!url) {
            console.error('Preference criada sem init_point (id ' + (pref && pref.id) + ').');
            return res.status(502).json({ error: 'O Mercado Pago não retornou o link de pagamento. Tente novamente.' });
        }

        return res.status(201).json({
            id: pref.id,
            init_point: url,
            external_reference: referencia
        });
    } catch (err) {
        console.error('Erro ao criar preference no Mercado Pago:', err && err.message, err && err.cause);
        return res.status(500).json({
            error: 'Não foi possível iniciar o pagamento.',
            detail: err && err.message
        });
    }
}
