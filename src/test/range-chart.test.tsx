import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { RangeChart } from "@/components/app/range-chart";
import { actions, syncPort } from "@/lib/finance/store";

describe("RangeChart", () => {
  beforeEach(() => {
    syncPort.reset();
  });

  it("starts on 30 days and switches range", () => {
    render(<RangeChart />);
    expect(screen.getByRole("button", { name: "30D" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "1Y" }));
    expect(screen.getByRole("button", { name: "1Y" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getAllByText(/last year/).length).toBeGreaterThan(0);
  });

  it("shows a point's date and count while scrubbing with the keyboard, and clears on blur", () => {
    render(<RangeChart />);
    const slider = screen.getByRole("slider");
    fireEvent.keyDown(slider, { key: "Home" });
    expect(slider.getAttribute("aria-valuenow")).toBe("0");
    expect(slider.getAttribute("aria-valuetext")).toMatch(/transaction/);
    fireEvent.blur(slider);
    expect(slider.getAttribute("aria-valuetext")).toMatch(/last 30 days/);
  });

  it("a touch drag moves the marker to the nearest point and lifting the finger clears it", () => {
    render(<RangeChart />);
    const slider = screen.getByRole("slider");
    slider.getBoundingClientRect = () => ({ left: 0, top: 0, right: 300, bottom: 184, width: 300, height: 184, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.pointerDown(slider, { clientX: 6, pointerType: "touch" });
    expect(slider.getAttribute("aria-valuenow")).toBe("0");
    fireEvent.pointerMove(slider, { clientX: 294, pointerType: "touch" });
    expect(slider.getAttribute("aria-valuetext")).toMatch(/transaction/);
    fireEvent.pointerUp(slider, { pointerType: "touch" });
    expect(slider.getAttribute("aria-valuetext")).toMatch(/last 30 days/);
    expect(slider.getAttribute("aria-valuenow")).toBe("29");
  });

  it("hides amounts when the preference is on", () => {
    act(() => actions.setPrefs({ hideAmounts: true }));
    render(<RangeChart />);
    expect(screen.getAllByText("₹ ••••").length).toBeGreaterThan(0);
  });
});
