// =====================================================================
//  PRIME PERFUMES · CRM — WhatsApp Business (Cloud API da Meta)
//  Supabase Edge Function "whatsapp". Faz duas coisas:
//   1. Webhook da Meta: recebe mensagens e status de entrega e grava no CRM
//   2. Envio: o CRM (usuário logado) manda texto ou modelo aprovado para o cliente
//  O token da Meta fica só aqui (secrets do Supabase), nunca no navegador.
//
//  Deploy:  supabase functions deploy whatsapp --no-verify-jwt
//  Secrets: supabase secrets set WHATSAPP_TOKEN=... WHATSAPP_PHONE_NUMBER_ID=... \
//                                WHATSAPP_VERIFY_TOKEN=... WHATSAPP_APP_SECRET=...
//  Opcional: FORWARD_WEBHOOK_URL=https://seu-n8n/webhook/... (repassa ao agente,
//            exceto conversas em que o atendente pausou o bot)
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const env = (k: string) => Deno.env.get(k) ?? "";
const TOKEN = env("WHATSAPP_TOKEN");
const PHONE_ID = env("WHATSAPP_PHONE_NUMBER_ID");
const VERIFY = env("WHATSAPP_VERIFY_TOKEN");
const APP_SECRET = env("WHATSAPP_APP_SECRET");
const FORWARD = env("FORWARD_WEBHOOK_URL");
const GRAPH = `https://graph.facebook.com/${env("WHATSAPP_API_VERSION") || "v21.0"}`;

const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);

  // Verificação do webhook (Meta > WhatsApp > Configuração > Webhook)
  if (req.method === "GET") {
    const ok = VERIFY && url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === VERIFY;
    return ok ? new Response(url.searchParams.get("hub.challenge") ?? "") : new Response("forbidden", { status: 403 });
  }
  if (req.method !== "POST") return json({ error: "método não suportado" }, 405);

  const raw = await req.text();
  try {
    if (req.headers.get("x-hub-signature-256")) return await webhook(req, raw);
    return await crm(req, raw);
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message }, 500);
  }
});

// ------------------------------------------------------------------ webhook
async function assinaturaValida(sig: string, raw: string) {
  if (!APP_SECRET) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(APP_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
  const esperado = "sha256=" + [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (esperado.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= esperado.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

async function webhook(req: Request, raw: string) {
  const sig = req.headers.get("x-hub-signature-256") ?? "";
  if (!(await assinaturaValida(sig, raw))) return json({ error: "assinatura inválida" }, 401);

  const body = JSON.parse(raw);
  let repassar = false;
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const v = change.value ?? {};
      if (PHONE_ID && v.metadata?.phone_number_id && v.metadata.phone_number_id !== PHONE_ID) continue;
      const nomes: Record<string, string> = Object.fromEntries((v.contacts ?? []).map((c: Any) => [c.wa_id, c.profile?.name]));
      for (const m of v.messages ?? []) {
        const conv = await salvarEntrada(m, nomes[m.from]);
        if (!conv?.bot_pausado) repassar = true;
      }
      for (const s of v.statuses ?? []) await atualizarStatus(s);
    }
  }

  // Repassa ao agente (n8n) para ele continuar respondendo, se configurado
  if (FORWARD && repassar) {
    await fetch(FORWARD, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-hub-signature-256": sig },
      body: raw,
      signal: AbortSignal.timeout(5000),
    }).catch((e) => console.warn("falha ao repassar ao agente:", e.message));
  }
  return json({ ok: true });
}

function textoDe(m: Any): string {
  switch (m.type) {
    case "text": return m.text?.body ?? "";
    case "image": return m.image?.caption ? `[imagem] ${m.image.caption}` : "[imagem]";
    case "video": return m.video?.caption ? `[vídeo] ${m.video.caption}` : "[vídeo]";
    case "document": return `[documento] ${m.document?.filename ?? m.document?.caption ?? ""}`.trim();
    case "audio": return m.audio?.voice ? "[mensagem de voz]" : "[áudio]";
    case "sticker": return "[figurinha]";
    case "location": return `[localização] ${m.location?.name ?? ""} https://maps.google.com/?q=${m.location?.latitude},${m.location?.longitude}`.replace("  ", " ");
    case "contacts": return `[contato] ${m.contacts?.[0]?.name?.formatted_name ?? ""}`.trim();
    case "button": return m.button?.text ?? "[botão]";
    case "interactive": return m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? "[resposta]";
    case "reaction": return `[reagiu ${m.reaction?.emoji ?? ""}]`.replace(" ]", "]");
    default: return `[${m.type}]`;
  }
}

async function conversa(telefone: string, nome?: string | null) {
  const { data: c } = await db.from("wa_conversas").select("*").eq("telefone", telefone).maybeSingle();
  if (c) {
    if (nome && nome !== c.nome) await db.from("wa_conversas").update({ nome }).eq("id", c.id);
    return c;
  }
  const { data: cliente_id } = await db.rpc("wa_cliente_por_telefone", { p_tel: telefone });
  const { data, error } = await db.from("wa_conversas")
    .upsert({ telefone, nome: nome ?? null, cliente_id: cliente_id ?? null }, { onConflict: "telefone" })
    .select().single();
  if (error) throw error;
  return data;
}

async function salvarEntrada(m: Any, nome?: string) {
  if (m.type === "reaction" && !m.reaction?.emoji) return null; // reação removida
  const conv = await conversa(m.from, nome);
  const quando = new Date(Number(m.timestamp) * 1000 || Date.now()).toISOString();
  const texto = textoDe(m);
  const { data: nova } = await db.from("wa_mensagens")
    .upsert({ conversa_id: conv.id, wa_message_id: m.id, direcao: "entrada", tipo: m.type, texto, status: "recebida", criado_em: quando },
      { onConflict: "wa_message_id", ignoreDuplicates: true })
    .select("id");
  if (!nova?.length) return conv; // a Meta reenviou um evento que já foi gravado
  const { data: atual } = await db.from("wa_conversas").select("nao_lidas").eq("id", conv.id).single();
  await db.from("wa_conversas").update({
    ultima_msg: texto.slice(0, 300), ultima_msg_em: quando, ultima_entrada_em: quando,
    nao_lidas: (atual?.nao_lidas ?? 0) + 1,
  }).eq("id", conv.id);
  return conv;
}

const ORDEM: Record<string, number> = { enviando: 0, enviada: 1, entregue: 2, lida: 3, falhou: 4 };
const STATUS_META: Record<string, string> = { sent: "enviada", delivered: "entregue", read: "lida", failed: "falhou" };
async function atualizarStatus(s: Any) {
  const status = STATUS_META[s.status];
  if (!status) return;
  const { data: msg } = await db.from("wa_mensagens").select("id,status").eq("wa_message_id", s.id).maybeSingle();
  if (!msg || (ORDEM[msg.status] ?? 0) >= ORDEM[status]) return; // não volta status (ex.: "entregue" depois de "lida")
  const erro = s.errors?.[0] ? `${s.errors[0].title ?? ""} ${s.errors[0].error_data?.details ?? ""}`.trim() : null;
  await db.from("wa_mensagens").update({ status, erro }).eq("id", msg.id);
}

// ------------------------------------------------------------------ CRM
const fone = (p: string) => {
  const d = String(p ?? "").replace(/\D/g, "");
  return d.length === 10 || d.length === 11 ? "55" + d : d;
};

async function crm(req: Request, raw: string) {
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: { user } } = await db.auth.getUser(jwt);
  if (!user) return json({ error: "faça login no CRM" }, 401);

  const b = JSON.parse(raw || "{}");
  if (b.acao === "status") {
    return json({ token: !!TOKEN, phone_id: !!PHONE_ID, verify_token: !!VERIFY, app_secret: !!APP_SECRET, encaminhar: !!FORWARD });
  }
  if (b.acao !== "enviar") return json({ error: "ação desconhecida" }, 400);
  if (!TOKEN || !PHONE_ID) return json({ error: "WhatsApp não configurado: defina WHATSAPP_TOKEN e WHATSAPP_PHONE_NUMBER_ID" }, 400);

  const telefone = fone(b.telefone);
  if (telefone.length < 12) return json({ error: "telefone inválido" }, 400);
  const texto = String(b.texto ?? "").trim();
  const template = String(b.template ?? "").trim();
  if (!texto && !template) return json({ error: "mensagem vazia" }, 400);
  if (texto.length > 4096) return json({ error: "mensagem muito longa (máx. 4096 caracteres)" }, 400);

  const payload = template
    ? { messaging_product: "whatsapp", to: telefone, type: "template", template: { name: template, language: { code: b.idioma || "pt_BR" } } }
    : { messaging_product: "whatsapp", recipient_type: "individual", to: telefone, type: "text", text: { body: texto, preview_url: true } };

  const r = await fetch(`${GRAPH}/${PHONE_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const d = await r.json().catch(() => ({}));

  const conv = await conversa(telefone, b.nome || null);
  const agora = new Date().toISOString();
  const exibido = template ? `[modelo] ${template}` : texto;
  let erro: string | null = null;
  if (!r.ok) {
    const e = d.error ?? {};
    erro = e.code === 131047 || e.error_data?.details?.includes("24 hours")
      ? "Passaram 24 h desde a última mensagem do cliente: envie um modelo aprovado."
      : (e.error_data?.details || e.message || `erro ${r.status} da Meta`);
  }
  await db.from("wa_mensagens").insert({
    conversa_id: conv.id, wa_message_id: d.messages?.[0]?.id ?? null, direcao: "saida",
    tipo: template ? "template" : "text", texto: exibido, status: erro ? "falhou" : "enviada",
    erro, enviado_por: user.id, criado_em: agora,
  });
  // quem responde pelo CRM assume a conversa: o agente automático para de receber essa conversa
  await db.from("wa_conversas").update({ ultima_msg: exibido.slice(0, 300), ultima_msg_em: agora, bot_pausado: true }).eq("id", conv.id);

  return erro ? json({ error: erro }, 400) : json({ ok: true, id: d.messages?.[0]?.id, conversa_id: conv.id });
}
