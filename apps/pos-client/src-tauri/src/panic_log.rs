//! Rust-Panics in die native Logdatei (ADR 0069, panary/panary-core#1343).
//!
//! Ohne Hook geht ein Panic nur auf stderr. Windows-Release-Builds haben kein
//! Konsolenfenster (`windows_subsystem = "windows"` in `main.rs`), dort ist er damit
//! unsichtbar. Der Hook schreibt Ort und Meldung per `log::error!` in die Datei des
//! Log-Plugins und ruft danach den bisherigen Hook auf, damit stderr erhalten bleibt.

use std::any::Any;
use std::panic::PanicHookInfo;

/// Setzt den Hook. Erst aufrufen, wenn das Log-Plugin registriert ist (im `.setup`-Closure),
/// sonst geht `log::error!` ins Leere.
pub fn install() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        log::error!("{}", panic_line(info));
        previous(info);
    }));
}

/// Eine Zeile mit Thread, Ort und Meldung. Rein, damit der Test sie prüfen kann.
pub(crate) fn panic_line(info: &PanicHookInfo<'_>) -> String {
    let thread = std::thread::current();
    let name = thread.name().unwrap_or("<unbenannt>");
    let location = info
        .location()
        .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
        .unwrap_or_else(|| "<unbekannter Ort>".to_string());
    format!(
        "[panic] Thread '{name}' bei {location}: {}",
        payload_text(info.payload())
    )
}

/// `panic!("text")` liefert `&str`, `panic!("{x}")` und `.expect(…)` liefern `String`.
fn payload_text(payload: &(dyn Any + Send)) -> &str {
    if let Some(s) = payload.downcast_ref::<&str>() {
        s
    } else if let Some(s) = payload.downcast_ref::<String>() {
        s.as_str()
    } else {
        "<Nutzlast ohne Text>"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    /// Der Panic-Hook ist prozessweit, Rust-Tests laufen parallel. Deshalb wird der
    /// bisherige Hook vorher genommen und danach wieder gesetzt, und der Test-Hook
    /// zeichnet nur Panics des eigenen Threads auf.
    fn capture(f: impl FnOnce() + std::panic::UnwindSafe) -> String {
        let seen = Arc::new(Mutex::new(None::<String>));
        let sink = Arc::clone(&seen);
        let me = std::thread::current().id();
        let previous = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            if std::thread::current().id() == me {
                *sink.lock().unwrap() = Some(panic_line(info));
            }
        }));
        let result = std::panic::catch_unwind(f);
        std::panic::set_hook(previous);
        assert!(result.is_err(), "der Testkörper muss paniken");
        let line = seen.lock().unwrap().take();
        line.expect("der Hook hat nichts aufgezeichnet")
    }

    #[test]
    fn zeile_nennt_ort_und_statische_meldung() {
        let line = capture(|| panic!("Fenster nicht erzeugt"));
        assert!(line.starts_with("[panic] Thread '"), "{line}");
        assert!(line.contains("panic_log.rs:"), "{line}");
        assert!(line.ends_with(": Fenster nicht erzeugt"), "{line}");
    }

    #[test]
    fn zeile_nennt_formatierte_meldung_und_expect() {
        let code = 7;
        let line = capture(move || panic!("Fehlercode {code}"));
        assert!(line.ends_with(": Fehlercode 7"), "{line}");

        let line = capture(|| {
            // black_box, sonst erkennt clippy das konstante `None` und verlangt ein `panic!`.
            let fehlt: Option<u8> = std::hint::black_box(None);
            fehlt.expect("Konfiguration fehlt");
        });
        assert!(line.ends_with(": Konfiguration fehlt"), "{line}");
    }

    #[test]
    fn zeile_ohne_text_nutzlast() {
        let line = capture(|| std::panic::panic_any(42_u32));
        assert!(line.ends_with(": <Nutzlast ohne Text>"), "{line}");
    }
}
