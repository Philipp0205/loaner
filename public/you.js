import { api, setToken } from "./api.js";
import { createGroupForm, groupCard } from "./groups.js";
import { openFeedback } from "./feedback-ui.js";
import { redraw, loadGroups, loadMe, saveRecovery, savedRecovery, state } from "./state.js";
import { busy, copyText, h, toast } from "./util.js";
import { openWhatsNewList } from "./whats-new-ui.js";

export async function renderYou() {
  await loadGroups();
  const rerender = () => redraw("#/you");
  const parts = [h("h1", null, "You"), nameCard(rerender), recoveryCard(rerender), h("h2", null, "Your groups")];
  parts.push(state.groups.length ? state.groups.map((g) => groupCard(g, rerender)) : h("p", { class: "muted" }, "You are not in a group yet."));
  parts.push(h("div", { class: "card" }, h("h3", { style: "margin-bottom:8px" }, "Start a new group"), createGroupForm(rerender)));
  parts.push(pushCard());
  parts.push(h("h2", null, "About"),
    h("div", { class: "stack" },
      h("button", { type: "button", class: "block", id: "open-whats-new", onclick: openWhatsNewList }, "What's new"),
      h("button", { type: "button", class: "block", id: "open-feedback", onclick: openFeedback }, "Send feedback"),
      h("a", { class: "btn block", id: "open-privacy", href: "/privacy" }, "Privacy"),
    ));
  parts.push(h("h2", null, "This phone"), h("button", { type: "button", class: "block", id: "sign-out", onclick: signOut }, "Sign out of this phone"));
  return h("div", null, parts);
}

function nameCard(rerender) {
  const input = h("input", { type: "text", id: "profile-name", maxlength: "24", value: state.user.name });
  const save = h("button", { type: "submit" }, "Save name");
  const form = h("form", { class: "card" }, h("label", { class: "field" }, h("span", null, "Your name"), input), save);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    busy(save, async () => {
      await api("PATCH", "/api/me", { name: input.value });
      await loadMe();
      toast("Name saved");
      await rerender();
    });
  });
  return form;
}

/** Shows the recovery code kept on this phone, with copy and a way to make a new one. */
function recoveryCard(rerender) {
  const code = savedRecovery();
  const make = h("button", { type: "button", id: "new-code", onclick: () => busy(make, async () => {
    if (code && !confirm("Make a new code? The old one stops working.")) return;
    const res = await api("POST", "/api/me/recovery-code");
    saveRecovery(res.recoveryCode);
    await rerender();
  }) }, code ? "Make a new code" : "Show a recovery code");
  const body = [h("h3", null, "Recovery code"), h("p", { class: "muted small" }, "If you lose this phone, this code gets you back in on a new one. Keep it somewhere safe.")];
  if (code) {
    body.push(h("div", { class: "code", id: "recovery-code" }, code));
    body.push(h("div", { class: "row" },
      h("button", { type: "button", class: "primary", onclick: async () => toast((await copyText(code)) ? "Recovery code copied" : "Could not copy, select the code instead") }, "Copy code"),
      h("button", { type: "button", onclick: () => { saveRecovery(null); rerender(); } }, "Hide it on this phone"),
      make,
    ));
  } else {
    body.push(h("p", { class: "small" }, "The code is hidden on this phone. Making a new one replaces the old code."), h("div", { class: "row" }, make));
  }
  return h("section", { class: "card" }, body);
}

function pushCard() {
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const box = h("section", { class: "card" }, h("h3", null, "Phone notifications"));
  if (!supported) {
    box.append(h("p", { class: "muted small" }, "This browser cannot show push notifications. Alerts still appear in the app."));
    return box;
  }
  const button = h("button", { type: "button", id: "enable-push" }, "Turn on notifications");
  box.append(h("p", { class: "muted small" }, "Get a ping when someone asks for your item or it is due back."), button);
  button.addEventListener("click", () => busy(button, async () => {
    const { pushPublicKey } = await api("GET", "/api/config");
    if (!pushPublicKey) throw new Error("Push is not set up on this server. Alerts still appear in the app.");
    if ((await Notification.requestPermission()) !== "granted") throw new Error("Notifications are blocked for this site.");
    const registration = await navigator.serviceWorker.ready;
    const sub = (await registration.pushManager.getSubscription()) || (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToBytes(pushPublicKey) }));
    await api("POST", "/api/push/subscribe", sub.toJSON());
    toast("Notifications are on");
  }));
  return box;
}

function urlBase64ToBytes(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

async function signOut() {
  if (!confirm("Sign out of this phone? You will need your recovery code to get back in.")) return;
  try {
    await api("POST", "/api/auth/logout");
  } catch {
    /* the token is dropped locally either way */
  }
  setToken(null);
  saveRecovery(null);
  state.user = null;
  location.replace("/");
}
