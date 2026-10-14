---
"@edenapp/sdk": minor
"@edenapp/types": minor
"@edenapp/client": minor
"@edenapp/tablets": minor
---

Support consumer-registered local, removable, and mounted network volumes, with live selection and Home/drive-type icons in Files and File Picker, read-only access, and disconnect handling. Home addresses stay stable across accounts, with optional shared or overlapping folder restrictions. Single-address file commands now take a location property containing the volume/path address; raw picker selections return locations[], single picker helpers return the first selected location, and file-handler startup preserves those addresses across volumes. Copied symbolic links keep their original targets, and failed overwrites restore the destination even if the source disconnects. Cross-filesystem moves retain completed copies if source deletion fails. Volume-restricted pickers resume their listing and live updates when the selected drive reconnects. Files and File Picker keep live updates active after recovering from a deleted directory.

Files provides permission-protected safe removal through a consumer-supplied OS operation. Removal exposes pending state, finishes existing file operations, blocks new access, and returns an operation handle while the OS flushes cached writes. Successful removal returns the browser to Home and confirms the drive can be unplugged. Failed removals restore access and can be retried. Apps can retain file handles across operations, with safe removal waiting for close and automatic cleanup when the owner exits.
