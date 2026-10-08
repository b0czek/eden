# IPC Architecture in Eden

Eden uses three distinct IPC (Inter-Process Communication) APIs to facilitate communication between different parts of the system. Each API serves a specific purpose and operates at different layers of the application architecture.

> **Note**: These APIs are automatically injected into the renderer process via Electron's context bridge. Access them via the `window` object - no imports required.

## Overview

| API         | Purpose                  | Communication Path         | Key Feature                        |
| ----------- | ------------------------ | -------------------------- | ---------------------------------- |
| **EdenAPI** | Shell commands & events  | App ↔ Main Process         | System operations                  |
| **AppAPI**  | Frontend ↔ Backend       | App Frontend ↔ App Backend | Request/response messaging         |
| **AppBus**  | App-to-App communication | App A ↔ App B              | Service discovery & peer messaging |

---

## EdenAPI

The **EdenAPI** provides apps with access to system-level operations managed by the main process. It handles shell commands (operations that require elevated privileges or system access) and event subscriptions (listening to system-wide events).

### Access

- **Frontend**: `window.edenAPI`
- **Backend**: `worker.edenAPI` (exposed via `backend-preload.ts`)

### Core Methods

```typescript
interface EdenAPI {
  // Execute shell commands with type-safe arguments
  shellCommand<T extends CommandName>(
    command: T,
    args: CommandArgs<T>
  ): Promise<CommandResult<T>>;

  // Subscribe to system events
  subscribe<T extends EventName>(
    event: T,
    callback: (data: EventData<T>) => void
  ): Promise<void>;

  // Unsubscribe from events
  unsubscribe<T extends EventName>(
    event: T,
    callback: (data: EventData<T>) => void
  ): void;

  // Check if an event is supported
  isEventSupported(event: string): Promise<boolean>;

  // Get launch arguments
  getLaunchArgs(): string[];
}
```

### Usage Example

```typescript
// Execute a shell command
const launch = await window.edenAPI.shellCommand("process/launch", {
  appId: "com.example.myapp",
  bounds: { x: 0, y: 0, width: 800, height: 600 },
});
await launch.result();

// Subscribe to system events
await window.edenAPI.subscribe("process/launched", (data) => {
  console.log("Process launched:", data);
});

// Check event support
const hasMinimize = await window.edenAPI.isEventSupported("window/minimize");
```

### How It Works

1. **Command Execution**: The `shellCommand` method sends a command through `ipcRenderer.invoke("shell-command", ...)` to the main process
2. **CommandRegistry**: The main process uses `CommandRegistry` to route commands to the appropriate handlers (e.g., `process/launch`, `view/create`, etc.)
3. **Permission Checking**: Commands can require permissions (e.g., `"process/launch"` requires `"process/launch"` permission)
4. **Event System**: Events use a separate `shell-message` channel where the main process broadcasts events to subscribed apps

---

## AppAPI

The **AppAPI** enables direct communication between an app's frontend (renderer process) and its backend (utility process). It uses MessagePorts for efficient bidirectional communication without routing through the main process.

### Access

- **Frontend**: `window.getAppAPI()` returns the connection
- **Backend**: `worker.getAppAPI()` returns the connection

### Connection Interface

```typescript
interface AppBusConnection<
  TSend extends MessageSchema = MessageSchema,
  TReceive extends MessageSchema = MessageSchema,
  TRequest extends RequestSchema = RequestSchema,
  THandle extends RequestSchema = RequestSchema
> {
  // Fire-and-forget messaging
  send<K extends keyof TSend>(method: K, args?: TSend[K]): void;

  // Listen for messages
  on<K extends keyof TReceive>(
    method: K,
    callback: (args: TReceive[K]) => void
  ): void;
  once<K extends keyof TReceive>(
    method: K,
    callback: (args: TReceive[K]) => void
  ): void;
  off<K extends keyof TReceive>(
    method: K,
    callback: (args: TReceive[K]) => void
  ): void;

  // Request/response
  request<K extends keyof TRequest>(
    method: K,
    args?: TRequest[K]["args"]
  ): Promise<TRequest[K]["result"]>;

  // Handle requests from the other side
  handle<K extends keyin THandle>(
    method: K,
    handler: (args: THandle[K]["args"]) => THandle[K]["result"] | Promise<THandle[K]["result"]>
  ): void;
  removeHandler<K extends keyof THandle>(method: K): void;

  // Connection management
  isConnected(): boolean;
  onClose(callback: () => void): void;
  close(): void;
}
```

### Usage Example

```typescript
// Define a protocol for type safety
interface MyProtocol {
  // Messages frontend sends, backend receives
  hostMessages: {
    ping: {};
    "get-data": { id: string };
  };
  // Messages backend sends, frontend receives
  peerMessages: {
    pong: { timestamp: number };
    "data-result": { data: any };
  };
  // Requests frontend makes, backend handles
  hostHandles: {
    compute: { input: number } & { result: number };
  };
  // Requests backend makes, frontend handles
  peerHandles: {
    ping: {} & { pong: boolean };
  };
}

// Frontend
const appAPI = window.getAppAPI() as HostConnection<MyProtocol>;

// Send fire-and-forget message
appAPI.send("ping", {});

// Listen for messages from backend
appAPI.on("pong", (payload) => {
  console.log("Pong received at:", payload.timestamp);
});

// Make a request and wait for response
const result = await appAPI.request("compute", { input: 42 });
console.log("Computed result:", result);
```

### How It Works

1. **MessagePort Creation**: When an app starts, the main process creates a `MessageChannel` and transfers one port to the frontend and one to the backend
2. **Port Wrapping**: Ports are wrapped with the `IPCPort` interface to normalize DOM and Electron port APIs
3. **Message Routing**: The `createPortConnection` function sets up handlers for:
   - `message`: Fire-and-forget messages dispatched to `on()` listeners
   - `request`: Requests that expect a response, dispatched to `handle()` handlers
   - `response`: Responses to outgoing requests
4. **Request/Response Pattern**: Each request has a unique `messageId` for correlation and timeout handling (default 30s)

---

## AppBus

**AppBus** (Application Bus) enables communication between different apps running in Eden. It provides service discovery, connection management, and direct peer-to-peer messaging between apps using MessagePorts.

### Access

- **Frontend**: `window.appBus`
- **Backend**: `worker.appBus`

### API Interface

```typescript
interface AppBusAPI {
  // Register a service for other apps to connect to
  exposeService(
    serviceName: string,
    onConnect: (connection: AppBusConnection, clientInfo: ClientInfo) => void,
    options?: { description?: string; allowedClients?: string[] }
  ): Promise<{ success: boolean; error?: string }>;

  // Unregister a service
  unexposeService(serviceName: string): Promise<{ success: boolean }>;

  // Connect to another app's service
  connect(
    targetAppId: string,
    serviceName: string
  ): Promise<AppBusConnection | { error: string }>;

  // List all available services
  listServices(): Promise<{ services: ServiceInfo[] }>;

  // List services from a specific app
  listServicesByApp(appId: string): Promise<{ services: ServiceInfo[] }>;
}
```

### Usage Example

**Exposing a Service (App A)**

```typescript
// App A - expose a service
await window.appBus.exposeService(
  "data-provider",
  (connection, clientInfo) => {
    console.log(`Client connected: ${clientInfo.appId}`);

    // Handle requests from clients
    connection.handle("get-data", ({ key }) => {
      return { value: database.get(key) };
    });

    // Send updates to clients
    connection.on("subscribe-updates", () => {
      connection.send("update", { data: "new value" });
    });
  },
  { description: "Provides data to other apps" }
);
```

**Connecting to a Service (App B)**

```typescript
// App B - connect to App A's service
const connection = await window.appBus.connect("com.app-a", "data-provider");

if ("error" in connection) {
  console.error("Failed to connect:", connection.error);
  return;
}

// Make requests to the service
const result = await connection.request("get-data", { key: "mykey" });

// Listen for updates
connection.on("update", (payload) => {
  console.log("Received update:", payload.data);
});
```

**Service Discovery**

```typescript
// List all available services
const { services } = await window.appBus.listServices();
console.log("Available services:", services);

// Filter by app
const appServices = await window.appBus.listServicesByApp("com.app-a");
```

### How It Works

1. **Service Registration**: When `exposeService` is called:
   - The callback is stored locally
   - A command `appbus/register` is sent to the main process
   - `AppChannelHandler` registers the service in `AppChannelManager`

2. **Service Connection**: When `connect` is called:
   - `AppChannelManager` validates the target service exists
   - A `MessageChannel` is created with two ports
   - The provider's port is sent via `appbus-port` IPC event
   - The caller's port is sent via `appbus-port` IPC event
   - Both sides receive the port and create `AppBusConnection` objects

3. **Message Routing**: Once connected, apps communicate directly using the same message patterns as AppAPI:
   - `send()`/`on()` for fire-and-forget messages
   - `request()`/`handle()` for request/response

### Service Manifest Declaration

Apps can declare services in their manifest:

```json
{
  "services": [
    {
      "name": "my-service",
      "description": "My app's service",
      "allowedClients": ["com.trusted.app"]
    }
  ]
}
```

---

## Summary

| Aspect     | EdenAPI          | AppAPI               | AppBus          |
| ---------- | ---------------- | -------------------- | --------------- |
| **Access** | `window.edenAPI` | `window.getAppAPI()` | `window.appBus` |

Each API is optimized for its specific use case while maintaining type safety and consistent interfaces across frontend and backend contexts.

---

## TypeScript Support

To enable full type inference for these APIs, configure your TypeScript appropriately:

### Frontend

Add `@edenapp/types/global` to your frontend TypeScript configuration:

```json
{
  "compilerOptions": {
    "types": ["@edenapp/types/global"]
  }
}
```

This provides automatic type declarations for `window.edenAPI`, `window.appBus`, and `window.getAppAPI()` without any imports.

### Backend

Add `node` and `@edenapp/types/worker` to your backend TypeScript configuration:

```json
{
  "compilerOptions": {
    "types": ["node", "@edenapp/types/worker"]
  }
}
```

This provides type declarations for `worker.edenAPI`, `worker.appBus`, and `worker.getAppAPI()`.

## Operations

Commands declare a mode: `result` (the default) or `operation`. Result commands
complete before `shellCommand` resolves with their result. Operation commands return
a typed operation object after validation and authorization. Eden executes accepted
work independently of the submitting view or backend and retains its status and completion.

```typescript
const copy = await window.edenAPI.shellCommand(
  "fs/cp",
  { from, to, overwrite: false },
  { requestKey: "copy-invoice-2026" },
);
const stopWatching = await copy.watch(snapshot => {
  console.log(snapshot.status, snapshot.phase, snapshot.progress);
});
await copy.result();
stopWatching();
```

`worker.edenAPI.shellCommand` returns the same operation objects. `copy.get()` reads a
snapshot and `operations.list()` lists the caller's operations. Watchers subscribe before
reading the retained snapshot and reconcile changes using increasing revisions.
Completion before observation works too. A failed operation preserves a typed
domain failure response when available; `result()` returns that response. Other
failures reject with a sanitized error.

For operations with `snapshot.cancellable`, call `copy.cancel()` to
request a stop. Continue observing until cleanup completes. A cancelled operation
has status `cancelled`, and `copy.result()` rejects with an `AbortError`. Cancelling
a filesystem copy removes its incomplete destination and restores the previous
destination when replacing an existing file. The source remains intact.

Progress watching is optional. `copy.watch(listener)` receives changes for that
operation, including its current retained snapshot. `copy.result()` receives only
completion updates. Unchanged phase and progress reports do not produce duplicate
updates. Work without observers still retains its status and completion for later
inspection. A direct subscription to `operation/changed` observes all operations
owned by the caller's app and login session.

Request keys are optional. Within the same app and login session, repeating a key
with the same command and arguments returns the original retained operation. Reusing
the key with different arguments or another command fails. Callers decide whether
to resubmit; the API does not retry automatically.

Each operation exposes a serializable `handle` with `{ command, id }`. Persist or
send that handle when needed, and use `edenAPI.operations.from(handle)` to restore
its `get`, `watch`, `result`, and `cancel` methods. An app can inspect its operations
after reopening in the same login session.
Other apps and sessions cannot inspect them or receive their changes. Hosts can
use `eden.operations.get`, `list`, and `onChanged` for privileged read-only
observation. Accepted work drains before session changes and runtime shutdown.
Completed records remain in memory for fifteen minutes, subject to a runtime-wide
limit of 256 completed records. Active records remain until completion. Operation
handles live for one Eden runtime.

IPC responses have a ten-second deadline. Accepted operation execution has no
transport deadline.

Lifecycle operations accept requests before caller teardown begins. Successful
session transitions and self-exit can close the caller before it observes
completion. Power operation completion records preparation and host handoff;
observe it through the host API when needed. Runtime disappearance does not
confirm that the operating system has finished powering off.
