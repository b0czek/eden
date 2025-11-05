# Eden - Modular Electron Desktop Environment

Eden is an extensible Electron-based desktop environment that allows users to install and run modular applications. Each app consists of a backend (running in a worker thread) and a frontend (displayed in a WebContentsView), creating a secure and isolated execution environment.

## Architecture

### Core Components

1. **AppManager** (`src/main/core/AppManager.ts`)

   - Handles app installation, uninstallation, and lifecycle
   - Manages the apps directory and manifest loading
   - Coordinates between WorkerManager and ViewManager

2. **WorkerManager** (`src/main/core/WorkerManager.ts`)

   - Creates and manages worker threads for app backends
   - Each app's backend code runs in an isolated worker thread
   - Handles worker lifecycle, messaging, and resource limits

3. **ViewManager** (`src/main/core/ViewManager.ts`)

   - Manages WebContentsView instances for app frontends
   - Each app's UI renders in its own isolated view
   - Handles view positioning, visibility, and lifecycle

4. **IPCBridge** (`src/main/core/IPCBridge.ts`)
   - Central communication hub for all IPC messages
   - Routes messages between main process, workers, and views
   - Handles request/response patterns with timeouts

## App Structure

Eden apps are directories containing:

### Required Files

1. **manifest.json** - App metadata and configuration

```json
{
  "id": "com.example.myapp",
  "name": "My App",
  "version": "1.0.0",
  "backend": {
    "entry": "backend.js"
  },
  "frontend": {
    "entry": "index.html",
    "options": {
      "nodeIntegration": false,
      "contextIsolation": true,
      "preload": "preload.js"
    }
  }
}
```

2. **backend.js** - Backend code (runs in worker thread)

   - Access to `workerData` with app info
   - Communicates via `parentPort.postMessage()`
   - Can perform heavy computations, data processing, etc.

3. **index.html** - Frontend HTML entry point

   - Standard HTML/CSS/JS
   - Sandboxed and isolated per app

4. **preload.js** (optional) - Preload script for frontend
   - Exposes safe APIs to the renderer using contextBridge
   - Enables controlled communication with backend

## Getting Started

### Installation

```bash
npm install
```

### Build

```bash
npm run build
```

### Run

```bash
npm start
```

Or for development:

```bash
npm run dev
```

## Installing Apps

Apps are stored in the Eden apps directory (default: `userData/eden-apps`). To install an app:

1. Create an app directory with the required structure
2. Use the Eden shell UI to install from a local directory
3. Or copy directly to the apps directory and restart Eden

See the `example-app/` directory for a complete example.

## Example App

The included example app demonstrates:

- Backend/frontend communication via IPC
- Message passing with request/response patterns
- UI interaction and state management
- Proper app structure and manifest configuration

### Running the Example App

1. Build and start Eden
2. Click "Install App" in the shell
3. Enter the path to `example-app` directory
4. Click on "Hello World" in the sidebar to launch it

## Development

### Project Structure

```
eden/
├── src/
│   ├── main/
│   │   ├── core/
│   │   │   ├── AppManager.ts      # App lifecycle management
│   │   │   ├── WorkerManager.ts   # Worker thread management
│   │   │   ├── ViewManager.ts     # View management
│   │   │   └── IPCBridge.ts       # IPC communication hub
│   │   └── index.ts               # Main process entry
│   ├── renderer/
│   │   ├── index.html             # Shell UI
│   │   ├── renderer.ts            # Shell logic
│   │   └── preload.ts             # Shell preload script
│   └── types/
│       └── index.ts               # TypeScript definitions
├── example-app/                   # Example Eden app
│   ├── manifest.json
│   ├── backend.js
│   ├── index.html
│   ├── preload.js
│   └── app.js
├── package.json
└── tsconfig.json
```

### TypeScript Configuration

- Main process: `tsconfig.json` - Targets Node.js environment
- Renderer: `tsconfig.renderer.json` - Targets DOM environment

### Building Apps

Apps can be built with any tools or frameworks. Requirements:

- Must follow the manifest structure
- Backend must be executable Node.js code
- Frontend must be standard HTML/CSS/JS

## Security

Eden implements several security measures:

1. **Sandboxing**: Each app runs in an isolated context
2. **Context Isolation**: Renderer processes have context isolation enabled
3. **Worker Threads**: Backend code runs in separate worker threads
4. **Permissions**: Apps declare required permissions in manifest
5. **No Node Integration**: Frontend has no direct Node.js access (use preload)

## IPC Message Format

All IPC messages follow a standard format:

```typescript
{
  type: string;           // Message type/action
  source: string;         // Source app ID or 'system'
  target: string;         // Target app ID or 'system'
  payload: any;           // Message data
  messageId: string;      // Unique message ID
  replyTo?: string;       // Original message ID for replies
  timestamp: number;      // Unix timestamp
}
```

## Future Enhancements

Potential areas for expansion:

- App marketplace/discovery
- Inter-app communication protocols
- Enhanced permission system
- App signing and verification
- Hot reload for development
- Plugin system for Eden itself
- Workspace/session management
- App update mechanism

## License

MIT

## Contributing

Contributions welcome! This is an infrastructure-focused project with room for many enhancements.
