#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Handle --version / --help before any GUI or state initialization so they
    // print and exit without spawning a window, opening the store, or running
    // migrations. Unknown args (incl. macOS's -psn_* and file paths) fall
    // through to a normal launch. See `ide99::cli`.
    let args: Vec<String> = std::env::args().skip(1).collect();
    if let Some(message) = ide99::cli::early_exit_message(&args) {
        print!("{message}");
        std::process::exit(0);
    }

    ide99::run();
}
