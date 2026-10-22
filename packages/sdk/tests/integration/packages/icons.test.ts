import * as fs from "node:fs/promises";
import * as path from "node:path";
import { DEFAULT_PACKAGE_ICON_DATA_URL } from "../../../src/applications/packages/default-icon";
import { log } from "../../../src/platform/logging/logger";
import { testApp } from "../../support/apps";
import { createTestEden } from "../../support/create-test-eden";

it("contains renderer icon reads to the app package, including symlink targets", async () => {
  const eden = await createTestEden();
  const app = testApp("com.example.icons", {
    permissions: ["package/read"],
    window: { mode: "floating", injections: { css: "none", appFrame: "none" } },
  });
  const directory = path.join(eden.paths.appsDirectory, app.id);
  try {
    await fs.mkdir(directory);
    const outside = path.join(eden.paths.root, "private.txt");
    await fs.writeFile(outside, "HOST_PRIVATE_CONTENT");
    await fs.writeFile(path.join(directory, "icon.svg"), "<svg>valid</svg>");
    await fs.mkdir(path.join(directory, "assets"));
    await fs.symlink(outside, path.join(directory, "escaped.svg"));
    await fs.symlink(
      path.join(directory, "icon.svg"),
      path.join(directory, "assets/linked.svg"),
    );
    const { installedPackages, processes } = eden.runtime.services;
    installedPackages.register(app);
    eden.runtime.services.permissions.registerApp(app.id, app.permissions);
    const user = await eden.runtime.effects.run(
      eden.runtime.users.create({
        username: "restricted",
        name: "Restricted",
        password: "password",
        grants: [`apps/launch/${app.id}`],
        directoryRestriction: "restricted",
      }),
    );
    await eden.runtime.effects.run(
      eden.runtime.sessions.login(user.username, "password"),
    );
    await eden.complete("process/launch", { appId: app.id });
    const contentsId = eden.getAppView(app.id).view.webContents.id;
    const readIcon = (icon: string) => {
      installedPackages.register({ ...app, icon });
      return eden.executeFromView<{ icon: string }>(
        contentsId,
        "package/get-icon",
        {
          packageId: app.id,
        },
      );
    };
    const expected = `data:image/svg+xml;base64,${Buffer.from("<svg>valid</svg>").toString("base64")}`;
    await expect(readIcon("icon.svg")).resolves.toEqual({ icon: expected });
    await expect(readIcon("assets/linked.svg")).resolves.toEqual({
      icon: expected,
    });
    const warnings = jest
      .spyOn(log, "warn")
      .mockImplementation(() => undefined);
    try {
      for (const icon of ["../../private.txt", outside, "escaped.svg"]) {
        await expect(readIcon(icon)).resolves.toEqual({
          icon: DEFAULT_PACKAGE_ICON_DATA_URL,
        });
      }
      expect(warnings).toHaveBeenCalledTimes(3);
      for (const [, error] of warnings.mock.calls)
        expect(error).toMatchObject({ _tag: "PackageResourceError" });
    } finally {
      warnings.mockRestore();
    }
    expect(processes.getAppInstance(app.id)).toBeDefined();
  } finally {
    await eden.dispose();
  }
});
