import * as path from "node:path";

export function resolveConsumerPackageJson(packageName: string): string {
  return require.resolve(`${packageName}/package.json`, {
    paths: [process.cwd(), path.join(process.cwd(), "node_modules")],
  });
}
