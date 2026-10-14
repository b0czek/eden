import { MessageChannel } from "node:worker_threads";
import { gate } from "../../../tests/support/async";
import { createAppBusAPI } from "./api-factory";
import {
  createAppBusState,
  createPortConnection,
  handleAppBusPort,
  wrapDOMPort,
} from "./port-channel";
import type { ShellTransport } from "./shell-transport";

function setup(exec: ShellTransport["exec"]) {
  const state = createAppBusState();
  return { state, api: createAppBusAPI({ transport: { exec } }, state) };
}

test("rejected duplicate exposure preserves the original working service, including while registration is pending", async () => {
  const acceptance = gate<{ mode: "result"; result: { success: boolean } }>();
  const { api, state } = setup(
    (() => acceptance.promise) as ShellTransport["exec"],
  );
  const registration = api.exposeService("echo", (connection, client) => {
    connection.handle("echo", (payload) => ({ payload, client: client.appId }));
  });
  const replacement = () => {
    throw new Error("Replacement must not serve clients");
  };
  expect(await api.exposeService("echo", replacement)).toMatchObject({
    success: false,
  });
  acceptance.release({ mode: "result", result: { success: true } });
  expect(await registration).toEqual({ success: true });
  expect(await api.exposeService("echo", replacement)).toMatchObject({
    success: false,
  });

  const { port1, port2 } = new MessageChannel();
  const peer = createPortConnection(
    wrapDOMPort(port1 as unknown as MessagePort),
    "peer",
    new Map(),
    new Map(),
    state.messageIdGenerator,
  );
  try {
    handleAppBusPort(
      wrapDOMPort(port2 as unknown as MessagePort),
      {
        connectionId: "service",
        role: "service",
        serviceName: "echo",
        sourceAppId: "client",
      },
      state,
    );
    await expect(peer.request("echo", "still working")).resolves.toEqual({
      payload: "still working",
      client: "client",
    });
  } finally {
    peer.close();
    port2.close();
  }
});

test.each(["rejection", "transport error"])(
  "a failed first registration permits a retry after %s",
  async (failure) => {
    let attempts = 0;
    const { api } = setup((async () => {
      if (attempts++ === 0) {
        if (failure === "transport error")
          throw new Error("Transport unavailable");
        return {
          mode: "result",
          result: { success: false, error: "Registration rejected" },
        };
      }
      return { mode: "result", result: { success: true } };
    }) as ShellTransport["exec"]);
    const first = api.exposeService("echo", () => undefined);
    if (failure === "transport error")
      await expect(first).rejects.toThrow("Transport unavailable");
    else expect(await first).toMatchObject({ success: false });
    expect(await api.exposeService("echo", () => undefined)).toEqual({
      success: true,
    });
  },
);
