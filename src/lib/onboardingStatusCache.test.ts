// Run with `npm test` (node --test). V1 launch plan, Batch 1, problem 1:
// finishing setup must not bounce the user back to /welcome.

import { test } from "node:test";
import assert from "node:assert/strict";
import { QueryClient } from "@tanstack/query-core";
import {
  onboardingStatusKey,
  recordOnboardingCompletion,
  type OnboardingStatusData,
} from "./onboardingStatusCache.ts";

const USER = "user-1";

const notFinished: OnboardingStatusData = {
  completedAt: null,
  hsaDate: null,
  estimate: false,
  hasBank: false,
};

function client() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

test("the dashboard reads 'finished' straight after setup, with no refetch", async () => {
  const qc = client();
  // First visit: the dashboard cached "not finished" and redirected to /welcome.
  qc.setQueryData(onboardingStatusKey(USER), notFinished);

  await recordOnboardingCompletion(qc, USER, "2026-11-04T12:00:00.000Z");

  // What the dashboard sees on mount, before any network round trip.
  const cached = qc.getQueryData<OnboardingStatusData>(
    onboardingStatusKey(USER),
  );
  assert.equal(cached?.completedAt, "2026-11-04T12:00:00.000Z");
  // The rest of the status is untouched.
  assert.equal(cached?.hasBank, false);
  // And it is still re-checked against the database on the next read.
  assert.equal(
    qc.getQueryState(onboardingStatusKey(USER))?.isInvalidated,
    true,
  );
  qc.clear();
});

test("a fetch already in flight cannot put the old answer back", async () => {
  const qc = client();
  qc.setQueryData(onboardingStatusKey(USER), notFinished);

  // A refetch that started before the save and answers with the old row.
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  const inFlight = qc
    .fetchQuery({
      queryKey: onboardingStatusKey(USER),
      staleTime: 0,
      queryFn: async () => {
        await gate;
        return notFinished;
      },
    })
    .catch(() => undefined); // cancelled, as intended

  await recordOnboardingCompletion(qc, USER, "2026-11-04T12:00:00.000Z");
  release();
  await inFlight;

  assert.equal(
    qc.getQueryData<OnboardingStatusData>(onboardingStatusKey(USER))
      ?.completedAt,
    "2026-11-04T12:00:00.000Z",
  );
  qc.clear();
});

test("with nothing cached, nothing is invented", async () => {
  const qc = client();
  await recordOnboardingCompletion(qc, USER, "2026-11-04T12:00:00.000Z");
  // The next reader fetches the real row rather than a half-built one.
  assert.equal(qc.getQueryData(onboardingStatusKey(USER)), undefined);
  qc.clear();
});

test("reopening setup is recorded the same way", async () => {
  const qc = client();
  qc.setQueryData(onboardingStatusKey(USER), {
    ...notFinished,
    completedAt: "2026-01-01T00:00:00.000Z",
  });
  await recordOnboardingCompletion(qc, USER, null);
  assert.equal(
    qc.getQueryData<OnboardingStatusData>(onboardingStatusKey(USER))
      ?.completedAt,
    null,
  );
  qc.clear();
});

test("another user's cached status is left alone", async () => {
  const qc = client();
  qc.setQueryData(onboardingStatusKey("someone-else"), notFinished);
  await recordOnboardingCompletion(qc, USER, "2026-11-04T12:00:00.000Z");
  assert.equal(
    qc.getQueryData<OnboardingStatusData>(onboardingStatusKey("someone-else"))
      ?.completedAt,
    null,
  );
  qc.clear();
});
