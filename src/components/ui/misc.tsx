import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold transition-colors [&_svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary-soft text-accent-foreground",
        secondary: "border-transparent bg-muted text-muted-foreground",
        outline: "border-border bg-transparent text-muted-foreground",
        success: "border-success/20 bg-success-soft text-success",
        warning: "border-warning/20 bg-warning-soft text-warning",
        danger: "border-danger/20 bg-danger-soft text-danger",
        solid: "border-transparent bg-foreground text-background",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export function Progress({ value, className, indicatorClassName }: { value: number; className?: string; indicatorClassName?: string }) {
  return (
    <div
      className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(Math.min(100, Math.max(0, value)))}
    >
      <div
        className={cn("h-full rounded-full bg-primary transition-[width] duration-700 ease-spring", indicatorClassName)}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("relative overflow-hidden rounded-xl bg-muted/70", className)} {...props}>
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-card/60 to-transparent" />
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn("inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent", className)}
      aria-hidden
    />
  );
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
  return (
    <span
      className={cn(
        "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-indigo-800 text-[12px] font-bold text-white ring-2 ring-card",
        className,
      )}
      aria-hidden
    >
      {letters || "WG"}
    </span>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-14 text-center", className)}>
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-muted/60 text-muted-foreground [&_svg]:size-6">
        {icon}
      </div>
      <h3 className="text-[15px] font-semibold">{title}</h3>
      {description && <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-muted-foreground">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  className,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  eyebrow?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-5 flex flex-col gap-3 sm:mb-7 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        {eyebrow && <div className="mb-1.5">{eyebrow}</div>}
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-muted-foreground sm:text-sm">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function InfoNote({ children, className, icon }: { children: React.ReactNode; className?: string; icon?: React.ReactNode }) {
  return (
    <div className={cn("flex items-start gap-2 rounded-xl border border-border/70 bg-muted/40 px-3 py-2.5 text-[12px] leading-relaxed text-muted-foreground", className)}>
      {icon && <span className="mt-0.5 shrink-0 [&_svg]:size-3.5">{icon}</span>}
      <span>{children}</span>
    </div>
  );
}

export { badgeVariants };
