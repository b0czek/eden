import { createEvent } from "./event";

it("owns listener lifetimes and deduplicates the same listener", () => {
  const event = createEvent<number>();
  const received: number[] = [];
  const listener = (value: number) => {
    received.push(value);
  };
  const stop = event.on(listener);
  event.on(listener);
  event.emit(3);
  expect(received).toEqual([3]);
  stop();
  stop();
  event.emit(4);
  expect(received).toEqual([3]);
  event.on(listener);
  event.dispose();
  event.emit(5);
  expect(received).toEqual([3]);
  expect(event.hasListeners()).toBe(false);
});

it("does not invoke a listener removed during delivery", () => {
  const event = createEvent<number>();
  const received: number[] = [];
  let stop = () => {};
  event.on(() => stop());
  stop = event.on((value) => {
    received.push(value);
  });
  event.emit(1);
  expect(received).toEqual([]);
});

it("isolates synchronous and asynchronous failures from other listeners", async () => {
  const error = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    const event = createEvent<number>();
    const received: number[] = [];
    event.on(() => {
      throw new Error("sync");
    });
    event.on(async () => {
      throw new Error("async");
    });
    event.on((value) => {
      received.push(value);
    });
    event.emit(7);
    await Promise.resolve();
    expect(received).toEqual([7]);
    expect(error).toHaveBeenCalledTimes(2);
  } finally {
    error.mockRestore();
  }
});
