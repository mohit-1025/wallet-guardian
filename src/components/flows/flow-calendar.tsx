import { useMemo, useState } from "react";
import { CalendarDays, CalendarX, ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/misc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/ui/money";
import { useAppData } from "@/lib/app-context";
import {
  fmtDate, format, monthDays, monthKey, monthLabel, nextMonthKey, parseISO, previousMonthKey,
  relativeDue, todayISO,
} from "@/lib/dates";
import { flowCalendarEvents, type FlowCalendarEvent, type FlowEventKind } from "@/lib/flow-insights";
import type { FlowTab } from "@/lib/types";
import { cn } from "@/lib/utils";

const KIND_META: Record<FlowEventKind, {
  label: string;
  dot: string;
  chip: string;
  badge: "secondary" | "warning" | "danger" | "success";
}> = {
  overdue: { label: "Overdue", dot: "bg-rose-500", chip: "bg-danger-soft text-danger", badge: "danger" },
  dueSoon: { label: "Due soon", dot: "bg-amber-500", chip: "bg-warning-soft text-warning", badge: "warning" },
  upcoming: { label: "Upcoming", dot: "bg-indigo-500", chip: "bg-primary-soft/70 text-accent-foreground", badge: "secondary" },
  paid: { label: "Paid", dot: "bg-emerald-500", chip: "bg-success-soft/70 text-success", badge: "success" },
};

const KIND_ORDER: FlowEventKind[] = ["overdue", "dueSoon", "upcoming", "paid"];

export function FlowCalendar({ tab, className }: { tab: FlowTab; className?: string }) {
  const data = useAppData();
  const currency = data.profile.currency;

  const [month, setMonth] = useState(() => monthKey());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const events = useMemo(() => flowCalendarEvents(data, tab), [data, tab]);

  const byDate = useMemo(() => {
    const map = new Map<string, FlowCalendarEvent[]>();
    for (const event of events) map.set(event.date, [...(map.get(event.date) ?? []), event]);
    return map;
  }, [events]);

  const monthEvents = useMemo(
    () => events.filter((e) => e.date.startsWith(month)).sort((a, b) => a.date.localeCompare(b.date)),
    [events, month],
  );

  const counts = useMemo(() => {
    const result: Record<FlowEventKind, number> = { overdue: 0, dueSoon: 0, upcoming: 0, paid: 0 };
    for (const event of monthEvents) result[event.kind] += 1;
    return result;
  }, [monthEvents]);

  const calendar = useMemo(() => {
    const days = monthDays(month);
    const pad = (parseISO(`${month}-01`).getDay() + 6) % 7;
    const cells: (Date | null)[] = [...Array.from({ length: pad }, () => null), ...days];
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [month]);

  const visible = selectedDate
    ? (byDate.get(selectedDate) ?? []).sort((a, b) => a.name.localeCompare(b.name))
    : monthEvents;
  const visibleTitle = selectedDate ? `On ${fmtDate(selectedDate, "d MMM yyyy")}` : `In ${monthLabel(month, true)}`;

  function shiftMonth(delta: number) {
    setMonth(delta < 0 ? previousMonthKey(month) : nextMonthKey(month));
    setSelectedDate(null);
  }

  return (
    <Card className={cn("flex flex-col", className)}>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <div>
          <CardTitle>{monthLabel(month)}</CardTitle>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">
            Dues, upcoming, paid and overdue dates for {monthLabel(month, true)}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon-sm" aria-label="Previous month" onClick={() => shiftMonth(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => { setMonth(monthKey()); setSelectedDate(null); }}>
            Today
          </Button>
          <Button variant="outline" size="icon-sm" aria-label="Next month" onClick={() => shiftMonth(1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col">
        <div className="grid grid-cols-7 gap-1 text-center">
          {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
            <div key={`${d}-${i}`} className="pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{d}</div>
          ))}
          {calendar.map((day, idx) => {
            if (!day) return <div key={`pad-${idx}`} className="min-h-[64px] rounded-lg bg-muted/20 sm:min-h-[80px]" />;
            const iso = format(day, "yyyy-MM-dd");
            const dayEvents = byDate.get(iso) ?? [];
            const isToday = iso === todayISO();
            const isSelected = iso === selectedDate;
            const hasOverdue = dayEvents.some((e) => e.kind === "overdue");
            const hasDueSoon = dayEvents.some((e) => e.kind === "dueSoon");
            return (
              <button
                key={iso}
                type="button"
                onClick={() => setSelectedDate(isSelected ? null : iso)}
                aria-label={`${fmtDate(iso, "d MMMM")}${dayEvents.length ? `, ${dayEvents.length} ${dayEvents.length === 1 ? "expense" : "expenses"}` : ", nothing due"}`}
                aria-pressed={isSelected}
                className={cn(
                  "min-h-[64px] rounded-lg border p-1 text-left transition-colors sm:min-h-[80px] sm:p-1.5",
                  isSelected ? "border-primary/60 bg-primary-soft/40 ring-2 ring-primary/20" : "border-border/50 hover:border-primary/30 hover:bg-muted/30",
                )}
              >
                <span className={cn(
                  "inline-flex h-5 w-5 items-center justify-center rounded-full text-[10.5px] font-semibold tabular",
                  isToday ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                )}>
                  {day.getDate()}
                </span>
                <span className="mt-0.5 hidden flex-col gap-0.5 sm:flex">
                  {dayEvents.slice(0, 2).map((event) => (
                    <span key={event.id} className={cn("truncate rounded px-1 py-0.5 text-[9px] font-medium leading-tight", KIND_META[event.kind].chip)}>
                      {event.name}
                    </span>
                  ))}
                  {dayEvents.length > 2 && <span className="px-1 text-[9px] text-muted-foreground">+{dayEvents.length - 2} more</span>}
                </span>
                <span className="mt-1 flex items-center gap-1 sm:hidden">
                  {dayEvents.length > 0 && (
                    <span className={cn("h-1.5 w-1.5 rounded-full", hasOverdue ? "bg-rose-500" : hasDueSoon ? "bg-amber-500" : "bg-indigo-500")} />
                  )}
                  {dayEvents.length > 1 && <span className="text-[9px] text-muted-foreground">+{dayEvents.length - 1}</span>}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[10.5px] text-muted-foreground">
          {KIND_ORDER.map((kind) => (
            <span key={kind} className="flex items-center gap-1.5">
              <span className={cn("h-2 w-2 rounded-full", KIND_META[kind].dot)} />
              {KIND_META[kind].label}
              {counts[kind] > 0 && <span className="tabular text-foreground/70">{counts[kind]}</span>}
            </span>
          ))}
        </div>

        <div className="mt-3 flex min-h-0 flex-1 flex-col border-t border-border/60 pt-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{visibleTitle}</p>
            {selectedDate && (
              <button type="button" onClick={() => setSelectedDate(null)} className="text-[11px] font-medium text-primary hover:underline">
                Show all month
              </button>
            )}
          </div>
          {visible.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center py-5 text-center">
              <CalendarX className="h-5 w-5 text-muted-foreground" />
              <p className="mt-2 text-[12px] font-medium">{selectedDate ? "Nothing dated this day" : `Nothing dated in ${monthLabel(month, true)}`}</p>
              <p className="mt-0.5 text-[10.5px] text-muted-foreground">
                Add a next-due date from Edit, or link an autopay schedule, so it shows here.
              </p>
            </div>
          ) : (
            <div className="max-h-[188px] space-y-1.5 overflow-y-auto pr-0.5">
              {visible.map((event) => {
                const meta = KIND_META[event.kind];
                return (
                  <div key={event.id} className="flex items-center gap-2.5 rounded-lg border border-border/60 px-2.5 py-2">
                    <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", meta.dot)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11.5px] font-medium">{event.name}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {event.kind === "paid" ? fmtDate(event.date, "d MMM") : `${fmtDate(event.date, "d MMM")} · ${relativeDue(event.date)}`}
                      </span>
                    </span>
                    <Badge variant={meta.badge}>{meta.label}</Badge>
                    <span className="w-16 shrink-0 text-right text-[11.5px] font-semibold tabular">
                      <Money value={event.amount} currency={currency} />
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {events.length === 0 && (
          <p className="mt-3 flex items-center gap-1.5 rounded-lg bg-muted/40 px-2.5 py-2 text-[10.5px] text-muted-foreground">
            <CalendarDays className="h-3.5 w-3.5 shrink-0" />
            Paid history and linked autopay runs appear here automatically.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
