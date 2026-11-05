// Run with `npm test` (node --test). V1 launch plan, Batch 1, problem 3:
// dates shown a day early, and mileage defaulting to tomorrow.
//
// Each test file runs in its own process, so pinning the zone here affects
// only this file. Denver is far enough west of Greenwich that UTC midnight is
// the previous evening, which is the whole bug.
process.env.TZ = "America/Denver";

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import {
  formatHSAAccountDateRange,
  getActiveHSAAccount,
  type HSAAccount,
} from "./hsaAccountUtils.ts";
import { todayLocalISO } from "./utils.ts";

function account(overrides: Partial<HSAAccount>): HSAAccount {
  return {
    id: "a",
    user_id: "u",
    account_name: "HSA",
    opened_date: "2022-03-15",
    closed_date: null,
    is_active: true,
    created_at: null,
    updated_at: null,
    eligibility_start_date: null,
    qle_type: null,
    notes: null,
    ...overrides,
  };
}

const localDay = (y: number, m: number, d: number) =>
  new Date(y, m - 1, d).toLocaleDateString();

test("the zone really is one where the old code showed the day before", () => {
  // Guards the test itself: if this ever passes trivially, the ones below
  // prove nothing.
  assert.notEqual(
    new Date("2022-03-15").toLocaleDateString(),
    localDay(2022, 3, 15),
  );
});

test("an HSA account opened on the 15th is listed as opened on the 15th", () => {
  assert.equal(
    formatHSAAccountDateRange(account({ opened_date: "2022-03-15" })),
    `${localDay(2022, 3, 15)} - Present`,
  );
});

test("a closed account shows both stored days", () => {
  assert.equal(
    formatHSAAccountDateRange(
      account({ opened_date: "2019-01-01", closed_date: "2021-12-31" }),
    ),
    `${localDay(2019, 1, 1)} - ${localDay(2021, 12, 31)}`,
  );
});

test("the active account is the most recently opened one", () => {
  const picked = getActiveHSAAccount([
    account({ id: "old", opened_date: "2015-06-01" }),
    account({ id: "new", opened_date: "2022-03-15" }),
    account({
      id: "closed",
      opened_date: "2024-01-01",
      closed_date: "2024-06-01",
    }),
    account({ id: "inactive", opened_date: "2025-01-01", is_active: false }),
  ]);
  assert.equal(picked?.id, "new");
  assert.equal(getActiveHSAAccount([]), null);
});

test("mileage's 'today' is the viewer's day, not tomorrow, in the evening", () => {
  // 7:30pm on Nov 3 in Denver is already Nov 4 in UTC.
  mock.timers.enable({
    apis: ["Date"],
    now: Date.parse("2026-11-04T02:30:00Z"),
  });
  try {
    assert.equal(new Date().toISOString().slice(0, 10), "2026-11-04"); // the old default
    assert.equal(todayLocalISO(), "2026-11-03");
  } finally {
    mock.timers.reset();
  }
});
