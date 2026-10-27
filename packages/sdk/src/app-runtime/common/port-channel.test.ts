import { MessageChannel } from "node:worker_threads";
import type { AppBusConnection } from "@edenapp/types";
import { gate } from "../../../tests/support/async";
import { createPortConnection, wrapDOMPort } from "./port-channel";

const connections: AppBusConnection[] = [];
function pair() {
  const { port1, port2 } = new MessageChannel();
  const first = createPortConnection(
    wrapDOMPort(port1 as unknown as MessagePort),
  );
  const second = createPortConnection(
    wrapDOMPort(port2 as unknown as MessagePort),
  );
  connections.push(first, second);
  return { first, second };
}

afterEach(() => {
  for (const connection of connections) connection.close();
  connections.length = 0;
  jest.useRealTimers();
});

test("each connection owns its requests in both directions", async () => {
  const first = pair();
  const second = pair();
  first.first.handle("echo", (value) => ({ from: "first client", value }));
  first.second.handle("echo", (value) => ({ from: "first service", value }));
  second.second.handle("echo", (value) => ({ from: "second service", value }));
  await expect(
    Promise.all([
      first.first.request("echo", 1),
      first.second.request("echo", 2),
      second.first.request("echo", 3),
    ]),
  ).resolves.toEqual([
    { from: "first service", value: 1 },
    { from: "first client", value: 2 },
    { from: "second service", value: 3 },
  ]);
});

test("delivers messages once and removes listeners", async () => {
  const { first, second } = pair();
  const received: string[] = [];
  const removed = () => {
    throw new Error("Removed listener ran");
  };
  first.on("notice", (value) => received.push(`on:${value}`));
  first.once("notice", (value) => received.push(`once:${value}`));
  first.on("notice", removed);
  first.off("notice", removed);
  first.handle("received", () => received);
  second.send("notice", "a");
  second.send("notice", "b");
  await expect(second.request("received")).resolves.toEqual([
    "on:a",
    "once:a",
    "on:b",
  ]);
});

test("reports handler and response serialization errors to the requester", async () => {
  const { first, second } = pair();
  second.handle("fail", () => {
    throw new Error("Handler failed");
  });
  second.handle("async-fail", async () => {
    throw new Error("Async handler failed");
  });
  second.handle("uncloneable", () => () => undefined);
  await expect(first.request("fail")).rejects.toThrow("Handler failed");
  await expect(first.request("async-fail")).rejects.toThrow(
    "Async handler failed",
  );
  await expect(first.request("uncloneable")).rejects.toThrow();
  second.removeHandler("fail");
  await expect(first.request("fail")).rejects.toThrow("No handler registered");
});

test("native peer closure rejects pending requests and closes the connection once", async () => {
  const { first, second } = pair();
  const started = gate();
  const finish = gate();
  second.handle("wait", () => {
    started.release();
    return finish.promise;
  });
  let closed = 0;
  first.onClose(() => {
    closed++;
  });
  const rejected = expect(first.request("wait")).rejects.toThrow(
    "Connection closed",
  );
  try {
    await started.promise;
    second.close();
    await rejected;
    expect(first.isConnected()).toBe(false);
    first.close();
    expect(closed).toBe(1);
    await expect(first.request("wait")).rejects.toThrow("Connection closed");
  } finally {
    finish.release();
  }
});

test("failed native sends release their request deadline", async () => {
  jest.useFakeTimers();
  const { first } = pair();
  await expect(first.request("uncloneable", () => undefined)).rejects.toThrow();
  expect(jest.getTimerCount()).toBe(0);
});

test("request deadlines reject the request and release its timer", async () => {
  jest.useFakeTimers();
  const { first } = pair();
  const rejected = expect(first.request("waiting")).rejects.toThrow(
    "timed out",
  );
  jest.advanceTimersByTime(30000);
  await rejected;
  expect(jest.getTimerCount()).toBe(0);
});
