import "reflect-metadata";

import { EdenNamespace } from "./CommandDecorators";
import { EdenEmitter } from "./EdenEmitter";
import type { IPCBridge } from "./IPCBridge";

interface TestEvents {
  ping: { value: number };
}

describe("EdenEmitter", () => {
  it("throws when notify is used without a namespace", () => {
    class NoNamespace extends EdenEmitter<TestEvents> {
      public emit(): void {
        this.notify("ping", { value: 1 });
      }
    }

    const emitter = new NoNamespace({
      eventSubscribers: { notify: jest.fn(), notifyView: jest.fn() },
    } as unknown as IPCBridge);

    expect(() => emitter.emit()).toThrow(
      /must be decorated with @EdenNamespace/,
    );
  });

  it("emits namespaced events via the IPC bridge", () => {
    @EdenNamespace("test")
    class Namespaced extends EdenEmitter<TestEvents> {
      public emit(): void {
        this.notify("ping", { value: 42 });
      }

      public emitTo(viewId: number): void {
        this.notifySubscriber(viewId, "ping", { value: 7 });
      }
    }

    const notify = jest.fn();
    const notifyView = jest.fn();
    const emitter = new Namespaced({
      eventSubscribers: { notify, notifyView },
    } as unknown as IPCBridge);

    emitter.emit();
    expect(notify).toHaveBeenCalledWith("test/ping", { value: 42 });

    emitter.emitTo(12);
    expect(notifyView).toHaveBeenCalledWith(12, "test/ping", { value: 7 });
  });

  it("notifies local listeners in order, deduplicates, and disposes them", () => {
    @EdenNamespace("test")
    class Namespaced extends EdenEmitter<TestEvents> {
      public emit(value: number): void {
        this.notify("ping", { value });
      }
    }

    const notify = jest.fn();
    const emitter = new Namespaced({
      eventSubscribers: { notify, notifyView: jest.fn() },
    } as unknown as IPCBridge);
    const calls: number[] = [];
    const first = jest.fn(() => {
      calls.push(1);
    });
    const second = jest.fn(() => {
      calls.push(2);
    });

    const disposeFirst = emitter.on("ping", first);
    emitter.on("ping", first);
    emitter.on("ping", second);
    emitter.emit(1);

    expect(calls).toEqual([1, 2]);
    expect(first).toHaveBeenCalledTimes(1);
    disposeFirst();
    emitter.emit(2);
    expect(calls).toEqual([1, 2, 2]);
  });

  it("logs listener failures and continues local and external publication", async () => {
    @EdenNamespace("test")
    class Namespaced extends EdenEmitter<TestEvents> {
      public emit(): void {
        this.notify("ping", { value: 3 });
      }
    }

    const notify = jest.fn();
    const emitter = new Namespaced({
      eventSubscribers: { notify, notifyView: jest.fn() },
    } as unknown as IPCBridge);
    const errorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const finalListener = jest.fn();

    emitter.on("ping", () => {
      throw new Error("sync failure");
    });
    emitter.on("ping", async () => {
      throw new Error("async failure");
    });
    emitter.on("ping", finalListener);

    emitter.emit();
    await Promise.resolve();

    expect(finalListener).toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith("test/ping", { value: 3 });
    expect(errorSpy).toHaveBeenCalledTimes(2);
    errorSpy.mockRestore();
  });
});
