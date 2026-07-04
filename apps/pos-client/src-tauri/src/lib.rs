use serde::Serialize;
use std::collections::HashMap;
use std::time::{Duration, Instant};

/// Ein im LAN gefundener Panary-Hub (Edge-Server) inkl. mDNS-TXT-Records.
#[derive(Serialize)]
struct DiscoveredHub {
    name: String,
    host: String,
    port: u16,
    addresses: Vec<String>,
    txt: HashMap<String, String>,
}

/// Sucht per mDNS nach Panary-Hubs (`_panary._tcp`) im lokalen Netzwerk.
///
/// Läuft blockierend in einem Worker-Thread (spawn_blocking), damit der
/// 2–3-Sekunden-Scan den UI-Thread nicht einfriert. Pure-Rust (mdns-sd),
/// daher ohne Avahi auf Windows + Linux/Ubuntu nutzbar.
#[tauri::command]
async fn discover_panary_hubs(timeout_ms: Option<u64>) -> Result<Vec<DiscoveredHub>, String> {
    let timeout = Duration::from_millis(timeout_ms.unwrap_or(2500));
    tauri::async_runtime::spawn_blocking(move || browse_hubs(timeout))
        .await
        .map_err(|e| e.to_string())?
}

fn browse_hubs(timeout: Duration) -> Result<Vec<DiscoveredHub>, String> {
    use mdns_sd::{ServiceDaemon, ServiceEvent};

    let mdns = ServiceDaemon::new().map_err(|e| e.to_string())?;
    let service_type = "_panary._tcp.local.";
    let receiver = mdns.browse(service_type).map_err(|e| e.to_string())?;

    let deadline = Instant::now() + timeout;
    // Dedupe über den mDNS-Fullname — ein Hub kann mehrfach aufgelöst werden.
    let mut hubs: HashMap<String, DiscoveredHub> = HashMap::new();

    loop {
        let now = Instant::now();
        if now >= deadline {
            break;
        }
        match receiver.recv_timeout(deadline - now) {
            Ok(ServiceEvent::ServiceResolved(info)) => {
                let mut txt = HashMap::new();
                for prop in info.get_properties().iter() {
                    txt.insert(prop.key().to_string(), prop.val_str().to_string());
                }
                let addresses: Vec<String> =
                    info.get_addresses().iter().map(|a| a.to_string()).collect();
                let fullname = info.get_fullname().to_string();
                hubs.insert(
                    fullname.clone(),
                    DiscoveredHub {
                        name: fullname,
                        host: info.get_hostname().to_string(),
                        port: info.get_port(),
                        addresses,
                        txt,
                    },
                );
            }
            Ok(_) => {}
            // Timeout oder geschlossener Kanal → Scan beenden.
            Err(_) => break,
        }
    }

    let _ = mdns.shutdown();
    Ok(hubs.into_values().collect())
}

/// Schreibt eine vom Webview (Angular) gemeldete Logzeile in die native
/// Logdatei (via `log`-Crate → tauri-plugin-log). So landen Frontend-Ereignisse
/// und -Fehler (z. B. „Failed to fetch", Update-Check) persistent auf der Platte.
#[tauri::command]
fn js_log(level: String, message: String) {
    match level.as_str() {
        "error" => log::error!("[webview] {message}"),
        "warn" => log::warn!("[webview] {message}"),
        "debug" => log::debug!("[webview] {message}"),
        "trace" => log::trace!("[webview] {message}"),
        _ => log::info!("[webview] {message}"),
    }
}

/// Liest die aktuelle Logdatei und gibt sie — auf die letzten ~200 KB begrenzt —
/// als String zurück (für die „Logs einsehen"-Ansicht in den Einstellungen).
#[tauri::command]
fn read_logs(app: tauri::AppHandle) -> Result<String, String> {
    use tauri::Manager;
    let path = app
        .path()
        .app_log_dir()
        .map_err(|e| e.to_string())?
        .join("panary-pos.log");
    match std::fs::read(&path) {
        Ok(bytes) => {
            // Byte-genaues Tail (nicht Zeichen) → letzte 200 KB, UTF-8-sicher via lossy.
            const MAX: usize = 200 * 1024;
            let start = bytes.len().saturating_sub(MAX);
            Ok(String::from_utf8_lossy(&bytes[start..]).into_owned())
        }
        Err(ref e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(e.to_string()),
    }
}

/// Öffnet das Log-Verzeichnis im Datei-Explorer — für „Logs exportieren":
/// der Betreiber kann die `.log`-Datei dann direkt an den Support senden.
#[tauri::command]
fn open_log_dir(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    use tauri_plugin_shell::ShellExt;
    let dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    // Verzeichnis sicherstellen, falls noch keine Zeile geschrieben wurde.
    let _ = std::fs::create_dir_all(&dir);
    app.shell()
        .open(dir.to_string_lossy().into_owned(), None)
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Log-Plugin ZUERST registrieren, damit es auch die Meldungen der
        // nachfolgenden Plugins (updater etc.) erfasst. Rotation: max. 5 MB pro
        // Datei, KeepOne → aktuelle + eine rotierte Datei (~10 MB Deckel auf der
        // Platte, kein unbegrenztes Wachstum auf dem POS-Gerät).
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("panary-pos".into()),
                    }),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                ])
                .max_file_size(5_000_000)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepOne)
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            discover_panary_hubs,
            js_log,
            read_logs,
            open_log_dir
        ])
        .run(tauri::generate_context!())
        .expect("Fehler beim Starten der Panary POS Anwendung");
}
