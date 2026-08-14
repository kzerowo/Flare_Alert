---
name: dev
description: Start the web dev server and the detector process together for local development, wait for both to become healthy, and report their status. Use when asked to start dev, run everything, "개발 서버 켜줘", "detector 켜줘", or similar.
---

# Start local development environment

This project has two independent long-running processes. Both must be up to see
an end-to-end alert (channel → detection → push) during local development.

1. **Web** — `pnpm dev:web`. Next.js dev server on http://localhost:3010.
   Pinned in `apps/web/package.json` (`next dev -p 3010`) — not the Next.js
   default 3000, because the user runs another, unrelated project on 3000
   and the two were colliding.
2. **Detector** — `pnpm dev:detector`. Watches Binance, computes signals,
   dispatches alerts. Health check at http://localhost:8080/health.

Neither process starts the other. Root `pnpm dev` alone only starts the web
app — don't assume one command covers both.

## Steps

Launch both directly as **real OS terminal windows**, not as tracked Bash
background tasks. The user watches these windows themselves, so there is
nothing to poll, no log to read back, no health check to verify — launching
them is the entire job.

Use `-WorkingDirectory` to set the directory, not an embedded `cd "..."; `
inside the `-Command` string. The repo path contains a space ("Flare Alert"),
so a quoted `cd` nested inside the already-quoted `-Command` argument gets
mis-parsed by `Start-Process` — the `cd` silently no-ops and the process
launches from the wrong directory (`MODULE_NOT_FOUND` on a path missing
`apps\detector`). `-WorkingDirectory` sets the cwd directly, so there's no
nested quoting at all.

```powershell
Start-Process powershell -WorkingDirectory "C:\Users\82104\Desktop\Flare Alert" -ArgumentList '-NoExit','-Command','pnpm dev:web'
Start-Process powershell -WorkingDirectory "C:\Users\82104\Desktop\Flare Alert\apps\detector" -ArgumentList '-NoExit','-Command','node --env-file-if-exists=../../.env dist/index.js'
```

If `apps/detector/dist/index.js` doesn't exist yet (fresh clone, or source
edited since last build), build first:

```powershell
Start-Process powershell -WorkingDirectory "C:\Users\82104\Desktop\Flare Alert" -ArgumentList '-NoExit','-Command','pnpm --filter @flare-alert/detector build; node --env-file-if-exists=./.env apps/detector/dist/index.js'
```

Then tell the user the two windows are open and the URLs (`http://localhost:3010`,
`http://localhost:8080/health`) — nothing more. They can read their own
terminal output directly; re-verifying it back to them burns tokens for
information they're already looking at.

## Notes

- Don't check `curl localhost:3000` / `curl localhost:8080/health` before
  launching "to see if it's already running" — that costs a round trip for
  something the user can see by glancing at their own terminals. If they say
  something's already up, take their word for it.
- Don't read detector boot output for the credentials banner
  (`독립 모드입니다`, `VAPID 키가 없습니다`) unless the user reports alerts
  aren't arriving — that check is real and worth doing *then*, per CLAUDE.md
  § "Detection works without any credentials — delivery does not," but it's
  not part of just starting the servers.
- These are independent OS processes now, outside Claude Code's background
  task tracking. To stop them, the user closes the terminal windows (or you
  find and kill by port — 3010 / 8080 — if asked).
