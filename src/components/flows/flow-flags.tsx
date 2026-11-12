import { useMemo } from "react";
import { AlertTriangle, Lightbulb, ShieldCheck, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/misc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAppData } from "@/lib/app-context";
import { flowFlags, type FlagSeverity } from "@/lib/flow-insights";
import { formatMoney } from "@/lib/money";
import type { FlowTab } from "@/lib/types";
import { cn } from "@/lib/utils";

const SEVERITY_META: Record<FlagSeverity, {
  label: string;
  icon: LucideIcon;
  badge: "danger" | "warning" | "secondary";
  tile: string;
}> = {
  critical: { label: "Act now", icon: AlertTriangle, badge: "danger", tile: "bg-danger-soft text-danger" },
  warning: { label: "Watch", icon: AlertTriangle, badge: "warning", tile: "bg-warning-soft text-warning" },
  info: { label: "Tip", icon: Lightbulb, badge: "secondary", tile: "bg-muted text-muted-foreground" },
};

export function FlowFlags({ tab, className }: { tab: FlowTab; className?: string }) {
  const data = useAppData();
  const currency = data.profile.currency;

  const flags = useMemo(() => flowFlags(data, tab), [data, tab]);
  const saving = flags.reduce((sum, flag) => sum + (flag.saving ?? 0), 0);

  return (
    <Card className={cn("flex flex-col", className)}>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-soft text-primary">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          <div>
            <CardTitle>Guardian flags</CardTitle>
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">Waste and optimisation checks for this tab</p>
          </div>
        </div>
        {saving > 0 && (
          <Badge variant="success">Save {formatMoney(saving, currency, { compact: true })}/yr</Badge>
        )}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col">
        {flags.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center py-8 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-success-soft text-success">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <p className="mt-3 text-[13px] font-semibold">Nothing to flag here</p>
            <p className="mt-1 max-w-[260px] text-[11.5px] leading-relaxed text-muted-foreground">
              No overdue dues, duplicates or price hikes detected in this tab. We keep checking as you add expenses.
            </p>
          </div>
        ) : (
          <div className="space-y-2 overflow-y-auto pr-0.5 lg:max-h-[420px]">
            {flags.map((flag) => {
              const meta = SEVERITY_META[flag.severity];
              const Icon = meta.icon;
              return (
                <div key={flag.id} className="flex gap-2.5 rounded-xl border border-border/70 p-2.5">
                  <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", meta.tile)}>
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="text-[12px] font-semibold leading-snug">{flag.title}</p>
                      <Badge variant={meta.badge}>{meta.label}</Badge>
                      {flag.saving ? (
                        <Badge variant="success">Save {formatMoney(flag.saving, currency, { compact: true })}/yr</Badge>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{flag.body}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
