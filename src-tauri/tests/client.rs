use qnap_manager_lib::client::{ArrClient, MediaServer};
use qnap_manager_lib::models::Service;
use wiremock::matchers::{method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};
use serde_json::json;

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
            {"id": 10, "title": "Doc", "sizeOnDisk": 9_700_000_000_i64,
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
