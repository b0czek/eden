# @edenapp/types

TypeScript type definitions for the Eden platform.

## Installation

For Eden app development:

```bash
npm install -D @edenapp/types
```

## Usage

Import types in your Eden app:

```typescript
// Use Eden API in your app's frontend
const files = await window.edenAPI.shellCommand('fs/readdir', {
  path: '/home/user/documents'
});
```

## Documentation

For complete Eden platform documentation, visit the main [Eden repository](https://github.com/b0czek/eden).

## License

MIT
