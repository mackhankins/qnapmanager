// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use qnap_manager_lib::{client, config, error, models};

fn main() {
    qnap_manager_lib::run()
}
