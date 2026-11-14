import { createRequire } from "node:module";
import type { VapidConfig } from "./config.js";

const require = createRequire(import.meta.url);

type WebPush = {
  setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
  sendNotification(
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: string,
    options?: { TTL?: number; urgency?: "high" | "normal" | "low" },
  ): Promise<unknown>;
  generateVAPIDKeys(): { publicKey: string; privateKey: string };
};

const webpush = require("web-push") as WebPush;

export type PushSubscription = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type PushPayload = {
  title: string;
  body: string;
  url: string;
  tag: string;
};

export interface PushSender {
  /** Rejects with an error carrying statusCode 404 or 410 when the subscription is gone. */
  send(subscription: PushSubscription, payload: PushPayload): Promise<void>;
}

export function createWebPushSender(vapid: VapidConfig): PushSender {
  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  return {
    async send(subscription, payload) {
      await webpush.sendNotification(
        { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
        JSON.stringify(payload),
        { TTL: 24 * 60 * 60, urgency: "normal" },
      );
    },
  };
}

export function createNoopPushSender(): PushSender {
  return {
    async send() {
      /* Web Push is not configured. In-app notifications still record the event. */
    },
  };
}

export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  return webpush.generateVAPIDKeys();
}
