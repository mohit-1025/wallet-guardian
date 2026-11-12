import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay ref={ref} className={cn("dialog-overlay fixed inset-0 z-[60] bg-slate-950/55 backdrop-blur-[3px]", className)} {...props} />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { hideClose?: boolean; wide?: boolean }
>(({ className, children, hideClose, wide, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "dialog-content fixed inset-x-0 bottom-0 z-[60] max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl border border-border bg-card p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-lift focus:outline-none sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-h-[88vh] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl sm:p-6",
        wide ? "sm:w-[min(92vw,760px)]" : "sm:w-[min(92vw,520px)]",
        className,
      )}
      {...props}
    >
      <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-border sm:hidden" aria-hidden />
      {children}
      {!hideClose && (
        <DialogPrimitive.Close
          className="absolute right-4 top-4 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Close dialog"
        >
          <X className="h-4 w-4" />
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("mb-4 flex flex-col gap-1.5 pr-8", className)} {...props} />
);

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cn("text-lg font-semibold tracking-tight", className)} {...props} />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn("text-[13px] leading-relaxed text-muted-foreground", className)} {...props} />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)} {...props} />
);

export { Dialog, DialogTrigger, DialogClose, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter };
