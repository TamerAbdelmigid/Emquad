//! Picking references from Zotero, when it runs on this computer with the Better BibTeX add-on.
//!
//! The app speaks to Zotero only when the user asks, and only on this computer's own address:
//! Better BibTeX listens on 127.0.0.1:23119. Its "cite as you write" picker lets the user choose
//! references in Zotero, and its export gives them as BibTeX for the project's `.bib` file.

use crate::error::{Error, Result};
use serde::Serialize;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::time::Duration;
use ts_rs::TS;

/// Where Better BibTeX listens: this computer only.
const ZOTERO: ([u8; 4], u16) = ([127, 0, 0, 1], 23119);
/// The most a reply may hold: an export of many references is still far less.
const MAX_REPLY: u64 = 16 << 20;

/// References chosen in Zotero.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Picked {
    /// Their citation keys, in the order chosen.
    pub keys: Vec<String>,
    /// Their entries, as BibTeX.
    pub bibtex: String,
}

fn missing() -> Error {
    Error::app(
        "zotero_missing",
        "Zotero is not running, or its Better BibTeX add-on is not installed. Start Zotero with Better BibTeX, then try again.",
    )
}

/// One HTTP request to Better BibTeX at `port` on this computer; the body of its reply.
fn ask(port: u16, method: &str, path: &str, body: Option<&str>, wait: Duration) -> Result<String> {
    let address = SocketAddr::from((ZOTERO.0, port));
    let mut stream =
        TcpStream::connect_timeout(&address, Duration::from_secs(2)).map_err(|_| missing())?;
    stream.set_read_timeout(Some(wait))?;
    stream.set_write_timeout(Some(Duration::from_secs(5)))?;
    let body = body.unwrap_or("");
    // Sent in one piece.
    let request = format!(
        "{method} {path} HTTP/1.1
Host: 127.0.0.1:{port}
Content-Type: application/json
Content-Length: {}
Connection: close

{body}",
        body.len()
    );
    stream.write_all(request.as_bytes())?;
    stream.flush()?;
    let mut reply = Vec::new();
    stream
        .take(MAX_REPLY)
        .read_to_end(&mut reply)
        .map_err(|e| {
            if matches!(
                e.kind(),
                std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
            ) {
                Error::app(
                    "zotero_timeout",
                    "Zotero did not answer in time. Try again.",
                )
            } else {
                Error::Io(e)
            }
        })?;
    let reply = String::from_utf8_lossy(&reply).into_owned();
    let (head, rest) = reply.split_once("\r\n\r\n").ok_or_else(missing)?;
    let status = head.split_whitespace().nth(1).unwrap_or("");
    if status != "200" {
        return Err(Error::app(
            "zotero_failed",
            format!("Zotero answered {status}: {}", rest.trim()),
        ));
    }
    // Better BibTeX may send its reply in chunks.
    if head
        .to_ascii_lowercase()
        .contains("transfer-encoding: chunked")
    {
        return Ok(unchunk(rest));
    }
    Ok(rest.to_string())
}

/// The body of a reply sent in chunks.
fn unchunk(mut rest: &str) -> String {
    let mut out = String::new();
    while let Some((size, after)) = rest.split_once("\r\n") {
        let Ok(size) = usize::from_str_radix(size.trim(), 16) else {
            break;
        };
        if size == 0 || after.len() < size {
            break;
        }
        out.push_str(&after[..size]);
        rest = after[size..].trim_start_matches("\r\n");
    }
    out
}

/// Ask the user to pick references in Zotero, and give their keys and their BibTeX; `None` when
/// the user closes the picker without choosing.
pub fn pick_at(port: u16) -> Result<Option<Picked>> {
    if ask(
        port,
        "GET",
        "/better-bibtex/cayw?probe=true",
        None,
        Duration::from_secs(5),
    )?
    .trim()
        != "ready"
    {
        return Err(missing());
    }
    // The picker stays open while the user chooses, which can take a while.
    let chosen = ask(
        port,
        "GET",
        "/better-bibtex/cayw?format=json",
        None,
        Duration::from_secs(600),
    )?;
    let items: Vec<serde_json::Value> = if chosen.trim().is_empty() {
        Vec::new()
    } else {
        serde_json::from_str(&chosen)?
    };
    let keys: Vec<String> = items
        .iter()
        .filter_map(|item| {
            item.get("citationKey")
                .or_else(|| item.get("citekey"))
                .and_then(|k| k.as_str())
        })
        .map(str::to_string)
        .collect();
    if keys.is_empty() {
        return Ok(None);
    }
    let request = serde_json::json!({ "jsonrpc": "2.0", "method": "item.export", "params": [keys, "betterbibtex"], "id": 1 });
    let reply: serde_json::Value = serde_json::from_str(&ask(
        port,
        "POST",
        "/better-bibtex/json-rpc",
        Some(&request.to_string()),
        Duration::from_secs(30),
    )?)?;
    if let Some(error) = reply.get("error") {
        return Err(Error::app(
            "zotero_failed",
            format!("Zotero could not give the references: {error}"),
        ));
    }
    // The export is the result itself, or, in some versions, the text among what is returned.
    let result = reply.get("result").cloned().unwrap_or_default();
    let bibtex = match &result {
        serde_json::Value::String(text) => text.clone(),
        serde_json::Value::Array(parts) => parts
            .iter()
            .filter_map(|p| p.as_str())
            .find(|p| p.contains('@'))
            .unwrap_or("")
            .to_string(),
        _ => String::new(),
    };
    if !bibtex.contains('@') {
        return Err(Error::app(
            "zotero_failed",
            "Zotero gave no BibTeX for the references chosen.",
        ));
    }
    Ok(Some(Picked { keys, bibtex }))
}

pub fn pick() -> Result<Option<Picked>> {
    pick_at(ZOTERO.1)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    /// A stand-in for Better BibTeX: answers each request in turn with the reply given for it,
    /// and notes what was asked.
    fn zotero(replies: Vec<&'static str>) -> (u16, std::sync::mpsc::Receiver<String>) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let (told, asked) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            for reply in replies {
                let (mut stream, _) = listener.accept().unwrap();
                // The whole request, its body too, before answering.
                let mut request = Vec::new();
                let mut buf = [0u8; 4096];
                loop {
                    let n = stream.read(&mut buf).unwrap();
                    request.extend_from_slice(&buf[..n]);
                    let text = String::from_utf8_lossy(&request).into_owned();
                    if let Some((head, rest)) = text.split_once(
                        "

",
                    ) {
                        let length = head
                            .lines()
                            .find_map(|l| l.strip_prefix("Content-Length: "))
                            .and_then(|n| n.trim().parse::<usize>().ok())
                            .unwrap_or(0);
                        if rest.len() >= length {
                            break;
                        }
                    }
                    if n == 0 {
                        break;
                    }
                }
                told.send(String::from_utf8_lossy(&request).into_owned())
                    .unwrap();
                stream.write_all(reply.as_bytes()).unwrap();
                stream.shutdown(std::net::Shutdown::Write).unwrap();
            }
        });
        (port, asked)
    }

    const OK: &str = "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\n";

    #[test]
    fn references_picked_in_zotero_come_with_their_bibtex() {
        let (port, asked) = zotero(vec![
            "HTTP/1.1 200 OK\r\n\r\nready",
            "HTTP/1.1 200 OK\r\n\r\n[{\"citationKey\":\"knuth1984\"},{\"citekey\":\"lamport1994\"}]",
            "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n2d\r\n{\"jsonrpc\":\"2.0\",\"result\":\"@book{knuth1984,}\"\r\n1\r\n}\r\n0\r\n\r\n",
        ]);
        let picked = pick_at(port).unwrap().unwrap();
        assert_eq!(
            picked,
            Picked {
                keys: vec!["knuth1984".into(), "lamport1994".into()],
                bibtex: "@book{knuth1984,}".into()
            }
        );
        assert!(
            asked
                .recv()
                .unwrap()
                .starts_with("GET /better-bibtex/cayw?probe=true HTTP/1.1")
        );
        assert!(
            asked
                .recv()
                .unwrap()
                .starts_with("GET /better-bibtex/cayw?format=json HTTP/1.1")
        );
        let export = asked.recv().unwrap();
        assert!(
            export.starts_with("POST /better-bibtex/json-rpc HTTP/1.1")
                && export.contains("\"item.export\"")
                && export.contains("knuth1984")
        );
    }

    #[test]
    fn closing_the_picker_chooses_nothing_and_no_zotero_says_so() {
        let (port, _asked) = zotero(vec!["HTTP/1.1 200 OK\r\n\r\nready", OK]);
        assert_eq!(pick_at(port).unwrap(), None);
        // Nothing listening: Zotero is not running.
        let unused = TcpListener::bind(("127.0.0.1", 0))
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        assert_eq!(pick_at(unused).unwrap_err().code(), "zotero_missing");
        // Something else answering there is not Better BibTeX.
        let (port, _asked) = zotero(vec!["HTTP/1.1 404 Not Found\r\n\r\nno"]);
        assert_eq!(pick_at(port).unwrap_err().code(), "zotero_failed");
    }
}
