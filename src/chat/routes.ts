import { requireMember } from "../access.js";
import { HttpError, Reply, jsonBody, me, type Route } from "../types.js";
import { chatList } from "./list.js";
import type { GroupChat } from "./service.js";

const REASONS = { empty: "write a message first", too_long: "that message is too long" } as const;

/**
 * The group chat routes (the kit owns none). Every one checks membership first, and answers 404 for a
 * non-member (requireMember), so nobody learns whether a group exists. The chat row is made on first use.
 */
export function chatRoutes(groupChat: GroupChat): Route[] {
  const { chat } = groupChat;
  /** The signed-in member's id, after the membership check and with the chat row in place. */
  const member = (req: Parameters<Route["handler"]>[0]) => {
    const user = me(req);
    requireMember(req.ctx, user.id, req.params.id);
    groupChat.ensure(req.params.id);
    return user;
  };

  return [
    {
      // The Chat tab: my groups, newest message first, each with its last message and unread count.
      method: "GET",
      path: "/api/chats",
      async handler(req) {
        return { chats: await chatList(req.ctx, groupChat, me(req).id) };
      },
    },
    {
      // The thread. Opening it marks the chat read (the kit's thread() does not).
      method: "GET",
      path: "/api/groups/:id/chat",
      async handler(req) {
        const user = member(req);
        const thread = await chat.thread(req.params.id, user.id);
        await chat.markRead(req.params.id, user.id);
        return thread;
      },
    },
    {
      method: "POST",
      path: "/api/groups/:id/chat",
      async handler(req) {
        const user = member(req);
        const result = await chat.post(req.params.id, { id: user.id, name: user.name }, jsonBody(req).text);
        if (!result.ok) return new Reply(400, { error: REASONS[result.reason], reason: result.reason });
        groupChat.schedulePush(req.params.id, user.id);
        return new Reply(201, { message: result.message });
      },
    },
    {
      // The frontend's markRead hook: called when a poll brought new messages from others.
      method: "POST",
      path: "/api/groups/:id/chat/read",
      async handler(req) {
        const user = member(req);
        await chat.markRead(req.params.id, user.id);
        return { ok: true };
      },
    },
    {
      method: "POST",
      path: "/api/groups/:id/chat/mute",
      async handler(req) {
        const user = member(req);
        const { muted } = jsonBody(req);
        if (typeof muted !== "boolean") throw new HttpError(400, "muted must be true or false");
        await chat.setMuted(req.params.id, user.id, muted);
        return { muted };
      },
    },
  ];
}
