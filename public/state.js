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

export const currentGroup = () => state.groups.find((group) => group.id === state.groupId) || null;

export const inviteLink = (group) => `${location.origin}/join/${group.inviteCode}`;

/** The recovery code is kept on this device until the person hides it. */
export const savedRecovery = () => localStorage.getItem(RECOVERY_KEY);
export const saveRecovery = (code) => (code ? localStorage.setItem(RECOVERY_KEY, code) : localStorage.removeItem(RECOVERY_KEY));

export function go(hash) {
  if (location.hash === hash) window.dispatchEvent(new HashChangeEvent("hashchange"));
  else location.hash = hash;
}
