// Verhindert Konsolenfenster auf Windows in Release-Builds
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    panary_pos_lib::run()
}
