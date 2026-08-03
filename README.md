# VerifyMate — Watch. Know. Act.

One control plane for the whole operation: nine domains, seven apps, three sites,
four businesses. It verifies reality on a schedule, remembers what was decided,
and carries out changes on one-click approval.

**The core idea: the state lives here, not in a chat window.** Every agent
session loads `/api/context` before it speaks and writes back as it works —
see **AGENT.md** for the 20-stage contract.

## Pieces

- `/` — the public product (active functional + deliverability verification, `/api/verify`)
- `/dashboard` — the operations dashboard (agent key required; morning glance, approvals, vault, money)
- `api/context|verdict|session` — state: LOAD / RECORD / HANDOFF
- `api/cron/run-checks` — 40 live checks daily (sites, DNS, apps, locked endpoints, silence alarms)
- `api/cron/digest` — the 7am email
- `api/vault` — write-only secrets (AES-256-GCM; no read path exists)
- `api/actions` — dry-run → approve → execute → audit, rollback recorded first
- `api/money` — revenue truth from Stripe (restricted key)
- `api/guard` — brand locks as executable checks

## Env (Vercel)

| Var | What |
|---|---|
| `VERIFYMATE_AGENT_KEY` | Gates every operator route. Fail closed. |
| `CRON_SECRET` | Vercel cron auth (also accepted on cron/money routes). |
| `VERIFYMATE_VAULT_KEY` | 64 hex chars; encrypts the vault. Generate on the dashboard. |
| `FIREBASE_SERVICE_ACCOUNT_KEY` | The store. Copy from the walker-works project. Without it: reads serve the seed, writes refuse loudly. |
| `RESEND_API_KEY`, `ALERT_TO`, `ALERT_FROM` | Alert + digest email (transactional — Resend's correct use). |

## Gates (run before every commit)

```
npm run typecheck   # tsc, checkJs — green or it doesn't ship
npm test            # 36 tests: auth on every route, fail-closed writes, vault write-only, guard, engine
```

Rollback: revert the commit on `main`; Vercel redeploys the previous build.
State is additive-only — code rollback loses nothing.
