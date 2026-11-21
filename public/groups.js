import { api } from "./api.js";
import { inviteLink, loadGroups, setGroup, state, stayedPut } from "./state.js";
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

/** One group: name with a rename button, members, invite link with a copy button, and leave. */
export function groupCard(group, rerender) {
  const link = inviteLink(group);
  const copy = h("button", { type: "button", class: "primary", onclick: async () => toast((await copyText(link)) ? "Invite link copied" : "Could not copy, select the link instead", "info") }, "Copy invite link");
  const leave = h("button", { type: "button", class: "danger", onclick: () => leaveGroup(group, leave, rerender) }, "Leave group");
  const rename = h("button", { type: "button", class: "group-rename-open" }, "Rename");
  const title = h("div", { class: "card-top" }, h("h3", null, group.name), rename);
  rename.addEventListener("click", () => {
    const form = renameForm(group, rerender, () => {
      form.remove();
      rename.classList.remove("hidden");
      rename.focus();
    });
    rename.classList.add("hidden");
    title.after(form);
    form.querySelector("input").focus();
  });
  return h("section", { class: "card", "data-group": group.id },
    title,
    membersList(group),
    h("p", { class: "small" }, "Anyone with this link can join:"),
    h("code", { class: "invite-link" }, link),
    h("div", { class: "row" }, copy, leave),
  );
}

/** Members: initial circle, name, a You marker for the current person, and whether notifications are on. */
function membersList(group) {
  const rows = group.members.map((member) => {
    const mine = !!state.user && member.id === state.user.id;
    const reach = member.notificationsOn ? "Notifications on" : "Notifications off";
    return h("li", { class: "member" },
      h("span", { class: "avatar", "aria-hidden": "true" }, (member.name || "?").slice(0, 1).toUpperCase()),
      h("span", { class: "member-text" },
        h("b", null, member.name),
        h("span", { class: "sub" }, mine ? `You \u00b7 ${reach}` : reach)));
  });
  return h("div", { class: "members" }, h("h4", null, "Members"), h("ul", { class: "list members-list" }, rows));
}


/** Short form with the current name filled in. Any member can rename. Errors show in the form. */
function renameForm(group, rerender, cancel) {
  const input = h("input", { type: "text", id: "group-rename-name", maxlength: "40", value: group.name });
  const error = h("p", { class: "error-text", role: "alert" });
  const save = h("button", { class: "primary", type: "submit" }, "Save name");
  const form = h("form", { class: "stack", id: "group-rename-form" },
    h("label", { class: "field" }, h("span", null, "Group name"), input),
    error,
    h("div", { class: "row" }, save, h("button", { type: "button", onclick: cancel }, "Cancel")),
  );
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    error.textContent = "";
    busy(save, async () => {
      try {
        await api("PATCH", `/api/groups/${group.id}`, { name: input.value });
      } catch (e) {
        error.textContent = e.message;
        return;
      }
      await loadGroups();
      toast("Group renamed");
      await rerender();
    });
  });
  return form;
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
