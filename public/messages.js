import { api } from "./api.js";
import { icon } from "./icons.js";
import { go, state } from "./state.js";
import { fmtMoment, h } from "./util.js";

const POLL_MS = 4000;

/** The hash of a thread. The borrower's own thread has no borrower id, the owner's names the borrower. */
export const threadHash = (itemId, borrowerId) => (borrowerId ? `#/item/${itemId}/messages/${borrowerId}` : `#/item/${itemId}/messages`);

/** A "Message" button with an unread dot. Opens the (item, borrower) thread. */
export function messageButton(itemId, borrowerId, unread, extraClass = "") {
  return h("button", { type: "button", class: `msg-btn ${extraClass}`.trim(), "data-open-thread": itemId, onclick: () => go(threadHash(itemId, borrowerId)) },
    "Message",
    unread ? h("span", { class: "dot", "data-unread": "", role: "img", "aria-label": "New messages" }) : null,
  );
}

function stamp(ms) {
  const time = new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return `${fmtMoment(ms)}, ${time}`;
}

/**
 * The thread screen. borrowerId is null for the borrower (the thread is with the caller) and set for the owner.
 * Message text only ever goes in through h(), so it is escaped.
 */
export async function renderMessages(itemId, borrowerId) {
  const route = location.hash;
  const path = `/api/items/${encodeURIComponent(itemId)}/messages${borrowerId ? `?borrower=${encodeURIComponent(borrowerId)}` : ""}`;
  const { thread } = await api("GET", path);
  const me = state.user.id;
  const other = thread.owner.id === me ? thread.borrower : thread.owner;
  let messages = thread.messages;

  const list = h("div", { class: "thread-list", "data-thread": "", role: "log", "aria-label": "Messages" });
  const draw = () => {
    list.replaceChildren(...(messages.length
      ? messages.map((m) => h("div", { class: `msg ${m.senderId === me ? "mine" : "theirs"}`, "data-msg": m.id },
          h("p", { class: "bubble" }, m.body),
          h("span", { class: "when" }, `${m.senderId === me ? "You" : other.name}, ${stamp(m.createdAt)}`),
        ))
      : [h("p", { class: "muted thread-empty" }, `No messages yet. Say hello to ${other.name}.`)]));
  };
  draw();

  const input = h("textarea", { id: "msg-body", maxlength: "1000", rows: "2", placeholder: `Message ${other.name}`, "aria-label": "Message" });
  const error = h("p", { class: "error-text", role: "alert" });
  const send = h("button", { class: "primary", type: "submit" }, "Send");
  const form = h("form", { class: "thread-composer", id: "msg-form" }, h("div", { class: "composer-row" }, input, send), error);

  const toEnd = () => window.scrollTo(0, document.documentElement.scrollHeight);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = input.value.trim();
    if (!body) {
      error.textContent = "Write a message first.";
      return;
    }
    error.textContent = "";
    send.disabled = true;
    try {
      const { message } = await api("POST", path, { body });
      input.value = "";
      if (!messages.some((m) => m.id === message.id)) messages = [...messages, message];
      draw();
      toEnd();
    } catch (e) {
      error.textContent = e.message;
    } finally {
      send.disabled = false;
    }
  });
  input.addEventListener("input", () => { error.textContent = ""; });

  const goBack = () => {
    if (window.history.length > 1) window.history.back();
    else go(`#/item/${itemId}`);
  };
  const head = h("div", { class: "thread-head" },
    h("button", { class: "icon-btn", type: "button", "aria-label": "Back", onclick: goBack }, icon("back")),
    h("div", { class: "grow" },
      h("h1", null, thread.item.name),
      h("p", { class: "muted small", "data-with": "" }, `With ${other.name}`),
    ),
  );
  const screen = h("div", { class: "thread" }, head, list, form);

  // Light poll while the thread is open, so a reply shows up without a manual refresh.
  let ticks = 0;
  let attached = false;
  const timer = setInterval(async () => {
    ticks += 1;
    if (screen.isConnected) attached = true;
    if (location.hash !== route || (attached && !screen.isConnected) || (!attached && ticks > 3)) {
      clearInterval(timer);
      return;
    }
    if (document.hidden) return;
    try {
      const fresh = (await api("GET", path)).thread.messages;
      const last = (rows) => (rows.length ? rows[rows.length - 1].id : "");
      if (fresh.length !== messages.length || last(fresh) !== last(messages)) {
        const nearEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 80;
        messages = fresh;
        draw();
        if (nearEnd) toEnd();
      }
    } catch (e) {
      if (e.status === 404) clearInterval(timer);
    }
  }, POLL_MS);

  // Opening the thread marks its alerts read on the server, so let the tab badge catch up.
  requestAnimationFrame(() => {
    toEnd();
    document.dispatchEvent(new Event("visibilitychange"));
  });
  return screen;
}
