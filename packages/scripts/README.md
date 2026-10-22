# @edenapp/scripts

Build and development commands for Eden consumers and apps.

```bash
npm install --save-dev @edenapp/scripts
```

Run commands with `npx eden-build` or from a package script.
The [consumer guide](https://github.com/b0czek/eden/blob/main/docs/consumer-development.md)
shows the complete build setup.

| Command | Task |
| --- | --- |
| `eden-build scaffold-solid <app-id> [output-dir] --mode consumer` | Create a Solid app project |
| `eden-build dev [app-dir]` | Run an app in a standalone Eden development host |
| `eden-build copy-assets` | Copy runtime assets and generate the first-run seed into `dist/` |
| `eden-build apps` | Build apps selected in `eden.config.json` |
| `eden-build seed` | Generate only the seed file |
| `eden-build watch` | Start app development servers for a consumer |

Use `--help` after a command for its options.
For standalone host caching and reload behavior, see
[app development](https://github.com/b0czek/eden/blob/main/docs/app-development.md#control-development-startup).
