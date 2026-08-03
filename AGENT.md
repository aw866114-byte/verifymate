# THE AGENT CONTRACT — how every Claude session uses VerifyMate

**This replaces chat memory. Chats die; the app doesn't.** A session that follows
this cannot re-raise settled decisions, restate withdrawn claims, rebuild what
exists, or lose work when a chat dies.

Base URL: `https://verifymate.vercel.app` · Auth: `Authorization: Bearer <VERIFYMATE_AGENT_KEY>`
(AJ holds the key; it is set in Vercel and pasted once into the session's environment — never into chat text.)

## The 20 stages

| # | Stage | What the session does |
|---|-------|----------------------|
| 1 | **LOAD** | `GET /api/context` — first call, before saying anything. Everything below rides in it. |
| 2 | **RULES** | Read `rules`. `POST /api/session {action:'start', ackRules:true}` — the API refuses work (428) without the ack. |
| 3 | **VERIFY** | Never state a fact without a live check or a stored verdict with evidence + date. `failing`/`settled` carry the evidence. |
| 4 | **BRIEF** | Work from `queue` (kind:`work`). Do not re-derive priorities. |
| 5 | **WORK** | `POST /api/session {action:'log', did, evidence}` after each real action — as it happens, not at the end. |
| 6 | **RECORD** | Decision made → `POST /api/verdict {type:'settle', id, verdict, evidence}` that second. |
| 7 | **APPROVE** | Money/infra change → `POST /api/actions {do:'propose', type, params, why}`. AJ approves on the dashboard. Never execute directly. |
| 8 | **PROVE** | "Done" = a passing check. Close incidents only with `{type:'close', evidence}`. No evidence, no done. |
| 9 | **HANDOFF** | `POST /api/session {action:'handoff', state}` continuously — after every meaningful step. A dead chat then costs nothing: the next session reads `lastHandoff` and continues mid-thought. |
| 10 | **ERRATA** | Got something wrong? `POST /api/verdict {type:'erratum', id, claim, correction}`. Withdrawn claims never resurface — check `errata` before repeating anything. |
| 11 | **RECHECK** | Facts can carry `expires`. The cron re-verifies reality daily; a failing check is the ONLY thing that reopens a settled fact. |
| 12 | **EXISTS-ALREADY** | Before building anything: read `inventory`. The measured pattern is prepared-but-never-fired. Ship what exists first. |
| 13 | **YOUR QUEUE** | Things only AJ can do → `{type:'queue', kind:'aj', title, steps}` with exact steps. Surfaced on the dashboard + 7am digest. |
| 14 | **WATCHDOG** | Silence alarms (`type:'silence'` checks) fire on absence: no enquiries, no sales, cron didn't run. Log liveness with `{type:'event', event:'ww-enquiry'|'sale'|'outreach-run'|'etsy-review'}`. |
| 15 | **SECRETS** | Keys go in the vault (`POST /api/vault`), pasted by AJ on the dashboard, never into chat. No API returns a value. Ever. |
| 16 | **MONEY** | `GET /api/money` — revenue truth from Stripe (restricted key from the vault). |
| 17 | **FOLLOW-UP** | Every enquiry/reply gets `{type:'followup', who, about, next, due}`. Leads die in inboxes, not here. |
| 18 | **CLOCK** | Anything that fails by a date passing gets `{type:'clock', what, due, action}`. |
| 19 | **COVERAGE** | Every sweep records `{type:'coverage', sweep, checked, total, skipped}`. "Checked X of Y" or it didn't happen. |
| 20 | **GUARD** | Outgoing content → `POST /api/guard {text, kind}` BEFORE it ships. Blocks name-rule breaks, credential claims, fake proof, Resend-for-cold. |

## The three sentences that keep it honest
- A fact without evidence and a date is a memory, not a fact.
- "Done" without a passing check is a claim, not a state.
- If the store is read-only, say so — never pretend to remember what wasn't persisted.

## Crons (Vercel, UTC)
- `0 19 * * *` `/api/cron/run-checks` — full check run, incidents opened/closed, alert email on change
- `0 21 * * *` `/api/cron/digest` — the 7am AEST digest

## Ops facts
- Store = Firestore via `FIREBASE_SERVICE_ACCOUNT_KEY` (copy from walker-works project). Without it: reads serve the committed seed, writes refuse loudly.
- `VERIFYMATE_AGENT_KEY` gates every operator route. `CRON_SECRET` additionally allowed on cron + money routes. `VERIFYMATE_VAULT_KEY` (64 hex) encrypts the vault.
- `/api/verify` (the public product demo) stays public, deliberately — it's the product.
- Rollback for this whole app: revert the commit on `main`; Vercel redeploys the previous build. State is additive-only, so rolling code back loses nothing.
