// Run with `npm test` (node --test). SUBSTANTIATE_SPEC S3, S4.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clearMatch,
  documentsToCatchUp,
  matchDistance,
  rankForPicker,
  type Charge,
  type MatchableDocument,
} from "./documentMatch.ts";

const charge: Charge = { paidDate: "2026-09-15", amounts: [85] };

function doc(
  id: string,
  scan: Partial<NonNullable<MatchableDocument["scan"]>> | null,
  extra: Partial<MatchableDocument> = {},
): MatchableDocument {
  return {
    id,
    uploaded_at: "2026-09-01T00:00:00Z",
    attachedElsewhere: 0,
    scan:
      scan === null
        ? null
        : {
            scan_status: "read",
            extracted_amount: null,
            extracted_date: null,
            extracted_bill_date: null,
            extracted_service_date: null,
            extracted_service_date_end: null,
            ...scan,
          },
    ...extra,
  };
}

test("same amount, same day is a match", () => {
  const d = doc("a", { extracted_amount: 85, extracted_date: "2026-09-15" });
  assert.equal(matchDistance(d, charge), 0);
});

test("amount is compared to the cent, and numeric strings count", () => {
  const exact = doc("a", {
    extracted_amount: "85.00",
    extracted_date: "2026-09-14",
  });
  const off = doc("b", {
    extracted_amount: 85.01,
    extracted_date: "2026-09-14",
  });
  assert.equal(matchDistance(exact, charge), 1);
  assert.equal(matchDistance(off, charge), null);
});

test("a bill paid weeks later matches on its bill date", () => {
  const d = doc("a", {
    extracted_amount: 85,
    extracted_bill_date: "2026-07-01",
  });
  assert.equal(matchDistance(d, charge), 76);
});

test("outside the window is not a match", () => {
  const tooOld = doc("a", {
    extracted_amount: 85,
    extracted_date: "2026-06-01",
  });
  const tooLate = doc("b", {
    extracted_amount: 85,
    extracted_date: "2026-09-30",
  });
  assert.equal(matchDistance(tooOld, charge), null);
  assert.equal(matchDistance(tooLate, charge), null);
});

test("the nearest of the document's dates is used", () => {
  const d = doc("a", {
    extracted_amount: 85,
    extracted_service_date: "2026-08-01",
    extracted_date: "2026-09-13",
  });
  assert.equal(matchDistance(d, charge), 2);
});

test("unread, unreadable, dateless, or larger documents never match", () => {
  assert.equal(matchDistance(doc("a", null), charge), null);
  assert.equal(
    matchDistance(
      doc("b", {
        scan_status: "unreadable",
        extracted_amount: 85,
        extracted_date: "2026-09-15",
      }),
      charge,
    ),
    null,
  );
  assert.equal(matchDistance(doc("c", { extracted_amount: 85 }), charge), null);
  assert.equal(
    matchDistance(
      doc("d", { extracted_amount: 850, extracted_date: "2026-09-15" }),
      charge,
    ),
    null,
  );
});

test("a document already backing another expense is not a match", () => {
  const d = doc(
    "a",
    { extracted_amount: 85, extracted_date: "2026-09-15" },
    { attachedElsewhere: 1 },
  );
  assert.equal(matchDistance(d, charge), null);
});

test("either the charge or this expense's share of a split can match", () => {
  const split: Charge = { paidDate: "2026-09-15", amounts: [200, 85] };
  const d = doc("a", { extracted_amount: 200, extracted_date: "2026-09-15" });
  assert.equal(matchDistance(d, split), 0);
});

test("picker: matches first by nearest date, then the rest newest first", () => {
  const far = doc("far", {
    extracted_amount: 85,
    extracted_date: "2026-09-01",
  });
  const near = doc("near", {
    extracted_amount: 85,
    extracted_date: "2026-09-14",
  });
  const old = doc("old", null, { uploaded_at: "2026-01-01T00:00:00Z" });
  const recent = doc("recent", null, { uploaded_at: "2026-09-20T00:00:00Z" });
  const { matches, rest } = rankForPicker([old, far, recent, near], charge);
  assert.deepEqual(
    matches.map((d) => d.id),
    ["near", "far"],
  );
  assert.deepEqual(
    rest.map((d) => d.id),
    ["recent", "old"],
  );
});

test("picker with no charge (attaching to several expenses) ranks nothing", () => {
  const d = doc("a", { extracted_amount: 85, extracted_date: "2026-09-15" });
  assert.deepEqual(rankForPicker([d], null).matches, []);
});

test("offered only when exactly one document matches", () => {
  const one = doc("one", {
    extracted_amount: 85,
    extracted_date: "2026-09-15",
  });
  const two = doc("two", {
    extracted_amount: 85,
    extracted_date: "2026-09-10",
  });
  const other = doc("other", {
    extracted_amount: 12,
    extracted_date: "2026-09-15",
  });
  assert.equal(clearMatch([one, other], charge)?.id, "one");
  assert.equal(clearMatch([one, two], charge), null);
  assert.equal(clearMatch([other], charge), null);
});

test("catch-up: unread documents on no expense, oldest first, capped", () => {
  const d = (
    id: string,
    day: string,
    scan: unknown,
    invoiceIds: string[] = [],
  ) => ({
    id,
    uploaded_at: `2026-09-${day}T00:00:00Z`,
    scan,
    invoiceIds,
  });
  const docs = [
    d("new", "20", null),
    d("old", "01", null),
    d("read", "02", { scan_status: "read" }),
    d("unreadable", "03", { scan_status: "unreadable" }),
    d("attached", "04", null, ["inv"]),
    d("mid", "10", null),
  ];
  assert.deepEqual(
    documentsToCatchUp(docs, new Set()).map((x) => x.id),
    ["old", "mid", "new"],
  );
  // Already tried this visit: not again.
  assert.deepEqual(
    documentsToCatchUp(docs, new Set(["old"])).map((x) => x.id),
    ["mid", "new"],
  );
  // The cap counts what was already tried.
  assert.deepEqual(
    documentsToCatchUp(docs, new Set(["x"]), 2).map((x) => x.id),
    ["old"],
  );
});
