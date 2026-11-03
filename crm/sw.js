// =====================================================================
//  PRIME PERFUMES · CRM — Service Worker
//  Recebe as notificações push (pedido novo, mensagem no WhatsApp,
//  atualizações) mesmo com o CRM fechado, e abre a tela certa ao tocar.
//  No iPhone só funciona com o CRM instalado pela opção
//  "Adicionar à Tela de Início" do Safari (iOS 16.4 ou mais novo).
// =====================================================================
const ICONE = 'img/crm-favicon-192.png';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = {corpo: e.data && e.data.text()}; }
  const avisos = [
    // O iOS cancela a permissão se um push chegar sem notificação visível: sempre mostra uma.
    self.registration.showNotification(d.titulo || 'Prime CRM', {
      body: d.corpo || '',
      tag: d.tag,                    // mesma tag = substitui a anterior (ex.: várias mensagens da mesma conversa)
      renotify: !!d.tag,
      icon: ICONE,
      badge: ICONE,
      timestamp: Date.now(),
      data: {url: d.url || './'}
    })
  ];
  // número no ícone da Tela de Início (pedidos novos + mensagens não lidas)
  if (d.contador != null && self.navigator.setAppBadge) {
    avisos.push(d.contador > 0 ? self.navigator.setAppBadge(d.contador) : self.navigator.clearAppBadge());
  }
  e.waitUntil(Promise.all(avisos).catch(() => {}));
});

// O navegador trocou a inscrição (expirou/renovou): inscreve de novo com a mesma chave e avisa o CRM
// aberto para gravar a nova no banco. Com o CRM fechado, ele grava sozinho na próxima vez que abrir.
self.addEventListener('pushsubscriptionchange', e => {
  e.waitUntil((async () => {
    const opts = e.oldSubscription && e.oldSubscription.options;
    if (opts && opts.applicationServerKey) {
      try { await self.registration.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: opts.applicationServerKey}); } catch {}
    }
    const abertos = await self.clients.matchAll({type: 'window', includeUncontrolled: true});
    abertos.forEach(c => c.postMessage({pushSync: true}));
  })());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const alvo = new URL(e.notification.data && e.notification.data.url || './', self.registration.scope);
  e.waitUntil((async () => {
    const abertos = await self.clients.matchAll({type: 'window', includeUncontrolled: true});
    const crm = abertos.find(c => c.url.startsWith(self.registration.scope));
    if (crm) {
      // CRM já aberto: só troca de tela (sem recarregar)
      crm.postMessage({ir: alvo.hash});
      return crm.focus();
    }
    return self.clients.openWindow(alvo.href);
  })());
});
