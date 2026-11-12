import { useEffect, useRef, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Check, Paperclip, Sparkles, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money";
import { Badge } from "@/components/ui/misc";
import { useAppData, useApp } from "@/lib/app-context";
import { formatAmountInput, parseToInr } from "@/lib/money";
import { guessCategory } from "@/lib/categories";
import { todayISO } from "@/lib/dates";
import type { Transaction } from "@/lib/types";
import { cn } from "@/lib/utils";

const METHODS = ["UPI", "Card", "Cash", "Bank transfer", "PayPal", "Auto-debit", "Bill payment", "Other"];

export function TransactionDialog({
  open,
  onOpenChange,
  existing,
  defaultType = "expense",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existing?: Transaction | null;
  defaultType?: "expense" | "income";
}) {
  const data = useAppData();
  const { addTransaction, updateTransaction, deleteTransaction } = useApp();
  const currency = data.profile.currency;
  const [type, setType] = useState<"expense" | "income">(defaultType);
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [merchant, setMerchant] = useState("");
  const [date, setDate] = useState(todayISO());
  const [method, setMethod] = useState("UPI");
  const [notes, setNotes] = useState("");
  const [receiptName, setReceiptName] = useState<string | undefined>();
  const [receiptData, setReceiptData] = useState<string | undefined>();
  const [suggestion, setSuggestion] = useState<{ categoryId: string; confidence: number; reason: string } | null>(null);
  const [categoryTouched, setCategoryTouched] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    if (existing) {
      setType(existing.type);
      setAmount(formatAmountInput(existing.amount, currency));
      setCategoryId(existing.categoryId);
      setMerchant(existing.merchant);
      setDate(existing.date);
      setMethod(existing.paymentMethod);
      setNotes(existing.notes ?? "");
      setReceiptName(existing.receiptName);
      setReceiptData(existing.receiptData);
      setCategoryTouched(true);
    } else {
      setType(defaultType);
      setAmount("");
      setCategoryId("");
      setMerchant("");
      setDate(todayISO());
      setMethod("UPI");
      setNotes("");
      setReceiptName(undefined);
      setReceiptData(undefined);
      setCategoryTouched(false);
    }
    setSuggestion(null);
    setConfirmDelete(false);
    setError(null);
  }, [open, existing, defaultType, currency]);

  useEffect(() => {
    if (!open || existing) return;
    if (!merchant.trim()) {
      setSuggestion(null);
      return;
    }
    const timer = window.setTimeout(() => {
      const result = guessCategory(merchant, type);
      setSuggestion(result);
      if (!categoryTouched && result.confidence >= 0.4) setCategoryId(result.categoryId);
    }, 320);
    return () => window.clearTimeout(timer);
  }, [merchant, type, open, existing, categoryTouched]);

  useEffect(() => {
    if (!open) return;
    setCategoryTouched(false);
  }, [type, open]);

  const categories = data.categories.filter((c) => c.kind === type);
  const suggestedCategory = suggestion ? data.categories.find((c) => c.id === suggestion.categoryId) : null;

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
    setError(null);
    const amountInr = parseToInr(amount, currency);
    if (!amountInr || amountInr <= 0) return setError("Enter an amount greater than zero.");
    if (!merchant.trim()) return setError(type === "expense" ? "Who did you pay?" : "Where did this money come from?");
    if (!date) return setError("Choose a date.");
    const resolvedCategory = categoryId || guessCategory(merchant, type).categoryId;
    const payload = {
      type,
      amount: amountInr,
      categoryId: resolvedCategory,
      merchant: merchant.trim(),
      date,
      paymentMethod: method,
      notes: notes.trim() || undefined,
      receiptName,
      receiptData,
    };
    if (existing) {
      updateTransaction(existing.id, payload);
      toast.success("Transaction updated");
    } else {
      addTransaction(payload);
      toast.success(type === "expense" ? "Expense added" : "Income added", {
        description: "Your safe-to-spend number and envelopes are updated.",
      });
    }
    onOpenChange(false);
  }

  function remove() {
    if (!existing) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    deleteTransaction(existing.id);
    toast.success("Transaction deleted");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:!w-[min(94vw,560px)]">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit transaction" : "Quick add"}</DialogTitle>
          <DialogDescription>
            {existing ? "Correct the details or remove this record." : "Log money in or out. AI suggests a category you can change."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="grid grid-cols-2 gap-2 rounded-xl bg-muted p-1" role="radiogroup" aria-label="Transaction type">
            {[
              { id: "expense" as const, label: "Expense", icon: ArrowUpRight, tone: "text-danger" },
              { id: "income" as const, label: "Income", icon: ArrowDownLeft, tone: "text-success" },
            ].map((opt) => (
              <button
                key={opt.id}
                type="button"
                role="radio"
                aria-checked={type === opt.id}
                onClick={() => setType(opt.id)}
                className={cn(
                  "flex h-9 items-center justify-center gap-1.5 rounded-lg text-[13px] font-semibold transition-all",
                  type === opt.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <opt.icon className={cn("h-4 w-4", type === opt.id && opt.tone)} />
                {opt.label}
              </button>
            ))}
          </div>

          <div>
            <Label htmlFor="tx-amount" className="mb-1.5 block">Amount</Label>
            <MoneyInput id="tx-amount" value={amount} currency={currency} onChange={setAmount} className="h-12 text-lg" />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="tx-merchant">{type === "expense" ? "Paid to" : "Received from"}</Label>
              <Input id="tx-merchant" value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder={type === "expense" ? "Swiggy, landlord, BigBasket…" : "Client, employer, refund"} autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tx-date">Date</Label>
              <Input id="tx-date" type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="tx-category">Category</Label>
              <Select
                value={categoryId}
                onValueChange={(v) => {
                  setCategoryId(v);
                  setCategoryTouched(true);
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
            <div className="space-y-1.5">
              <Label htmlFor="tx-method">Payment method</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger id="tx-method"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {METHODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {suggestion && suggestedCategory && (
            <div className="flex items-start gap-2 rounded-xl border border-primary/15 bg-primary-soft/50 px-3 py-2.5">
              <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="text-[11.5px] font-semibold text-foreground">
                  AI suggested {suggestedCategory.name}
                  <span className="ml-1.5 font-normal text-muted-foreground">{Math.round(suggestion.confidence * 100)}% match</span>
                </p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{suggestion.reason}.</p>
              </div>
              {categoryId !== suggestion.categoryId ? (
                <Button type="button" variant="ghost" size="sm" className="h-7 shrink-0 px-2 text-[11px]" onClick={() => { setCategoryId(suggestion.categoryId); setCategoryTouched(false); }}>
                  Use it
                </Button>
              ) : (
                <Badge variant="success" className="mt-0.5 shrink-0"><Check /> Applied</Badge>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="tx-notes">Notes <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Textarea id="tx-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What was this for?" className="min-h-[72px]" />
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

          {error && <div role="alert" className="rounded-xl border border-danger/25 bg-danger-soft px-3 py-2.5 text-[12.5px] font-medium text-danger">{error}</div>}

          <DialogFooter className="!mt-5">
            {existing && (
              <Button type="button" variant={confirmDelete ? "destructive" : "ghost"} onClick={remove} className="sm:mr-auto">
                <Trash2 /> {confirmDelete ? "Confirm delete" : "Delete"}
              </Button>
            )}
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit">{existing ? "Save changes" : "Add transaction"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
