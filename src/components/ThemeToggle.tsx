// Theme control. Two shapes for two places:
//
//   <ThemeToggle />      a single icon button that flips light <-> dark. For
//                        nav bars, where there is room for one control.
//   <ThemeToggleGroup /> the full three-way choice including "System". For
//                        Settings, where the user is deliberately choosing.
//
// The icon button shows the theme it will switch *to*, which is the
// convention people already know from every other app: a moon means "go
// dark", not "you are dark".

import { Moon, Sun, Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme, type ThemePreference } from "@/contexts/ThemeContext";
import { cn } from "@/lib/utils";

export function ThemeToggle({ className }: { className?: string }) {
  const { resolved, toggle } = useTheme();
  const goingTo = resolved === "dark" ? "light" : "dark";

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      className={className}
      aria-label={`Switch to ${goingTo} mode`}
      title={`Switch to ${goingTo} mode`}
    >
      {resolved === "dark" ? (
        <Sun className="h-4 w-4" aria-hidden="true" />
      ) : (
        <Moon className="h-4 w-4" aria-hidden="true" />
      )}
    </Button>
  );
}

const OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

/**
 * `fill` stretches the three options across whatever width the parent gives
 * (the phone menu's panel is narrower than the options' natural width).
 */
export function ThemeToggleGroup({ fill = false }: { fill?: boolean }) {
  const { preference, setPreference } = useTheme();

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className={cn(
        "rounded-lg border bg-muted/40 p-1 gap-1",
        fill ? "flex w-full" : "inline-flex",
      )}
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const active = preference === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setPreference(value)}
            className={cn(
              "flex items-center gap-1.5 rounded-md py-1.5 text-sm transition-colors",
              fill ? "min-w-0 flex-1 justify-center px-2" : "px-3",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            {label}
          </button>
        );
      })}
    </div>
  );
}
