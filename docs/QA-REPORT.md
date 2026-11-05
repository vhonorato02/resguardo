# Resguardo QA, 2026-11-05

RC7 production: 25 unit tests; Playwright mobile 390px and desktop. Verified shift start/pause/resume/finish, incidents with HTML escaped, PNG upload and byte-identical download, backup/export/restore, offline reload IndexedDB, owner-local isolation for A/B, auth token refresh single-flight simulated, CSP, and RLS tests in PostgreSQL transaction with rollback.

RC8: add GitHub source, CI, automated cron API checks, narrow RPC-only notification server logic. Secrets never in GitHub.

Open gates: real Auth confirmation/reset mail redirect, two-account live remote sync and Storage, push receipt on Android with application closed, service RPC credential provisioning, Git/Vercel integration, CI status.

Status: RC, not stable.
