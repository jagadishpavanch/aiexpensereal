import { Link } from "@tanstack/react-router";
import { motion } from "motion/react";
import { ChevronRight, MessageSquareText } from "lucide-react";
import { useFinance } from "@/lib/finance/store";
import { nativeSmsAvailable } from "@/lib/sms/native";
import { hasImported } from "@/lib/sms/runtime";

/**
 * Android only, until the first inbox import: points to SMS tracking from Home, since it was
 * otherwise only reachable through More. After that import, new bank SMS are added on their own.
 */
export function SmsSetupCard() {
  const on = useFinance((s) => s.prefs.features.autoTracking);
  // Re-checked whenever transactions change, so it disappears right after an import on this screen.
  useFinance((s) => s.transactions);
  const needed = nativeSmsAvailable() && !hasImported();
  if (!on || !needed) return null;
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}>
      <Link to="/auto-tracking" className="flex items-center gap-3 rounded-3xl bg-peacock p-4 text-primary-foreground shadow-lift">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-white/15"><MessageSquareText className="size-5" /></span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">Track bank SMS automatically</span>
          <span className="block text-sm opacity-90">Import your past bank SMS once. New bank and UPI messages are then added on their own.</span>
        </span>
        <ChevronRight className="size-5 shrink-0" />
      </Link>
    </motion.div>
  );
}
