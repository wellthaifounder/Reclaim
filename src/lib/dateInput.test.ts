// Run with `npm test` (node --test). V1 launch plan, Batch 1: the date box
// takes the date as soon as the typed text is a complete, valid date.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCompleteDate, parseTypedDate } from "./dateInput.ts";

const ymd = (d: Date | null) =>
  d
    ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
        d.getDate(),
      ).padStart(2, "0")}`
    : null;

test("a finished date with a four-digit year is taken while typing", () => {
  assert.equal(ymd(parseCompleteDate("03/15/2022")), "2022-03-15");
  assert.equal(ymd(parseCompleteDate("3/15/2022")), "2022-03-15");
  assert.equal(ymd(parseCompleteDate("2022-03-15")), "2022-03-15");
  assert.equal(ymd(parseCompleteDate("March 15, 2022")), "2022-03-15");
  assert.equal(ymd(parseCompleteDate("03152022")), "2022-03-15");
  assert.equal(ymd(parseCompleteDate("  03/15/2022 ")), "2022-03-15");
});

test("every keystroke short of a whole date is not a date", () => {
  const typing = "03/15/2022";
  for (let i = 1; i < typing.length; i++) {
    assert.equal(
      parseCompleteDate(typing.slice(0, i)),
      null,
      `"${typing.slice(0, i)}" should not count as a date yet`,
    );
  }
  // ISO typed a digit at a time: "2022-03-1" is not the 1st, it is unfinished.
  assert.equal(parseCompleteDate("2022-03-1"), null);
  assert.equal(parseCompleteDate("0315202"), null);
});

test("a two-digit year waits for blur, then is accepted", () => {
  // "3/4/20" is as likely the start of "3/4/2009" as a finished 2020.
  assert.equal(parseCompleteDate("3/4/20"), null);
  assert.equal(ymd(parseTypedDate("3/4/20")), "2020-03-04");
  assert.equal(ymd(parseTypedDate("03/04/09")), "2009-03-04");
});

test("a four-digit year is never read as a two-digit one", () => {
  assert.equal(ymd(parseTypedDate("3/4/2009")), "2009-03-04");
});

test("impossible and trailing-garbage dates are rejected", () => {
  assert.equal(parseCompleteDate("02/30/2022"), null);
  assert.equal(parseTypedDate("02/30/2022"), null);
  assert.equal(parseTypedDate("3/4/2009xyz"), null);
  assert.equal(parseTypedDate(""), null);
  assert.equal(parseTypedDate("soon"), null);
});

test("the date is the calendar day typed, at local midnight", () => {
  const d = parseCompleteDate("01/01/2022");
  assert.ok(d);
  assert.equal(d.getHours(), 0);
  assert.equal(d.getDate(), 1);
  assert.equal(d.getMonth(), 0);
});
