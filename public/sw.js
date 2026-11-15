const CACHE = "loaner-v18";
const SHELL = [
  "/",
  "/app-kit/ak-tokens.css", "/app-kit/app-kit.css", "/app-kit/ak-components.css", "/app-kit/install-prompt.css",
  "/css/tokens.css", "/css/base.css", "/css/layout.css", "/css/items.css", "/css/forms.css", "/css/requests.css", "/css/messages.css", "/css/feedback.css", "/css/sheet.css", "/css/camera.css",
  "/fonts/inter-latin-var.woff2",
  "/app-kit/theme-color.js", "/app-kit/install-prompt.js", "/app-kit/ak-dom.js", "/app-kit/ak-nav.js", "/app-kit/ak-sheet.js", "/app-kit/ak-tabbar.js", "/app-kit/ak-toast.js",
  "/app.js", "/util.js", "/api.js", "/state.js", "/photo.js", "/icons.js", "/overlay.js",
  "/gate.js", "/groups.js", "/browse.js", "/requests.js", "/messages.js", "/mine.js", "/alerts.js", "/you.js",
  "/whats-new.js", "/changelog.js", "/whats-new-ui.js", "/feedback-ui.js",
  "/camera.js", "/draft.js", "/categories.js", "/suggest-photo.js", "/suggest-labels.js",
  "/manifest.webmanifest?v=1", "/logo.svg", "/icons/icon-192.png", "/icons/icon-512.png",
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
  let data = { title: "Loan some", body: "You have a new alert", url: "/", tag: "loaner" };
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
  const sameOrigin = (url) => new URL(url).origin === self.location.origin;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const client = clients.find((item) => sameOrigin(item.url) && "focus" in item);
      if (!client) return self.clients.openWindow(target);
      if (sameOrigin(target) && client.url !== target && "navigate" in client) {
        return client.navigate(target).then((moved) => (moved || client).focus(), () => client.focus());
      }
      return client.focus();
    }),
  );
});
