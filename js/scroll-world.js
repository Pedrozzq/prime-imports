/**
 * Prime Imports — "scroll-world" leve (sem geração de vídeo por IA).
 * Recria a sensação de voar de uma cena para outra ao rolar a página,
 * usando só transformações CSS acionadas por scroll (rAF).
 *
 * Uso: <div class="sw-root" data-scroll-world>
 *        <section class="sw-scene" data-sw-scene>
 *          <div class="sw-sticky">
 *            <div class="sw-bg" style="background-image:url(...)"></div>
 *            <div class="sw-bg-shade"></div>
 *            <div class="sw-content">...</div>
 *          </div>
 *        </section>
 *        ... mais cenas ...
 *      </div>
 */
(function () {
    'use strict';

    // Efeito cinematográfico sempre ativo, independente da preferência de movimento reduzido do sistema.
    var reduceMotion = false;

    function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

    // Curva suave de entrada/saída: cena aparece nos primeiros 22% do progresso,
    // fica estável no meio, e começa a sumir nos últimos 22% — é essa sobreposição
    // com o CSS "margin-top negativo" entre cenas que gera o crossfade contínuo.
    function fadeCurve(progress) {
        var IN = 0.22, OUT = 0.78;
        if (progress < IN) return progress / IN;
        if (progress > OUT) return 1 - (progress - OUT) / (1 - OUT);
        return 1;
    }

    function initScrollWorld(root) {
        var scenes = Array.prototype.slice.call(root.querySelectorAll('[data-sw-scene]'));
        if (!scenes.length) return;

        var items = scenes.map(function (scene) {
            return {
                el: scene,
                bg: scene.querySelector('.sw-bg'),
                content: scene.querySelector('.sw-content')
            };
        });

        var ticking = false;

        function update() {
            ticking = false;
            var vh = window.innerHeight;

            items.forEach(function (item) {
                var rect = item.el.getBoundingClientRect();
                var total = rect.height - vh;
                if (total <= 0) return;

                var progress = clamp(-rect.top / total, 0, 1);
                var visibility = fadeCurve(progress);

                if (reduceMotion) {
                    if (item.content) item.content.style.opacity = visibility;
                    return;
                }

                if (item.bg) {
                    var scale = 1.15 - 0.15 * progress;
                    var drift = (0.5 - progress) * 26;
                    item.bg.style.transform = 'scale(' + scale.toFixed(3) + ') translateY(' + drift.toFixed(1) + 'px)';
                    item.bg.style.opacity = visibility;
                }
                if (item.content) {
                    var contentShift = (1 - visibility) * 28;
                    item.content.style.opacity = visibility;
                    item.content.style.transform = 'translateY(' + contentShift.toFixed(1) + 'px)';
                }
            });
        }

        function onScroll() {
            if (!ticking) {
                requestAnimationFrame(update);
                ticking = true;
            }
        }

        window.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('resize', onScroll);
        update();
    }

    function init() {
        document.querySelectorAll('[data-scroll-world]').forEach(initScrollWorld);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
