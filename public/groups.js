import { api } from "./api.js";
import { inviteLink, loadGroups, setGroup, stayedPut } from "./state.js";
import { busy, copyText, h, toast } from "./util.js";

/**
 * Name field and button that create a group, then call onDone(group).
 * onDone only runs if the person is still on the screen they submitted from: if they tapped
 * another tab while the request was out, they stay where they went.
 */
export function createGroupForm(onDone) {
  const input = h("input", { type: "text", id: "group-name", maxlength: "40", placeholder: "Flat 3B, Climbing club...", required: true });
  const error = h("p", { class: "error-text", role: "alert" });
  const button = h("button", { class: "primary", type: "submit" }, "Create group");
  const form = h("form", { class: "stack" }, h("label", { class: "field" }, h("span", null, "Group name"), input), error, button);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const samePlace = stayedPut();
    busy(button, async () => {
      try {
        const { group } = await api("POST", "/api/groups", { name: input.value });
        await loadGroups();
        setGroup(group.id);
        if (samePlace()) await onDone(group);
      } catch (e) {
        error.textContent = e.message;
      }
    });
  });
  return form;
}

/** One group: members, invite link with a copy button, and leave. */
export function groupCard(group, rerender) {
  const link = inviteLink(group);
  const copy = h("button", { type: "button", class: "primary", onclick: async () => toast((await copyText(link)) ? "Invite link copied" : "Could not copy, select the link instead", "info") }, "Copy invite link");
  const leave = h("button", { type: "button", class: "danger", onclick: () => leaveGroup(group, leave, rerender) }, "Leave group");
  return h("section", { class: "card", "data-group": group.id },
    h("h3", null, group.name),
    h("p", { class: "muted small" }, `${group.members.length} ${group.members.length === 1 ? "member" : "members"}: ${group.members.map((m) => m.name).join(", ")}`),
    h("p", { class: "small" }, "Anyone with this link can join:"),
    h("code", { class: "invite-link" }, link),
    h("div", { class: "row" }, copy, leave),
  );
}

async function leaveGroup(group, button, rerender) {
  if (!confirm(`Leave ${group.name}? Your items will no longer be shared there.`)) return;
  await busy(button, async () => {
    await api("POST", `/api/groups/${group.id}/leave`);
    await loadGroups();
    toast(`You left ${group.name}`);
    await rerender();
  });
}
