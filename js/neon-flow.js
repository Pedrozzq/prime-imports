// Efeito "Neon Flow": fundo animado de tubos de luz (WebGL) na hero section.
// Clique em qualquer lugar da hero para randomizar as cores.
(function () {
    const canvas = document.getElementById('neon-flow-canvas');
    if (!canvas) return;

    const randomColors = (count) =>
        Array.from({ length: count }, () => '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0'));

    let app = null;

    import('https://cdn.jsdelivr.net/npm/threejs-components@0.0.19/build/cursors/tubes1.min.js')
        .then((module) => {
            const TubesCursor = module.default;
            app = TubesCursor(canvas, {
                tubes: {
                    colors: ['#D4AF37', '#F3E5AB', '#AA8529'],
                    lights: {
                        intensity: 200,
                        colors: ['#D4AF37', '#F3E5AB', '#ffffff', '#AA8529']
                    }
                }
            });
        })
        .catch((err) => console.error('Falha ao carregar o efeito Neon Flow:', err));

    const hero = canvas.closest('header');
    if (hero) {
        hero.addEventListener('click', () => {
            if (!app) return;
            app.tubes.setColors(randomColors(3));
            app.tubes.setLightsColors(randomColors(4));
        });
    }
})();
