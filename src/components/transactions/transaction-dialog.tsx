import { useEffect, useRef, useState } from "react";
import { Paperclip, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea } from "@/components/ui/form";
import { useAppData, useApp } from "@/lib/app-context";
import { guessCategory } from "@/lib/categories";
import { CHANNEL_LABEL, FLOW_TABS, channelForSource, guessFlowTab } from "@/lib/flows";
import type { FlowTab, FlowTabSource, Transaction } from "@/lib/types";

export function TransactionDialog({
  open,
  onOpenChange,
  existing,
  focusField,
  fields = "note",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existing: Transaction | null;
  focusField?: "notes";
  fields?: "info" | "note";
}) {
  const data = useAppData();
  const { updateTransaction } = useApp();
  const [categoryId, setCategoryId] = useState("");
  const [notes, setNotes] = useState("");
  const [receiptName, setReceiptName] = useState<string | undefined>();
  const [receiptData, setReceiptData] = useState<string | undefined>();
  const [flowTab, setFlowTab] = useState<FlowTab | "">("");
  const [flowSource, setFlowSource] = useState<FlowTabSource>("auto");
  const [flowTouched, setFlowTouched] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open || !existing) return;
    // Rows without info get a suggestion from their note first, then the merchant.
    const guess = existing.needsInfo ? guessCategory(`${existing.notes ?? ""} ${existing.merchant}`, existing.type) : null;
    setCategoryId(guess && guess.confidence >= 0.5 ? guess.categoryId : existing.categoryId);
    setNotes(existing.notes ?? "");
    setReceiptName(existing.receiptName);
    setReceiptData(existing.receiptData);
    const guessed = existing.flowTab ? null : guessFlowTab(existing.merchant, existing.categoryId, existing.type);
    setFlowTab(existing.flowTab ?? guessed?.tab ?? "");
    setFlowSource(existing.flowTabSource ?? guessed?.source ?? "auto");
    setFlowTouched(existing.flowTabSource === "manual");
  }, [open, existing]);

  useEffect(() => {
    if (!open || focusField !== "notes") return;
    const timer = window.setTimeout(() => notesRef.current?.focus(), 80);
    return () => window.clearTimeout(timer);
  }, [open, focusField]);

  useEffect(() => {
    if (!open || fields !== "info" || flowTouched) return;
    if (existing?.type !== "expense") {
      setFlowTab("");
      return;
    }
    const guessed = guessFlowTab(existing.merchant, categoryId, "expense");
    setFlowTab(guessed?.tab ?? "");
    setFlowSource(guessed?.source ?? "auto");
  }, [open, fields, categoryId, existing, flowTouched]);

  const categories = data.categories.filter((c) => c.kind === (existing?.type ?? "expense"));
  const isExpense = existing?.type === "expense";

  function handleFile(file?: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/") && file.type !== "application/pdf") {
      toast.error("Attach an image or PDF receipt.");
      return;
    }
    if (file.size > 320 * 1024) {
      toast.error("Receipt is too large", { description: "Keep it under 320 KB so your browser storage stays healthy." });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setReceiptData(String(reader.result));
      setReceiptName(file.name);
    };
    reader.readAsDataURL(file);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!existing) return;
    if (fields === "info") {
      const resolvedCategory = categoryId || guessCategory(existing.merchant, existing.type).categoryId;
      updateTransaction(existing.id, {
        categoryId: resolvedCategory,
        flowTab: isExpense && flowTab ? flowTab : undefined,
        flowTabSource: isExpense && flowTab ? (flowTouched ? ("manual" as const) : flowSource) : undefined,
        needsInfo: false,
      });
      toast.success("Information saved", { description: "Budgets and money flows recalculate immediately." });
    } else {
      updateTransaction(existing.id, {
        notes: notes.trim() || undefined,
        receiptName,
        receiptData,
      });
      toast.success("Transaction updated");
    }
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:!w-[min(94vw,560px)]">
        <DialogHeader>
          <DialogTitle>{fields === "info" ? "Add information" : "Transaction details"}</DialogTitle>
          <DialogDescription>
            {fields === "info"
              ? "Pick the category and money flow this payment belongs to, so the smart budget counts it correctly."
              : "Add a private note or attach a receipt for this payment."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4" noValidate>
          {fields === "info" && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="tx-category">Category</Label>
                <Select
                  value={categoryId}
                  onValueChange={(v) => {
                    setCategoryId(v);
                    if (flowSource !== "manual") setFlowTouched(false);
                  }}
                >
                  <SelectTrigger id="tx-category"><SelectValue placeholder="Choose a category" /></SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {isExpense && (
                <div className="space-y-1.5">
                  <Label htmlFor="tx-flow">Money flow</Label>
                  <Select
                    value={flowTab || "none"}
                    onValueChange={(v) => {
                      setFlowTab(v === "none" ? "" : (v as FlowTab));
                      setFlowSource("manual");
                      setFlowTouched(true);
                    }}
                  >
                    <SelectTrigger id="tx-flow"><SelectValue placeholder="Choose a flow (optional)" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Not part of money flows</SelectItem>
                      {FLOW_TABS.filter((tab) => tab.key !== "autopay").map((tab) => (
                        <SelectItem key={tab.key} value={tab.key}>{tab.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {isExpense && flowTab && flowSource === "fallback" && (
                <p className="text-[11px] leading-relaxed text-warning">
                  No match for this payment yet — it is counted under Others until you pick a category or flow.
                </p>
              )}

              <div className="flex h-9 items-center rounded-xl border border-border bg-muted/30 px-3 text-[12.5px] text-muted-foreground">
                Recorded via {CHANNEL_LABEL[existing?.channel ?? channelForSource(existing?.source ?? "manual")]}
              </div>
            </>
          )}

          {fields === "note" && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="tx-notes">Note <span className="font-normal text-muted-foreground">(optional)</span></Label>
                <Textarea ref={notesRef} id="tx-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What was this for?" className="min-h-[72px]" />
              </div>

              <div>
                <Label className="mb-1.5 block">Receipt <span className="font-normal text-muted-foreground">(optional)</span></Label>
                {receiptName ? (
                  <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/30 px-3 py-2">
                    {receiptData?.startsWith("data:image") ? (
                      <img src={receiptData} alt="Receipt preview" className="h-10 w-10 rounded-lg object-cover" />
                    ) : (
                      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-card text-muted-foreground"><Paperclip className="h-4 w-4" /></span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] font-medium">{receiptName}</p>
                      <button
                        type="button"
                        onClick={() => receiptData && window.open(receiptData, "_blank", "noopener")}
                        className="text-[11px] text-primary hover:underline"
                      >
                        View receipt
                      </button>
                    </div>
                    <Button type="button" variant="ghost" size="icon-sm" onClick={() => { setReceiptName(undefined); setReceiptData(undefined); if (fileRef.current) fileRef.current.value = ""; }} aria-label="Remove receipt">
                      <X />
                    </Button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border py-3 text-[12px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                  >
                    <Paperclip className="h-3.5 w-3.5" /> Attach an image or PDF (max 320 KB)
                  </button>
                )}
                <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} aria-label="Upload receipt" />
              </div>
            </>
          )}

          <DialogFooter className="!mt-5">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit">Save changes</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
