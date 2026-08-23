# Deployment configuration — where every value lives, and what's broken

_Last verified: 2026-08-23, branch `reclaim/soft-launch-readiness`._

Two systems hold configuration and they are not interchangeable:

- **Vercel** holds the frontend's `VITE_*` values. These are compiled into the
  JavaScript bundle at build time and are visible to anyone who views source.
  Only publishable/anon keys belong here.
- **Supabase Edge Function Secrets** hold everything secret — Stripe, Plaid,
  Google service-account credentials. These never reach the browser.

A third place, `supabase/functions/.env`, is the **local-only** copy of the
Supabase secrets. It is gitignored and is read only by the local stack.

---

## Known gaps

### 1. Missing config produces a working-looking app pointed at a domain nobody owns — OPEN

**Severity: high.** This is the one that cost real time.

`src/integrations/supabase/client.ts` lines 5–8:

```ts
const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || "https://placeholder.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "placeholder-key";
```

If either variable is absent at build time, the build **succeeds** and ships an
app that points at `placeholder.supabase.co` — a domain that does not exist and
that Reclaim does not control. Every screen renders. Sign-in fails with a
browser-level "this site can't be reached", which looks like an OAuth problem
and is not.

**Observed 2026-08-23:** the Vercel preview build for this branch sent "Continue
with Google" to
`https://placeholder.supabase.co/auth/v1/authorize?provider=google&...`,
because `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` were set for
Vercel's **Production** environment but not for **Preview**. Vercel scopes
environment variables per environment; ticking Production only is the default
mistake.

Two things to fix, and they are separate:

- _Configuration:_ set both variables on **all three** Vercel environments
  (Production, Preview, Development), then redeploy. Values are baked in at
  build time, so an existing build will not pick them up.
- _Code:_ the fallback should not exist. A missing `VITE_SUPABASE_URL` should
  fail the build with a named error, not silently substitute a fake host. The
  file carries a "automatically generated — do not edit" banner, so the check
  belongs in a Vite plugin or a `scripts/` preflight wired into
  `npm run build`, not in the file itself.

Same trap, different file: `VITE_STRIPE_PUBLISHABLE_KEY` and the `VITE_FF_*`
feature flags. A missing flag falls back to its coded default, which is the
intended behaviour — but a missing Stripe key is not.

### 2. Edge functions do not deploy automatically — OPEN

There is no `.github/workflows/` directory. Nothing deploys
`supabase/functions/*` on merge. Both functions live in production today only
because they were pushed by hand:

```
npx supabase functions deploy process-receipt-ocr
npx supabase functions deploy classify-expense
```

Until this is automated, **a merge to `main` ships frontend changes without the
backend changes they depend on.** That mismatch is silent — the frontend calls a
function that is running last month's code.

### 3. A missing edge-function secret fails at request time, not at boot — OPEN

A function whose secrets are absent starts normally, accepts the request,
authenticates the user, and only fails at the moment it reaches for the key.
Receipt scanning did exactly this: the container was healthy, the request was
authorised, and the only user-visible sign was "Unable to process receipt".

The real reason was in the container log, which nobody was watching. Worth a
boot-time check that logs loudly when a required secret is absent.

### 4. Vercel redirect allow-list is a wildcard — OPEN

Supabase's redirect allow-list currently accepts a `https://*.vercel.app/**`
pattern so preview builds can sign in. That is fine while there are no real
users. It should be narrowed before launch, because it means any deployment on
`vercel.app` — including one that isn't ours — can be handed an auth redirect.

### 5. Service-account key is downloadable — OPEN, low priority

The Vertex AI credential is a JSON key file that exists on disk and in Supabase
secrets. Google's Workload Identity Federation removes the downloadable key
entirely. Worth doing eventually; not a launch blocker.

_(An earlier incident on 2026-08-22 — an IDE auto-sharing that private key into
a chat window — was resolved by rotating the key. The current key was created
2026-08-22 and is the only active one.)_

---

## Reference: where each value lives

### Vercel environment variables (frontend, public)

Set these on **Production, Preview, and Development**.

| Variable                        | Value                                        |
| ------------------------------- | -------------------------------------------- |
| `VITE_SUPABASE_URL`             | `https://fzmdfhdfvayaalhogskm.supabase.co`   |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase → Settings → API → `anon` `public`  |
| `VITE_SUPABASE_PROJECT_ID`      | `fzmdfhdfvayaalhogskm`                       |
| `VITE_STRIPE_PUBLISHABLE_KEY`   | Stripe → Developers → API keys → publishable |
| `VITE_FF_*`                     | Feature flags. See `.env.example` for each.  |

### Supabase Edge Function Secrets (server, secret)

Set with `npx supabase secrets set KEY=value`, or in bulk from a local file with
`npx supabase secrets set --env-file supabase/functions/.env`.

| Secret                   | Needed by                                                  |
| ------------------------ | ---------------------------------------------------------- |
| `GOOGLE_SA_CLIENT_EMAIL` | `process-receipt-ocr`, `classify-expense`                  |
| `GOOGLE_SA_PRIVATE_KEY`  | same                                                       |
| `GCP_PROJECT`            | same                                                       |
| `VERTEX_REGION`          | same (`us-central1`)                                       |
| `PLAID_CLIENT_ID`        | the four `plaid-*` functions                               |
| `PLAID_SECRET`           | same                                                       |
| `PLAID_ENV`              | same                                                       |
| `PLAID_ENCRYPTION_KEY`   | same — base64, 32 bytes                                    |
| `STRIPE_SECRET_KEY`      | `create-checkout`, `customer-portal`, `check-subscription` |
| `RESEND_API_KEY`         | email functions                                            |
| `ALLOWED_ORIGIN`         | CORS allow-list on every function                          |

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected
by Supabase automatically. Do not set them.

---

## Gotcha: the Supabase CLI reads an environment variable before anything else

`supabase secrets set` returning `Unauthorized` immediately after a successful
`supabase login` means a stale `SUPABASE_ACCESS_TOKEN` is set in the shell. The
CLI checks, in order:

1. `SUPABASE_ACCESS_TOKEN` in the environment
2. Windows Credential Manager
3. `~/.supabase/access-token`

An `export SUPABASE_ACCESS_TOKEN=...` line in `~/.bashrc` silently overrode
every login for five months. `npx supabase login --debug` prints which source it
used. Environment variables are inherited when a process starts, so after
editing a shell profile you must open a **new** terminal.
