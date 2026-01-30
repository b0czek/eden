# Hello World Example App

A simple example demonstrating frontend-backend communication in Eden using the
`AppBusConnection` API.

## User Grants

This app declares an app-specific grant in `manifest.json`:

- `app/com.eden.example.hello/say-hello`

The backend checks this grant via `user/has-grant` before responding to the
`hello` request. To allow the "Say Hello" action, grant it to a user in Settings
→ Users → App grants.
