import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight, BadgeCheck, Check, Copy, PackageSearch, Search, ShieldCheck, ShoppingBag,
  Sparkles, Store, Tag, Truck, Undo2,
} from "lucide-react";
import { toast } from "sonner";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PageHeader, Badge, EmptyState, InfoNote, Progress } from "@/components/ui/misc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { ChartTooltip } from "@/components/charts/chart-tooltip";
import { useAppData } from "@/lib/app-context";
import { bestPick, cheapestOffer, describePick, findProduct, scoreOffers, type ScoredPrice } from "@/lib/shopper";
import { daysUntil, fmtDate } from "@/lib/dates";
import { formatCompact, formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { Currency } from "@/lib/types";

function ScoreMeter({ label, value, weight }: { label: string; value: number; weight: number }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[10.5px] text-muted-foreground">
        <span>{label} <span className="opacity-70">· {Math.round(weight * 100)}%</span></span>
        <span className="tabular font-semibold text-foreground">{Math.round(value)}</span>
      </div>
      <Progress
        value={value}
        className="h-1.5"
        indicatorClassName={value >= 75 ? "bg-success" : value >= 45 ? "bg-warning" : "bg-danger"}
      />
    </div>
  );
}

function RetailerRow({
  offer,
  selected,
  best,
  cheapest,
  currency,
  onSelect,
}: {
  offer: ScoredPrice;
  selected: boolean;
  best: ScoredPrice | null;
  cheapest: ScoredPrice | null;
  currency: Currency;
  onSelect: () => void;
}) {
  const isBest = best?.id === offer.id;
  const isCheapest = cheapest?.id === offer.id;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "w-full rounded-xl border p-3.5 text-left transition-colors",
        selected
          ? "border-primary/40 bg-primary-soft/40 ring-1 ring-primary/20"
          : "border-border/70 bg-card hover:bg-muted/40",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-[13.5px] font-semibold">{offer.retailer}</span>
            {isBest && <Badge variant="success"><BadgeCheck />Best trusted & cheap</Badge>}
            {isCheapest && !isBest && <Badge variant="outline">Lowest total</Badge>}
            {!offer.inStock && <Badge variant="danger">Out of stock</Badge>}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1"><ShieldCheck className="h-3 w-3" />Trust {offer.trustScore}/100</span>
            <span className="flex items-center gap-1"><Truck className="h-3 w-3" />{offer.deliveryDays} day{offer.deliveryDays === 1 ? "" : "s"}</span>
            <span className="flex items-center gap-1"><Undo2 className="h-3 w-3" />{offer.returnDays}-day returns</span>
            <span className="flex items-center gap-1"><Store className="h-3 w-3" />★ {offer.rating.toFixed(1)}</span>
          </div>
        </div>
        <div className="text-right">
          <p className="tabular text-[15px] font-bold">{formatMoney(offer.total, currency)}</p>
          <p className="text-[10.5px] text-muted-foreground">
            {offer.shipping === 0 ? "Free delivery" : `incl. ${formatMoney(offer.shipping, currency)} shipping`}
          </p>
          <p className="mt-1 inline-flex items-center gap-1 text-[10.5px] font-semibold text-primary">
            <Sparkles className="h-3 w-3" />Score {offer.finalScore}/100
          </p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        <ScoreMeter label="Price" value={offer.costScore} weight={0.5} />
        <ScoreMeter label="Trust" value={offer.trustScore} weight={0.3} />
        <ScoreMeter label="Delivery" value={offer.deliveryScore} weight={0.1} />
        <ScoreMeter label="Returns" value={offer.returnScore} weight={0.1} />
      </div>
    </button>
  );
}

export default function ShopperPage() {
  const data = useAppData();
  const currency = data.profile.currency;
  const products = data.products;
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [retailerId, setRetailerId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.brand.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        p.tags.some((t) => t.includes(q) || q.includes(t)),
    );
  }, [products, query]);

  const selected = products.find((p) => p.id === selectedId) ?? filtered[0] ?? products[0] ?? null;

  const offers = useMemo(
    () => (selected ? data.prices.filter((p) => p.productId === selected.id) : []),
    [data.prices, selected],
  );
  const scored = useMemo(() => scoreOffers(offers), [offers]);
  const best = bestPick(scored);
  const cheapest = cheapestOffer(scored);
  const active = scored.find((s) => s.id === retailerId) ?? best;
  const history = active?.history ?? [];
  const historyData = history.map((price, i) => ({
    label: i === history.length - 1 ? "Now" : `${history.length - 1 - i}w`,
    price,
  }));
  const historyLow = history.length ? Math.min(...history) : 0;
  const historyHigh = history.length ? Math.max(...history) : 0;
  const saving = best && cheapest && best.id !== cheapest.id ? cheapest.total - best.total : 0;

  function submitSearch(e: FormEvent) {
    e.preventDefault();
    const match = findProduct(products, query);
    if (match) {
      setSelectedId(match.id);
      setRetailerId(null);
      return;
    }
    if (filtered[0]) {
      setSelectedId(filtered[0].id);
      setRetailerId(null);
      return;
    }
    toast.error("No product matches that search.");
  }

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      toast.success(`Copied ${code}`);
    } catch {
      toast.error("Clipboard is blocked in this browser. Select the code and copy it manually.");
    }
  }

  return (
    <div>
      <PageHeader
        title="Smart Shopper"
        description="Compare trusted retailers on more than price. The score mixes price, seller trust, delivery speed and returns — with every factor shown."
        eyebrow={<Badge variant="warning"><Tag />Demo data · not live prices</Badge>}
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link to="/app/guardian?tab=buy">Check affordability <ArrowRight /></Link>
          </Button>
        }
      />

      {products.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ShoppingBag />}
            title="No product catalog loaded"
            description="The comparison catalog ships with the demo data. Reset the demo data or create a sample workspace to load it."
            action={<Button asChild><Link to="/app/settings">Open settings</Link></Button>}
          />
        </Card>
      ) : (
        <div className="space-y-4">
          <Card>
            <CardContent className="p-4">
              <form onSubmit={submitSearch} className="flex flex-col gap-2 sm:flex-row">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search headphones, shoes, a brand or a category…"
                    className="pl-9"
                    aria-label="Search products"
                  />
                </div>
                <Button type="submit" className="sm:w-auto">Compare offers</Button>
              </form>
              <div className="mt-3 flex flex-wrap gap-2">
                {filtered.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setSelectedId(p.id);
                      setRetailerId(null);
                    }}
                    aria-pressed={selected?.id === p.id}
                    className={cn(
                      "flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors",
                      selected?.id === p.id
                        ? "border-primary/40 bg-primary-soft text-accent-foreground"
                        : "border-border bg-card text-muted-foreground hover:bg-muted/60",
                    )}
                  >
                    <span aria-hidden>{p.emoji}</span>
                    {p.name}
                  </button>
                ))}
              </div>
              {!filtered.length && (
                <p className="mt-3 text-[12px] text-muted-foreground">
                  Nothing matches “{query}”. Try “headphones”, “Nike” or “kitchen”.
                </p>
              )}
            </CardContent>
          </Card>

          {!selected || !best ? (
            <Card>
              <EmptyState
                icon={<PackageSearch />}
                title="No offers for this product"
                description="The demo catalog has no retailer quotes for this item yet. Pick another product above."
              />
            </Card>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-12">
                <Card className="md:col-span-7">
                  <CardHeader className="flex-row items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-muted text-xl" aria-hidden>
                        {selected.emoji}
                      </span>
                      <div className="min-w-0">
                        <CardTitle className="leading-snug">{selected.name}</CardTitle>
                        <p className="mt-0.5 text-[11.5px] text-muted-foreground">{selected.brand} · {selected.category}</p>
                      </div>
                    </div>
                    <Badge variant="outline">{scored.length} retailers</Badge>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-[12.5px] leading-relaxed text-muted-foreground">{selected.description}</p>
                    <div className="rounded-2xl border border-emerald-200/60 bg-emerald-50/60 p-4 dark:border-emerald-500/20 dark:bg-emerald-500/10">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 text-[12px] font-semibold text-emerald-900 dark:text-emerald-200">
                          <BadgeCheck className="h-4 w-4" />Guardian's pick
                        </span>
                        <span className="text-[11px] text-emerald-800/80 dark:text-emerald-200/70">
                          Score {best.finalScore}/100
                        </span>
                      </div>
                      <p className="mt-2 text-[14px] font-semibold text-emerald-950 dark:text-emerald-100">{best.retailer}</p>
                      <p className="tabular mt-0.5 text-[20px] font-bold text-emerald-900 dark:text-emerald-200">
                        {formatMoney(best.total, currency)}
                      </p>
                      <p className="mt-2 text-[12px] leading-relaxed text-emerald-900/80 dark:text-emerald-100/70">
                        {describePick(selected, scored, currency)}
                      </p>
                      {saving > 0 && (
                        <p className="mt-2 rounded-lg bg-white/60 px-2.5 py-1.5 text-[11px] font-medium text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
                          Paying {formatMoney(saving, currency)} more than the cheapest option buys {best.trustScore - (cheapest?.trustScore ?? 0)} more trust points.
                        </p>
                      )}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button size="sm" asChild>
                          <Link
                            to={`/app/guardian?tab=buy&item=${encodeURIComponent(selected.name)}&price=${best.total}`}
                          >
                            Can I afford this? <ArrowRight />
                          </Link>
                        </Button>
                        <Button size="sm" variant="outline" asChild>
                          <Link to="/app/wallet">Top up wallet</Link>
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="md:col-span-5">
                  <CardHeader className="flex-row items-center justify-between">
                    <CardTitle>Price history</CardTitle>
                    <span className="text-[11px] text-muted-foreground">9 weekly snapshots</span>
                  </CardHeader>
                  <CardContent>
                    <div className="mb-3 flex flex-wrap gap-1.5">
                      {scored.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => setRetailerId(s.id)}
                          aria-pressed={active?.id === s.id}
                          className={cn(
                            "rounded-full border px-2.5 py-1 text-[11px] transition-colors",
                            active?.id === s.id
                              ? "border-primary/40 bg-primary-soft font-semibold text-accent-foreground"
                              : "border-border text-muted-foreground hover:bg-muted/60",
                          )}
                        >
                          {s.retailer}
                        </button>
                      ))}
                    </div>
                    <div className="h-[180px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={historyData} margin={{ top: 6, right: 4, left: -18, bottom: 0 }}>
                          <defs>
                            <linearGradient id="shopperHistory" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#4f46e5" stopOpacity={0.25} />
                              <stop offset="100%" stopColor="#4f46e5" stopOpacity={0.02} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 4" />
                          <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 10 }} />
                          <YAxis
                            axisLine={false}
                            tickLine={false}
                            tick={{ fontSize: 10 }}
                            width={58}
                            domain={["dataMin - 200", "dataMax + 200"]}
                            tickFormatter={(v) => formatCompact(Number(v), currency)}
                          />
                          <Tooltip content={<ChartTooltip currency={currency} />} />
                          <Area
                            type="monotone"
                            dataKey="price"
                            name="Total price"
                            stroke="#4f46e5"
                            strokeWidth={2}
                            fill="url(#shopperHistory)"
                            dot={false}
                            activeDot={{ r: 4 }}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-lg bg-muted/50 px-2 py-1.5">
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Low</p>
                        <p className="tabular text-[12px] font-semibold">{formatMoney(historyLow, currency)}</p>
                      </div>
                      <div className="rounded-lg bg-muted/50 px-2 py-1.5">
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Now</p>
                        <p className="tabular text-[12px] font-semibold">{formatMoney(history[history.length - 1] ?? 0, currency)}</p>
                      </div>
                      <div className="rounded-lg bg-muted/50 px-2 py-1.5">
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">High</p>
                        <p className="tabular text-[12px] font-semibold">{formatMoney(historyHigh, currency)}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader className="flex-row items-center justify-between">
                  <div>
                    <CardTitle>All retailer offers</CardTitle>
                    <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                      Ranked by the transparent score. Select a retailer to chart its history.
                    </p>
                  </div>
                  <span className="hidden items-center gap-1 text-[11px] text-muted-foreground sm:flex">
                    <Check className="h-3 w-3 text-success" />Stock per demo quote
                  </span>
                </CardHeader>
                <CardContent className="space-y-2.5">
                  {scored.map((offer) => (
                    <RetailerRow
                      key={offer.id}
                      offer={offer}
                      selected={active?.id === offer.id}
                      best={best}
                      cheapest={cheapest}
                      currency={currency}
                      onSelect={() => setRetailerId(offer.id)}
                    />
                  ))}
                  <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px] text-muted-foreground">
                    <Badge variant="outline">Rank 1 = best mix</Badge>
                    <span>Price 50% · Trust 30% · Delivery 10% · Returns 10%, normalised within these offers.</span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><Tag className="h-4 w-4 text-primary" />Offers worth a look</CardTitle>
                  <p className="text-[11.5px] text-muted-foreground">
                    Sample merchant offers, matched to your recent spending patterns in the demo data.
                  </p>
                </CardHeader>
                <CardContent className="grid gap-3 sm:grid-cols-2">
                  {data.offers.map((offer) => {
                    const days = daysUntil(offer.expiresAt);
                    return (
                      <div key={offer.id} className="rounded-xl border border-border/70 bg-card p-3.5">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-[12.5px] font-semibold">{offer.title}</p>
                            <p className="text-[11px] text-muted-foreground">{offer.merchant} · {offer.category}</p>
                          </div>
                          <Badge variant="success">{offer.discount}</Badge>
                        </div>
                        <p className="mt-2 text-[11.5px] leading-relaxed text-muted-foreground">{offer.description}</p>
                        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[10.5px] text-muted-foreground">
                            {days < 0 ? "Expired" : `Expires ${fmtDate(offer.expiresAt)}${offer.minSpend ? ` · min ${formatMoney(offer.minSpend, currency)}` : ""}`}
                          </span>
                          {offer.code && (
                            <Button size="sm" variant="outline" onClick={() => copyCode(offer.code!)}>
                              <Copy /> {offer.code}
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>

              <InfoNote icon={<ShieldCheck />}>
                <span className="font-semibold text-foreground">Why you can trust this screen: </span>
                every number comes from the sample price catalog, and the ranking formula is shown on each offer. There are no affiliate links and no sponsored placements. Prices, stock and delivery estimates are demo data, not live quotes.
              </InfoNote>
            </>
          )}
        </div>
      )}
    </div>
  );
}
