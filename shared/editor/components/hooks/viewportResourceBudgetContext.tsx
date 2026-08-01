import * as React from "react";
import { ViewportResourceBudget } from "./viewportResourceBudget";

export interface ViewportResourceBudgetProviderProps {
  /** Child tree that may consume the viewport resource budget. */
  children: React.ReactNode;
  /** Whether a viewport resource budget is available to descendants. */
  enabled: boolean;
  /** Internal capacity override used by focused tests. */
  capacity?: number;
}

/** React context containing the nearest enabled viewport resource budget. */
export const ViewportResourceBudgetContext = React.createContext<
  ViewportResourceBudget | undefined
>(undefined);

/**
 * Provides one isolated viewport resource budget to its descendant tree.
 *
 * @param props - provider configuration and child tree.
 * @returns the configured context provider.
 */
export function ViewportResourceBudgetProvider({
  children,
  enabled,
  capacity = ViewportResourceBudget.defaultCapacity,
}: ViewportResourceBudgetProviderProps) {
  const budget = React.useMemo(
    () => (enabled ? new ViewportResourceBudget(capacity) : undefined),
    [capacity, enabled]
  );

  React.useEffect(
    () => () => {
      budget?.destroy();
    },
    [budget]
  );

  return (
    <ViewportResourceBudgetContext.Provider value={budget}>
      {children}
    </ViewportResourceBudgetContext.Provider>
  );
}

/**
 * Returns the viewport resource budget supplied by the nearest enabled provider.
 *
 * @returns the nearest budget, or undefined when budgeting is disabled.
 */
export function useViewportResourceBudget():
  | ViewportResourceBudget
  | undefined {
  return React.useContext(ViewportResourceBudgetContext);
}
