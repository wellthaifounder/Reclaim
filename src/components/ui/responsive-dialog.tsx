import * as React from "react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";

interface ResponsiveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}

/**
 * Renders a Dialog on desktop and a Drawer on mobile.
 * Use ResponsiveDialogHeader/Title/Description/Footer/Body inside.
 */
export function ResponsiveDialog({
  open,
  onOpenChange,
  children,
}: ResponsiveDialogProps) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="max-h-[85vh]">{children}</DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>{children}</DialogContent>
    </Dialog>
  );
}

export function ResponsiveDialogHeader({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const isMobile = useIsMobile();
  const Comp = isMobile ? DrawerHeader : DialogHeader;
  return <Comp className={className}>{children}</Comp>;
}

export function ResponsiveDialogTitle({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const isMobile = useIsMobile();
  const Comp = isMobile ? DrawerTitle : DialogTitle;
  return <Comp className={className}>{children}</Comp>;
}

export function ResponsiveDialogDescription({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const isMobile = useIsMobile();
  const Comp = isMobile ? DrawerDescription : DialogDescription;
  return <Comp className={className}>{children}</Comp>;
}

export function ResponsiveDialogFooter({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const isMobile = useIsMobile();
  const Comp = isMobile ? DrawerFooter : DialogFooter;
  return <Comp className={className}>{children}</Comp>;
}

export function ResponsiveDialogBody({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  // `className ?? default` used to mean any caller who passed one — even
  // just to add spacing between rows — replaced the whole default and lost
  // overflow-y-auto with it. That was invisible on desktop, where
  // DialogContent's own max-h-[90vh] overflow-y-auto scrolls the header,
  // body and footer together as one block. It was not invisible in the
  // Drawer this same component renders below the 768px breakpoint: a
  // split-screened or narrow browser window crosses that width long before
  // it's actually "mobile", and DrawerContent (src/components/ui/drawer.tsx)
  // has no scroll behavior of its own — capped to max-h-[85vh] by the
  // ResponsiveDialog wrapper, but with nothing to scroll inside it, so
  // content past that height was simply clipped, taking the footer's
  // Cancel/Create buttons with it. flex-1 min-h-0 gives this div the
  // remaining space inside DrawerContent's flex column (a no-op in the grid
  // -based Dialog, which never needed it) so overflow-y-auto has somewhere
  // to take effect, and header/footer stay pinned in view while this
  // scrolls.
  return (
    <div className={cn("min-h-0 flex-1 overflow-y-auto px-4 pb-4", className)}>
      {children}
    </div>
  );
}
