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

    const isActive = end
      ? location.pathname === toPath
      : location.pathname.startsWith(toPath || "");

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
