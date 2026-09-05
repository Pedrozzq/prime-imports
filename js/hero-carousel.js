// Carrossel premium do frasco em destaque na hero: crossfade suave entre fotos
// reais do catálogo, com indicadores (dots) clicáveis e pausa ao passar o mouse.
(function () {
    const stack = document.getElementById('hero-bottle-stack');
    const dotsWrap = document.getElementById('hero-bottle-dots');
    if (!stack || !dotsWrap) return;

    const imgs = Array.from(stack.querySelectorAll('.hero-bottle-img'));
    const dots = Array.from(dotsWrap.querySelectorAll('.hero-bottle-dot'));
    if (imgs.length < 2) return;

    const INTERVAL = 4000;
    let current = 0;
    let timer = null;

    const goTo = (index) => {
        if (index === current) return;
        imgs[current].classList.remove('is-active');
        dots[current].classList.remove('is-active');
        current = index;
        imgs[current].classList.add('is-active');
        dots[current].classList.add('is-active');
    };

    const next = () => goTo((current + 1) % imgs.length);

    const start = () => {
        stop();
        timer = setInterval(next, INTERVAL);
    };
    const stop = () => {
        if (timer) clearInterval(timer);
        timer = null;
    };

    dots.forEach((dot) => {
        dot.addEventListener('click', () => {
            goTo(Number(dot.dataset.index));
            start();
        });
    });

    const scene = stack.closest('.order-1');
    if (scene) {
        scene.addEventListener('mouseenter', stop);
        scene.addEventListener('mouseleave', start);
    }

    start();
})();
