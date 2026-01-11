# 🌿 Eden Desktop Environment

> A modern, modular desktop environment framework built on Electron. Create beautiful, tiled desktop experiences with a powerful app ecosystem.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## ✨ Overview

Eden is a complete desktop environment SDK that lets you build custom desktop experiences with a focus on modularity, security, and developer experience. It provides window management with tiling support, a robust IPC architecture, and a beautiful design system out of the box.

![Eden Desktop Environment](images/screenshot.png)

## 🚀 Best Features

-   **🪟 Window Management** - Tiling window manager (horizontal, vertical, grid) with floating window support
-   **🔌 Three-Layer IPC** - EdenAPI (system ops), AppAPI (frontend↔backend), AppBus (app-to-app communication)
-   **🎨 EdenCSS Design System** - Glassmorphism UI with dark theme, component library, and design tokens
-   **📦 Genesis Bundler** - App packaging with Zstandard compression and integrity verification
-   **🔐 Permission System** - Granular access control for filesystem, database, processes, and more
-   **🎯 Built-in Apps** - File manager, editor, settings, launcher, browser, and more
-   **🛠️ TypeScript First** - Full type safety with code generation, and comprehensive docs
-   **💾 Data Management** - Per-app SQLite databases, persistent settings, and file associations

## 📖 Quick Start

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/eden.git
cd eden

# Install dependencies
pnpm install

# Build all packages
pnpm run sdk:build
pnpm run scripts:build
pnpm run genesis:build
```

### Running the Example

```bash
# Run the example desktop environment
pnpm dev
```

This will build and launch the example Eden desktop environment with hot reload enabled.

### Building an App

An Eden app is a web application (frontend-only or full-stack with Node.js backend) that runs within the Eden desktop environment. Apps are defined by a `manifest.json` file and can be packaged into `.edenite` archives.

```bash
# Using Genesis bundler
genesis build ./my-app -o ./dist/my-app.edenite
```

## 📚 Documentation

-   **[App Development Guide](docs/app-development.md)**: Learn how to build Eden apps
-   **[IPC Architecture](docs/ipc-architecture.md)**: Deep dive into Eden's IPC system
-   **[Genesis README](packages/genesis/README.md)**: App bundling and packaging
-   **[EdenCSS Documentation](packages/sdk/edencss/README.md)**: Design system reference

## 📝 License

MIT License - see [LICENSE](LICENSE) file for details.
