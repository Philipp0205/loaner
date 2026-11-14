# Loaner

Invite-only app for lending things to friends. Spec: `docs/brief.md`. Read it before changing anything.

## Stack

- TypeScript, Node >= 22.5 (uses `node:sqlite`), run with `tsx`.
- Mobile-first PWA served as static files from `public/`.
- Minimal dependencies. Do not add a dependency unless there is no reasonable alternative.
- npm scripts: `start`, `dev`, `build`, `typecheck`, `test`, `test:ui`.

## Gate

`scripts/check.sh` must pass before you claim anything is done. It runs `npm ci`, `npm run typecheck`, `npm test`, `npm run test:ui` in order and stops at the first failure. Report what it actually printed.

## Scope

v1 is what `docs/brief.md` lists under "In v1". No payments, deposits, ratings, maps or public listings. A suggested donation is display only; the app never touches money.

## Workflow

- Work on a feature branch and open a PR. Never push to `main` after the initial commit. Never merge.
- Fake data only in tests and screenshots.

## Tools

- Search code and logs with the grep tool, find files with the glob tool, view files with the read tool (use offset/limit for long logs). Do not use `cat`, `sed -n`, `head`, `tail`, `grep`, `rg` or `ls -R` in bash to read or search files. Trimming a command's own output (`npm test 2>&1 | tail`) is fine.
- Bash is for running commands (npm scripts, `scripts/check.sh`, git). Do not probe the permission rules with dummy commands (`python3 -c`, empty `cat >` heredocs).

## Safety

- Never commit secrets: no `.env`, tokens, recovery codes, VAPID private keys, or database files.
- No deploys, hosting, or real user data.

## Style

- Never use em dashes in code comments, copy, commits, or PR text.
- Mobile first. Keep things small and readable.
