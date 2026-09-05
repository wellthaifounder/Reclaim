import { ReclaimLogo } from "./ReclaimLogo";

export const Footer = () => {
  return (
    <footer className="border-t border-border bg-background" role="contentinfo">
      <div className="container mx-auto px-4 py-12">
        <div className="grid gap-8 md:grid-cols-4">
          <div className="md:col-span-2">
            <div className="mb-4">
              <ReclaimLogo size="sm" showTagline />
            </div>
            <p className="mb-4 text-sm text-muted-foreground">
              Your healthcare expense companion. Track medical spending,
              organize by episode of care, and maximize your HSA and FSA
              savings.
            </p>
            <p className="text-xs text-muted-foreground">
              © 2026 Reclaim. All rights reserved.
            </p>
          </div>

          <div>
            <h3 className="mb-4 text-sm font-semibold" id="footer-product">
              Product
            </h3>
            <nav aria-labelledby="footer-product">
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>
                  <a href="/#pricing" className="hover:text-foreground">
                    Pricing
                  </a>
                </li>
                <li>
                  <a href="/#how-it-works" className="hover:text-foreground">
                    How It Works
                  </a>
                </li>
              </ul>
            </nav>
          </div>

          <div>
            <h3 className="mb-4 text-sm font-semibold" id="footer-resources">
              Resources
            </h3>
            <nav aria-labelledby="footer-resources">
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>
                  <a href="/auth" className="hover:text-foreground">
                    Sign In
                  </a>
                </li>
                <li>
                  <a href="/privacy" className="hover:text-foreground">
                    Privacy Policy
                  </a>
                </li>
                <li>
                  <a href="/terms" className="hover:text-foreground">
                    Terms of Service
                  </a>
                </li>
              </ul>
            </nav>
          </div>
        </div>
      </div>
    </footer>
  );
};
