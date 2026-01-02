//! Bookshelf management module
//!
//! This module handles bookshelf database operations and download management
//! for PDFs synced from Google Drive.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{AppHandle, Manager};

use crate::db::{now_timestamp, open_db};
use crate::error::{DatabaseError, IoError, PedaruError};

// ============================================================================
// Types
// ============================================================================

/// Stored folder configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredFolder {
    pub folder_id: String,
    pub folder_name: String,
    pub is_active: bool,
    pub last_synced: Option<i64>,
}

/// Bookshelf item from database
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookshelfItem {
    pub id: i64,
    pub drive_file_id: String,
    pub drive_folder_id: String,
    pub file_name: String,
    pub file_size: Option<i64>,
    pub thumbnail_data: Option<String>,
    pub local_path: Option<String>,
    pub download_status: String,
    pub download_progress: f64,
    pub pdf_title: Option<String>,
}

/// Download progress event
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub drive_file_id: String,
    pub progress: f64,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
}

/// Sync result
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    pub new_files: i32,
    pub updated_files: i32,
    pub removed_files: i32,
}

// ============================================================================
// Download Manager
// ============================================================================

/// Global registry for tracking active downloads and their cancellation flags
static ACTIVE_DOWNLOADS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();

fn get_active_downloads() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    ACTIVE_DOWNLOADS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Register a download and return a cancellation flag
pub fn register_download(file_id: &str) -> Arc<AtomicBool> {
    let cancel_flag = Arc::new(AtomicBool::new(false));
    let downloads = get_active_downloads();
    let mut guard = downloads.lock().expect("ACTIVE_DOWNLOADS mutex poisoned");
    guard.insert(file_id.to_string(), cancel_flag.clone());
    cancel_flag
}

/// Unregister a download
pub fn unregister_download(file_id: &str) {
    let downloads = get_active_downloads();
    let mut guard = downloads.lock().expect("ACTIVE_DOWNLOADS mutex poisoned");
    guard.remove(file_id);
}

/// Cancel a download by setting its cancellation flag
pub fn cancel_download(file_id: &str) -> bool {
    let downloads = get_active_downloads();
    let guard = downloads.lock().expect("ACTIVE_DOWNLOADS mutex poisoned");
    if let Some(cancel_flag) = guard.get(file_id) {
        cancel_flag.store(true, Ordering::SeqCst);
        true
    } else {
        false
    }
}

/// Get the cancellation flag for a download if it exists
pub fn get_cancel_flag(file_id: &str) -> Option<Arc<AtomicBool>> {
    let downloads = get_active_downloads();
    let guard = downloads.lock().expect("ACTIVE_DOWNLOADS mutex poisoned");
    guard.get(file_id).cloned()
}

/// Get downloads directory path
pub fn get_downloads_dir(app: &AppHandle) -> Result<std::path::PathBuf, PedaruError> {
    let config_dir = app.path().app_config_dir().map_err(|e| {
        PedaruError::Config(crate::error::ConfigError::ConfigDirResolutionFailed(
            e.to_string(),
        ))
    })?;
    Ok(config_dir.join("downloads"))
}

// ============================================================================
// Folder Operations
// ============================================================================

/// Add a folder to the sync list
pub fn add_sync_folder(
    app: &AppHandle,
    folder_id: &str,
    folder_name: &str,
) -> Result<(), PedaruError> {
    let conn = open_db(app)?;
    conn.execute(
        "INSERT INTO drive_folders (folder_id, folder_name, created_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(folder_id) DO UPDATE SET
           folder_name = excluded.folder_name,
           is_active = 1",
        rusqlite::params![folder_id, folder_name, now_timestamp()],
    )
    .map_err(|e| PedaruError::Database(DatabaseError::QueryFailed(e.to_string())))?;
    Ok(())
}

/// Remove a folder from the sync list (marks as inactive)
pub fn remove_sync_folder(app: &AppHandle, folder_id: &str) -> Result<(), PedaruError> {
    let conn = open_db(app)?;
    conn.execute(
        "UPDATE drive_folders SET is_active = 0 WHERE folder_id = ?1",
        [folder_id],
    )
    .map_err(|e| PedaruError::Database(DatabaseError::QueryFailed(e.to_string())))?;
    Ok(())
}

/// Get all active sync folders
pub fn get_sync_folders(app: &AppHandle) -> Result<Vec<StoredFolder>, PedaruError> {
    let conn = open_db(app)?;
    let mut stmt = conn
        .prepare(
            "SELECT folder_id, folder_name, is_active, last_synced
             FROM drive_folders
             WHERE is_active = 1
             ORDER BY folder_name",
        )
        .map_err(|e| PedaruError::Database(DatabaseError::QueryFailed(e.to_string())))?;

    let folders = stmt
        .query_map([], |row| {
            Ok(StoredFolder {
                folder_id: row.get(0)?,
                folder_name: row.get(1)?,
                is_active: row.get::<_, i32>(2)? != 0,
                last_synced: row.get(3)?,
            })
        })
        .map_err(|e| PedaruError::Database(DatabaseError::QueryFailed(e.to_string())))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(folders)
}

/// Update folder sync timestamp
pub fn update_folder_sync_time(app: &AppHandle, folder_id: &str) -> Result<(), PedaruError> {
    let conn = open_db(app)?;
    conn.execute(
        "UPDATE drive_folders SET last_synced = ?1 WHERE folder_id = ?2",
        rusqlite::params![now_timestamp(), folder_id],
    )
    .map_err(|e| PedaruError::Database(DatabaseError::QueryFailed(e.to_string())))?;
    Ok(())
}

// ============================================================================
// Bookshelf Item Operations
// ============================================================================

/// Upsert bookshelf item from Drive file
pub fn upsert_item(
    app: &AppHandle,
    drive_file_id: &str,
    folder_id: &str,
    file_name: &str,
    file_size: Option<i64>,
    mime_type: &str,
    modified_time: Option<&str>,
) -> Result<(), PedaruError> {
    let conn = open_db(app)?;
    let now = now_timestamp();

    conn.execute(
        "INSERT INTO bookshelf (
           drive_file_id, drive_folder_id, file_name, file_size,
           mime_type, drive_modified_time, created_at, updated_at
         )
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
         ON CONFLICT(drive_file_id) DO UPDATE SET
           file_name = excluded.file_name,
           file_size = excluded.file_size,
           drive_modified_time = excluded.drive_modified_time,
           updated_at = excluded.updated_at",
        rusqlite::params![
            drive_file_id,
            folder_id,
            file_name,
            file_size,
            mime_type,
            modified_time,
            now
        ],
    )
    .map_err(|e| PedaruError::Database(DatabaseError::QueryFailed(e.to_string())))?;

    Ok(())
}

/// Get all bookshelf items
pub fn get_items(app: &AppHandle) -> Result<Vec<BookshelfItem>, PedaruError> {
    let conn = open_db(app)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, drive_file_id, drive_folder_id, file_name, file_size,
                    thumbnail_data, local_path, download_status, download_progress, pdf_title
             FROM bookshelf
             ORDER BY file_name",
        )
        .map_err(|e| PedaruError::Database(DatabaseError::QueryFailed(e.to_string())))?;

    let items = stmt
        .query_map([], |row| {
            Ok(BookshelfItem {
                id: row.get(0)?,
                drive_file_id: row.get(1)?,
                drive_folder_id: row.get(2)?,
                file_name: row.get(3)?,
                file_size: row.get(4)?,
                thumbnail_data: row.get(5)?,
                local_path: row.get(6)?,
                download_status: row.get(7)?,
                download_progress: row.get(8)?,
                pdf_title: row.get(9)?,
            })
        })
        .map_err(|e| PedaruError::Database(DatabaseError::QueryFailed(e.to_string())))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(items)
}

/// Update download status
pub fn update_download_status(
    app: &AppHandle,
    drive_file_id: &str,
    status: &str,
    progress: f64,
    local_path: Option<&str>,
) -> Result<(), PedaruError> {
    let conn = open_db(app)?;
    conn.execute(
        "UPDATE bookshelf SET
           download_status = ?1,
           download_progress = ?2,
           local_path = COALESCE(?3, local_path),
           updated_at = ?4
         WHERE drive_file_id = ?5",
        rusqlite::params![status, progress, local_path, now_timestamp(), drive_file_id],
    )
    .map_err(|e| PedaruError::Database(DatabaseError::QueryFailed(e.to_string())))?;
    Ok(())
}

/// Update thumbnail data
pub fn update_thumbnail(
    app: &AppHandle,
    drive_file_id: &str,
    thumbnail_data: &str,
) -> Result<(), PedaruError> {
    let conn = open_db(app)?;
    conn.execute(
        "UPDATE bookshelf SET thumbnail_data = ?1, updated_at = ?2 WHERE drive_file_id = ?3",
        rusqlite::params![thumbnail_data, now_timestamp(), drive_file_id],
    )
    .map_err(|e| PedaruError::Database(DatabaseError::QueryFailed(e.to_string())))?;
    Ok(())
}

/// Update PDF title
pub fn update_pdf_title(
    app: &AppHandle,
    drive_file_id: &str,
    pdf_title: &str,
) -> Result<(), PedaruError> {
    let conn = open_db(app)?;
    conn.execute(
        "UPDATE bookshelf SET pdf_title = ?1, updated_at = ?2 WHERE drive_file_id = ?3",
        rusqlite::params![pdf_title, now_timestamp(), drive_file_id],
    )
    .map_err(|e| PedaruError::Database(DatabaseError::QueryFailed(e.to_string())))?;
    Ok(())
}

/// Delete local copy of a bookshelf item (deletes file and resets database)
pub fn delete_local_copy(app: &AppHandle, drive_file_id: &str) -> Result<(), PedaruError> {
    let conn = open_db(app)?;

    // Get current local path
    let local_path: Option<String> = conn
        .query_row(
            "SELECT local_path FROM bookshelf WHERE drive_file_id = ?1",
            [drive_file_id],
            |row| row.get(0),
        )
        .ok()
        .flatten();

    // Delete file if exists
    if let Some(path) = local_path {
        let path = std::path::Path::new(&path);
        if path.exists() {
            std::fs::remove_file(path).map_err(|e| {
                PedaruError::Io(IoError::ReadFailed {
                    path: path.display().to_string(),
                    source: e,
                })
            })?;
        }
    }

    // Update database
    conn.execute(
        "UPDATE bookshelf SET
           local_path = NULL,
           download_status = 'pending',
           download_progress = 0,
           updated_at = ?1
         WHERE drive_file_id = ?2",
        rusqlite::params![now_timestamp(), drive_file_id],
    )
    .map_err(|e| PedaruError::Database(DatabaseError::QueryFailed(e.to_string())))?;

    Ok(())
}

/// Reset download status without deleting the file
/// Used when file is known to be missing
pub fn reset_download_status(app: &AppHandle, drive_file_id: &str) -> Result<(), PedaruError> {
    let conn = open_db(app)?;

    conn.execute(
        "UPDATE bookshelf SET
           local_path = NULL,
           download_status = 'pending',
           download_progress = 0,
           thumbnail_data = NULL,
           updated_at = ?1
         WHERE drive_file_id = ?2",
        rusqlite::params![now_timestamp(), drive_file_id],
    )
    .map_err(|e| PedaruError::Database(DatabaseError::QueryFailed(e.to_string())))?;

    Ok(())
}

/// Reset stale "downloading" statuses to "pending" on app startup
pub fn reset_stale_downloads(app: &AppHandle) -> Result<(), PedaruError> {
    let conn = open_db(app)?;
    conn.execute(
        "UPDATE bookshelf SET download_status = 'pending', download_progress = 0 WHERE download_status = 'downloading'",
        [],
    )
    .map_err(|e| PedaruError::Database(DatabaseError::QueryFailed(e.to_string())))?;
    Ok(())
}

/// Verify that local files exist for completed downloads
/// Resets status to "pending" for items where the file no longer exists
pub fn verify_local_files(app: &AppHandle) -> Result<i32, PedaruError> {
    let conn = open_db(app)?;

    // Get all completed downloads with local paths
    let mut stmt = conn
        .prepare(
            "SELECT drive_file_id, local_path FROM bookshelf
             WHERE download_status = 'completed' AND local_path IS NOT NULL",
        )
        .map_err(|e| PedaruError::Database(DatabaseError::QueryFailed(e.to_string())))?;

    let items: Vec<(String, String)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| PedaruError::Database(DatabaseError::QueryFailed(e.to_string())))?
        .filter_map(|r| r.ok())
        .collect();

    let mut reset_count = 0;

    for (drive_file_id, local_path) in items {
        let path = std::path::Path::new(&local_path);
        if !path.exists() {
            eprintln!("[Pedaru] File missing, resetting status: {}", local_path);
            conn.execute(
                "UPDATE bookshelf SET
                   download_status = 'pending',
                   download_progress = 0,
                   local_path = NULL,
                   thumbnail_data = NULL,
                   updated_at = ?1
                 WHERE drive_file_id = ?2",
                rusqlite::params![now_timestamp(), drive_file_id],
            )
            .map_err(|e| PedaruError::Database(DatabaseError::QueryFailed(e.to_string())))?;
            reset_count += 1;
        }
    }

    if reset_count > 0 {
        eprintln!("[Pedaru] Reset {} items with missing files", reset_count);
    }

    Ok(reset_count)
}
