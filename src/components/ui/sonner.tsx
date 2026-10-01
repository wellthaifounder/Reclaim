import { useTheme } from "next-themes";
import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      // pointer-events-auto: an open modal dialog sets pointer-events: none on
      // <body>, which the toaster inherits -- so a toast's action button
      // (Undo) could be seen but not pressed while any dialog was open.
      className="toaster group pointer-events-auto"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          warning:
            "group-[.toaster]:border-amber-300 group-[.toaster]:bg-amber-50 group-[.toaster]:text-amber-900 dark:group-[.toaster]:border-amber-700 dark:group-[.toaster]:bg-amber-950 dark:group-[.toaster]:text-amber-100",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
