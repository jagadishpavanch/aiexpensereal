import { createFileRoute, Link } from "@tanstack/react-router";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowLeft, GripVertical, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { actions, useFinance } from "@/lib/finance/store";
import { DEFAULT_WIDGETS } from "@/lib/finance/demo";
import type { WidgetConfig, WidgetId } from "@/lib/finance/types";
import { Switch } from "@/components/ui/switch";
import { PageTitle } from "@/components/app/bits";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_shell/customize")({
  head: () => ({
    meta: [
      { title: "Customize home — ExTrack" },
      { name: "description", content: "Choose, reorder and resize the widgets on your home screen." },
      { property: "og:title", content: "Customize home — ExTrack" },
      { property: "og:description", content: "Choose, reorder and resize the widgets on your home screen." },
    ],
  }),
  component: Customize,
});

const LABELS: Record<WidgetId, { t: string; d: string }> = {
  balance: { t: "Balance & cash flow", d: "What's left, money in and out" },
  ring: { t: "Spending by category", d: "Interactive ring" },
  budgets: { t: "Budgets", d: "Progress for top budgets" },
  goals: { t: "Savings goals", d: "How close you are" },
  trend: { t: "Spending chart", d: "Stock-style chart: 7 days to all time, drag to inspect" },
  recent: { t: "Recent transactions", d: "Latest six entries" },
  merchants: { t: "Top merchants", d: "Where you spend most" },
  recurring: { t: "Recurring payments", d: "Subscriptions and bills" },
  bills: { t: "Bills due soon", d: "Upcoming and overdue bills" },
  cashback: { t: "Cashback", d: "Total cashback from UPI apps" },
  splits: { t: "Splits", d: "Who owes you and whom you owe" },
};

function Customize() {
  const widgets = useFinance((s) => s.prefs.widgets);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const set = (w: WidgetConfig[]) => actions.setPrefs({ widgets: w });
  const onEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = widgets.findIndex((w) => w.id === e.active.id);
    const to = widgets.findIndex((w) => w.id === e.over!.id);
    set(arrayMove(widgets, from, to));
  };

  return (
    <div className="space-y-4">
      <Link to="/home" className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground"><ArrowLeft className="size-4" />Home</Link>
      <PageTitle title="Customize home" sub="Drag to reorder. Changes save instantly."
        right={<button onClick={() => { set(DEFAULT_WIDGETS); toast("Layout reset"); }} className="flex items-center gap-1 rounded-full bg-card px-3 py-2 text-sm font-medium shadow-soft"><RotateCcw className="size-4" />Reset</button>} />
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onEnd}>
        <SortableContext items={widgets.map((w) => w.id)} strategy={verticalListSortingStrategy}>
          <ul className="space-y-2">
            {widgets.map((w) => <Item key={w.id} w={w} onChange={(p) => set(widgets.map((x) => (x.id === w.id ? { ...x, ...p } : x)))} />)}
          </ul>
        </SortableContext>
      </DndContext>
    </div>
  );
}

function Item({ w, onChange }: { w: WidgetConfig; onChange: (p: Partial<WidgetConfig>) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: w.id });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("flex items-center gap-3 rounded-3xl bg-card p-3 shadow-soft transition-shadow", isDragging && "relative z-10 scale-[1.02] shadow-lift", !w.visible && "opacity-60")}>
      <button {...attributes} {...listeners} aria-label={`Reorder ${LABELS[w.id].t}`} className="grid size-10 cursor-grab touch-none place-items-center rounded-2xl bg-muted active:cursor-grabbing"><GripVertical className="size-5" /></button>
      <div className="min-w-0 flex-1"><p className="font-semibold">{LABELS[w.id].t}</p><p className="truncate text-sm text-muted-foreground">{LABELS[w.id].d}</p></div>
      <div className="hidden rounded-full bg-muted p-0.5 text-xs sm:flex">
        {(["half", "full"] as const).map((s) => <button key={s} onClick={() => onChange({ size: s })} aria-pressed={w.size === s} className={cn("rounded-full px-2.5 py-1 font-medium", w.size === s ? "bg-card shadow-soft" : "text-muted-foreground")}>{s === "half" ? "Half" : "Full"}</button>)}
      </div>
      <Switch checked={w.visible} onCheckedChange={(v) => onChange({ visible: v })} aria-label={`Show ${LABELS[w.id].t}`} />
    </li>
  );
}
