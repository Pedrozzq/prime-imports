/**
 * Prime Perfumes — chave do modo manutenção.
 *
 * MANUTENCAO = true  → todas as páginas da loja mostram manutencao.html
 * MANUTENCAO = false → site normal
 *
 * Para você continuar vendo o site com a manutenção ligada, abra qualquer
 * página com ?preview no fim do endereço (ex.: primeimportsperfumes.com.br/?preview).
 * O navegador lembra disso; para voltar a ver a tela de manutenção, use ?preview=0.
 * A página links.html fica sempre no ar (é a do Instagram).
 */
(function () {
    var MANUTENCAO = true;

    var busca = location.search;
    try {
        if (/[?&]preview=0\b/.test(busca)) localStorage.removeItem('prime-preview');
        else if (/[?&]preview\b/.test(busca)) localStorage.setItem('prime-preview', '1');
    } catch (e) {}

    var preview = false;
    try { preview = localStorage.getItem('prime-preview') === '1'; } catch (e) {}

    if (MANUTENCAO && !preview) location.replace('manutencao.html');
})();
