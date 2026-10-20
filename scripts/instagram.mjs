/**
 * Prime Perfumes — Perfil do Instagram para a página links.html
 *
 * Roda o ator "Instagram Scraper" da Apify (shu8hvrXbJbY3Eb9W) para o perfil
 * @primeperfumes.imp e salva:
 *   data/instagram.json        → nome, bio, seguidores, seguindo, posts e os últimos posts
 *   img/instagram/perfil.jpg   → foto do perfil
 *   img/instagram/post-N.jpg   → capas dos últimos posts
 *
 * As imagens são baixadas porque os links do Instagram expiram em poucos dias
 * e bloqueiam exibição em outros sites.
 *
 * Uso: coloque o token da Apify no arquivo .env (que não vai para o GitHub):
 *     APIFY_TOKEN=apify_api_xxxxxxxx
 * e rode:
 *     npm run instagram
 * Depois é só commitar data/instagram.json e img/instagram/.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const PERFIL = 'https://www.instagram.com/primeperfumes.imp/';
const ATOR = 'shu8hvrXbJbY3Eb9W'; // apify/instagram-scraper
const QTD_POSTS = 9;

function lerToken() {
    if (process.env.APIFY_TOKEN) return process.env.APIFY_TOKEN.trim();
    const env = join(RAIZ, '.env');
    if (existsSync(env)) {
        const linha = readFileSync(env, 'utf8').split(/\r?\n/).find(l => /^\s*APIFY_TOKEN\s*=/.test(l));
        if (linha) return linha.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');
    }
    throw new Error('Token da Apify não encontrado. Coloque APIFY_TOKEN=... no arquivo .env (Apify → Settings → API & Integrations).');
}

async function baixar(url, destino) {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.instagram.com/' } });
    if (!r.ok) throw new Error(`HTTP ${r.status} ao baixar imagem`);
    writeFileSync(destino, Buffer.from(await r.arrayBuffer()));
}

const token = lerToken();

// roda um ator da Apify e devolve o primeiro item que tenha o perfil
async function rodar(ator, entrada) {
    const resp = await fetch(`https://api.apify.com/v2/acts/${ator}/run-sync-get-dataset-items?timeout=180`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(entrada),
    });
    if (!resp.ok) throw new Error(`Apify respondeu ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
    const itens = await resp.json();
    const perfil = Array.isArray(itens) ? itens.find(i => i && i.username) : null;
    if (!perfil) {
        const erro = Array.isArray(itens) && itens[0] && (itens[0].error || (itens[0].requestErrorMessages || [])[0]);
        throw new Error('perfil não retornado' + (erro ? ' (' + String(erro).split('\n')[0] + ')' : ''));
    }
    return perfil;
}

// O Instagram às vezes bloqueia a coleta: tenta o Instagram Scraper duas vezes e,
// se continuar bloqueado, usa o Instagram Profile Scraper (apify/instagram-profile-scraper).
const tentativas = [
    ['Instagram Scraper', ATOR, { directUrls: [PERFIL], resultsType: 'details', resultsLimit: QTD_POSTS, addParentData: false }],
    ['Instagram Scraper (2ª tentativa)', ATOR, { directUrls: [PERFIL], resultsType: 'details', resultsLimit: QTD_POSTS, addParentData: false }],
    ['Instagram Profile Scraper', 'apify~instagram-profile-scraper', { usernames: ['primeperfumes.imp'], includeAboutSection: false }],
];
let p = null;
for (const [nome, ator, entrada] of tentativas) {
    console.log(`Rodando ${nome} na Apify (pode levar até 1 minuto)…`);
    try { p = await rodar(ator, entrada); break; }
    catch (e) { console.warn(`  ${nome}: ${e.message}`); }
}
if (!p) throw new Error('Não foi possível coletar o perfil agora (o Instagram bloqueou). Tente de novo em alguns minutos.');

const pasta = join(RAIZ, 'img', 'instagram');
mkdirSync(pasta, { recursive: true });
readdirSync(pasta).filter(f => /^post-\d+\.jpg$/.test(f)).forEach(f => unlinkSync(join(pasta, f))); // limpa posts antigos

let foto = null;
try { await baixar(p.profilePicUrlHD || p.profilePicUrl, join(pasta, 'perfil.jpg')); foto = 'img/instagram/perfil.jpg'; }
catch (e) { console.warn('Foto do perfil não baixou:', e.message); }

const posts = [];
for (const post of (p.latestPosts || []).slice(0, QTD_POSTS)) {
    const capa = post.displayUrl || (post.images && post.images[0]);
    if (!capa) continue;
    const nome = `post-${posts.length + 1}.jpg`;
    try { await baixar(capa, join(pasta, nome)); }
    catch (e) { console.warn('Post não baixou:', post.shortCode, e.message); continue; }
    posts.push({
        img: `img/instagram/${nome}`,
        url: post.url || `https://www.instagram.com/p/${post.shortCode}/`,
        tipo: post.type === 'Video' ? 'video' : post.type === 'Sidecar' ? 'carrossel' : 'foto',
        curtidas: post.likesCount ?? null,
        comentarios: post.commentsCount ?? null,
        legenda: String(post.caption || '').slice(0, 220),
        data: post.timestamp || null,
    });
}

const dados = {
    usuario: p.username,
    nome: p.fullName || p.username,
    bio: p.biography || '',
    link: p.externalUrl || null,
    verificado: !!p.verified,
    seguidores: p.followersCount ?? null,
    seguindo: p.followsCount ?? null,
    publicacoes: p.postsCount ?? null,
    foto,
    url: `https://www.instagram.com/${p.username}/`,
    posts,
    atualizado: new Date().toISOString(),
};
mkdirSync(join(RAIZ, 'data'), { recursive: true });
writeFileSync(join(RAIZ, 'data', 'instagram.json'), JSON.stringify(dados, null, 2) + '\n');
console.log(`Pronto: @${dados.usuario} · ${dados.seguidores} seguidores · ${posts.length} posts salvos em data/instagram.json e img/instagram/.`);
