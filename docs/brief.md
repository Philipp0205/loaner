# Loan some: brief

Loan some (formerly called Loaner) lets people lend their things to people nearby. You have a drill you use twice a year. Your neighbour needs one on Saturday. Loan some connects the two of you and keeps track of who has what.

## Who it's for

- **Loaners** own things worth lending: tools, a ladder, a tent, a projector, board games. They want to help without losing track of their stuff.
- **Borrowers** need something for a day or a weekend and would rather not buy it.

Everyone can be both. "Loaner" is a role you take when you list your first item, not a separate account type.

v1 is for groups of friends who already know each other, joined by invite link, the same way Hangry's circles work. A person can be in several groups (family, flatmates, climbing club). Being in the group is the trust: anyone in it can borrow anything listed there. No public marketplace.

## The core flow

1. **List.** A loaner adds an item: up to 6 photos (taken with the camera or picked from the gallery), a name and category, a short note ("battery lasts about 30 min"), whether it's available, and optionally a suggested donation for valuable things, as an amount or a few words.
2. **Request.** A borrower picks an item, chooses from and until dates, and adds a message.
3. **Approve.** The loaner gets notified and says yes or no. Other requests for the same dates are blocked once one is approved.
4. **Hand over.** When the item changes hands, the loaner taps "handed over". The item now shows as lent to that person, with a due date.
5. **Return.** The borrower gives it back and the loaner taps "returned". The item becomes available again. Both sides get a reminder the day before it's due, and the loaner gets a nudge if it's late.

Each item has a simple history: who borrowed it, and when.

## In v1

- Invite-only groups, several per person, passwordless accounts (device token plus a recovery code, like Hangry)
- List, edit, pause and delete items, with up to 6 photos each
- Mark an item "for a donation" with a suggested amount or a few words (like "a beer"); the borrower sees it before requesting. Money changes hands outside the app.
- Choose which of your groups each item is visible in
- Browse a group's items, filter by available
- Request with dates, approve or decline, hand over, return
- In-app notifications, plus web push when it's set up
- Mobile-first PWA you can install on your home screen

## Explicitly out of v1

In-app payments, deposits, damage and loss handling, ratings and reviews, maps and distance, chat beyond the request message, public listings, search across groups, insurance, damage claims.

## Decided

- **Trust.** Group membership is enough. Friends only, no per-person permissions.
- **Valuable items.** A loaner can ask for a donation. The app shows the suggested amount; paying happens in person or by bank transfer, not in the app.
- **Damage and loss.** Not handled in the app.
- **Groups.** Several per person.
- **Name.** The app is called Loan some (formerly Loaner).
