# Host Power Management

Eden can expose restart and power-off controls in eveshell and on the login
screen. The controls are available only when the consumer supplies a typed
host-side provider to `new Eden(...)`:

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Eden, type EdenPowerProvider } from "@edenapp/sdk";

const execFileAsync = promisify(execFile);

const powerProvider: EdenPowerProvider = {
  poweroff: async () => {
    await execFileAsync("/usr/bin/systemctl", ["poweroff"]);
  },
  reboot: async () => {
    await execFileAsync("/usr/bin/systemctl", ["reboot"]);
  },
};

new Eden({ powerProvider });
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
applications. The provider should resolve only after the host has accepted the
requested operation and should reject when the operation cannot be scheduled.

The operating-system account running Eden must be authorized for the chosen
integration. On Linux, configure a narrowly scoped polkit policy for the
required logind/systemd operations instead of running Eden as root.
