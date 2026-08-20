import { Button } from "@/components/ui/button";
import { Link, useNavigate } from "react-router-dom";
import { ReclaimLogo } from "./ReclaimLogo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Menu } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetClose,
} from "@/components/ui/sheet";
import { useState, useEffect } from "react";
import { analytics } from "@/lib/analytics";

export const Navigation = () => {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const closeMenu = () => setIsOpen(false);

  const handleNavClick = (path: string) => {
    closeMenu();
    if (path.startsWith("/#")) {
      // Handle hash navigation
      const element = document.querySelector(path.substring(1));
      element?.scrollIntoView({ behavior: "smooth" });
    } else {
      navigate(path);
    }
  };

  return (
    <nav
      className={`sticky top-0 z-50 border-b backdrop-blur transition-all duration-300 ${
        isScrolled
          ? "border-border/40 bg-card/95 supports-[backdrop-filter]:bg-card/90 shadow-md"
          : "border-border/20 bg-card/80"
      }`}
      aria-label="Main navigation"
    >
      <div className="container mx-auto flex h-14 sm:h-16 items-center justify-between px-4 sm:px-6">
        <Link to="/" className="cursor-pointer group" aria-label="Reclaim home">
          {/* Show full logo on desktop, icon only on mobile */}
          <div className="hidden md:block">
            <ReclaimLogo
              size="sm"
              showTagline
              className="transition-transform group-hover:scale-105"
            />
          </div>
          <div className="md:hidden">
            <ReclaimLogo
              variant="icon"
              size="sm"
              className="transition-transform group-hover:scale-110"
            />
          </div>
        </Link>

        {/* Desktop Navigation */}
        <nav
          className="hidden items-center gap-6 lg:gap-8 md:flex"
          aria-label="Primary navigation"
        >
          <a
            href="/#features"
            className="relative text-sm font-medium text-muted-foreground transition-colors hover:text-foreground after:absolute after:bottom-0 after:left-0 after:h-0.5 after:w-0 after:bg-primary after:transition-all after:duration-300 hover:after:w-full"
          >
            Features
          </a>
          <a
            href="/#how-it-works"
            className="relative text-sm font-medium text-muted-foreground transition-colors hover:text-foreground after:absolute after:bottom-0 after:left-0 after:h-0.5 after:w-0 after:bg-primary after:transition-all after:duration-300 hover:after:w-full"
          >
            How It Works
          </a>
          <a
            href="/#pricing"
            className="relative text-sm font-medium text-muted-foreground transition-colors hover:text-foreground after:absolute after:bottom-0 after:left-0 after:h-0.5 after:w-0 after:bg-primary after:transition-all after:duration-300 hover:after:w-full"
          >
            Pricing
          </a>
        </nav>

        {/* Desktop Auth Buttons */}
        <div
          className="hidden md:flex items-center gap-2 lg:gap-3"
          role="group"
          aria-label="Authentication"
        >
          <ThemeToggle />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              analytics.navigationClick("sign_in");
              navigate("/auth");
            }}
            className="text-sm"
          >
            Sign In
          </Button>
          <Button
            size="sm"
            onClick={() => {
              analytics.navigationClick("sign_up");
              navigate("/auth");
            }}
            className="text-sm"
          >
            Sign Up
          </Button>
        </div>

        {/* Mobile Hamburger Menu */}
        <Sheet open={isOpen} onOpenChange={setIsOpen}>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="md:hidden"
              aria-label="Open navigation menu"
              aria-expanded={isOpen}
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
            </Button>
          </SheetTrigger>
          <SheetContent
            side="right"
            className="w-[280px] sm:w-[360px]"
            aria-label="Mobile navigation menu"
          >
            <SheetHeader>
              <SheetTitle className="text-left text-base sm:text-lg">
                Menu
              </SheetTitle>
            </SheetHeader>

            <nav
              className="flex flex-col gap-4 sm:gap-6 mt-6 sm:mt-8"
              aria-label="Mobile navigation"
            >
              {/* Navigation Links */}
              <div className="flex flex-col gap-2 sm:gap-3">
                <SheetClose asChild>
                  <a
                    href="/#features"
                    onClick={(e) => {
                      e.preventDefault();
                      handleNavClick("/#features");
                    }}
                    className="text-base sm:text-lg font-medium text-foreground transition-all duration-150 hover:text-primary py-2 px-3 sm:px-4 rounded-md hover:bg-accent/5"
                  >
                    Features
                  </a>
                </SheetClose>

                <SheetClose asChild>
                  <a
                    href="/#how-it-works"
                    onClick={(e) => {
                      e.preventDefault();
                      handleNavClick("/#how-it-works");
                    }}
                    className="text-base sm:text-lg font-medium text-foreground transition-all duration-150 hover:text-primary py-2 px-3 sm:px-4 rounded-md hover:bg-accent/5"
                  >
                    How It Works
                  </a>
                </SheetClose>

                <SheetClose asChild>
                  <a
                    href="/#pricing"
                    onClick={(e) => {
                      e.preventDefault();
                      handleNavClick("/#pricing");
                    }}
                    className="text-base sm:text-lg font-medium text-foreground transition-all duration-150 hover:text-primary py-2 px-3 sm:px-4 rounded-md hover:bg-accent/5"
                  >
                    Pricing
                  </a>
                </SheetClose>
              </div>

              {/* Divider */}
              <div className="border-t border-border my-1 sm:my-2" />

              {/* Auth Buttons */}
              <div className="flex flex-col gap-2 sm:gap-3">
                <SheetClose asChild>
                  <Button
                    variant="ghost"
                    size="lg"
                    className="w-full text-sm sm:text-base"
                    onClick={() => {
                      analytics.navigationClick("sign_in_mobile");
                      closeMenu();
                      navigate("/auth");
                    }}
                  >
                    Sign In
                  </Button>
                </SheetClose>
                <SheetClose asChild>
                  <Button
                    size="lg"
                    className="w-full text-sm sm:text-base"
                    onClick={() => {
                      analytics.navigationClick("sign_up_mobile");
                      closeMenu();
                      navigate("/auth");
                    }}
                  >
                    Sign Up
                  </Button>
                </SheetClose>
              </div>
            </nav>
          </SheetContent>
        </Sheet>
      </div>
    </nav>
  );
};
