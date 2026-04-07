//! TLS certificate management endpoints.
//!
//! Certificates are stored on disk in `data/certs/` with metadata in the
//! `certificates` SQLite table. Upload validates PEM format and extracts
//! x509 metadata (fingerprint, expiry).

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use x509_parser::prelude::*;

use crate::db::{self, DbCertificate};
use crate::MgmtState;

// ─────────────────────────── Response types ────────────────────────────

#[derive(Serialize)]
pub struct CertificateInfo {
    pub name: String,
    pub fingerprint: Option<String>,
    pub not_after: Option<String>,
    pub uploaded_at: String,
}

#[derive(Serialize)]
pub struct CertListResponse {
    pub certificates: Vec<CertificateInfo>,
}

#[derive(Serialize)]
pub struct CertUploadResponse {
    pub success: bool,
    pub name: String,
    pub fingerprint: Option<String>,
    pub not_after: Option<String>,
}

// ─────────────────────────── Handlers ──────────────────────────────────

/// GET /api/certificates — list all certificates
pub async fn list(State(state): State<MgmtState>) -> Result<Json<CertListResponse>, StatusCode> {
    let db = state.require_db()?;
    let certs = db::list_certificates(db);

    let certificates = certs
        .into_iter()
        .map(|c| CertificateInfo {
            name: c.name,
            fingerprint: c.fingerprint,
            not_after: c.not_after,
            uploaded_at: c.uploaded_at,
        })
        .collect();

    Ok(Json(CertListResponse { certificates }))
}

/// GET /api/certificates/{name} — get certificate info (NOT the private key)
pub async fn get_info(
    State(state): State<MgmtState>,
    Path(name): Path<String>,
) -> Result<Json<CertificateInfo>, StatusCode> {
    let db = state.require_db()?;
    let cert = db::get_certificate(db, &name).ok_or(StatusCode::NOT_FOUND)?;

    Ok(Json(CertificateInfo {
        name: cert.name,
        fingerprint: cert.fingerprint,
        not_after: cert.not_after,
        uploaded_at: cert.uploaded_at,
    }))
}

#[derive(Deserialize)]
pub struct UploadCertRequest {
    /// Certificate name (e.g., "server", "cdn", "mgmt")
    pub name: String,
    /// PEM-encoded certificate
    pub cert: String,
    /// PEM-encoded private key
    pub key: String,
}

/// POST /api/certificates — upload cert+key (JSON body with PEM strings)
pub async fn upload(
    State(state): State<MgmtState>,
    Json(req): Json<UploadCertRequest>,
) -> Result<Json<CertUploadResponse>, (StatusCode, String)> {
    let db = state
        .require_db()
        .map_err(|s| (s, "DB unavailable".into()))?;

    let cert_data = req.cert.into_bytes();
    let key_data = req.key.into_bytes();
    let name = req.name;

    // Validate cert name (alphanumeric + dash)
    if !name
        .chars()
        .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
    {
        return Err((
            StatusCode::BAD_REQUEST,
            "Certificate name must be alphanumeric (with dashes/underscores)".into(),
        ));
    }

    // Validate PEM format (cert_data/key_data are UTF-8 bytes from JSON strings)
    let cert_str = std::str::from_utf8(&cert_data).map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            "Certificate is not valid UTF-8".into(),
        )
    })?;
    let key_str = std::str::from_utf8(&key_data)
        .map_err(|_| (StatusCode::BAD_REQUEST, "Key is not valid UTF-8".into()))?;

    if !cert_str.contains("BEGIN CERTIFICATE") {
        return Err((
            StatusCode::BAD_REQUEST,
            "Certificate must be in PEM format (BEGIN CERTIFICATE)".into(),
        ));
    }
    if !key_str.contains("BEGIN") || !key_str.contains("KEY") {
        return Err((
            StatusCode::BAD_REQUEST,
            "Key must be in PEM format (BEGIN ... KEY)".into(),
        ));
    }

    // Extract x509 metadata
    let (fingerprint, not_after) = extract_x509_metadata(&cert_data);

    // Determine data dir from config path
    let data_dir = state
        .config_path
        .as_ref()
        .and_then(|p| p.parent())
        .map(|p| p.join("data").join("certs"))
        .ok_or((
            StatusCode::INTERNAL_SERVER_ERROR,
            "Cannot determine data directory".into(),
        ))?;

    // Ensure certs directory exists
    tokio::fs::create_dir_all(&data_dir).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to create certs directory: {e}"),
        )
    })?;

    // Save files
    let cert_path = data_dir.join(format!("{name}-cert.pem"));
    let key_path = data_dir.join(format!("{name}-key.pem"));

    tokio::fs::write(&cert_path, &cert_data)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to write cert file: {e}"),
            )
        })?;
    tokio::fs::write(&key_path, &key_data).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to write key file: {e}"),
        )
    })?;

    // Save metadata to DB
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let cert_path_str = cert_path.to_string_lossy().to_string();
    let key_path_str = key_path.to_string_lossy().to_string();

    db::set_certificate(
        db,
        &DbCertificate {
            name: name.clone(),
            cert_path: cert_path_str,
            key_path: key_path_str,
            uploaded_at: now,
            fingerprint: fingerprint.clone(),
            not_after: not_after.clone(),
        },
    );

    tracing::info!(
        cert_name = %name,
        fingerprint = ?fingerprint,
        not_after = ?not_after,
        "Certificate uploaded"
    );

    Ok(Json(CertUploadResponse {
        success: true,
        name,
        fingerprint,
        not_after,
    }))
}

/// DELETE /api/certificates/{name} — remove certificate
pub async fn remove(
    State(state): State<MgmtState>,
    Path(name): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let db = state.require_db()?;

    // Get cert info to delete files
    if let Some(cert) = db::get_certificate(db, &name) {
        tokio::fs::remove_file(&cert.cert_path).await.ok();
        tokio::fs::remove_file(&cert.key_path).await.ok();
    }

    if db::delete_certificate(db, &name) {
        tracing::info!(cert_name = %name, "Certificate removed");
        Ok(Json(serde_json::json!({ "success": true })))
    } else {
        Err(StatusCode::NOT_FOUND)
    }
}

// ─────────────────────── X509 metadata extraction ─────────────────────

fn extract_x509_metadata(pem_data: &[u8]) -> (Option<String>, Option<String>) {
    let mut fingerprint = None;
    let mut not_after = None;

    // Try to parse PEM and extract DER certificate
    for pem in Pem::iter_from_buffer(pem_data).flatten() {
        if pem.label == "CERTIFICATE" {
            // SHA-256 fingerprint of DER-encoded certificate
            let digest = Sha256::digest(&pem.contents);
            fingerprint = Some(
                digest
                    .iter()
                    .map(|b| format!("{b:02X}"))
                    .collect::<Vec<_>>()
                    .join(":"),
            );

            // Parse x509 for expiry date
            if let Ok((_, cert)) = X509Certificate::from_der(&pem.contents) {
                let validity = cert.validity();
                not_after = validity.not_after.to_rfc2822().ok();
            }

            break; // Only process first certificate in chain
        }
    }

    (fingerprint, not_after)
}
