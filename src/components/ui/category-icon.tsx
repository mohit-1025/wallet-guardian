import {
  Briefcase, Bus, CircleDot, Clapperboard, GraduationCap, HeartPulse, Home, Landmark, Laptop,
  PiggyBank, Plane, Repeat, RotateCcw, Shield, ShoppingBag, ShoppingBasket, Sparkles, Target,
  Utensils, Zap, Tag, Receipt, Music, Dumbbell, Chrome, Notebook, type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  briefcase: Briefcase,
  bus: Bus,
  "circle-dot": CircleDot,
  clapperboard: Clapperboard,
  "graduation-cap": GraduationCap,
  "heart-pulse": HeartPulse,
  home: Home,
  landmark: Landmark,
  laptop: Laptop,
  "piggy-bank": PiggyBank,
  plane: Plane,
  repeat: Repeat,
  "rotate-ccw": RotateCcw,
  shield: Shield,
  "shopping-bag": ShoppingBag,
  "shopping-basket": ShoppingBasket,
  sparkles: Sparkles,
  target: Target,
  utensils: Utensils,
  zap: Zap,
  tag: Tag,
  receipt: Receipt,
  music: Music,
  dumbbell: Dumbbell,
  camera: Chrome,
  book: Notebook,
};

export function CategoryIcon({ name, className }: { name?: string; className?: string }) {
  const Icon = (name && ICONS[name]) || CircleDot;
  return <Icon className={className} aria-hidden />;
}

export function CategoryDot({ color, className }: { color: string; className?: string }) {
  return <span className={className ?? "h-2 w-2 rounded-full"} style={{ backgroundColor: color }} aria-hidden />;
}
