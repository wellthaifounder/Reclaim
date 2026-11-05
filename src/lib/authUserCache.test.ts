// Run with `npm test` (node --test). PR #87 review: on a shared computer the
// next person to sign in must not see the previous person's cached data.

import { test } from "node:test";
import assert from "node:assert/strict";
import { QueryClient } from "@tanstack/query-core";
import { AUTH_USER_KEY, createAuthUserCacheSync } from "./authUserCache.ts";

const A = { id: "user-a" };
const B = { id: "user-b" };

// The queries the review named: none of them is keyed by user id.
const UNKEYED = [
  ["family-roster"],
  ["documents", "library"],
  ["tags"],
  ["duplicate-candidates"],
  ["categorization-rules"],
];

function seeded(owner: string) {
  const qc = new QueryClient();
  for (const key of UNKEYED) qc.setQueryData(key, `${owner}'s data`);
  qc.setQueryData(["onboarding-status", owner], { completedAt: null });
  return qc;
}

const cachedKeys = (qc: QueryClient) =>
  qc
    .getQueryCache()
    .getAll()
    .map((q) => JSON.stringify(q.queryKey))
    .sort();

test("sign-out drops everything cached except the signed-in user", () => {
  const qc = seeded("A");
  const sync = createAuthUserCacheSync(qc);
  sync(A); // page load
  sync(null); // A signs out
  assert.deepEqual(cachedKeys(qc), [JSON.stringify(AUTH_USER_KEY)]);
  assert.equal(qc.getQueryData(AUTH_USER_KEY), null);
  qc.clear();
});

test("B signing in never sees A's family, documents or tags", () => {
  const qc = seeded("A");
  const sync = createAuthUserCacheSync(qc);
  sync(A);
  sync(null);
  sync(B);
  for (const key of UNKEYED) assert.equal(qc.getQueryData(key), undefined);
  assert.deepEqual(qc.getQueryData(AUTH_USER_KEY), B);
  qc.clear();
});

test("a switch straight from A to B clears too", () => {
  const qc = seeded("A");
  const sync = createAuthUserCacheSync(qc);
  sync(A);
  sync(B);
  for (const key of UNKEYED) assert.equal(qc.getQueryData(key), undefined);
  qc.clear();
});

test("the hourly token refresh for the same person clears nothing", () => {
  const qc = seeded("A");
  const sync = createAuthUserCacheSync(qc);
  sync(A); // page load
  sync({ ...A }); // TOKEN_REFRESHED: same id, new object
  sync({ ...A }); // USER_UPDATED
  for (const key of UNKEYED) assert.equal(qc.getQueryData(key), "A's data");
  assert.deepEqual(qc.getQueryData(["onboarding-status", "A"]), {
    completedAt: null,
  });
  qc.clear();
});

test("the first event on a page only records who is signed in", () => {
  // Whatever loaded before the first auth event belongs to this person.
  const qc = seeded("A");
  createAuthUserCacheSync(qc)(A);
  for (const key of UNKEYED) assert.equal(qc.getQueryData(key), "A's data");
  qc.clear();
});
