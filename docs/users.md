# Configure users and access

[Handbook](README.md) · Related: [Consumer setup](consumer-development.md), [Daemons](processes-and-daemons.md)

An Eden account has a role, grants, and an optional Home folder restriction.
App permissions describe what an app may request.
User grants describe what the active account may access.
A command may require both.

## Seed the first accounts

Add users to the consumer's `eden.config.json`:

```json
{
  "users": [
    {
      "username": "operator",
      "name": "Operator",
      "role": "standard",
      "password": "local-example-only",
      "grants": ["apps/launch/*", "settings/*"],
      "directoryRestriction": "projects/design"
    }
  ],
  "defaultUsername": "operator"
}
```

Choose deployment credentials before distribution.
The build tools generate `eden-seed.json` with hashed passwords.
Seeding applies once and does not overwrite existing accounts or settings.
A valid `defaultUsername` logs in automatically at startup.
Omit it when the user should log in through the configured login app.

## Choose roles and grants

| Role | Behavior |
| --- | --- |
| `standard` | Uses assigned grants; cannot use vendor-only administration |
| `vendor` | Full `*` access; bypasses app launch and Settings access checks |

Create vendor accounts through seeding.
Runtime creation or promotion to vendor is blocked.
Vendor accounts cannot be deleted or demoted.
If a standard account is created without grants, it receives `*` by default.
Supply explicit grants when access should be limited.

Grants support glob patterns. `*` matches all grants; `settings/*` matches grants under `settings`.
A standard account with `*` still follows vendor-only and restricted-app rules.

## Control app launch

The user needs `apps/launch/<appId>` or a matching pattern such as `apps/launch/*`.
The consumer can set two runtime lists:

- `coreApps`: always launchable, regardless of user grants.
- `restrictedApps`: blocked for non-vendor accounts, even when a grant matches.

Vendor accounts bypass these launch checks.
Eden removes grants that explicitly target restricted apps when saving them for standard users.
When shipping the Users app, list it in `restrictedApps`.

## Declare app feature grants

An app can declare grants for individual features:

```json
{
  "grants": [{
    "id": "export",
    "label": "Export documents",
    "permissions": ["fs/write"]
  }]
}
```

This grant becomes `app/<appId>/export`.
The optional `permissions` list unlocks those permissions for users with that grant.
Apps can query grants with `user/has-grant`, which requires `user/grants` permission.
Vendor users assign feature grants through the Users app.

## Shared filesystem and folder restrictions

`userDirectory` backs one shared `home` volume.
A complete address identifies the same file for all accounts and daemon identities.
Folder restrictions limit access within that shared tree.

For example, `directoryRestriction: "projects/design"` permits
`home:/projects/design` and its descendants.
Files and File Picker start there and keep full addresses visible.

A blank restriction or `"."` permits the whole shared tree.
Vendor accounts and system principals have full-tree access.
Two accounts can share a restriction or have overlapping restrictions.

Restrictions cover reads, writes, metadata, listing, search, watches, and package file access.
Paths cannot escape `userDirectory`, including through symbolic links.
Eden creates assigned directories as needed.
Deleting an account leaves its files intact.

Consumer-registered volumes are shared independently of Home restrictions.
Their access still requires app permissions and applicable grants.
Node.js backends can also access host files directly; Eden account restrictions govern Eden commands.

## Use session commands from an app

| Command | App permission |
| --- | --- |
| `session/login`, `session/logout` | `session/manage` |
| `session/get-current` | `session/read` |
| `user/list` | `user/identity` |
| `user/change-password` | `user/session` |
| `user/has-grant` | `user/grants` |

Login and logout return operations. Await completion when the caller remains available.
On logout or account change, Eden cancels operations in the outgoing session if they support cancellation.
This includes queued and running autostart work.
It waits for cleanup and for other operations to finish.
Eden then stops that session's apps and changes the current user.
`session/changed` reports the updated session.
Managed daemons continue running with their launch-time identity.
See [sessions and autostart](processes-and-daemons.md#sessions-and-autostart).

## Manage accounts

The Users app provides vendor administration.
App commands `user/create`, `user/update`, `user/delete`, `user/set-password`,
`user/get-default`, and `user/set-default` require `user/manage` and a vendor session.

A trusted consumer can use `eden.users` and `eden.sessions` from the main process.
Execute their asynchronous methods through `eden.runPromise()`.
See the [host API](main-process-api.md).
