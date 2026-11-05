// Run with `npm test` (node --test). L2 and the founder's decision of
// 2026-11-04: warn before an HSA account change moves the HSA start later.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  earliestHSAStart,
  hsaStartAfterChange,
  hsaStartMoveMessage,
  startMovesLater,
} from "./hsaAccountUtils.ts";

const acct = (
  id: string,
  opened_date: string,
  eligibility_start_date: string | null = null,
) => ({ id, opened_date, eligibility_start_date });

const day = (y: number, m: number, d: number) =>
  new Date(y, m - 1, d).toLocaleDateString();

test("the start is the earliest eligibility start, else opened date", () => {
  assert.equal(
    earliestHSAStart([acct("a", "2023-01-01"), acct("b", "2019-03-01")]),
    "2019-03-01",
  );
  // An eligibility start counts in place of its account's opened date --
  // later or earlier -- exactly as the database trigger measures it.
  assert.equal(
    earliestHSAStart([acct("a", "2019-03-01", "2018-07-01")]),
    "2018-07-01",
  );
  assert.equal(
    earliestHSAStart([acct("a", "2019-03-01", "2020-01-01")]),
    "2020-01-01",
  );
  assert.equal(earliestHSAStart([]), null);
});

test("adding only a newer, rolled-over HSA moves the start later", () => {
  // Start came from onboarding; no accounts yet.
  const next = hsaStartAfterChange("2019-03-01", [], {
    kind: "save",
    opened_date: "2023-06-01",
    eligibility_start_date: null,
  });
  assert.equal(next, "2023-06-01");
  assert.equal(startMovesLater("2019-03-01", next), true);
});

test("adding an older account never warns", () => {
  const next = hsaStartAfterChange("2023-06-01", [acct("new", "2023-06-01")], {
    kind: "save",
    opened_date: "2019-03-01",
    eligibility_start_date: null,
  });
  assert.equal(next, "2019-03-01");
  assert.equal(startMovesLater("2023-06-01", next), false);
});

test("editing an account replaces its old dates", () => {
  const accounts = [acct("old", "2019-03-01"), acct("new", "2023-06-01")];
  // Correcting the old account's year forward moves the start.
  assert.equal(
    hsaStartAfterChange("2019-03-01", accounts, {
      kind: "save",
      id: "old",
      opened_date: "2021-01-01",
      eligibility_start_date: null,
    }),
    "2021-01-01",
  );
  // Renaming the newer account changes nothing.
  assert.equal(
    hsaStartAfterChange("2019-03-01", accounts, {
      kind: "save",
      id: "new",
      opened_date: "2023-06-01",
      eligibility_start_date: null,
    }),
    "2019-03-01",
  );
});

test("deleting the earliest account moves the start; deleting the last keeps it", () => {
  const accounts = [acct("old", "2019-03-01"), acct("new", "2023-06-01")];
  assert.equal(
    hsaStartAfterChange("2019-03-01", accounts, { kind: "delete", id: "old" }),
    "2023-06-01",
  );
  assert.equal(
    hsaStartAfterChange("2019-03-01", [acct("only", "2019-03-01")], {
      kind: "delete",
      id: "only",
    }),
    "2019-03-01",
  );
});

test("no current start is not 'later'", () => {
  assert.equal(startMovesLater(null, "2023-06-01"), false);
  assert.equal(startMovesLater("2019-03-01", null), false);
  assert.equal(startMovesLater("2019-03-01", "2019-03-01"), false);
});

test("the problem line, in the founder's words", () => {
  assert.equal(
    hsaStartMoveMessage("2019-03-01", "2023-06-01", 4),
    `This moves your HSA start from ${day(2019, 3, 1)} to ${day(2023, 6, 1)} — 4 expenses would no longer be claimable.`,
  );
  assert.equal(
    hsaStartMoveMessage("2019-03-01", "2023-06-01", 1),
    `This moves your HSA start from ${day(2019, 3, 1)} to ${day(2023, 6, 1)} — 1 expense would no longer be claimable.`,
  );
  // Nothing affected yet, or still counting: the move alone.
  assert.equal(
    hsaStartMoveMessage("2019-03-01", "2023-06-01", 0),
    `This moves your HSA start from ${day(2019, 3, 1)} to ${day(2023, 6, 1)}.`,
  );
  assert.equal(
    hsaStartMoveMessage("2019-03-01", "2023-06-01", null),
    `This moves your HSA start from ${day(2019, 3, 1)} to ${day(2023, 6, 1)}.`,
  );
});
