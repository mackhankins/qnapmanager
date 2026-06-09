use crate::client::{ArrClient, MediaServer};
use crate::config::{self, AppConfig, ServiceConfig};
use crate::error::{AppError, AppResult};
use crate::models::{toggle_tag, LibraryItem, Service};
use serde::Serialize;
use std::path::PathBuf;
use tauri::Manager;

/// Resolve the app config directory from the Tauri handle.
fn config_dir(app: &tauri::AppHandle) -> AppResult<PathBuf> {
    app.path()
        .app_config_dir()
        .map_err(|e| AppError::Config(e.to_string()))
}

fn client_for(service: Service, sc: &ServiceConfig) -> AppResult<ArrClient> {
    let key = config::get_api_key(service)?
        .ok_or_else(|| AppError::Config(format!("no API key set for {:?}", service)))?;
    Ok(ArrClient::new(service, &sc.url, &key))
}

#[derive(Serialize)]
pub struct LoadResult {
    pub items: Vec<LibraryItem>,
    /// Per-service load errors (service name -> message); UI shows a banner.
    pub errors: Vec<ServiceError>,
}

#[derive(Serialize)]
pub struct ServiceError {
    pub service: String,
    pub message: String,
}

#[tauri::command]
pub fn get_config(app: tauri::AppHandle) -> Result<AppConfig, AppError> {
    config::load_config(&config_dir(&app)?)
}

#[tauri::command]
pub fn save_config(
    app: tauri::AppHandle,
    config_in: AppConfig,
    sonarr_key: Option<String>,
    radarr_key: Option<String>,
) -> Result<(), AppError> {
    if let Some(k) = sonarr_key.filter(|k| !k.is_empty()) {
        config::set_api_key(Service::Sonarr, &k)?;
    }
    if let Some(k) = radarr_key.filter(|k| !k.is_empty()) {
        config::set_api_key(Service::Radarr, &k)?;
    }
    config::save_config(&config_dir(&app)?, &config_in)
}

#[tauri::command]
pub async fn test_connection(url: String, api_key: String, service: Service) -> Result<(), AppError> {
    ArrClient::new(service, &url, &api_key).test_connection().await
}

#[tauri::command]
pub async fn list_library(app: tauri::AppHandle) -> Result<LoadResult, AppError> {
    let cfg = config::load_config(&config_dir(&app)?)?;
    let mut items = Vec::new();
    let mut errors = Vec::new();

    for (service, sc) in [
        (Service::Sonarr, cfg.sonarr.clone()),
        (Service::Radarr, cfg.radarr.clone()),
    ] {
        let Some(sc) = sc.filter(|s| !s.url.is_empty()) else { continue };
        match client_for(service, &sc) {
            Ok(client) => match client.list().await {
                Ok(mut list) => items.append(&mut list),
                Err(e) => errors.push(ServiceError {
                    service: format!("{:?}", service),
                    message: e.to_string(),
                }),
            },
            Err(e) => errors.push(ServiceError {
                service: format!("{:?}", service),
                message: e.to_string(),
            }),
        }
    }
    Ok(LoadResult { items, errors })
}

#[tauri::command]
pub async fn toggle_temporary_tag(
    app: tauri::AppHandle,
    item: LibraryItem,
) -> Result<(), AppError> {
    let cfg = config::load_config(&config_dir(&app)?)?;
    let sc = match item.service {
        Service::Sonarr => cfg.sonarr,
        Service::Radarr => cfg.radarr,
    }
    .ok_or_else(|| AppError::Config("service not configured".into()))?;
    let client = client_for(item.service, &sc)?;
    let tag_id = client.ensure_temporary_tag().await?;
    // Toggle on tag ids: if the temporary tag id is already present it's removed, else added.
    let new_tags = toggle_tag(&item.tags, tag_id);
    client.set_item_tags(item.id, &new_tags).await
}

#[tauri::command]
pub async fn delete_item(app: tauri::AppHandle, item: LibraryItem) -> Result<(), AppError> {
    let cfg = config::load_config(&config_dir(&app)?)?;
    let sc = match item.service {
        Service::Sonarr => cfg.sonarr,
        Service::Radarr => cfg.radarr,
    }
    .ok_or_else(|| AppError::Config("service not configured".into()))?;
    client_for(item.service, &sc)?.delete_with_files(item.id).await
}

#[derive(Serialize)]
pub struct BulkResult {
    pub deleted: Vec<i64>,
    pub failed: Vec<BulkFailure>,
}

#[derive(Serialize)]
pub struct BulkFailure {
    pub id: i64,
    pub title: String,
    pub message: String,
}

#[tauri::command]
pub async fn bulk_delete(app: tauri::AppHandle, items: Vec<LibraryItem>) -> Result<BulkResult, AppError> {
    let cfg = config::load_config(&config_dir(&app)?)?;
    let mut deleted = Vec::new();
    let mut failed = Vec::new();
    for item in items {
        let sc = match item.service {
            Service::Sonarr => cfg.sonarr.clone(),
            Service::Radarr => cfg.radarr.clone(),
        };
        let result = async {
            let sc = sc.ok_or_else(|| AppError::Config("service not configured".into()))?;
            client_for(item.service, &sc)?.delete_with_files(item.id).await
        }
        .await;
        match result {
            Ok(()) => deleted.push(item.id),
            Err(e) => failed.push(BulkFailure { id: item.id, title: item.title, message: e.to_string() }),
        }
    }
    Ok(BulkResult { deleted, failed })
}
