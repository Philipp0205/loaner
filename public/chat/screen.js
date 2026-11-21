import { api } from "../api.js";
import { icon } from "../icons.js";
import { go, state } from "../state.js";
import { h, toast } from "../util.js";
import { CHAT_COPY } from "./copy.js";

let active = null;

/** Stops the chat poller and removes its pane. Safe to call any time; app.js calls it whenever the route changes. */
export function stopChat() {
  if (active) active.destroy();
  active = null;
}

const goBack = () => (window.history.length > 1 ? window.history.back() : go("#/you"));

/** The mute button. `set(muted)` updates its label and state. */
function muteControl(groupId, startMuted) {
  let muted = startMuted;
  const button = h("button", { type: "button", id: "chat-mute", class: "chat-mute" });
  const draw = () => {
    button.textContent = muted ? CHAT_COPY.unmute : CHAT_COPY.mute;
    button.setAttribute("aria-pressed", muted ? "true" : "false");
    button.setAttribute("title", muted ? CHAT_COPY.unmuteHint : CHAT_COPY.muteHint);
  };
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const res = await api("POST", `/api/groups/${encodeURIComponent(groupId)}/chat/mute`, { muted: !muted });
      muted = res.muted;
      draw();
      toast(muted ? CHAT_COPY.nowMuted : CHAT_COPY.nowUnmuted);
    } catch (error) {
      toast(error.message, "error");
    } finally {
      button.disabled = false;
    }
  });
  draw();
  return { button, set: (value) => { muted = value; draw(); } };
}

/** Mounts the kit pane once the screen is in the page, so its first scroll to the bottom has a real height. */
function mountWhenAttached(screen, host, options) {
  const until = Date.now() + 3000;
  const tick = () => {
    if (screen.isConnected) active = window.AppKit.chat.mount(host, options);
    else if (Date.now() < until) requestAnimationFrame(tick);
  };
  tick();
}

/**
 * The group chat screen for #/group/:id/chat. The first read happens here, so a group that is not yours
 * (a 404) shows the usual error and retry. The kit pane then loads, polls and sends.
 */
export async function renderChat(groupId) {
  stopChat();
  const base = `/api/groups/${encodeURIComponent(groupId)}/chat`;
  let first = await api("GET", base);
  const group = state.groups.find((item) => item.id === groupId);
  const mute = muteControl(groupId, first.muted);

  const load = async () => {
    const thread = first || (await api("GET", base));
    first = null;
    mute.set(thread.muted);
    return thread;
  };
  const head = h("div", { class: "thread-head" },
    h("button", { class: "icon-btn", type: "button", "aria-label": CHAT_COPY.back, onclick: goBack }, icon("back")),
    h("div", { class: "grow" }, h("h1", null, group ? group.name : CHAT_COPY.title), h("p", { class: "muted small" }, CHAT_COPY.title)),
    mute.button,
  );
  const host = h("div", { class: "chat-host" });
  const screen = h("div", { class: "chat-screen" }, head, host);

  mountWhenAttached(screen, host, {
    meId: state.user.id,
    load,
    send: async (text) => (await api("POST", base, { text })).message,
    markRead: () => api("POST", `${base}/read`, {}),
    placeholder: CHAT_COPY.placeholder,
    labels: { send: CHAT_COPY.send, sending: CHAT_COPY.sending, failed: CHAT_COPY.failed, empty: CHAT_COPY.empty },
  });
  return screen;
}
