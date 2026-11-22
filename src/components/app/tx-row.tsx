import { motion, useMotionValue, useTransform, animate } from "motion/react";
import { Trash2, MessageSquareText, Repeat } from "lucide-react";
import type { Category, Transaction } from "@/lib/finance/types";
import { Amount, CategoryIcon } from "./bits";

export function TxRow({ tx, category, onOpen, onDelete }: { tx: Transaction; category?: Category; onOpen: () => void; onDelete?: () => void }) {
  const x = useMotionValue(0);
  const bg = useTransform(x, [-120, -40, 0], [1, 0.6, 0]);
  const time = new Date(tx.date).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  return (
    <motion.li layout initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0, transition: { duration: 0.2 } }} className="relative overflow-hidden">
      {onDelete && (
        <motion.div style={{ opacity: bg }} className="absolute inset-0 flex items-center justify-end rounded-2xl bg-expense pr-6 text-primary-foreground">
          <Trash2 className="size-5" /> <span className="sr-only">Delete</span>
        </motion.div>
      )}
      <motion.button
        style={{ x }}
        drag={onDelete ? "x" : false}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={{ left: 0.6, right: 0.05 }}
        onDragEnd={(_, i) => {
          if (i.offset.x < -110 && onDelete) onDelete();
          else animate(x, 0, { type: "spring", stiffness: 500, damping: 35 });
        }}
        onClick={onOpen}
        whileTap={{ scale: 0.985 }}
        className="relative flex w-full items-center gap-3 rounded-2xl bg-card px-2 py-2.5 text-left transition-colors hover:bg-muted/60"
      >
        <CategoryIcon category={category} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{tx.merchant}</p>
          <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
            {category?.name ?? "Uncategorised"}
            <span aria-hidden>·</span> {time}
            {tx.source === "sms_demo" && <MessageSquareText className="size-3" aria-label="From sample SMS" />}
            {tx.recurring && <Repeat className="size-3" aria-label="Recurring" />}
            {tx.type === "transfer" && <span className="rounded bg-muted px-1">Transfer</span>}
            {tx.type === "refund" && <span className="rounded bg-income-soft px-1">Refund</span>}
          </p>
        </div>
        <Amount value={tx.amount} type={tx.type} />
      </motion.button>
    </motion.li>
  );
}
