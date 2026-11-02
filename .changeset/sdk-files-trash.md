---
"@edenapp/sdk": minor
"@edenapp/types": minor
"@edenapp/client": minor
---

Add a recoverable Trash for Home. Apps can move items to Trash, list the items the user can access, restore them to the original or another location, delete them permanently, and subscribe to Trash changes. Volumes report whether they support Trash. Files adds a Trash view in the sidebar with restore and permanent-delete controls. `fs.lstat` inspects symbolic links, including dangling links, without following them. `fs.delete` and `fs.move` act on a symbolic link itself, so dangling links and links that point outside a volume can be deleted or moved.
