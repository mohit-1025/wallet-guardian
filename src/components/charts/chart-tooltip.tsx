import { formatMoney } from "@/lib/money";
import type { Currency } from "@/lib/types";

export interface TooltipItem {
  name?: string | number;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
  payload?: Record<string, unknown>;
}

export function ChartTooltip({
  active,
  payload,
  label,
  currency,
  formatter,
  labelFormatter,
}: {
  active?: boolean;
  payload?: TooltipItem[];
  label?: string | number;
  currency: Currency;
  formatter?: (value: number, item: TooltipItem) => string;
  labelFormatter?: (label: string | number) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-[140px] rounded-xl border border-border bg-popover/95 p-3 text-popover-foreground shadow-lift backdrop-blur">
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {labelFormatter ? labelFormatter(label ?? "") : label}
      </p>
      <div className="space-y-1">
        {payload.map((item, i) => {
          const numeric = typeof item.value === "number" ? item.value : Number(item.value ?? 0);
          return (
            <div key={i} className="flex items-center justify-between gap-4 text-[12px]">
              <span className="flex items-center gap-1.5 capitalize text-muted-foreground">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} aria-hidden />
                {String(item.name ?? item.dataKey ?? "")}
              </span>
              <span className="tabular font-semibold">
                {formatter ? formatter(numeric, item) : formatMoney(numeric, currency, { compact: numeric >= 100000 })}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ChartSkeleton({ height = 220 }: { height?: number }) {
  return <div className="animate-pulse rounded-xl bg-muted/60" style={{ height }} />;
}

export const chartAxisProps = {
  tickLine: false,
  axisLine: false,
  tick: { fontSize: 11 },
} as const;
