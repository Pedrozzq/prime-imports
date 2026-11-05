// =====================================================================
//  PRIME PERFUMES · CRM — Etiquetas de envio (todo o Brasil)
//  PDF 100 × 150 mm (10 × 15 cm), o mesmo tamanho da etiqueta do Mercado Livre nas
//  impressoras térmicas (Zebra, Elgin, Argox…). Só preto e branco, sem cinza (térmica não imprime cinza).
//  Uma página por pedido; vários pedidos saem num PDF só.
//  A etiqueta fica por fora da caixa: não leva valores, forma de pagamento nem nome dos produtos.
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

  const UFS = new Set('AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' '));
  const fone = t => { const m = String(t || '').replace(/\D/g, '').match(/^55(\d{2})(\d{4,5})(\d{4})$/); return m ? `(${m[1]}) ${m[2]}-${m[3]}` : ''; };
  const data = v => new Date(v).toLocaleDateString('pt-BR', {timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric'});
  // a fonte padrão do PDF só tem acentos do português (Latin-1): troca o resto e tira emojis
  const txt = s => String(s ?? '').normalize('NFC')
    .replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '').replace(/\s+/g, ' ').trim();

  const W = 100, H = 150, M = 4, CW = W - 2 * M;   // página, margem, largura útil (mm)

  // "Rio de Janeiro - RJ" → cidade e UF; com vírgulas antes, o começo volta como "resto" do endereço
  const separaCidade = s => {
    const m = s.match(/^(?:(.*),\s*)?([^,]+?)\s*[-\/]\s*([A-Za-z]{2})$/);
    return m && UFS.has(m[3].toUpperCase()) ? {resto: m[1] || '', cidade: m[2], uf: m[3].toUpperCase()} : null;
  };

  // O pedido guarda o endereço num texto só. Do site vem assim:
  // "Rua, número, complemento · Bairro · Cidade - UF · CEP 00000-000"
  // Pedido manual é texto livre: o que não der para achar fica em branco, para preencher à caneta.
  function destino(p, c) {
    let s = txt(p.endereco_entrega || c.endereco);
    let cep = '';
    const mc = s.match(/\bCEP[:.\s]*(\d{2})\.?(\d{3})[-\s]?(\d{3})\b/i) || s.match(/\b(\d{2})\.?(\d{3})-(\d{3})\b/);
    if (mc) { cep = `${mc[1]}${mc[2]}-${mc[3]}`; s = s.replace(mc[0], ''); }

    const partes = s.split(/\s*[·|]\s*/).map(x => x.replace(/^[\s,;-]+|[\s,;-]+$/g, '')).filter(Boolean);
    let cidade = '', uf = '';
    const achou = partes.length ? separaCidade(partes[partes.length - 1]) : null;
    if (achou) {
      ({cidade, uf} = achou);
      partes.pop();
      if (achou.resto) partes.push(achou.resto);
    }
    if (!cidade) {
      const cc = txt(c.cidade), doCadastro = separaCidade(cc);
      if (doCadastro) ({cidade, uf} = doCadastro);
      // "Ouro Preto" sem UF é só o valor padrão do cadastro: não pode virar destino de um envio nacional
      else if (cc && cc !== 'Ouro Preto') cidade = cc;
    }
    const rua = partes[0] || '';
    let bairro = partes.slice(1).join(' - ');
    if (!bairro) {
      // bairro do cadastro, a não ser que já esteja digitado no endereço ("Rua A, 5, Centro").
      // Compara trecho inteiro: a "Av. de Copacabana" pode muito bem ficar no bairro Copacabana
      const doCadastro = txt(c.bairro), trechos = rua.toLowerCase().split(/\s*,\s*/);
      if (!trechos.includes(doCadastro.toLowerCase())) bairro = doCadastro;
    }
    return {rua, bairro, cidade, uf, cep};
  }

  // caixa do CEP/UF: preta com o dado; vazia e só com contorno quando falta, para escrever à caneta
  function caixa(doc, x, y, w, h, rotulo, valor, tam) {
    if (valor) { doc.setFillColor(0); doc.rect(x, y, w, h, 'F'); doc.setTextColor(255); }
    else { doc.setLineWidth(0.5); doc.rect(x, y, w, h); }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
    doc.text(rotulo, x + 2.5, y + 4);
    if (valor) { doc.setFont('helvetica', 'bold'); doc.setFontSize(tam); doc.text(valor, x + 2.5, y + h - 3); }
    doc.setTextColor(0);
  }

  // devolve o que faltou nesta etiqueta (o CRM avisa quem imprimiu)
  function etiqueta(doc, p, loja) {
    const c = p.clientes || {};
    const retirada = p.tipo_entrega === 'retirada';
    const faltas = [];
    let y = M;

    // ---- topo: loja + tipo de envio ----
    doc.setTextColor(0); doc.setFont('helvetica', 'bold');
    linha(doc, txt(loja.nome || 'Prime Perfumes').toUpperCase(), M, y + 5.5, 15, 9, CW - 38);
    const servico = retirada ? 'RETIRADA NA LOJA' : 'ENVIO NACIONAL';
    doc.setFontSize(8.5);
    const sw = doc.getTextWidth(servico) + 5;
    doc.setFillColor(0); doc.rect(W - M - sw, y, sw, 6, 'F');
    doc.setTextColor(255); doc.text(servico, W - M - sw / 2, y + 4.2, {align: 'center'}); doc.setTextColor(0);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
    doc.text(data(p.criado_em), W - M, y + 9.6, {align: 'right'});
    y += 11.5;
    doc.setLineWidth(0.5); doc.line(M, y, W - M, y); y += 2.5;

    // ---- código de barras do pedido (CODE128 em vetor: barras pretas puras, nítido em qualquer térmica) ----
    const bc = {};
    window.JsBarcode(bc, String(p.numero), {format: 'CODE128'});
    const bits = bc.encodings.map(e => e.data).join('');
    const mod = Math.min(0.75, (CW - 8) / bits.length), bw = mod * bits.length, bx = (W - bw) / 2;
    doc.setFillColor(0);
    for (let i = 0; i < bits.length; i++) {
      if (bits[i] !== '1') continue;
      let n = 1; while (bits[i + n] === '1') n++;
      doc.rect(bx + i * mod, y, n * mod, 16, 'F');
      i += n - 1;
    }
    y += 20;
    const qtd = (p.pedido_itens || []).reduce((s, i) => s + (+i.quantidade || 0), 0);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    doc.text(`PEDIDO #${p.numero}${qtd ? `  ·  ${qtd} ${qtd === 1 ? 'UNIDADE' : 'UNIDADES'}` : ''}`, W / 2, y, {align: 'center'});
    y += 2.5;

    // ---- CEP e UF em destaque: é o que a triagem da transportadora lê primeiro ----
    const d = retirada ? {} : destino(p, c);
    if (retirada) {
      doc.setFillColor(0); doc.rect(M, y, CW, 12, 'F');
      doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(17);
      doc.text('CLIENTE RETIRA NA LOJA', W / 2, y + 8, {align: 'center'}); doc.setTextColor(0);
      y += 16;
    } else {
      caixa(doc, M, y, CW - 24, 17, 'CEP DE DESTINO', d.cep, 27);
      caixa(doc, W - M - 22, y, 22, 17, 'UF', d.uf, 27);
      if (!d.cep) faltas.push('CEP');
      if (!d.uf) faltas.push('UF');
      y += 21.5;
    }

    // rodapé fixo; o destinatário usa o espaço que sobra até ele
    const topoRem = H - M - 27, limite = topoRem - 2;

    // ---- destinatário ----
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.text('DESTINATÁRIO', M, y); y += 5.5;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
    doc.splitTextToSize(txt(c.nome || 'Cliente'), CW).slice(0, 2).forEach(l => { doc.text(l, M, y); y += 5.6; });
    if (!retirada) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11.5);
      if (d.rua) {
        // endereço não pode ser cortado (o complemento fica no fim): diminui a letra até caber em 4 linhas
        let tam = 11.5, linhas = doc.splitTextToSize(d.rua, CW);
        while (linhas.length > 4 && tam > 7) { doc.setFontSize(tam -= 0.5); linhas = doc.splitTextToSize(d.rua, CW); }
        const passo = tam * 0.426;
        linhas.forEach(l => { doc.text(l, M, y); y += passo; });
      } else faltas.push('endereço');
      if (d.bairro) { doc.setFont('helvetica', 'normal'); linha(doc, d.bairro, M, y, 11); y += 4.9; }
      doc.setFont('helvetica', 'bold');
      const cidadeUf = [d.cidade, d.uf].filter(Boolean).join(' - ');
      if (cidadeUf) { linha(doc, cidadeUf + (d.cep ? `  ·  CEP ${d.cep}` : ''), M, y, 11.5); y += 4.9; }
      else faltas.push('cidade');
    }
    const tel = fone(c.telefone);
    if (tel) { doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.text('Tel.: ' + tel, M, y); y += 4.4; }

    // referência e recado do cliente: tira o que é interno (Mercado Pago, parcelas, cupom)
    const ref = retirada ? '' : txt(c.ponto_referencia);
    const obs = txt(p.observacoes).split(' · ').filter(x => x && !/^Mercado Pago #|^\d+x no cart|^cupom /i.test(x)).join(' · ');
    const extras = [ref && !obs.includes(ref) && 'Ref.: ' + ref, obs && 'Obs.: ' + obs].filter(Boolean);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
    extras.forEach(e => doc.splitTextToSize(e, CW).slice(0, 2).forEach(l => { if (y <= limite) { doc.text(l, M, y); y += 3.6; } }));

    // ---- remetente ----
    let f = topoRem;
    doc.setLineWidth(0.5); doc.line(M, f, W - M, f); f += 3.6;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.text('REMETENTE', M, f); f += 4;
    doc.setFont('helvetica', 'bold'); linha(doc, txt(loja.nome || 'Prime Perfumes'), M, f, 10); f += 4;
    doc.setFont('helvetica', 'normal');
    const lEnd = txt([loja.endereco, loja.bairro].filter(Boolean).join(' - '));
    const lCid = txt([[loja.cidade, loja.uf].filter(Boolean).join(' - '), loja.cep && 'CEP ' + loja.cep].filter(Boolean).join('  ·  '));
    if (lEnd && lCid) {
      linha(doc, lEnd, M, f, 9); f += 3.8;
      linha(doc, lCid, M, f, 9); f += 3.8;
    } else if (!retirada) {
      // sem endereço no config.js: linhas para preencher à caneta
      doc.setLineWidth(0.2); doc.line(M, f + 0.3, W - M, f + 0.3); f += 3.8;
      doc.line(M, f + 0.3, W - M, f + 0.3); f += 3.8;
      faltas.push('endereço do remetente');
    }
    if (loja.whatsapp) { linha(doc, 'WhatsApp ' + fone(loja.whatsapp), M, f, 9); }

    // ---- faixa de cuidado ----
    doc.setFillColor(0); doc.rect(M, H - M - 5, CW, 5, 'F');
    doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
    doc.text('FRÁGIL  ·  CONTÉM VIDRO  ·  ESTE LADO PARA CIMA', W / 2, H - M - 1.5, {align: 'center'});
    doc.setTextColor(0);
    return faltas;
  }

  // escreve numa linha só, diminuindo a fonte até caber na largura
  function linha(doc, s, x, y, tam, min = 5, larg = CW) {
    doc.setFontSize(tam);
    while (tam > min && doc.getTextWidth(s) > larg) doc.setFontSize(tam -= 0.25);
    doc.text(s, x, y);
  }

  // pedidos: lista de pedidos do CRM (com clientes e pedido_itens). Baixa o PDF.
  // Devolve o que faltou em cada etiqueta: [{numero, faltas: ['CEP', ...]}]
  window.zooEtiquetas = async (pedidos, loja = {}) => {
    if (!pedidos.length) throw new Error('Nenhum pedido selecionado');
    for (const src of LIBS) await carregar(src);
    const doc = new window.jspdf.jsPDF({unit: 'mm', format: [W, H], orientation: 'portrait'});
    const avisos = [];
    pedidos.forEach((p, i) => {
      if (i) doc.addPage([W, H], 'portrait');
      const faltas = etiqueta(doc, p, loja);
      if (faltas.length) avisos.push({numero: p.numero, faltas});
    });
    doc.setProperties({title: pedidos.length === 1 ? `Etiqueta pedido #${pedidos[0].numero}` : `Etiquetas ${pedidos.length} pedidos`});
    const hoje = new Date().toLocaleDateString('en-CA', {timeZone: 'America/Sao_Paulo'});
    doc.save(pedidos.length === 1 ? `etiqueta-pedido-${pedidos[0].numero}.pdf` : `etiquetas-${pedidos.length}-pedidos-${hoje}.pdf`);
    return avisos;
  };
})();
