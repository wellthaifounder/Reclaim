// Light / dark theme.
//
// The dark palette has been fully defined in index.css since long before this
// file existed, and Tailwind is configured with darkMode: ["class"] -- but
// nothing ever put that class on the document, so every `dark:` style in the
// app was unreachable. This provider is the missing half.
//
// Three states, not two. "system" follows the operating system and keeps
// following it, so a user whose laptop dims at sunset gets the same from
// Reclaim without having chosen anything. An explicit "light" or "dark" wins
// over the OS until they change it back.
//
// Stored in localStorage rather than the database: it is a device preference,
// not account data (a phone at night and a desktop at noon should be allowed
// to differ), and the project's rule is that non-sensitive UI state may live
// in localStorage. It is also read before React mounts -- see index.html --
// so the first paint is already the right colour instead of flashing white.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type ThemePreference = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "reclaim-theme";

interface ThemeContextValue {
  /** What the user chose, including "system". */
  preference: ThemePreference;
  /** What is actually on screen right now. Never "system". */
  resolved: ResolvedTheme;
  setPreference: (next: ThemePreference) => void;
  /** Flips between light and dark, resolving "system" to its opposite. */
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function readStoredPreference(): ThemePreference {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") return raw;
  } catch {
    // Private browsing and some embedded webviews throw on localStorage
    // access. A theme is not worth failing to render over.
  }
  return "system";
}

function systemPrefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches === true
  );
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreferenceState] =
    useState<ThemePreference>(readStoredPreference);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  // Follow the OS while the preference is "system". The listener stays
  // attached regardless so that switching back to "system" is immediate.
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const resolved: ResolvedTheme =
    preference === "system" ? (systemDark ? "dark" : "light") : preference;

  // The one line that makes every `dark:` class in the app do something.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", resolved === "dark");
    // Native form controls, scrollbars and the browser's own chrome read this
    // rather than the class, so they stay in step with the page.
    root.style.colorScheme = resolved;
  }, [resolved]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Preference simply will not persist. The session still works.
    }
  }, []);

  const toggle = useCallback(() => {
    setPreference(resolved === "dark" ? "light" : "dark");
  }, [resolved, setPreference]);

  const value = useMemo(
    () => ({ preference, resolved, setPreference, toggle }),
    [preference, resolved, setPreference, toggle],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
