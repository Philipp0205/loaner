import { api, setToken } from "./api.js";
import { loadGroups, loadMe, saveRecovery, setGroup, state, takePendingInvite } from "./state.js";
import { busy, copyText, h, toast, wordmarkHeading } from "./util.js";

const WHY = "We use it to confirm it is you and to get you back in if you lose your phone.";

/** "verify" or "recover" when the URL is one of the email link pages, otherwise null. */
export function linkKindFromPath(pathname = location.pathname) {
  const match = /^\/(verify|recover)\/?$/.exec(pathname);
  return match ? match[1] : null;
}

export function emailInput(id = "email") {
  return h("input", { type: "email", id, maxlength: "254", autocomplete: "email", autocapitalize: "off", spellcheck: "false", required: true });
}

/**
 * Shown to an account from before email was required. It cannot be dismissed and there is no way around it:
 * the server answers 403 on everything else until an address is saved. onDone runs once it is.
 * A pending invite (see state.js) is joined right after the save. `groupName` says which group, when known.
 */
export function renderAddEmail(onDone, groupName = "") {
  const input = emailInput();
  const error = h("p", { class: "error-text", role: "alert" });
  const save = h("button", { class: "primary block", type: "submit" }, "Save email");
  const form = h("form", { class: "stack" },
    h("label", { class: "field" }, h("span", null, "Your email"), input),
    error,
    save,
  );
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    busy(save, async () => {
      try {
        await api("PUT", "/api/me/email", { email: input.value });
        await loadMe();
      } catch (e) {
        error.textContent = e.message;
        return;
      }
      await joinPendingInvite();
      try {
        await loadGroups();
        await onDone();
      } catch (e) {
        error.textContent = e.message;
      }
    });
  });
  const lead = groupName ? `To join ${groupName}, add your email first.` : "Loan some now asks for an email.";
  return h("main", { class: "page gate" },
    h("div", { class: "intro" }, wordmarkHeading()),
    h("h2", null, "Add your email"),
    h("p", { class: "muted", id: "add-email-why" }, `${lead} ${WHY} We will send you a link to confirm it.`),
    form,
  );
}

/**
 * Joins the group of a pending invite, once, now that the account has an email. A stale or failed invite
 * is reported and dropped so it never keeps the person on the add-email screen.
 */
async function joinPendingInvite() {
  const code = takePendingInvite();
  if (!code) return;
  try {
    const res = await api("POST", `/api/invites/${code}/join`);
    setGroup(res.group.id);
    toast(`You joined ${res.group.name}`);
  } catch (e) {
    toast(e.message, "error");
  }
}

/** A quiet reminder above the screen while the address is not confirmed yet. Null when there is nothing to say. */
export function confirmBanner() {
  const user = state.user;
  if (!user || !user.email || user.emailVerifiedAt) return null;
  const again = h("button", { type: "button", id: "resend-confirm" }, "Send again");
  again.addEventListener("click", () => busy(again, async () => {
    await api("POST", "/api/me/email", { email: user.email });
    toast("Link sent");
  }));
  return h("section", { class: "callout", id: "confirm-banner", "aria-label": "Confirm your email" },
    h("p", { class: "small", style: "margin:0" }, `Confirm your email: we sent a link to ${user.email}.`),
    h("div", { class: "row", style: "margin-top:8px" }, again, h("a", { class: "btn", href: "#/you" }, "Open You")),
  );
}

/** The email card on the You tab. The address can be changed only while it is not confirmed. */
export function emailCard(rerender) {
  const user = state.user;
  const body = [h("h3", null, "Email")];
  if (user.emailVerifiedAt) {
    body.push(h("p", { class: "small", id: "email-status" }, `${user.email} is confirmed.`));
    return h("section", { class: "card", id: "email-card" }, body);
  }
  const input = emailInput("profile-email");
  input.value = user.email || "";
  const save = h("button", { type: "submit" }, "Save and send link");
  const form = h("form", null,
    h("p", { class: "muted small", id: "email-status" }, "Not confirmed yet. Use the link we sent, or ask for a new one."),
    h("label", { class: "field" }, h("span", null, "Your email"), input),
    save,
  );
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    busy(save, async () => {
      await api("PUT", "/api/me/email", { email: input.value });
      await loadMe();
      toast("Link sent");
      await rerender();
    });
  });
  body.push(form);
  return h("section", { class: "card", id: "email-card" }, body);
}

/** The token sits in the URL fragment, so it is never sent to the server by a page load or a mail scanner. */
function tokenFromHash() {
  return new URLSearchParams(location.hash.replace(/^#/, "")).get("t") || "";
}

/** /verify and /recover. Nothing happens until the person presses the button, so a link preview cannot use it up. */
export function renderLinkPage(kind) {
  const token = tokenFromHash();
  const page = h("main", { class: "page gate" }, h("div", { class: "intro" }, wordmarkHeading()));
  const message = (title, text, ...extra) => page.append(h("h2", null, title), text ? h("p", { class: "muted" }, text) : null, ...extra);
  if (!token) {
    message("This link is not complete", "Open it again from the email, or ask for a new one.", h("a", { class: "btn", href: "/app" }, "Open Loan some"));
    return page;
  }
  const error = h("p", { class: "error-text", role: "alert" });
  const verify = kind === "verify";
  const button = h("button", { class: "primary block", type: "button", id: verify ? "confirm-email" : "sign-in-link" }, verify ? "Confirm my email" : "Sign me in");
  button.addEventListener("click", () => busy(button, async () => {
    try {
      if (verify) {
        await api("POST", "/api/auth/verify", { token });
        history.replaceState(null, "", location.pathname);
        page.replaceChildren(h("div", { class: "intro" }, wordmarkHeading()), h("h2", null, "Email confirmed"), h("p", { class: "muted" }, "Thanks, you are all set."), h("a", { class: "btn", id: "open-app", href: "/app" }, "Open Loan some"));
        return;
      }
      const res = await api("POST", "/api/auth/lost-code/consume", { token });
      history.replaceState(null, "", location.pathname);
      setToken(res.token);
      state.user = null;
      if (res.recoveryCode) saveRecovery(res.recoveryCode);
      page.replaceChildren(h("div", { class: "intro" }, wordmarkHeading()), h("h2", null, "You are back in"), recoveryNotice(res.recoveryCode));
    } catch (e) {
      error.textContent = e.message;
    }
  }));
  message(verify ? "Confirm your email" : "Sign in to Loan some", verify ? "Press the button to confirm this address." : "Press the button to sign in on this phone.", error, button);
  return page;
}

/** Shown once after a lost-code sign-in: the old code stopped working, this is the new one. */
function recoveryNotice(code) {
  const parts = [];
  if (code) {
    parts.push(
      h("p", { class: "muted" }, "Your old recovery code no longer works. Here is a new one. Keep it somewhere safe."),
      h("div", { class: "code", id: "new-recovery-code" }, code),
      h("button", { type: "button", class: "block", onclick: async () => toast((await copyText(code)) ? "Recovery code copied" : "Could not copy, select the code instead") }, "Copy code"),
    );
  }
  parts.push(h("button", { type: "button", class: "primary block", id: "continue-app", onclick: () => location.replace("/app") }, "Continue"));
  return h("div", { class: "stack" }, parts);
}
