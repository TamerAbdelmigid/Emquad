//! Runs the texlab language server as a separate process and carries messages to and from it.
//!
//! texlab is GPL-licensed, which is why it is only ever started as its own program and spoken
//! to over its standard input and output; none of it is linked into the app. When it is not
//! installed the app works without it, using its built-in completion.

use crate::error::{Error, Result};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;

pub struct Server {
    child: Child,
    /// Messages for the server. A separate thread writes them, so a server that stops reading
    /// can never block the app.
    outbox: mpsc::Sender<String>,
    /// Set when the app stops the server itself, so that is not reported as the server
    /// stopping: by then a new server may be running for the next project.
    stopping: Arc<AtomicBool>,
}

impl Drop for Server {
    fn drop(&mut self) {
        self.stopping.store(true, Ordering::SeqCst);
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// The longest header line accepted from the server.
const MAX_HEADER: u64 = 8 * 1024;

/// Read one message: `Content-Length` headers, a blank line, then that many bytes of JSON.
/// Returns `None` at the end of the stream.
pub fn read_message(reader: &mut impl BufRead) -> std::io::Result<Option<String>> {
    let mut length: Option<usize> = None;
    loop {
        let mut line = String::new();
        if reader.by_ref().take(MAX_HEADER).read_line(&mut line)? == 0 {
            return Ok(None);
        }
        if line.len() as u64 == MAX_HEADER && !line.ends_with('\n') {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "header line too long",
            ));
        }
        let line = line.trim_end();
        if line.is_empty() {
            if length.is_some() {
                break;
            }
            continue;
        }
        if let Some((name, value)) = line.split_once(':')
            && name.eq_ignore_ascii_case("content-length")
        {
            length = value.trim().parse().ok();
        }
    }
    // A header that claims an absurd size is refused rather than allocated.
    let length = length.filter(|n| *n <= 64 << 20).ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidData, "bad Content-Length")
    })?;
    let mut body = vec![0u8; length];
    reader.read_exact(&mut body)?;
    Ok(Some(String::from_utf8_lossy(&body).into_owned()))
}

pub fn frame(message: &str) -> Vec<u8> {
    format!("Content-Length: {}\r\n\r\n{message}", message.len()).into_bytes()
}

impl Server {
    /// Start texlab in the project folder. `on_message` is called, on its own thread, with each
    /// JSON message the server sends; `on_close` once, when the server stops talking of its
    /// own accord (not when it is stopped by dropping it).
    pub fn start(
        exe: &Path,
        project_root: &Path,
        on_message: impl Fn(String) + Send + 'static,
        on_close: impl FnOnce() + Send + 'static,
    ) -> Result<Server> {
        let mut command = Command::new(exe);
        crate::compile::quiet(&mut command)
            .current_dir(project_root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        let mut child = command
            .spawn()
            .map_err(|e| Error::app("lsp_failed", format!("Could not start texlab: {e}")))?;
        let mut stdin = child.stdin.take().expect("piped stdin");
        let stdout = child.stdout.take().expect("piped stdout");
        let stopping = Arc::new(AtomicBool::new(false));
        let stopped = stopping.clone();
        std::thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            while let Ok(Some(message)) = read_message(&mut reader) {
                if stopped.load(Ordering::SeqCst) {
                    return;
                }
                trace("<-", &message);
                on_message(message);
            }
            if !stopped.load(Ordering::SeqCst) {
                on_close();
            }
        });
        let (outbox, inbox) = mpsc::channel::<String>();
        std::thread::spawn(move || {
            for message in inbox {
                if stdin
                    .write_all(&frame(&message))
                    .and_then(|_| stdin.flush())
                    .is_err()
                {
                    break;
                }
            }
        });
        Ok(Server {
            child,
            outbox,
            stopping,
        })
    }

    /// Queue a message for the server. Returns at once.
    pub fn send(&self, message: &str) -> Result<()> {
        trace("->", message);
        self.outbox
            .send(message.to_string())
            .map_err(|_| Error::app("lsp_missing", "The language server has stopped"))
    }
}

/// With `EMQUAD_LSP_TRACE` set, the start of every message is printed, for diagnosing the server.
fn trace(direction: &str, message: &str) {
    if std::env::var_os("EMQUAD_LSP_TRACE").is_some() {
        let head: String = message.chars().take(400).collect();
        eprintln!("lsp {direction} {head}");
    }
}

pub fn find(sidecar_dirs: &[PathBuf]) -> Option<PathBuf> {
    crate::compile::find_exe("texlab", sidecar_dirs)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn messages_are_framed_and_read_back_one_at_a_time() {
        let first = r#"{"jsonrpc":"2.0","id":1,"result":"é"}"#;
        let second = r#"{"jsonrpc":"2.0","method":"x"}"#;
        let mut stream = frame(first);
        // Servers may send extra headers and either line ending.
        stream.extend_from_slice(
            format!(
                "Content-Type: application/vscode-jsonrpc\ncontent-length: {}\n\n{second}",
                second.len()
            )
            .as_bytes(),
        );
        let mut reader = Cursor::new(stream);
        assert_eq!(read_message(&mut reader).unwrap().as_deref(), Some(first));
        assert_eq!(read_message(&mut reader).unwrap().as_deref(), Some(second));
        assert_eq!(read_message(&mut reader).unwrap(), None);
    }

    #[test]
    fn a_header_line_without_end_is_refused_rather_than_buffered() {
        let endless = vec![b'x'; 100_000];
        assert!(read_message(&mut Cursor::new(endless)).is_err());
    }

    #[test]
    fn a_missing_or_absurd_length_is_an_error_not_an_allocation() {
        let mut no_length = Cursor::new(b"X-Other: 1\r\n\r\n{}".to_vec());
        assert!(
            read_message(&mut no_length).is_err()
                || read_message(&mut no_length).unwrap().is_none()
        );
        let mut huge = Cursor::new(b"Content-Length: 99999999999\r\n\r\n{}".to_vec());
        assert!(read_message(&mut huge).is_err());
        let mut short = Cursor::new(b"Content-Length: 50\r\n\r\n{}".to_vec());
        assert!(read_message(&mut short).is_err());
    }
}
