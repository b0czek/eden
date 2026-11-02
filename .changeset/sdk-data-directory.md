---
"@edenapp/sdk": minor
"@edenapp/types": minor
"@edenapp/scripts": patch
---

Eden keeps all of its data under one `dataDirectory`, with the Home volume in `home`, installed packages in `apps`, and accounts, settings, app storage, and default apps in `system`. It replaces the `appsDirectory` and `userDirectory` options and defaults to `eden` in Electron's `userData` directory. Existing data in the previous locations is not migrated. Apps can no longer read or change system data through the Home volume, and package IDs that match system database names are now allowed.
