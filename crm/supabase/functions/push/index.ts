// =====================================================================
//  PRIME PERFUMES · CRM — Notificações no celular (Web Push)
//  Supabase Edge Function "push". Faz duas coisas:
//   1. Recebe os avisos do banco (gatilhos do notificacoes.sql) e manda a
//      notificação para os celulares inscritos: pedido novo, mensagem no
//      WhatsApp, mudança de status de pedido, estoque acabando e tarefa nova.
//   2. Para o CRM (usuário logado): entrega a chave pública e envia um teste.
//
//  Chaves VAPID (uma vez só, no computador):  npx web-push generate-vapid-keys
//  Deploy:  supabase functions deploy push --no-verify-jwt
//  Secrets: supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=...
//  Opcional: VAPID_SUBJECT=mailto:seu@email.com (contato para a Apple/Google)
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";

const env = (k: string) => Deno.env.get(k) ?? "";
const PUBLICA = env("VAPID_PUBLIC_KEY");
const PRIVADA = env("VAPID_PRIVATE_KEY");
if (PUBLICA && PRIVADA) webpush.setVapidDetails(env("VAPID_SUBJECT") || env("SUPABASE_URL"), PUBLICA, PRIVADA);

const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
type Aviso = { titulo: string; corpo: string; url: string; tag?: string };

const STATUS: Record<string, string> = {
  novo: "Novo", confirmado: "Confirmado", em_preparo: "Em preparo", saiu_entrega: "Saiu para entrega",
  entregue: "Entregue", cancelado: "Cancelado", fora_horario: "Fora do horário",
};
const ORIGEM: Record<string, string> = { whatsapp: "WhatsApp", site: "Site", manual: "CRM", loja: "Loja", instagram: "Instagram" };
const TIPO_MSG: Record<string, string> = {
  image: "📷 Foto", audio: "🎤 Áudio", video: "🎥 Vídeo", document: "📄 Documento",
  sticker: "Figurinha", location: "📍 Localização", contacts: "👤 Contato",
};
const brl = (v: number) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "método não suportado" }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    if (req.headers.get("x-push-segredo")) return await doBanco(req, body);
    return await doCrm(req, body);
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message }, 500);
  }
});

// ------------------------------------------------------------------ CRM (usuário logado)
async function doCrm(req: Request, body: Any) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return json({ error: "Faça login no CRM" }, 401);
  if (!PUBLICA || !PRIVADA) return json({ error: "Chaves VAPID não configuradas na função push (supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=...)" }, 400);

  if (body.acao === "chave") return json({ chave: PUBLICA });
  if (body.acao === "teste") {
    const { data } = await db.from("push_inscricoes").select("*").eq("user_id", user.id);
    const enviados = await enviar(data ?? [], {
      titulo: "🔔 Notificações ligadas",
      corpo: "É assim que os pedidos, conversas e atualizações do CRM vão chegar neste aparelho.",
      url: "./#dashboard", tag: "teste",
    });
    return json({ ok: true, enviados });
  }
  return json({ error: "ação desconhecida" }, 400);
}

// ------------------------------------------------------------------ gatilhos do banco
let segredoCache = "";
async function doBanco(req: Request, b: Any) {
  if (!segredoCache) {
    const { data } = await db.from("push_config").select("segredo").eq("id", 1).maybeSingle();
    segredoCache = data?.segredo ?? "";
  }
  if (!segredoCache || req.headers.get("x-push-segredo") !== segredoCache) return json({ error: "forbidden" }, 403);
  if (!PUBLICA || !PRIVADA) return json({ error: "VAPID não configurado" }, 400);

  const montado = await montar(b.evento, b.id, b.extra ?? {});
  if (!montado) return json({ ok: true, ignorado: true });
  const [tipo, aviso] = montado;

  let q = db.from("push_inscricoes").select("*").contains("tipos", [tipo]);
  if (b.ator) q = q.neq("user_id", b.ator);   // quem fez a mudança no CRM não recebe aviso da própria ação
  const { data } = await q;
  return json({ ok: true, enviados: await enviar(data ?? [], aviso) });
}

async function montar(evento: string, id: string, extra: Any): Promise<[string, Aviso] | null> {
  if (evento === "pedido_novo" || evento === "pedido_status") {
    const { data: p } = await db.from("pedidos")
      .select("numero,status,origem,total,tipo_entrega,clientes(nome)").eq("id", id).maybeSingle();
    if (!p) return null;
    const nome = (p as Any).clientes?.nome || "Cliente";
    if (evento === "pedido_novo") {
      const fora = p.status === "fora_horario";
      return ["pedidos", {
        titulo: fora ? `🌙 Pedido #${p.numero} fora do horário`
          : p.status === "aguardando_pagamento" ? `⏳ Pedido #${p.numero} aguardando pagamento` : `🛒 Novo pedido #${p.numero}`,
        corpo: `${nome} · ${brl(p.total)} · ${ORIGEM[p.origem] ?? p.origem}${p.tipo_entrega === "retirada" ? " · Retirada" : ""}`,
        url: "./#pedidos", tag: `pedido-${p.numero}`,
      }];
    }
    return ["atualizacoes", {
      titulo: `📦 Pedido #${p.numero}: ${STATUS[extra.para] ?? extra.para}`,
      corpo: `${nome} · era ${STATUS[extra.de] ?? extra.de}`,
      url: "./#pedidos", tag: `pedido-${p.numero}`,
    }];
  }

  if (evento === "wa_entrada") {
    const { data: m } = await db.from("wa_mensagens")
      .select("tipo,texto,conversa_id,wa_conversas(nome,telefone,clientes(nome))").eq("id", id).maybeSingle();
    if (!m) return null;
    const c = (m as Any).wa_conversas ?? {};
    const nome = c.clientes?.nome || c.nome || (c.telefone ? `+${c.telefone}` : "Cliente");
    const texto = m.texto?.trim() || TIPO_MSG[m.tipo] || "Nova mensagem";
    return ["whatsapp", {
      titulo: `💬 ${nome}`,
      corpo: texto.length > 160 ? texto.slice(0, 157) + "…" : texto,
      url: "./#whatsapp", tag: `wa-${m.conversa_id}`,
    }];
  }

  if (evento === "tarefa_nova") {
    const { data: t } = await db.from("tarefas").select("titulo,prioridade,prazo,responsavel,criado_por").eq("id", id).maybeSingle();
    if (!t) return null;
    const prio: Record<string, string> = { alta: "🔴 Alta", media: "🟠 Média", baixa: "🔵 Baixa" };
    const prazo = t.prazo ? `prazo ${String(t.prazo).slice(8, 10)}/${String(t.prazo).slice(5, 7)}` : "";
    return ["tarefas", {
      titulo: `📋 Nova tarefa${t.criado_por ? ` de ${t.criado_por}` : ""}`,
      corpo: [t.titulo, prio[t.prioridade] ?? "", prazo, t.responsavel ? `para ${t.responsavel}` : ""].filter(Boolean).join(" · "),
      url: "./#dashboard", tag: `tarefa-${id}`,
    }];
  }

  if (evento === "estoque") {
    const zerou = Number(extra.estoque) === 0;
    return ["atualizacoes", {
      titulo: zerou ? `⛔ Esgotou: ${extra.nome}` : `⚠️ Estoque baixo: ${extra.nome}`,
      corpo: zerou ? "Saiu do site até você repor o estoque." : `Restam ${extra.estoque} un. Hora de repor.`,
      url: "./#produtos", tag: `estoque-${id}`,
    }];
  }
  return null;
}

// número no ícone do app: pedidos novos + mensagens não lidas
async function contador() {
  const [{ count }, { data: conv }] = await Promise.all([
    db.from("pedidos").select("id", { count: "exact", head: true }).eq("status", "novo"),
    db.from("wa_conversas").select("nao_lidas").gt("nao_lidas", 0),
  ]);
  return (count ?? 0) + (conv ?? []).reduce((s: number, c: Any) => s + (c.nao_lidas || 0), 0);
}

async function enviar(inscricoes: Any[], aviso: Aviso) {
  if (!inscricoes.length) return 0;
  const payload = JSON.stringify({ ...aviso, contador: await contador().catch(() => null) });
  let ok = 0;
  await Promise.all(inscricoes.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload,
        { TTL: 60 * 60 * 24, urgency: "high" });
      ok++;
    } catch (e) {
      const code = (e as Any).statusCode;
      // aparelho desinstalou o app ou cancelou a permissão: apaga a inscrição
      if (code === 404 || code === 410) await db.from("push_inscricoes").delete().eq("id", s.id);
      else console.error("push falhou", code, (e as Any).body ?? (e as Error).message);
    }
  }));
  return ok;
}
