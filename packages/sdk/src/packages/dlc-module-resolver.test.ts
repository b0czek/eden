import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import {
  type BackendDlcBinding,
  resolveDlcModuleSpecifier,
} from "../app-runtime/common/dlc-module-resolver";

describe("DLC backend module resolver", () => {
  let root: string;
  let packageRoot: string;
  let binding: BackendDlcBinding;

  beforeEach(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), "eden-dlc-resolver-"));
    packageRoot = path.join(root, "package");
    await fsp.mkdir(path.join(packageRoot, "dist"), { recursive: true });
    await fsp.writeFile(
      path.join(packageRoot, "dist/entry.mjs"),
      "export default true;",
    );
    binding = {
      capability: "backend-capability",
      roots: { "com.example.module": packageRoot },
    };
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it("maps an owned eden-dlc module URL to its contained file", () => {
    expect(
      resolveDlcModuleSpecifier(
        "eden-dlc://resource/backend-capability/com.example.module/dist/entry.mjs",
        binding,
      ),
    ).toBe(pathToFileURL(path.join(packageRoot, "dist/entry.mjs")).href);
  });

  it("rejects another capability, unknown packages, and encoded traversal", () => {
    expect(() =>
      resolveDlcModuleSpecifier(
        "eden-dlc://resource/other/com.example.module/dist/entry.mjs",
        binding,
      ),
    ).toThrow("capability");
    expect(() =>
      resolveDlcModuleSpecifier(
        "eden-dlc://resource/backend-capability/com.example.other/dist/entry.mjs",
        binding,
      ),
    ).toThrow("not available");
    expect(() =>
      resolveDlcModuleSpecifier(
        "eden-dlc://resource/backend-capability/com.example.module/%2e%2e%2foutside.mjs",
        binding,
      ),
    ).toThrow("path");
  });

  it("rejects links that resolve outside the DLC root", async () => {
    const outside = path.join(root, "outside.mjs");
    await fsp.writeFile(outside, "export default false;");
    fs.symlinkSync(outside, path.join(packageRoot, "dist/link.mjs"));

    expect(() =>
      resolveDlcModuleSpecifier(
        "eden-dlc://resource/backend-capability/com.example.module/dist/link.mjs",
        binding,
      ),
    ).toThrow("outside");
  });
});
