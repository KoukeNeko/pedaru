//! Error types for the Pedaru PDF viewer
//!
//! This module defines a structured error hierarchy using thiserror,
//! organized by error category for better error handling and reporting.

use thiserror::Error;

/// Top-level application error type
#[derive(Error, Debug)]
pub enum PedaruError {
    #[error("PDF error: {0}")]
    Pdf(#[from] PdfError),

    #[error("File I/O error: {0}")]
    Io(#[from] IoError),

    #[error("Database error: {0}")]
    Database(#[from] DatabaseError),

    #[error("Menu error: {0}")]
    Menu(#[from] MenuError),

    #[error("Configuration error: {0}")]
    Config(#[from] ConfigError),
}

/// PDF-specific errors (loading, parsing, metadata extraction)
#[derive(Error, Debug)]
pub enum PdfError {
    #[error("Failed to load PDF file '{path}': {source}")]
    LoadFailed {
        path: String,
        #[source]
        source: lopdf::Error,
    },
}

/// File I/O errors
#[derive(Error, Debug)]
pub enum IoError {
    #[error("Failed to read file '{path}': {source}")]
    ReadFailed {
        path: String,
        #[source]
        source: std::io::Error,
    },

    #[error("Failed to create directory '{path}': {source}")]
    CreateDirFailed {
        path: String,
        #[source]
        source: std::io::Error,
    },
}

/// Database errors (SQLite operations)
#[derive(Error, Debug)]
pub enum DatabaseError {
    #[error("Failed to get database path: {0}")]
    PathResolutionFailed(String),

    #[error("Failed to open database: {source}")]
    OpenFailed {
        #[source]
        source: rusqlite::Error,
    },

    #[error("Database not found at expected location")]
    NotFound,
}

/// Menu construction errors
#[derive(Error, Debug)]
pub enum MenuError {
    #[error("Failed to build menu: {0}")]
    BuildFailed(String),

    #[error("Failed to set application menu: {0}")]
    SetMenuFailed(String),
}

/// Configuration/path errors
#[derive(Error, Debug)]
pub enum ConfigError {
    #[error("Failed to resolve app config directory: {0}")]
    ConfigDirResolutionFailed(String),
}

/// Convenience type alias for internal use
pub type Result<T> = std::result::Result<T, PedaruError>;

/// Extension trait for converting errors to Tauri-compatible String format
pub trait IntoTauriError {
    fn into_tauri_error(self) -> String;
}

impl IntoTauriError for PedaruError {
    fn into_tauri_error(self) -> String {
        format!("{:#}", anyhow::Error::from(self))
    }
}

impl IntoTauriError for anyhow::Error {
    fn into_tauri_error(self) -> String {
        format!("{:#}", self)
    }
}
