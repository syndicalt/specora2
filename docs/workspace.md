# Workspace and Navigation

The Specora workspace behaves like a lightweight operations desktop. Apps can run as full-canvas views or floating windows.

![Workspace navigation](screenshots/workspace-navigation.png)

## Dock

The dock provides fast access to pinned and open apps.

- Select an app icon to open or focus the app.
- Select an active app icon to minimize it.
- Right-click an app icon to close or manage dock pinning.
- Open apps preserve their local state while switching between apps.
- Closing an app destroys its in-memory state; reopening starts a fresh app instance.

## Launcher

Open the launcher with `Ctrl+Shift+K` or `Cmd+Shift+K`.

Use the launcher to:

- Search installed apps.
- Open apps not pinned to the dock.
- Quickly return to admin or platform tools.

## Global Chat

Open the chat panel with `Ctrl+/` or `Cmd+/`.

Chat receives context from the active app, selected CI, service map root, and current screen. See [Global Chat and AI Assistance](ai-chat.md).

## Closing Apps

Use `Ctrl+Shift+X` or `Cmd+Shift+X` to close the focused window or active canvas app.

Close behavior is intentional:

- Switching apps preserves state.
- Minimizing apps preserves state.
- Closing apps destroys local state.

## Settings

Open **Settings** from the user dock menu.

Use Settings to:

- Change theme.
- Review account profile information.
- Update editable user preferences.

User metadata such as role, email, and account status is managed by administrators in [Admin Console](admin/README.md#user-management).
