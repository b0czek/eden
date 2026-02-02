# Users

This document summarizes how Eden handles users, roles, grants, and user
management.

## Roles and Grants

- Roles: `vendor` and `standard`.
- Vendor:
  - Can only be created via seeding; runtime creation or promotion is blocked.
  - Cannot be deleted or demoted.
  - Always has `*` grants (full access).
  - Bypasses app launch and settings access checks.
- Standard:
  - If no grants are provided at creation, defaults to `*` (full access),
    but vendor-only user management and restricted app rules still apply.
- Grants support glob matching:
  - `*` matches everything.
- `namespace/*` matches any grant under that namespace.
- Core apps are always launchable for any user regardless of grants.

## App Access Management

App launch is controlled by user grants, a core-app allowlist, and a restricted
app denylist: users can launch an app when they have `apps/launch/<appId>` (or
`apps/launch/*`), while core apps listed in the Eden constructor config are
always launchable regardless of grants. Restricted apps listed in that config
are never launchable by non-vendor users, even if granted. Grants that
explicitly target restricted apps are stripped when saved for non-vendor users.
Vendor users bypass these checks entirely.

## App Grants

Apps can declare feature-level grants in their manifest under `grants`. These
become user grants in the form `app/<appId>/<grantId>` and are intended for
fine-grained feature toggles inside an app. Grants can optionally list
`permissions` they unlock; those permissions are only usable when the user has
at least one grant that enables them. Vendor users can assign these in
the Users app (App grants), and apps can check them via `user/has-grant`.

## User Records and Storage

- Stored in a Keyv SQLite database at `${appsDirectory}/users.db`.
- Keys:
  - `users:index` (list of usernames)
  - `users:default` (default username)
  - `user:${username}` (full user record)
- Stored record includes: `username`, `name`, `role`, `grants`,
  `passwordHash`, `passwordSalt`, `createdAt`, `updatedAt`.
- Public user profile exposes: `username`, `name`, `role`, `grants`,
  `createdAt`, `updatedAt`.

## Sessions and Identity

- Login/logout and password changes are handled through `user/*` IPC commands.
- Key commands:
  - `user/list` (all user profiles)
  - `user/login`, `user/logout` (session control)
  - `user/get-current` (current user profile)
  - `user/change-password` (current user only)
  - `user/has-grant` (grant check)
- App-level permissions gate these handlers:
  - `user/session` for login/logout/change-password
  - `user/identity` for list/get-current
  - `user/grants` for has-grant

## User Management (Vendor-Only)

User management is restricted to vendor accounts and is not part of the Eden
settings schema.

- Commands:
  - `user/create`
  - `user/update`
  - `user/delete`
  - `user/set-password`
  - `user/get-default`
  - `user/set-default`
- These require app permission `user/manage` and a vendor session.
- Non-vendor access will fail.
- Vendor accounts cannot be deleted or demoted.

## Seeding

- Seeding happens once at startup from `eden-seed.json` (generated at build time
  from `eden.config.json`).
- Multiple vendor accounts can be seeded.
- Default user can be seeded via `defaultUsername` and is auto-logged in on
  startup if it exists.

## Users App

- User administration lives in the Users app (not the Settings schema).
- The app should be listed in `restrictedApps` so only vendor accounts can
  launch it.
- The default username can be changed from the Users app.
