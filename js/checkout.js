/**
 * Prime Imports — Checkout Mercado Pago (Checkout Pro)
 * Incluir em checkout.html, depois de js/cart.js.
 *
 * O pagamento acontece na PÁGINA DO PRÓPRIO MERCADO PAGO:
 *
 *  1. A página lê o carrinho + endereço + cupom salvos pela loja (localStorage)
 *     e mostra o resumo do pedido.
 *  2. No botão "Pagar", envia a sacola para /api/create-preference, que confere
 *     os preços no servidor e devolve um `init_point`.
 *  3. O navegador é redirecionado para esse `init_point` (ambiente do Mercado
 *     Pago: cartão, Pix, boleto).
 *  4. Ao concluir, o Mercado Pago devolve o cliente para
 *     checkout.html?mp=success|failure|pending (+ payment_id na URL). Aqui a
 *     página mostra o resultado, chama /api/confirm-order (que busca o
 *     pagamento no Mercado Pago e dispara o e-mail do pedido) e limpa a sacola.
 *
 * Ao carregar a página (fora das telas de retorno) também avisa a loja por
 * e-mail (/api/notify-checkout) que o cliente chegou ao pagamento — uma vez por
 * sacola/sessão, para que recarregar a página não gere spam.
 */
(function () {
    'use strict';

    var CREATE_PREFERENCE_URL = '/api/create-preference';
    var CONFIRM_ORDER_URL = '/api/confirm-order';
    var NOTIFY_CHECKOUT_URL = '/api/notify-checkout';
    var STORAGE_KEY = 'prime_imports_cart';
    var ENTREGA_KEY = 'prime_imports_entrega';
    var CUPOM_KEY = 'prime_imports_cupom';
    var AVISADO_KEY = 'prime_imports_checkout_avisado';
    var CONFIRMADO_PREFIX = 'prime_imports_pedido_confirmado_';

    /* ------------------------------------------------------------------ *
     *  Leitura da sacola / endereço / cupom                             *
     * ------------------------------------------------------------------ */

    function getCartItems() {
        if (window.PrimeCart && typeof window.PrimeCart.get === 'function') {
            var doCarrinho = window.PrimeCart.get();
            if (doCarrinho && doCarrinho.length) return doCarrinho;
        }
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch (e) {
            return [];
        }
    }

    /**
     * Cupom aplicado na sacola do index.html. É só para exibição: quem decide
     * o desconto de verdade é o servidor (api/_lib/cupons.js). Aqui usamos
     * `desconto` apenas para mostrar o valor certo no resumo.
     */
    function getCupom(items) {
        try {
            var raw = localStorage.getItem(CUPOM_KEY);
            var obj = raw ? JSON.parse(raw) : null;
            if (!obj || !obj.code) return null;
            var desconto = Number(obj.desconto) || 0;
            var subtotal = getSubtotal(items || []);
            if (desconto <= 0 || desconto >= subtotal) return null;
            return { code: String(obj.code), rotulo: obj.rotulo || String(obj.code), desconto: desconto };
        } catch (e) {
            return null;
        }
    }

    /** Endereço salvo na sacola da loja (modal "Dados de entrega" do index.html). */
    function getEntrega() {
        try {
            var raw = localStorage.getItem(ENTREGA_KEY);
            var obj = raw ? JSON.parse(raw) : null;
            return obj && typeof obj === 'object' ? obj : {};
        } catch (e) {
            return {};
        }
    }

    function getSubtotal(items) {
        return items.reduce(function (sum, it) { return sum + it.qty * it.price; }, 0);
    }

    /* ------------------------------------------------------------------ *
     *  Utilidades de exibição                                           *
     * ------------------------------------------------------------------ */

    function formatBRL(value) {
        return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    }

    function escapeHtml(str) {
        return String(str == null ? '' : str).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function renderSummary(items, cupom) {
        var listEl = document.getElementById('checkout-summary-items');
        var totalEl = document.getElementById('checkout-summary-total');
        if (!listEl) return;

        if (!items.length) {
            listEl.innerHTML = '<p class="text-brand-gray text-sm">Sua sacola está vazia.</p>';
        } else {
            var linhas = items.map(function (it) {
                return '<div class="flex justify-between items-center gap-4 text-sm py-3 border-b border-white/10">' +
                    '<span class="text-white">' + it.qty + 'x ' + escapeHtml(it.name) + '</span>' +
                    '<span class="text-brand-gray whitespace-nowrap">' + formatBRL(it.qty * it.price) + '</span>' +
                    '</div>';
            }).join('');

            if (cupom) {
                linhas += '<div class="flex justify-between items-center gap-4 text-sm pt-3">' +
                        '<span class="text-brand-gray">Subtotal</span>' +
                        '<span class="text-brand-gray whitespace-nowrap">' + formatBRL(getSubtotal(items)) + '</span>' +
                    '</div>' +
                    '<div class="flex justify-between items-center gap-4 text-sm py-1 text-green-400">' +
                        '<span>Cupom ' + escapeHtml(cupom.code) + '</span>' +
                        '<span class="whitespace-nowrap">-' + formatBRL(cupom.desconto) + '</span>' +
                    '</div>';
            }
            listEl.innerHTML = linhas;
        }

        var total = getSubtotal(items) - (cupom ? cupom.desconto : 0);
        if (totalEl) totalEl.textContent = formatBRL(total > 0 ? total : 0);
    }

    /** Mostra para onde o pedido será enviado — ou avisa que falta o endereço. */
    function renderEntrega(entrega) {
        var box = document.getElementById('checkout-entrega');
        if (!box) return;

        if (!entrega || !entrega.nome || !entrega.rua) {
            box.innerHTML = '<p class="text-yellow-300/90 text-xs leading-relaxed">' +
                '<i class="fa-solid fa-triangle-exclamation mr-1"></i>' +
                'Endereço de entrega não informado. <a href="index.html" class="underline hover:text-brand-gold">Volte à sacola</a> e preencha os dados de entrega antes de pagar.' +
                '</p>';
            return;
        }

        var linha2 = escapeHtml(entrega.rua) + (entrega.numero ? ', ' + escapeHtml(entrega.numero) : '') +
            (entrega.complemento ? ' — ' + escapeHtml(entrega.complemento) : '');
        var linha3 = [entrega.bairro, entrega.cidade ? entrega.cidade + '/' + String(entrega.uf || '').toUpperCase() : '', entrega.cep ? 'CEP ' + entrega.cep : '']
            .filter(Boolean).map(escapeHtml).join(' · ');

        box.innerHTML =
            '<h3 class="text-brand-gray text-xs uppercase tracking-widest mb-2">Entrega</h3>' +
            '<p class="text-white text-sm">' + escapeHtml(entrega.nome) + (entrega.fone ? ' <span class="text-brand-gray">· ' + escapeHtml(entrega.fone) + '</span>' : '') + '</p>' +
            '<p class="text-brand-gray text-xs mt-1 leading-relaxed">' + linha2 + '<br>' + linha3 + '</p>' +
            '<a href="index.html" class="text-brand-gold text-xs underline mt-2 inline-block hover:text-brand-gold-light">Alterar endereço</a>';
    }

    function showStatus(type, html) {
        var box = document.getElementById('checkout-status');
        if (!box) return;
        var palette = {
            success: 'bg-green-500/10 border-green-500/40 text-green-300',
            pending: 'bg-yellow-500/10 border-yellow-500/40 text-yellow-300',
            error: 'bg-red-500/10 border-red-500/40 text-red-300'
        };
        box.className = 'mt-6 p-4 rounded-sm text-sm border ' + (palette[type] || palette.error);
        box.innerHTML = html;
        box.classList.remove('hidden');
        box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    function setPayButton(label, disabled) {
        var btn = document.getElementById('checkout-pay-btn');
        var lbl = document.getElementById('checkout-pay-label');
        if (lbl) lbl.textContent = label;
        if (btn) btn.disabled = !!disabled;
    }

    function limparSacola() {
        try {
            localStorage.removeItem(STORAGE_KEY);
            localStorage.removeItem(ENTREGA_KEY);
            localStorage.removeItem(CUPOM_KEY);
            sessionStorage.removeItem(AVISADO_KEY);
        } catch (e) {}
    }

    /* ------------------------------------------------------------------ *
     *  Aviso "cliente chegou ao checkout" (best-effort)                 *
     * ------------------------------------------------------------------ */

    function assinaturaCheckout(items, entrega, cupom) {
        var itensStr = items.map(function (it) {
            return String(it.id || it.name) + ':' + it.qty + ':' + it.price;
        }).join('|');
        return itensStr + '#' + [entrega.nome, entrega.cep, entrega.numero].join('~') +
            '#' + (cupom ? cupom.code : '');
    }

    function avisarCheckout(items, entrega, cupom) {
        if (!items.length || getSubtotal(items) <= 0) return;

        var assinatura = assinaturaCheckout(items, entrega, cupom);
        try {
            if (sessionStorage.getItem(AVISADO_KEY) === assinatura) return;
            sessionStorage.setItem(AVISADO_KEY, assinatura);
        } catch (e) {}

        fetch(NOTIFY_CHECKOUT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: items, entrega: entrega, cupom: cupom ? cupom.code : undefined }),
            keepalive: true
        }).catch(function (err) {
            console.warn('Não foi possível avisar a loja sobre o checkout:', err && err.message);
        });
    }

    /* ------------------------------------------------------------------ *
     *  Fluxo 1 — montar o pedido e ir para o Mercado Pago               *
     * ------------------------------------------------------------------ */

    function iniciarPagamento(items, entrega, cupom) {
        if (!items.length || getSubtotal(items) <= 0) {
            showStatus('error', 'Sua sacola está vazia. <a class="underline" href="index.html">Volte à loja</a> para montar o pedido.');
            return;
        }

        setPayButton('Redirecionando para o Mercado Pago…', true);

        fetch(CREATE_PREFERENCE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                items: items,
                entrega: entrega,
                cupom: cupom ? cupom.code : undefined
            })
        })
        .then(function (res) {
            return res.json().then(function (json) { return { ok: res.ok, json: json }; });
        })
        .then(function (result) {
            if (!result.ok || !result.json || !result.json.init_point) {
                showStatus('error', 'Não foi possível iniciar o pagamento: ' +
                    escapeHtml((result.json && result.json.error) || 'erro desconhecido') + '.');
                setPayButton('Tentar novamente', false);
                return;
            }
            window.location.href = result.json.init_point;
        })
        .catch(function (err) {
            console.error('Erro de conexão ao criar a preference:', err);
            showStatus('error', 'Erro de conexão ao iniciar o pagamento. Tente novamente.');
            setPayButton('Tentar novamente', false);
        });
    }

    function montarTelaPagamento() {
        var items = getCartItems();
        var entrega = getEntrega();
        var cupom = getCupom(items);

        renderSummary(items, cupom);
        renderEntrega(entrega);
        avisarCheckout(items, entrega, cupom);

        var total = getSubtotal(items) - (cupom ? cupom.desconto : 0);
        var btn = document.getElementById('checkout-pay-btn');

        if (!items.length || total <= 0) {
            setPayButton('Sacola vazia', true);
            return;
        }

        setPayButton('Pagar ' + formatBRL(total) + ' com Mercado Pago', false);
        if (btn) {
            btn.addEventListener('click', function () {
                iniciarPagamento(getCartItems(), getEntrega(), getCupom(getCartItems()));
            });
        }
    }

    /* ------------------------------------------------------------------ *
     *  Fluxo 2 — retorno do Mercado Pago (?mp=success|failure|pending)  *
     * ------------------------------------------------------------------ */

    function confirmarPedido(paymentId, externalRef) {
        // Evita e-mail duplicado se o cliente recarregar a tela de "obrigado".
        var chave = CONFIRMADO_PREFIX + (paymentId || externalRef || 'sem-id');
        try {
            if (localStorage.getItem(chave) === '1') { limparSacola(); return; }
        } catch (e) {}

        var items = getCartItems();
        var entrega = getEntrega();
        var cupom = getCupom(items);

        fetch(CONFIRM_ORDER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                payment_id: paymentId || undefined,
                external_reference: externalRef || undefined,
                items: items,
                entrega: entrega,
                cupom: cupom ? cupom.code : undefined
            }),
            keepalive: true
        })
        .catch(function (err) {
            console.warn('Não foi possível confirmar o pedido:', err && err.message);
        })
        .then(function () {
            try { localStorage.setItem(chave, '1'); } catch (e) {}
            limparSacola();
            if (window.PrimeCart && typeof window.PrimeCart.close === 'function') window.PrimeCart.close();
        });
    }

    function esconderCaixaPagamento() {
        var box = document.getElementById('checkout-pay-box');
        if (box) box.hidden = true;
    }

    function tratarRetorno(params) {
        var mp = params.get('mp');
        var paymentId = params.get('payment_id') || params.get('collection_id') || '';
        var statusMp = params.get('status') || params.get('collection_status') || '';
        var externalRef = params.get('external_reference') || '';

        // Mostra o resumo (do que ainda houver) só como referência visual.
        var items = getCartItems();
        renderSummary(items, getCupom(items));
        renderEntrega(getEntrega());
        esconderCaixaPagamento();

        if (mp === 'success' || statusMp === 'approved') {
            showStatus('success',
                '<strong>Pagamento aprovado!</strong> ' +
                (paymentId ? 'Pedido #' + escapeHtml(paymentId) + '. ' : '') +
                'Em breve entraremos em contato pelo WhatsApp com os detalhes de envio. ' +
                '<a class="underline" href="index.html">Voltar à loja</a>');
            confirmarPedido(paymentId, externalRef);
            return;
        }

        if (mp === 'pending' || statusMp === 'pending' || statusMp === 'in_process') {
            showStatus('pending',
                '<strong>Pagamento em processamento.</strong> ' +
                (paymentId ? 'Pedido #' + escapeHtml(paymentId) + '. ' : '') +
                'Assim que o Mercado Pago confirmar (Pix/boleto costumam levar alguns minutos), seu pedido entra na fila de envio. ' +
                '<a class="underline" href="index.html">Voltar à loja</a>');
            confirmarPedido(paymentId, externalRef);
            return;
        }

        // failure / rejected / qualquer outra coisa: mantém a sacola e deixa tentar de novo.
        var box = document.getElementById('checkout-pay-box');
        if (box) box.hidden = false;
        showStatus('error',
            '<strong>Pagamento não concluído.</strong> Nenhum valor foi cobrado. ' +
            'Revise os dados e tente novamente, ou use outro meio de pagamento.');
        montarTelaPagamento();
    }

    /* ------------------------------------------------------------------ *
     *  Boot                                                             *
     * ------------------------------------------------------------------ */

    function init() {
        var params = new URLSearchParams(window.location.search);
        if (params.get('mp')) {
            tratarRetorno(params);
        } else {
            montarTelaPagamento();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
