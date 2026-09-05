/**
 * Prime Imports — Checkout Mercado Pago (Payment Brick)
 * Incluir em checkout.html, depois de: js/cart.js e
 * <script src="https://sdk.mercadopago.com/js/v2"></script>
 *
 * Lê o carrinho e o endereço salvos pela loja (localStorage), renderiza o resumo
 * do pedido + dados de entrega e monta o Payment Brick, que recolhe os dados de
 * pagamento (cartão, Pix, etc.) e os envia para api/create-payments.js — que por
 * sua vez cria o pagamento e dispara o e-mail do pedido para a loja.
 *
 * Ao carregar a página também avisa a loja por e-mail (api/notify-checkout.js)
 * que o cliente chegou ao pagamento, com a sacola e o endereço de entrega —
 * uma vez por sacola/sessão, para que recarregar a página não gere spam.
 */
(function () {
    'use strict';

    // Public Key é segura para expor no front-end (ao contrário do Access Token).
    var MP_PUBLIC_KEY = 'APP_USR-7707b052-4d3c-4e64-88fa-17d2b24b781b';
    var CREATE_PAYMENT_URL = '/api/create-payments';
    var NOTIFY_CHECKOUT_URL = '/api/notify-checkout';
    var STORAGE_KEY = 'prime_imports_cart';
    var ENTREGA_KEY = 'prime_imports_entrega';
    var AVISADO_KEY = 'prime_imports_checkout_avisado';

    if (typeof MercadoPago === 'undefined') {
        console.error('SDK do Mercado Pago não carregado. Inclua <script src="https://sdk.mercadopago.com/js/v2"></script> antes de js/checkout.js.');
        showStatus('error', 'Não foi possível carregar o checkout. Recarregue a página.');
        return;
    }

    var mp = new MercadoPago(MP_PUBLIC_KEY, { locale: 'pt-BR' });
    var brickController = null;

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

    function formatBRL(value) {
        return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    }

    function escapeHtml(str) {
        return String(str == null ? '' : str).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function renderSummary(items) {
        var listEl = document.getElementById('checkout-summary-items');
        var totalEl = document.getElementById('checkout-summary-total');
        if (!listEl) return;

        if (!items.length) {
            listEl.innerHTML = '<p class="text-brand-gray text-sm">Sua sacola está vazia.</p>';
        } else {
            listEl.innerHTML = items.map(function (it) {
                return '<div class="flex justify-between items-center gap-4 text-sm py-3 border-b border-white/10">' +
                    '<span class="text-white">' + it.qty + 'x ' + escapeHtml(it.name) + '</span>' +
                    '<span class="text-brand-gray whitespace-nowrap">' + formatBRL(it.qty * it.price) + '</span>' +
                    '</div>';
            }).join('');
        }
        if (totalEl) totalEl.textContent = formatBRL(getSubtotal(items));
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

    function renderPixExtras(payment) {
        var poi = payment.point_of_interaction;
        var data = poi && poi.transaction_data;
        if (!data) return '';
        var img = data.qr_code_base64
            ? '<img src="data:image/png;base64,' + data.qr_code_base64 + '" alt="QR Code Pix" class="mx-auto my-4 w-48 h-48 bg-white p-2 rounded-sm">'
            : '';
        var code = data.qr_code
            ? '<textarea readonly class="w-full text-xs p-2 bg-black/40 border border-white/10 rounded-sm text-brand-gray" rows="3" onclick="this.select()">' + escapeHtml(data.qr_code) + '</textarea>'
            : '';
        return '<div class="mt-3 text-center">' +
            '<p class="mb-2">Escaneie o QR Code ou copie o código Pix abaixo para concluir o pagamento:</p>' +
            img + code +
            '</div>';
    }

    function limparSacola() {
        try {
            localStorage.removeItem(STORAGE_KEY);
            localStorage.removeItem(ENTREGA_KEY);
            sessionStorage.removeItem(AVISADO_KEY);
        } catch (e) {}
    }

    function handlePaymentResult(payment) {
        if (payment.status === 'approved') {
            showStatus('success', '<strong>Pagamento aprovado!</strong> Pedido #' + payment.id + '. Em breve entraremos em contato pelo WhatsApp com os detalhes de envio.');
            limparSacola();
            if (window.PrimeCart && typeof window.PrimeCart.close === 'function') window.PrimeCart.close();
        } else if (payment.status === 'pending' || payment.status === 'in_process') {
            showStatus('pending', '<strong>Pagamento em processamento</strong> (pedido #' + payment.id + ').' + renderPixExtras(payment));
        } else {
            showStatus('error', '<strong>Pagamento não aprovado.</strong> Motivo: ' + escapeHtml(payment.status_detail || payment.status || 'desconhecido') + '. Tente novamente ou use outro meio de pagamento.');
        }
    }

    /**
     * Assinatura simples da sacola + endereço. Serve só para não avisar duas
     * vezes o mesmo checkout quando o cliente recarrega a página ou volta.
     */
    function assinaturaCheckout(items, entrega) {
        var itensStr = items.map(function (it) {
            return String(it.id || it.name) + ':' + it.qty + ':' + it.price;
        }).join('|');
        return itensStr + '#' + [entrega.nome, entrega.cep, entrega.numero].join('~');
    }

    function jaAvisou(assinatura) {
        try {
            return sessionStorage.getItem(AVISADO_KEY) === assinatura;
        } catch (e) {
            return false;
        }
    }

    function marcarAvisado(assinatura) {
        try {
            sessionStorage.setItem(AVISADO_KEY, assinatura);
        } catch (e) {}
    }

    /**
     * Avisa a loja que o cliente chegou ao pagamento. É best-effort: qualquer
     * falha some no console e o checkout segue normalmente.
     */
    function avisarCheckout(items, entrega) {
        if (!items.length) return;
        if (getSubtotal(items) <= 0) return;

        var assinatura = assinaturaCheckout(items, entrega);
        if (jaAvisou(assinatura)) return;
        marcarAvisado(assinatura);

        fetch(NOTIFY_CHECKOUT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: items, entrega: entrega }),
            keepalive: true
        }).catch(function (err) {
            console.warn('Não foi possível avisar a loja sobre o checkout:', err && err.message);
        });
    }

    function initBrick(items, entrega) {
        var container = document.getElementById('paymentBrick_container');
        if (!container) return;

        var amount = getSubtotal(items);
        if (amount <= 0) {
            container.innerHTML = '<p class="text-brand-gray text-sm">Adicione produtos à sacola antes de continuar para o pagamento.</p>';
            return;
        }

        mp.bricks().create('payment', 'paymentBrick_container', {
            initialization: {
                amount: amount
            },
            customization: {
                visual: {
                    style: { theme: 'dark' }
                },
                paymentMethods: {
                    creditCard: 'all',
                    debitCard: 'all',
                    bankTransfer: 'all', // Pix
                    maxInstallments: 12
                }
            },
            callbacks: {
                onReady: function () {},
                onSubmit: function (data) {
                    var formData = data.formData;
                    return new Promise(function (resolve, reject) {
                        fetch(CREATE_PAYMENT_URL, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ formData: formData, items: items, entrega: entrega })
                        })
                        .then(function (res) {
                            return res.json().then(function (json) { return { ok: res.ok, json: json }; });
                        })
                        .then(function (result) {
                            if (!result.ok) {
                                showStatus('error', 'Não foi possível processar o pagamento: ' + escapeHtml(result.json.error || 'erro desconhecido') + '.');
                                reject();
                                return;
                            }
                            handlePaymentResult(result.json);
                            resolve();
                        })
                        .catch(function (err) {
                            console.error('Erro de conexão ao criar pagamento:', err);
                            showStatus('error', 'Erro de conexão ao processar o pagamento. Tente novamente.');
                            reject(err);
                        });
                    });
                },
                onError: function (error) {
                    console.error('Erro no Payment Brick:', error);
                    showStatus('error', 'Ocorreu um erro ao carregar o formulário de pagamento. Recarregue a página.');
                }
            }
        }).then(function (controller) {
            brickController = controller;
        });
    }

    function init() {
        var items = getCartItems();
        var entrega = getEntrega();
        renderSummary(items);
        renderEntrega(entrega);
        avisarCheckout(items, entrega);
        initBrick(items, entrega);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
