// Reclaim — re-run the classifier over transactions already imported.
//
// docs/TRANSACTION_REVIEW_SPEC.md D40. The classifier runs once, at import,
// and never again, so every improvement to it only ever reaches transactions
// that arrive afterwards. Measured cost of that on a real account, 2026-09-17:
// the over-the-counter lane shipped 2026-09-05, and 51 superstore, grocery
// and convenience charges imported before that date were sitting invisible in
// the auto-filed pile — charges today's classifier sends straight to the
// review queue. This function is the missing half.
//
// TWO RULES GOVERN EVERYTHING BELOW, and both are safety properties rather
// than optimisations:
//
//   1. It never touches a row a person or a rule decided. classification_
//      reason IN ('user', 'rule') is off limits, full stop — re-deciding
//      someone's own answer is the one thing a background pass must never do.
//
//   2. It only ever ADDS to the queue. If the newer engine would file a
//      charge the user is currently being asked about, the charge stays in
//      the queue and only its version stamp moves. Taking something off the
//      user's screen because the engine changed its mind is the same silent
//      dismissal D36 exists to stop, just later.
//
// Deliberately re-uses classifyTransaction rather than reimplementing the
// rules in SQL: the merchant matcher already exists in three copies that must
// agree byte for byte, and a fourth — with the whole tier ladder in it — is
// not a debt this codebase can service.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  classifyTransaction,
  CLASSIFIER_VERSION,
  type PlaidTxnLike,
} from "../_shared/medicalClassifier.ts";

const allowedOrigins = [
  "https://reclaim.health",
  "https://www.reclaim.health",
  "https://wellth-ai.app",
  "https://www.wellth-ai.app",
  Deno.env.get("ALLOWED_ORIGIN"),
].filter(Boolean);

function getCorsHeaders(requestOrigin: string | null) {
  const origin =
    requestOrigin && allowedOrigins.includes(requestOrigin)
      ? requestOrigin
      : allowedOrigins[1];
  return {
    "Access-Control-Allow-Origin": origin as string,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Credentials": "true",
  };
}

/** One pass's ceiling. A pass that finds more leaves the rest for the next
 *  call, which is what `remaining` in the response is for — the caller can
 *  loop without this function ever holding a multi-thousand-row transaction
 *  open or timing out halfway through a write. */
const BATCH_SIZE = 500;

const SELECT_COLUMNS =
  "id, vendor, description, amount, merchant_entity_id, merchant_category_code, " +
  "pfc_primary, pfc_detailed, pfc_confidence, is_medical, needs_review, " +
  "classification_reason, classifier_version";

interface TransactionRow {
  id: string;
  vendor: string | null;
  description: string | null;
  amount: number | null;
  merchant_entity_id: string | null;
  merchant_category_code: string | null;
  pfc_primary: string | null;
  pfc_detailed: string | null;
  pfc_confidence: string | null;
  is_medical: boolean | null;
  needs_review: boolean | null;
  classification_reason: string | null;
  classifier_version: number | null;
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

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
    { global: { headers: { Authorization: authHeader } } },
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
    // The user's own rules are tier 1 of the classifier. Loaded here for the
    // same reason plaid-sync-transactions loads them: match_operator has to be
    // selected explicitly, or every rule silently behaves as starts_with.
    const { data: rules } = await supabase
      .from("categorization_rules")
      .select(
        "id, match_type, match_value, match_operator, is_medical, display_label",
      )
      .eq("user_id", user.id);

    // Rule 1, in the query rather than in a branch below: a row decided by a
    // person or by their rule is never even fetched.
    const { data: rows, error: loadError } = await supabase
      .from("transactions")
      .select(SELECT_COLUMNS)
      .eq("user_id", user.id)
      .not("classification_reason", "in", '("user","rule")')
      .or(
        `classifier_version.is.null,classifier_version.lt.${CLASSIFIER_VERSION}`,
      )
      .limit(BATCH_SIZE);
    if (loadError) throw loadError;

    // Through `unknown` because SELECT_COLUMNS is assembled from two string
    // literals: supabase-js infers a row shape by parsing the select string at
    // the type level, and it can only do that for a single literal. The shape
    // is still checked against TransactionRow everywhere it is read below.
    const pending = (rows ?? []) as unknown as TransactionRow[];
    let queued = 0;
    let filed = 0;
    let unchanged = 0;

    for (const row of pending) {
      const txnLike: PlaidTxnLike = {
        name: row.description ?? row.vendor ?? "",
        merchant_name: row.vendor,
        mcc: row.merchant_category_code,
        merchant_entity_id: row.merchant_entity_id,
        amount: row.amount,
        personal_finance_category: {
          primary: row.pfc_primary,
          detailed: row.pfc_detailed,
          confidence_level: row.pfc_confidence,
        },
      };

      const c = await classifyTransaction(supabase, txnLike, rules ?? []);

      // Rule 2. Already in front of the user and the new engine would file it:
      // leave the decision with them, and stamp the version so this row does
      // not come back around on every future pass.
      const wouldRemoveFromQueue = row.needs_review === true && !c.needsReview;
      if (wouldRemoveFromQueue) {
        const { error } = await supabase
          .from("transactions")
          .update({ classifier_version: CLASSIFIER_VERSION })
          .eq("id", row.id)
          .eq("user_id", user.id);
        if (error) throw error;
        unchanged++;
        continue;
      }

      const { error } = await supabase
        .from("transactions")
        .update({
          is_medical: c.isMedical,
          needs_review: c.needsReview,
          classification_reason: c.reason,
          classification_explanation: c.explanation,
          classification_confidence: c.confidence,
          classifier_version: CLASSIFIER_VERSION,
          applied_by_rule_id: c.ruleId ?? null,
        })
        .eq("id", row.id)
        .eq("user_id", user.id);
      if (error) throw error;

      if (c.needsReview && row.needs_review !== true) queued++;
      else if (!c.needsReview) filed++;
      else unchanged++;
    }

    return new Response(
      JSON.stringify({
        examined: pending.length,
        queued,
        filed,
        unchanged,
        remaining: pending.length === BATCH_SIZE,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error(
      "[RECLASSIFY-TRANSACTIONS] Error:",
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
