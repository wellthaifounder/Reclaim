/**
 * ReclaimLogo Component
 *
 * Text-only wordmark for the Reclaim soft launch. The bespoke mark is a
 * post-soft-launch item — see docs/branding/reclaim-logo-brief.md. Until then
 * we ship a clean typographic wordmark so nothing reads "Wellth".
 *
 * The prop surface is unchanged from the former WellthLogo so call sites only
 * needed an import rename. The "icon" variant renders an "R" monogram (used in
 * mobile nav where horizontal space is tight); "wordmark"/"full" render the
 * "Reclaim" wordmark.
 *
 * VARIANTS:
 * - full: Wordmark (default). No separate icon while we're text-only.
 * - icon: "R" monogram only (mobile navigation).
 * - wordmark: Wordmark only.
 *
 * COLOR MODES:
 * - color: brand ink (inherits --secondary). Default.
 * - monochrome: inherits current text color.
 * - white: for dark backgrounds.
 *
 * SIZING: sm (mobile nav) · md (desktop nav) · lg (hero) · xl (splash).
 */

interface ReclaimLogoProps {
  variant?: "full" | "icon" | "wordmark";
  colorMode?: "color" | "monochrome" | "white";
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
  showTagline?: boolean;
}

export const ReclaimLogo = ({
  variant = "full",
  colorMode = "color",
  size = "md",
  className = "",
  showTagline = false,
}: ReclaimLogoProps) => {
  // The brand ink (--secondary) is a deep navy chosen against a light page.
  // In dark mode that token is 25% lightness sitting on a 12% background, so
  // the wordmark all but disappeared -- invisible until the theme toggle
  // shipped and dark mode became reachable. Fall back to --foreground there,
  // which is defined to contrast with the page in whichever theme is active.
  const textColor =
    colorMode === "white"
      ? "text-white"
      : colorMode === "monochrome"
        ? "text-current"
        : "text-secondary dark:text-foreground";

  const wordmarkSize =
    size === "sm"
      ? "text-xl"
      : size === "md"
        ? "text-2xl"
        : size === "lg"
          ? "text-4xl"
          : "text-5xl";

  const taglineSize =
    size === "sm"
      ? "text-[10px] -mt-1"
      : size === "md"
        ? "text-xs -mt-1"
        : "text-sm -mt-1.5";

  const monogramSize =
    size === "sm"
      ? "h-5 w-5 text-sm"
      : size === "md"
        ? "h-8 w-8 text-lg"
        : size === "lg"
          ? "h-12 w-12 text-2xl"
          : "h-16 w-16 text-3xl";

  const renderMonogram = () => (
    <span
      className={`inline-flex items-center justify-center rounded-lg font-heading font-bold transition-transform hover:scale-105 ${monogramSize} ${
        colorMode === "white"
          ? "bg-white/15 text-white"
          : colorMode === "monochrome"
            ? "border border-current text-current"
            : "bg-primary text-primary-foreground"
      }`}
      aria-hidden="true"
    >
      R
    </span>
  );

  const renderWordmark = () => (
    <div className="flex flex-col">
      <span className={`font-heading font-bold ${textColor} ${wordmarkSize}`}>
        Reclaim
      </span>
      {showTagline && (
        <span
          className={`${
            colorMode === "white" ? "text-white/70" : "text-muted-foreground"
          } ${taglineSize}`}
        >
          Reclaim what's yours.
        </span>
      )}
    </div>
  );

  if (variant === "icon") {
    return <div className={className}>{renderMonogram()}</div>;
  }

  // "wordmark" and "full" both render the wordmark while we're text-only.
  return <div className={className}>{renderWordmark()}</div>;
};
