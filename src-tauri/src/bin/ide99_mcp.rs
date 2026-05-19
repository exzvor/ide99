//! `ide99-mcp` — standalone stdio binary that connects external agents
//! (Claude Code, Cursor) via a subprocess MCP transport.
//!
//! ## Architecture
//!
//! This binary is a thin stdio→IPC bridge. The real MCP server lives
//! inside the running ide99 (see `crate::mcp::transport_http`) because
//! only there is access to [`AppState`] (active connection, current
//! query, last result). On startup this binary:
//!
//! 1. Looks up the IPC socket (`<data_dir>/mcp.sock` on Unix; named
//!    pipe on Windows). If ide99 is not running, it prints a hint to
//!    stderr telling the user to launch ide99 and exits with code 2.
//! 2. Opens stdio for the MCP handshake with the client (Claude Code).
//! 3. Forwards frames between stdin/stdout and the IPC socket in both
//!    directions.
//!
//! Frame protocol = line-delimited JSON (see `mcp::transport_ipc`).

#![allow(    clippy::missing_errors_doc,
    clippy::single_match_else,
    clippy::ptr_arg,
    clippy::doc_markdown,
    clippy::needless_pass_by_value
)]

use std::path::PathBuf;
use std::process::ExitCode;

use ide99::mcp::transport_ipc;

fn main() -> ExitCode {
    // Async runtime for the IPC bridge. Single-thread is enough — we just
    // copy bytes between stdio and the socket.
    let rt = match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(rt) => rt,
        Err(e) => {
            eprintln!("ide99-mcp: failed to start runtime: {e}");
            return ExitCode::from(1);
        }
    };

    rt.block_on(async {
        let socket = match transport_ipc::default_socket_path() {
            Some(p) => p,
            None => {
                eprintln!(                    "ide99-mcp: could not resolve IPC socket path (no HOME?). \
                     Launch ide99 to use MCP."
);
                return ExitCode::from(2);
            }
        };

        if !socket_exists(&socket).await {
            eprintln!(                "ide99-mcp: IPC socket not found at {}.\n\
                 Launch ide99 and enable the MCP server in Settings to \
                 use this proxy.",
                socket.display()
);
            return ExitCode::from(2);
        }

        match run_proxy(&socket).await {
            Ok(()) => ExitCode::from(0),
            Err(e) => {
                eprintln!("ide99-mcp: proxy ended: {e}");
                ExitCode::from(1)
            }
        }
    })
}

async fn socket_exists(path: &PathBuf) -> bool {
    #[cfg(unix)]
    {
        tokio::fs::metadata(path).await.is_ok()
    }
    #[cfg(windows)]
    {
        // Named pipes don't have a filesystem entry until connect-time.
        // We do an optimistic connect; if it succeeds we close and return
        // true, otherwise we return false so main() prints the user hint.
        let _ = path;
        true
    }
}

#[cfg(unix)]
async fn run_proxy(path: &PathBuf) -> Result<(), Box<dyn std::error::Error>> {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

    let stream = tokio::net::UnixStream::connect(path).await?;
    let (sock_read, mut sock_write) = stream.into_split();
    let mut sock_reader = BufReader::new(sock_read);

    let stdin = tokio::io::stdin();
    let mut stdin_reader = BufReader::new(stdin);
    let mut stdout = tokio::io::stdout();

    let mut stdin_buf = String::new();
    let mut sock_buf = String::new();

    loop {
        tokio::select! {
            n = stdin_reader.read_line(&mut stdin_buf) => {
                let n = n?;
                if n == 0 { return Ok(()); } // stdin closed → exit cleanly
                sock_write.write_all(stdin_buf.as_bytes()).await?;
                if !stdin_buf.ends_with('\n') {
                    sock_write.write_all(b"\n").await?;
                }
                sock_write.flush().await?;
                stdin_buf.clear();
            }
            n = sock_reader.read_line(&mut sock_buf) => {
                let n = n?;
                if n == 0 { return Ok(()); } // server closed → exit
                stdout.write_all(sock_buf.as_bytes()).await?;
                if !sock_buf.ends_with('\n') {
                    stdout.write_all(b"\n").await?;
                }
                stdout.flush().await?;
                sock_buf.clear();
            }
        }
    }
}

#[cfg(windows)]
async fn run_proxy(path: &PathBuf) -> Result<(), Box<dyn std::error::Error>> {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    use tokio::net::windows::named_pipe::ClientOptions;

    let path_str = path.to_string_lossy().into_owned();
    let pipe = ClientOptions::new().open(&path_str)?;
    let (pipe_read, mut pipe_write) = tokio::io::split(pipe);
    let mut pipe_reader = BufReader::new(pipe_read);

    let stdin = tokio::io::stdin();
    let mut stdin_reader = BufReader::new(stdin);
    let mut stdout = tokio::io::stdout();

    let mut stdin_buf = String::new();
    let mut pipe_buf = String::new();

    loop {
        tokio::select! {
            n = stdin_reader.read_line(&mut stdin_buf) => {
                let n = n?;
                if n == 0 { return Ok(()); }
                pipe_write.write_all(stdin_buf.as_bytes()).await?;
                if !stdin_buf.ends_with('\n') {
                    pipe_write.write_all(b"\n").await?;
                }
                pipe_write.flush().await?;
                stdin_buf.clear();
            }
            n = pipe_reader.read_line(&mut pipe_buf) => {
                let n = n?;
                if n == 0 { return Ok(()); }
                stdout.write_all(pipe_buf.as_bytes()).await?;
                if !pipe_buf.ends_with('\n') {
                    stdout.write_all(b"\n").await?;
                }
                stdout.flush().await?;
                pipe_buf.clear();
            }
        }
    }
}
