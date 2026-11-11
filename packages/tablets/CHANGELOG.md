# @edenapp/tablets

## 0.15.2

### Patch Changes

- @edenapp/client@0.15.2

## 0.15.1

### Patch Changes

- @edenapp/client@0.15.1

## 0.15.0

### Minor Changes

- 41357aa: Support local, removable, and mounted network volumes that the consumer registers. Files and the file picker let users change between volumes, show Home and drive-type icons, keep read-only volumes read-only, and handle disconnected drives. Home addresses stay the same across accounts, and the consumer can restrict access to shared or overlapping folders.

  Files can safely remove drives through an OS operation that the consumer supplies. Safe removal requires a permission. It finishes running file operations, waits for open file handles to close, and tells the user when the drive can be unplugged. Volumes on the same physical device are removed together. Apps can keep file handles open across operations, and Eden closes them when their owner exits.

  `fs.lstat` inspects symbolic links without following them. `fs.delete` and `fs.move` act on the symbolic link itself, and copies keep the original link targets. A failed overwrite restores the destination, and a move across filesystems keeps the copied files if Eden cannot delete the source.

  **Breaking:** File commands that take one address now take a `location` property with the volume and path. Raw picker selections return `locations[]`, and single-selection picker helpers return the first selected location.

- 80295f7: Context menu items can be checkable: set `checked` on a `button` to show a check mark, and use `section` to label a group of choices inside a menu.

### Patch Changes

- Updated dependencies [8ab978e]
- Updated dependencies [b1eb229]
- Updated dependencies [41357aa]
- Updated dependencies [7a39b41]
  - @edenapp/client@0.15.0

## 0.14.0

## 0.13.0

### Minor Changes

- f9119b2: Add a renderer notification helper with automatically routed action callbacks, reliable cleanup after dismissal, and adoption across Eden's bundled apps.

## 0.12.1

## 0.12.0

### Patch Changes

- c8075b0: Centralize dependency versions shared by multiple workspace packages in the pnpm catalog and update dependencies to their latest releases.

## 0.11.1

## 0.11.0

## 0.10.2

## 0.10.1

### Patch Changes

- fix reflect import

## 0.10.0

## 0.9.0

## 0.8.0

### Minor Changes

- Release 0.8.0.

## 0.7.3

## 0.7.2

## 0.7.1

## 0.7.0

## 0.6.5

## 0.6.4

## 0.6.3

### Patch Changes

- submenus in ctx menus and open with... in files app

## 0.6.2

### Patch Changes

- error while publishing

## 0.6.1

## 0.6.0

## 0.5.2

## 0.5.1

## 0.5.0

### Minor Changes

- major ui refinement
