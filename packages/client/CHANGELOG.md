# @edenapp/client

## 0.15.2

### Patch Changes

- @edenapp/types@0.15.2

## 0.15.1

### Patch Changes

- Updated dependencies [7d204e5]
  - @edenapp/types@0.15.1

## 0.15.0

### Minor Changes

- 8ab978e: Add `@edenapp/client` with generated, typed system commands and event subscriptions for frontend and backend apps, including positional required arguments, optional settings, and operation controls.
- b1eb229: Add a recoverable Trash for Home. Apps can move items to Trash, list the items the user can access, restore them to the original or another location, delete them permanently, and subscribe to Trash changes. Volumes report whether they support Trash. Files shows Trash in the sidebar with restore and permanent-delete controls.
- 41357aa: Support local, removable, and mounted network volumes that the consumer registers. Files and the file picker let users change between volumes, show Home and drive-type icons, keep read-only volumes read-only, and handle disconnected drives. Home addresses stay the same across accounts, and the consumer can restrict access to shared or overlapping folders.

  Files can safely remove drives through an OS operation that the consumer supplies. Safe removal requires a permission. It finishes running file operations, waits for open file handles to close, and tells the user when the drive can be unplugged. Volumes on the same physical device are removed together. Apps can keep file handles open across operations, and Eden closes them when their owner exits.

  `fs.lstat` inspects symbolic links without following them. `fs.delete` and `fs.move` act on the symbolic link itself, and copies keep the original link targets. A failed overwrite restores the destination, and a move across filesystems keeps the copied files if Eden cannot delete the source.

  **Breaking:** File commands that take one address now take a `location` property with the volume and path. Raw picker selections return `locations[]`, and single-selection picker helpers return the first selected location.

- 7a39b41: Add stream commands, which send results to the calling app while their work continues. Generated client methods return a stream that apps read with `for await`, with backpressure and cancellation. Eden stops a stream when its view or backend closes, or when its view reloads.

### Patch Changes

- Updated dependencies [39e850b]
- Updated dependencies [2b43225]
- Updated dependencies [b1eb229]
- Updated dependencies [41357aa]
- Updated dependencies [11c0e4a]
- Updated dependencies [0153e67]
- Updated dependencies [7a39b41]
- Updated dependencies [2484d8a]
- Updated dependencies [80295f7]
  - @edenapp/types@0.15.0
