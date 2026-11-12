import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeftRight, ArrowRight, BarChart3, BellRing, CalendarClock, CreditCard, LayoutDashboard,
  ReceiptText, Repeat, Search, Settings, ShoppingBag, Sparkles, Target, Wallet,
} from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useAppData } from "@/lib/app-context";
import { type Currency } from "@/lib/types";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

interface Item {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: typeof LayoutDashboard;
  run: () => void;
}

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const data = useAppData();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const currency: Currency = data.profile.currency;

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(0);
      window.setTimeout(() => inputRef.current?.focus(), 60);
    }
  }, [open]);

  const go = (path: string) => {
    onOpenChange(false);
    navigate(path);
  };

  const items = useMemo<Item[]>(() => {
    const actions: Item[] = [
      { id: "ask", group: "Quick actions", label: "Ask the Guardian", hint: "Grounded in your data", icon: Sparkles, run: () => go("/app/guardian") },
      { id: "shopper", group: "Quick actions", label: "Compare a product", hint: "Smart Shopper", icon: ShoppingBag, run: () => go("/app/shopper") },
    ];
    const nav: Item[] = [
      { id: "dash", group: "Go to", label: "Dashboard", icon: LayoutDashboard, run: () => go("/app") },
      { id: "tx", group: "Go to", label: "Transactions", icon: ArrowLeftRight, run: () => go("/app/transactions") },
      { id: "budget", group: "Go to", label: "Smart budget", icon: Wallet, run: () => go("/app/budget") },
      { id: "goals", group: "Go to", label: "Savings goals", icon: Target, run: () => go("/app/goals") },
      { id: "analytics", group: "Go to", label: "Analytics", icon: BarChart3, run: () => go("/app/analytics") },
      { id: "subs", group: "Go to", label: "Subscriptions", icon: Repeat, run: () => go("/app/flows/subscriptions") },
      { id: "bills", group: "Go to", label: "Bills & tickets", icon: ReceiptText, run: () => go("/app/flows/bills") },
      { id: "rem", group: "Go to", label: "Reminders", icon: BellRing, run: () => go("/app/reminders") },
      { id: "autopay", group: "Go to", label: "Autopay", icon: CalendarClock, run: () => go("/app/flows/autopay") },
      { id: "wallet", group: "Go to", label: "Wallet & PayPal", icon: CreditCard, run: () => go("/app/wallet") },
      { id: "settings", group: "Go to", label: "Settings", icon: Settings, run: () => go("/app/settings") },
    ];
    const q = query.trim().toLowerCase();
    const txItems: Item[] = q
      ? data.transactions
          .filter((t) => !q || t.merchant.toLowerCase().includes(q) || t.notes?.toLowerCase().includes(q))
          .slice(0, 5)
          .map((t) => ({
            id: `tx-${t.id}`,
            group: "Transactions",
            label: t.merchant,
            hint: `${t.type === "income" ? "+" : "−"}${formatMoney(t.amount, currency)} · ${t.date}`,
            icon: ArrowLeftRight,
            run: () => go(`/app/transactions?q=${encodeURIComponent(t.merchant)}`),
          }))
      : [];
    const all = [...actions, ...nav, ...txItems];
    if (!q) return all.slice(0, 14);
    return all.filter((i) => `${i.label} ${i.hint ?? ""} ${i.group}`.toLowerCase().includes(q)).slice(0, 14);
  }, [data.transactions, query, currency]);

  useEffect(() => setSelected(0), [query]);

  const groups = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const item of items) {
      if (!map.has(item.group)) map.set(item.group, []);
      map.get(item.group)!.push(item);
    }
    return [...map.entries()];
  }, [items]);

  let flatIndex = -1;

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => (items.length ? (s + 1) % items.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => (items.length ? (s - 1 + items.length) % items.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      items[selected]?.run();
    }
  }

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${selected}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent hideClose className="!bottom-auto !top-[8%] !max-h-[80vh] !translate-y-0 !rounded-3xl p-0 sm:!top-[14%] sm:!w-[min(94vw,600px)]">
        <div className="flex items-center gap-3 border-b border-border/70 px-4 py-3.5">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search pages, actions or transactions…"
            aria-label="Command palette search"
            className="h-6 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
            role="combobox"
            aria-expanded
            aria-controls="command-list"
            aria-activedescendant={items[selected] ? `cmd-${items[selected].id}` : undefined}
          />
          <kbd className="hidden rounded-md border border-border bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground sm:block">ESC</kbd>
        </div>
        <div ref={listRef} id="command-list" role="listbox" className="max-h-[52vh] overflow-y-auto p-2">
          {groups.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="text-[13px] font-semibold">No matches</p>
              <p className="mt-1 text-[12px] text-muted-foreground">Try a merchant name, page or action.</p>
            </div>
          ) : (
            groups.map(([group, groupItems]) => (
              <div key={group} className="mb-1">
                <p className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{group}</p>
                {groupItems.map((item) => {
                  flatIndex += 1;
                  const idx = flatIndex;
                  const active = idx === selected;
                  return (
                    <button
                      key={item.id}
                      id={`cmd-${item.id}`}
                      data-index={idx}
                      role="option"
                      aria-selected={active}
                      onMouseEnter={() => setSelected(idx)}
                      onClick={item.run}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors",
                        active ? "bg-accent text-accent-foreground" : "text-foreground hover:bg-muted/70",
                      )}
                    >
                      <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
                        <item.icon className="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium">{item.label}</span>
                        {item.hint && <span className="block truncate text-[11px] text-muted-foreground">{item.hint}</span>}
                      </span>
                      {active && <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
        <div className="flex items-center justify-between border-t border-border/70 px-4 py-2.5 text-[10.5px] text-muted-foreground">
          <span className="flex items-center gap-3">
            <span><kbd className="rounded border border-border bg-muted px-1 py-0.5">↑</kbd> <kbd className="rounded border border-border bg-muted px-1 py-0.5">↓</kbd> navigate</span>
            <span><kbd className="rounded border border-border bg-muted px-1 py-0.5">↵</kbd> open</span>
          </span>
          <span className="hidden sm:inline">activity syncs from PayPal</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
