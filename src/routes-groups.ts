import { isMember, requireMember } from "./access.js";
import { newId, newInviteCode } from "./code.js";
import { all, get, run, tx } from "./db.js";
import { HttpError, jsonBody, me, type Ctx, type Route } from "./types.js";
import { text } from "./validate.js";

type GroupRow = { id: string; name: string; invite_code: string };

export function groupByInvite(ctx: Ctx, code: string): GroupRow | undefined {
  if (!/^[A-Z0-9]{6,20}$/i.test(code)) return undefined;
  return get<GroupRow>(ctx.db, "SELECT id, name, invite_code FROM groups WHERE invite_code = ?", code.toUpperCase());
}

/** Adds a member. Joining twice is fine. */
export function joinGroup(ctx: Ctx, userId: string, groupId: string): void {
  run(ctx.db, "INSERT OR IGNORE INTO memberships (group_id, user_id, joined_at) VALUES (?, ?, ?)", groupId, userId, ctx.now());
}

export function members(ctx: Ctx, groupId: string): { id: string; name: string }[] {
  return all(
    ctx.db,
    "SELECT u.id, u.name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.group_id = ? ORDER BY m.rowid",
    groupId,
  );
}

function groupView(ctx: Ctx, group: GroupRow) {
  return { id: group.id, name: group.name, inviteCode: group.invite_code, members: members(ctx, group.id) };
}

export function groupRoutes(): Route[] {
  return [
    {
      method: "GET",
      path: "/api/groups",
      handler(req) {
        const user = me(req);
        const rows = all<GroupRow>(
          req.ctx.db,
          "SELECT g.id, g.name, g.invite_code FROM groups g JOIN memberships m ON m.group_id = g.id WHERE m.user_id = ? ORDER BY m.rowid",
          user.id,
        );
        return { groups: rows.map((row) => groupView(req.ctx, row)) };
      },
    },
    {
      method: "POST",
      path: "/api/groups",
      handler(req) {
        const user = me(req);
        const name = text(jsonBody(req).name, "name", 1, 40);
        const id = newId();
        const invite = newInviteCode();
        tx(req.ctx.db, () => {
          run(req.ctx.db, "INSERT INTO groups (id, name, invite_code, created_by, created_at) VALUES (?, ?, ?, ?, ?)", id, name, invite, user.id, req.ctx.now());
          joinGroup(req.ctx, user.id, id);
        });
        return { group: groupView(req.ctx, { id, name, invite_code: invite }) };
      },
    },
    {
      // Public: the join screen shows the name before anyone has an account.
      method: "GET",
      path: "/api/invites/:code",
      open: true,
      handler(req) {
        const group = groupByInvite(req.ctx, req.params.code);
        if (!group) throw new HttpError(404, "that invite link does not work");
        return { group: { name: group.name } };
      },
    },
    {
      method: "POST",
      path: "/api/invites/:code/join",
      handler(req) {
        const user = me(req);
        const group = groupByInvite(req.ctx, req.params.code);
        if (!group) throw new HttpError(404, "that invite link does not work");
        joinGroup(req.ctx, user.id, group.id);
        return { group: groupView(req.ctx, group) };
      },
    },
    {
      method: "GET",
      path: "/api/groups/:id",
      handler(req) {
        const user = me(req);
        requireMember(req.ctx, user.id, req.params.id);
        const group = get<GroupRow>(req.ctx.db, "SELECT id, name, invite_code FROM groups WHERE id = ?", req.params.id)!;
        return { group: groupView(req.ctx, group) };
      },
    },
    {
      // Any member can rename: group membership is the trust, and created_by is not used for access.
      method: "PATCH",
      path: "/api/groups/:id",
      handler(req) {
        const user = me(req);
        requireMember(req.ctx, user.id, req.params.id);
        const name = text(jsonBody(req).name, "name", 1, 40);
        run(req.ctx.db, "UPDATE groups SET name = ? WHERE id = ?", name, req.params.id);
        const group = get<GroupRow>(req.ctx.db, "SELECT id, name, invite_code FROM groups WHERE id = ?", req.params.id)!;
        return { group: groupView(req.ctx, group) };
      },
    },
    {
      // Leaving removes the person's items from this group. Their open requests there stay as they are.
      method: "POST",
      path: "/api/groups/:id/leave",
      handler(req) {
        const user = me(req);
        if (!isMember(req.ctx, user.id, req.params.id)) throw new HttpError(404, "group not found");
        tx(req.ctx.db, () => {
          run(req.ctx.db, "DELETE FROM item_groups WHERE group_id = ? AND item_id IN (SELECT id FROM items WHERE owner_id = ?)", req.params.id, user.id);
          run(req.ctx.db, "DELETE FROM memberships WHERE group_id = ? AND user_id = ?", req.params.id, user.id);
        });
        return { ok: true };
      },
    },
  ];
}
