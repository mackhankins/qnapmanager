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
