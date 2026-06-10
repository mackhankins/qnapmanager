use crate::error::{AppError, AppResult};
use crate::models::Service;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Non-secret per-service connection settings. API keys live in the keychain.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct ServiceConfig {
    pub url: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct AppConfig {
    pub sonarr: Option<ServiceConfig>,
    pub radarr: Option<ServiceConfig>,
}

impl AppConfig {
    /// Sensible default URLs (the standard Sonarr/Radarr ports on localhost),
    /// editable in Settings.
    pub fn with_known_defaults() -> Self {
        AppConfig {
            sonarr: Some(ServiceConfig { url: "http://localhost:8989".into() }),
            radarr: Some(ServiceConfig { url: "http://localhost:7878".into() }),
        }
    }
}

const KEYCHAIN_SERVICE: &str = "com.qnapmanager.app";

fn account(service: Service) -> &'static str {
    match service {
        Service::Sonarr => "sonarr_api_key",
        Service::Radarr => "radarr_api_key",
    }
}

pub fn get_api_key(service: Service) -> AppResult<Option<String>> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, account(service))
        .map_err(|e| AppError::Config(e.to_string()))?;
    match entry.get_password() {
        Ok(k) => Ok(Some(k)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(AppError::Config(e.to_string())),
    }
}

pub fn set_api_key(service: Service, key: &str) -> AppResult<()> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, account(service))
        .map_err(|e| AppError::Config(e.to_string()))?;
    entry.set_password(key).map_err(|e| AppError::Config(e.to_string()))
}

pub fn config_path(dir: &PathBuf) -> PathBuf {
    dir.join("config.json")
}

pub fn load_config(dir: &PathBuf) -> AppResult<AppConfig> {
    let path = config_path(dir);
    if !path.exists() {
        return Ok(AppConfig::with_known_defaults());
    }
    let bytes = std::fs::read(&path).map_err(|e| AppError::Config(e.to_string()))?;
    serde_json::from_slice(&bytes).map_err(|e| AppError::Config(e.to_string()))
}

pub fn save_config(dir: &PathBuf, cfg: &AppConfig) -> AppResult<()> {
    std::fs::create_dir_all(dir).map_err(|e| AppError::Config(e.to_string()))?;
    let json = serde_json::to_vec_pretty(cfg).map_err(|e| AppError::Config(e.to_string()))?;
    std::fs::write(config_path(dir), json).map_err(|e| AppError::Config(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn load_missing_returns_known_defaults() {
        let dir = std::env::temp_dir().join("qnap-cfg-missing");
        let _ = std::fs::remove_dir_all(&dir);
        let cfg = load_config(&dir).unwrap();
        assert_eq!(cfg, AppConfig::with_known_defaults());
    }

    #[test]
    fn save_then_load_roundtrips() {
        let dir = std::env::temp_dir().join("qnap-cfg-roundtrip");
        let _ = std::fs::remove_dir_all(&dir);
        let cfg = AppConfig {
            sonarr: Some(ServiceConfig { url: "http://host:8989".into() }),
            radarr: None,
        };
        save_config(&dir, &cfg).unwrap();
        let loaded = load_config(&dir).unwrap();
        assert_eq!(loaded, cfg);
    }
}
