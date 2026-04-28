import { describe, expect, it } from "vitest";
import { APP_ICONS, LogOut, MessageSquare, Pin, PinOff, X } from "./icons";

describe("icons", () => {
  it("exports shell icons and named app icons", () => {
    expect(APP_ICONS.Settings).toBeTruthy();
    expect(APP_ICONS.TableProperties).toBeTruthy();
    expect(LogOut).toBeTruthy();
    expect(X).toBeTruthy();
    expect(Pin).toBeTruthy();
    expect(PinOff).toBeTruthy();
    expect(MessageSquare).toBeTruthy();
  });
});
