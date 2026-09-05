import { forwardRef } from "react";
import { Link, LinkProps, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";

interface NavLinkProps extends LinkProps {
  activeClassName?: string;
  end?: boolean;
}

export const NavLink = forwardRef<HTMLAnchorElement, NavLinkProps>(
  (
    {
      to,
      className,
      activeClassName = "bg-sidebar-accent text-sidebar-accent-foreground",
      end = false,
      children,
      ...props
    },
    ref,
  ) => {
    const location = useLocation();
    const toPath = typeof to === "string" ? to : to.pathname;

    // A bare startsWith() lights up every item whose path is a string prefix
    // of the current one -- /substantiate matched /substantiation, so both
    // Substantiate and Reimburse looked active on the Reimburse page. Compare
    // whole path segments: the item is active on its own path or a child of
    // it, never on a sibling that merely shares an opening substring.
    const base = toPath || "";
    const isActive = end
      ? location.pathname === base
      : location.pathname === base ||
        location.pathname.startsWith(base.endsWith("/") ? base : base + "/");

    return (
      <Link
        ref={ref}
        to={to}
        className={cn(className, isActive && activeClassName)}
        {...props}
      >
        {children}
      </Link>
    );
  },
);

NavLink.displayName = "NavLink";
