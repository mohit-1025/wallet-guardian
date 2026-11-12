import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_STATUS, getIntegrationStatus, type ApiStatus } from "./paypal";
import { useApp } from "./app-context";

interface IntegrationContextValue {
  status: ApiStatus;
  loading: boolean;
  refresh: () => void;
}

const IntegrationContext = createContext<IntegrationContextValue>({
  status: DEFAULT_STATUS,
  loading: true,
  refresh: () => {},
});

export function IntegrationProvider({ children }: { children: ReactNode }) {
  const { session } = useApp();
  const [status, setStatus] = useState<ApiStatus>(DEFAULT_STATUS);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    setLoading(true);
    getIntegrationStatus()
      .then(setStatus)
      .finally(() => setLoading(false));
  }, []);

  // Demo requests must report the sandbox status, so re-read it when the
  // account type changes (sign in, sign out, demo ↔ PayPal).
  useEffect(() => {
    refresh();
  }, [refresh, session?.provider, session?.userId]);

  const value = useMemo(() => ({ status, loading, refresh }), [status, loading, refresh]);

  return <IntegrationContext.Provider value={value}>{children}</IntegrationContext.Provider>;
}

export function useIntegration() {
  return useContext(IntegrationContext);
}
