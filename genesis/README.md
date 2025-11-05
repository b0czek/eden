# @eden/genesis

📦 **Genesis** - "In the beginning..." Package and bundle Eden applications.

## Overview

Genesis is the official bundler for Eden apps. It packages your Eden applications into `.edenite` format - ready to be planted in any Eden environment.

## Installation

```bash
npm install -g @eden/genesis
```

## Usage

### Build an App

Bundle your app into `.edenite` format:

```bash
genesis build ./my-app
```

With custom output path:

```bash
genesis build ./my-app -o ./dist/my-app.edenite
```

Verbose output:

```bash
genesis build ./my-app -v
```

### Validate an App

Check if your app manifest and files are valid:

```bash
genesis validate ./my-app
```

### Get Info

Display information about an `.edenite` file:

```bash
genesis info my-app-1.0.0.edenite
```

## App Structure

Your Eden app directory should contain:

```
my-app/
├── manifest.json     # Required: App metadata
├── backend.js        # Required: Backend entry point
├── index.html        # Required: Frontend entry point
├── app.js            # Optional: Frontend logic
├── icon.png          # Optional: App icon
└── ...               # Any other app files
```

## manifest.json

```json
{
  "id": "com.example.myapp",
  "name": "My App",
  "version": "1.0.0",
  "description": "My awesome Eden app",
  "author": "Your Name",
  "backend": {
    "entry": "backend.js"
  },
  "frontend": {
    "entry": "index.html"
  },
  "icon": "icon.png"
}
```

## .edenite Format

An `.edenite` file is a ZIP archive containing all app files. It can be installed directly into Eden.

## License

MIT
