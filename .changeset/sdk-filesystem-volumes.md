---
"@edenapp/sdk": minor
"@edenapp/types": minor
"@edenapp/tablets": minor
---

Support consumer-registered local, removable, and mounted network volumes, with live selection and Home/drive-type icons in Files and File Picker, read-only access, and disconnect handling. Single-address file commands now take a location property containing the volume/path address; picker helpers and file-handler startup preserve those addresses across volumes. Cross-volume copies preserve internal symbolic links, standalone symbolic links retain their targets, and failed overwrites restore the destination even if the source disconnects. Cross-filesystem moves retain completed copies if source deletion fails. Volume-restricted pickers resume their listing and live updates when the selected drive reconnects. Files and File Picker keep live updates active after recovering from a deleted directory.
