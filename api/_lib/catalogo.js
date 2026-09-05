/**
 * Prime Imports — Validação de preços no servidor.
 *
 * O navegador manda a sacola, mas NÃO manda o preço que vale. Este módulo
 * ignora qualquer valor que venha do cliente e reconstrói cada item a partir
 * da tabela em catalogo-dados.js (gerada do index.html por "npm run catalogo").
 *
 * Assim, adulterar o localStorage ou o corpo do fetch não muda um centavo do
 * que é cobrado: no máximo faz o pagamento ser recusado.
 */

import { CATALOGO } from './catalogo-dados.js';

const QTD_MAXIMA = 20;

/** Centavos evitam o erro de ponto flutuante ao somar preços. */
function centavos(valor) {
    return Math.round(Number(valor) * 100);
}

/**
 * Reconstrói a sacola com os preços oficiais.
 *
 * @param {Array} items itens crus vindos do checkout (campo `id` = "<produto>|<tamanho>")
 * @returns {{itens:Array, total:number, erros:Array<string>, divergencias:Array<object>}}
 *   `itens` já vem com nome, marca e preço do catálogo — use sempre estes, nunca os do cliente.
 *   `erros` não vazio significa: não crie o pagamento.
 *   `divergencias` lista o que o cliente tinha dito, quando difere do catálogo (só para log).
 */
export function validarSacola(items) {
    const erros = [];
    const divergencias = [];
    const itens = [];
    let totalCentavos = 0;

    if (!Array.isArray(items) || !items.length) {
        return { itens: [], total: 0, erros: ['Sacola vazia.'], divergencias: [] };
    }

    for (const cru of items) {
        const bruto = cru && typeof cru === 'object' ? cru : {};
        const chave = String(bruto.id == null ? '' : bruto.id).trim();
        const oficial = Object.prototype.hasOwnProperty.call(CATALOGO, chave) ? CATALOGO[chave] : null;

        if (!oficial) {
            erros.push('Produto não encontrado no catálogo: ' + (chave || '(sem id)'));
            continue;
        }

        const qtd = Math.floor(Number(bruto.qty));
        if (!Number.isFinite(qtd) || qtd < 1) {
            erros.push('Quantidade inválida para ' + oficial.nome + '.');
            continue;
        }
        if (qtd > QTD_MAXIMA) {
            erros.push('Quantidade acima do limite (' + QTD_MAXIMA + ') para ' + oficial.nome + '.');
            continue;
        }

        // O preço do cliente serve só para registrar a tentativa — nunca para cobrar.
        const precoCliente = Number(bruto.price);
        if (Number.isFinite(precoCliente) && centavos(precoCliente) !== centavos(oficial.preco)) {
            divergencias.push({
                chave: chave,
                enviado: precoCliente,
                oficial: oficial.preco
            });
        }

        totalCentavos += centavos(oficial.preco) * qtd;

        itens.push({
            id: chave,
            name: oficial.nome,
            brand: oficial.marca,
            price: oficial.preco,
            qty: qtd
        });
    }

    if (!itens.length && !erros.length) {
        erros.push('Nenhum item válido na sacola.');
    }

    return {
        itens: itens,
        total: totalCentavos / 100,
        erros: erros,
        divergencias: divergencias
    };
}
