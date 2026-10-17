# Host Power Management

Eden can expose restart and power-off controls in eveshell and on the login
screen. The controls are available only when the consumer supplies a typed
host-side provider to `createEden(...)`:

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

The example uses fixed executable and argument values. Do not pass user input
or configuration through a shell. Consumers can instead implement the same
provider with logind over D-Bus, an appliance supervisor, or another native
platform integration.

Eden infers capabilities from the functions present on the provider. Omitting
the provider hides all power actions; omitting `reboot` or `poweroff` hides only
that action. This makes power management opt-in and keeps development hosts
safe by default without duplicating capability configuration.

Before invoking `poweroff()` or `reboot()`, Eden stops managed daemons and
applications. The provider returns an Effect that succeeds after the host accepts the
requested operation and fails when the operation cannot be scheduled.

The operating-system account running Eden must be authorized for the chosen
integration. On Linux, configure a narrowly scoped polkit policy for the
required logind/systemd operations instead of running Eden as root.
