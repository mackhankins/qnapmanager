# QNAP Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local-only Tauri desktop app that browses Sonarr/Radarr libraries and lets the user view size/age, toggle a `temporary` tag, and delete items (files + entry) manually with confirmation.

**Architecture:** Tauri app. Rust backend owns all Sonarr/Radarr HTTP, normalizes both services into one `LibraryItem` type behind a `MediaServer` trait (implemented once by a generic `ArrClient` keyed on a `Service` enum, since the two v3 APIs differ only in endpoint path and id field). React frontend (TanStack Table) renders one unified, sortable table and calls Rust via Tauri commands. API keys live in the OS keychain; URLs in a JSON config file.

**Tech Stack:** Tauri 2, Rust (reqwest, serde, tokio, thiserror, keyring, chrono; wiremock for tests), React + TypeScript + Vite, TanStack Table, Vitest + React Testing Library.

---

## File Structure

**Rust backend (`src-tauri/src/`):**
- `main.rs` — Tauri builder; registers commands and shared state.
- `error.rs` — `AppError` enum (thiserror) + `Serialize` so errors cross to JS; `AppResult<T>` alias.
- `models.rs` — `Service` enum, `LibraryItem`, raw Sonarr/Radarr response structs, `normalize_series`/`normalize_movie`, tag-set diff helper.
- `config.rs` — `AppConfig` (per-service URL), load/save to app-config dir; keychain get/set/delete for API keys.
- `client.rs` — `MediaServer` trait + generic `ArrClient` implementing it for both services.
- `commands.rs` — Tauri commands: `get_config`, `save_config`, `test_connection`, `list_library`, `toggle_temporary_tag`, `delete_item`, `bulk_delete`.

**Frontend (`src/`):**
- `api.ts` — typed wrappers over `@tauri-apps/api` `invoke`, plus TS mirror types of `LibraryItem`/`AppConfig`.
- `lib/format.ts` — `formatBytes`, `ageDays`/`formatAge` (age derived in the UI from `added`).
- `components/LibraryTable.tsx` — TanStack table: columns, filter chips, search, selection bar.
- `components/ConfirmDeleteDialog.tsx` — itemized delete confirmation with total reclaimed size.
- `components/Settings.tsx` — per-service URL + key form with Test Connection.
- `App.tsx` — shell: switches between table and settings, initial load, per-service error banner.

**Tests:**
- `src-tauri/src/models.rs` (inline `#[cfg(test)]`), `src-tauri/tests/client.rs` (wiremock), `src-tauri/src/config.rs` (inline).
- `src/lib/format.test.ts`, `src/components/LibraryTable.test.tsx`, `src/components/ConfirmDeleteDialog.test.tsx`.

---

## Task 1: Scaffold the Tauri + React-TS app

**Files:**
- Create: whole `src-tauri/` and `src/` Tauri skeleton at project root.

- [ ] **Step 1: Scaffold into a temp dir (avoids clobbering existing `docs/`, `temporary/`)**

Run:
```bash
cd /tmp && rm -rf qnap-scaffold && npm create tauri-app@latest qnap-scaffold -- --template react-ts --manager npm --yes
```
Expected: a `/tmp/qnap-scaffold` containing `src/`, `src-tauri/`, `package.json`, `vite.config.ts`, etc.

- [ ] **Step 2: Copy the scaffold into the project root (excluding its git + lockfile noise)**

Run:
```bash
cd /Users/mackhankins/projects/qnapmanager
rsync -a --exclude='.git' --exclude='node_modules' /tmp/qnap-scaffold/ ./
npm install
npm install @tanstack/react-table @tauri-apps/api
npm install -D vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom
```
Expected: `package.json`, `src/`, `src-tauri/` now at project root; deps installed.

- [ ] **Step 3: Set the app identifier and window title**

Edit `src-tauri/tauri.conf.json`: set `"identifier": "com.qnapmanager.app"`, `"productName": "QNAP Manager"`, and the main window `"title": "QNAP Manager"`, `"width": 1100`, `"height": 720`.

- [ ] **Step 4: Add Rust dependencies**

Edit `src-tauri/Cargo.toml` `[dependencies]` to add:
```toml
reqwest = { version = "0.12", default-features = false, features = ["json", "rustls-tls"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
thiserror = "1"
keyring = "3"
chrono = { version = "0.4", features = ["serde"] }
```
And add:
```toml
[dev-dependencies]
wiremock = "0.6"
tokio = { version = "1", features = ["full", "test-util"] }
```

- [ ] **Step 5: Configure Vitest**

Edit `vite.config.ts` to add a `test` block:
```ts
/// <reference types="vitest" />
// inside defineConfig({ ... })
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
  },
```
Create `src/test-setup.ts`:
```ts
import "@testing-library/jest-dom";
```
Add to `package.json` scripts: `"test": "vitest run"`, `"test:watch": "vitest"`.

- [ ] **Step 6: Verify it builds and runs the empty test suites**

Run:
```bash
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```
Expected: frontend builds; cargo compiles (0 tests). If `cargo` errors on missing system webkit libs, that's environment setup — note it and proceed; logic tasks below don't need the GUI to compile-test.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold Tauri + React-TS app with deps and vitest"
```

---

## Task 2: Error type (`error.rs`)

**Files:**
- Create: `src-tauri/src/error.rs`
- Modify: `src-tauri/src/main.rs` (add `mod error;`)

- [ ] **Step 1: Write the failing test**

Create `src-tauri/src/error.rs`:
```rust
use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("network error reaching {url}")]
    Network { url: String },
    #[error("authentication rejected by {service}")]
    Auth { service: String },
    #[error("not found")]
    NotFound,
    #[error("{service} API error {status}: {msg}")]
    Api { service: String, status: u16, msg: String },
    #[error("config error: {0}")]
    Config(String),
}

pub type AppResult<T> = Result<T, AppError>;

/// Wire shape sent to the frontend: a stable `kind` + human `message`.
#[derive(Serialize)]
pub struct WireError {
    pub kind: String,
    pub message: String,
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let kind = match self {
            AppError::Network { .. } => "network",
            AppError::Auth { .. } => "auth",
            AppError::NotFound => "not_found",
            AppError::Api { .. } => "api",
            AppError::Config(_) => "config",
        };
        WireError { kind: kind.into(), message: self.to_string() }.serialize(s)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_with_kind_and_message() {
        let e = AppError::Auth { service: "Sonarr".into() };
        let v = serde_json::to_value(&e).unwrap();
        assert_eq!(v["kind"], "auth");
        assert_eq!(v["message"], "authentication rejected by Sonarr");
    }
}
```

- [ ] **Step 2: Register the module**

Edit `src-tauri/src/main.rs`: add `mod error;` near the top (below the existing `#![cfg_attr(...)]` line).

- [ ] **Step 3: Run the test (expect pass)**

Run: `cargo test --manifest-path src-tauri/Cargo.toml error::`
Expected: PASS (`serializes_with_kind_and_message`).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/error.rs src-tauri/src/main.rs
git commit -m "feat: typed AppError with frontend wire serialization"
```

---

## Task 3: Models + normalization (`models.rs`)

**Files:**
- Create: `src-tauri/src/models.rs`
- Modify: `src-tauri/src/main.rs` (add `mod models;`)

- [ ] **Step 1: Write the failing tests with real fixture shapes**

Create `src-tauri/src/models.rs`:
```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Service {
    Sonarr,
    Radarr,
}

/// Normalized item the frontend consumes. `added` is the raw ISO string from the
/// *arr API; age is computed in the UI, not here.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LibraryItem {
    pub id: i64,
    pub title: String,
    pub service: Service,
    pub size_on_disk: i64,
    pub added: Option<String>,
    pub tags: Vec<i64>,
    pub tag_labels: Vec<String>,
}

/// Raw Sonarr series / Radarr movie share the fields we need.
#[derive(Debug, Deserialize)]
pub struct RawItem {
    pub id: i64,
    pub title: String,
    #[serde(default, rename = "sizeOnDisk")]
    pub size_on_disk: i64,
    #[serde(default)]
    pub added: Option<String>,
    #[serde(default)]
    pub tags: Vec<i64>,
}

#[derive(Debug, Deserialize)]
pub struct RawTag {
    pub id: i64,
    pub label: String,
}

pub const TEMPORARY_LABEL: &str = "temporary";

/// Resolve tag ids to labels using the service's tag list.
pub fn normalize(raw: RawItem, service: Service, tags: &[RawTag]) -> LibraryItem {
    let tag_labels = raw
        .tags
        .iter()
        .filter_map(|id| tags.iter().find(|t| t.id == *id).map(|t| t.label.clone()))
        .collect();
    LibraryItem {
        id: raw.id,
        title: raw.title,
        service,
        size_on_disk: raw.size_on_disk,
        added: raw.added,
        tags: raw.tags,
        tag_labels,
    }
}

/// True if any of the item's tag labels equals "temporary" (case-insensitive).
pub fn has_temporary(item: &LibraryItem) -> bool {
    item.tag_labels.iter().any(|l| l.eq_ignore_ascii_case(TEMPORARY_LABEL))
}

/// Compute the new tag-id set when toggling a tag on/off. Pure.
pub fn toggle_tag(current: &[i64], tag_id: i64) -> Vec<i64> {
    if current.contains(&tag_id) {
        current.iter().copied().filter(|id| *id != tag_id).collect()
    } else {
        let mut v = current.to_vec();
        v.push(tag_id);
        v
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tags() -> Vec<RawTag> {
        vec![
            RawTag { id: 1, label: "temporary".into() },
            RawTag { id: 2, label: "kids".into() },
        ]
    }

    #[test]
    fn normalize_resolves_labels_and_preserves_added() {
        let raw: RawItem = serde_json::from_str(
            r#"{"id":7,"title":"The Big Show","sizeOnDisk":88130000000,
                "added":"2025-01-02T00:00:00Z","tags":[1]}"#,
        )
        .unwrap();
        let item = normalize(raw, Service::Sonarr, &tags());
        assert_eq!(item.id, 7);
        assert_eq!(item.size_on_disk, 88130000000);
        assert_eq!(item.added.as_deref(), Some("2025-01-02T00:00:00Z"));
        assert_eq!(item.tag_labels, vec!["temporary".to_string()]);
        assert!(has_temporary(&item));
    }

    #[test]
    fn missing_size_defaults_to_zero() {
        let raw: RawItem = serde_json::from_str(r#"{"id":1,"title":"X","tags":[]}"#).unwrap();
        let item = normalize(raw, Service::Radarr, &tags());
        assert_eq!(item.size_on_disk, 0);
        assert!(!has_temporary(&item));
    }

    #[test]
    fn has_temporary_is_case_insensitive() {
        let item = LibraryItem {
            id: 1, title: "X".into(), service: Service::Radarr, size_on_disk: 0,
            added: None, tags: vec![9], tag_labels: vec!["Temporary".into()],
        };
        assert!(has_temporary(&item));
    }

    #[test]
    fn toggle_tag_adds_then_removes() {
        let on = toggle_tag(&[2], 1);
        assert_eq!(on, vec![2, 1]);
        let off = toggle_tag(&on, 1);
        assert_eq!(off, vec![2]);
    }
}
```

- [ ] **Step 2: Register the module**

Edit `src-tauri/src/main.rs`: add `mod models;`.

- [ ] **Step 3: Run the tests (expect pass)**

Run: `cargo test --manifest-path src-tauri/Cargo.toml models::`
Expected: PASS — 4 tests.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/models.rs src-tauri/src/main.rs
git commit -m "feat: LibraryItem normalization, temporary detection, tag toggle"
```

---

## Task 4: Config + keychain (`config.rs`)

**Files:**
- Create: `src-tauri/src/config.rs`
- Modify: `src-tauri/src/main.rs` (add `mod config;`)

- [ ] **Step 1: Write the failing tests**

Create `src-tauri/src/config.rs`:
```rust
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
    /// Defaults pre-filled from the user's known setup (editable in Settings).
    pub fn with_known_defaults() -> Self {
        AppConfig {
            sonarr: Some(ServiceConfig { url: "http://192.168.40.103:8989".into() }),
            radarr: Some(ServiceConfig { url: "http://192.168.40.103:7878".into() }),
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
```

- [ ] **Step 2: Register the module**

Edit `src-tauri/src/main.rs`: add `mod config;`.

- [ ] **Step 3: Run the tests (expect pass)**

Run: `cargo test --manifest-path src-tauri/Cargo.toml config::`
Expected: PASS — 2 tests. (Keychain functions are exercised by the app at runtime, not unit-tested here, since CI keychains are unreliable.)

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/config.rs src-tauri/src/main.rs
git commit -m "feat: app config load/save with keychain-backed API keys"
```

---

## Task 5: MediaServer trait + ArrClient (`client.rs`)

**Files:**
- Create: `src-tauri/src/client.rs`
- Create: `src-tauri/tests/client.rs` (wiremock integration tests)
- Modify: `src-tauri/src/main.rs` (add `mod client;`)

- [ ] **Step 1: Write the client with the trait and HTTP methods**

Create `src-tauri/src/client.rs`:
```rust
use crate::error::{AppError, AppResult};
use crate::models::{normalize, LibraryItem, RawItem, RawTag, Service, TEMPORARY_LABEL};
use serde_json::json;

/// Abstraction boundary the command layer speaks to. One generic impl covers
/// Sonarr and Radarr; a future Plex client would be a separate impl.
#[allow(async_fn_in_trait)]
pub trait MediaServer {
    async fn test_connection(&self) -> AppResult<()>;
    async fn list(&self) -> AppResult<Vec<LibraryItem>>;
    async fn ensure_temporary_tag(&self) -> AppResult<i64>;
    async fn set_item_tags(&self, item_id: i64, tags: &[i64]) -> AppResult<()>;
    async fn delete_with_files(&self, item_id: i64) -> AppResult<()>;
}

pub struct ArrClient {
    service: Service,
    base_url: String,
    api_key: String,
    http: reqwest::Client,
}

impl ArrClient {
    pub fn new(service: Service, base_url: &str, api_key: &str) -> Self {
        ArrClient {
            service,
            base_url: base_url.trim_end_matches('/').to_string(),
            api_key: api_key.to_string(),
            http: reqwest::Client::new(),
        }
    }

    fn service_name(&self) -> String {
        match self.service {
            Service::Sonarr => "Sonarr".into(),
            Service::Radarr => "Radarr".into(),
        }
    }

    /// Endpoint path for the library collection.
    fn collection(&self) -> &'static str {
        match self.service {
            Service::Sonarr => "series",
            Service::Radarr => "movie",
        }
    }

    fn url(&self, path: &str) -> String {
        format!("{}/api/v3/{}", self.base_url, path)
    }

    async fn send(&self, req: reqwest::RequestBuilder) -> AppResult<reqwest::Response> {
        let resp = req
            .header("X-Api-Key", &self.api_key)
            .send()
            .await
            .map_err(|_| AppError::Network { url: self.base_url.clone() })?;
        match resp.status().as_u16() {
            200..=299 => Ok(resp),
            401 | 403 => Err(AppError::Auth { service: self.service_name() }),
            404 => Err(AppError::NotFound),
            s => Err(AppError::Api {
                service: self.service_name(),
                status: s,
                msg: resp.text().await.unwrap_or_default(),
            }),
        }
    }

    async fn list_tags(&self) -> AppResult<Vec<RawTag>> {
        let resp = self.send(self.http.get(self.url("tag"))).await?;
        resp.json().await.map_err(|_| AppError::Api {
            service: self.service_name(),
            status: 200,
            msg: "invalid tag JSON".into(),
        })
    }
}

impl MediaServer for ArrClient {
    async fn test_connection(&self) -> AppResult<()> {
        self.send(self.http.get(self.url("system/status"))).await?;
        Ok(())
    }

    async fn list(&self) -> AppResult<Vec<LibraryItem>> {
        let tags = self.list_tags().await?;
        let resp = self.send(self.http.get(self.url(self.collection()))).await?;
        let raw: Vec<RawItem> = resp.json().await.map_err(|_| AppError::Api {
            service: self.service_name(),
            status: 200,
            msg: "invalid library JSON".into(),
        })?;
        Ok(raw.into_iter().map(|r| normalize(r, self.service, &tags)).collect())
    }

    async fn ensure_temporary_tag(&self) -> AppResult<i64> {
        let tags = self.list_tags().await?;
        if let Some(t) = tags.iter().find(|t| t.label.eq_ignore_ascii_case(TEMPORARY_LABEL)) {
            return Ok(t.id);
        }
        let resp = self
            .send(self.http.post(self.url("tag")).json(&json!({ "label": TEMPORARY_LABEL })))
            .await?;
        let created: RawTag = resp.json().await.map_err(|_| AppError::Api {
            service: self.service_name(),
            status: 200,
            msg: "invalid created-tag JSON".into(),
        })?;
        Ok(created.id)
    }

    async fn set_item_tags(&self, item_id: i64, tags: &[i64]) -> AppResult<()> {
        // Fetch the full item, replace tags, PUT it back (the *arr APIs expect the whole body).
        let mut body: serde_json::Value = {
            let path = format!("{}/{}", self.collection(), item_id);
            let resp = self.send(self.http.get(self.url(&path))).await?;
            resp.json().await.map_err(|_| AppError::NotFound)?
        };
        body["tags"] = json!(tags);
        let path = format!("{}/{}", self.collection(), item_id);
        self.send(self.http.put(self.url(&path)).json(&body)).await?;
        Ok(())
    }

    async fn delete_with_files(&self, item_id: i64) -> AppResult<()> {
        let path = format!("{}/{}", self.collection(), item_id);
        let req = self
            .http
            .delete(self.url(&path))
            .query(&[("deleteFiles", "true"), ("addImportExclusion", "false")]);
        self.send(req).await?;
        Ok(())
    }
}
```

- [ ] **Step 2: Register the module**

Edit `src-tauri/src/main.rs`: add `mod client;`.

- [ ] **Step 3: Write wiremock integration tests**

Create `src-tauri/tests/client.rs`:
```rust
use qnap_manager_lib::client::{ArrClient, MediaServer};
use qnap_manager_lib::models::Service;
use wiremock::matchers::{method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};
use serde_json::json;

// NOTE: requires main.rs to also expose a lib target named `qnap_manager_lib`
// (see Task 5 Step 5). If the scaffold only built a binary, that step adds the lib.

#[tokio::test]
async fn list_normalizes_radarr_movies() {
    let server = MockServer::start().await;
    Mock::given(method("GET")).and(path("/api/v3/tag"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([
            {"id": 1, "label": "temporary"}
        ])))
        .mount(&server).await;
    Mock::given(method("GET")).and(path("/api/v3/movie"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([
            {"id": 10, "title": "Doc", "sizeOnDisk": 9700000000,
             "added": "2025-03-01T00:00:00Z", "tags": [1]}
        ])))
        .mount(&server).await;

    let c = ArrClient::new(Service::Radarr, &server.uri(), "k");
    let items = c.list().await.unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].title, "Doc");
    assert_eq!(items[0].tag_labels, vec!["temporary".to_string()]);
}

#[tokio::test]
async fn auth_failure_maps_to_auth_error() {
    let server = MockServer::start().await;
    Mock::given(method("GET")).and(path("/api/v3/tag"))
        .respond_with(ResponseTemplate::new(401))
        .mount(&server).await;
    let c = ArrClient::new(Service::Sonarr, &server.uri(), "bad");
    let err = c.list().await.unwrap_err();
    let v = serde_json::to_value(&err).unwrap();
    assert_eq!(v["kind"], "auth");
}

#[tokio::test]
async fn delete_sends_delete_files_true() {
    let server = MockServer::start().await;
    Mock::given(method("DELETE"))
        .and(path("/api/v3/movie/10"))
        .and(query_param("deleteFiles", "true"))
        .respond_with(ResponseTemplate::new(200))
        .mount(&server).await;
    let c = ArrClient::new(Service::Radarr, &server.uri(), "k");
    c.delete_with_files(10).await.unwrap();
}

#[tokio::test]
async fn ensure_temporary_tag_creates_when_absent() {
    let server = MockServer::start().await;
    Mock::given(method("GET")).and(path("/api/v3/tag"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([])))
        .mount(&server).await;
    Mock::given(method("POST")).and(path("/api/v3/tag"))
        .respond_with(ResponseTemplate::new(201).set_body_json(json!({"id": 5, "label": "temporary"})))
        .mount(&server).await;
    let c = ArrClient::new(Service::Sonarr, &server.uri(), "k");
    assert_eq!(c.ensure_temporary_tag().await.unwrap(), 5);
}
```

- [ ] **Step 4: Expose a lib target so tests can import the modules**

Tauri's scaffold builds a binary. Add a library target. Edit `src-tauri/Cargo.toml` to add:
```toml
[lib]
name = "qnap_manager_lib"
path = "src/lib.rs"
```
Create `src-tauri/src/lib.rs`:
```rust
pub mod client;
pub mod config;
pub mod error;
pub mod models;
```
And in `src-tauri/src/main.rs`, replace the individual `mod error; mod models; ...` lines with:
```rust
use qnap_manager_lib::{client, config, error, models};
```
(Keep any existing `fn main()` / Tauri builder code below it.)

- [ ] **Step 5: Run the integration tests (expect pass)**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test client`
Expected: PASS — 4 tests.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/client.rs src-tauri/src/lib.rs src-tauri/src/main.rs src-tauri/Cargo.toml src-tauri/tests/client.rs
git commit -m "feat: ArrClient implementing MediaServer for Sonarr/Radarr (wiremock-tested)"
```

---

## Task 6: Tauri commands (`commands.rs`)

**Files:**
- Create: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs` (add `pub mod commands;`)
- Modify: `src-tauri/src/main.rs` (register commands + manage config dir)

- [ ] **Step 1: Write the command layer**

Create `src-tauri/src/commands.rs`:
```rust
use crate::client::{ArrClient, MediaServer};
use crate::config::{self, AppConfig, ServiceConfig};
use crate::error::{AppError, AppResult};
use crate::models::{has_temporary, toggle_tag, LibraryItem, Service};
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
    let _ = has_temporary(&item); // intent documented; toggle works on ids
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
```

- [ ] **Step 2: Register module + commands**

Edit `src-tauri/src/lib.rs`: add `pub mod commands;`.

In `src-tauri/src/main.rs`, register the handler inside the Tauri builder:
```rust
use qnap_manager_lib::commands;

// inside fn main(), in the builder chain:
    .invoke_handler(tauri::generate_handler![
        commands::get_config,
        commands::save_config,
        commands::test_connection,
        commands::list_library,
        commands::toggle_temporary_tag,
        commands::delete_item,
        commands::bulk_delete,
    ])
```

- [ ] **Step 3: Verify it compiles**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: compiles clean (warnings OK). The command bodies are thin orchestration over already-tested units, so no new unit tests here.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs src-tauri/src/main.rs
git commit -m "feat: Tauri commands for config, library, tag toggle, delete, bulk delete"
```

---

## Task 7: Frontend API layer + formatters

**Files:**
- Create: `src/api.ts`
- Create: `src/lib/format.ts`
- Create: `src/lib/format.test.ts`

- [ ] **Step 1: Write the failing formatter tests**

Create `src/lib/format.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { formatBytes, ageDays, formatAge } from "./format";

describe("formatBytes", () => {
  it("formats GB", () => expect(formatBytes(88_130_000_000)).toBe("82.1 GB"));
  it("formats MB", () => expect(formatBytes(9_700_000)).toBe("9.3 MB"));
  it("handles zero", () => expect(formatBytes(0)).toBe("0 B"));
});

describe("age", () => {
  it("computes whole days", () => {
    const now = new Date("2025-03-01T00:00:00Z").getTime();
    expect(ageDays("2025-02-01T00:00:00Z", now)).toBe(28);
  });
  it("formats null added as dash", () => expect(formatAge(null, Date.now())).toBe("—"));
  it("formats day count", () => {
    const now = new Date("2025-03-01T00:00:00Z").getTime();
    expect(formatAge("2025-02-01T00:00:00Z", now)).toBe("28d");
  });
});
```

- [ ] **Step 2: Run it (expect fail)**

Run: `npm test -- format`
Expected: FAIL — cannot find `./format`.

- [ ] **Step 3: Implement the formatters**

Create `src/lib/format.ts`:
```ts
const UNITS = ["B", "KB", "MB", "GB", "TB"];

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const i = Math.min(UNITS.length - 1, Math.floor(Math.log10(bytes) / 3));
  const value = bytes / Math.pow(1000, i);
  const rounded = i === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${UNITS[i]}`;
}

export function ageDays(added: string | null, now: number): number | null {
  if (!added) return null;
  const ms = now - new Date(added).getTime();
  return Math.floor(ms / 86_400_000);
}

export function formatAge(added: string | null, now: number): string {
  const d = ageDays(added, now);
  return d == null ? "—" : `${d}d`;
}
```

- [ ] **Step 4: Run it (expect pass)**

Run: `npm test -- format`
Expected: PASS — 6 assertions.

- [ ] **Step 5: Write the typed API wrapper**

Create `src/api.ts`:
```ts
import { invoke } from "@tauri-apps/api/core";

export type Service = "sonarr" | "radarr";

export interface LibraryItem {
  id: number;
  title: string;
  service: Service;
  size_on_disk: number;
  added: string | null;
  tags: number[];
  tag_labels: string[];
}

export interface ServiceConfig { url: string }
export interface AppConfig { sonarr: ServiceConfig | null; radarr: ServiceConfig | null }
export interface ServiceError { service: string; message: string }
export interface LoadResult { items: LibraryItem[]; errors: ServiceError[] }
export interface BulkResult {
  deleted: number[];
  failed: { id: number; title: string; message: string }[];
}

export const api = {
  getConfig: () => invoke<AppConfig>("get_config"),
  saveConfig: (config_in: AppConfig, sonarr_key?: string, radarr_key?: string) =>
    invoke<void>("save_config", { configIn: config_in, sonarrKey: sonarr_key, radarrKey: radarr_key }),
  testConnection: (url: string, api_key: string, service: Service) =>
    invoke<void>("test_connection", { url, apiKey: api_key, service }),
  listLibrary: () => invoke<LoadResult>("list_library"),
  toggleTemporaryTag: (item: LibraryItem) => invoke<void>("toggle_temporary_tag", { item }),
  deleteItem: (item: LibraryItem) => invoke<void>("delete_item", { item }),
  bulkDelete: (items: LibraryItem[]) => invoke<BulkResult>("bulk_delete", { items }),
};

export const isTemporary = (item: LibraryItem): boolean =>
  item.tag_labels.some((l) => l.toLowerCase() === "temporary");
```

- [ ] **Step 6: Commit**

```bash
git add src/api.ts src/lib/format.ts src/lib/format.test.ts
git commit -m "feat: frontend API wrapper + tested byte/age formatters"
```

---

## Task 8: LibraryTable component

**Files:**
- Create: `src/components/LibraryTable.tsx`
- Create: `src/components/LibraryTable.test.tsx`

- [ ] **Step 1: Write the failing component test**

Create `src/components/LibraryTable.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LibraryTable } from "./LibraryTable";
import type { LibraryItem } from "../api";

const items: LibraryItem[] = [
  { id: 1, title: "Big Show", service: "sonarr", size_on_disk: 88_130_000_000, added: null, tags: [1], tag_labels: ["temporary"] },
  { id: 2, title: "Movie", service: "radarr", size_on_disk: 38_400_000_000, added: null, tags: [], tag_labels: [] },
];

describe("LibraryTable", () => {
  it("renders rows for all items by default", () => {
    render(<LibraryTable items={items} onDelete={() => {}} onToggleTag={() => {}} onBulkDelete={() => {}} />);
    expect(screen.getByText("Big Show")).toBeInTheDocument();
    expect(screen.getByText("Movie")).toBeInTheDocument();
  });

  it("filters to temporary when the chip is clicked", async () => {
    render(<LibraryTable items={items} onDelete={() => {}} onToggleTag={() => {}} onBulkDelete={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /temporary/i }));
    expect(screen.getByText("Big Show")).toBeInTheDocument();
    expect(screen.queryByText("Movie")).not.toBeInTheDocument();
  });

  it("filters by Movies type chip", async () => {
    render(<LibraryTable items={items} onDelete={() => {}} onToggleTag={() => {}} onBulkDelete={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /^movies$/i }));
    expect(screen.getByText("Movie")).toBeInTheDocument();
    expect(screen.queryByText("Big Show")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it (expect fail)**

Run: `npm test -- LibraryTable`
Expected: FAIL — cannot find `./LibraryTable`.

- [ ] **Step 3: Implement the table**

Create `src/components/LibraryTable.tsx`:
```tsx
import { useMemo, useState } from "react";
import {
  useReactTable, getCoreRowModel, getSortedRowModel, flexRender,
  type ColumnDef, type SortingState, type RowSelectionState,
} from "@tanstack/react-table";
import type { LibraryItem } from "../api";
import { isTemporary } from "../api";
import { formatBytes, formatAge } from "../lib/format";

type Filter = "all" | "sonarr" | "radarr" | "temporary";

interface Props {
  items: LibraryItem[];
  onDelete: (item: LibraryItem) => void;
  onToggleTag: (item: LibraryItem) => void;
  onBulkDelete: (items: LibraryItem[]) => void;
}

export function LibraryTable({ items, onDelete, onToggleTag, onBulkDelete }: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [sorting, setSorting] = useState<SortingState>([{ id: "size_on_disk", desc: true }]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const now = Date.now();

  const filtered = useMemo(() => {
    return items.filter((it) => {
      if (filter === "sonarr" && it.service !== "sonarr") return false;
      if (filter === "radarr" && it.service !== "radarr") return false;
      if (filter === "temporary" && !isTemporary(it)) return false;
      if (search && !it.title.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [items, filter, search]);

  const columns = useMemo<ColumnDef<LibraryItem>[]>(() => [
    {
      id: "select",
      header: ({ table }) => (
        <input type="checkbox" aria-label="Select all"
          checked={table.getIsAllRowsSelected()}
          onChange={table.getToggleAllRowsSelectedHandler()} />
      ),
      cell: ({ row }) => (
        <input type="checkbox" aria-label={`Select ${row.original.title}`}
          checked={row.getIsSelected()} onChange={row.getToggleSelectedHandler()} />
      ),
    },
    { accessorKey: "title", header: "Title" },
    { accessorKey: "service", header: "Type",
      cell: (c) => (c.getValue() === "sonarr" ? "TV" : "Movie") },
    { id: "tags", header: "Tags",
      cell: ({ row }) => row.original.tag_labels.join(", ") || "—" },
    { accessorKey: "added", header: "Date Added",
      cell: (c) => (c.getValue() ? String(c.getValue()).slice(0, 10) : "—") },
    { id: "age", header: "Age", accessorFn: (r) => r.added,
      cell: ({ row }) => formatAge(row.original.added, now),
      sortingFn: (a, b) => {
        const av = a.original.added ? new Date(a.original.added).getTime() : Infinity;
        const bv = b.original.added ? new Date(b.original.added).getTime() : Infinity;
        return av - bv;
      } },
    { accessorKey: "size_on_disk", header: "Size",
      cell: (c) => formatBytes(c.getValue() as number) },
  ], [now]);

  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting, rowSelection },
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    getRowId: (row) => String(row.id),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const selected = table.getSelectedRowModel().rows.map((r) => r.original);
  const selectedSize = selected.reduce((sum, it) => sum + it.size_on_disk, 0);

  const chips: Filter[] = ["all", "sonarr", "radarr", "temporary"];
  const chipLabel: Record<Filter, string> = {
    all: "All", sonarr: "TV", radarr: "Movies", temporary: "temporary",
  };

  return (
    <div className="library">
      <div className="toolbar">
        <input className="search" placeholder="Search title…"
          value={search} onChange={(e) => setSearch(e.target.value)} />
        {chips.map((c) => (
          <button key={c} className={`chip ${filter === c ? "active" : ""}`}
            onClick={() => setFilter(c)}>{chipLabel[c]}</button>
        ))}
      </div>

      {selected.length > 0 && (
        <div className="selection-bar">
          <span>{selected.length} selected · {formatBytes(selectedSize)}</span>
          <button onClick={() => onBulkDelete(selected)}>Delete selected</button>
        </div>
      )}

      <table>
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => (
                <th key={h.id} onClick={h.column.getToggleSortingHandler()}>
                  {flexRender(h.column.columnDef.header, h.getContext())}
                  {{ asc: " ▲", desc: " ▼" }[h.column.getIsSorted() as string] ?? ""}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className={row.getIsSelected() ? "selected" : ""}>
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
              ))}
              <td className="row-actions">
                <button onClick={() => onToggleTag(row.original)}>
                  {isTemporary(row.original) ? "Untag" : "Tag temp"}
                </button>
                <button onClick={() => onDelete(row.original)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Run it (expect pass)**

Run: `npm test -- LibraryTable`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/LibraryTable.tsx src/components/LibraryTable.test.tsx
git commit -m "feat: unified library table with filter chips, sort, selection"
```

---

## Task 9: Confirm-delete dialog

**Files:**
- Create: `src/components/ConfirmDeleteDialog.tsx`
- Create: `src/components/ConfirmDeleteDialog.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/ConfirmDeleteDialog.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmDeleteDialog } from "./ConfirmDeleteDialog";
import type { LibraryItem } from "../api";

const items: LibraryItem[] = [
  { id: 1, title: "Big Show", service: "sonarr", size_on_disk: 88_130_000_000, added: null, tags: [], tag_labels: [] },
  { id: 2, title: "Doc", service: "radarr", size_on_disk: 9_700_000_000, added: null, tags: [], tag_labels: [] },
];

describe("ConfirmDeleteDialog", () => {
  it("lists every item and the total reclaimed size", () => {
    render(<ConfirmDeleteDialog items={items} onCancel={() => {}} onConfirm={() => {}} />);
    expect(screen.getByText("Big Show")).toBeInTheDocument();
    expect(screen.getByText("Doc")).toBeInTheDocument();
    expect(screen.getByText(/97\.8 GB/)).toBeInTheDocument(); // 88.1 + 9.7
  });

  it("fires onConfirm when confirmed", async () => {
    const onConfirm = vi.fn();
    render(<ConfirmDeleteDialog items={items} onCancel={() => {}} onConfirm={onConfirm} />);
    await userEvent.click(screen.getByRole("button", { name: /delete 2 items/i }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run it (expect fail)**

Run: `npm test -- ConfirmDeleteDialog`
Expected: FAIL — cannot find `./ConfirmDeleteDialog`.

- [ ] **Step 3: Implement the dialog**

Create `src/components/ConfirmDeleteDialog.tsx`:
```tsx
import type { LibraryItem } from "../api";
import { formatBytes } from "../lib/format";

interface Props {
  items: LibraryItem[];
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDeleteDialog({ items, onCancel, onConfirm }: Props) {
  const total = items.reduce((sum, it) => sum + it.size_on_disk, 0);
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <h2>Delete {items.length} item{items.length === 1 ? "" : "s"}?</h2>
        <p>This permanently deletes the files and the library entries. This cannot be undone.</p>
        <ul className="delete-list">
          {items.map((it) => (
            <li key={`${it.service}-${it.id}`}>
              <span>{it.title}</span>
              <span className="muted">{it.service === "sonarr" ? "TV" : "Movie"} · {formatBytes(it.size_on_disk)}</span>
            </li>
          ))}
        </ul>
        <p className="total">Reclaims <strong>{formatBytes(total)}</strong></p>
        <div className="modal-actions">
          <button onClick={onCancel}>Cancel</button>
          <button className="danger" onClick={onConfirm}>
            Delete {items.length} item{items.length === 1 ? "" : "s"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run it (expect pass)**

Run: `npm test -- ConfirmDeleteDialog`
Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/ConfirmDeleteDialog.tsx src/components/ConfirmDeleteDialog.test.tsx
git commit -m "feat: itemized confirm-delete dialog with total reclaimed size"
```

---

## Task 10: Settings screen

**Files:**
- Create: `src/components/Settings.tsx`

- [ ] **Step 1: Implement the settings form**

Create `src/components/Settings.tsx`:
```tsx
import { useState } from "react";
import { api, type AppConfig, type Service } from "../api";

interface Props {
  config: AppConfig;
  onSaved: () => void;
}

type TestState = "" | "ok" | "fail";

export function Settings({ config, onSaved }: Props) {
  const [sonarrUrl, setSonarrUrl] = useState(config.sonarr?.url ?? "");
  const [radarrUrl, setRadarrUrl] = useState(config.radarr?.url ?? "");
  const [sonarrKey, setSonarrKey] = useState("");
  const [radarrKey, setRadarrKey] = useState("");
  const [test, setTest] = useState<Record<Service, TestState>>({ sonarr: "", radarr: "" });
  const [saving, setSaving] = useState(false);

  async function testOne(service: Service, url: string, key: string) {
    try {
      await api.testConnection(url, key, service);
      setTest((t) => ({ ...t, [service]: "ok" }));
    } catch {
      setTest((t) => ({ ...t, [service]: "fail" }));
    }
  }

  async function save() {
    setSaving(true);
    try {
      await api.saveConfig(
        { sonarr: sonarrUrl ? { url: sonarrUrl } : null, radarr: radarrUrl ? { url: radarrUrl } : null },
        sonarrKey || undefined,
        radarrKey || undefined,
      );
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  const badge = (s: TestState) => (s === "ok" ? "✓ connected" : s === "fail" ? "✗ failed" : "");

  return (
    <div className="settings">
      <h2>Settings</h2>
      <fieldset>
        <legend>Sonarr (TV)</legend>
        <input placeholder="http://host:8989" value={sonarrUrl} onChange={(e) => setSonarrUrl(e.target.value)} />
        <input placeholder="API key" type="password" value={sonarrKey} onChange={(e) => setSonarrKey(e.target.value)} />
        <button onClick={() => testOne("sonarr", sonarrUrl, sonarrKey)}>Test connection</button>
        <span className={`badge ${test.sonarr}`}>{badge(test.sonarr)}</span>
      </fieldset>
      <fieldset>
        <legend>Radarr (Movies)</legend>
        <input placeholder="http://host:7878" value={radarrUrl} onChange={(e) => setRadarrUrl(e.target.value)} />
        <input placeholder="API key" type="password" value={radarrKey} onChange={(e) => setRadarrKey(e.target.value)} />
        <button onClick={() => testOne("radarr", radarrUrl, radarrKey)}>Test connection</button>
        <span className={`badge ${test.radarr}`}>{badge(test.radarr)}</span>
      </fieldset>
      <p className="hint">Leave an API key blank to keep the existing stored key.</p>
      <button className="primary" disabled={saving} onClick={save}>Save</button>
    </div>
  );
}
```

- [ ] **Step 2: Verify it type-checks/builds**

Run: `npm run build`
Expected: builds clean. (Settings is thin glue over the tested `api`; no dedicated test.)

- [ ] **Step 3: Commit**

```bash
git add src/components/Settings.tsx
git commit -m "feat: settings screen with per-service test connection"
```

---

## Task 11: App shell — wire everything together

**Files:**
- Modify: `src/App.tsx` (replace scaffold content)
- Create/replace: `src/App.css` (minimal styles for table, chips, modal, badges)

- [ ] **Step 1: Implement the shell**

Replace `src/App.tsx` with:
```tsx
import { useCallback, useEffect, useState } from "react";
import { api, type AppConfig, type LibraryItem, type ServiceError } from "./api";
import { LibraryTable } from "./components/LibraryTable";
import { ConfirmDeleteDialog } from "./components/ConfirmDeleteDialog";
import { Settings } from "./components/Settings";
import "./App.css";

type View = "library" | "settings";

export default function App() {
  const [view, setView] = useState<View>("library");
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [errors, setErrors] = useState<ServiceError[]>([]);
  const [loading, setLoading] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<LibraryItem[] | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listLibrary();
      setItems(res.items);
      setErrors(res.errors);
    } catch (e) {
      setErrors([{ service: "App", message: String((e as { message?: string }).message ?? e) }]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    api.getConfig().then(setConfig);
    load();
  }, [load]);

  async function confirmDelete() {
    if (!pendingDelete) return;
    if (pendingDelete.length === 1) {
      await api.deleteItem(pendingDelete[0]);
    } else {
      await api.bulkDelete(pendingDelete);
    }
    setPendingDelete(null);
    await load();
  }

  async function toggleTag(item: LibraryItem) {
    await api.toggleTemporaryTag(item);
    await load();
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>QNAP Manager</h1>
        <nav>
          <button className={view === "library" ? "active" : ""} onClick={() => setView("library")}>Library</button>
          <button className={view === "settings" ? "active" : ""} onClick={() => setView("settings")}>Settings</button>
          <button onClick={load} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button>
        </nav>
      </header>

      {errors.map((e) => (
        <div key={e.service} className="error-banner">{e.service}: {e.message}</div>
      ))}

      {view === "settings" && config && (
        <Settings config={config} onSaved={() => { setView("library"); load(); }} />
      )}

      {view === "library" && (
        <LibraryTable
          items={items}
          onDelete={(item) => setPendingDelete([item])}
          onBulkDelete={(sel) => setPendingDelete(sel)}
          onToggleTag={toggleTag}
        />
      )}

      {pendingDelete && (
        <ConfirmDeleteDialog
          items={pendingDelete}
          onCancel={() => setPendingDelete(null)}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add minimal styles**

Replace `src/App.css`:
```css
:root { font-family: system-ui, sans-serif; }
.app { padding: 16px; }
.app-header { display: flex; justify-content: space-between; align-items: center; }
.app-header nav button { margin-left: 8px; }
.app-header nav button.active { font-weight: 600; }
.toolbar { display: flex; gap: 8px; align-items: center; margin: 12px 0; flex-wrap: wrap; }
.search { flex: 1; min-width: 180px; padding: 6px 10px; }
.chip { padding: 4px 12px; border: 1px solid #999; border-radius: 14px; background: #fff; cursor: pointer; }
.chip.active { border-color: #2563eb; color: #2563eb; }
.selection-bar { display: flex; justify-content: space-between; align-items: center;
  background: #fef2f2; padding: 8px 12px; border-radius: 6px; margin-bottom: 8px; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #eee; }
th { cursor: pointer; user-select: none; }
tr.selected { background: #fff3f3; }
.row-actions { display: flex; gap: 6px; }
.error-banner { background: #fef2f2; color: #b91c1c; padding: 8px 12px; border-radius: 6px; margin: 6px 0; }
.modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.4);
  display: flex; align-items: center; justify-content: center; }
.modal { background: #fff; border-radius: 8px; padding: 20px; max-width: 520px; width: 90%; max-height: 80vh; overflow: auto; }
.delete-list { list-style: none; padding: 0; margin: 12px 0; }
.delete-list li { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid #f0f0f0; }
.muted { color: #888; }
.total { margin-top: 12px; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
button.danger, .selection-bar button { background: #c0392b; color: #fff; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; }
.settings fieldset { margin-bottom: 16px; }
.settings input { display: block; margin: 6px 0; padding: 6px 10px; width: 320px; }
.badge.ok { color: #16a34a; } .badge.fail { color: #c0392b; }
button.primary { background: #2563eb; color: #fff; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; }
```

- [ ] **Step 3: Run the full test suite + build**

Run:
```bash
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```
Expected: all frontend tests pass, frontend builds, all Rust tests pass.

- [ ] **Step 4: Manual smoke test (requires the real NAS or the GUI)**

Run: `npm run tauri dev`
Verify: Settings shows pre-filled URLs → enter keys → Test connection shows ✓ → Save → Library loads combined TV+movies → sort by Size → filter chips work → tag toggle persists → delete one item shows itemized dialog with reclaim size → confirm removes it → bulk-select + delete shows multi-item dialog. Note any failures; do not mark complete on failure.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/App.css
git commit -m "feat: app shell wiring library, settings, delete flow, error banners"
```

---

## Self-Review Notes (resolved)

- **Spec coverage:** browse unified library (Task 8), size/date/age columns (Tasks 7–8), toggle temporary tag (Tasks 5,6,8,11), delete files+entry via *arr API (Tasks 5,6), itemized confirm (Task 9), bulk select+act (Tasks 8,9,11), filter chips All/TV/Movies/temporary (Task 8), settings + test connection (Tasks 6,10), keychain keys (Task 4), per-service error banner (Tasks 6,11), case-insensitive temporary match (Tasks 3,5), defaults pre-filled (Task 4). All covered.
- **Out of scope confirmed absent:** no scheduler, no Plex, no auto-delete, no size-threshold filter (size-sort + range-select instead), no undo.
- **Type consistency:** `LibraryItem` fields identical across Rust (`models.rs`) and TS (`api.ts`); command arg names match the camelCase Tauri auto-conversion used in `api.ts` (`configIn`, `sonarrKey`, `apiKey`). `Service` is lowercase on both sides (`#[serde(rename_all = "lowercase")]`).
