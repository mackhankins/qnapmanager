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
