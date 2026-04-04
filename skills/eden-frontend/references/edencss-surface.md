# EdenCSS Surface

Generated from `packages/sdk/edencss/` and non-example apps under `packages/sdk/apps/com/eden/`.

## Bundle And Injection

- `packages/sdk/src/view-manager/ViewCreator.ts` defaults `window.injections.css` to `full` when omitted.
- `full` injection loads the built `eden.css` bundle; `tokens` loads the built `eden-tokens.css` bundle.
- `packages/sdk/edencss/eden.css` is the authoritative full bundle source in this repo.

### CSS Files Imported By `eden.css`

- `./tokens.css`
- `./utilities.css`
- `./components/buttons.css`
- `./components/inputs.css`
- `./components/cards.css`
- `./components/modals.css`
- `./components/avatar.css`
- `./components/badges.css`
- `./components/progress.css`
- `./components/lists.css`
- `./components/tabs.css`
- `./components/sidebar.css`

### CSS Files Imported By `index.ts`

- `./tokens.css`
- `./utilities.css`
- `./components/buttons.css`
- `./components/inputs.css`
- `./components/cards.css`
- `./components/modals.css`
- `./components/badges.css`
- `./components/progress.css`
- `./components/lists.css`
- `./components/tabs.css`

### Present In `eden.css` But Not Imported By `index.ts`

- `./components/avatar.css`
- `./components/sidebar.css`

## Token Groups

### `color` (37)

- `--eden-color-accent-blue`, `--eden-color-accent-blue-dark`, `--eden-color-accent-primary`, `--eden-color-accent-primary-active`, `--eden-color-accent-primary-hover`, `--eden-color-accent-purple`
- `--eden-color-accent-purple-light`, `--eden-color-bg-dark`, `--eden-color-bg-glass-light`, `--eden-color-bg-glass-medium`, `--eden-color-bg-glass-strong`, `--eden-color-bg-overlay`
- `--eden-color-bg-primary`, `--eden-color-bg-secondary`, `--eden-color-border-dark`, `--eden-color-border-light`, `--eden-color-border-medium`, `--eden-color-border-separator`
- `--eden-color-danger`, `--eden-color-danger-bg`, `--eden-color-danger-hover`, `--eden-color-info`, `--eden-color-success`, `--eden-color-success-hover`
- `--eden-color-surface-active`, `--eden-color-surface-elevated`, `--eden-color-surface-hover`, `--eden-color-surface-primary`, `--eden-color-surface-secondary`, `--eden-color-surface-tertiary`
- `--eden-color-text-inverse`, `--eden-color-text-muted`, `--eden-color-text-on-dark`, `--eden-color-text-primary`, `--eden-color-text-secondary`, `--eden-color-text-tertiary`
- `--eden-color-warning`

### `duration` (5)

- `--eden-duration-fast`, `--eden-duration-instant`, `--eden-duration-normal`, `--eden-duration-slow`, `--eden-duration-slower`

### `font` (21)

- `--eden-font-family-base`, `--eden-font-family-mono`, `--eden-font-letter-spacing-normal`, `--eden-font-letter-spacing-tight`, `--eden-font-letter-spacing-wide`, `--eden-font-line-height-normal`
- `--eden-font-line-height-relaxed`, `--eden-font-line-height-tight`, `--eden-font-size-2xl`, `--eden-font-size-3xl`, `--eden-font-size-4xl`, `--eden-font-size-base`
- `--eden-font-size-lg`, `--eden-font-size-md`, `--eden-font-size-sm`, `--eden-font-size-xl`, `--eden-font-size-xs`, `--eden-font-weight-bold`
- `--eden-font-weight-medium`, `--eden-font-weight-normal`, `--eden-font-weight-semibold`

### `glass` (4)

- `--eden-glass-light`, `--eden-glass-medium`, `--eden-glass-strong`, `--eden-glass-ultra`

### `layout` (5)

- `--eden-layout-dock-height`, `--eden-layout-icon-size-lg`, `--eden-layout-icon-size-md`, `--eden-layout-icon-size-sm`, `--eden-layout-icon-size-xl`

### `radius` (7)

- `--eden-radius-2xl`, `--eden-radius-lg`, `--eden-radius-md`, `--eden-radius-round`, `--eden-radius-sm`, `--eden-radius-xl`
- `--eden-radius-xs`

### `shadow` (7)

- `--eden-shadow-2xl`, `--eden-shadow-inner`, `--eden-shadow-lg`, `--eden-shadow-md`, `--eden-shadow-sm`, `--eden-shadow-xl`
- `--eden-shadow-xs`

### `space` (7)

- `--eden-space-2xl`, `--eden-space-3xl`, `--eden-space-lg`, `--eden-space-md`, `--eden-space-sm`, `--eden-space-xl`
- `--eden-space-xs`

### `transition` (7)

- `--eden-transition-base`, `--eden-transition-bounce`, `--eden-transition-ease-in`, `--eden-transition-ease-in-out`, `--eden-transition-ease-out`, `--eden-transition-fast`
- `--eden-transition-smooth`

### `z` (7)

- `--eden-z-base`, `--eden-z-dropdown`, `--eden-z-modal`, `--eden-z-overlay`, `--eden-z-popover`, `--eden-z-sticky`
- `--eden-z-tooltip`

## Utility Classes

### Glass Effects

- `eden-glass-light`, `eden-glass-medium`, `eden-glass-strong`, `eden-glass-ultra`

### Shadows

- `eden-shadow-xs`, `eden-shadow-sm`, `eden-shadow-md`, `eden-shadow-lg`, `eden-shadow-xl`, `eden-shadow-2xl`
- `eden-shadow-inner`

### Surfaces

- `eden-surface`, `eden-surface-secondary`, `eden-surface-elevated`

### Text Utilities

- `eden-text-primary`, `eden-text-secondary`, `eden-text-tertiary`, `eden-text-muted`, `eden-text-xs`, `eden-text-sm`
- `eden-text-base`, `eden-text-md`, `eden-text-lg`, `eden-text-xl`, `eden-text-2xl`, `eden-text-3xl`
- `eden-font-medium`, `eden-font-semibold`, `eden-font-bold`

### Spacing Utilities

- `eden-m-xs`, `eden-m-sm`, `eden-m-md`, `eden-m-lg`, `eden-m-xl`, `eden-p-xs`
- `eden-p-sm`, `eden-p-md`, `eden-p-lg`, `eden-p-xl`, `eden-gap-xs`, `eden-gap-sm`
- `eden-gap-md`, `eden-gap-lg`, `eden-gap-xl`

### Layout Utilities

- `eden-flex`, `eden-flex-col`, `eden-flex-center`, `eden-flex-between`, `eden-items-center`, `eden-grid`
- `eden-grid-2`, `eden-grid-3`, `eden-grid-4`

### Border Radius

- `eden-rounded-xs`, `eden-rounded-sm`, `eden-rounded-md`, `eden-rounded-lg`, `eden-rounded-xl`, `eden-rounded-2xl`
- `eden-rounded-full`

### Transitions

- `eden-transition`, `eden-transition-fast`, `eden-transition-smooth`

### Interactive Elements

- `eden-interactive`

### Scrollbar

- `eden-scrollbar`

### Overlay

- `eden-overlay`

### Animations

- `eden-animate-fade-in`, `eden-animate-slide-up`, `eden-animate-scale-in`

## Component Classes

### `avatar.css` (10)

#### Avatar

- `eden-avatar`, `eden-avatar-img`, `eden-avatar-icon`

#### Avatar Sizes

- `eden-avatar-xs`, `eden-avatar-sm`, `eden-avatar-md`, `eden-avatar-lg`, `eden-avatar-xl`

#### Avatar Group

- `eden-avatar-group`, `eden-avatar`

### `badges.css` (14)

#### Base Badge

- `eden-badge`

#### Badge Variants

- `eden-badge-primary`, `eden-badge-success`, `eden-badge-danger`, `eden-badge-warning`, `eden-badge-info`

#### Badge Sizes

- `eden-badge-sm`, `eden-badge-lg`

#### Badge Dot

- `eden-badge-dot`, `eden-badge-dot-animated`

#### Tag

- `eden-tag`

#### Tag with Close Button

- `eden-tag-close`

#### Tag Group

- `eden-tag-group`

#### Notification Badge

- `eden-notification-badge`

### `buttons.css` (17)

#### Base Button

- `eden-btn`

#### Button Variants

- `eden-btn-primary`, `eden-btn-secondary`, `eden-btn-success`, `eden-btn-danger`, `eden-btn-ghost`, `eden-btn-outline`

#### Button Sizes

- `eden-btn-xs`, `eden-btn-sm`, `eden-btn-md`, `eden-btn-lg`, `eden-btn-xl`

#### Button Shapes

- `eden-btn-square`, `eden-btn-pill`

#### Button Groups

- `eden-btn-group`, `eden-btn`

#### Floating Action Button

- `eden-fab`

### `cards.css` (22)

#### Base Card

- `eden-card`

#### Glass Card

- `eden-card-glass`

#### Elevated Card

- `eden-card-elevated`

#### Interactive Card

- `eden-card-interactive`

#### Card Header

- `eden-card-header`, `eden-card-title`, `eden-card-subtitle`

#### Card Body

- `eden-card-body`

#### Card Footer

- `eden-card-footer`

#### Card Variants

- `eden-card-sm`, `eden-card-lg`

#### Card Image

- `eden-card-image`, `eden-card-image-top`

#### Info Card

- `eden-info-card`, `eden-info-card-icon`, `eden-info-card-content`, `eden-info-card-title`, `eden-info-card-description`

#### Stats Card

- `eden-stats-card`, `eden-stats-value`, `eden-stats-label`

#### Card Grid

- `eden-card-grid`

### `inputs.css` (23)

#### Base Input

- `eden-input`

#### Input Sizes

- `eden-input-sm`, `eden-input-lg`

#### Textarea

- `eden-textarea`

#### Select

- `eden-select`

#### Checkbox

- `eden-checkbox`

#### Radio

- `eden-radio`

#### Toggle Switch

- `eden-toggle`

#### Slider

- `eden-slider`

#### Form Group

- `eden-form-group`, `eden-form-label`, `eden-form-help`, `eden-form-error`

#### Range with Value

- `eden-range`, `eden-range-input`, `eden-range-value`

#### Radio Group

- `eden-radio-group`, `eden-radio-group-horizontal`, `eden-radio-option`, `eden-radio-option-label`

#### Checkbox Group

- `eden-checkbox-group`, `eden-checkbox-option`, `eden-checkbox-option-label`

### `lists.css` (16)

#### Base List

- `eden-list`

#### List Item

- `eden-list-item`, `eden-list-item-active`, `eden-list-item-interactive`, `eden-list-item-disabled`

#### List Item Content

- `eden-list-item-icon`, `eden-list-item-content`, `eden-list-item-title`, `eden-list-item-description`, `eden-list-item-meta`

#### Steps List

- `eden-steps`, `eden-step`, `eden-step-number`, `eden-step-active`, `eden-step-completed`, `eden-step-label`

### `modals.css` (20)

#### Modal Overlay

- `eden-modal-overlay`

#### Modal Container

- `eden-modal`, `eden-modal-lg`, `eden-modal-sm`, `eden-modal-full`

#### Modal Header

- `eden-modal-header`, `eden-modal-title`, `eden-modal-close`

#### Modal Body

- `eden-modal-body`

#### Modal Footer

- `eden-modal-footer`

#### Alert Modal

- `eden-alert-modal`, `eden-alert-icon`, `eden-alert-icon-info`, `eden-alert-icon-success`, `eden-alert-icon-warning`, `eden-alert-icon-danger`

#### Tooltip

- `eden-tooltip`

#### Popover

- `eden-popover`, `eden-popover-title`, `eden-popover-content`

### `progress.css` (22)

#### Progress Bar

- `eden-progress`, `eden-progress-bar`, `eden-progress-bar-success`, `eden-progress-bar-danger`, `eden-progress-bar-warning`, `eden-progress-animated`

#### Progress Sizes

- `eden-progress-sm`, `eden-progress-lg`, `eden-progress-xl`

#### Circular Progress

- `eden-progress-circle`, `eden-progress-circle-svg`, `eden-progress-circle-bg`, `eden-progress-circle-bar`, `eden-progress-circle-text`

#### Spinner

- `eden-spinner`, `eden-spinner-sm`, `eden-spinner-lg`

#### Skeleton Loader

- `eden-skeleton`, `eden-skeleton-text`, `eden-skeleton-title`, `eden-skeleton-avatar`, `eden-skeleton-button`

### `sidebar.css` (25)

#### Base Sidebar

- `eden-sidebar`, `eden-sidebar-compact`, `eden-sidebar-wide`

#### Sidebar Header

- `eden-sidebar-header`, `eden-sidebar-header-title`, `eden-sidebar-header-subtitle`

#### Sidebar Section

- `eden-sidebar-section`, `eden-sidebar-section-scrollable`, `eden-sidebar-section-title`

#### Sidebar Divider

- `eden-sidebar-divider`

#### Sidebar Items Container

- `eden-sidebar-items`, `eden-sidebar-items-scrollable`

#### Sidebar Item

- `eden-sidebar-item`, `eden-sidebar-item-selected`, `eden-sidebar-item-disabled`

#### Sidebar Item Content

- `eden-sidebar-item-icon`, `eden-sidebar-item-icon-lg`, `eden-sidebar-item-text`, `eden-sidebar-item-meta`

#### Sidebar Item with Details

- `eden-sidebar-item-details`, `eden-sidebar-item-title`, `eden-sidebar-item-subtitle`

#### Sidebar Search

- `eden-sidebar-search`

#### Sidebar Footer

- `eden-sidebar-footer`

#### Animations

- `eden-sidebar-item`

### `tabs.css` (19)

#### Tab Container

- `eden-tabs`

#### Tab List

- `eden-tab-list`

#### Tab Button

- `eden-tab`, `eden-tab-active`

#### Tab Panels

- `eden-tab-panels`, `eden-tab-panel`, `eden-tab-panel-active`

#### Underline Tabs

- `eden-tab-list-underline`, `eden-tab-underline`, `eden-tab-active`

#### Pill Tabs

- `eden-tab-list-pills`, `eden-tab-pill`, `eden-tab-active`

#### Vertical Tabs

- `eden-tabs-vertical`, `eden-tab-list-vertical`, `eden-tab`

#### Tab with Icon

- `eden-tab-with-icon`, `eden-tab-icon`

#### Tab with Badge

- `eden-tab-badge`

## Source Caveats

### `eden-*` Class Names Used In Non-Example Apps But Not Defined By Shared EdenCSS

- `eden-alert`, `eden-alert-warning`, `eden-badge-mono`, `eden-badge-secondary`, `eden-bg-danger-transparent`, `eden-blur-sm`
- `eden-border-danger`, `eden-btn-icon`, `eden-card-outlined`, `eden-dialog-form`, `eden-dialog-prompt`, `eden-flex-end`
- `eden-flex-start`, `eden-flex-wrap`, `eden-font-mono`, `eden-h-full`, `eden-loading-spinner`, `eden-mb-lg`
- `eden-mb-md`, `eden-mb-sm`, `eden-mb-xs`, `eden-mr-sm`, `eden-mt-auto`, `eden-mt-lg`
- `eden-mt-md`, `eden-mt-xl`, `eden-mt-xs`, `eden-pt-lg`, `eden-self-start`, `eden-text-center`
- `eden-text-danger`, `eden-tracking-wide`, `eden-uppercase`, `eden-w-full`

Treat these as app-local helpers, stale assumptions, or classes that require local CSS instead of shared EdenCSS.
