//! Kiosk-Modus des POS-Fensters (panary/panary-core#1188).
//!
//! Ein Release-Build auf einem gekoppelten Geraet startet im Vollbild ohne
//! Fensterrahmen. Alt+F4, das Schliessen des Fensters und auf macOS Cmd+Q
//! bleiben wirkungslos; beenden oder in den Fenstermodus wechseln laesst sich
//! nur ueber die POS-Einstellungen, nach Techniker- oder Inhaber-PIN.
//!
//! Die PIN prueft die UI gegen den Edge. Die Commands hier pruefen selbst
//! nichts: Der Webview laedt nur eigenen Code, und gegen jemanden mit
//! Geraetezugriff ist der Kiosk ohnehin keine Grenze (Task-Manager).

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, Runtime, WebviewWindowBuilder};

pub const MAIN_WINDOW: &str = "main";
const SETTINGS_FILE: &str = "kiosk.json";

/// Inhalt von `kiosk.json` im App-Data-Dir.
///
/// `paired` meldet der Webview (`kiosk_report_paired`), weil die Kopplung in
/// dessen localStorage liegt und Rust sie beim Start nicht lesen kann. Gespeichert
/// wird sie, damit der naechste Start schon vor dem Webview richtig entscheidet.
/// Fehlt der Wert, gilt das Geraet als NICHT gekoppelt: Im Setup gibt es keinen
/// Edge und damit keine PIN-Pruefung, ein Kiosk dort liesse sich nicht beenden.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct KioskSettings {
    #[serde(default = "enabled_default")]
    pub enabled: bool,
    #[serde(default)]
    pub paired: bool,
}

fn enabled_default() -> bool {
    true
}

impl Default for KioskSettings {
    fn default() -> Self {
        Self {
            enabled: enabled_default(),
            paired: false,
        }
    }
}

/// Kiosk aktiv = Release-Build UND Schalter an UND gekoppelt UND nicht per
/// „Fenstermodus" fuer diesen Lauf ausgesetzt.
pub fn kiosk_active(release_build: bool, settings: KioskSettings, window_mode: bool) -> bool {
    release_build && settings.enabled && settings.paired && !window_mode
}

/// Fenster schliessen (Alt+F4, Schliessen-Schaltflaeche, Cmd+W) verhindern?
pub fn should_prevent_close(active: bool, exit_released: bool) -> bool {
    active && !exit_released
}

/// App-Exit verhindern? Nur Benutzeraktionen (`code == None`). Programmatische
/// Exits und Restarts mit Code laufen durch, damit der Updater (`relaunch()`)
/// und `kiosk_exit` unberuehrt bleiben.
pub fn should_prevent_exit(active: bool, exit_released: bool, code: Option<i32>) -> bool {
    active && !exit_released && code.is_none()
}

pub struct KioskState {
    release_build: bool,
    path: Option<PathBuf>,
    settings: Mutex<KioskSettings>,
    window_mode: AtomicBool,
    exit_released: AtomicBool,
}

impl KioskState {
    pub fn load<R: Runtime>(app: &AppHandle<R>) -> Self {
        // Laufzeit-Abfrage statt `#[cfg]`-Attribut: So kompilieren fmt, clippy
        // und `cargo test` den Release-Zweig auch im Debug-Profil mit.
        let release_build = !cfg!(debug_assertions);
        let path = app
            .path()
            .app_data_dir()
            .ok()
            .map(|d| d.join(SETTINGS_FILE));
        let settings = path.as_deref().map(read_settings).unwrap_or_default();
        Self {
            release_build,
            path,
            settings: Mutex::new(settings),
            window_mode: AtomicBool::new(false),
            exit_released: AtomicBool::new(false),
        }
    }

    pub fn active(&self) -> bool {
        kiosk_active(
            self.release_build,
            self.settings(),
            self.window_mode.load(Ordering::SeqCst),
        )
    }

    pub fn exit_released(&self) -> bool {
        self.exit_released.load(Ordering::SeqCst)
    }

    fn settings(&self) -> KioskSettings {
        *self.settings.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn update_settings(&self, change: impl FnOnce(&mut KioskSettings)) -> Result<(), String> {
        let mut guard = self.settings.lock().unwrap_or_else(|e| e.into_inner());
        let before = *guard;
        change(&mut guard);
        if *guard == before {
            return Ok(());
        }
        match &self.path {
            Some(path) => write_settings(path, *guard),
            None => Err("App-Data-Verzeichnis nicht ermittelbar".to_string()),
        }
    }
}

/// Lese- und Parse-Fehler fallen auf die Vorgabe zurueck: Das Fenster muss in
/// jedem Fall entstehen, ein Abbruch hier liesse die Kasse ohne Oberflaeche.
fn read_settings(path: &std::path::Path) -> KioskSettings {
    match std::fs::read_to_string(path) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_else(|e| {
            log::warn!("[kiosk] {SETTINGS_FILE} unlesbar, Vorgabe gilt: {e}");
            KioskSettings::default()
        }),
        Err(_) => KioskSettings::default(),
    }
}

fn write_settings(path: &std::path::Path, settings: KioskSettings) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string(&settings).map_err(|e| e.to_string())?;
    std::fs::write(path, text).map_err(|e| e.to_string())
}

/// Legt das Hauptfenster an (`create: false` in `tauri.conf.json`). Vollbild und
/// Rahmen werden beim Erzeugen gesetzt, nicht danach: So erscheint das Fenster
/// nicht kurz mit Rahmen, und es gibt kein verstecktes Fenster, das bei einem
/// Fehler unsichtbar bliebe.
pub fn create_main_window<R: Runtime>(app: &AppHandle<R>, active: bool) -> tauri::Result<()> {
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == MAIN_WINDOW)
        .cloned()
        .unwrap_or_default();
    WebviewWindowBuilder::from_config(app, &config)?
        .fullscreen(active)
        .decorations(!active)
        .build()?;
    apply_menu(app, active)
}

/// Stellt Fenster und Menue auf den aktuellen Zustand um (nach Schalter,
/// Kopplung oder Fenstermodus zur Laufzeit).
fn apply<R: Runtime>(app: &AppHandle<R>, active: bool) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        window.set_fullscreen(active).map_err(|e| e.to_string())?;
        window.set_decorations(!active).map_err(|e| e.to_string())?;
    }
    apply_menu(app, active).map_err(|e| e.to_string())
}

/// macOS: Der Quit-Eintrag des Standard-App-Menues loest `terminate:` aus, das
/// in tao ohne `ExitRequested` direkt zu `RunEvent::Exit` wird und sich nicht
/// aufhalten laesst. Im Kiosk deshalb ein Menue ohne Quit, damit Cmd+Q keinen
/// Eintrag hat. Das Bearbeiten-Menue bleibt, sonst gehen Cmd+C/V im Webview
/// verloren. Windows und Linux haben kein App-Menue; ein `set_menu` dort
/// haengte eine Menueleiste ans Fenster.
fn apply_menu<R: Runtime>(app: &AppHandle<R>, active: bool) -> tauri::Result<()> {
    #[cfg(target_os = "macos")]
    {
        use tauri::menu::{Menu, PredefinedMenuItem, Submenu};
        let menu = if active {
            Menu::with_items(
                app,
                &[
                    &Submenu::with_items(
                        app,
                        app.package_info().name.clone(),
                        true,
                        &[&PredefinedMenuItem::about(app, None, None)?],
                    )?,
                    &Submenu::with_items(
                        app,
                        "Edit",
                        true,
                        &[
                            &PredefinedMenuItem::undo(app, None)?,
                            &PredefinedMenuItem::redo(app, None)?,
                            &PredefinedMenuItem::separator(app)?,
                            &PredefinedMenuItem::cut(app, None)?,
                            &PredefinedMenuItem::copy(app, None)?,
                            &PredefinedMenuItem::paste(app, None)?,
                            &PredefinedMenuItem::select_all(app, None)?,
                        ],
                    )?,
                ],
            )?
        } else {
            Menu::default(app)?
        };
        app.set_menu(menu)?;
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, active);
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KioskStatus {
    active: bool,
    enabled: bool,
    paired: bool,
    release_build: bool,
    window_mode: bool,
}

fn status(state: &KioskState) -> KioskStatus {
    let settings = state.settings();
    KioskStatus {
        active: state.active(),
        enabled: settings.enabled,
        paired: settings.paired,
        release_build: state.release_build,
        window_mode: state.window_mode.load(Ordering::SeqCst),
    }
}

#[tauri::command]
pub fn kiosk_status(state: tauri::State<'_, KioskState>) -> KioskStatus {
    status(&state)
}

/// Der Webview meldet beim Start, ob das Geraet gekoppelt ist. Nach dem Pairing
/// und dem Entkoppeln laedt die App neu und meldet damit erneut.
#[tauri::command]
pub fn kiosk_report_paired<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, KioskState>,
    paired: bool,
) -> Result<KioskStatus, String> {
    let before = state.active();
    state.update_settings(|s| s.paired = paired)?;
    if state.active() != before {
        apply(&app, state.active())?;
    }
    Ok(status(&state))
}

/// Schaltet den Kiosk auf diesem Geraet dauerhaft an oder aus (z. B. Buero-PC).
#[tauri::command]
pub fn kiosk_set_enabled<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, KioskState>,
    enabled: bool,
) -> Result<KioskStatus, String> {
    state.update_settings(|s| s.enabled = enabled)?;
    // Ein bewusstes Einschalten hebt den Fenstermodus dieses Laufs auf.
    if enabled {
        state.window_mode.store(false, Ordering::SeqCst);
    }
    apply(&app, state.active())?;
    log::info!(
        "[kiosk] Geraete-Schalter: {}",
        if enabled { "an" } else { "aus" }
    );
    Ok(status(&state))
}

/// Fenstermodus bis zum naechsten Start. Der Schalter in `kiosk.json` bleibt.
#[tauri::command]
pub fn kiosk_window_mode<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, KioskState>,
) -> Result<KioskStatus, String> {
    state.window_mode.store(true, Ordering::SeqCst);
    apply(&app, false)?;
    log::info!("[kiosk] Fenstermodus bis zum naechsten Start");
    Ok(status(&state))
}

/// Beendet das Terminal (Notausgang nach PIN-Pruefung in der UI).
#[tauri::command]
pub fn kiosk_exit<R: Runtime>(app: AppHandle<R>, state: tauri::State<'_, KioskState>) {
    state.exit_released.store(true, Ordering::SeqCst);
    log::info!("[kiosk] Terminal wird beendet");
    app.exit(0);
}

#[cfg(test)]
mod tests {
    use super::*;

    const fn s(enabled: bool, paired: bool) -> KioskSettings {
        KioskSettings { enabled, paired }
    }

    #[test]
    fn kiosk_nur_im_release_mit_schalter_und_kopplung() {
        for release in [false, true] {
            for enabled in [false, true] {
                for paired in [false, true] {
                    for window_mode in [false, true] {
                        let expected = release && enabled && paired && !window_mode;
                        assert_eq!(
                            kiosk_active(release, s(enabled, paired), window_mode),
                            expected,
                            "release={release} enabled={enabled} paired={paired} window_mode={window_mode}"
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn fehlende_datei_gilt_als_ungekoppelt_mit_schalter_an() {
        assert_eq!(KioskSettings::default(), s(true, false));
        assert!(!kiosk_active(true, KioskSettings::default(), false));
    }

    #[test]
    fn fehlende_felder_fallen_auf_die_vorgabe() {
        let parsed: KioskSettings = serde_json::from_str("{}").unwrap();
        assert_eq!(parsed, s(true, false));
        let parsed: KioskSettings = serde_json::from_str(r#"{"paired":true}"#).unwrap();
        assert_eq!(parsed, s(true, true));
        let parsed: KioskSettings = serde_json::from_str(r#"{"enabled":false}"#).unwrap();
        assert_eq!(parsed, s(false, false));
    }

    #[test]
    fn unlesbare_datei_faellt_auf_die_vorgabe() {
        let dir = std::env::temp_dir().join(format!("panary-kiosk-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(SETTINGS_FILE);
        std::fs::write(&path, "kein json").unwrap();
        assert_eq!(read_settings(&path), KioskSettings::default());
        write_settings(&path, s(false, true)).unwrap();
        assert_eq!(read_settings(&path), s(false, true));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn schliessen_nur_im_kiosk_ohne_freigabe_verhindert() {
        assert!(should_prevent_close(true, false));
        assert!(!should_prevent_close(true, true));
        assert!(!should_prevent_close(false, false));
        assert!(!should_prevent_close(false, true));
    }

    #[test]
    fn exit_nur_bei_benutzeraktion_im_kiosk_verhindert() {
        assert!(should_prevent_exit(true, false, None));
        // Programmatisch (kiosk_exit, Updater-Restart): laeuft durch.
        assert!(!should_prevent_exit(true, false, Some(0)));
        assert!(!should_prevent_exit(true, false, Some(i32::MAX)));
        assert!(!should_prevent_exit(true, true, None));
        assert!(!should_prevent_exit(false, false, None));
    }
}
