/**
 * IRS Regulatory Limits — Single Source of Truth
 *
 * All HSA, FSA, and HDHP dollar limits must come from this file.
 * Do NOT hardcode IRS limit values elsewhere in the codebase.
 *
 * Update this file each January when the IRS publishes new limits.
 * Sources: IRS Publication 969, Revenue Procedure 2024-40.
 *
 * Last updated: 2026-04-08 (reflecting 2025 tax year limits)
 */

// ── HSA Contribution Limits ───────────────────────────────────────────────────
// Source: IRS Publication 969 (2025), Rev. Proc. 2024-25

export const HSA_LIMITS_2025 = {
  selfOnly: 4300,
  family: 8550,
  catchUp: 1000, // Additional contribution for age 55+ (unchanged from 2024)
} as const;

// ── HDHP Qualification Thresholds ────────────────────────────────────────────
// Source: IRS Publication 969 (2025)

export const HDHP_THRESHOLDS_2025 = {
  selfOnly: { minDeductible: 1650, maxOOP: 8300 },
  family: { minDeductible: 3300, maxOOP: 16600 },
} as const;

// ── FSA Limits ────────────────────────────────────────────────────────────────
// Source: Revenue Procedure 2024-40

export const FSA_LIMITS_2025 = {
  contribution: 3300, // Up from $3,050 in 2024
  carryover: 660, // Up from $610 in 2024; only if plan allows carryover (not grace period)
} as const;

// ── 2026 Preview Limits ───────────────────────────────────────────────────────
// Source: IRS Publication 969 (2025), Tip boxes — informational only

export const HSA_LIMITS_2026 = {
  selfOnly: 4400,
  family: 8750,
  catchUp: 1000,
} as const;

export const HDHP_THRESHOLDS_2026 = {
  selfOnly: { minDeductible: 1700, maxOOP: 8500 },
  family: { minDeductible: 3400, maxOOP: 17000 },
} as const;

// ── Medical Mileage ───────────────────────────────────────────────────────────
// Source: IRS Publication 502, "Transportation"; annual standard-mileage notices.
//
// Workstream D6. Bank sync structurally cannot see a car trip, so mileage is
// manual-entry-only — and it is real recurring money for anyone managing a
// chronic condition.
//
// Three properties this table has to get right, in order of how badly each one
// bites if it is wrong:
//
//  1. The rate is keyed on DATE OF SERVICE, not the current year. Someone
//     entering a 2023 trip today is owed the 2023 rate.
//  2. Rates can change MID-YEAR. 2022 had two (the fuel-price adjustment in
//     Notice 2022-13), so the table is a list of date ranges, not a map of
//     years.
//  3. An unpublished rate must announce itself rather than be guessed at
//     silently. `confirmed: false` means "carried forward, not verified against
//     the IRS notice" — the UI says so, and the entry stores whatever rate was
//     actually applied so a correction later is arithmetic, not archaeology.
//
// Parking fees and tolls are claimable ON TOP of the per-mile amount (Pub. 502)
// — they are not folded into the rate.

export interface MileageRatePeriod {
  /** Inclusive, YYYY-MM-DD. Compared as calendar strings — never as Dates. */
  start: string;
  /** Inclusive, YYYY-MM-DD. */
  end: string;
  ratePerMile: number;
  /** False = carried forward from the prior period, not yet verified. */
  confirmed: boolean;
  source: string;
}

export const MEDICAL_MILEAGE_RATES: readonly MileageRatePeriod[] = [
  {
    start: "2019-01-01",
    end: "2019-12-31",
    ratePerMile: 0.2,
    confirmed: true,
    source: "IRS Notice 2019-02",
  },
  {
    start: "2020-01-01",
    end: "2020-12-31",
    ratePerMile: 0.17,
    confirmed: true,
    source: "IRS Notice 2020-05",
  },
  {
    start: "2021-01-01",
    end: "2021-12-31",
    ratePerMile: 0.16,
    confirmed: true,
    source: "IRS Notice 2021-02",
  },
  {
    start: "2022-01-01",
    end: "2022-06-30",
    ratePerMile: 0.18,
    confirmed: true,
    source: "IRS Notice 2022-03",
  },
  {
    // Mid-year increase. The reason this table is date-ranged at all.
    start: "2022-07-01",
    end: "2022-12-31",
    ratePerMile: 0.22,
    confirmed: true,
    source: "IRS Announcement 2022-13",
  },
  {
    start: "2023-01-01",
    end: "2023-12-31",
    ratePerMile: 0.22,
    confirmed: true,
    source: "IRS Notice 2023-03",
  },
  {
    start: "2024-01-01",
    end: "2024-12-31",
    ratePerMile: 0.21,
    confirmed: true,
    source: "IRS Notice 2024-08",
  },
  {
    start: "2025-01-01",
    end: "2025-12-31",
    ratePerMile: 0.21,
    confirmed: true,
    source: "IRS Notice 2025-05",
  },
  {
    // UNVERIFIED — carried forward from 2025. Replace with the published 2026
    // figure and flip `confirmed` to true. Until then the entry screen tells
    // the user the rate is provisional rather than presenting a tax number it
    // cannot stand behind.
    start: "2026-01-01",
    end: "2026-12-31",
    ratePerMile: 0.21,
    confirmed: false,
    source: "Carried forward from 2025 — 2026 notice not yet entered",
  },
] as const;

/**
 * The IRS medical mileage rate in force on a given date of service.
 *
 * Returns null when the date falls outside the table. Deliberately not a
 * fallback: inventing a rate for an unknown year would put an unsourced number
 * on a tax document. The caller shows the user why it cannot compute.
 *
 * @param serviceDate calendar date as YYYY-MM-DD. String comparison is
 *   intentional — parsing to a Date reintroduces the UTC-midnight bug that
 *   shifts a date by one day for users west of Greenwich.
 */
export function medicalMileageRate(
  serviceDate: string,
): MileageRatePeriod | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) return null;
  return (
    MEDICAL_MILEAGE_RATES.find(
      (p) => serviceDate >= p.start && serviceDate <= p.end,
    ) ?? null
  );
}

/** Miles x rate, plus parking and tolls, rounded to the cent. */
export function medicalMileageAmount(
  miles: number,
  ratePerMile: number,
  parkingAndTolls = 0,
): number {
  const drive = Math.round(miles * ratePerMile * 100) / 100;
  return Math.round((drive + parkingAndTolls) * 100) / 100;
}

// ── Current Tax Year Alias ────────────────────────────────────────────────────
// Use these aliases when displaying the "current year" limits in UI.
// Update these aliases each January along with the raw limit objects above.

export const HSA_LIMITS_CURRENT = HSA_LIMITS_2025;
export const HDHP_THRESHOLDS_CURRENT = HDHP_THRESHOLDS_2025;
export const FSA_LIMITS_CURRENT = FSA_LIMITS_2025;
export const CURRENT_TAX_YEAR = 2025;
