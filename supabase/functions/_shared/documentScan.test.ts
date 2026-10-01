// Tests for what the scan keeps (SUBSTANTIATE_SPEC S8, S10).
//
// Run:  cd supabase/functions && deno test _shared/documentScan.test.ts
//
// The model's JSON is untrusted: these pin how its answer is turned into what
// the database keeps, and when a document counts as unreadable.

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { normalizeOcrResult } from "./receiptOcrProcessor.ts";
import { readNothing, scanMimeType } from "./documentScan.ts";

Deno.test("a hospital stay keeps its first and last day (S10)", () => {
  const r = normalizeOcrResult(
    { serviceDate: "2026-02-27", serviceDateEnd: "2026-03-02" },
    "",
  );
  assertEquals(r.serviceDate, "2026-02-27");
  assertEquals(r.serviceDateEnd, "2026-03-02");
});

Deno.test("a range that ends where it starts is a single day", () => {
  const same = normalizeOcrResult(
    { serviceDate: "2026-03-02", serviceDateEnd: "2026-03-02" },
    "",
  );
  assertEquals(same.serviceDateEnd, null);
  const backwards = normalizeOcrResult(
    { serviceDate: "2026-03-02", serviceDateEnd: "2026-02-01" },
    "",
  );
  assertEquals(backwards.serviceDateEnd, null);
  const noStart = normalizeOcrResult({ serviceDateEnd: "2026-03-02" }, "");
  assertEquals(noStart.serviceDateEnd, null);
});

Deno.test("dates that are not YYYY-MM-DD are dropped, not guessed", () => {
  const r = normalizeOcrResult(
    { serviceDate: "March 2, 2026", date: "03/02/2026", billDate: 20260302 },
    "",
  );
  assertEquals([r.serviceDate, r.date, r.billDate], [null, null, null]);
});

Deno.test(
  "an unknown document type is null, never written to the database",
  () => {
    assertEquals(
      normalizeOcrResult({ documentType: "medical_record" }, "").documentType,
      null,
    );
    assertEquals(
      normalizeOcrResult({ documentType: "letter_of_medical_necessity" }, "")
        .documentType,
      "letter_of_medical_necessity",
    );
  },
);

Deno.test("items bought: strings only, trimmed, at most ten", () => {
  const r = normalizeOcrResult(
    {
      itemsBought: [
        " Ibuprofen 200mg ",
        42,
        "",
        null,
        ...Array.from({ length: 12 }, (_, i) => `Item ${i}`),
      ],
    },
    "",
  );
  assertEquals(r.itemsBought[0], "Ibuprofen 200mg");
  assertEquals(r.itemsBought.length, 10);
});

Deno.test("an amount written as text is still an amount", () => {
  assertEquals(normalizeOcrResult({ amount: "$1,234.50" }, "").amount, 1234.5);
  assertEquals(normalizeOcrResult({ amount: "n/a" }, "").amount, null);
  assertEquals(normalizeOcrResult({ amount: 3.48 }, "").amount, 3.48);
});

Deno.test("a blank patient or provider is no patient or provider", () => {
  const r = normalizeOcrResult({ patientName: "   ", vendor: "" }, "");
  assertEquals([r.patientName, r.vendor], [null, null]);
});

Deno.test("a reading with nothing in it is unreadable (S8)", () => {
  assertEquals(readNothing(normalizeOcrResult({}, "")), true);
  assertEquals(
    readNothing(
      normalizeOcrResult({ warnings: ["blurry"], confidence: 0.1 }, ""),
    ),
    true,
  );
  // A card slip: an amount and a store, nothing bought. Readable.
  assertEquals(
    readNothing(normalizeOcrResult({ vendor: "Walmart", amount: 3.48 }, "")),
    false,
  );
});

Deno.test(
  "the mime type sent: stored type first, a nameless PDF by its name",
  () => {
    assertEquals(
      scanMimeType({ file_type: "application/pdf", file_path: "a/b/x" }),
      "application/pdf",
    );
    assertEquals(
      scanMimeType({ file_type: "image/jpg", file_path: "a/b/x.jpg" }),
      "image/jpeg",
    );
    assertEquals(
      scanMimeType({ file_type: "", file_path: "a/b/Bill.PDF" }),
      "application/pdf",
    );
    assertEquals(scanMimeType({ file_type: "", file_path: "a/b/x.heic" }), "");
  },
);
