/* ============================================================
   Prime Perfumes · Loja ligada ao CRM (Supabase)

   O CRM (crm/) manda em preço, estoque, "no site" e ofertas. Este arquivo,
   carregado DEPOIS do script principal do index.html, lê o catálogo valendo
   agora (função loja_catalogo do banco) e ajusta o PRODUTOS da página:
     - preço de cada tamanho (100 ml, decants...) = preço do CRM;
     - oferta relâmpago no ar → preço de oferta com o antigo riscado e o selo -%;
       os produtos em oferta aparecem em "Promoções";
     - desligado no CRM ou estoque 0 → o tamanho some da loja (sem tamanho, some o perfume);
     - a sacola não deixa passar do estoque e é corrigida se o preço mudar.
   Confere de novo a cada minuto e quando a aba volta a ficar visível.
   Sem resposta do CRM, a loja segue com os preços escritos no index.html.
   Quem cobra é o servidor (api/_lib/catalogo.js), com os mesmos dados do CRM.
   ============================================================ */
(function () {
  "use strict";
  var SUPABASE_URL = "https://omfsonnubkmuuqekeoev.supabase.co";
  var SUPABASE_KEY = "sb_publishable__Ge0GIv8evSDYcTSINerVA_gmcU7AJN";   // pública (só lê vitrine)
  var INTERVALO = 60 * 1000;

  if (typeof PRODUTOS === "undefined" || typeof estado === "undefined") return;

  // como cada produto veio do index.html (para voltar ao normal quando a oferta acaba ou o estoque volta)
  var TODOS = PRODUTOS.slice();
  var ORIGINAL = new Map(TODOS.map(function (p) {
    return [p.id, { precoAntigo: p.precoAntigo, tamanhos: p.tamanhos.map(function (t) {
      return { ml: t.ml, mult: t.mult, preco: t.preco != null ? t.preco : Math.round(p.preco * (t.mult || 1) * 100) / 100 };
    }) }];
  }));
  var assinatura = "", OFERTAS = [];

  function aplicar(mapa) {
    var visiveis = [];
    TODOS.forEach(function (p) {
      var o = ORIGINAL.get(p.id);
      var tams = o.tamanhos.map(function (t) { return { ml: t.ml, mult: t.mult, preco: t.preco }; }).filter(function (t) {
        var c = mapa.get(p.id + "|" + t.ml);
        if (!c) return true;                                   // ainda não está no CRM: segue como no index.html
        if (c.ativo === false || c.estoque === 0) return false;
        var normal = Number(c.preco), oferta = c.oferta == null ? null : Number(c.oferta);
        t.preco = oferta != null && oferta < normal ? oferta : normal;
        if (oferta != null && oferta < normal) t.precoAntigo = normal;
        t.estoque = c.estoque == null ? null : Number(c.estoque);
        return true;
      });
      if (!tams.length) return;
      p.tamanhos = tams;
      p.preco = tams[0].preco;
      p.precoAntigo = tams[0].precoAntigo || (tams[0].preco === o.tamanhos[0].preco ? o.precoAntigo : undefined);
      p.emOferta = tams.some(function (t) { return t.precoAntigo; });
      visiveis.push(p);
    });
    PRODUTOS.length = 0;
    Array.prototype.push.apply(PRODUTOS, visiveis);

    var temOferta = PRODUTOS.some(function (p) { return p.emOferta; });
    var mostrar = (typeof MOSTRAR_PROMOCOES !== "undefined" && MOSTRAR_PROMOCOES) || temOferta;
    document.documentElement.classList.toggle("sem-promocoes", !mostrar);
  }

  // sacola: preço novo, item que esgotou sai, quantidade limitada ao estoque
  function corrigirSacola() {
    var avisos = [];
    estado.carrinho = estado.carrinho.filter(function (i) {
      var p = acharProduto(i.id), t = p && p.tamanhos.find(function (x) { return x.ml === i.ml; });
      if (!t) { avisos.push((p ? p.nome : "Um item") + " (" + i.ml + ") esgotou e saiu da sacola"); return false; }
      i.preco = t.preco;
      if (t.estoque != null && i.qtd > t.estoque) { i.qtd = t.estoque; avisos.push("Só temos " + t.estoque + " de " + p.nome + " (" + i.ml + ")"); }
      return i.qtd > 0;
    });
    avisos.forEach(function (m) { avisar(m); });
  }

  // redesenha a vitrine sem rolar a página nem fechar nada que o cliente tenha aberto
  function repintar() {
    var palco = document.getElementById("palco");
    var r = estado.rota;
    if (!palco || r === "politica" || r === "termos") return;
    if (document.querySelector(".produto.virado")) return;   // cliente olhando os decants de um cartão: espera a próxima
    var y = window.scrollY;
    if (r === "inicio") { palco.innerHTML = vistaInicio(); ligarCarrossel(); ligarHeroFrascos(); }
    else if (r === "marcas") palco.innerHTML = vistaMarcas();
    else palco.innerHTML = vistaCatalogo();
    window.scrollTo(0, y);
  }

  async function sincronizar() {
    var dados;
    try {
      var r = await fetch(SUPABASE_URL + "/rest/v1/rpc/loja_catalogo", {
        method: "POST", cache: "no-store",
        headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" }, body: "{}"
      });
      if (!r.ok) return;
      dados = await r.json();
    } catch (e) { return; }
    if (!dados || !Array.isArray(dados.produtos)) return;
    if (dados.agora) DESVIO = Date.parse(dados.agora) - Date.now();   // acerta o relógio do aparelho
    agendarProxima(dados);
    var ofertas = Array.isArray(dados.ofertas) ? dados.ofertas : [];
    var nova = JSON.stringify([dados.produtos, ofertas]);
    if (nova === assinatura) return;
    assinatura = nova;
    OFERTAS = ofertas;
    aplicar(new Map(dados.produtos.map(function (p) { return [String(p.id), p]; })));
    montarRelampago();
    corrigirSacola();
    repintar();
    pintarCarrinho();
    marcarCartoes();
  }

  // ---------- OFERTA RELÂMPAGO (CRM > Ofertas) ----------
  // Faixa abaixo do cabeçalho com o cronômetro até o fim da oferta, selo -% animado e
  // "termina em" nos cartões dos produtos em oferta. Na hora do fim (ou do começo de uma
  // agendada) a loja confere o CRM de novo e o preço volta sozinho.
  var DESVIO = 0, timerProxima = null, RELAMPAGO = new Map();   // produto → {fim, pct}
  function agora() { return Date.now() + DESVIO; }

  function agendarProxima(dados) {
    var alvos = (dados.ofertas || []).map(function (o) { return Date.parse(o.fim); });
    if (dados.proxima) alvos.push(Date.parse(dados.proxima));
    alvos = alvos.filter(function (x) { return x > agora(); });
    clearTimeout(timerProxima);
    if (alvos.length) {
      var ms = Math.min.apply(null, alvos) - agora() + 1500;
      if (ms < 2147483000) timerProxima = setTimeout(sincronizar, ms);
    }
  }

  function escHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]; });
  }

  function montarRelampago() {
    RELAMPAGO = new Map();
    OFERTAS.forEach(function (o) {
      var fim = Date.parse(o.fim);
      (o.itens || []).forEach(function (i) {
        var pid = String(i.id).split("|")[0], ml = String(i.id).slice(pid.length + 1);
        var p = acharProduto(pid), t = p && p.tamanhos.find(function (x) { return x.ml === ml; });
        if (!t || !t.precoAntigo) return;                  // fora do site ou sem desconto de verdade
        var pct = Math.round((1 - t.preco / t.precoAntigo) * 100);
        var r = RELAMPAGO.get(pid) || { fim: fim, pct: 0 };
        r.fim = Math.min(r.fim, fim); r.pct = Math.max(r.pct, pct);
        RELAMPAGO.set(pid, r);
      });
    });
    var faixa = document.getElementById("relampago");
    var o = OFERTAS.filter(function (x) { return Date.parse(x.fim) > agora(); })[0];
    if (!o || !RELAMPAGO.size) { if (faixa) faixa.remove(); return; }
    var pctMax = Math.max.apply(null, Array.from(RELAMPAGO.values()).map(function (r) { return r.pct; }));
    if (!faixa) {
      faixa = document.createElement("section");
      faixa.id = "relampago"; faixa.className = "relampago"; faixa.setAttribute("aria-label", "Oferta relâmpago");
      var topo = document.querySelector("header.topo");
      if (topo) topo.insertAdjacentElement("afterend", faixa); else document.body.prepend(faixa);
    }
    var fim = Date.parse(o.fim);
    faixa.innerHTML =
      "<div class=\"relampago__env\">" +
        "<span class=\"relampago__raio\"><svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><defs><linearGradient id=\"relOuro\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4d2\"/><stop offset=\".45\" stop-color=\"#e8c27a\"/><stop offset=\"1\" stop-color=\"#a87b2e\"/></linearGradient></defs><path fill=\"url(#relOuro)\" d=\"M13.5 2 4 13.5h6.2L9 22l10-12.2h-6.3L13.5 2Z\"/></svg></span>" +
        "<div class=\"relampago__txt\"><small class=\"relampago__ouro\">Oferta relâmpago</small><b>" + escHtml(o.titulo || "Oferta relâmpago") + "</b>" +
          (o.subtitulo ? "<span>" + escHtml(o.subtitulo) + "</span>" : "") + "</div>" +
        "<span class=\"relampago__pct\"><small>até</small><b class=\"relampago__ouro\">-" + pctMax + "%</b><small>off</small></span>" +
        "<div class=\"relampago__tempo\"><small>Termina em</small><span class=\"relampago__relogio\" data-relampago-fim=\"" + fim + "\"></span>" +
          "<em class=\"relampago__hora\">até as " + new Date(fim).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) + "</em></div>" +
        "<a class=\"relampago__btn\" href=\"#/promocoes\">Ver ofertas <span aria-hidden=\"true\">→</span></a>" +
      "</div>";
    tic();
  }

  function marcarCartoes() {
    document.querySelectorAll("article.produto[data-produto]").forEach(function (a) {
      var r = RELAMPAGO.get(a.dataset.produto);
      var chip = a.querySelector(".relampago-chip");
      a.classList.toggle("produto--relampago", !!r);
      if (!r) {
        if (chip) chip.remove();
        a.querySelectorAll(".relampago-brilho").forEach(function (x) { x.remove(); });
        var f0 = a.querySelector(".produto__fita--relampago"); if (f0) f0.classList.remove("produto__fita--relampago");
        return;
      }
      var fita = a.querySelector(".produto__fita");
      if (!fita) { fita = document.createElement("span"); fita.className = "produto__fita"; a.prepend(fita); }
      if (fita.textContent !== "-" + r.pct + "%") fita.textContent = "-" + r.pct + "%";
      fita.classList.add("produto__fita--relampago");
      if (!chip) {
        chip = document.createElement("span"); chip.className = "relampago-chip";
        chip.innerHTML = "<i aria-hidden=\"true\">⚡</i><span data-relampago-fim=\"" + r.fim + "\"></span>";
        var brilho = document.createElement("span"); brilho.className = "relampago-brilho"; brilho.setAttribute("aria-hidden", "true");
        var md = a.querySelector(".produto__midia"); if (md && !md.querySelector(".relampago-brilho")) md.appendChild(brilho);
        var midia = a.querySelector(".produto__midia"); (midia || a).appendChild(chip);
      }
    });
    tic();
  }

  function fmtRelogio(ms) {
    var s = Math.max(0, Math.floor(ms / 1000)), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
    function dd(n) { return (n < 10 ? "0" : "") + n; }
    return (d ? d + "d " : "") + dd(h) + ":" + dd(m) + ":" + dd(x);
  }
  var esperandoFim = false;
  function tic() {
    var acabou = false;
    document.querySelectorAll("[data-relampago-fim]").forEach(function (el) {
      var falta = Number(el.dataset.relampagoFim) - agora();
      if (falta <= 0) acabou = true;
      var txt = fmtRelogio(falta);
      if (el.classList.contains("relampago__relogio")) {
        var s = Math.max(0, Math.floor(falta / 1000)), partes = [];
        if (s >= 86400) partes.push([Math.floor(s / 86400), "dias"]);
        partes.push([Math.floor(s % 86400 / 3600), "h"], [Math.floor(s % 3600 / 60), "min"], [s % 60, "seg"]);
        if (el.querySelectorAll(".u").length !== partes.length) el.innerHTML = partes.map(function (x) { return "<span class=\"u\"><b></b><small>" + x[1] + "</small></span>"; }).join("<i>:</i>");
        var bs = el.querySelectorAll("b");
        partes.forEach(function (x, k) {
          var v = (x[0] < 10 ? "0" : "") + x[0];
          if (bs[k].textContent !== v) { bs[k].textContent = v; bs[k].classList.remove("vira"); void bs[k].offsetWidth; bs[k].classList.add("vira"); }
        });
        el.closest(".relampago").classList.toggle("relampago--final", falta < 10 * 60 * 1000);
      } else el.textContent = falta > 0 ? "termina em " + txt : "encerrada";
    });
    if (acabou && !esperandoFim) { esperandoFim = true; setTimeout(function () { esperandoFim = false; assinatura = ""; sincronizar(); }, 1500); }
  }
  setInterval(tic, 1000);

  // a vitrine é redesenhada pelo index.html (filtros, rotas, virar cartão): marca os cartões de novo
  var palcoEl = document.getElementById("palco");
  if (palcoEl && window.MutationObserver) {
    var pendente = false;
    new MutationObserver(function (lista) {
      if (pendente || !RELAMPAGO.size) return;
      // ignora o próprio cronômetro e o selo (mudam a cada segundo)
      if (!lista.some(function (m) { return !(m.target.closest && m.target.closest(".relampago-chip,.produto__fita,.relampago-brilho")); })) return;
      pendente = true;
      requestAnimationFrame(function () { pendente = false; marcarCartoes(); });
    }).observe(palcoEl, { childList: true, subtree: true });
  }

  (function estilos() {
    var css = document.createElement("style");
    css.textContent = [
      ":root{--rel-ouro:linear-gradient(110deg,#a87b2e 0%,#f3d58f 22%,#fff6da 32%,#e2b863 46%,#a87b2e 62%,#f0cf86 80%,#a87b2e 100%)}",
      ".relampago{position:relative;overflow:hidden;color:#f6efe2;background:radial-gradient(60% 160% at 12% 50%,rgba(217,179,108,.20),transparent 60%),radial-gradient(50% 160% at 88% 50%,rgba(192,57,43,.22),transparent 65%),linear-gradient(180deg,#0d0a06,#050403);animation:relEntra .8s cubic-bezier(.2,.9,.25,1.15) both}",
      ".relampago::before,.relampago::after{content:\"\";position:absolute;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,#d9b36c 20%,#fff3cf 50%,#d9b36c 80%,transparent);background-size:200% 100%;animation:relLinha 4s linear infinite}",
      ".relampago::before{top:0}.relampago::after{bottom:0;animation-direction:reverse}",
      ".relampago__env{position:relative;z-index:1;max-width:1240px;margin:0 auto;padding:14px 20px;display:flex;align-items:center;gap:12px 26px;flex-wrap:wrap;justify-content:center}",
      ".relampago__env::after{content:\"\";position:absolute;inset:0;background:linear-gradient(105deg,transparent 35%,rgba(255,243,207,.10) 50%,transparent 65%);transform:translateX(-120%);animation:relVarre 5s ease-in-out infinite;pointer-events:none}",
      ".relampago__ouro{background:var(--rel-ouro);background-size:250% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:relFoil 6s linear infinite}",
      ".relampago__raio{position:relative;flex:none;width:44px;height:44px;display:grid;place-items:center;border-radius:50%;background:radial-gradient(circle,#1d160b,#0a0805);border:1px solid rgba(217,179,108,.55);box-shadow:0 0 0 0 rgba(217,179,108,.5),inset 0 0 12px rgba(217,179,108,.25);animation:relAnel 2.2s ease-out infinite}",
      ".relampago__raio svg{width:24px;height:24px;filter:drop-shadow(0 0 6px rgba(243,213,143,.8));animation:relRaio 2.2s infinite}",
      ".relampago__txt{display:flex;flex-direction:column;line-height:1.2;min-width:0}",
      ".relampago__txt small{font-size:10px;letter-spacing:.34em;text-transform:uppercase;font-weight:700}",
      ".relampago__txt b{margin-top:3px;font-family:\"Cormorant Garamond\",Georgia,serif;font-size:22px;font-weight:600;letter-spacing:.06em;color:#fff}",
      ".relampago__txt span{margin-top:2px;font-size:12px;letter-spacing:.04em;color:#bfb29a}",
      ".relampago__pct{position:relative;display:flex;align-items:baseline;gap:5px;padding:6px 16px;border:1px solid rgba(217,179,108,.6);background:linear-gradient(180deg,rgba(217,179,108,.12),rgba(217,179,108,.02));animation:relPulso 2s ease-in-out infinite}",
      ".relampago__pct small{font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:#d9b36c}",
      ".relampago__pct b{font-family:\"Cormorant Garamond\",Georgia,serif;font-size:32px;line-height:1;font-weight:700}",
      ".relampago__tempo{display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:center}",
      ".relampago__tempo>small{font-size:10px;letter-spacing:.26em;text-transform:uppercase;color:#d9b36c;font-weight:600}",
      ".relampago__relogio{display:inline-flex;align-items:flex-start;gap:5px}",
      ".relampago__relogio .u{display:flex;flex-direction:column;align-items:center;gap:3px}",
      ".relampago__relogio b{display:block;min-width:42px;padding:7px 4px 6px;text-align:center;font-size:21px;font-weight:600;font-variant-numeric:tabular-nums;color:#fff;border:1px solid rgba(217,179,108,.45);background:linear-gradient(180deg,#221a0e 0%,#120e08 50%,#0a0805 50%,#17120a 100%);box-shadow:inset 0 1px 0 rgba(255,243,207,.12),0 6px 16px -8px rgba(0,0,0,.9)}",
      ".relampago__relogio b.vira{animation:relVira .45s cubic-bezier(.3,1.4,.5,1)}",
      ".relampago__relogio small{font-size:9px;letter-spacing:.2em;text-transform:uppercase;color:#a99d86}",
      ".relampago__relogio>i{font-style:normal;font-size:20px;line-height:36px;color:#d9b36c;animation:relPisca 1s steps(1) infinite}",
      ".relampago__hora{font-style:normal;font-size:11px;letter-spacing:.06em;color:#a99d86}",
      ".relampago--final .relampago__relogio b{color:#ffd9cf;border-color:rgba(255,99,71,.8);box-shadow:0 0 16px -2px rgba(255,80,50,.65)}",
      ".relampago--final .relampago__tempo>small{color:#ff8a6b;animation:relPisca 1s steps(1) infinite}",
      ".relampago__btn{position:relative;overflow:hidden;padding:12px 22px;background:linear-gradient(135deg,#f6dc9c,#d9b36c 45%,#a87b2e);color:#140f07;font-size:11px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;text-decoration:none;box-shadow:0 10px 26px -12px rgba(217,179,108,.9);transition:transform .25s,box-shadow .25s}",
      ".relampago__btn::after{content:\"\";position:absolute;top:0;bottom:0;width:40%;left:-60%;background:linear-gradient(105deg,transparent,rgba(255,255,255,.7),transparent);transform:skewX(-20deg);animation:relBotao 3s ease-in-out infinite}",
      ".relampago__btn:hover{transform:translateY(-2px);box-shadow:0 16px 30px -12px rgba(217,179,108,1)}",
      ".relampago__btn span{display:inline-block;transition:transform .25s}.relampago__btn:hover span{transform:translateX(4px)}",
      ".produto--relampago{z-index:1;border-color:transparent!important;box-shadow:0 0 0 1px rgba(217,179,108,.9),0 18px 40px -18px rgba(217,179,108,.75);animation:relCartao 2.6s ease-in-out infinite}",
      ".produto--relampago:hover{transform:translateY(-6px)}",
      ".produto--relampago .produto__nome{letter-spacing:.14em}",
      ".produto--relampago .produto__preco{font-size:1.25em;font-weight:700;background:linear-gradient(110deg,#b3261e,#e0452f 35%,#ff7a4d 50%,#e0452f 65%,#b3261e);background-size:220% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:relPreco .8s cubic-bezier(.2,.9,.3,1.4) both,relFoil 3.5s linear infinite}",
      ".produto--relampago .produto__antigo{position:relative;display:inline-block;text-decoration:none}",
      ".produto--relampago .produto__antigo::after{content:\"\";position:absolute;left:-2px;right:-2px;top:52%;height:1.5px;background:#c0392b;transform-origin:left;transform:rotate(-6deg);animation:relRisco .7s .25s ease-out both}",
      ".produto__fita--relampago{padding:7px 12px!important;background:linear-gradient(135deg,#7d0f0a,#c0392b 50%,#e0452f)!important;border:1px solid rgba(243,213,143,.85);color:#fff6da!important;font-size:13px!important;letter-spacing:.08em!important;box-shadow:0 8px 20px -6px rgba(192,57,43,.9),inset 0 1px 0 rgba(255,255,255,.25)!important;overflow:hidden;animation:relSelo 1.8s ease-in-out infinite}",
      ".produto__fita--relampago::after{content:\"\";position:absolute;top:0;bottom:0;width:45%;left:-70%;background:linear-gradient(105deg,transparent,rgba(255,255,255,.65),transparent);transform:skewX(-20deg);animation:relBotao 2.4s ease-in-out infinite}",
      ".relampago-brilho{position:absolute;inset:0;z-index:1;pointer-events:none;background:linear-gradient(115deg,transparent 40%,rgba(255,246,218,.55) 50%,transparent 60%);transform:translateX(-120%);animation:relVarre 3.6s ease-in-out infinite}",
      ".relampago-chip{position:absolute;left:10px;top:46px;z-index:3;width:max-content;display:inline-flex;align-items:center;gap:6px;padding:5px 10px;background:rgba(10,8,5,.88);border:1px solid rgba(217,179,108,.7);color:#f3d58f;font-size:10.5px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;font-variant-numeric:tabular-nums;box-shadow:0 6px 16px -8px rgba(0,0,0,.9)}",
      ".relampago-chip i{font-style:normal;filter:drop-shadow(0 0 4px rgba(243,213,143,.9));animation:relRaio 2.2s infinite}",
      "@keyframes relEntra{from{clip-path:inset(0 50% 0 50%);opacity:0}to{clip-path:inset(0 0 0 0);opacity:1}}",
      "@keyframes relLinha{to{background-position:-200% 0}}",
      "@keyframes relVarre{55%,100%{transform:translateX(120%)}}",
      "@keyframes relFoil{to{background-position:-250% 0}}",
      "@keyframes relAnel{0%{box-shadow:0 0 0 0 rgba(217,179,108,.55),inset 0 0 12px rgba(217,179,108,.25)}70%,100%{box-shadow:0 0 0 14px rgba(217,179,108,0),inset 0 0 12px rgba(217,179,108,.25)}}",
      "@keyframes relRaio{0%,100%{transform:scale(1)}8%{transform:scale(1.18) rotate(-6deg);opacity:.55}16%{transform:scale(1.08);opacity:1}24%{transform:scale(1)}}",
      "@keyframes relPulso{0%,100%{box-shadow:0 0 0 0 rgba(217,179,108,0)}50%{box-shadow:0 0 22px -4px rgba(217,179,108,.55)}}",
      "@keyframes relPisca{50%{opacity:.25}}",
      "@keyframes relVira{0%{transform:rotateX(90deg);opacity:.2}100%{transform:none;opacity:1}}",
      "@keyframes relBotao{0%{left:-60%}55%,100%{left:130%}}",
      "@keyframes relCartao{0%,100%{box-shadow:0 0 0 1px rgba(217,179,108,.9),0 18px 40px -18px rgba(217,179,108,.55)}50%{box-shadow:0 0 0 1px rgba(243,213,143,1),0 22px 50px -14px rgba(217,179,108,.95)}}",
      "@keyframes relSelo{0%,100%{transform:scale(1)}50%{transform:scale(1.08)}}",
      "@keyframes relPreco{from{transform:scale(.6);opacity:0}}",
      "@keyframes relRisco{from{transform:rotate(-6deg) scaleX(0)}}",
      "@media(max-width:760px){.relampago__env{padding:12px 14px;gap:10px 14px}.relampago__raio{width:36px;height:36px}.relampago__txt b{font-size:18px}.relampago__txt span,.relampago__hora{display:none}.relampago__pct b{font-size:24px}.relampago__relogio b{min-width:34px;font-size:17px;padding:6px 3px 5px}.relampago__btn{padding:10px 16px}}",
      "@media(prefers-reduced-motion:reduce){.relampago,.relampago *,.relampago::before,.relampago::after,.relampago__env::after,.produto--relampago,.produto--relampago *,.produto__fita--relampago,.produto__fita--relampago::after,.relampago-brilho{animation:none!important}}"
    ].join("\n");
    document.head.appendChild(css);
  })();

  // não deixa colocar na sacola mais do que tem em estoque
  var adicionarOriginal = adicionar;
  adicionar = function (id, tamanhoIdx, qtd) {
    tamanhoIdx = tamanhoIdx || 0; qtd = qtd || 1;
    var p = acharProduto(id), t = p && p.tamanhos[tamanhoIdx];
    if (t && t.estoque != null) {
      var item = estado.carrinho.find(function (i) { return i.chave === id + "|" + t.ml; });
      var ja = item ? item.qtd : 0;
      if (ja + qtd > t.estoque) {
        if (ja >= t.estoque) return avisar(t.estoque ? "Só temos " + t.estoque + " de " + p.nome + " (" + t.ml + ") e já estão na sacola" : p.nome + " (" + t.ml + ") esgotou");
        qtd = t.estoque - ja;
        avisar("Só temos " + t.estoque + " de " + p.nome + " (" + t.ml + ")");
      }
    }
    return adicionarOriginal(id, tamanhoIdx, qtd);
  };
  var mudarQtdOriginal = mudarQtd;
  mudarQtd = function (chave, delta) {
    if (delta > 0) {
      var item = estado.carrinho.find(function (i) { return i.chave === chave; });
      var p = item && acharProduto(item.id), t = p && p.tamanhos.find(function (x) { return x.ml === item.ml; });
      if (t && t.estoque != null && item.qtd + delta > t.estoque) return avisar("Só temos " + t.estoque + " de " + p.nome + " (" + t.ml + ")");
    }
    return mudarQtdOriginal(chave, delta);
  };

  // ---------- cupons (CRM > Cupons) ----------
  // A sacola calcula o desconto com as regras em CUPONS (index.html). Ao aplicar, pergunta ao CRM
  // (função loja_cupom) e põe as regras de lá em CUPONS; cupom recusado pelo CRM sai da lista.
  // Sem resposta do CRM, vale a lista escrita no index.html. Quem cobra é o servidor, pelo CRM.
  async function buscarCupom(code) {
    try {
      var r = await fetch(SUPABASE_URL + "/rest/v1/rpc/loja_cupom", {
        method: "POST", cache: "no-store",
        headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ p_codigo: code, p_telefone: (estado.entrega && estado.entrega.fone) || null })
      });
      if (!r.ok) return undefined;
      return await r.json();
    } catch (e) { return undefined; }
  }
  function guardarCupom(code, r) {
    if (r === undefined) return;                 // CRM fora do ar: fica a lista do index.html
    if (r && r.ok) CUPONS[code] = { tipo: r.tipo, valor: Number(r.valor), minimo: Number(r.minimo) || 0, teto: Number(r.teto) || 0, rotulo: r.rotulo || code };
    else delete CUPONS[code];
  }
  if (typeof aplicarCupom === "function" && typeof CUPONS !== "undefined") {
    var aplicarCupomOriginal = aplicarCupom;
    aplicarCupom = async function (codigo) {
      var code = String(codigo || "").trim().toUpperCase();
      if (!code) return aplicarCupomOriginal(codigo);
      var btn = document.getElementById("btnAplicarCupom");
      if (btn) { btn.disabled = true; btn.textContent = "..."; }
      var r = await buscarCupom(code);
      guardarCupom(code, r);
      aplicarCupomOriginal(code);
      // recusado pelo CRM: mostra o motivo de lá (esgotado, já usado, ainda não começou...)
      if (r && !r.ok && r.motivo) { estado.cupomAviso = { tipo: "erro", texto: r.motivo }; pintarCarrinho(); }
    };
    // cupom salvo de uma visita anterior: confere no CRM se ainda vale
    if (estado.cupom && estado.cupom.code) {
      var salvo = estado.cupom.code;
      buscarCupom(salvo).then(function (r) {
        guardarCupom(salvo, r);
        if (r && !r.ok) { estado.cupom = null; estado.cupomAviso = r.motivo ? { tipo: "erro", texto: "Cupom " + salvo + ": " + r.motivo } : null; salvarCupomLS(); }
        pintarCarrinho();
      });
    }
  }

  // ---------- eventos do Google Analytics (funil de compra no CRM > Google Analytics) ----------
  function evento(nome, itens, valor) {
    if (typeof gtag !== "function") return;
    try {
      gtag("event", nome, { currency: "BRL", value: Math.round((valor || 0) * 100) / 100, items: itens });
    } catch (e) { /* Analytics bloqueado: a loja segue normal */ }
  }
  function itemGa(p, t, qtd) {
    return { item_id: p.id + "|" + t.ml, item_name: p.nome, item_brand: p.marca || p.sub || "", item_variant: t.ml,
             price: Number(t.preco != null ? t.preco : p.preco) || 0, quantity: qtd || 1 };
  }
  if (typeof abrirProduto === "function") {
    var abrirProdutoOriginal = abrirProduto;
    abrirProduto = function (id) {
      var r = abrirProdutoOriginal.apply(this, arguments);
      var p = acharProduto(id), t = p && p.tamanhos[0];
      if (t) evento("view_item", [itemGa(p, t)], t.preco);
      return r;
    };
  }
  var adicionarComEstoque = adicionar;
  adicionar = function (id, tamanhoIdx, qtd) {
    var antes = estado.carrinho.reduce(function (s, i) { return s + i.qtd; }, 0);
    var r = adicionarComEstoque.apply(this, arguments);
    var depois = estado.carrinho.reduce(function (s, i) { return s + i.qtd; }, 0);
    var p = acharProduto(id), t = p && p.tamanhos[tamanhoIdx || 0];
    if (t && depois > antes) evento("add_to_cart", [itemGa(p, t, depois - antes)], t.preco * (depois - antes));
    return r;
  };
  document.addEventListener("click", function (e) {
    if (!e.target.closest || !e.target.closest("#btnPagarOnline")) return;
    if (!estado.carrinho.length || !estado.entrega || !estado.entrega.nome) return;
    var itens = estado.carrinho.map(function (i) {
      return { item_id: i.chave || i.id, item_name: (acharProduto(i.id) || {}).nome || i.id, item_variant: i.ml, price: i.preco, quantity: i.qtd };
    });
    evento("begin_checkout", itens, estado.carrinho.reduce(function (s, i) { return s + i.preco * i.qtd; }, 0));
  }, true);

  sincronizar();
  setInterval(sincronizar, INTERVALO);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) sincronizar(); });
})();
