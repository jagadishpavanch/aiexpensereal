import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BottomSheet } from "@/components/app/sheet";
import { TxSheetProvider, useTxSheet } from "@/components/app/tx-sheet";
import { syncPort } from "@/lib/finance/store";

// Regression: both sheets were draggable as a whole. Motion then sets touch-action
// on the whole sheet, so on a phone the form inside could not be scrolled and the
// fields below the fold were unreachable. Drag must start only from the handle.
const blocksScroll = (el: HTMLElement) => ["none", "pan-x"].includes(el.style.touchAction);

describe("bottom sheets scroll on touch screens", () => {
  it("generic sheet: body scrolls, only the handle drags", () => {
    render(
      <TxSheetProvider>
        <BottomSheet open onClose={() => {}} title="Test">
          <p>body</p>
        </BottomSheet>
      </TxSheetProvider>,
    );
    expect(blocksScroll(screen.getByTestId("sheet-scroll"))).toBe(false);
    expect(screen.getByTestId("sheet-handle").className).toContain("touch-none");
  });

  it("add-transaction sheet: body scrolls, and it lists categories and accounts", () => {
    syncPort.reset();
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
    expect(blocksScroll(screen.getByTestId("sheet-scroll"))).toBe(false);
    expect(screen.getByTestId("sheet-handle").className).toContain("touch-none");
    expect(screen.getAllByRole("option").length).toBeGreaterThan(0);
    expect(screen.getByText("Category")).toBeTruthy();
  });

  it("add-transaction sheet still offers categories after a pull removed them all", () => {
    syncPort.reset();
    syncPort.applyRemote((s) => ({ ...s, categories: [], accounts: [] }));
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
    expect(screen.getByRole("button", { name: /food/i })).toBeTruthy();
    expect(screen.getAllByRole("option").length).toBeGreaterThan(0);
  });
});
