import { api, setToken } from "./api.js";
import { emailInput } from "./email.js";
import { go, loadGroups, loadMe, saveRecovery, setGroup, state } from "./state.js";
import { busy, h, toast, wordmarkHeading } from "./util.js";
import { markNewAccountSeen } from "./whats-new-ui.js";

/** The signed-out screen, or the join screen when the URL is /join/<code>. */
export async function renderGate() {
  const code = inviteFromPath();
  if (code) return joinScreen(code);
  // The home page links here so a person with a recovery code lands on the recovery form.
  if (location.hash === "#/recover") return recoverScreen();
  return welcome();
}

function inviteFromPath() {
  const match = /^\/join\/([A-Za-z0-9]+)\/?$/.exec(location.pathname);
  return match ? match[1] : null;
}

function nameField() {
  return h("label", { class: "field" }, h("span", null, "Your first name"), h("input", { type: "text", id: "name", maxlength: "24", autocomplete: "given-name", required: true }));
}

function emailField() {
  return h("label", { class: "field" }, h("span", null, "Your email"), emailInput());
}

function intro() {
  return h("div", { class: "intro" }, wordmarkHeading(), h("p", { class: "tag" }, "Lend things to your friends. Borrow what you need. Invite-only groups, no passwords."));
}

function welcome() {
  const input = nameField();
  const email = emailField();
  const error = h("p", { class: "error-text", role: "alert" });
  const start = h("button", { class: "primary block", type: "submit" }, "Get started");
  const form = h("form", { class: "stack" }, input, email, h("p", { class: "muted small" }, "We use your email to confirm it is you and to get you back in if you lose your phone."), error, start, h("button", { class: "link block", type: "button", onclick: () => (page.replaceWith(recoverScreen())) }, "I have a recovery code"));
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    busy(start, async () => {
      try {
        const res = await api("POST", "/api/auth/start", { name: input.querySelector("input").value, email: email.querySelector("input").value });
        markNewAccountSeen();
        await finish(res);
        go("#/browse");
      } catch (e) {
        error.textContent = e.message;
      }
    });
  });
  const page = h("main", { class: "page gate" }, intro(), form);
  return page;
}

async function finish(res, groupId) {
  setToken(res.token);
  if (res.recoveryCode) saveRecovery(res.recoveryCode);
  state.user = null;
  await loadMe();
  // An older account without an email is sent to the add-email screen first. The server refuses its other calls.
  if (state.user.needsEmail) return;
  await loadGroups();
  if (groupId) setGroup(groupId);
}

function recoverScreen() {
  const code = h("input", { type: "text", id: "recover-code", autocomplete: "off", autocapitalize: "characters", placeholder: "XXXX-XXXX-XXXX" });
  const error = h("p", { class: "error-text", role: "alert" });
  const submit = h("button", { class: "primary block", type: "submit" }, "Sign back in");
  const form = h("form", { class: "stack" },
    h("p", { class: "muted" }, "Enter the recovery code from the You tab on your other phone."),
    h("label", { class: "field" }, h("span", null, "Recovery code"), code),
    error,
    submit,
    h("button", { class: "link block", type: "button", id: "lost-code-link", onclick: () => page.replaceWith(lostCodeScreen()) }, "Email me a new code"),
    h("button", { class: "link block", type: "button", onclick: () => (location.hash === "#/recover" ? location.replace(location.pathname) : location.reload()) }, "Back"),
  );
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    busy(submit, async () => {
      try {
        const res = await api("POST", "/api/auth/recover", { code: code.value });
        await finish(res);
        const inviteCode = inviteFromPath();
        if (inviteCode && !state.user.needsEmail) await api("POST", `/api/invites/${inviteCode}/join`);
        history.replaceState(null, "", "/");
        go("#/browse");
      } catch (e) {
        error.textContent = e.message;
      }
    });
  });
  const page = h("main", { class: "page gate" }, h("h1", null, "Welcome back"), form);
  return page;
}

/** Asks for a sign-in link by email. The answer is the same whether or not the address has an account. */
function lostCodeScreen() {
  const email = emailInput("lost-email");
  const error = h("p", { class: "error-text", role: "alert" });
  const send = h("button", { class: "primary block", type: "submit" }, "Email me a link");
  const form = h("form", { class: "stack" },
    h("p", { class: "muted" }, "Enter the email you signed up with. If we can use it, we will send a link that signs you in."),
    h("label", { class: "field" }, h("span", null, "Your email"), email),
    error,
    send,
    h("button", { class: "link block", type: "button", onclick: () => page.replaceWith(recoverScreen()) }, "Back"),
  );
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    busy(send, async () => {
      try {
        await api("POST", "/api/auth/lost-code", { email: email.value });
        page.replaceChildren(h("h1", null, "Check your email"), h("p", { class: "muted", id: "lost-code-sent" }, "If that address can sign in, a link is on its way. It works once and expires in 20 minutes."), h("button", { class: "link block", type: "button", onclick: () => page.replaceWith(recoverScreen()) }, "Back"));
      } catch (e) {
        error.textContent = e.message;
      }
    });
  });
  const page = h("main", { class: "page gate" }, h("h1", null, "Get a new code"), form);
  return page;
}

async function joinScreen(code) {
  let group;
  try {
    group = (await api("GET", `/api/invites/${code}`)).group;
  } catch (e) {
    return h("main", { class: "page gate" }, intro(), h("div", { class: "card" }, h("h2", null, "This invite link does not work"), h("p", { class: "muted" }, "Ask your friend for a new one."), h("a", { class: "btn", href: "/app" }, "Open Loan some")));
  }
  const signedIn = !!localStorage.getItem("loaner_token");
  const error = h("p", { class: "error-text", role: "alert" });
  const input = signedIn ? null : nameField();
  const email = signedIn ? null : emailField();
  const go1 = h("button", { class: "primary block", type: "submit" }, signedIn ? `Join ${group.name}` : `Join ${group.name}`);
  const form = h("form", { class: "stack" },
    signedIn ? h("p", { class: "muted" }, "You are signed in. Joining adds this group to your list.") : input,
    email,
    error,
    go1,
  );
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    busy(go1, async () => {
      try {
        let groupId;
        if (signedIn) {
          const res = await api("POST", `/api/invites/${code}/join`);
          groupId = res.group.id;
          state.user = null;
          await loadMe();
          await loadGroups();
          setGroup(groupId);
        } else {
          const res = await api("POST", "/api/auth/start", { name: input.querySelector("input").value, email: email.querySelector("input").value, inviteCode: code });
          markNewAccountSeen();
          await finish(res, res.groupId);
        }
        history.replaceState(null, "", "/");
        toast(`You joined ${group.name}`);
        go("#/browse");
      } catch (e) {
        error.textContent = e.message;
      }
    });
  });
  const rest = signedIn ? [] : [h("button", { class: "link block", type: "button", onclick: () => page.replaceWith(recoverScreen()) }, "I have a recovery code")];
  const page = h("main", { class: "page gate" }, intro(), h("div", { class: "callout" }, h("h2", { style: "margin:0" }, `Join ${group.name}?`)), form, ...rest);
  return page;
}
