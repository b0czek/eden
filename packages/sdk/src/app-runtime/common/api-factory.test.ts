import { MessageChannel } from "node:worker_threads";
import { gate } from "../../../tests/support/async";
import { createAppBusAPI } from "./api-factory";
import {
  createAppBusState,
  createPortConnection,
  handleAppBusPort,
  handlePortClosed,
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

test.each(["before", "after"] as const)(
  "connect returns the connection created when its port arrives %s the command response",
  async (arrival) => {
    const response = gate<{
      mode: "result";
      result: { success: boolean; connectionId: string };
    }>();
    const { state, api } = setup(
      (() => response.promise) as ShellTransport["exec"],
    );
    const { port1, port2 } = new MessageChannel();
    const peer = createPortConnection(
      wrapDOMPort(port1 as unknown as MessagePort),
    );
    peer.handle("echo", (value) => value);
    const deliver = () =>
      handleAppBusPort(
        wrapDOMPort(port2 as unknown as MessagePort),
        {
          connectionId: "client",
          role: "client",
          serviceName: "echo",
          targetAppId: "provider",
        },
        state,
      );
    try {
      const connecting = api.connect("provider", "echo");
      if (arrival === "before") deliver();
      response.release({
        mode: "result",
        result: { success: true, connectionId: "client" },
      });
      if (arrival === "after") {
        await response.promise;
        expect(state.pendingConnections.has("client")).toBe(true);
        deliver();
      }
      const connection = await connecting;
      if ("error" in connection) throw new Error(connection.error);
      expect(connection).toBe(state.connections.get("client"));
      await expect(connection.request("echo", arrival)).resolves.toBe(arrival);
      connection.close();
      expect(state.connections.size).toBe(0);
      expect(state.pendingConnections.size).toBe(0);
    } finally {
      peer.close();
      for (const connection of state.connections.values()) connection.close();
      port2.close();
    }
  },
);

test("main-process closure settles a connection still waiting for its port", async () => {
  const response = gate<{
    mode: "result";
    result: { success: boolean; connectionId: string };
  }>();
  const { state, api } = setup(
    (() => response.promise) as ShellTransport["exec"],
  );
  const connecting = api.connect("provider", "echo");
  response.release({
    mode: "result",
    result: { success: true, connectionId: "cancelled" },
  });
  await response.promise;
  handlePortClosed(state, "cancelled");
  await expect(connecting).resolves.toEqual({
    error: "Connection cancelled closed",
  });
  expect(state.pendingConnections.size).toBe(0);
});
