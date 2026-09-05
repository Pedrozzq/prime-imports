/**
 * Prime Imports — Aviso de "checkout iniciado".
 *
 * Dispara um e-mail para a loja assim que o cliente chega em checkout.html,
 * ANTES de pagar, levando junto os dados de entrega e a sacola. Serve para
 * você saber quem está prestes a comprar e conseguir recuperar o pedido no
 * WhatsApp caso a pessoa desista no meio do pagamento.
 *
 * Usa a API HTTP do Resend (https://resend.com) via fetch nativo do Node 18+,
 * sem dependência extra no package.json.
 *
 * Variáveis de ambiente (Vercel → Project Settings → Environment Variables):
 *   RESEND_API_KEY      (obrigatória)  chave "re_..." gerada no painel do Resend
 *   CHECKOUT_EMAIL_TO   (opcional)     destino deste aviso; padrão = ORDER_EMAIL_TO
 *   ORDER_EMAIL_TO      (opcional)     destino dos pedidos; padrão lojaprimeimportsbr@gmail.com
 *   ORDER_EMAIL_FROM    (opcional)     remetente; padrão "Prime Imports BR <onboarding@resend.dev>"
 *   CHECKOUT_EMAIL_OFF  (opcional)     "1" desliga este aviso sem mexer no código
 *
 * Enquanto não houver domínio verificado no Resend, o remetente precisa ser
 * onboarding@resend.dev — ele só entrega para o e-mail dono da conta Resend
 * (lojaprimeimportsbr@gmail.com).
 */

import { escapeHtml, brl, agoraBR, linhaEndereco } from './order-email.js';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const DEFAULT_TO = 'lojaprimeimportsbr@gmail.com';
const DEFAULT_FROM = 'Prime Imports BR <onboarding@resend.dev>';
const WHATSAPP_BASE = 'https://wa.me/';

/** Deixa só os dígitos e prefixa 55 quando o número vem sem DDI. */
function foneWhatsapp(fone) {
    var digitos = String(fone || '').replace(/\D/g, '');
    if (!digitos) return null;
    if (digitos.length <= 11) digitos = '55' + digitos;
    return WHATSAPP_BASE + digitos;
}

/**
 * Monta assunto, HTML e texto puro do aviso de checkout iniciado.
 * @param {{items:Array, entrega:object, total:number}} dados
 */
export function montarEmailCheckout(dados) {
    var items = Array.isArray(dados.items) ? dados.items : [];
    var entrega = dados.entrega || {};
    var total = Number(dados.total) || 0;
    var cupom = dados.cupom && dados.cupom.desconto > 0 ? dados.cupom : null;
    var subtotal = Number(dados.subtotal) || (cupom ? total + cupom.desconto : total);

    var nomeCliente = entrega.nome || 'Cliente sem nome';
    var endereco = linhaEndereco(entrega);
    var linkZap = foneWhatsapp(entrega.fone);

    var assunto = '[CHECKOUT] ' + nomeCliente + ' está pagando — ' + brl(total);

    var linhasCupomHtml = cupom
        ? '<tr><td colspan="2" style="padding:6px 8px;color:#555">Subtotal</td>' +
          '<td style="padding:6px 8px;text-align:right;color:#555">' + brl(subtotal) + '</td></tr>' +
          '<tr><td colspan="2" style="padding:6px 8px;color:#15803d">Cupom ' + escapeHtml(cupom.code) +
          (cupom.rotulo ? ' <span style="color:#888">(' + escapeHtml(cupom.rotulo) + ')</span>' : '') + '</td>' +
          '<td style="padding:6px 8px;text-align:right;color:#15803d">-' + brl(cupom.desconto) + '</td></tr>'
        : '';

    var linhasHtml = items.length
        ? items.map(function (it) {
            var qtd = Number(it.qty) || 0;
            var preco = Number(it.price) || 0;
            return '<tr>' +
                '<td style="padding:10px 8px;border-bottom:1px solid #eee;">' + escapeHtml(it.name) +
                (it.brand ? '<br><span style="color:#888;font-size:12px">' + escapeHtml(it.brand) + '</span>' : '') +
                '</td>' +
                '<td style="padding:10px 8px;border-bottom:1px solid #eee;text-align:center;white-space:nowrap">' + qtd + 'x</td>' +
                '<td style="padding:10px 8px;border-bottom:1px solid #eee;text-align:right;white-space:nowrap">' + brl(preco * qtd) + '</td>' +
                '</tr>';
        }).join('')
        : '<tr><td colspan="3" style="padding:10px 8px;color:#888">Nenhum item enviado pelo checkout.</td></tr>';

    var blocoEntrega = endereco
        ? '<p style="margin:6px 0"><strong>' + escapeHtml(nomeCliente) + '</strong>' +
          (entrega.fone ? ' · ' + escapeHtml(entrega.fone) : '') + '</p>' +
          '<p style="margin:6px 0;color:#333">' + escapeHtml(endereco) + '</p>' +
          (linkZap
            ? '<p style="margin:10px 0"><a href="' + escapeHtml(linkZap) + '" style="display:inline-block;background:#128C7E;color:#fff;text-decoration:none;padding:8px 14px;border-radius:3px;font-size:13px">Chamar no WhatsApp</a></p>'
            : '')
        : '<p style="margin:6px 0;color:#b45309">Endereço não informado — a pessoa chegou ao checkout sem preencher a entrega.</p>';

    var html =
        '<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;color:#111">' +
        '<div style="background:#0a0a0a;color:#D4AF37;padding:18px 20px;font-size:18px;letter-spacing:2px">PRIME IMPORTS BR</div>' +
        '<div style="padding:20px;border:1px solid #eee;border-top:none">' +
        '<p style="margin:0 0 4px;font-size:13px;color:#666">' + escapeHtml(agoraBR()) + '</p>' +
        '<h2 style="margin:0 0 4px;font-size:20px">Checkout iniciado</h2>' +
        '<p style="margin:0 0 18px"><span style="display:inline-block;padding:4px 10px;border-radius:3px;color:#fff;font-size:12px;font-weight:bold;background:#b45309">AINDA NÃO PAGO</span></p>' +
        '<p style="margin:0 0 18px;font-size:14px;color:#444">Esta pessoa abriu a página de pagamento com a sacola abaixo. ' +
        'Se o pedido não chegar em seguida, ela desistiu no meio do caminho — vale um contato.</p>' +

        '<h3 style="font-size:14px;text-transform:uppercase;letter-spacing:1px;color:#666;margin:22px 0 8px">Itens na sacola</h3>' +
        '<table style="width:100%;border-collapse:collapse;font-size:14px">' + linhasHtml + linhasCupomHtml +
        '<tr><td colspan="2" style="padding:12px 8px;font-weight:bold">Total</td>' +
        '<td style="padding:12px 8px;text-align:right;font-weight:bold;font-size:16px">' + brl(total) + '</td></tr>' +
        '</table>' +

        '<h3 style="font-size:14px;text-transform:uppercase;letter-spacing:1px;color:#666;margin:22px 0 8px">Entrega</h3>' +
        blocoEntrega +

        '<p style="margin:22px 0 0;font-size:12px;color:#888">Aviso automático enviado quando o cliente abre o checkout. ' +
        'O e-mail do pedido (com status do pagamento) chega separadamente, só se ele concluir o pagamento.</p>' +
        '</div></div>';

    var linhasTexto = [
        'PRIME IMPORTS BR — Checkout iniciado (ainda não pago)',
        agoraBR(),
        '',
        'ITENS NA SACOLA',
        items.length
            ? items.map(function (it) {
                return '- ' + (Number(it.qty) || 0) + 'x ' + it.name + ' — ' + brl((Number(it.price) || 0) * (Number(it.qty) || 0));
            }).join('\n')
            : '- (nenhum item enviado)',
        '',
        cupom ? 'Subtotal: ' + brl(subtotal) : null,
        cupom ? 'Cupom ' + cupom.code + (cupom.rotulo ? ' (' + cupom.rotulo + ')' : '') + ': -' + brl(cupom.desconto) : null,
        'TOTAL: ' + brl(total),
        '',
        'ENTREGA',
        nomeCliente + (entrega.fone ? ' · ' + entrega.fone : ''),
        endereco || 'Endereço não informado no checkout.'
    ];

    if (linkZap) linhasTexto.push('WhatsApp: ' + linkZap);
    linhasTexto.push('', 'Se o e-mail do pedido não chegar em seguida, o pagamento não foi concluído.');

    var texto = linhasTexto.filter(function (linha) { return linha !== null; }).join('\n');

    return { assunto: assunto, html: html, texto: texto };
}

/**
 * Envia o aviso de checkout. Nunca lança: retorna {ok, skipped?, error?}
 * para que uma falha de e-mail jamais atrapalhe a página de pagamento.
 */
export async function enviarEmailCheckout(dados) {
    if (process.env.CHECKOUT_EMAIL_OFF === '1') {
        return { ok: false, skipped: true, error: 'CHECKOUT_EMAIL_OFF=1' };
    }

    var apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
        console.warn('RESEND_API_KEY ausente — aviso de checkout não enviado.');
        return { ok: false, skipped: true, error: 'RESEND_API_KEY ausente' };
    }

    var destino = (process.env.CHECKOUT_EMAIL_TO || process.env.ORDER_EMAIL_TO || DEFAULT_TO)
        .split(',')
        .map(function (s) { return s.trim(); })
        .filter(Boolean);
    var remetente = process.env.ORDER_EMAIL_FROM || DEFAULT_FROM;

    var email = montarEmailCheckout(dados);

    try {
        var resposta = await fetch(RESEND_ENDPOINT, {
            method: 'POST',
            headers: {
                Authorization: 'Bearer ' + apiKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                from: remetente,
                to: destino,
                subject: email.assunto,
                html: email.html,
                text: email.texto
            })
        });

        if (!resposta.ok) {
            var detalhe = await resposta.text().catch(function () { return ''; });
            console.error('Resend recusou o aviso de checkout:', resposta.status, detalhe);
            return { ok: false, error: 'Resend ' + resposta.status + ': ' + detalhe };
        }

        var json = await resposta.json().catch(function () { return {}; });
        console.log('Aviso de checkout enviado (Resend id:', json.id, ')');
        return { ok: true, id: json.id };
    } catch (err) {
        console.error('Falha ao enviar aviso de checkout:', err && err.message);
        return { ok: false, error: err && err.message };
    }
}
