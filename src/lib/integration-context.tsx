import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DEFAULT_STATUS, consumeIncomingTransfers, fetchIncomingTransfers, getIntegrationStatus, type ApiStatus } from "./paypal";
import { guessCategory } from "./categories";
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

const TRANSFER_POLL_MS = 60_000;

export function IntegrationProvider({ children }: { children: ReactNode }) {
  const { session, data, addTransactions, adjustWallet, pushNotification } = useApp();
  const [status, setStatus] = useState<ApiStatus>(DEFAULT_STATUS);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    setLoading(true);
    getIntegrationStatus()
      .then(setStatus)
      .finally(() => setLoading(false));
  }, []);

  // Demo requests must report the sandbox status, so re-read it when the
  // account type changes (sign in, sign out, demo ↔ email account).
  useEffect(() => {
    refresh();
  }, [refresh, session?.provider, session?.userId]);

  // Incoming internal transfers: when another Wallet Guardian account pays this
  // account's email, the server queues a credit. Poll, register the income
  // row, bump the wallet and consume — exactly once per transfer.
  const collectTransfers = useCallback(async () => {
    if (!data || !session || session.provider === "demo") return;
    try {
      const transfers = await fetchIncomingTransfers();
      if (!transfers.length) return;
      addTransactions(
        transfers.map((t) => {
          // The sender's note is the only info source: if it doesn't match a
          // known category pattern the row stays under Others with an Add
          // info tag until the receiver categorises it.
          const guess = guessCategory(`${t.note} ${t.fromName}`, "income");
          const categorized = guess.confidence >= 0.5;
          return {
            type: "income" as const,
            amount: Math.round(t.amountInr),
            categoryId: categorized ? guess.categoryId : "cat_other",
            merchant: t.fromName || t.fromEmail,
            date: t.createdAt.slice(0, 10),
            paymentMethod: "PayPal",
            notes: t.note || `Payment from ${t.fromEmail} (Wallet Guardian transfer)`,
            source: "paypal" as const,
            channel: "paypal" as const,
            needsInfo: !categorized,
          };
        }),
      );
      for (const t of transfers) {
        adjustWallet(Math.round(t.amountInr));
        pushNotification({
          kind: "transfer_received",
          title: "Money received",
          body: `${t.fromName || t.fromEmail} sent you ₹${Math.round(t.amountInr).toLocaleString("en-IN")}${t.note ? ` — ${t.note}` : "."}`,
        });
      }
      await consumeIncomingTransfers(transfers.map((t) => t.id));
    } catch {
      // Transfers stay queued server-side; the next poll retries.
    }
  }, [data, session, addTransactions, adjustWallet, pushNotification]);

  const collectRef = useRef(collectTransfers);
  collectRef.current = collectTransfers;

  useEffect(() => {
    if (!session || session.provider === "demo") return;
    void collectRef.current();
    const timer = window.setInterval(() => void collectRef.current(), TRANSFER_POLL_MS);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.provider, session?.userId]);

  const value = useMemo<IntegrationContextValue>(
    () => ({ status, loading, refresh }),
    [status, loading, refresh],
  );

  return <IntegrationContext.Provider value={value}>{children}</IntegrationContext.Provider>;
}

export function useIntegration() {
  return useContext(IntegrationContext);
}
