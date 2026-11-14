const CACHE = "loaner-v4";
const SHELL = [
  "/",
  "/css/tokens.css", "/css/base.css", "/css/layout.css", "/css/items.css", "/css/forms.css", "/css/requests.css", "/css/feedback.css", "/css/sheet.css",
  "/fonts/inter-latin-var.woff2",
  "/app.js", "/util.js", "/api.js", "/state.js", "/photo.js", "/icons.js",
  "/gate.js", "/groups.js", "/browse.js", "/requests.js", "/mine.js", "/alerts.js", "/you.js",
  "/whats-new.js", "/changelog.js", "/whats-new-ui.js",
  "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))));
  self.clients.claim();
});

// Network first for the app shell, so a deploy shows up at once. The cache is the offline fallback.
// The API is never cached: it carries private data.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy)).catch(() => {});
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((hit) => hit || caches.match("/"))),
  );
});

self.addEventListener("push", (event) => {
  let data = { title: "Loaner", body: "You have a new alert", url: "/", tag: "loaner" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    /* keep the fallback text */
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icons/icon-192.png",
      tag: data.tag,
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.startsWith(self.location.origin) && "focus" in client) return client.focus();
      }
      return self.clients.openWindow(target);
    }),
  );
});
