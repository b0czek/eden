import "reflect-metadata";

import { EdenEmitter } from "./EdenEmitter";
import { EdenNamespace } from "./CommandDecorators";

interface TestEvents {
  "ping": { value: number };
}

describe("EdenEmitter", () => {
  it("throws when notify is used without a namespace", () => {
    class NoNamespace extends EdenEmitter<TestEvents> {
      public emit(): void {
        this.notify("ping", { value: 1 });
      }
    }

    const emitter = new NoNamespace({ eventSubscribers: { notify: jest.fn(), notifyView: jest.fn() } } as any);

    expect(() => emitter.emit()).toThrow(/must be decorated with @EdenNamespace/);
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
    const emitter = new Namespaced({ eventSubscribers: { notify, notifyView } } as any);

    emitter.emit();
    expect(notify).toHaveBeenCalledWith("test/ping", { value: 42 });

    emitter.emitTo(12);
    expect(notifyView).toHaveBeenCalledWith(12, "test/ping", { value: 7 });
  });
});
