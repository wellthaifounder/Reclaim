/**
 * Reclaim Design System Tokens
 *
 * TypeScript constants for design tokens to ensure type safety and consistency
 * across the application. These should be used alongside Tailwind utilities.
 */

// Spacing Scale (8px base)
export const spacing = {
  0: "0",
  1: "0.25rem", // 4px
  2: "0.5rem", // 8px
  3: "0.75rem", // 12px
  4: "1rem", // 16px
  5: "1.5rem", // 24px
  6: "2rem", // 32px
  8: "3rem", // 48px
  10: "4rem", // 64px
} as const;

// Typography Scale
export const fontSize = {
  xs: "0.75rem", // 12px
  sm: "0.875rem", // 14px
  base: "1rem", // 16px
  lg: "1.125rem", // 18px
  xl: "1.25rem", // 20px
  "2xl": "1.5rem", // 24px
  "3xl": "1.875rem", // 30px
  "4xl": "2.25rem", // 36px
  "5xl": "3rem", // 48px
} as const;

// Line Heights
export const lineHeight = {
  none: 1,
  tight: 1.25,
  snug: 1.375,
  normal: 1.5,
  relaxed: 1.625,
  loose: 2,
} as const;

// Border Radii
export const borderRadius = {
  xs: "0.25rem", // 4px
  sm: "0.5rem", // 8px
  md: "0.75rem", // 12px
  lg: "1rem", // 16px
  xl: "1.5rem", // 24px
  full: "9999px", // pill
} as const;

// Shadow System
export const shadows = {
  xs: "0 1px 2px 0 rgba(0, 0, 0, 0.05)",
  sm: "0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1)",
  md: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)",
  lg: "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)",
  xl: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
} as const;

// Z-Index Hierarchy
export const zIndex = {
  base: 0,
  sidebar: 40,
  drag: 45,
  modal: 50,
  tooltip: 60,
  toast: 70,
} as const;

// Typography Utility Classes
export const typographyClasses = {
  h1: "text-4xl lg:text-5xl font-bold leading-tight tracking-tight font-heading",
  h2: "text-3xl lg:text-4xl font-bold leading-tight font-heading",
  h3: "text-2xl font-semibold leading-snug font-heading",
  h4: "text-xl font-semibold leading-snug font-heading",
  body: "text-base leading-relaxed",
  bodySmall: "text-sm leading-normal",
  label: "text-sm font-medium leading-none",
  caption: "text-xs leading-tight text-muted-foreground",
} as const;

// Spacing Utility Classes
export const spacingClasses = {
  sectionY: "py-16 lg:py-24", // Section vertical padding
  sectionX: "px-4 lg:px-6", // Section horizontal padding
  cardPadding: "p-6", // Card internal padding
  stackTight: "space-y-2", // Compact vertical stack
  stackNormal: "space-y-4", // Normal vertical stack
  stackLoose: "space-y-6", // Loose vertical stack
  gapTight: "gap-2", // Compact gap
  gapNormal: "gap-4", // Normal gap
  gapLoose: "gap-6", // Loose gap
} as const;

// Responsive Grid Patterns
export const gridClasses = {
  responsive2Col: "grid grid-cols-1 sm:grid-cols-2 gap-4 lg:gap-6",
  responsive3Col:
    "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-6",
  responsive4Col:
    "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6",
} as const;

// Transition Utilities
export const transitions = {
  fast: "transition-all duration-150",
  normal: "transition-all duration-200",
  slow: "transition-all duration-300",
  colors: "transition-colors duration-150",
  transform: "transition-transform duration-200",
} as const;

// Animation Utilities
export const animations = {
  fadeIn: "animate-in fade-in duration-200",
  slideInFromTop: "animate-in slide-in-from-top duration-300",
  slideInFromBottom: "animate-in slide-in-from-bottom duration-300",
  scaleIn: "animate-in zoom-in-95 duration-200",
} as const;

// Color Utility Functions
export const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

export const formatCurrencyDetailed = (amount: number): string => {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
};

export const formatPercentage = (
  value: number,
  decimals: number = 0,
): string => {
  return `${value.toFixed(decimals)}%`;
};
