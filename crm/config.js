// =====================================================================
//  PRIME PERFUMES · CONEXÃO DO CRM (Supabase)
//  Usado pelo CRM (crm/index.html).
//  Cole os dados do projeto: Supabase > Project Settings > API
//  Enquanto estiver com os valores de exemplo, o CRM roda em MODO DEMO.
//  A anon key pode ficar pública: as tabelas são protegidas por RLS.
// =====================================================================
// Dados da loja que saem como REMETENTE na etiqueta de envio do CRM
// endereco, bairro, cidade, uf, cep: endereço de onde a mercadoria sai. Vazio = a etiqueta sai com linhas
// em branco para preencher à caneta (e o CRM avisa ao gerar)
// whatsapp: só dígitos com DDI e DDD, ex.: '5531999999999' (vazio = não imprime)
// avaliacao_google: link que vai na mensagem pronta "Avaliar no Google" (CRM > WhatsApp)
window.ZOO_LOJA = {
  nome: 'Prime Perfumes',
  endereco: '',
  bairro: '',
  cidade: '',
  uf: '',
  cep: '',
  whatsapp: '5521996931199',
  avaliacao_google: ''
};

window.ZOO_CONFIG = {
  SUPABASE_URL: 'https://omfsonnubkmuuqekeoev.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable__Ge0GIv8evSDYcTSINerVA_gmcU7AJN'
};
