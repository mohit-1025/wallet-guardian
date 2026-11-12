import type { Category } from "./types";

export const DEFAULT_CATEGORIES: Category[] = [
  { id: "cat_salary", name: "Salary", kind: "income", group: "savings", color: "#4f46e5", icon: "briefcase" },
  { id: "cat_freelance", name: "Freelance", kind: "income", group: "savings", color: "#7c3aed", icon: "laptop" },
  { id: "cat_refunds", name: "Refunds", kind: "income", group: "savings", color: "#0ea5e9", icon: "rotate-ccw" },
  { id: "cat_rent", name: "Rent", kind: "expense", group: "necessities", color: "#0f766e", icon: "home" },
  { id: "cat_groceries", name: "Groceries", kind: "expense", group: "necessities", color: "#059669", icon: "shopping-basket" },
  { id: "cat_food", name: "Food & Dining", kind: "expense", group: "wants", color: "#f59e0b", icon: "utensils" },
  { id: "cat_transport", name: "Transport", kind: "expense", group: "necessities", color: "#3b82f6", icon: "bus" },
  { id: "cat_utilities", name: "Utilities", kind: "expense", group: "necessities", color: "#0891b2", icon: "zap" },
  { id: "cat_education", name: "Education", kind: "expense", group: "necessities", color: "#6366f1", icon: "graduation-cap" },
  { id: "cat_emi", name: "Loans & EMI", kind: "expense", group: "necessities", color: "#b45309", icon: "landmark" },
  { id: "cat_shopping", name: "Shopping", kind: "expense", group: "wants", color: "#ec4899", icon: "shopping-bag" },
  { id: "cat_entertainment", name: "Entertainment", kind: "expense", group: "wants", color: "#8b5cf6", icon: "clapperboard" },
  { id: "cat_subscriptions", name: "Subscriptions", kind: "expense", group: "wants", color: "#f43f5e", icon: "repeat" },
  { id: "cat_health", name: "Health", kind: "expense", group: "necessities", color: "#14b8a6", icon: "heart-pulse" },
  { id: "cat_travel", name: "Travel", kind: "expense", group: "wants", color: "#06b6d4", icon: "plane" },
  { id: "cat_personal", name: "Personal Care", kind: "expense", group: "wants", color: "#d946ef", icon: "sparkles" },
  { id: "cat_other", name: "Other", kind: "expense", group: "wants", color: "#64748b", icon: "circle-dot" },
];

export const CATEGORY_COLORS = [
  "#4f46e5", "#059669", "#0891b2", "#f59e0b", "#ec4899", "#8b5cf6",
  "#14b8a6", "#f43f5e", "#3b82f6", "#d946ef", "#0f766e", "#64748b",
];

const MERCHANT_RULES: { match: RegExp; categoryId: string }[] = [
  { match: /swiggy|zomato|dominos|pizza|restaurant|cafe|coffee|starbucks|blinkit food|eatfit|faasos/i, categoryId: "cat_food" },
  { match: /bigbasket|zepto|blinkit|dmart|grofers|grocer|instamart|reliance fresh/i, categoryId: "cat_groceries" },
  { match: /uber|ola|rapido|metro|irctc|petrol|fuel|indian oil|cab/i, categoryId: "cat_transport" },
  { match: /airtel|jio|vi |electricity|water bill|broadband|gas bill|tata power|bses/i, categoryId: "cat_utilities" },
  { match: /netflix|spotify|prime|youtube|hotstar|disney|audible|icloud|adobe|notion|figma|canva|chatgpt|openai/i, categoryId: "cat_subscriptions" },
  { match: /amazon|flipkart|myntra|nykaa|ajio|meesho|decathlon|croma|ikea/i, categoryId: "cat_shopping" },
  { match: /bookmyshow|pvr|inox|cinema|gaming|steam|playstation|xbox|concert/i, categoryId: "cat_entertainment" },
  { match: /pharmacy|apollo|medplus|hospital|clinic|practo|1mg|dental/i, categoryId: "cat_health" },
  { match: /makemytrip|goibibo|airbnb|hotel|indigo|vistara|flight|oyo/i, categoryId: "cat_travel" },
  { match: /rent|landlord|housing|nobroker/i, categoryId: "cat_rent" },
  { match: /emi|loan|bajaj finance|hdfc loan|cred/i, categoryId: "cat_emi" },
  { match: /course|udemy|coursera|university|college|tuition|exam fee|byju/i, categoryId: "cat_education" },
  { match: /salon|barber|spa|gym|cult.fit|fitness/i, categoryId: "cat_personal" },
  { match: /salary|payroll|stipend/i, categoryId: "cat_salary" },
  { match: /freelance|upwork|fiverr|client payment|invoice/i, categoryId: "cat_freelance" },
];

export function guessCategory(merchant: string, type: "income" | "expense"): { categoryId: string; confidence: number; reason: string } {
  if (!merchant.trim()) return { categoryId: type === "income" ? "cat_freelance" : "cat_other", confidence: 0, reason: "No merchant name" };
  for (const rule of MERCHANT_RULES) {
    if (rule.match.test(merchant)) {
      const category = DEFAULT_CATEGORIES.find((c) => c.id === rule.categoryId);
      if (category && category.kind !== type) continue;
      return {
        categoryId: rule.categoryId,
        confidence: 0.92,
        reason: `“${merchant}” matches known ${category?.name.toLowerCase() ?? "merchant"} patterns`,
      };
    }
  }
  return {
    categoryId: type === "income" ? "cat_freelance" : "cat_other",
    confidence: 0.4,
    reason: "No strong match — review this suggestion",
  };
}

export const UNCATEGORIZED_HINTS = ["other", "misc", "unknown"];
