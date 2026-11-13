import { generateVapidKeys } from "./push.js";

const keys = generateVapidKeys();
console.log("Set these in the environment before `npm start`. Do not commit them.");
console.log("");
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log("VAPID_SUBJECT=mailto:you@example.com");
console.log("");
console.log("VAPID_SUBJECT must be a mailto: or https: URL. Push services receive it with each notification.");
