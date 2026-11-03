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
    var nova = JSON.stringify(dados.produtos);
    if (nova === assinatura) return;
    var primeira = !assinatura;
    assinatura = nova;
    OFERTAS = Array.isArray(dados.ofertas) ? dados.ofertas : [];
    aplicar(new Map(dados.produtos.map(function (p) { return [String(p.id), p]; })));
    corrigirSacola();
    repintar();
    pintarCarrinho();
    if (primeira && OFERTAS.length) avisar(OFERTAS[0].titulo + (OFERTAS[0].subtitulo ? " · " + OFERTAS[0].subtitulo : ""));
  }

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

  sincronizar();
  setInterval(sincronizar, INTERVALO);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) sincronizar(); });
})();
