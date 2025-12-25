# Eden CSS

Frosted glass design system for Eden. Dark theme, glassmorphism, ready-to-use components.

## Usage

Eden CSS is **automatically injected** into apps. No imports needed.

Control injection in `manifest.json`:

```json
{
  "window": {
    "injections": {
      "css": "full" // "full" | "tokens" | "none"
    }
  }
}
```

## Design Tokens

All tokens use `--eden-` prefix. **See [`tokens.css`](./tokens.css) for everything.**

```css
/* Common patterns */
background: var(--eden-color-bg-glass-medium);
backdrop-filter: var(--eden-glass-medium);
color: var(--eden-color-text-primary);
padding: var(--eden-space-md);
border-radius: var(--eden-radius-lg);
box-shadow: var(--eden-shadow-md);
transition: all var(--eden-transition-base);
```

| Prefix                | What it does                                         |
| --------------------- | ---------------------------------------------------- |
| `--eden-color-*`      | Colors (bg, surface, text, accent, border, semantic) |
| `--eden-space-*`      | Spacing (xs → 3xl)                                   |
| `--eden-radius-*`     | Border radius                                        |
| `--eden-shadow-*`     | Box shadows                                          |
| `--eden-glass-*`      | Backdrop blur effects                                |
| `--eden-font-*`       | Typography                                           |
| `--eden-transition-*` | Animations                                           |
| `--eden-z-*`          | Z-index layers                                       |

Edit `tokens.json` → run `pnpm run tokens:build` to regenerate.

---

## Utilities

📖 **See [`utilities.css`](./utilities.css) for all classes.**

```html
<!-- Glass effects -->
<div class="eden-glass-medium">Frosted glass</div>

<!-- Layout -->
<div class="eden-flex-center eden-gap-md">Centered with gap</div>

<!-- Spacing: eden-{m|p}-{xs|sm|md|lg|xl} -->
<div class="eden-p-lg eden-m-sm">Padded & margined</div>

<!-- Text -->
<span class="eden-text-secondary eden-text-sm">Muted small text</span>

<!-- Interactive (hover lift effect) -->
<div class="eden-interactive">Hover me</div>

<!-- Animations -->
<div class="eden-animate-fade-in">Appears smoothly</div>
```

---

## Components

📖 **See [`components/`](./components/) for all component CSS files.**

### Buttons

```html
<button class="eden-btn">Default</button>
<button class="eden-btn eden-btn-primary">Primary</button>
<button class="eden-btn eden-btn-danger">Danger</button>
<button class="eden-btn eden-btn-ghost">Ghost</button>
```

Variants: `primary`, `secondary`, `success`, `danger`, `ghost`, `outline`  
Sizes: `xs`, `sm`, `md`, `lg`

### Inputs

```html
<input class="eden-input" placeholder="Text input" />
<textarea class="eden-textarea"></textarea>
<select class="eden-select">
  ...
</select>
<input type="checkbox" class="eden-checkbox" />
<input type="radio" class="eden-radio" />
```

### Cards

```html
<div class="eden-card">
  <div class="eden-card-header">
    <h3 class="eden-card-title">Title</h3>
  </div>
  <div class="eden-card-body">Content</div>
  <div class="eden-card-footer">
    <button class="eden-btn eden-btn-primary">Action</button>
  </div>
</div>
```

Variants: `eden-card-glass`, `eden-card-elevated`, `eden-card-interactive`

### Modals

```html
<div class="eden-modal-overlay">
  <div class="eden-modal">
    <div class="eden-modal-header">
      <h2 class="eden-modal-title">Title</h2>
      <button class="eden-modal-close">×</button>
    </div>
    <div class="eden-modal-body">Content</div>
    <div class="eden-modal-footer">...</div>
  </div>
</div>
```

### Badges & Tags

```html
<span class="eden-badge eden-badge-success">Active</span>
<span class="eden-badge-dot eden-badge-danger"></span>
<span class="eden-tag">Label</span>
```

### Lists & Menus

```html
<ul class="eden-list">
  <li class="eden-list-item eden-list-item-interactive">Click me</li>
</ul>

<ul class="eden-menu">
  <li class="eden-menu-item">Action</li>
  <li class="eden-menu-divider"></li>
  <li class="eden-menu-item eden-menu-item-danger">Delete</li>
</ul>
```

### Tabs

```html
<div class="eden-tabs">
  <div class="eden-tab-list">
    <button class="eden-tab eden-tab-active">Tab 1</button>
    <button class="eden-tab">Tab 2</button>
  </div>
  <div class="eden-tab-panels">
    <div class="eden-tab-panel eden-tab-panel-active">Content</div>
  </div>
</div>
```

### Progress

```html
<div class="eden-progress">
  <div class="eden-progress-bar" style="width: 60%"></div>
</div>
```

---

## Extras

- **Custom scrollbars** - Applied globally, thin with glass effect
