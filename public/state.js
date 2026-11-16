import { api } from "./api.js";

const GROUP_KEY = "loaner_group";
const RECOVERY_KEY = "loaner_recovery";

export const state = {
  user: null,
  groups: [],
  groupId: localStorage.getItem(GROUP_KEY),
  unread: 0,
  today: "",
  availableOnly: false,
  pushKey: null,
};

export async function loadMe() {
  const me = await api("GET", "/api/me");
  state.user = me.user;
  state.unread = me.unread;
  state.today = me.today;
}

export async function loadGroups() {
  state.groups = (await api("GET", "/api/groups")).groups;
  if (!state.groups.some((group) => group.id === state.groupId)) setGroup(state.groups[0] ? state.groups[0].id : null);
}

export function setGroup(id) {
  state.groupId = id;
  if (id) localStorage.setItem(GROUP_KEY, id);
  else localStorage.removeItem(GROUP_KEY);
}

/**
 * An invite code waiting for an email. A legacy account that opens or recovers from /join/<code> must add an
 * address first, so the code is kept for the tab session and used once the address is saved (see email.js).
 */
const PENDING_INVITE_KEY = "loaner_pending_invite";
export const setPendingInvite = (code) => sessionStorage.setItem(PENDING_INVITE_KEY, code);
export function takePendingInvite() {
  const code = sessionStorage.getItem(PENDING_INVITE_KEY);
  sessionStorage.removeItem(PENDING_INVITE_KEY);
  return code;
}

export const currentGroup = () => state.groups.find((group) => group.id === state.groupId) || null;

export const inviteLink = (group) => `${location.origin}/join/${group.inviteCode}`;

/** The recovery code is kept on this device until the person hides it. */
export const savedRecovery = () => localStorage.getItem(RECOVERY_KEY);
export const saveRecovery = (code) => (code ? localStorage.setItem(RECOVERY_KEY, code) : localStorage.removeItem(RECOVERY_KEY));

export function go(hash) {
  if (location.hash === hash) window.dispatchEvent(new HashChangeEvent("hashchange"));
  else location.hash = hash;
}

/** The route being shown. An empty hash means Browse. */
const here = () => location.hash || "#/browse";

/**
 * Call when an action starts. The returned function says whether the person is still on the route
 * they started from. Use it after an await, so a slow request cannot pull them back from the tab
 * they have since opened.
 */
export function stayedPut() {
  const start = here();
  return () => here() === start;
}

/** Redraws the screen at `hash` after an action, but only if the person is still on it. */
export function redraw(hash) {
  if (here() === hash) go(hash);
}
