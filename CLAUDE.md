# CLAUDE.md - Wellth.ai Development Guidelines

> This file is institutional memory for Claude Code and all AI coding agents. It serves as the **operationalized information security policy** for this codebase. Every agent working on this project must follow these rules before committing any code.

## How to Talk to the Project Owner

**The person you are working with is not an engineer.** They are the founder and the product decision-maker. Write every message to them in plain English.

This applies to all conversation, summaries, explanations, and questions. It does **not** apply to code, code comments, or commit messages — those are written for engineers and should stay precise and technical.

**Do this:**

- Lead with what changed for the user or the business, not what changed in the code.
- Spell out a term the first time you use it, or pick a plainer word instead.
- When you need a decision, state the choice, the trade-off, and your recommendation in a few sentences. No decision should require reading code to understand.
- Say what broke and what it meant in practice — "the app was only importing the first 100 transactions, so anyone with more than that was silently missing history" — not just the mechanism.
- Keep file and function names when they're genuinely the subject. Naming `plaidSync.ts` is fine; explaining a change only in terms of type variance is not.

**Avoid:**

- Jargon where a normal word works: prefer "check" over "assertion", "database column" over "generated column" (unless the distinction is the point), "runs before saving" over "BEFORE trigger".
- Acronyms without expansion. MCC, PFC, RLS, RPC, FK — expand on first use in a message.
- Explaining a fix purely in terms of the type system, schema internals, or framework mechanics. Translate it into what a user would have experienced.
- Long code excerpts in a message when a sentence would do.

**When precision genuinely matters** — an IRS rule, a security boundary, a money calculation — be exact, and then add a plain-language sentence saying what it means. Simplicity must never come at the cost of being accurate about regulated behavior, PHI handling, or anything involving someone's money.

---

## External Security Documentation

For third-party security questionnaires (e.g., Plaid, Stripe partner reviews), use the formal policy document at `docs/ACCESS_CONTROL_POLICY.md`. That document is written for external audiences and safe to upload. **Do not upload this CLAUDE.md file** — it contains internal implementation details and code.

---

## Project Overview

**Wellth.ai** is a HIPAA-relevant healthcare expense management platform that helps users:

- Track HSA/FSA accounts and transactions
- Scan and categorize medical receipts via AI OCR
- Connect bank accounts via Plaid to auto-import medical transactions
- Manage reimbursement requests and optimize healthcare spending

**Tech Stack:** React 18 + TypeScript + Vite + Tailwind + Supabase + Stripe + Plaid

---

## Information Security Policy

Wellth.ai handles Protected Health Information (PHI) and Protected Financial Information (PFI). All code contributed to this repository — by humans or AI agents — must comply with the controls below. These are not suggestions; they are requirements.

### Data Classification

| Class      | Definition                      | Examples                                                                | Required Controls                                           |
| ---------- | ------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------- |
| **PHI**    | Protected Health Information    | Diagnoses, treatment dates, provider names linked to a person, EOB data | Never log; never return verbatim to client; encrypt at rest |
| **PFI**    | Protected Financial Information | Plaid access tokens, Stripe customer IDs, bank account numbers          | AES-256-GCM encryption at rest; edge functions only         |
| **PII**    | Personally Identifiable         | Name, email, user ID                                                    | Auth-gated; RLS enforced on every query                     |
| **Public** | No sensitivity                  | Hospital pricing tables, HSA contribution limits                        | No special controls required                                |

---

## Edge Function Security Checklist

**Every new edge function MUST satisfy all of the following before being committed:**

- [ ] **JWT validation** — call `supabase.auth.getUser()` and return 401 if the user is not authenticated. The only exceptions are explicitly documented public endpoints.
- [ ] **Dynamic CORS** — use `getCorsHeaders(req.headers.get('origin'))` with a whitelist array. Never use `'Access-Control-Allow-Origin': '*'`.
- [ ] **Input validation** — validate the request body with Zod before using any values.
- [ ] **URL validation** — if fetching an external URL from user input, validate scheme (`https:` only) and domain against an explicit allowlist.
- [ ] **Generic error responses** — the catch block returns a generic message to the client and logs details server-side only. Auth errors (401) and input errors (400) may be specific since they are user-actionable.
- [ ] **Least-privilege key** — use `SUPABASE_ANON_KEY` unless a privileged operation (e.g., admin DB write) requires `SUPABASE_SERVICE_ROLE_KEY`.
- [ ] **User ownership check** — when accessing user-owned resources, verify `user_id = auth.uid()` in the query or in code.

### Canonical Edge Function Template

```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.22.4";

// ── CORS ──────────────────────────────────────────────────────────────────────
const allowedOrigins = [
  "https://wellth-ai.app",
  "https://www.wellth-ai.app",
  Deno.env.get("ALLOWED_ORIGIN"),
].filter(Boolean);

function getCorsHeaders(requestOrigin: string | null) {
  const origin =
    requestOrigin && allowedOrigins.includes(requestOrigin)
      ? requestOrigin
      : allowedOrigins[1]; // default to www
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Credentials": "true",
  };
}

// ── Input schema ──────────────────────────────────────────────────────────────
const RequestSchema = z.object({
  // define your fields here
});

// ── Handler ───────────────────────────────────────────────────────────────────
serve(async (req) => {
  const corsHeaders = getCorsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  // 1. Authenticate
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
  );
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // 2. Validate input
    const body = await req.json();
    const parsed = RequestSchema.safeParse(body);
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: "Invalid request." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Your logic here — always scope queries to user.id

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    // 4. Generic error — never leak internal details to client
    console.error(
      "[FUNCTION-NAME] Error:",
      error instanceof Error ? error.message : error,
    );
    return new Response(
      JSON.stringify({
        error: "An unexpected error occurred. Please try again.",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
```

---

## Frontend Security Checklist

**Before committing any frontend code:**

- [ ] **No secrets in `src/`** — only `import.meta.env.VITE_*` variables (anon/publishable keys only). Secret keys belong in Supabase Edge Function Secrets, not in Vercel env vars.
- [ ] **No sensitive data in localStorage** — use `sessionStorage` for auth tokens. Non-sensitive UI state (theme, layout prefs) is acceptable in localStorage.
- [ ] **PHI-safe logging** — use `safeLog()` from `src/utils/errorHandler.ts` instead of `console.log/error` for any data that might contain user or health information.
- [ ] **Error boundaries** — all new pages must be wrapped in `<ErrorBoundary>`.
- [ ] **Protected routes** — all authenticated pages must be wrapped in `<ProtectedRoute>`.
- [ ] **Authenticated layout** — all authenticated pages must use `<AuthenticatedLayout>` (not standalone `<AuthenticatedNav>`) to ensure sidebar and bottom nav appear on all devices.

---

## Database Security Rules

- **RLS required** — every new table must have Row Level Security enabled before first use. Never query without RLS unless using the service role key in a trusted edge function.
- **Policy naming** — `"Users can [action] their own [resource]"` (e.g., `"Users can view their own invoices"`).
- **SECURITY DEFINER functions** — must explicitly set `search_path = public, pg_temp` to prevent schema poisoning.
- **No SELECT \*** — always enumerate columns. This prevents accidental PHI/PFI exposure when new columns are added.
- **Plaid tokens** — stored encrypted with AES-256-GCM in `plaid_connections.encrypted_access_token`. Never store or log plaintext access tokens.

---

## Secrets & Key Management

| Secret                          | Where it lives                 | Notes                                                                                       |
| ------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------- |
| `VITE_SUPABASE_URL`             | Vercel env vars                | Public — safe to expose                                                                     |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Vercel env vars                | Anon key — safe to expose                                                                   |
| `VITE_STRIPE_PUBLISHABLE_KEY`   | Vercel env vars                | Publishable key — safe to expose                                                            |
| `STRIPE_SECRET_KEY`             | Supabase Edge Function Secrets | Never in frontend or Vercel                                                                 |
| `PLAID_CLIENT_ID`               | Supabase Edge Function Secrets | Never in frontend                                                                           |
| `PLAID_SECRET`                  | Supabase Edge Function Secrets | Never in frontend                                                                           |
| `PLAID_ENCRYPTION_KEY`          | Supabase Edge Function Secrets | Base64-encoded 32-byte key; rotate on compromise                                            |
| `GOOGLE_SA_CLIENT_EMAIL`        | Supabase Edge Function Secrets | Vertex AI service-account email (OCR + classifier). BAA-covered                             |
| `GOOGLE_SA_PRIVATE_KEY`         | Supabase Edge Function Secrets | Vertex AI service-account private key (PEM/PKCS#8). Never in frontend; rotate on compromise |
| `GCP_PROJECT`                   | Supabase Edge Function Secrets | GCP project id hosting Vertex AI                                                            |
| `VERTEX_REGION`                 | Supabase Edge Function Secrets | Vertex AI region, e.g. `us-central1`                                                        |
| `SUPABASE_SERVICE_ROLE_KEY`     | Auto-injected by Supabase      | Never commit; never expose to frontend                                                      |

**Rotation schedule:** Rotate all API keys every 90 days. Rotate immediately on suspected compromise.

**If a secret is accidentally committed:**

1. Rotate the key immediately in the provider dashboard
2. Then remove it from git history: `git filter-branch` or BFG Repo Cleaner
3. Force-push the cleaned history
4. Notify wellth.ai.founder@gmail.com

---

## Incident Response

If a security incident is suspected (unauthorized data access, leaked credentials, anomalous API calls):

1. **Identify** — what data class was exposed (PHI/PFI/PII), to whom, and for how long
2. **Contain** — revoke/rotate all affected credentials immediately
3. **Assess** — if PHI was involved, HIPAA breach notification rules may apply (45 CFR §164.400)
4. **Document** — record timeline, actions taken, and resolution
5. **Contact** — wellth.ai.founder@gmail.com

---

## Architecture Rules

### Data Fetching

- Use React Query for ALL data fetching (5-minute stale time default)
- Never use `SELECT *` — always specify columns explicitly
- Avoid N+1 queries — use `.in()` filter for batch fetching
- Pagination limit: 500–1000 items max per query

### Component Structure

- Components live in `src/components/{domain}/` (bills, dashboard, hsa, etc.)
- Pages live in `src/pages/`
- Use existing shadcn/ui components from `src/components/ui/`
- New pages MUST be wrapped in `<ErrorBoundary>` and `<AuthenticatedLayout>` (if authenticated)

---

## Regulatory Limits (IRS)

All IRS dollar limits (HSA contributions, HDHP thresholds, FSA limits) are centralized in **`src/lib/regulatoryLimits.ts`**.

**Rule: Never hardcode IRS limit values elsewhere in the codebase.** Always import from `regulatoryLimits.ts`.

```typescript
import {
  HSA_LIMITS_2025,
  FSA_LIMITS_2025,
  CURRENT_TAX_YEAR,
} from "@/lib/regulatoryLimits";
```

### Current 2025 IRS Limits (tax year 2025)

| Limit                      | Self-only | Family  |
| -------------------------- | --------- | ------- |
| HSA contribution           | $4,300    | $8,550  |
| HSA catch-up (age 55+)     | +$1,000   | +$1,000 |
| HDHP min deductible        | $1,650    | $3,300  |
| HDHP max out-of-pocket     | $8,300    | $16,600 |
| FSA contribution           | $3,300    | —       |
| FSA carryover (if allowed) | $660      | —       |

### 2025 Regulatory Rulings (from IRS Publication 969)

- **Telehealth disregarded coverage** (P.L. 119-21): Plans may cover telehealth/remote care with no deductible without losing HDHP status. Telehealth coverage no longer disqualifies HSA eligibility for plan years beginning after 2024.
- **OTC contraceptives** (Notice 2024-75): Over-the-counter oral and emergency contraceptives are preventive care — no prescription required for HSA eligibility.
- **Male condoms** (Notice 2024-75 / Notice 2024-71): Qualify as both preventive care and §213(d) qualified medical expenses.
- **CGMs for diabetics** (Notice 2024-75): Continuous glucose monitors for diagnosed diabetics are preventive care — HDHP may cover before deductible.

### Annual Update Checklist (every January)

When the IRS publishes new limits (typically November/December):

1. Update `src/lib/regulatoryLimits.ts` — add a new year constant object and update the `_CURRENT` aliases
2. Update `CURRENT_TAX_YEAR` in the same file
3. **Add the new medical mileage period to `MEDICAL_MILEAGE_RATES`** in the same file, and set `confirmed: true` on the prior year's provisional entry once verified against the IRS notice. Mileage entry shows a "provisional rate" warning for any unconfirmed period, and refuses to price a date with no period at all — so a missed January leaves users unable to log driving.
4. Watch for **mid-year** rate changes (2022 had one). `MEDICAL_MILEAGE_RATES` is a list of date ranges precisely so a mid-year notice can be added as a new period rather than overwriting the year.
5. Review `supabase/functions/wellbie-chat/index.ts` system prompt for stale limit references
6. Run `npm run build` to confirm no TypeScript errors

---

## Code Patterns

### Forms

```typescript
// Always use React Hook Form + Zod
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

const schema = z.object({...});
const form = useForm({ resolver: zodResolver(schema) });
```

### Data Fetching

```typescript
// Always use React Query hooks
import { useQuery } from "@tanstack/react-query";

const { data, isLoading } = useQuery({
  queryKey: ["resource", id],
  queryFn: () => supabase.from("table").select("col1, col2").eq("id", id),
  staleTime: 5 * 60 * 1000, // 5 minutes
});
```

### Error Handling

```typescript
// Frontend: use safeLog for anything that might contain user/health data
import { safeLog } from "@/utils/errorHandler";
safeLog('Operation failed', error); // PHI-safe, dev-only logging

// Edge functions: generic client message, detailed server log
} catch (error) {
  console.error("[FUNCTION] Error:", error instanceof Error ? error.message : error);
  return new Response(JSON.stringify({ error: "An unexpected error occurred. Please try again." }), {
    status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
```

---

## File Locations

| Purpose              | Location                                       |
| -------------------- | ---------------------------------------------- |
| Edge Functions       | `supabase/functions/{function-name}/index.ts`  |
| Migrations           | `supabase/migrations/YYYYMMDD_description.sql` |
| Auto-generated Types | `src/integrations/supabase/types.ts`           |
| React Components     | `src/components/{domain}/`                     |
| Pages                | `src/pages/`                                   |
| Custom Hooks         | `src/hooks/`                                   |
| Contexts             | `src/contexts/`                                |
| UI Components        | `src/components/ui/` (shadcn)                  |
| PHI Error Handler    | `src/utils/errorHandler.ts`                    |
| Plaid Encryption     | `supabase/functions/_shared/encryption.ts`     |

---

## Testing & Verification

Before committing any changes:

1. `npm run build` — must pass with zero errors
2. Check TypeScript errors in modified files
3. Verify no PHI in error messages or console output
4. Test in browser — especially for UI changes
5. For Stripe changes: test with `stripe listen --forward-to localhost:54321/functions/v1/`
6. For Plaid changes: use sandbox environment (`PLAID_ENV=sandbox`)
7. For new edge functions: verify OPTIONS → 200, unauthenticated POST → 401, valid POST → expected response

---

## Subscription Tiers

| Tier    | Price     | Key Features                           |
| ------- | --------- | -------------------------------------- |
| Free    | $0        | Basic tracking, receipt scanning       |
| Plus    | $9.99/mo  | AI bill review, unlimited HSA accounts |
| Premium | $19.99/mo | Priority support, custom reports, API  |

Check subscription with `useSubscription()` hook from `src/contexts/SubscriptionContext.tsx`.

---

## AI Integration (Gemini via Vertex AI — BAA-covered)

- Model: `gemini-2.5-flash` via **Vertex AI** (`{region}-aiplatform.googleapis.com`)
- Used for: Receipt OCR (`process-receipt-ocr`) and the Pub 502 expense classifier (`classify-expense` / `_shared/expenseClassifier.ts`). Wellbie chat is deferred to v1.1 (and hidden behind `FF.WELLBIE_ENABLED`) — its own Vertex migration is deferred with it.
- Always redact PHI before sending to AI — use `sanitizePHI()` from `src/utils/errorHandler.ts`
- **Auth:** service-account OAuth2 token minted in `_shared/vertexAuth.ts` from `GOOGLE_SA_CLIENT_EMAIL` / `GOOGLE_SA_PRIVATE_KEY` (+ `GCP_PROJECT` / `VERTEX_REGION`). No API key — the direct AI Studio endpoint is _not_ BAA-eligible, so receipt images and medical expense context must never hit `generativelanguage.googleapis.com`.
- **Setup (out-of-repo):** sign the Google Cloud BAA, enable the Vertex AI API, create a service account with `roles/aiplatform.user`, and load the four secrets above into Supabase Edge Function Secrets.

---

## Lessons Learned

### 2026-03-24

**Issue:** `manualChunks` in `vite.config.ts` created a circular dependency between `react-vendor` and `ui-vendor` chunks, causing `React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED` to be undefined at runtime → blank page in production.
**Fix:** Remove `manualChunks` entirely. Let Vite's default chunking algorithm handle splitting — it avoids circular dependencies automatically.

### 2026-03-24

**Issue:** PWA service worker cached old broken bundle. After deploying a fix, users (including incognito after OAuth redirect) still got the old crash because the old SW served cached assets.
**Fix:** After any bundle-breaking deploy, instruct users to: DevTools → Application → Service Workers → Unregister → hard refresh. For prevention, consider adding `skipWaiting: true` to workbox config so new SW activates immediately.

### 2026-03-24

**Issue:** `react-router-dom` was upgraded from v6 to v7 during a security audit. v7 has breaking changes with the `<BrowserRouter>/<Routes>/<Route>` JSX API, causing a blank page.
**Fix:** Stay on `react-router-dom@^6.x`. Do not upgrade to v7 without a full migration of `App.tsx` routing patterns.

### 2026-03-24

**Issue:** All edge functions had `CORS: Deno.env.get('ALLOWED_ORIGIN') || 'https://wellth.ai'` — a static string fallback. The live site is `https://www.wellth-ai.app` (different origin), causing CORS failures on all edge function calls.
**Fix:** Use `getCorsHeaders(req.headers.get('origin'))` with a whitelist array containing both `https://wellth-ai.app` and `https://www.wellth-ai.app`. See the canonical edge function template above.

### 2026-04-24

**Issue:** The Plaid token-encryption migration (`20251202201215_encrypt_plaid_tokens.sql`) added `encrypted_access_token` but deferred dropping the legacy `access_token NOT NULL` column to a follow-up migration that was never written. First Plaid Link attempt in a fresh sandbox failed with `null value in column "access_token" violates not-null constraint`.
**Fix:** Wrote `20260424120000_drop_legacy_plaid_access_token.sql` to drop the legacy column and set `encrypted_access_token NOT NULL`. **Rule:** never split mandatory schema cleanup into "MANUAL STEPS REQUIRED" comments inside a migration. Either include the cleanup in the same migration (when no data needs back-filling) or write the follow-up migration immediately and commit both together. Comment-driven manual steps get forgotten.

### 2026-05-03

**Issue:** Fresh `npx supabase start` failed in two places, blocking new-contributor onboarding and any CI bootstrap. (a) `20241209000000_add_analytics_and_insurance.sql` `ALTER`s `public.profiles` (and adds `is_admin`) before that table is created in `20251005153724_*`. (b) `20251110220722_99e2f0fc-...sql` creates `provider_reviews` with a SELECT policy referencing `public.can_view_provider_review` and a trigger calling `public.update_provider_review_aggregates` — neither function was ever defined in any migration. Production survived because both pre-dated the move to version-controlled migrations.
**Fix:** Guarded the two ALTERs in `20241209000000` with `DO $$ IF EXISTS (profiles)` blocks; added catch-up migration `20251005154000_catchup_insurance_plan_on_profiles.sql` that runs after profiles is created (idempotent via `ADD COLUMN IF NOT EXISTS`). Added `20251110220721_add_provider_review_function_stubs.sql` defining safe defaults for `can_view_provider_review` and a no-op stub for `update_provider_review_aggregates`, both via `CREATE OR REPLACE` so production behavior is preserved. **Rule:** every migration must be runnable from an empty schema. If a migration depends on tables/functions added in a later migration date-prefix, it has an ordering bug — fix the order or guard with `DO $$` blocks plus a follow-up catch-up migration. Add a CI step that runs `npx supabase db reset` on a clean container to catch regressions.

---

_Last updated: 2026-05-03_
