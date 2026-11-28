import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { TxSheetProvider, useTxSheet } from "@/components/app/tx-sheet";
import { actions, syncPort } from "@/lib/finance/store";

function openSheet() {
  let open: () => void = () => {};
  function Opener() {
    open = useTxSheet().open;
    return null;
  }
  render(
    <TxSheetProvider>
      <Opener />
    </TxSheetProvider>,
  );
  act(() => open());
}

const fill = (amount: string, merchant: string) => {
  fireEvent.change(screen.getByPlaceholderText("0"), { target: { value: amount } });
  fireEvent.change(screen.getByPlaceholderText(/Swiggy/), { target: { value: merchant } });
};
const chip = (name: string) => screen.getByRole("button", { name });
const names = () => syncPort.getState().people.map((p) => p.name);

describe("split section of the add sheet", () => {
  beforeEach(() => {
    syncPort.reset();
    actions.setPrefs({ onboarded: true });
  });

  it("a payer who is taken off the split is no longer the payer", async () => {
    const a = actions.addPerson({ name: "Asha", group: "friend" });
    actions.addPerson({ name: "Bala", group: "friend" });
    openSheet();
    fill("900", "Dinner");
    fireEvent.click(screen.getByLabelText(/Split with people/));
    fireEvent.click(chip("Asha"));
    fireEvent.click(chip("Bala"));
    fireEvent.change(screen.getByLabelText(/Who paid/), { target: { value: a.id } });
    fireEvent.click(chip("Asha")); // off the split again
    fireEvent.click(screen.getByRole("button", { name: "Add transaction" }));
    await waitFor(() => expect(syncPort.getState().splits).toHaveLength(1));
    const sp = syncPort.getState().splits[0];
    expect(sp.shares.map((s) => s.personId)).not.toContain(a.id);
    expect(sp.paidBy).toBe("me");
  });

  it("pressing Enter in the new-person box adds that person instead of saving the expense", () => {
    openSheet();
    fill("900", "Dinner");
    fireEvent.click(screen.getByLabelText(/Split with people/));
    const box = screen.getByPlaceholderText("New person");
    fireEvent.change(box, { target: { value: "Zoya" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(names()).toEqual(["Zoya"]);
    expect(syncPort.getState().transactions).toHaveLength(0);
  });
});
