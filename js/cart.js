/**
 * Prime Imports — Carrinho de compras (client-side, localStorage).
 * Incluir em toda página com: <script src="js/cart.js" defer></script>
 * Botões de compra devem ter: data-cart-add, data-cart-id, data-cart-name,
 * data-cart-brand, data-cart-price (número), data-cart-image.
 */
(function () {
    'use strict';

    // Número de WhatsApp da loja (formato: 55 + DDD + número) — igual ao usado no index.html.
    var WHATSAPP_NUMBER = '5521996931199';

    var STORAGE_KEY = 'prime_imports_cart';

    function loadCart() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch (e) {
            return [];
        }
    }

    function saveCart(items) {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); } catch (e) {}
    }

    var cartItems = loadCart();

    function formatBRL(value) {
        return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    }

    function findItem(id) {
        for (var i = 0; i < cartItems.length; i++) {
            if (cartItems[i].id === id) return cartItems[i];
        }
        return null;
    }

    function addItem(product) {
        var existing = findItem(product.id);
        if (existing) {
            existing.qty += 1;
        } else {
            cartItems.push({
                id: product.id,
                name: product.name,
                brand: product.brand,
                price: product.price,
                image: product.image,
                qty: 1
            });
        }
        saveCart(cartItems);
        renderCart();
        updateBadge();
        showToast(product.name);
        openDrawer();
    }

    function setQty(id, qty) {
        var item = findItem(id);
        if (!item) return;
        item.qty = qty;
        if (item.qty <= 0) {
            cartItems = cartItems.filter(function (it) { return it.id !== id; });
        }
        saveCart(cartItems);
        renderCart();
        updateBadge();
    }

    function removeItem(id) {
        cartItems = cartItems.filter(function (it) { return it.id !== id; });
        saveCart(cartItems);
        renderCart();
        updateBadge();
    }

    function getCount() {
        return cartItems.reduce(function (sum, it) { return sum + it.qty; }, 0);
    }

    function getSubtotal() {
        return cartItems.reduce(function (sum, it) { return sum + it.qty * it.price; }, 0);
    }

    // --- UI: injeta o painel do carrinho e o toast uma vez, no carregamento da página ---
    function injectMarkup() {
        var drawer = document.createElement('div');
        drawer.id = 'cart-drawer-root';
        drawer.innerHTML =
            '<div id="cart-overlay" class="fixed inset-0 bg-black/70 backdrop-blur-sm z-[90] hidden transition-opacity duration-300"></div>' +
            '<aside id="cart-drawer" class="fixed top-0 right-0 h-full w-full sm:w-[420px] bg-brand-dark border-l border-white/10 z-[95] flex flex-col translate-x-full transition-transform duration-300 ease-out shadow-2xl">' +
                '<div class="flex items-center justify-between px-6 py-5 border-b border-white/10">' +
                    '<h3 class="font-serif text-xl text-white tracking-wide">Sua Sacola</h3>' +
                    '<button id="cart-close-btn" class="btn-venus-solid w-9 h-9 rounded-full bg-white/5 hover:bg-brand-gold text-brand-gray hover:text-black flex items-center justify-center text-lg"><i class="fa-solid fa-xmark"></i></button>' +
                '</div>' +
                '<div id="cart-items" class="flex-1 overflow-y-auto px-6 py-4 space-y-5"></div>' +
                '<div id="cart-footer" class="border-t border-white/10 px-6 py-5 space-y-4">' +
                    '<div class="flex justify-between items-center text-sm uppercase tracking-wider text-brand-gray">' +
                        '<span>Subtotal</span>' +
                        '<span id="cart-subtotal" class="text-white font-semibold text-lg tracking-tighter font-sans normal-case">R$ 0,00</span>' +
                    '</div>' +
                    '<a id="cart-checkout-btn" href="checkout.html" class="btn-venus-solid w-full bg-brand-gold hover:bg-brand-gold-dark text-black font-semibold py-4 rounded-sm transition-all duration-300 uppercase tracking-wider text-sm flex items-center justify-center gap-2">' +
                        '<i class="fa-solid fa-lock text-sm"></i> Finalizar Compra' +
                    '</a>' +
                    '<a id="cart-whatsapp-btn" href="#" target="_blank" rel="noopener" class="btn-venus w-full py-3 text-xs flex items-center justify-center gap-2">' +
                        '<i class="fa-brands fa-whatsapp"></i> Combinar pelo WhatsApp' +
                    '</a>' +
                    '<button id="cart-continue-btn" class="btn-venus w-full py-3 text-xs">Continuar Comprando</button>' +
                '</div>' +
            '</aside>' +
            '<div id="cart-toast" class="fixed bottom-6 left-1/2 -translate-x-1/2 bg-brand-black border border-brand-gold/40 text-white text-sm px-6 py-3 rounded-sm shadow-2xl z-[100] opacity-0 pointer-events-none transition-all duration-300 flex items-center gap-3 whitespace-nowrap">' +
                '<i class="fa-solid fa-circle-check text-brand-gold"></i><span id="cart-toast-text"></span>' +
            '</div>';
        document.body.appendChild(drawer);

        document.getElementById('cart-close-btn').addEventListener('click', closeDrawer);
        document.getElementById('cart-continue-btn').addEventListener('click', closeDrawer);
        document.getElementById('cart-overlay').addEventListener('click', closeDrawer);
    }

    function renderCart() {
        var itemsEl = document.getElementById('cart-items');
        var subtotalEl = document.getElementById('cart-subtotal');
        var waBtn = document.getElementById('cart-whatsapp-btn');
        if (!itemsEl) return;

        if (!cartItems.length) {
            itemsEl.innerHTML = '<div class="h-full flex flex-col items-center justify-center text-center py-16">' +
                '<i class="fa-solid fa-bag-shopping text-3xl text-white/10 mb-4"></i>' +
                '<p class="text-brand-gray text-sm">Sua sacola está vazia.</p>' +
                '</div>';
        } else {
            itemsEl.innerHTML = cartItems.map(function (it) {
                return '<div class="flex gap-4 items-center">' +
                    '<div class="w-16 h-16 bg-white/5 rounded-sm overflow-hidden flex items-center justify-center shrink-0">' +
                        '<img src="' + it.image + '" alt="' + escapeHtml(it.name) + '" class="w-full h-full object-cover mix-blend-lighten">' +
                    '</div>' +
                    '<div class="flex-1 min-w-0">' +
                        '<p class="text-brand-gold text-[10px] uppercase tracking-widest">' + escapeHtml(it.brand) + '</p>' +
                        '<p class="text-white text-sm font-medium truncate">' + escapeHtml(it.name) + '</p>' +
                        '<p class="text-brand-gray text-xs mt-1">' + formatBRL(it.price) + '</p>' +
                    '</div>' +
                    '<div class="flex flex-col items-end gap-2 shrink-0">' +
                        '<button class="cart-remove-btn text-brand-gray hover:text-red-400 text-xs transition-all duration-300 hover:-translate-y-0.5" data-id="' + it.id + '"><i class="fa-solid fa-trash-can"></i></button>' +
                        '<div class="flex items-center border border-white/10 rounded-sm overflow-hidden">' +
                            '<button class="cart-qty-btn w-6 h-6 flex items-center justify-center text-brand-gray hover:bg-brand-gold hover:text-black text-xs transition-all duration-300" data-id="' + it.id + '" data-delta="-1">-</button>' +
                            '<span class="w-6 text-center text-xs text-white">' + it.qty + '</span>' +
                            '<button class="cart-qty-btn w-6 h-6 flex items-center justify-center text-brand-gray hover:bg-brand-gold hover:text-black text-xs transition-all duration-300" data-id="' + it.id + '" data-delta="1">+</button>' +
                        '</div>' +
                    '</div>' +
                '</div>';
            }).join('');

            itemsEl.querySelectorAll('.cart-qty-btn').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    var id = btn.getAttribute('data-id');
                    var delta = parseInt(btn.getAttribute('data-delta'), 10);
                    var item = findItem(id);
                    if (item) setQty(id, item.qty + delta);
                });
            });
            itemsEl.querySelectorAll('.cart-remove-btn').forEach(function (btn) {
                btn.addEventListener('click', function () { removeItem(btn.getAttribute('data-id')); });
            });
        }

        var subtotal = getSubtotal();
        if (subtotalEl) subtotalEl.textContent = formatBRL(subtotal);
        if (waBtn) {
            waBtn.href = buildWhatsappLink();
            waBtn.classList.toggle('pointer-events-none', !cartItems.length);
            waBtn.classList.toggle('opacity-40', !cartItems.length);
        }
        var checkoutBtn = document.getElementById('cart-checkout-btn');
        if (checkoutBtn) {
            checkoutBtn.classList.toggle('pointer-events-none', !cartItems.length);
            checkoutBtn.classList.toggle('opacity-40', !cartItems.length);
        }
    }

    function buildWhatsappLink() {
        if (!cartItems.length) return '#';
        var lines = ['Olá! Quero finalizar meu pedido na Prime Imports:', ''];
        cartItems.forEach(function (it) {
            lines.push('• ' + it.qty + 'x ' + it.brand + ' — ' + it.name + ' (' + formatBRL(it.price) + ' cada)');
        });
        lines.push('');
        lines.push('Subtotal: ' + formatBRL(getSubtotal()));
        var text = encodeURIComponent(lines.join('\n'));
        return 'https://wa.me/' + WHATSAPP_NUMBER + '?text=' + text;
    }

    function escapeHtml(str) {
        return String(str).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function updateBadge() {
        var count = getCount();
        document.querySelectorAll('[data-cart-badge]').forEach(function (el) {
            el.textContent = count;
            el.classList.toggle('hidden', count === 0);
        });
    }

    var toastTimer = null;
    function showToast(name) {
        var toast = document.getElementById('cart-toast');
        var text = document.getElementById('cart-toast-text');
        if (!toast || !text) return;
        text.textContent = name + ' adicionado à sacola';
        toast.classList.remove('opacity-0');
        toast.style.transform = 'translate(-50%, -8px)';
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () {
            toast.classList.add('opacity-0');
            toast.style.transform = 'translate(-50%, 0)';
        }, 2600);
    }

    function openDrawer() {
        document.getElementById('cart-overlay').classList.remove('hidden');
        requestAnimationFrame(function () {
            document.getElementById('cart-drawer').classList.remove('translate-x-full');
        });
        document.body.style.overflow = 'hidden';
    }

    function closeDrawer() {
        document.getElementById('cart-drawer').classList.add('translate-x-full');
        document.getElementById('cart-overlay').classList.add('hidden');
        document.body.style.overflow = '';
    }

    function wireAddButtons() {
        document.querySelectorAll('[data-cart-add]').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                var price = parseFloat(btn.getAttribute('data-cart-price'));
                addItem({
                    id: btn.getAttribute('data-cart-id'),
                    name: btn.getAttribute('data-cart-name'),
                    brand: btn.getAttribute('data-cart-brand'),
                    price: isNaN(price) ? 0 : price,
                    image: btn.getAttribute('data-cart-image')
                });
            });
        });
        document.querySelectorAll('[data-cart-open]').forEach(function (btn) {
            btn.addEventListener('click', function (e) { e.preventDefault(); openDrawer(); });
        });
    }

    function init() {
        injectMarkup();
        renderCart();
        updateBadge();
        wireAddButtons();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.PrimeCart = {
        add: addItem,
        open: openDrawer,
        close: closeDrawer,
        get: function () { return cartItems.slice(); },
        subtotal: getSubtotal
    };
})();
