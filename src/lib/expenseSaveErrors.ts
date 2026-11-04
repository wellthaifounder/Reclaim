// Turns a failed expense save into something a person can act on.
//
// The database rejects a save with a code and a message such as `numeric field
// overflow` or `invalid input syntax for type uuid: "…"`. Those messages can
// echo back what was submitted (a provider name, a note), so nothing from the
// error object is ever shown or returned here: only the code is read, and every
// string below is fixed text. Anything that is not recognised as something the
// user can fix falls through to the generic line, and the details go to
// `logError` at the call site.

export type ExpenseSaveField =
  "date" | "amount" | "vendor" | "category" | "patientId";

export interface ExpenseSaveProblem {
  /** The field the message belongs beside, or null for the form as a whole. */
  field: ExpenseSaveField | null;
  message: string;
}

/** The largest amount the `amount` column (numeric 10,2) can hold. */
export const MAX_EXPENSE_AMOUNT = 99_999_999.99;

export const GENERIC_SAVE_FAILURE =
  "We couldn't save this expense. Please try again.";

interface ErrorLike {
  code?: unknown;
  message?: unknown;
  status?: unknown;
}

const asLike = (error: unknown): ErrorLike =>
  typeof error === "object" && error !== null ? (error as ErrorLike) : {};

export function describeExpenseSaveError(error: unknown): ExpenseSaveProblem {
  const { code, message, status } = asLike(error);
  const text = typeof message === "string" ? message : "";

  switch (code) {
    case "22003":
      return {
        field: "amount",
        message: "That amount is too large to save. Check the number.",
      };
    case "22007":
    case "22008":
      return { field: "date", message: "Enter a valid date." };
    case "22P02":
      // The only uuid this insert sends is the patient.
      if (/uuid/i.test(text)) {
        return { field: "patientId", message: "Choose who this was for." };
      }
      break;
    case "23503":
      if (/patient/i.test(text)) {
        return {
          field: "patientId",
          message: "That person is no longer on your list. Choose someone.",
        };
      }
      break;
    default:
  }

  if (
    status === 401 ||
    code === "PGRST301" ||
    code === "PGRST303" ||
    code === "42501" ||
    /jwt|not authenticated/i.test(text)
  ) {
    return {
      field: null,
      message: "Your session has expired. Sign in again to save this expense.",
    };
  }

  if (
    /failed to fetch|networkerror|load failed|network request failed/i.test(
      text,
    )
  ) {
    return {
      field: null,
      message:
        "We couldn't reach the server. Check your connection and try again.",
    };
  }

  return { field: null, message: GENERIC_SAVE_FAILURE };
}
