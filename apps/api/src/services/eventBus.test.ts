import { describe, it, expect, vi } from "vitest";
import { emit, subscribe } from "./eventBus";

describe("eventBus", () => {
  it("emits and receives events", () => {
    const handler = vi.fn();
    subscribe("test.event", handler);
    emit("test.event", { foo: "bar" });
    expect(handler).toHaveBeenCalledWith({ foo: "bar" });
  });

  it("does not crash with no subscribers", () => {
    expect(() => emit("no.subscribers", {})).not.toThrow();
  });

  it("unsubscribes correctly", () => {
    const handler = vi.fn();
    const unsubscribe = subscribe("once.event", handler);
    unsubscribe();
    emit("once.event", { data: 1 });
    expect(handler).not.toHaveBeenCalled();
  });

  it("handles async handlers", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    subscribe("async.event", handler);
    emit("async.event", { id: 1 });
    await new Promise((r) => setTimeout(r, 10));
    expect(handler).toHaveBeenCalled();
  });

  it("isolates different event types", () => {
    const handlerA = vi.fn();
    const handlerB = vi.fn();
    subscribe("event.a", handlerA);
    subscribe("event.b", handlerB);
    emit("event.a", { x: 1 });
    expect(handlerA).toHaveBeenCalled();
    expect(handlerB).not.toHaveBeenCalled();
  });
});
