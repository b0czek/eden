# Add restart and power-off controls

[Handbook](README.md) · Prerequisite: [Create a consumer](consumer-development.md)

The consumer can provide host functions for restarting or powering off the machine.
Eden then shows the available actions in eveshell and on the login screen.

## Supply a provider

Each provider method returns an Effect.
Install a compatible Effect dependency as described in the [host guide](main-process-api.md#execute-host-work).
It succeeds when the operating system accepts the request and fails when scheduling fails.
This Linux example uses fixed `systemctl` arguments:

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createEden, type EdenPowerProvider } from "@edenapp/sdk";
import * as Effect from "effect/Effect";

const execFileAsync = promisify(execFile);
const powerAction = (action: "poweroff" | "reboot") =>
  Effect.tryPromise({
    try: () => execFileAsync("/usr/bin/systemctl", [action]),
    catch: (error) => error instanceof Error ? error : new Error(String(error)),
  }).pipe(Effect.asVoid);

const powerProvider: EdenPowerProvider = {
  poweroff: () => powerAction("poweroff"),
  reboot: () => powerAction("reboot"),
};

createEden({ powerProvider });
```

Use a platform adapter suited to your product, such as logind over D-Bus or an appliance supervisor.
Do not pass user input through a shell command.
The operating-system account running Eden must have permission for the chosen action.
On Linux, use a narrowly scoped polkit policy for the required operations.

## Control availability

Omit the provider to hide all power actions.
Supply only `reboot` or only `poweroff` to expose one action.
Eden derives capabilities from the supplied functions.

Before calling the provider, Eden stops managed daemons and apps.
Operation completion records preparation and host handoff.
It does not confirm that the operating system has finished shutting down.
Test provider failures with your platform adapter before enabling the controls in a deployed product.
