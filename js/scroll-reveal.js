// Animações de entrada ao rolar a página (GSAP + ScrollTrigger), sincronizadas
// com o scroll suave do Lenis. Progressivo: se o GSAP não carregar, o conteúdo
// já está visível normalmente (o estado inicial oculto só é aplicado aqui, via JS).
(function () {
    if (typeof gsap === 'undefined' || typeof ScrollTrigger === 'undefined') return;
    gsap.registerPlugin(ScrollTrigger);

    document.querySelectorAll('[data-reveal-group]').forEach((group) => {
        const items = group.querySelectorAll(':scope > [data-reveal]');
        if (!items.length) return;
        gsap.set(items, { opacity: 0, y: 36 });
        gsap.to(items, {
            opacity: 1,
            y: 0,
            duration: 0.9,
            ease: 'power3.out',
            stagger: 0.12,
            scrollTrigger: {
                trigger: group,
                start: 'top 85%',
                once: true,
            },
        });
    });

    document.querySelectorAll('[data-reveal-solo]').forEach((el) => {
        gsap.set(el, { opacity: 0, y: 36 });
        gsap.to(el, {
            opacity: 1,
            y: 0,
            duration: 0.9,
            ease: 'power3.out',
            scrollTrigger: {
                trigger: el,
                start: 'top 85%',
                once: true,
            },
        });
    });
})();
