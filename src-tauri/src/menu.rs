//! Native menu for ide99 — minimal surface area per design spec §7.
//!
//! macOS lays out the standard app / view / help triad in the system menu bar.
//! Windows + Linux get an in-window menu with File / View / Help.
//! The "Toggle Theme" item emits a Tauri event; the on-screen `ThemeSwitcher`
//! is the primary driver  — the menu wiring is here so future sprints
//! (or accessibility users) get parity through the OS-native channel.

use tauri::{
    menu::{Menu, MenuBuilder, MenuEvent, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder},
    AppHandle, Emitter, Runtime, Wry,
};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

pub const ID_TOGGLE_THEME: &str = "toggle-theme";
pub const ID_ABOUT: &str = "about";
pub const EVENT_TOGGLE_THEME: &str = "menu://toggle-theme";

/// Build the application menu. Layout differs by OS per spec §7 table.
///
/// The Edit submenu wires `PredefinedMenuItem` entries (undo/redo/cut/copy/paste/
/// select-all). On macOS `WebKit` only honors Cmd+C / Cmd+V / Cmd+X / Cmd+A inside
/// the webview when those shortcuts are present in the native menu — without
/// this submenu the user has to right-click → Paste.
pub fn build(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let toggle_theme = MenuItemBuilder::with_id(ID_TOGGLE_THEME, "Toggle Theme").build(app)?;
    let about_item = MenuItemBuilder::with_id(ID_ABOUT, "About ide99").build(app)?;
    let quit_item = PredefinedMenuItem::quit(app, None)?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .item(&PredefinedMenuItem::undo(app, None)?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .build()?;

    let view_menu = SubmenuBuilder::new(app, "View")
        .item(&toggle_theme)
        .build()?;
    let help_menu = SubmenuBuilder::new(app, "Help").item(&about_item).build()?;

    if cfg!(target_os = "macos") {
        let app_menu = SubmenuBuilder::new(app, "ide99")
            .item(&about_item)
            .separator()
            .item(&quit_item)
            .build()?;

        MenuBuilder::new(app)
            .item(&app_menu)
            .item(&edit_menu)
            .item(&view_menu)
            .item(&help_menu)
            .build()
    } else {
        let file_menu = SubmenuBuilder::new(app, "File").item(&quit_item).build()?;

        MenuBuilder::new(app)
            .item(&file_menu)
            .item(&edit_menu)
            .item(&view_menu)
            .item(&help_menu)
            .build()
    }
}

/// Route menu activations. `toggle-theme` re-broadcasts as a webview event so
/// the React-side `useTheme` hook can react. `about` opens a native message
/// dialog via `tauri-plugin-dialog`.
///
/// Takes `MenuEvent` by value to satisfy the Tauri 2 `on_menu_event` callback
/// signature (`Fn(&AppHandle<R>, MenuEvent)`).
#[allow(clippy::needless_pass_by_value)]
pub fn handle_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    match event.id().as_ref() {
        ID_TOGGLE_THEME => {
            if let Err(err) = app.emit(EVENT_TOGGLE_THEME, ()) {
                tracing::warn!(error = %err, "failed to emit toggle-theme event");
            }
        }
        ID_ABOUT => {
            let version = app.package_info().version.to_string();
            let identifier = app.config().identifier.clone();
            // Show non-blocking: a blocking dialog invoked from inside the
            // menu-event callback can reenter the GTK main loop on Linux.
            app.dialog()
                .message(format!(
                    "ide99 {version}\n\nA desktop PostgreSQL client.\n{identifier}"
                ))
                .title("About ide99")
                .kind(MessageDialogKind::Info)
                .show(|_| {});
        }
        other => {
            tracing::debug!(menu_id = other, "unhandled menu event");
        }
    }
}
