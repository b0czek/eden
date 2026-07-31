
  - ~~[P1] Isolate invalid manifest panels during startup — /home/dariusz/Desktop/eden/packages/sdk/src/settings/SettingsPanelManager.ts:151-154
    When an installed app has settings accepted by the manifest validator but rejected by cloneAndValidatePanelDefinition—for example, a select without options or a category ID containing spaces—this
    unguarded synchronization throws. Since onReady() calls it outside per-app error handling, Eden enters the failed state and never creates a window; catch and skip invalid app panels or validate them
    before installation.~~

  - ~~[P1] Provide apps.list an effective principal — /home/dariusz/Desktop/eden/packages/sdk/src/api/createControlPlaneApi.ts:48-48
    When eden.apps.list() is called from normal host code after whenReady(), it runs outside any ExecutionContext, so AppCatalog.list() treats every app as unlaunchable unless showRestricted: true is
    explicitly supplied. Consequently the documented eden.apps.list({ showHidden: true }) example returns an empty array despite installed apps; run the query under the active/system principal or bypass
    caller authorization for this trusted facade.~~

  - ~~[P1] Keep value inputs enabled while users edit — /home/dariusz/Desktop/eden/packages/sdk/apps/com/eden/settings/src/components/GenericPanel.tsx:435-438
    For text, textarea, number, color, and range controls, every onInput starts an action, and App.runAction immediately adds that action to busyActions. This makes the control disabled after its first
    input event until the action and panel reload complete, so text fields accept roughly one character per IPC round trip and range dragging stops immediately; keep a local draft and commit on blur/
    debounce, or avoid disabling the control during editing.~~

  - ~~[P2] Preserve state when disabling unauthorized controls — /home/dariusz/Desktop/eden/packages/sdk/src/settings/SettingsPanelAuthorization.ts:81-84
    When a control's stateKey differs from its id and the user lacks its action grant, this creates a new state entry under control.id rather than merging the provider state under stateKey. GenericPanel
    checks the ID first, so the synthetic { disabled: true } entry shadows the real value, badge, detail, or hidden flag; merge authorization into the state-key entry or rely on the declaration's
    authorization flag.~~

  - [P2] Refresh daemon snapshots after daemon events — /home/dariusz/Desktop/eden/packages/sdk/src/settings/panels/daemons.ts:80-85
    When a daemon changes independently of an action in this panel—for example, it crashes, restarts automatically, or is controlled through the host API—the loaded snapshot is never refreshed. The
    previous component subscribed to daemon/changed, while the new Settings app reloads only after its own actions or settings/panels-changed; forward the existing daemon emitter notification into panel
    refresh using the repository's emitter mechanism (AGENTS.md:16).

  - [P2] Defer app-size scans until an app is selected — /home/dariusz/Desktop/eden/packages/sdk/src/settings/panels/apps.ts:40-44
    When the Apps panel contains many or large installed packages, opening it now recursively scans every app directory via getSize() and waits for all scans before returning any panel data. The list
    does not display sizes, and the previous implementation loaded a size only after selecting an app, so this can introduce substantial startup I/O and delay the entire panel; restore lazy size loading
    or fetch it separately for the selected app.
