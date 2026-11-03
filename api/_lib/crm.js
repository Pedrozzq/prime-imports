/**
 * Prime Perfumes — Ligação da loja com o CRM (Supabase).
 *
 * O CRM (crm/) é quem manda em preço, estoque, "no site" e ofertas. Este módulo:
 *   - catalogoAoVivo(): lê a tabela de preços valendo agora (função loja_catalogo, pública);
 *   - registrarPagamento(): grava o pedido pago no CRM (função loja_registrar_pedido),
 *     o que dá baixa no estoque e nos ml dos decants.
 *
 * Se o CRM estiver fora do ar, a loja continua vendendo pelos preços do
 * catalogo-dados.js (gerado do index.html) — o catálogo ao vivo é um "a mais".
 *
 * Configuração (Vercel → Project Settings → Environment Variables):
 *   CRM_CHAVE          (obrigatória para gravar pedidos) chave do agente do CRM:
 *                      Supabase > SQL Editor > select chave from public.agente_config;
 *   SUPABASE_URL       (opcional) padrão = projeto do crm/config.js
 *   SUPABASE_ANON_KEY  (opcional) padrão = chave pública do crm/config.js
 */

const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://omfsonnubkmuuqekeoev.supabase.co').replace(/\/+$/, '');
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable__Ge0GIv8evSDYcTSINerVA_gmcU7AJN';
const CRM_CHAVE = process.env.CRM_CHAVE || '';

const CACHE_MS = 15 * 1000;
let cache = null, cacheEm = 0;

async function rpc(funcao, corpo, timeoutMs) {
    const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/' + funcao, {
        method: 'POST',
        headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo || {}),
        signal: AbortSignal.timeout(timeoutMs || 4000)
    });
    const texto = await r.text();
    let dados = null;
    try { dados = texto ? JSON.parse(texto) : null; } catch (e) { dados = texto; }
    if (!r.ok) {
        const msg = dados && dados.message ? dados.message : ('HTTP ' + r.status);
        throw new Error(funcao + ': ' + msg);
    }
    return dados;
}

/**
 * Catálogo valendo agora: Map "<produto>|<tamanho>" → {preco, ativo, estoque, oferta}.
 * `preco` já é o que deve ser cobrado (oferta, se tiver). null = CRM indisponível.
 */
export async function catalogoAoVivo() {
    if (cache && Date.now() - cacheEm < CACHE_MS) return cache;
    try {
        const dados = await rpc('loja_catalogo', {}, 3500);
        const mapa = new Map();
        for (const p of (dados && dados.produtos) || []) {
            if (!p || !p.id) continue;
            const oferta = p.oferta == null ? null : Number(p.oferta);
            mapa.set(String(p.id), {
                preco: oferta != null ? oferta : Number(p.preco),
                precoNormal: Number(p.preco),
                oferta: oferta,
                ativo: p.ativo !== false,
                estoque: p.estoque == null ? null : Number(p.estoque)
            });
        }
        cache = mapa; cacheEm = Date.now();
        return mapa;
    } catch (e) {
        console.warn('CRM indisponível, usando a tabela fixa de preços:', e && e.message);
        return null;
    }
}

/** Itens do jeito que vão no metadata do Mercado Pago (curto): [[id, qtd, preço], ...] */
export function itensParaMetadata(itens) {
    return JSON.stringify((itens || []).map(function (i) { return [i.id, i.qty, i.price]; }));
}
export function itensDoMetadata(texto) {
    try {
        const lista = JSON.parse(texto || '[]');
        return Array.isArray(lista) ? lista.map(function (x) { return { id: String(x[0]), qty: Number(x[1]) || 1, price: Number(x[2]) || 0 }; }) : [];
    } catch (e) { return []; }
}

/**
 * Grava (ou atualiza) no CRM o pedido de um pagamento do Mercado Pago.
 * Nunca lança erro: devolve {ok:false, motivo} quando não deu.
 *
 * @param {object} d
 *   ref, pagamentoStatus, metodo, parcelas, cliente {nome, telefone, email},
 *   entrega {cep, rua, numero, complemento, bairro, cidade, uf},
 *   itens [{id, name, brand, qty, price}], desconto, frete, cupom
 */
export async function registrarPagamento(d) {
    if (!CRM_CHAVE) {
        console.warn('CRM_CHAVE não configurada: o pedido não foi gravado no CRM.');
        return { ok: false, motivo: 'sem-chave' };
    }
    if (!d || !d.ref || !d.itens || !d.itens.length) return { ok: false, motivo: 'dados-incompletos' };
    try {
        const r = await rpc('loja_registrar_pedido', {
            p_chave: CRM_CHAVE,
            p_dados: {
                ref: String(d.ref),
                pagamento_status: d.pagamentoStatus || 'pending',
                metodo: d.metodo || '',
                parcelas: d.parcelas || null,
                cliente: d.cliente || {},
                entrega: d.entrega || {},
                itens: d.itens.map(function (i) {
                    return { id: i.id, nome: i.name || '', marca: i.brand || '', quantidade: i.qty, preco: i.price };
                }),
                desconto: d.desconto || 0,
                frete: d.frete || 0,
                cupom: d.cupom || null,
                observacoes: d.observacoes || null
            }
        }, 6000);
        if (r && r.ok) console.log('Pedido #' + r.numero + ' no CRM (' + r.status + ', pagamento ' + d.ref + ').');
        return r || { ok: false };
    } catch (e) {
        console.error('Não foi possível gravar o pedido no CRM:', e && e.message);
        return { ok: false, motivo: e && e.message };
    }
}

/** Pagamento do Mercado Pago → dados do pedido (usa o metadata gravado na preference). */
export function dadosDoPagamento(payment, reserva) {
    const meta = (payment && payment.metadata) || {};
    let entrega = {};
    try { entrega = meta.entrega ? JSON.parse(meta.entrega) : {}; } catch (e) { entrega = {}; }
    reserva = reserva || {};
    const itens = itensDoMetadata(meta.itens);
    const payer = (payment && payment.payer) || {};
    const ent = Object.keys(entrega).length ? entrega : (reserva.entrega || {});
    return {
        ref: String(payment && payment.id != null ? payment.id : (reserva.ref || '')),
        pagamentoStatus: (payment && payment.status) || reserva.status || 'pending',
        metodo: (payment && payment.payment_type_id) || '',
        parcelas: (payment && payment.installments) || null,
        cliente: {
            nome: ent.nome || [payer.first_name, payer.last_name].filter(Boolean).join(' '),
            telefone: ent.fone || (payer.phone && ((payer.phone.area_code || '') + (payer.phone.number || ''))) || '',
            email: ent.email || payer.email || ''
        },
        entrega: ent,
        itens: itens.length ? itens : (reserva.itens || []),
        desconto: meta.desconto != null ? Number(meta.desconto) : (reserva.desconto || 0),
        frete: meta.frete != null ? Number(meta.frete) : (reserva.frete || 0),
        cupom: meta.cupom || reserva.cupom || null
    };
}
