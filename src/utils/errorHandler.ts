// Secure error handling utility
// Tier 4 Security Enhancement - Prevents information disclosure

/**
 * Handles errors securely by:
 * 1. Logging detailed errors only in development
 * 2. Showing generic messages to users
 * 3. Preventing PHI exposure in logs
 * 4. Generating error IDs for support reference
 */

/** The subset of a toast library's options this module actually passes. */
interface ToastOptions {
  description?: string;
  duration?: number;
}

type ToastFunction = (message: string, options?: ToastOptions) => void;

/**
 * Log error securely (development only)
 */
export const logError = (
  message: string,
  error?: unknown,
  context?: Record<string, unknown>,
) => {
  if (import.meta.env.DEV) {
    console.error(`[${new Date().toISOString()}] ${message}`, error, context);
  }
  // In production, would send to secure logging service (Sentry, LogRocket, etc.)
  // Example: captureException(error, { contexts: context });
};

/**
 * Pull a raw message string off anything throwable, for MATCHING ONLY.
 *
 * The result is server text. Never render it -- pass it through
 * `toUserMessage` and show that instead.
 */
const rawMessage = (error: unknown): string =>
  error instanceof Error
    ? error.message
    : typeof error === "object" && error && "message" in error
      ? String((error as { message: unknown }).message)
      : "";

/**
 * Turn a thrown value into something a person can read.
 *
 * The trap this exists to close: `err instanceof Error ? err.message : "..."`.
 * A Supabase `FunctionsHttpError` IS an Error, so that branch always wins and
 * the friendly fallback beside it is dead code. `/onboarding/import` shipped
 * exactly that, which is how a user who had just handed over their bank
 * credentials was shown "Edge Function returned a non-2xx status code" --
 * meaningless to them, and it names our infrastructure. CLAUDE.md requires
 * client-facing errors to be generic; this is the helper that keeps that true.
 *
 * Pass a `fallback` written for the specific screen. The raw text is only ever
 * pattern-matched, never returned.
 */
export const toUserMessage = (
  error: unknown,
  fallback = "Something went wrong. Please try again.",
): string => {
  const message = rawMessage(error);

  // Supabase edge-function transport failures. The user did nothing wrong and
  // there is nothing for them to fix, so say so and let them retry.
  if (
    /non-2xx status code|FunctionsHttpError|FunctionsRelayError|FunctionsFetchError/i.test(
      message,
    )
  ) {
    return "Something went wrong on our end. Your bank connection is fine — please try again.";
  }

  // Offline or the request never landed.
  if (/Failed to fetch|NetworkError|ERR_INTERNET_DISCONNECTED/i.test(message)) {
    return "We couldn't reach Reclaim. Check your connection and try again.";
  }

  if (/timeout|timed out|AbortError/i.test(message)) {
    return "That took too long to respond. Please try again.";
  }

  return fallback;
};

/**
 * Handle error with user-friendly message
 *
 * @param error - The error object
 * @param context - Context about where error occurred (for logging)
 * @param toast - Toast function to show message
 * @param userMessage - Optional custom message for user (defaults to generic)
 */
export const handleError = (
  error: unknown,
  context: string,
  toast?: ToastFunction,
  userMessage?: string,
) => {
  const errorId = crypto.randomUUID().substring(0, 8);
  const defaultMessage = "An error occurred. Please try again.";

  // Log detailed error in development only
  logError(`Error in ${context}`, error, { errorId });

  // Show generic message to user
  if (toast) {
    toast(userMessage || defaultMessage, {
      description: `Reference ID: ${errorId}`,
      duration: 4000,
    });
  }
};

/**
 * Handle async operation with error handling
 * Wrapper for try-catch blocks
 */
export const withErrorHandling = async <T>(
  operation: () => Promise<T>,
  context: string,
  toast?: ToastFunction,
  errorMessage?: string,
): Promise<T | null> => {
  try {
    return await operation();
  } catch (error) {
    handleError(error, context, toast, errorMessage);
    return null;
  }
};

/**
 * Sanitize error message for display
 * Removes sensitive information from error messages
 */
export const sanitizeErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    // Remove file paths, URLs, and other sensitive info
    return error.message
      .replace(/https?:\/\/[^\s]+/g, "[URL]")
      .replace(/\/[^\s]+\.(ts|tsx|js|jsx)/g, "[FILE]")
      .replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[SSN]") // SSN pattern
      .replace(
        /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
        "[EMAIL]",
      );
  }
  return "An unexpected error occurred";
};

/**
 * HIPAA-compliant PHI sanitization
 * Redacts Protected Health Information from strings before logging or display
 *
 * PHI includes (per HIPAA Safe Harbor):
 * - Names, addresses, dates, phone/fax numbers
 * - SSN, MRN, health plan numbers, account numbers
 * - Email, URLs, IPs, biometric IDs, photos
 * - Any unique identifying number or code
 */
export const sanitizePHI = (text: string): string => {
  if (!text || typeof text !== "string") return text;

  return (
    text
      // Social Security Numbers (XXX-XX-XXXX or XXXXXXXXX)
      .replace(/\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g, "[SSN-REDACTED]")

      // Medical Record Numbers (MRN patterns)
      .replace(
        /\b(MRN|mrn|Medical Record|Patient ID)[\s:]*[\w-]+/gi,
        "[MRN-REDACTED]",
      )

      // Account/Invoice numbers that might contain patient identifiers
      .replace(
        /\b(Account|Acct|Invoice|Bill)[\s#:]*[\w-]{6,}/gi,
        "[ACCOUNT-REDACTED]",
      )

      // Phone numbers (various formats)
      .replace(
        /\b(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
        "[PHONE-REDACTED]",
      )

      // Email addresses
      .replace(
        /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/gi,
        "[EMAIL-REDACTED]",
      )

      // Dates of birth (various formats)
      .replace(
        // `-` is last in each class, so it stays literal and cannot open a
        // range. Verified identical to the previously escaped `[\/\-]` form
        // across the separator, label and near-miss cases.
        /\b(DOB|Date of Birth|Birth Date)[\s:]*\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/gi,
        "[DOB-REDACTED]",
      )

      // Insurance/Health Plan numbers
      .replace(
        /\b(Policy|Member|Subscriber|Group)[\s#:]*[\w-]{6,}/gi,
        "[INSURANCE-REDACTED]",
      )

      // IP addresses
      .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, "[IP-REDACTED]")

      // URLs with patient data
      .replace(/https?:\/\/[^\s]+/g, "[URL-REDACTED]")

      // File paths that might contain patient names
      .replace(/[A-Za-z]:\\[^\s]+/g, "[PATH-REDACTED]")
      .replace(/\/[a-z]+\/[^\s]+/gi, "[PATH-REDACTED]")

      // Names following common prefixes
      .replace(
        /\b(Patient|Name|Mr\.|Mrs\.|Ms\.|Dr\.)\s+[A-Z][a-z]+(\s+[A-Z][a-z]+)*/g,
        "[NAME-REDACTED]",
      )
  );
};

/**
 * Safe logging wrapper that sanitizes PHI
 * Use this instead of console.log for any data that might contain PHI
 */
export const safeLog = (message: string, data?: unknown) => {
  if (import.meta.env.DEV) {
    const sanitizedMessage = sanitizePHI(message);
    if (data) {
      const sanitizedData =
        typeof data === "string"
          ? sanitizePHI(data)
          : JSON.parse(sanitizePHI(JSON.stringify(data)));
      console.log(
        `[${new Date().toISOString()}] ${sanitizedMessage}`,
        sanitizedData,
      );
    } else {
      console.log(`[${new Date().toISOString()}] ${sanitizedMessage}`);
    }
  }
};

/**
 * Check if a value contains potential PHI
 * Returns true if PHI patterns are detected
 */
export const containsPHI = (value: string): boolean => {
  if (!value || typeof value !== "string") return false;

  const phiPatterns = [
    /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/, // SSN
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/i, // Email
    /\b(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/, // Phone
  ];

  return phiPatterns.some((pattern) => pattern.test(value));
};
