//! Pre-GUI command-line handling.
//!
//! `main()` consults [`early_exit_message`] before building the Tauri app, so
//! `--version` / `--help` print and exit without spawning a window, opening the
//! store, or running migrations. Anything that is not an exact, recognized flag
//! is ignored so a normal GUI launch is never affected — including the
//! `-psn_0_*` process-serial-number argument macOS injects on `.app` / Finder /
//! `open` launches, and any file-path positional.
//!
//! NOTE (Windows): release builds set `windows_subsystem = "windows"` and have
//! no attached console, so a printed `--version` is not visible there unless the
//! process first attaches to the parent console (`AttachConsole`). macOS and
//! Linux are the primary CLI targets; the Windows console-attach path needs a
//! Windows machine to implement and verify and is tracked separately.

/// Version string, sourced from the crate version so it stays in lockstep with
/// the workspace version bump (the same source as the `ide99 starting` log).
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// If `args` (the program arguments, excluding `argv[0]`) contain a recognized
/// early-exit flag, return the text to print to stdout before exiting `0`.
/// Returns `None` for everything else so the caller proceeds to launch the GUI.
///
/// Matching is an exact, full-token allow-list: only `--version`/`-V` and
/// `--help`/`-h` are recognized. Unknown flags, `-psn_0_*`, and positional
/// paths all yield `None`.
pub fn early_exit_message<I, S>(args: I) -> Option<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    for arg in args {
        match arg.as_ref() {
            "--version" | "-V" => return Some(version_text()),
            "--help" | "-h" => return Some(help_text()),
            _ => {}
        }
    }
    None
}

fn version_text() -> String {
    format!("ide99 {VERSION}\n")
}

fn help_text() -> String {
    let mut text = format!("ide99 {VERSION}\n");
    text.push_str("A desktop PostgreSQL client.\n\n");
    text.push_str("Usage: ide99 [OPTIONS]\n\n");
    text.push_str("Options:\n");
    text.push_str("  -V, --version    Print version and exit\n");
    text.push_str("  -h, --help       Print this help and exit\n\n");
    text.push_str("Run with no options to launch the application.\n");
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| (*x).to_string()).collect()
    }

    #[test]
    fn version_flags_return_version_text() {
        for flag in ["--version", "-V"] {
            let out = early_exit_message(args(&[flag])).expect("version text");
            assert_eq!(out, format!("ide99 {VERSION}\n"));
        }
    }

    #[test]
    fn help_flags_return_usage_text() {
        for flag in ["--help", "-h"] {
            let out = early_exit_message(args(&[flag])).expect("help text");
            assert!(out.starts_with(&format!("ide99 {VERSION}")));
            assert!(out.contains("--version"));
            assert!(out.contains("Usage:"));
        }
    }

    #[test]
    fn version_wins_when_mixed_with_other_args() {
        assert!(early_exit_message(args(&["--frobnicate", "--version"])).is_some());
    }

    #[test]
    fn no_args_launches_gui() {
        let empty: Vec<String> = Vec::new();
        assert_eq!(early_exit_message(empty), None);
    }

    #[test]
    fn gui_launch_args_are_ignored() {
        // macOS injects a -psn_0_* process-serial-number arg on .app / Finder /
        // `open` launch, and a file-path positional can arrive via "open with".
        // Neither is a recognized flag, so the GUI must still launch (None).
        assert_eq!(early_exit_message(args(&["-psn_0_12345"])), None);
        assert_eq!(early_exit_message(args(&["/Users/x/foo.sql"])), None);
        assert_eq!(early_exit_message(args(&["--unknown-flag"])), None);
    }

    #[test]
    fn version_string_matches_crate_version() {
        assert_eq!(VERSION, env!("CARGO_PKG_VERSION"));
    }
}
