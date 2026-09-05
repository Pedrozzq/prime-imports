// Smooth scroll (Lenis) sincronizado com o ticker do GSAP — padrão recomendado
// pela própria documentação do Lenis para evitar dois loops de rAF concorrentes.
(function () {
    if (typeof Lenis === 'undefined') return;

    const lenis = new Lenis({ autoRaf: false });

    if (typeof gsap !== 'undefined' && gsap.ticker) {
        gsap.ticker.add((time) => lenis.raf(time * 1000));
        gsap.ticker.lagSmoothing(0);
        if (typeof ScrollTrigger !== 'undefined') {
            lenis.on('scroll', ScrollTrigger.update);
        }
    } else {
        const raf = (time) => {
            lenis.raf(time);
            requestAnimationFrame(raf);
        };
        requestAnimationFrame(raf);
    }

    window.lenis = lenis;
})();
