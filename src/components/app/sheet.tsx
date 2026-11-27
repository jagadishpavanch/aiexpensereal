import { AnimatePresence, motion, useDragControls } from "motion/react";
import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import { useTxSheet } from "./tx-sheet";
import { cn } from "@/lib/utils";

/** Generic animated bottom sheet (dialog on desktop). Hides the floating + while open. */
export function BottomSheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const { setOverlay } = useTxSheet();
  const drag = useDragControls();
  useEffect(() => {
    setOverlay(open);
    return () => setOverlay(false);
  }, [open, setOverlay]);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center" role="dialog" aria-modal aria-label={title}>
          <motion.div className="absolute inset-0 bg-foreground/40 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div
            initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", stiffness: 380, damping: 36 }}
            // Drag-to-close starts only from the handle and title row. A drag listener on the whole
            // sheet sets touch-action on it, and the form inside could no longer scroll on a phone.
            drag="y" dragListener={false} dragControls={drag} dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: 0.6 }} onDragEnd={(_, i) => i.offset.y > 120 && onClose()}
            data-testid="sheet-scroll"
            className="relative max-h-[calc(100dvh-env(safe-area-inset-top,0px)-1rem)] w-full max-w-lg overflow-y-auto overscroll-contain rounded-t-[2rem] bg-card p-5 pb-[calc(env(safe-area-inset-bottom,0px)+1.25rem)] shadow-lift md:max-h-[90dvh] md:rounded-[2rem]"
          >
            <div onPointerDown={(e) => drag.start(e)} className="-mx-5 -mt-5 touch-none px-5 pt-5" data-testid="sheet-handle">
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-muted md:hidden" />
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-xl font-semibold">{title}</h2>
              <button onClick={onClose} aria-label="Close" className="grid size-9 place-items-center rounded-full bg-muted"><X className="size-4" /></button>
            </div>
            </div>
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn("block space-y-1.5", className)}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

export function Chips<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { v: T; label: string }[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button type="button" key={o.v} onClick={() => onChange(o.v)} aria-pressed={value === o.v}
          className={cn("relative rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors", value === o.v ? "text-primary-foreground" : "bg-muted text-muted-foreground")}>
          {value === o.v && <motion.span layoutId={`chip-${options.map((x) => x.v).join("")}`} className="absolute inset-0 rounded-full bg-primary" transition={{ type: "spring", stiffness: 500, damping: 35 }} />}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  );
}
