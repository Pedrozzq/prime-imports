/**
 * Prime Imports — Aviso de checkout iniciado
 *
 * Vercel Serverless Function: POST /api/notify-checkout
 * Chamada por js/checkout.js assim que a página de pagamento carrega, antes
 * de qualquer tentativa de pagamento. Envia para a loja um e-mail com a sacola
 * e os dados de entrega (api/_lib/checkout-email.js → Resend).
 *
 * Responde 202 mesmo quando o e-mail falha: este aviso é acessório e não pode
 * atrapalhar o checkout do cliente. Erros ficam nos logs da função.
 *
 * Configuração (Vercel → Project Settings → Environment Variables):
 *   RESEND_API_KEY, CHECKOUT_EMAIL_TO (opcional), ORDER_EMAIL_TO, ORDER_EMAIL_FROM
 */

import { enviarEmailCheckout } from './_lib/checkout-email.js';
import { validarSacola } from './_lib/catalogo.js';

const MAX_ITENS = 50;
const CAMPOS_ENTREGA = ['nome', 'fone', 'cep', 'rua', 'numero', 'complemento', 'bairro', 'cidade', 'uf'];

/** Corta strings vindas do navegador para não deixar o e-mail virar depósito de lixo. */
function texto(valor, limite) {
    return String(valor == null ? '' : valor).slice(0, limite || 120).trim();
}

function normalizarItens(bruto) {
    if (!Array.isArray(bruto)) return [];
    return bruto.slice(0, MAX_ITENS).map(function (it) {
        it = it && typeof it === 'object' ? it : {};
        return {
            name: texto(it.name, 160) || 'Item sem nome',
            brand: texto(it.brand, 80),
            price: Number(it.price) || 0,
            qty: Math.max(0, Math.min(999, Number(it.qty) || 0))
        };
    });
}

function normalizarEntrega(bruto) {
    var origem = bruto && typeof bruto === 'object' ? bruto : {};
    var limpo = {};
    CAMPOS_ENTREGA.forEach(function (campo) {
        var valor = texto(origem[campo], campo === 'rua' || campo === 'complemento' ? 160 : 80);
        if (valor) limpo[campo] = valor;
    });
    return limpo;
}

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

        var items = normalizarItens(body.items);
        var entrega = normalizarEntrega(body.entrega);

        // Quando os itens batem com o catálogo, o aviso usa os preços oficiais —
        // assim o e-mail nunca mostra um total adulterado pelo navegador. Se algo
        // não bater, segue com o que veio, porque este aviso é informativo e não
        // pode deixar de chegar.
        var conferida = validarSacola(body.items);
        if (!conferida.erros.length && conferida.itens.length) {
            items = conferida.itens;
        }

        // Sacola vazia = nada de útil para avisar (e evita disparo por robô/varredura).
        var total = items.reduce(function (soma, it) { return soma + it.price * it.qty; }, 0);
        if (!items.length || total <= 0) {
            return res.status(204).end();
        }

        var resultado = await enviarEmailCheckout({ items: items, entrega: entrega, total: total });

        return res.status(202).json({ ok: !!resultado.ok, skipped: !!resultado.skipped });
    } catch (err) {
        console.error('Erro no aviso de checkout:', err && err.message);
        // Nunca devolve erro para o navegador: o checkout não pode quebrar por causa disso.
        return res.status(202).json({ ok: false });
    }
}
