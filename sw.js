/* Service worker WapChatt: syarat pemasangan aplikasi + penerima notifikasi. Tidak menyimpan cache, jadi update selalu langsung terpakai. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});  // biarkan browser mengambil dari jaringan

/* Notifikasi dari server (Web Push). Tidak ditampilkan kalau aplikasi sedang terbuka dan terlihat. */
self.addEventListener("push", (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch { d = { title: "WapChatt", body: e.data && e.data.text() }; }
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (wins.some((w) => w.visibilityState === "visible")) return;
    await self.registration.showNotification(d.title || "WapChatt", {
      body: d.body || "", tag: d.tag || "wapchatt", renotify: true, icon: "icon-192.png", badge: "icon-192.png",
      vibrate: d.call ? [300, 150, 300, 150, 300] : [120], requireInteraction: !!d.call, data: { peer: d.peer || "" },
    });
  })());
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const peer = (e.notification.data || {}).peer || "";
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (wins.length) { const w = wins[0]; await w.focus(); w.postMessage({ open: peer }); return; }
    await self.clients.openWindow("/dashboard.html" + (peer ? "?o=" + encodeURIComponent(peer) : ""));
  })());
});
