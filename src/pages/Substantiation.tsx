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
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
  record_id: string;
  record_number: string;
  record_total: number;
  record_expense_count: number;
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
        { data: matchRows },
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
        // Reclaim Phase 4 W3: pending deposit → record match candidates.
        supabase
          .from("reimbursement_match_candidates")
          .select(
            `id, match_amount, match_reason, transaction_id,
             transaction:transactions ( vendor, transaction_date ),
             substantiation_record_id,
             record:substantiation_records ( id, record_number, total_amount, expense_count )`,
          )
          .eq("user_id", user.id)
          .eq("status", "pending")
          .order("created_at", { ascending: false }),
      ]);

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
          const row = m as Record<string, unknown> & {
            transaction:
              | { vendor: string | null; transaction_date: string }
              | { vendor: string | null; transaction_date: string }[]
              | null;
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
              record_id: rec.id,
              record_number: rec.record_number,
              record_total: Number(rec.total_amount),
              record_expense_count: rec.expense_count,
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

  async function confirmMatch(match: PendingMatch) {
    setMatchActingId(match.id);
    try {
      const now = new Date().toISOString();

      // 1. Mark candidate resolved.
      const { error: candErr } = await supabase
        .from("reimbursement_match_candidates")
        .update({ status: "confirmed", resolved_at: now })
        .eq("id", match.id);
      if (candErr) throw candErr;

      // 2. Close out the record.
      const { error: recErr } = await supabase
        .from("substantiation_records")
        .update({
          status: "reimbursed",
          reimbursed_at: now,
          reimbursed_transaction_id: match.transaction_id,
        })
        .eq("id", match.record_id);
      if (recErr) throw recErr;

      // 3. Cascade REIMBURSED through every invoice bundled into that record.
      const { data: items } = await supabase
        .from("substantiation_record_items")
        .select("invoice_id")
        .eq("substantiation_record_id", match.record_id);
      const invoiceIds = (items ?? []).map((i) => i.invoice_id);
      if (invoiceIds.length > 0) {
        await supabase
          .from("invoices")
          // Workstream B: lifecycle_status is derived from the facets; set
          // claim_state instead. This also releases the double-claim lock,
          // since the lock keys on claim_state = 'locked_in_request'.
          .update({ claim_state: "reimbursed", reimbursed_at: now })
          .in("id", invoiceIds);
      }

      // 4. Dismiss any sibling candidates for the same record — once it's
      // reimbursed, no other deposit should be pending for it.
      await supabase
        .from("reimbursement_match_candidates")
        .update({ status: "dismissed", resolved_at: now })
        .eq("substantiation_record_id", match.record_id)
        .eq("status", "pending")
        .neq("id", match.id);

      setPendingMatches((prev) =>
        prev.filter((p) => p.record_id !== match.record_id),
      );
      setPastRecords((prev) =>
        prev.map((r) =>
          r.id === match.record_id ? { ...r, status: "reimbursed" } : r,
        ),
      );

      toast.success(
        `${match.record_number} closed. ${invoiceIds.length} expense${invoiceIds.length === 1 ? "" : "s"} marked reimbursed.`,
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
      const now = new Date().toISOString();
      const { error } = await supabase
        .from("reimbursement_match_candidates")
        .update({ status: "dismissed", resolved_at: now })
        .eq("id", match.id);
      if (error) throw error;
      setPendingMatches((prev) => prev.filter((p) => p.id !== match.id));
      toast.success("Dismissed.");
    } catch (err) {
      logError("Substantiation.dismissMatch", err);
      toast.error("Couldn't dismiss.");
    } finally {
      setMatchActingId(null);
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
                    onClick={() => navigate("/review")}
                  >
                    review page
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
                      <p className="text-sm tabular-nums">
                        ${e.amount.toFixed(2)}
                      </p>
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
          <h1 className="text-2xl font-semibold mb-1">
            Substantiation Records
          </h1>
          <p className="text-sm text-muted-foreground">
            IRS-defensible bundles of your confirmed eligible expenses. Generate
            one when you're ready to file for HSA reimbursement.
          </p>
        </div>

        {/* Reclaim Phase 4 W3: deposit-match prompts. Loop closure happens
            here — confirming cascades REIMBURSED through the record + items. */}
        {pendingMatches.length > 0 && (
          <div className="space-y-2 mb-6">
            {pendingMatches.map((m) => (
              <Card key={m.id} className="border-emerald-200 bg-emerald-50/50">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="rounded-full bg-emerald-100 p-2 mt-0.5">
                      <Banknote className="h-4 w-4 text-emerald-700" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">
                        Did this ${m.match_amount.toFixed(2)} deposit close{" "}
                        <span className="tabular-nums">{m.record_number}</span>?
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {m.transaction_vendor} ·{" "}
                        {new Date(
                          m.transaction_date + "T00:00:00",
                        ).toLocaleDateString()}{" "}
                        · matches your {m.record_expense_count}-expense record
                        ($
                        {m.record_total.toFixed(2)}).
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Button
                      size="sm"
                      onClick={() => confirmMatch(m)}
                      disabled={matchActingId === m.id}
                      className="flex-1 bg-emerald-700 hover:bg-emerald-800"
                    >
                      {matchActingId === m.id ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                      )}
                      Yes, close this record
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => dismissMatch(m)}
                      disabled={matchActingId === m.id}
                      className="flex-1"
                    >
                      <X className="mr-2 h-4 w-4" />
                      Not this one
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Ready-to-submit hero */}
        <Card className="mb-6 border-primary/30">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="flex-1">
              <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground mb-1">
                Ready to submit
              </p>
              <p className="text-3xl font-bold tabular-nums">
                ${eligibleNowTotal.toFixed(2)}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {eligibleNow.length} eligible expense
                {eligibleNow.length === 1 ? "" : "s"} for {CURRENT_TAX_YEAR}
              </p>
            </div>
            <Button
              size="lg"
              disabled={eligible.length === 0}
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
              New record
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
                    {r.status === "generated" && (
                      <CheckCircle2 className="h-5 w-5 text-amber-500" />
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <p className="text-xs text-muted-foreground mt-6 text-center max-w-md mx-auto">
          Claim packets are built on your device and never stored on Reclaim's
          servers. Your documents, confirmation timestamps and expense data are
          — so you can rebuild any packet from this list at any time.
        </p>
      </div>
    </AuthenticatedLayout>
  );
}
