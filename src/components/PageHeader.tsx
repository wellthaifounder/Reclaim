import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** A button or button group for the page's primary action. Stacks full-width
   * below the title on narrow screens instead of squeezing into a row next to
   * it -- the row-with-no-wrap layout this replaces is what clipped
   * "Upload Documents" and the Plaid connect button on a 390px phone. */
  action?: ReactNode;
  className?: string;
}

export const PageHeader = ({
  title,
  description,
  action,
  className,
}: PageHeaderProps) => (
  <div
    className={cn(
      "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",
      className,
    )}
  >
    <div className="min-w-0">
      <h1 className="text-3xl font-bold text-foreground">{title}</h1>
      {description && (
        <p className="text-muted-foreground mt-1">{description}</p>
      )}
    </div>
    {/* min-w-0 + a capped max-width, not sm:shrink-0: some actions (Plaid's
        connect button) carry a full paragraph of legal text alongside the
        button. shrink-0 held that paragraph at its unwrapped, one-line
        width -- over 1000px wide on a real desktop measurement -- and
        overflowed the page instead of wrapping. */}
    {action && (
      <div className="min-w-0 w-full sm:w-auto sm:max-w-sm">{action}</div>
    )}
  </div>
);
