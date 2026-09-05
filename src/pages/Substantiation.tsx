// Reclaim Phase 4 W1+W2 — Substantiation Record list + generation flow.
//
// Two views in one page:
//   - "list": prior records + a hero CTA showing how many ELIGIBLE expenses
//     are ready to bundle, with the dollar total. This is where the user
//     comes after the brief §8 dashboard's "READY TO SUBMIT" bucket
//     (Phase 5 will surface this prominently from the home screen).
//   - "generate": pick which ELIGIBLE expenses to include + format(s),
//     generate client-side, download, and mark the underlying invoices
//     SUBMITTED.
//
// Workstream E1: this is now the ONLY way to build a reimbursement claim. The
// legacy path (/hsa-reimbursement and the ledger's Claim HSA dialog) is gone,
// and those surfaces hand their selection here through router state instead.
// That mattered for more than tidiness: the old flow marked expenses
// 'reimbursed' the instant the PDF downloaded, before the custodian had seen
// the claim. This one locks them and waits for the deposit.
//
// SUBMITTED transition (the W2 piece):
//   - On successful generation, every included invoice gets
//     lifecycle_status='submitted', submitted_at=now(), submitted_record_id
//     set to the new record's id. The first record an invoice lands in
//     "owns" the back-link; subsequent records can reference the same
//     invoice via substantiation_record_items but won't overwrite the
//     submitted_record_id. This is intentional — if the user generates
//     two records covering the same expense, the FIRST one is treated as
//     canonical for the lifecycle.

import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { AuthenticatedLayout } from "@/components/AuthenticatedLayout";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Money } from "@/components/ui/money";
import { formatCurrency } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Loader2,
  ArrowLeft,
  FileText,
  FileSpreadsheet,
  FileArchive,
  Sparkles,
  Download,
  CheckCircle2,
  AlertCircle,
  Banknote,
  Undo2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { logError } from "@/utils/errorHandler";
import {
  generateSubstantiationRecordPDF,
  generateSubstantiationRecordCSV,
  downloadBlob,
  fetchReceiptBlob,
  orderForPacket,
  type ClaimDocument,
  type SubstantiationExpenseInput,
  type SubstantiationHeader,
} from "@/lib/substantiationRecord";
import { buildClaimPacket, type ClaimPacketReport } from "@/lib/claimPacket";
import { TaxPackageExport } from "@/components/analytics/TaxPackageExport";
import { useReimbursementStrategy } from "@/hooks/useReimbursementStrategy";
import { HSA_CUSTODIANS } from "@/lib/custodianInstructions";

interface EligibleExpense {
  id: string;
  vendor: string;
  date: string;
  amount: number;
  category: string | null;
  patient_name: string | null;
  confirmed_at: string;
  eligibility_basis_rule_id: string | null;
  rule_name: string | null;
  rule_section_ref: string | null;
  documentation_state: string | null;
  documents: ClaimDocument[];
}

interface PastRecord {
  id: string;
  record_number: string;
  tax_year: number;
  generated_at: string;
  total_amount: number;
  expense_count: number;
  formats_generated: string[];
  status: "generated" | "reimbursed" | "voided";
  custodian: string | null;
  attested_no_double_benefit: boolean;
  attested_at: string | null;
}

interface PendingMatch {
  id: string;
  match_amount: number;
  match_reason: string | null;
  transaction_id: string;
  transaction_vendor: string;
  transaction_date: string;
  transaction_amount: number;
  record_id: string;
  record_number: string;
  record_total: number;
  record_expense_count: number;
  // Workstream E4. How far the deposit was from the total, and how sure the
  // matcher is. Both are shown: a user confirming that money arrived is
  // asserting something about their own bank account, and they can only do
  // that honestly if we say what we actually saw.
  amount_gap: number;
  confidence: number;
  signals: string[];
  // Set when one deposit covers several claims. Members are confirmed and
  // dismissed together — the amounts only add up as a set.
  group_id: string | null;
}

/**
 * Matches sharing one deposit, kept together.
 *
 * A custodian paying two claims in one transfer is one question to the user,
 * not two. Splitting it into separate prompts would invite them to confirm one
 * and dismiss the other, which describes money that never moved.
 */
function groupMatches(matches: PendingMatch[]): PendingMatch[][] {
  const groups = new Map<string, PendingMatch[]>();
  for (const m of matches) {
    const key = m.group_id ?? m.id;
    const existing = groups.get(key);
    if (existing) existing.push(m);
    else groups.set(key, [m]);
  }
  return [...groups.values()];
}

type Phase = "list" | "generate" | "working";

const CURRENT_TAX_YEAR = new Date().getFullYear();

/**
 * Tax year of a date-of-service.
 *
 * Read off the calendar string rather than via `new Date(...)`. A YYYY-MM-DD
 * string parses as UTC midnight, so anywhere west of Greenwich `getFullYear()`
 * returns the PREVIOUS year for a 1 January expense — filing it under the wrong
 * tax year and then hiding it from the record that should contain it.
 */
function taxYearOf(dateOfService: string): number {
  return Number(dateOfService.slice(0, 4));
}

/**
 * Turn a claim-lock refusal into something a person can act on.
 *
 * Workstream E2. These are not developer errors — the lock fires in ordinary
 * use, most often because the same expense is already in a claim built in
 * another tab or a moment earlier. "Something went wrong" would leave the user
 * with no idea that their money is already accounted for.
 */
function explainClaimFailure(err: unknown): string {
  const message =
    err instanceof Error
      ? err.message
      : typeof err === "object" && err && "message" in err
        ? String((err as { message: unknown }).message)
        : "";

  if (/CLAIM_HSA_CARD_PAID/.test(message)) {
    return "One of these was paid with your HSA card, so the money has already come out of your HSA. It needs documenting but can't be reimbursed again.";
  }
  if (/CLAIM_NOTHING_REMAINING/.test(message)) {
    return "One of these has already been reimbursed in full, so there's nothing left to claim on it.";
  }
  if (/CLAIM_WRONG_OWNER|CLAIM_NO_EXPENSE|CLAIM_NO_RECORD/.test(message)) {
    return "One of these expenses could not be found. Please reload and try again.";
  }
  // The lock itself is a unique-index violation rather than a raised message.
  if (
    /idx_record_items_one_live_claim|duplicate key value|23505/.test(message)
  ) {
    return "One of these expenses is already in an open claim — possibly one you built in another tab. We've refreshed the list; anything still claimable is shown.";
  }
  return "Could not generate the record. Please try again.";
}

/**
 * Build and download the chosen formats.
 *
 * Workstream E3. Shared by first generation and by re-downloading a past
 * record, because the two must produce the same packet — the second copy of a
 * claim contradicting the first is worse than having no second copy.
 *
 * The ZIP contains the PDF and the CSV, so the PDF is built whenever either the
 * packet or the standalone PDF was asked for, and built once.
 */
async function producePacket(
  header: SubstantiationHeader,
  expenses: SubstantiationExpenseInput[],
  opts: {
    zip: boolean;
    pdf: boolean;
    csv: boolean;
    onProgress?: (message: string) => void;
  },
): Promise<ClaimPacketReport | null> {
  const ordered = orderForPacket(expenses);
  const csv = generateSubstantiationRecordCSV(header, ordered);

  let pdfBlob: Blob | null = null;
  if (opts.zip || opts.pdf) {
    opts.onProgress?.("Building the claim summary…");
    pdfBlob = await generateSubstantiationRecordPDF(header, ordered);
  }

  let report: ClaimPacketReport | null = null;
  if (opts.zip && pdfBlob) {
    report = await buildClaimPacket(header, ordered, {
      coverPdf: pdfBlob,
      csv,
      fetchDocument: fetchReceiptBlob,
      onProgress: opts.onProgress,
    });
    downloadBlob(`${header.recordNumber}-claim-packet.zip`, report.blob);
  }
  if (opts.pdf && pdfBlob) {
    downloadBlob(`${header.recordNumber}.pdf`, pdfBlob);
  }
  if (opts.csv) {
    downloadBlob(
      `${header.recordNumber}.csv`,
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
  }
  return report;
}

/**
 * Tell the user what the packet actually contains — including what it doesn't.
 *
 * A packet quietly short a receipt the user attached is the failure that costs
 * them a rejected claim weeks later, so anything omitted is said out loud here
 * as well as written into MISSING-DOCUMENTS.txt inside the archive.
 */
function reportPacket(recordNumber: string, report: ClaimPacketReport | null) {
  if (!report) {
    toast.success(`Substantiation Record ${recordNumber} generated.`);
    return;
  }
  const documents = `${report.documentCount} document${report.documentCount === 1 ? "" : "s"}`;
  if (report.truncated) {
    toast.warning(
      `${recordNumber} packet downloaded with ${documents}, but it hit the size limit and some files were left out. They're listed in MISSING-DOCUMENTS.txt inside the ZIP — claiming fewer expenses at a time will fit everything.`,
      { duration: 14000 },
    );
    return;
  }
  if (report.omissions.length > 0) {
    toast.warning(
      `${recordNumber} packet downloaded with ${documents}. ${report.omissions.length} file${report.omissions.length === 1 ? "" : "s"} couldn't be retrieved — see MISSING-DOCUMENTS.txt inside the ZIP.`,
      { duration: 14000 },
    );
    return;
  }
  if (report.undocumented.length > 0) {
    toast.warning(
      `${recordNumber} packet downloaded with ${documents}. ${report.undocumented.length} expense${report.undocumented.length === 1 ? " has" : "s have"} no supporting document attached — your custodian may ask for one.`,
      { duration: 12000 },
    );
    return;
  }
  toast.success(`${recordNumber} packet downloaded with ${documents}.`);
}

export default function Substantiation() {
  const navigate = useNavigate();
  const location = useLocation();
  // Workstream E1: the ledger and care-event screens hand their selection over
  // rather than building a claim themselves.
  const preselectInvoiceIds = (
    location.state as { preselectInvoiceIds?: string[] } | null
  )?.preselectInvoiceIds;
  // Workstream E6: the same expenses, described as what the user decided they
  // are — a filed task or a finished one.
  const { isShoebox } = useReimbursementStrategy();
  const [phase, setPhase] = useState<Phase>("list");
  const [loading, setLoading] = useState(true);

  const [pastRecords, setPastRecords] = useState<PastRecord[]>([]);
  const [eligible, setEligible] = useState<EligibleExpense[]>([]);
  const [pendingMatches, setPendingMatches] = useState<PendingMatch[]>([]);
  const [userName, setUserName] = useState<string>("Reclaim Member");
  const [matchActingId, setMatchActingId] = useState<string | null>(null);

  // Generate-flow state
  const [taxYear, setTaxYear] = useState<number>(CURRENT_TAX_YEAR);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [formatZip, setFormatZip] = useState(true);
  const [formatPdf, setFormatPdf] = useState(false);
  const [formatCsv, setFormatCsv] = useState(false);
  const [custodian, setCustodian] = useState<string>("");
  const [attested, setAttested] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const [redownloadingId, setRedownloadingId] = useState<string | null>(null);

  // Workstream E5 — withdrawing a claim.
  const [voidTarget, setVoidTarget] = useState<PastRecord | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [voiding, setVoiding] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        navigate("/auth", { replace: true });
        return;
      }

      const [
        { data: profileRow },
        { data: recordRows },
        { data: expenseRows },
      ] = await Promise.all([
        supabase
          .from("profiles")
          .select("full_name, hsa_custodian")
          .eq("id", user.id)
          .maybeSingle(),
        supabase
          .from("substantiation_records")
          .select(
            "id, record_number, tax_year, generated_at, total_amount, expense_count, formats_generated, status, custodian, attested_no_double_benefit, attested_at",
          )
          .eq("user_id", user.id)
          .order("generated_at", { ascending: false })
          .limit(50),
        // Workstream E2: what is claimable is defined once, in the database,
        // by claimable_expenses() — eligible AND unclaimed AND remaining > 0
        // AND not already inside a live claim. Assembling that filter here as
        // well is how the screen and the lock drift apart, and the screen is
        // the half that cannot enforce anything.
        supabase.rpc("claimable_expenses"),
        // Workstream E4: re-scan before reading. The Plaid sync only ever
        // matched the deposits of the batch that delivered them, so a record
        // generated after its deposit posted was never matched by anything.
        // The scan is idempotent and never revives a dismissed match, so
        // running it on every visit is safe and is what closes that gap.
        supabase.rpc("match_reimbursement_deposits", { p_user_id: user.id }),
      ]);

      const { data: matchRows } = await supabase
        .from("reimbursement_match_candidates")
        .select(
          `id, match_amount, match_reason, transaction_id, match_group_id,
           amount_gap, match_confidence, match_signals,
           transaction:transactions ( vendor, transaction_date, signed_amount ),
           substantiation_record_id,
           record:substantiation_records ( id, record_number, total_amount, expense_count )`,
        )
        .eq("user_id", user.id)
        .eq("status", "pending")
        .order("match_confidence", { ascending: false });

      if (profileRow?.full_name) setUserName(profileRow.full_name);
      // Workstream E3: remembered from the last claim, so the packet's
      // submission instructions don't have to be re-picked every time.
      if (profileRow?.hsa_custodian) setCustodian(profileRow.hsa_custodian);

      setPastRecords(
        (recordRows ?? []).map((r) => ({
          id: r.id as string,
          record_number: r.record_number as string,
          tax_year: r.tax_year as number,
          generated_at: r.generated_at as string,
          total_amount: Number(r.total_amount),
          expense_count: r.expense_count as number,
          formats_generated: (r.formats_generated as string[]) ?? [],
          status: r.status as "generated" | "reimbursed" | "voided",
          custodian: (r.custodian as string | null) ?? null,
          attested_no_double_benefit: Boolean(r.attested_no_double_benefit),
          attested_at: (r.attested_at as string | null) ?? null,
        })),
      );

      const rows: EligibleExpense[] = (expenseRows ?? []).map((r: unknown) => {
        const row = r as Record<string, unknown>;
        return {
          id: row.invoice_id as string,
          vendor: row.vendor as string,
          // Date of SERVICE, not of payment. The IRS ties an expense to when
          // the care happened, and that is what decides its tax year.
          date: row.service_date as string,
          // Workstream E2: what is left to claim, not the billed amount. This
          // used to read invoices.amount, so an expense whose claimable amount
          // had been lowered after an insurance refund (D5) still went to the
          // custodian asking for the full original figure.
          amount: Number(row.remaining_amount),
          category: (row.category as string | null) ?? null,
          patient_name: (row.patient_name as string | null) ?? null,
          confirmed_at: (row.confirmed_at as string | null) ?? "",
          eligibility_basis_rule_id: (row.rule_id as string | null) ?? null,
          rule_name: (row.rule_name as string | null) ?? null,
          rule_section_ref: (row.rule_section_ref as string | null) ?? null,
          documentation_state:
            (row.documentation_state as string | null) ?? null,
          documents: (row.documents as ClaimDocument[] | null) ?? [],
        };
      });
      setEligible(rows);

      // Workstream E1. Arriving with a selection already made elsewhere.
      // Anything in it that is not actually claimable is dropped — those
      // screens select against a looser filter than this one does.
      const handedOver = (preselectInvoiceIds ?? []).filter((id) =>
        rows.some((r) => r.id === id),
      );
      if (handedOver.length > 0) {
        setSelectedIds(new Set(handedOver));

        // A record covers one tax year. Land on the year holding most of the
        // handover and say so if the rest had to be left behind, rather than
        // filtering them out in silence — the user picked those expenses and
        // would otherwise watch them vanish.
        const years = handedOver.map((id) =>
          taxYearOf(rows.find((r) => r.id === id)!.date),
        );
        const counts = new Map<number, number>();
        for (const y of years) counts.set(y, (counts.get(y) ?? 0) + 1);
        const [bestYear, bestCount] = [...counts.entries()].sort(
          (a, b) => b[1] - a[1] || b[0] - a[0],
        )[0];
        setTaxYear(bestYear);
        setPhase("generate");
        if (bestCount < handedOver.length) {
          toast.info(
            `${handedOver.length - bestCount} of those expenses are from a different tax year. A record covers one year, so claim ${bestYear} now and the rest separately.`,
            { duration: 9000 },
          );
        }
      } else {
        setSelectedIds(new Set(rows.map((r) => r.id)));
      }

      // Pending match candidates → flatten the joined shape into PendingMatch.
      const matches: PendingMatch[] = ((matchRows ?? []) as unknown[]).flatMap(
        (m) => {
          type TxnShape = {
            vendor: string | null;
            transaction_date: string;
            signed_amount: number | string | null;
          };
          const row = m as Record<string, unknown> & {
            transaction: TxnShape | TxnShape[] | null;
            record:
              | {
                  id: string;
                  record_number: string;
                  total_amount: number | string;
                  expense_count: number;
                }
              | {
                  id: string;
                  record_number: string;
                  total_amount: number | string;
                  expense_count: number;
                }[]
              | null;
          };
          const txn = Array.isArray(row.transaction)
            ? (row.transaction[0] ?? null)
            : (row.transaction ?? null);
          const rec = Array.isArray(row.record)
            ? (row.record[0] ?? null)
            : (row.record ?? null);
          if (!txn || !rec) return [];
          return [
            {
              id: row.id as string,
              match_amount: Number(row.match_amount),
              match_reason: (row.match_reason as string | null) ?? null,
              transaction_id: row.transaction_id as string,
              transaction_vendor: txn.vendor ?? "Deposit",
              transaction_date: txn.transaction_date,
              // signed_amount follows Plaid: negative is money in. The user
              // thinks of a deposit as a positive number, so flip it here
              // rather than showing them a minus sign on money they received.
              transaction_amount: Math.abs(Number(txn.signed_amount ?? 0)),
              record_id: rec.id,
              record_number: rec.record_number,
              record_total: Number(rec.total_amount),
              record_expense_count: rec.expense_count,
              amount_gap: Number(row.amount_gap ?? 0),
              confidence: Number(row.match_confidence ?? 0),
              signals: (row.match_signals as string[] | null) ?? [],
              group_id: (row.match_group_id as string | null) ?? null,
            },
          ];
        },
      );
      setPendingMatches(matches);
    } catch (err) {
      logError("Substantiation.load", err);
      toast.error("Couldn't load your records.");
    } finally {
      setLoading(false);
    }
  };

  // ── Match candidate handlers ─────────────────────────────────────────────

  /**
   * Workstream E4 — the money has landed; close the claim.
   *
   * One database call. This used to be four sequential writes from the browser
   * with no transaction around them: mark the candidate, close the record,
   * cascade the expenses, dismiss the siblings. If the third failed, the
   * record read "reimbursed" while its expenses stayed locked inside a claim
   * that was already closed — unclaimable, and with nothing on screen to
   * suggest anything had gone wrong.
   *
   * It also never wrote `reimbursed_amount`, so the money model insisted the
   * user had been reimbursed nothing. That is fixed inside the function.
   */
  async function confirmMatch(match: PendingMatch) {
    setMatchActingId(match.id);
    try {
      const { data, error } = await supabase.rpc("confirm_deposit_match", {
        p_candidate_id: match.id,
      });
      if (error) throw error;

      const closed = (data ?? []) as {
        record_id: string;
        record_number: string;
        expenses_closed: number;
      }[];
      const closedIds = new Set(closed.map((c) => c.record_id));
      const expenses = closed.reduce((n, c) => n + c.expenses_closed, 0);

      // A batch closes several records at once, so clear by what came back
      // rather than by the one card the user clicked.
      setPendingMatches((prev) =>
        prev.filter(
          (p) =>
            !closedIds.has(p.record_id) &&
            p.transaction_id !== match.transaction_id,
        ),
      );
      setPastRecords((prev) =>
        prev.map((r) =>
          closedIds.has(r.id) ? { ...r, status: "reimbursed" as const } : r,
        ),
      );
      // The claimable list needs no pruning: these expenses were already
      // locked into the record, so claimable_expenses() never returned them.

      toast.success(
        closed.length > 1
          ? `${closed.length} records closed — ${expenses} expense${expenses === 1 ? "" : "s"} marked reimbursed.`
          : `${closed[0]?.record_number ?? match.record_number} closed. ${expenses} expense${expenses === 1 ? "" : "s"} marked reimbursed.`,
      );
    } catch (err) {
      logError("Substantiation.confirmMatch", err);
      toast.error("Couldn't close that record. Please try again.");
    } finally {
      setMatchActingId(null);
    }
  }

  async function dismissMatch(match: PendingMatch) {
    setMatchActingId(match.id);
    try {
      const { error } = await supabase.rpc("dismiss_deposit_match", {
        p_candidate_id: match.id,
      });
      if (error) throw error;
      // Dismissing a batch dismisses all of it: the amounts add up to the
      // deposit together and to nothing apart.
      setPendingMatches((prev) =>
        prev.filter((p) =>
          match.group_id ? p.group_id !== match.group_id : p.id !== match.id,
        ),
      );
      toast.success("Dismissed. We won't ask about that deposit again.");
    } catch (err) {
      logError("Substantiation.dismissMatch", err);
      toast.error("Couldn't dismiss.");
    } finally {
      setMatchActingId(null);
    }
  }

  // ── Withdraw a claim (Workstream E5) ─────────────────────────────────────

  /**
   * Void a claim: the custodian rejected it, or it was filed by mistake.
   *
   * The whole action is one database call, because it is several changes that
   * have to happen together — the expenses come back, the claim lock lets go,
   * the record keeps its place in history, and any deposit prompt still open
   * against it is withdrawn. Half of that applied is worse than none: expenses
   * released from the lock but still marked as submitted are claimable by
   * nothing and visible on no screen.
   */
  async function voidRecord(record: PastRecord, reason: string) {
    setVoiding(true);
    try {
      const { data, error } = await supabase.rpc("void_substantiation_record", {
        p_record_id: record.id,
        // Blank is fine to send: the function's NULLIF(TRIM(...)) turns an
        // empty reason into no reason, so there is no "" to read back later.
        p_reason: reason.trim(),
      });
      if (error) throw error;

      const [result] = (data ?? []) as {
        record_number: string;
        expenses_released: number;
        amount_released: number;
      }[];
      const released = result?.expenses_released ?? 0;

      setPastRecords((prev) =>
        prev.map((r) =>
          r.id === record.id ? { ...r, status: "voided" as const } : r,
        ),
      );
      setPendingMatches((prev) =>
        prev.filter((m) => m.record_id !== record.id),
      );
      // The released expenses are claimable again, and the list on screen was
      // built before they were. Reload rather than reconstruct: the database
      // decides what is claimable, and guessing here is how the screen and the
      // lock drift apart.
      await load();

      toast.success(
        released > 0
          ? `${record.record_number} withdrawn. ${released} expense${released === 1 ? "" : "s"} (${formatCurrency(result?.amount_released ?? 0)}) are ready to claim again.`
          : `${record.record_number} withdrawn.`,
      );
    } catch (err) {
      logError("Substantiation.voidRecord", err);
      const message =
        err instanceof Error && err.message.includes("VOID_REIMBURSED")
          ? "That claim has already been paid, so its expenses can't go back into the claimable pool."
          : "Couldn't withdraw that claim. Please try again.";
      toast.error(message);
    } finally {
      setVoiding(false);
      setVoidTarget(null);
      setVoidReason("");
    }
  }

  // ── Re-download a past packet ────────────────────────────────────────────

  /**
   * Rebuild the claim packet for a record that was already generated.
   *
   * Workstream E3. This page has always told users their records can be
   * re-downloaded at any time; until now there was no button, so the promise
   * was empty. Everything comes from the SNAPSHOT rows, never the live
   * expenses — a second copy of a claim has to say what the custodian was
   * originally sent, even if the underlying expense has since been edited.
   */
  async function redownloadPacket(record: PastRecord) {
    setRedownloadingId(record.id);
    try {
      const { data, error } = await supabase.rpc("record_packet_items", {
        p_record_id: record.id,
      });
      if (error) throw error;

      const rows = (data ?? []) as unknown[];
      if (rows.length === 0) {
        toast.error("That record has no expenses left in it to bundle.");
        return;
      }

      const expenses: SubstantiationExpenseInput[] = rows.map((r) => {
        const row = r as Record<string, unknown>;
        return {
          invoiceId: row.invoice_id as string,
          vendor: row.vendor as string,
          date: row.service_date as string,
          patientName: (row.patient_name as string | null) ?? null,
          category: (row.category as string | null) ?? null,
          amount: Number(row.amount),
          ruleName: (row.rule_name as string | null) ?? null,
          ruleSectionRef: (row.rule_section_ref as string | null) ?? null,
          confirmedAt: (row.confirmed_at as string | null) ?? "",
          documents: (row.documents as ClaimDocument[] | null) ?? [],
          documentationState:
            (row.documentation_state as string | null) ?? null,
        };
      });

      const header: SubstantiationHeader = {
        recordNumber: record.record_number,
        taxYear: record.tax_year,
        generatedAt: record.generated_at,
        userName,
        totalAmount: record.total_amount,
        expenseCount: record.expense_count,
        custodian: record.custodian,
        attestedNoDoubleBenefit: record.attested_no_double_benefit,
        attestedAt: record.attested_at,
      };

      const report = await producePacket(header, expenses, {
        zip: true,
        pdf: false,
        csv: false,
      });
      reportPacket(record.record_number, report);
    } catch (err) {
      logError("Substantiation.redownloadPacket", err);
      toast.error("Couldn't rebuild that packet. Please try again.");
    } finally {
      setRedownloadingId(null);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const selectedTotals = useMemo(() => {
    const selected = eligible.filter((e) => selectedIds.has(e.id));
    return {
      count: selected.length,
      total: selected.reduce((s, e) => s + e.amount, 0),
    };
  }, [eligible, selectedIds]);

  const eligibleForYear = useMemo(
    () => eligible.filter((e) => taxYearOf(e.date) === taxYear),
    [eligible, taxYear],
  );

  // ── Generate ─────────────────────────────────────────────────────────────

  async function computeNextRecordNumber(
    userId: string,
    year: number,
  ): Promise<string> {
    const { data } = await supabase
      .from("substantiation_records")
      .select("record_number")
      .eq("user_id", userId)
      .eq("tax_year", year)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    let nextSeq = 1;
    if (data?.record_number) {
      const match = /-(\d+)$/.exec(data.record_number);
      if (match) nextSeq = parseInt(match[1], 10) + 1;
    }
    return `RCM-${year}-${String(nextSeq).padStart(4, "0")}`;
  }

  async function handleGenerate() {
    if (!formatZip && !formatPdf && !formatCsv) {
      toast.error("Pick at least one format.");
      return;
    }
    // Spec Gate 4. Reclaim cannot verify this and does not try — but a claim
    // that asserts nothing about whether the same expense was already deducted
    // or reimbursed elsewhere is exactly the claim that costs the user later.
    if (!attested) {
      toast.error(
        "Please confirm that none of these expenses were deducted on Schedule A or reimbursed by an FSA or HRA.",
      );
      return;
    }
    const includedIds = Array.from(selectedIds).filter((id) =>
      eligibleForYear.some((e) => e.id === id),
    );
    if (includedIds.length === 0) {
      toast.error(`No eligible expenses selected for ${taxYear}.`);
      return;
    }

    setPhase("working");
    setProgress("Reserving record number…");

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in.");

      const recordNumber = await computeNextRecordNumber(user.id, taxYear);
      const included = eligibleForYear.filter((e) =>
        includedIds.includes(e.id),
      );
      const total = included.reduce((s, e) => s + e.amount, 0);

      const formats: string[] = [];
      if (formatZip) formats.push("claim_packet_zip");
      if (formatPdf) formats.push("irs_pdf");
      if (formatCsv) formats.push("csv");

      const generatedAt = new Date().toISOString();
      const chosenCustodian = custodian || null;

      // 1. Insert record
      setProgress("Writing substantiation record…");
      const { data: recordRow, error: recordErr } = await supabase
        .from("substantiation_records")
        .insert({
          user_id: user.id,
          record_number: recordNumber,
          tax_year: taxYear,
          generated_at: generatedAt,
          total_amount: total,
          expense_count: included.length,
          formats_generated: formats,
          status: "generated",
          // Snapshotted: the record is an account of what was submitted where,
          // so changing custodians later must not rewrite where an old claim
          // went.
          custodian: chosenCustodian,
          attested_no_double_benefit: true,
          attested_at: generatedAt,
        })
        .select("id")
        .single();
      if (recordErr || !recordRow)
        throw recordErr ?? new Error("Insert failed");
      const recordId = recordRow.id;

      // 2. Insert snapshots
      setProgress("Snapshotting expenses…");
      const itemRows = included.map((e) => ({
        substantiation_record_id: recordId,
        invoice_id: e.id,
        amount_at_submission: e.amount,
        vendor_at_submission: e.vendor,
        date_at_submission: e.date,
        patient_name_at_submission: e.patient_name,
        category_at_submission: e.category,
        eligibility_basis_rule_id_at_submission: e.eligibility_basis_rule_id,
        confirmed_at_at_submission: e.confirmed_at,
        // Workstream E3: the document list is snapshotted like every other
        // field, so this record can rebuild the packet the custodian received
        // even after a document is deleted or reattached elsewhere.
        document_manifest_at_submission: e.documents as unknown as Json,
        documentation_state_at_submission: e.documentation_state,
      }));
      const { error: itemsErr } = await supabase
        .from("substantiation_record_items")
        .insert(itemRows);
      if (itemsErr) {
        // Workstream E2. Now that the claim lock is real, this is a failure
        // path that happens in normal use — a second tab, a double-submit, a
        // retry after a dropped connection. The record row is already written
        // at this point, so leaving it would strand an empty claim carrying a
        // total it does not contain, and that claim would then hold a number
        // in the user's history that means nothing.
        await supabase
          .from("substantiation_records")
          .delete()
          .eq("id", recordId);
        throw itemsErr;
      }

      // 3. Transition invoices to SUBMITTED. Only set submitted_record_id
      // for invoices that don't already have one (first record wins the
      // back-link).
      setProgress("Marking expenses as submitted…");
      const { error: lifeErr } = await supabase
        .from("invoices")
        .update({
          // Workstream B: claim_state drives the derived lifecycle_status.
          // 'locked_in_request' is what makes the expense unavailable to any
          // other reimbursement request.
          claim_state: "locked_in_request",
          submitted_at: generatedAt,
          submitted_record_id: recordId,
        })
        .in("id", includedIds)
        .is("submitted_record_id", null);
      if (lifeErr) {
        // Don't fully bail — the record was written. Surface a warning.
        logError("Substantiation: invoice submit update failed", lifeErr);
      }
      // For invoices that already had a submitted_record_id (re-bundled into
      // a new record), just refresh submitted_at so the lifecycle reflects
      // the latest activity.
      await supabase
        .from("invoices")
        .update({
          claim_state: "locked_in_request",
          submitted_at: generatedAt,
        })
        .in("id", includedIds);

      // 4. Remember the custodian for next time. Best-effort: the claim is
      // already written, and failing to save a preference must not look like a
      // failed claim.
      if (chosenCustodian) {
        const { error: prefErr } = await supabase
          .from("profiles")
          .update({ hsa_custodian: chosenCustodian })
          .eq("id", user.id);
        if (prefErr) logError("Substantiation: save custodian", prefErr);
      }

      // 5. Build files + download
      const header: SubstantiationHeader = {
        recordNumber,
        taxYear,
        generatedAt,
        userName,
        totalAmount: total,
        expenseCount: included.length,
        custodian: chosenCustodian,
        attestedNoDoubleBenefit: true,
        attestedAt: generatedAt,
      };
      const expenseInputs: SubstantiationExpenseInput[] = included.map((e) => ({
        invoiceId: e.id,
        vendor: e.vendor,
        date: e.date,
        patientName: e.patient_name,
        category: e.category,
        amount: e.amount,
        ruleName: e.rule_name,
        ruleSectionRef: e.rule_section_ref,
        confirmedAt: e.confirmed_at,
        documents: e.documents,
        documentationState: e.documentation_state,
      }));

      const report = await producePacket(header, expenseInputs, {
        zip: formatZip,
        pdf: formatPdf,
        csv: formatCsv,
        onProgress: setProgress,
      });

      reportPacket(recordNumber, report);
      await load();
      setPhase("list");
    } catch (err) {
      logError("Substantiation: generate", err);
      toast.error(explainClaimFailure(err), { duration: 10000 });
      // Reload: whatever the lock refused, this screen's idea of what is
      // claimable is now out of date, and offering it again would just fail
      // the same way.
      setPhase("generate");
      await load();
    } finally {
      setProgress("");
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <AuthenticatedLayout>
        <div className="max-w-3xl mx-auto px-4 py-12 text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary mb-3" />
          <p className="text-sm text-muted-foreground">Loading your records…</p>
        </div>
      </AuthenticatedLayout>
    );
  }

  // ── Working state ────────────────────────────────────────────────────────
  if (phase === "working") {
    return (
      <AuthenticatedLayout>
        <div className="max-w-xl mx-auto px-4 py-16 text-center">
          <div className="relative inline-block">
            <Loader2 className="h-12 w-12 mx-auto mb-6 animate-spin text-primary" />
            <Sparkles className="h-4 w-4 absolute -top-1 -right-1 text-violet-500 animate-pulse" />
          </div>
          <h1 className="text-xl font-semibold mb-2">
            Generating your Substantiation Record
          </h1>
          <p className="text-sm text-muted-foreground italic">{progress}</p>
        </div>
      </AuthenticatedLayout>
    );
  }

  // ── Generate flow ────────────────────────────────────────────────────────
  if (phase === "generate") {
    return (
      <AuthenticatedLayout>
        <div className="max-w-3xl mx-auto px-4 py-8">
          <button
            type="button"
            onClick={() => setPhase("list")}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to records
          </button>

          <div className="mb-6">
            <h1 className="text-2xl font-semibold mb-1">
              Generate a Substantiation Record
            </h1>
            <p className="text-sm text-muted-foreground">
              You'll get one file to send your custodian: a summary of every
              expense with its IRS Publication 502 basis and the date you
              confirmed it, plus every supporting document attached to it.
            </p>
          </div>

          <Card className="mb-4">
            <CardContent className="p-5 space-y-4">
              <div className="flex flex-wrap items-end gap-4">
                <div>
                  <Label htmlFor="tax-year">Tax year</Label>
                  <Input
                    id="tax-year"
                    type="number"
                    min="2020"
                    max={CURRENT_TAX_YEAR + 1}
                    value={taxYear}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      if (!Number.isNaN(v)) setTaxYear(v);
                    }}
                    className="w-32"
                  />
                </div>
                <div className="text-sm text-muted-foreground">
                  {eligibleForYear.length} eligible expense
                  {eligibleForYear.length === 1 ? "" : "s"} for {taxYear}
                </div>
              </div>

              <div>
                <Label htmlFor="custodian">Send this claim to</Label>
                <Select
                  value={custodian}
                  onValueChange={(v) => setCustodian(v)}
                >
                  <SelectTrigger id="custodian" className="w-full sm:w-72 mt-1">
                    <SelectValue placeholder="Choose your HSA custodian" />
                  </SelectTrigger>
                  <SelectContent>
                    {HSA_CUSTODIANS.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1.5">
                  We'll include their submission steps in the packet where we
                  have them, and remember your choice for next time.
                </p>
              </div>

              <div className="space-y-2">
                <Label>What to download</Label>
                <div className="space-y-2">
                  <label className="flex items-start gap-2 text-sm">
                    <Checkbox
                      className="mt-0.5"
                      checked={formatZip}
                      onCheckedChange={(v) => setFormatZip(v === true)}
                    />
                    <FileArchive className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                    <span>
                      Claim packet (ZIP)
                      <span className="block text-xs text-muted-foreground">
                        Everything in one file: the summary, the spreadsheet,
                        and every supporting document. This is what you send
                        your custodian.
                      </span>
                    </span>
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={formatPdf}
                      onCheckedChange={(v) => setFormatPdf(v === true)}
                    />
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    Summary PDF on its own
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={formatCsv}
                      onCheckedChange={(v) => setFormatCsv(v === true)}
                    />
                    <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
                    Spreadsheet (CSV) on its own
                  </label>
                </div>
              </div>

              {/* Spec Gate 4 — the honor-system one. Nothing here can be
                  checked by Reclaim, which is exactly why the user has to say
                  it themselves, once, on the claim. */}
              <div className="rounded-md border bg-muted/40 p-3">
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox
                    className="mt-0.5"
                    checked={attested}
                    onCheckedChange={(v) => setAttested(v === true)}
                  />
                  <span>
                    None of these expenses were claimed as a medical deduction
                    on Schedule A, or reimbursed by an FSA, HRA, or any other
                    plan.
                    <span className="block text-xs text-muted-foreground mt-1">
                      Required. Each expense can only be claimed once — this
                      confirmation goes into the record with the date you made
                      it.
                    </span>
                  </span>
                </label>
              </div>
            </CardContent>
          </Card>

          {eligibleForYear.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center space-y-3">
                <AlertCircle className="h-8 w-8 mx-auto text-muted-foreground" />
                <p className="text-sm text-muted-foreground max-w-md mx-auto">
                  Nothing eligible for {taxYear} yet. Confirm expenses on the{" "}
                  <button
                    className="underline text-foreground"
                    onClick={() => navigate("/substantiate")}
                  >
                    Substantiate page
                  </button>{" "}
                  to add them to your reclaim list.
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-5 space-y-3">
                <div className="flex items-center justify-between gap-2 pb-2 border-b">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <Checkbox
                      checked={
                        selectedIds.size > 0 &&
                        eligibleForYear.every((e) => selectedIds.has(e.id))
                      }
                      onCheckedChange={(v) => {
                        const all = v === true;
                        setSelectedIds((prev) => {
                          const next = new Set(prev);
                          eligibleForYear.forEach((e) =>
                            all ? next.add(e.id) : next.delete(e.id),
                          );
                          return next;
                        });
                      }}
                    />
                    Include all eligible {taxYear} expenses
                  </label>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {selectedTotals.count} selected · $
                    {selectedTotals.total.toFixed(2)}
                  </span>
                </div>
                <div className="divide-y">
                  {eligibleForYear.map((e) => (
                    <label
                      key={e.id}
                      className="flex items-start gap-3 py-2 cursor-pointer"
                    >
                      <Checkbox
                        checked={selectedIds.has(e.id)}
                        onCheckedChange={(v) => {
                          setSelectedIds((prev) => {
                            const next = new Set(prev);
                            if (v === true) next.add(e.id);
                            else next.delete(e.id);
                            return next;
                          });
                        }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate text-sm">
                          {e.vendor}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(e.date + "T00:00:00").toLocaleDateString()}{" "}
                          · {e.patient_name ?? "Self"} ·{" "}
                          {e.rule_name ?? "Unclassified"}
                        </p>
                      </div>
                      <Money value={e.amount} className="text-sm" />
                    </label>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <div className="flex gap-2 mt-5">
            <Button
              variant="outline"
              onClick={() => setPhase("list")}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              onClick={handleGenerate}
              disabled={
                selectedTotals.count === 0 ||
                (!formatZip && !formatPdf && !formatCsv) ||
                !attested
              }
              className="flex-1"
            >
              <Download className="h-4 w-4 mr-2" />
              Generate &amp; download
            </Button>
          </div>
        </div>
      </AuthenticatedLayout>
    );
  }

  // ── List view ────────────────────────────────────────────────────────────
  const eligibleNow = eligible.filter(
    (e) => new Date(e.date).getFullYear() === CURRENT_TAX_YEAR,
  );
  const eligibleNowTotal = eligibleNow.reduce((s, e) => s + e.amount, 0);

  return (
    <AuthenticatedLayout>
      <div className="max-w-3xl mx-auto px-4 py-8">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </button>

        <div className="mb-6">
          <PageHeader
            title="Reimbursement Records"
            description="IRS-defensible bundles of your confirmed eligible expenses. Generate one when you're ready to file for HSA reimbursement."
          />
        </div>

        {/* Workstream E4: deposit-match prompts. Confirming is the moment the
            loop closes — the money lands in the ledger, the record closes, and
            every expense inside it becomes reimbursed. Because that is not
            reversible from here, the card says what the matcher actually saw:
            the deposit, the total it was compared against, and any gap between
            them. A user confirming money arrived is asserting something about
            their own bank account, and can only do that honestly if we show
            them the number rather than a verdict. */}
        {pendingMatches.length > 0 && (
          <div className="space-y-2 mb-6">
            {groupMatches(pendingMatches).map((group) => {
              const head = group[0];
              const batched = group.length > 1;
              const acting = group.some((g) => matchActingId === g.id);
              // Anything the matcher is not confident about is asked more
              // cautiously and coloured as a question, not an answer.
              const unsure = head.confidence < 0.75;
              return (
                <Card
                  key={head.group_id ?? head.id}
                  className={
                    unsure
                      ? "border-amber-200 bg-amber-50/50"
                      : "border-emerald-200 bg-emerald-50/50"
                  }
                >
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start gap-3">
                      <div
                        className={`rounded-full p-2 mt-0.5 ${
                          unsure ? "bg-amber-100" : "bg-emerald-100"
                        }`}
                      >
                        <Banknote
                          className={`h-4 w-4 ${
                            unsure ? "text-amber-700" : "text-emerald-700"
                          }`}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">
                          Did this {formatCurrency(head.transaction_amount)}{" "}
                          deposit pay{" "}
                          {batched ? (
                            <>these {group.length} claims?</>
                          ) : (
                            <>
                              <span className="tabular-nums">
                                {head.record_number}
                              </span>
                              ?
                            </>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {head.transaction_vendor} ·{" "}
                          {new Date(
                            head.transaction_date + "T00:00:00",
                          ).toLocaleDateString()}
                        </p>

                        {batched ? (
                          <ul className="mt-2 space-y-1">
                            {group.map((g) => (
                              <li
                                key={g.id}
                                className="text-xs flex justify-between gap-3"
                              >
                                <span className="tabular-nums">
                                  {g.record_number}
                                </span>
                                <span className="tabular-nums text-muted-foreground">
                                  {formatCurrency(g.record_total)} ·{" "}
                                  {g.record_expense_count} expense
                                  {g.record_expense_count === 1 ? "" : "s"}
                                </span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-xs text-muted-foreground mt-1">
                            {head.record_expense_count} expense
                            {head.record_expense_count === 1 ? "" : "s"},
                            claimed at {formatCurrency(head.record_total)}.
                          </p>
                        )}

                        {/* The gap is never rounded away. "$2.00 less than you
                            claimed" is the difference between a custodian fee
                            and a partly denied claim, and only the user knows
                            which — so they have to be told there is one. */}
                        {head.amount_gap > 0.01 && (
                          <p className="text-xs mt-2 font-medium text-amber-800">
                            That is {formatCurrency(head.amount_gap)} less than
                            the {batched ? "total claimed" : "amount claimed"}.
                            Confirm only if you're happy that settles it.
                          </p>
                        )}
                        {head.signals.includes("hsa_transfer") && (
                          <p className="text-xs mt-1 text-muted-foreground">
                            We matched this to money leaving your HSA.
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <Button
                        size="sm"
                        onClick={() => confirmMatch(head)}
                        disabled={acting}
                        className={`flex-1 ${
                          unsure
                            ? "bg-amber-700 hover:bg-amber-800"
                            : "bg-emerald-700 hover:bg-emerald-800"
                        }`}
                      >
                        {acting ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <CheckCircle2 className="mr-2 h-4 w-4" />
                        )}
                        {batched
                          ? `Yes, close all ${group.length}`
                          : "Yes, close this record"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => dismissMatch(head)}
                        disabled={acting}
                        className="flex-1"
                      >
                        <X className="mr-2 h-4 w-4" />
                        No, this isn't it
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* Workstream E6 — the same money, framed as what the user decided it
            is. For someone on the shoebox strategy a documented unclaimed
            expense is FINISHED: the receipt is banked, the tax-free compounding
            is the plan, and the claim can be made in thirty years. Calling that
            "ready to submit" with a prominent button tells them their completed
            work is an outstanding task. The claim path is not removed — the
            spec is explicit that they claim "whenever you want" — it simply
            stops being the thing the page is asking for. */}
        <Card
          className={`mb-6 ${isShoebox ? "border-emerald-300 bg-emerald-50/40" : "border-primary/30"}`}
        >
          <CardContent className="p-5 flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground mb-1">
                {isShoebox ? "Substantiated & banked" : "Ready to submit"}
              </p>
              <Money
                value={eligibleNowTotal}
                className="block text-3xl font-bold"
              />
              <p className="text-sm text-muted-foreground mt-1">
                {eligibleNow.length} eligible expense
                {eligibleNow.length === 1 ? "" : "s"} for {CURRENT_TAX_YEAR}
              </p>
              {isShoebox && (
                <p className="text-sm text-emerald-800 mt-2">
                  Documented and yours to claim whenever you want — there's no
                  deadline. Your HSA keeps compounding until you do.
                </p>
              )}
            </div>
            <Button
              size="lg"
              variant={isShoebox ? "outline" : "default"}
              disabled={eligible.length === 0}
              className="w-full sm:w-auto"
              onClick={() => {
                setTaxYear(CURRENT_TAX_YEAR);
                setSelectedIds(new Set(eligibleNow.map((e) => e.id)));
                setFormatZip(true);
                setFormatPdf(false);
                setFormatCsv(false);
                // Never carried over from a previous claim: an attestation is
                // about the expenses in front of the user right now.
                setAttested(false);
                setPhase("generate");
              }}
            >
              <FileText className="h-4 w-4 mr-2" />
              {isShoebox ? "Claim anyway" : "New record"}
            </Button>
          </CardContent>
        </Card>

        {/* Past records */}
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2">
          Past records
        </h2>
        {pastRecords.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center space-y-3">
              <FileText className="h-8 w-8 mx-auto text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                No records generated yet. Your first one will appear here once
                you bundle up your eligible expenses above.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {pastRecords.map((r) => (
              <Card key={r.id}>
                <CardContent className="p-4 flex flex-wrap items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold tabular-nums">
                        {r.record_number}
                      </p>
                      <Badge
                        variant="outline"
                        className={
                          r.status === "reimbursed"
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200 text-xs"
                            : r.status === "voided"
                              ? "bg-red-50 text-red-700 border-red-200 text-xs"
                              : "bg-amber-50 text-amber-700 border-amber-200 text-xs"
                        }
                      >
                        {r.status === "generated"
                          ? "Awaiting deposit"
                          : r.status}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Tax year {r.tax_year} ·{" "}
                      {new Date(r.generated_at).toLocaleDateString()} ·{" "}
                      {r.expense_count} expense
                      {r.expense_count === 1 ? "" : "s"} · $
                      {r.total_amount.toFixed(2)}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {r.custodian
                        ? `Sent to ${r.custodian}`
                        : "No custodian recorded"}
                      {r.attested_no_double_benefit ? " · attested" : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {/* Workstream E3: the page has always said records can be
                        re-downloaded at any time. This is the button that
                        makes that true. */}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => redownloadPacket(r)}
                      disabled={redownloadingId !== null}
                    >
                      {redownloadingId === r.id ? (
                        <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                      ) : (
                        <FileArchive className="h-3.5 w-3.5 mr-1.5" />
                      )}
                      Packet
                    </Button>
                    {/* Workstream E5: only an open claim can be withdrawn. A
                        paid one would put money back into the claimable pool
                        that has already arrived, and a voided one is already
                        withdrawn — so neither offers the button at all rather
                        than offering it and refusing. */}
                    {r.status === "generated" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => {
                          setVoidTarget(r);
                          setVoidReason("");
                        }}
                      >
                        <Undo2 className="h-3.5 w-3.5 mr-1.5" />
                        Withdraw
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Tax export, moved here 2026-08-20 when /reports was retired.
            A claim packet goes to the HSA custodian to get money back; this
            goes to whoever does the user's taxes. Same underlying expenses,
            different reader — so it belongs on this page, one section down
            from the claims rather than on an analytics screen of its own. */}
        <div className="mt-10 pt-8 border-t">
          <h2 className="text-lg font-semibold mb-1">Tax export</h2>
          <p className="text-sm text-muted-foreground mb-4">
            A year's worth of qualified expenses in one file, for your records
            or your accountant. Separate from a claim — nothing here is sent to
            your custodian.
          </p>
          <TaxPackageExport />
        </div>

        <p className="text-xs text-muted-foreground mt-6 text-center max-w-md mx-auto">
          Claim packets are built on your device and never stored on Reclaim's
          servers. Your documents, confirmation timestamps and expense data are
          — so you can rebuild any packet from this list at any time.
        </p>
      </div>

      {/* Workstream E5 — withdrawing a claim. Confirmed rather than immediate:
          it changes what several expenses are available for, and the number
          below is the part the user actually needs to see before deciding. */}
      <AlertDialog
        open={voidTarget !== null}
        onOpenChange={(open) => {
          if (!open && !voiding) {
            setVoidTarget(null);
            setVoidReason("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Withdraw {voidTarget?.record_number}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  Its {voidTarget?.expense_count} expense
                  {voidTarget?.expense_count === 1 ? "" : "s"} ($
                  {voidTarget?.total_amount.toFixed(2)}) go back to being ready
                  to claim, so you can put them in a new claim.
                </p>
                <p>
                  The claim stays in your history with everything it contained,
                  and you can still download its packet. Nothing is deleted.
                </p>
                <div className="space-y-1.5 pt-1">
                  <Label htmlFor="void-reason" className="text-foreground">
                    Why? (optional)
                  </Label>
                  <Input
                    id="void-reason"
                    value={voidReason}
                    onChange={(e) => setVoidReason(e.target.value)}
                    placeholder="e.g. custodian asked for an itemised bill"
                    maxLength={200}
                    disabled={voiding}
                  />
                  {/* Worth the extra field: a rejection revisited months later
                      is only intelligible if the reason travelled with it. */}
                  <p className="text-xs text-muted-foreground">
                    Saved with the claim, so you'll know later what happened.
                  </p>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={voiding}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              disabled={voiding}
              onClick={(e) => {
                // The dialog closes itself on action; hold it open until the
                // database has answered, so a failure is not hidden behind a
                // dialog that has already dismissed.
                e.preventDefault();
                if (voidTarget) void voidRecord(voidTarget, voidReason);
              }}
            >
              {voiding && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Withdraw claim
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AuthenticatedLayout>
  );
}
