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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![discover_panary_hubs])
        .run(tauri::generate_context!())
        .expect("Fehler beim Starten der Panary POS Anwendung");
}
