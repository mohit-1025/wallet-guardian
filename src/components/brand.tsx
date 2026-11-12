import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 via-indigo-600 to-indigo-900 shadow-[0_6px_18px_-6px_rgba(79,70,229,0.65)]",
        className,
      )}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
        <path
          d="M12 2.8l7 3v5.7c0 4.8-2.9 8.2-7 10.1-4.1-1.9-7-5.3-7-10.1V5.8l7-3z"
          fill="rgba(255,255,255,0.16)"
          stroke="white"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <path d="M8.6 12.2l2.3 2.3 4.6-5" stroke="#6ee7b7" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

export function Logo({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark />
      {!compact && (
        <span className="flex flex-col leading-none">
          <span className="text-[15px] font-bold tracking-tight">Wallet Guardian</span>
          <span className="mt-1 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Calm money</span>
        </span>
      )}
    </span>
  );
}
