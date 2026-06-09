// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod error;
mod models;

fn main() {
    qnap_scaffold_lib::run()
}
