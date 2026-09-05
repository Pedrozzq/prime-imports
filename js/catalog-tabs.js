// Alterna entre os painéis "Perfumes Árabes" e "Importados" acima do grid de produtos.
(function () {
    const buttons = document.querySelectorAll('[data-catalog-tab]');
    if (!buttons.length) return;

    buttons.forEach((btn) => {
        btn.addEventListener('click', () => {
            const target = btn.dataset.catalogTab;

            buttons.forEach((b) => b.classList.toggle('is-active', b === btn));

            document.querySelectorAll('[data-catalog-panel]').forEach((panel) => {
                panel.classList.toggle('hidden', panel.id !== `catalog-panel-${target}`);
            });
        });
    });
})();
