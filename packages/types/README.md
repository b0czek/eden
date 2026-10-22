# @edenapp/types

TypeScript type definitions for the Eden platform.

See the [Eden handbook](https://github.com/b0czek/eden/blob/main/docs/README.md)
for app and consumer workflows.

## Installation

For Eden app development:

```bash
npm install -D @edenapp/types
```

## TypeScript Configuration

For frontend APIs, include these types in `tsconfig.json`:

```json
{
  "compilerOptions": {
    "types": ["@edenapp/types/global"]
  }
}
```

For a backend, use `"types": ["node", "@edenapp/types/worker"]` instead.
Keep other types your project needs in the same array.

## Usage

The declarations provide types for the injected frontend APIs:

```typescript
// Use Eden API in your app's frontend
const files = await window.edenAPI.shellCommand("fs/readdir", {
  location: { volume: "home", path: "/Documents" },
});
```
