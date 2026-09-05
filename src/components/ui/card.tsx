import * as React from "react";

import { cn } from "@/lib/utils";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Opt in to the hover lift + press-down feedback. Every card used to get
   * this unconditionally, including static display cards nobody can click --
   * which is exactly backwards: it told the user those cards were buttons.
   * Pass this only on a card that has an onClick of its own (checked against
   * every call site in the app: two live ones do, plus their own hover
   * styling already, so this is additive there, not a replacement).
   */
  interactive?: boolean;
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, interactive = false, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "rounded-lg border bg-card text-card-foreground",
        // Pure black at 5% opacity is, on a dark surface, a change of about
        // one RGB unit -- invisible. Light mode keeps it; dark mode drops it
        // and leans on the border + the lightness gap from --background
        // instead (see index.css).
        "shadow-[0_1px_3px_0_rgba(0,0,0,0.05)] dark:shadow-none",
        "transition-all duration-300 ease-out",
        interactive && [
          "cursor-pointer active:scale-[0.98]",
          "hover:-translate-y-1",
          // Light mode's lift shows in the shadow, same as before. Dark mode
          // can't use a black shadow for the same reason as above, so the
          // hover cue there is a brighter border instead.
          "hover:shadow-[0_8px_20px_0_rgba(0,0,0,0.1)]",
          "dark:hover:shadow-none dark:hover:border-primary/50",
        ],
        className,
      )}
      {...props}
    />
  ),
);
Card.displayName = "Card";

const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col space-y-1.5 p-6", className)}
    {...props}
  />
));
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn(
      "text-2xl font-semibold leading-none tracking-tight",
      className,
    )}
    {...props}
  />
));
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
));
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex items-center p-6 pt-0", className)}
    {...props}
  />
));
CardFooter.displayName = "CardFooter";

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardDescription,
  CardContent,
};
