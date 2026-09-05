/**
 * Prime Imports — Montagem e envio do e-mail de pedido.
 *
 * Usa a API HTTP do Resend (https://resend.com) via fetch nativo do Node 18+,
 * sem dependência extra no package.json.
 *
 * Variáveis de ambiente (Vercel → Project Settings → Environment Variables):
 *   RESEND_API_KEY   (obrigatória)  chave "re_..." gerada no painel do Resend
 *   ORDER_EMAIL_TO   (opcional)     destino; padrão lojaprimeimportsbr@gmail.com
 *   ORDER_EMAIL_FROM (opcional)     remetente; padrão "Prime Imports BR <onboarding@resend.dev>"
 *
 * Enquanto você não verificar um domínio próprio no Resend, mantenha o
 * remetente onboarding@resend.dev — ele só entrega para o e-mail dono da conta
 * Resend, que deve ser justamente o lojaprimeimportsbr@gmail.com.
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const DEFAULT_TO = 'lojaprimeimportsbr@gmail.com';
const DEFAULT_FROM = 'Prime Imports BR <onboarding@resend.dev>';

export function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
}

export function brl(value) {
    var n = Number(value) || 0;
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function agoraBR() {
    return new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

/** Rótulo humano para o status do Mercado Pago. */
function rotuloStatus(status) {
    var mapa = {
        approved: 'PAGO',
        pending: 'AGUARDANDO PAGAMENTO',
        in_process: 'EM ANÁLISE',
        authorized: 'AUTORIZADO',
        rejected: 'RECUSADO',
        cancelled: 'CANCELADO',
        refunded: 'ESTORNADO'
    };
    return mapa[status] || String(status || 'DESCONHECIDO').toUpperCase();
}

function corStatus(status) {
    if (status === 'approved' || status === 'authorized') return '#15803d';
    if (status === 'pending' || status === 'in_process') return '#b45309';
    return '#b91c1c';
}

function rotuloMetodo(payment, formData) {
    var id = payment.payment_method_id || (formData && formData.payment_method_id) || '';
    var tipo = payment.payment_type_id || '';
    if (id === 'pix' || tipo === 'bank_transfer') return 'Pix';
    if (tipo === 'ticket' || id === 'bolbradesco') return 'Boleto';
    var parcelas = Number(payment.installments || (formData && formData.installments) || 0);
    var base = tipo === 'debit_card' ? 'Cartão de débito' : 'Cartão de crédito';
    if (id) base += ' (' + id + ')';
    if (parcelas > 1) base += ' — ' + parcelas + 'x';
    return base;
}

export function linhaEndereco(entrega) {
    if (!entrega || !entrega.rua) return null;
    var partes = [];
    partes.push(entrega.rua + (entrega.numero ? ', ' + entrega.numero : ''));
    if (entrega.complemento) partes.push(entrega.complemento);
    if (entrega.bairro) partes.push(entrega.bairro);
    var cidadeUf = [entrega.cidade, (entrega.uf || '').toUpperCase()].filter(Boolean).join('/');
    if (cidadeUf) partes.push(cidadeUf);
    if (entrega.cep) partes.push('CEP ' + entrega.cep);
    return partes.join(' · ');
}

/**
 * Monta assunto, HTML e texto puro do e-mail do pedido.
 * @param {{payment:object, formData:object, items:Array, entrega:object, total:number}} dados
 */
export function montarEmailPedido(dados) {
    var payment = dados.payment || {};
    var formData = dados.formData || {};
    var items = Array.isArray(dados.items) ? dados.items : [];
    var entrega = dados.entrega || {};
    var total = Number(dados.total) || 0;

    var status = payment.status || 'desconhecido';
    var pedidoId = payment.id != null ? String(payment.id) : 's/ id';
    var nomeCliente = entrega.nome
        || [formData.payer && formData.payer.first_name, formData.payer && formData.payer.last_name].filter(Boolean).join(' ')
        || 'Cliente';
    var emailPagador = (formData.payer && formData.payer.email) || payment.payer && payment.payer.email || '—';
    var doc = formData.payer && formData.payer.identification;
    var documento = doc && doc.number ? (doc.type || 'DOC') + ' ' + doc.number : '—';
    var metodo = rotuloMetodo(payment, formData);
    var endereco = linhaEndereco(entrega);

    var assunto = '[' + rotuloStatus(status) + '] Pedido #' + pedidoId + ' — ' + nomeCliente + ' — ' + brl(total);

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
        ? '<p style="margin:6px 0"><strong>' + escapeHtml(entrega.nome || nomeCliente) + '</strong>' +
          (entrega.fone ? ' · ' + escapeHtml(entrega.fone) : '') + '</p>' +
          '<p style="margin:6px 0;color:#333">' + escapeHtml(endereco) + '</p>'
        : '<p style="margin:6px 0;color:#b45309">Endereço não informado no checkout — combine a entrega com o cliente.</p>';

    var html =
        '<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;color:#111">' +
        '<div style="background:#0a0a0a;color:#D4AF37;padding:18px 20px;font-size:18px;letter-spacing:2px">PRIME IMPORTS BR</div>' +
        '<div style="padding:20px;border:1px solid #eee;border-top:none">' +
        '<p style="margin:0 0 4px;font-size:13px;color:#666">' + escapeHtml(agoraBR()) + '</p>' +
        '<h2 style="margin:0 0 4px;font-size:20px">Pedido #' + escapeHtml(pedidoId) + '</h2>' +
        '<p style="margin:0 0 18px"><span style="display:inline-block;padding:4px 10px;border-radius:3px;color:#fff;font-size:12px;font-weight:bold;background:' + corStatus(status) + '">' + escapeHtml(rotuloStatus(status)) + '</span>' +
        (payment.status_detail ? ' <span style="color:#666;font-size:12px">' + escapeHtml(payment.status_detail) + '</span>' : '') +
        '</p>' +

        '<h3 style="font-size:14px;text-transform:uppercase;letter-spacing:1px;color:#666;margin:22px 0 8px">Itens</h3>' +
        '<table style="width:100%;border-collapse:collapse;font-size:14px">' + linhasHtml +
        '<tr><td colspan="2" style="padding:12px 8px;font-weight:bold">Total</td>' +
        '<td style="padding:12px 8px;text-align:right;font-weight:bold;font-size:16px">' + brl(total) + '</td></tr>' +
        '</table>' +

        '<h3 style="font-size:14px;text-transform:uppercase;letter-spacing:1px;color:#666;margin:22px 0 8px">Entrega</h3>' +
        blocoEntrega +

        '<h3 style="font-size:14px;text-transform:uppercase;letter-spacing:1px;color:#666;margin:22px 0 8px">Pagamento</h3>' +
        '<p style="margin:6px 0;font-size:14px">Forma: <strong>' + escapeHtml(metodo) + '</strong></p>' +
        '<p style="margin:6px 0;font-size:14px">E-mail do pagador: ' + escapeHtml(emailPagador) + '</p>' +
        '<p style="margin:6px 0;font-size:14px">Documento: ' + escapeHtml(documento) + '</p>' +
        '<p style="margin:16px 0 0;font-size:12px;color:#888">Acompanhe em mercadopago.com.br → Atividade → pagamento ' + escapeHtml(pedidoId) + '.</p>' +
        '</div></div>';

    var texto = [
        'PRIME IMPORTS BR — Pedido #' + pedidoId,
        agoraBR(),
        'Status: ' + rotuloStatus(status) + (payment.status_detail ? ' (' + payment.status_detail + ')' : ''),
        '',
        'ITENS',
        items.length
            ? items.map(function (it) {
                return '- ' + (Number(it.qty) || 0) + 'x ' + it.name + ' — ' + brl((Number(it.price) || 0) * (Number(it.qty) || 0));
            }).join('\n')
            : '- (nenhum item enviado)',
        '',
        'TOTAL: ' + brl(total),
        '',
        'ENTREGA',
        (entrega.nome || nomeCliente) + (entrega.fone ? ' · ' + entrega.fone : ''),
        endereco || 'Endereço não informado no checkout.',
        '',
        'PAGAMENTO',
        'Forma: ' + metodo,
        'E-mail do pagador: ' + emailPagador,
        'Documento: ' + documento
    ].join('\n');

    return { assunto: assunto, html: html, texto: texto };
}

/**
 * Envia o e-mail do pedido. Nunca lança: retorna {ok, skipped?, error?}
 * para que uma falha de e-mail jamais derrube a resposta do pagamento.
 */
export async function enviarEmailPedido(dados) {
    var apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
        console.warn('RESEND_API_KEY ausente — e-mail do pedido não enviado.');
        return { ok: false, skipped: true, error: 'RESEND_API_KEY ausente' };
    }

    var destino = (process.env.ORDER_EMAIL_TO || DEFAULT_TO)
        .split(',')
        .map(function (s) { return s.trim(); })
        .filter(Boolean);
    var remetente = process.env.ORDER_EMAIL_FROM || DEFAULT_FROM;

    var email = montarEmailPedido(dados);
    var replyTo = dados.formData && dados.formData.payer && dados.formData.payer.email;

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
                text: email.texto,
                reply_to: replyTo || undefined
            })
        });

        if (!resposta.ok) {
            var detalhe = await resposta.text().catch(function () { return ''; });
            console.error('Resend recusou o envio:', resposta.status, detalhe);
            return { ok: false, error: 'Resend ' + resposta.status + ': ' + detalhe };
        }

        var json = await resposta.json().catch(function () { return {}; });
        console.log('E-mail do pedido enviado (Resend id:', json.id, ')');
        return { ok: true, id: json.id };
    } catch (err) {
        console.error('Falha ao enviar e-mail do pedido:', err && err.message);
        return { ok: false, error: err && err.message };
    }
}
