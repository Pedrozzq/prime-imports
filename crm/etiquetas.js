// =====================================================================
//  PRIME PERFUMES · CRM — Etiquetas de envio
//  PDF 100 × 150 mm (10 × 15 cm), o mesmo tamanho da etiqueta do Mercado Livre nas
//  impressoras térmicas (Zebra, Elgin, Argox…). Só preto e branco, sem cinza (térmica não imprime cinza).
//  Uma página por pedido; vários pedidos saem num PDF só.
//  As bibliotecas (jsPDF e JsBarcode) só são baixadas na primeira vez que alguém gera uma etiqueta.
// =====================================================================
(() => {
  const LIBS = [
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jsbarcode/3.11.6/JsBarcode.all.min.js'
  ];
  const carregando = {};
  const carregar = src => carregando[src] ||= new Promise((ok, erro) => {
    const s = document.createElement('script');
    s.src = src; s.onload = ok;
    s.onerror = () => { delete carregando[src]; erro(new Error('Sem internet para gerar a etiqueta. Tente de novo.')); };
    document.head.appendChild(s);
  });

  const PAG = {pix: 'Pix', dinheiro: 'Dinheiro', cartao_credito: 'Cartão de crédito', cartao_debito: 'Cartão de débito'};
  const brl = v => Number(v || 0).toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'}).replace(/ /g, ' ');
  const fone = t => { const m = String(t || '').replace(/\D/g, '').match(/^55(\d{2})(\d{4,5})(\d{4})$/); return m ? `(${m[1]}) ${m[2]}-${m[3]}` : (t || ''); };
  const data = v => new Date(v).toLocaleString('pt-BR', {timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit'});
  // a fonte padrão do PDF só tem acentos do português (Latin-1): troca o resto e tira emojis
  const txt = s => String(s ?? '').normalize('NFC')
    .replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '').replace(/\s+/g, ' ').trim();

  const W = 100, H = 150, M = 4, CW = W - 2 * M;   // página, margem, largura útil (mm)

  function etiqueta(doc, p, loja) {
    const c = p.clientes || {};
    let y = M;

    // ---- topo: loja (faixa preta) ----
    doc.setFillColor(0); doc.rect(M, y, CW, 11, 'F');
    doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
    doc.text(txt(loja.nome || 'PRIME PERFUMES').toUpperCase(), M + 3, y + 7.6);
    doc.setFontSize(8);
    doc.text(p.tipo_entrega === 'retirada' ? 'RETIRADA NA LOJA' : 'ENTREGA LOCAL', W - M - 3, y + 5, {align: 'right'});
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
    doc.text(data(p.criado_em), W - M - 3, y + 8.8, {align: 'right'});
    doc.setTextColor(0);
    y += 14;

    // ---- nº do pedido + código de barras ----
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.text('PEDIDO', M, y + 2.5);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(30); doc.text(`#${p.numero}`, M, y + 13.5);
    // código de barras CODE128 desenhado em vetor (barras pretas puras: nítido em qualquer térmica)
    const bc = {};
    window.JsBarcode(bc, String(p.numero), {format: 'CODE128'});
    const bits = bc.encodings.map(e => e.data).join('');
    const bx = W - M - 44, mod = 44 / bits.length;
    doc.setFillColor(0);
    for (let i = 0; i < bits.length; i++) {
      if (bits[i] !== '1') continue;
      let n = 1; while (bits[i + n] === '1') n++;
      doc.rect(bx + i * mod, y + 1, n * mod, 13, 'F');
      i += n - 1;
    }
    y += 18;
    doc.setLineWidth(0.5); doc.line(M, y, W - M, y); y += 4.5;

    // ---- destinatário ----
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.text('DESTINATÁRIO', M, y); y += 5.5;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
    doc.splitTextToSize(txt(c.nome || 'Cliente'), CW).slice(0, 2).forEach(l => { doc.text(l, M, y); y += 6; });
    doc.setFontSize(11.5); doc.text(txt(fone(c.telefone)), M, y); y += 6;

    if (p.tipo_entrega === 'retirada') {
      doc.setFontSize(13); doc.text('Cliente retira na loja', M, y); y += 7;
    } else {
      const end = txt(p.endereco_entrega || [c.endereco, c.bairro, c.cidade].filter(Boolean).join(' · ') || 'Endereço não informado');
      doc.setFont('helvetica', 'normal'); doc.setFontSize(11);
      doc.splitTextToSize(end, CW).slice(0, 4).forEach(l => { doc.text(l, M, y); y += 5; });
      // bairro em destaque (caixa preta): é o que o entregador olha primeiro
      const bairro = txt(c.bairro);
      if (bairro) {
        y += 0.5;
        doc.setFont('helvetica', 'bold');
        let tb = 13; doc.setFontSize(tb);
        while (tb > 8 && doc.getTextWidth(bairro.toUpperCase()) > CW - 6) doc.setFontSize(tb -= 0.5);
        const bw = Math.min(CW, doc.getTextWidth(bairro.toUpperCase()) + 6);
        doc.setFillColor(0); doc.rect(M, y - 4.6, bw, 6.6, 'F');
        doc.setTextColor(255); doc.text(bairro.toUpperCase(), M + 3, y); doc.setTextColor(0);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
        const cid = txt(c.cidade || 'Ouro Preto') + ' - MG';
        if (M + bw + 3 + doc.getTextWidth(cid) <= W - M) doc.text(cid, M + bw + 3, y);
        else { y += 5; doc.text(cid, M, y); y -= 1.5; }   // bairro comprido: cidade na linha de baixo
        y += 6.5;
      }
      const ref = txt(c.ponto_referencia);
      if (ref && !txt(p.observacoes).includes(ref)) {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
        doc.splitTextToSize('Ref.: ' + ref, CW).slice(0, 2).forEach(l => { doc.text(l, M, y); y += 4.2; });
      }
    }
    y += 1;
    doc.setLineWidth(0.5); doc.line(M, y, W - M, y); y += 5;

    // ---- pagamento / valor a cobrar ----
    const forma = PAG[p.forma_pagamento] || 'A combinar';
    const cobrar = ['dinheiro', 'cartao_credito', 'cartao_debito'].includes(p.forma_pagamento);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
    doc.text(cobrar ? 'COBRAR NA ENTREGA' : 'PAGAMENTO', M, y);
    doc.text('TOTAL', W - M, y, {align: 'right'});
    y += 6.5;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
    doc.text(txt(forma + (p.forma_pagamento === 'pix' ? ' (conferir)' : '')), M, y);
    doc.setFontSize(17); doc.text(txt(brl(p.total)), W - M, y + 0.6, {align: 'right'});
    y += 5;
    if (p.forma_pagamento === 'dinheiro' && +p.troco_para) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
      doc.text(txt(`Troco para ${brl(p.troco_para)}  ·  levar ${brl(p.troco_para - p.total)}`), M, y + 0.5); y += 5;
    }
    y += 1;
    doc.setLineWidth(0.5); doc.line(M, y, W - M, y); y += 4.5;

    // ---- observações ----
    const obs = txt(p.observacoes);
    if (obs) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
      doc.splitTextToSize('OBS: ' + obs, CW).slice(0, 3).forEach(l => { doc.text(l, M, y); y += 4; });
      y += 1.5;
    }

    // ---- itens (cabe o que der até o rodapé) ----
    const itens = p.pedido_itens || [];
    const qtd = itens.reduce((s, i) => s + (+i.quantidade || 0), 0);
    const limite = H - M - 13;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
    doc.text(`ITENS (${qtd} ${qtd === 1 ? 'unidade' : 'unidades'})`, M, y); y += 4.5;
    doc.setFontSize(9.5);
    const blocos = itens.map(i => doc.splitTextToSize(txt(i.produto), CW - 10));
    if (y + blocos.reduce((s, b) => s + b.length * 4.2, 0) - 4.2 <= limite) {
      // cabe: um item por linha
      itens.forEach((i, k) => {
        doc.setFont('helvetica', 'bold'); doc.text(`${i.quantidade}x`, M, y);
        doc.setFont('helvetica', 'normal');
        blocos[k].forEach(l => { doc.text(l, M + 9, y); y += 4.2; });
      });
    } else {
      // muitos itens: lista corrida em letra menor; se ainda assim não couber, avisa para ver no CRM
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
      const linhas = doc.splitTextToSize(itens.map(i => `${i.quantidade}x ${txt(i.produto)}`).join('  ·  '), CW);
      const cabem = Math.max(0, Math.floor((limite - y) / 3.5) + 1);
      const corte = linhas.length > cabem;
      linhas.slice(0, corte ? cabem - 1 : cabem).forEach(l => { doc.text(l, M, y); y += 3.5; });
      if (corte) { doc.setFont('helvetica', 'bold'); doc.text(`... lista completa no pedido #${p.numero} do CRM`, M, y); }
    }

    // ---- rodapé: remetente + cuidado com o perfume ----
    let f = H - M - 9;
    doc.setLineWidth(0.3); doc.line(M, f, W - M, f); f += 3.6;
    doc.setFont('helvetica', 'bold');
    linha(doc, txt(['REMETENTE: ' + (loja.nome || 'Prime Perfumes'), loja.cidade, loja.whatsapp && 'WhatsApp ' + fone(loja.whatsapp)].filter(Boolean).join(' · ')), M, f, 7.5);
    f += 3.6;
    doc.setFont('helvetica', 'normal');
    linha(doc, 'Frágil: contém frasco de vidro. Manter na vertical e longe do calor.', M, f, 6.8);
  }

  // escreve numa linha só, diminuindo a fonte até caber na largura útil
  function linha(doc, s, x, y, tam, min = 5) {
    doc.setFontSize(tam);
    while (tam > min && doc.getTextWidth(s) > CW) doc.setFontSize(tam -= 0.25);
    doc.text(s, x, y);
  }

  // pedidos: lista de pedidos do CRM (com clientes e pedido_itens). Baixa o PDF.
  window.zooEtiquetas = async (pedidos, loja = {}) => {
    if (!pedidos.length) throw new Error('Nenhum pedido selecionado');
    for (const src of LIBS) await carregar(src);
    const doc = new window.jspdf.jsPDF({unit: 'mm', format: [W, H], orientation: 'portrait'});
    pedidos.forEach((p, i) => { if (i) doc.addPage([W, H], 'portrait'); etiqueta(doc, p, loja); });
    doc.setProperties({title: pedidos.length === 1 ? `Etiqueta pedido #${pedidos[0].numero}` : `Etiquetas ${pedidos.length} pedidos`});
    const hoje = new Date().toLocaleDateString('en-CA', {timeZone: 'America/Sao_Paulo'});
    doc.save(pedidos.length === 1 ? `etiqueta-pedido-${pedidos[0].numero}.pdf` : `etiquetas-${pedidos.length}-pedidos-${hoje}.pdf`);
  };
})();
