import {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from "react";

export interface DashboardCard {
  id: string;
  title: string;
  defaultVisible: boolean;
  category: "overview" | "bills" | "hsa" | "transactions";
}

export const DASHBOARD_CARDS: DashboardCard[] = [
  {
    id: "quick-actions",
    title: "Quick Actions",
    defaultVisible: true,
    category: "overview",
  },
  {
    id: "value-spotlight",
    title: "Value Spotlight",
    defaultVisible: true,
    category: "overview",
  },
  {
    id: "key-metrics",
    title: "Key Metrics",
    defaultVisible: true,
    category: "overview",
  },
  {
    id: "recent-bills",
    title: "Recent Medical Bills",
    defaultVisible: true,
    category: "overview",
  },
  {
    id: "progress-tracker",
    title: "Progress Tracker",
    defaultVisible: true,
    category: "overview",
  },
  {
    id: "pending-reviews",
    title: "Bills Requiring Review",
    defaultVisible: true,
    category: "bills",
  },
  {
    id: "active-disputes",
    title: "Active Disputes",
    defaultVisible: true,
    category: "bills",
  },
  {
    id: "provider-insights",
    title: "Provider Insights",
    defaultVisible: true,
    category: "bills",
  },
  {
    id: "hsa-claimable",
    title: "Available to Claim",
    defaultVisible: true,
    category: "hsa",
  },
  {
    id: "hsa-tax-savings",
    title: "Tax Savings",
    defaultVisible: true,
    category: "hsa",
  },
  {
    id: "reimbursement-requests",
    title: "Reimbursement Requests",
    defaultVisible: true,
    category: "hsa",
  },
  {
    id: "investment-vault",
    title: "Investment Vault",
    defaultVisible: true,
    category: "hsa",
  },
  {
    id: "hsa-eligibility",
    title: "HSA Eligibility Reference",
    defaultVisible: true,
    category: "hsa",
  },
  {
    id: "transactions-review",
    title: "Transactions to Review",
    defaultVisible: true,
    category: "transactions",
  },
  {
    id: "bank-connections",
    title: "Bank Connections",
    defaultVisible: true,
    category: "transactions",
  },
  {
    id: "recent-expenses",
    title: "Recent Expenses",
    defaultVisible: true,
    category: "transactions",
  },
];

interface DashboardLayoutState {
  cardOrder: string[];
  visibleCards: Set<string>;
  isCustomizing: boolean;
}

interface DashboardLayoutContextType extends DashboardLayoutState {
  setCardOrder: (order: string[]) => void;
  toggleCardVisibility: (cardId: string) => void;
  setIsCustomizing: (isCustomizing: boolean) => void;
  resetLayout: () => void;
  isCardVisible: (cardId: string) => boolean;
  getVisibleCardsForCategory: (category: string) => string[];
}

const STORAGE_KEY = "wellth_dashboard_layout";

const getDefaultState = (): DashboardLayoutState => ({
  cardOrder: DASHBOARD_CARDS.map((card) => card.id),
  visibleCards: new Set(
    DASHBOARD_CARDS.filter((c) => c.defaultVisible).map((c) => c.id),
  ),
  isCustomizing: false,
});

const DashboardLayoutContext = createContext<
  DashboardLayoutContextType | undefined
>(undefined);

export function DashboardLayoutProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DashboardLayoutState>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        return {
          ...getDefaultState(),
          cardOrder: parsed.cardOrder || getDefaultState().cardOrder,
          visibleCards: new Set(parsed.visibleCards || []),
        };
      } catch {
        return getDefaultState();
      }
    }
    return getDefaultState();
  });

  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        cardOrder: state.cardOrder,
        visibleCards: Array.from(state.visibleCards),
      }),
    );
  }, [state.cardOrder, state.visibleCards]);

  const setCardOrder = (order: string[]) => {
    setState((prev) => ({ ...prev, cardOrder: order }));
  };

  const toggleCardVisibility = (cardId: string) => {
    setState((prev) => {
      const newVisible = new Set(prev.visibleCards);
      if (newVisible.has(cardId)) {
        newVisible.delete(cardId);
      } else {
        newVisible.add(cardId);
      }
      return { ...prev, visibleCards: newVisible };
    });
  };

  const setIsCustomizing = (isCustomizing: boolean) => {
    setState((prev) => ({ ...prev, isCustomizing }));
  };

  const resetLayout = () => {
    setState(getDefaultState());
    localStorage.removeItem(STORAGE_KEY);
  };

  const isCardVisible = (cardId: string) => {
    return state.visibleCards.has(cardId);
  };

  const getVisibleCardsForCategory = (category: string) => {
    const categoryCards = DASHBOARD_CARDS.filter(
      (card) => card.category === category,
    ).map((card) => card.id);

    return state.cardOrder.filter(
      (id) => categoryCards.includes(id) && state.visibleCards.has(id),
    );
  };

  return (
    <DashboardLayoutContext.Provider
      value={{
        ...state,
        setCardOrder,
        toggleCardVisibility,
        setIsCustomizing,
        resetLayout,
        isCardVisible,
        getVisibleCardsForCategory,
      }}
    >
      {children}
    </DashboardLayoutContext.Provider>
  );
}

export function useDashboardLayout() {
  const context = useContext(DashboardLayoutContext);
  if (context === undefined) {
    throw new Error(
      "useDashboardLayout must be used within a DashboardLayoutProvider",
    );
  }
  return context;
}
