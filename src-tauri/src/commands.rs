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

async fn load_service(service: Service, sc: Option<ServiceConfig>) -> Result<Vec<LibraryItem>, ServiceError> {
    let sc = match sc.filter(|s| !s.url.is_empty()) {
        Some(s) => s,
        None => return Ok(Vec::new()),
    };
    let client = client_for(service, &sc).map_err(|e| ServiceError {
        service: format!("{:?}", service),
        message: e.to_string(),
    })?;
    client.list().await.map_err(|e| ServiceError {
        service: format!("{:?}", service),
        message: e.to_string(),
    })
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
    // Empty key field means "use the stored key" (mirrors save_config's blank-key semantics).
    let key = if api_key.is_empty() {
        config::get_api_key(service)?.unwrap_or_default()
    } else {
        api_key
    };
    ArrClient::new(service, &url, &key).test_connection().await
}

#[tauri::command]
pub async fn list_library(app: tauri::AppHandle) -> Result<LoadResult, AppError> {
    let cfg = config::load_config(&config_dir(&app)?)?;
    let (sonarr, radarr) = tokio::join!(
        load_service(Service::Sonarr, cfg.sonarr.clone()),
        load_service(Service::Radarr, cfg.radarr.clone()),
    );
    let mut items = Vec::new();
    let mut errors = Vec::new();
    for res in [sonarr, radarr] {
        match res {
            Ok(mut v) => items.append(&mut v),
            Err(e) => errors.push(e),
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
