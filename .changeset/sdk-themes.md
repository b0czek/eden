---
"@edenapp/sdk": minor
"@edenapp/types": minor
---

Add light and dark themes. Users pick a theme in Settings → Appearance, and Eden, its apps, and wallpaper presets switch to the theme's light or dark look. Consumers can add their own themes and set the default theme with `appearance` in `createEden`, and change the theme through `eden.appearance`. Eden no longer follows the operating system's light or dark setting: it uses the default theme, Eden Dark unless the consumer sets another, until the user chooses one.
