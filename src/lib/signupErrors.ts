// Turns a rejected sign-up into a message beside the field it concerns.
//
// Supabase's messages are written for developers ("User already registered",
// "Password should contain at least one character of each…"), and a few echo
// the address back. Only `code` and `reasons` are read here; every string
// returned is fixed text.

export type SignupField = "fullName" | "email" | "password";

export interface SignupProblem {
  /** The field the message belongs beside, or null for the form as a whole. */
  field: SignupField | null;
  message: string;
}

export const GENERIC_SIGNUP_FAILURE =
  "We couldn't create your account. Please try again.";

export const EMAIL_TAKEN_MESSAGE =
  "There's already an account with this email.";

interface ErrorLike {
  code?: unknown;
  status?: unknown;
  message?: unknown;
  reasons?: unknown;
}

export function describeSignupError(error: unknown): SignupProblem {
  const e: ErrorLike =
    typeof error === "object" && error !== null ? (error as ErrorLike) : {};
  const code = typeof e.code === "string" ? e.code : "";
  const text = typeof e.message === "string" ? e.message : "";

  if (code === "user_already_exists" || code === "email_exists") {
    return { field: "email", message: EMAIL_TAKEN_MESSAGE };
  }
  // Older server versions send no code, only the sentence.
  if (!code && /already registered/i.test(text)) {
    return { field: "email", message: EMAIL_TAKEN_MESSAGE };
  }

  if (
    code === "email_address_invalid" ||
    code === "email_address_not_authorized"
  ) {
    return { field: "email", message: "Enter a valid email address." };
  }

  if (code === "weak_password") {
    const reasons = Array.isArray(e.reasons) ? e.reasons : [];
    if (reasons.includes("pwned")) {
      return {
        field: "password",
        message:
          "That password has appeared in a data breach. Choose a different one.",
      };
    }
    if (reasons.includes("characters")) {
      return {
        field: "password",
        message: "Mix upper and lower case letters, numbers and symbols.",
      };
    }
    return { field: "password", message: "Choose a stronger password." };
  }

  if (
    code === "over_email_send_rate_limit" ||
    code === "over_request_rate_limit" ||
    e.status === 429
  ) {
    return {
      field: null,
      message: "Too many attempts. Wait a few minutes and try again.",
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

  return { field: null, message: GENERIC_SIGNUP_FAILURE };
}

/** The same mapping for a failed "send it again", which has no field. */
export function describeResendError(error: unknown): string {
  const e: ErrorLike =
    typeof error === "object" && error !== null ? (error as ErrorLike) : {};
  if (
    e.code === "over_email_send_rate_limit" ||
    e.code === "over_request_rate_limit" ||
    e.status === 429
  ) {
    return "You can ask for another email in a minute.";
  }
  return "We couldn't send that. Try again in a minute.";
}
