import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { MoneyCalendar } from "@/components/app/money-calendar";
import { TxSheetProvider } from "@/components/app/tx-sheet";
import { actions, syncPort } from "@/lib/finance/store";

// 18 Nov 2026, 10:00 IST. Every date below is written in IST so the test reads the same anywhere.
const NOW = new Date("2026-11-18T10:00:00+05:30");

const pad = (n: number) => String(n).padStart(2, "0");
/** What a datetime-local input shows for an instant on this machine, which is what the add sheet does. */
const asLocalInput = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const asLocalDate = (iso: string) => asLocalInput(iso).slice(0, 10);

const mount = () => render(<TxSheetProvider><MoneyCalendar now={NOW} /></TxSheetProvider>);
const dayButton = (d: number) => screen.getByRole("button", { name: new RegExp(`^${d} November`) });

beforeEach(() => {
  localStorage.clear();
  syncPort.reset();
});

describe("MoneyCalendar", () => {
  it("opens the add sheet on the tapped day", async () => {
    mount();
    fireEvent.click(dayButton(25));
    fireEvent.click(screen.getByRole("button", { name: "Add transaction on this day" }));
    const dialog = screen.getByRole("dialog", { name: "Add transaction" });
    const date = within(dialog).getByDisplayValue(/^2026-/) as HTMLInputElement;
    expect(date.type).toBe("datetime-local");
    // Noon IST on the 25th.
    expect(date.value).toBe(asLocalInput("2026-11-25T12:00:00+05:30"));
    expect(date.value.startsWith("2026-11-2")).toBe(true);
    // The day panel got out of the way.
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /25 November/ })).toBeNull());
  });

  it("prefills the current time when the tapped day is today", () => {
    mount();
    fireEvent.click(dayButton(18));
    fireEvent.click(screen.getByRole("button", { name: "Add transaction on this day" }));
    expect((screen.getByDisplayValue(/^2026-/) as HTMLInputElement).value).toBe(asLocalInput(NOW.toISOString()));
  });

  it("lists the day's transactions in the panel and opens one for editing", () => {
    actions.addTx({ type: "expense", amount: 450, categoryId: "food", accountId: "upi", merchant: "Biryani House", date: "2026-11-12T13:00:00+05:30", source: "manual", isDemo: false });
    mount();
    fireEvent.click(dayButton(12));
    const panel = screen.getByRole("dialog", { name: /12 November/ });
    expect(within(panel).getByText("Biryani House")).toBeTruthy();
    fireEvent.click(within(panel).getByText("Biryani House"));
    expect(screen.getByRole("dialog", { name: "Edit transaction" })).toBeTruthy();
  });

  it("adds a bill due on the tapped day through the shared bill form", () => {
    mount();
    fireEvent.click(dayButton(25));
    fireEvent.click(screen.getByRole("button", { name: "Add bill due this day" }));
    const form = screen.getByRole("dialog", { name: "New bill" });
    expect((within(form).getByDisplayValue(/^2026-11-/) as HTMLInputElement).value).toBe(asLocalDate("2026-11-25T12:00:00+05:30"));
    fireEvent.change(within(form).getByPlaceholderText("e.g. Electricity"), { target: { value: "Water" } });
    fireEvent.change(within(form).getByPlaceholderText("0"), { target: { value: "300" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add reminder" }));
    const added = syncPort.getState().bills.find((b) => b.name === "Water");
    expect(added?.amount).toBe(300);
  });

  it("shows bills on their days, with the overdue one flagged", () => {
    actions.upsertBill({ name: "Rent", amount: 24000, dueDate: "2026-11-05T09:00:00+05:30", repeat: "monthly", categoryId: "rent", accountId: "cash", done: false });
    actions.upsertBill({ name: "Netflix", amount: 649, dueDate: "2026-11-25T09:00:00+05:30", repeat: "monthly", categoryId: "entertainment", accountId: "cash", done: false });
    mount();
    expect(dayButton(5).getAttribute("aria-label")).toContain("1 bill, 1 overdue");
    expect(dayButton(25).getAttribute("aria-label")).toContain("1 bill");
    expect(dayButton(25).getAttribute("aria-label")).not.toContain("overdue");
    fireEvent.click(dayButton(5));
    const panel = screen.getByRole("dialog", { name: /5 November/ });
    expect(within(panel).getByText("Rent")).toBeTruthy();
    expect(within(panel).getByText(/Overdue/)).toBeTruthy();
    expect(within(panel).getByRole("button", { name: "Mark paid" })).toBeTruthy();
  });

  it("moves between months and back with Today", () => {
    mount();
    expect(screen.getByText("November 2026")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByText("January 2027")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    expect(screen.getByText("December 2026")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(screen.getByText("November 2026")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Today" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("hides every amount when hide-amounts is on", () => {
    actions.addTx({ type: "expense", amount: 4567, categoryId: "food", accountId: "upi", merchant: "Dinner", date: "2026-11-12T20:00:00+05:30", source: "manual", isDemo: false });
    actions.setPrefs({ hideAmounts: true });
    mount();
    expect(dayButton(12).textContent).not.toMatch(/4[.,]?5/);
    expect(dayButton(12).getAttribute("aria-label")).not.toContain("₹");
    fireEvent.click(dayButton(12));
    const panel = screen.getByRole("dialog", { name: /12 November/ });
    expect(panel.textContent).not.toContain("4,567");
    expect(panel.textContent).toContain("₹ ••••");
  });

  it("leaves the bills half out when the Bills feature is off", () => {
    actions.upsertBill({ name: "Rent", amount: 24000, dueDate: "2026-11-05T09:00:00+05:30", repeat: "monthly", categoryId: "rent", accountId: "cash", done: false });
    actions.setPrefs({ features: { ...syncPort.getState().prefs.features, bills: false } });
    mount();
    expect(dayButton(5).getAttribute("aria-label")).not.toContain("bill");
    expect(screen.queryByText(/Bills due/)).toBeNull();
    fireEvent.click(dayButton(5));
    expect(screen.getByRole("button", { name: "Add transaction on this day" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add bill due this day" })).toBeNull();
    expect(screen.queryByText("Rent")).toBeNull();
  });
});
