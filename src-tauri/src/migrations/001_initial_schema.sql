-- Pedaru Database Schema V1
-- This is the consolidated initial schema for new installations

-- ============================================
-- Sessions: PDF viewer session state
-- ============================================
CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path TEXT NOT NULL UNIQUE,
    path_hash TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    current_page INTEGER NOT NULL,
    zoom REAL NOT NULL,
    view_mode TEXT NOT NULL,
    bookmarks TEXT,
    page_history TEXT,
    history_index INTEGER,
    tabs TEXT,
    active_tab_index INTEGER,
    windows TEXT,
    last_opened INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_file_path ON sessions(file_path);
CREATE INDEX IF NOT EXISTS idx_sessions_last_opened ON sessions(last_opened DESC);

-- ============================================
-- Session Bookmarks: Normalized bookmarks
-- ============================================
CREATE TABLE IF NOT EXISTS session_bookmarks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    page INTEGER NOT NULL,
    label TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    UNIQUE(session_id, page)
);

CREATE INDEX IF NOT EXISTS idx_session_bookmarks_session ON session_bookmarks(session_id);
CREATE INDEX IF NOT EXISTS idx_session_bookmarks_page ON session_bookmarks(page);

-- ============================================
-- Session Tabs: Normalized tabs
-- ============================================
CREATE TABLE IF NOT EXISTS session_tabs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    page INTEGER NOT NULL,
    label TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_session_tabs_session ON session_tabs(session_id);

-- ============================================
-- Session Page History: Normalized history
-- ============================================
CREATE TABLE IF NOT EXISTS session_page_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    page INTEGER NOT NULL,
    visited_at INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_session_page_history_session ON session_page_history(session_id);

-- ============================================
-- Settings: Application configuration
-- ============================================
CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_settings_key ON settings(key);

-- ============================================
-- Drive Folders: Google Drive folder config
-- ============================================
CREATE TABLE IF NOT EXISTS drive_folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    folder_id TEXT NOT NULL UNIQUE,
    folder_name TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    last_synced INTEGER,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_drive_folders_folder_id ON drive_folders(folder_id);

-- ============================================
-- Bookshelf Cloud: PDFs from Google Drive
-- ============================================
CREATE TABLE IF NOT EXISTS bookshelf_cloud (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    drive_file_id TEXT NOT NULL UNIQUE,
    drive_folder_id TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_size INTEGER,
    drive_modified_time TEXT,
    thumbnail_data TEXT,
    local_path TEXT,
    download_status TEXT NOT NULL DEFAULT 'pending',
    download_progress REAL DEFAULT 0,
    pdf_title TEXT,
    pdf_author TEXT,
    is_favorite INTEGER NOT NULL DEFAULT 0,
    last_opened INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cloud_drive_file_id ON bookshelf_cloud(drive_file_id);
CREATE INDEX IF NOT EXISTS idx_cloud_folder_id ON bookshelf_cloud(drive_folder_id);
CREATE INDEX IF NOT EXISTS idx_cloud_download_status ON bookshelf_cloud(download_status);
CREATE INDEX IF NOT EXISTS idx_cloud_last_opened ON bookshelf_cloud(last_opened DESC);
CREATE INDEX IF NOT EXISTS idx_cloud_favorite ON bookshelf_cloud(is_favorite);

-- ============================================
-- Bookshelf Local: Locally imported PDFs
-- ============================================
CREATE TABLE IF NOT EXISTS bookshelf_local (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path TEXT NOT NULL UNIQUE,
    original_path TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_size INTEGER,
    thumbnail_data TEXT,
    pdf_title TEXT,
    pdf_author TEXT,
    is_favorite INTEGER NOT NULL DEFAULT 0,
    last_opened INTEGER,
    imported_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_local_file_path ON bookshelf_local(file_path);
CREATE INDEX IF NOT EXISTS idx_local_original_path ON bookshelf_local(original_path);
CREATE INDEX IF NOT EXISTS idx_local_last_opened ON bookshelf_local(last_opened DESC);
CREATE INDEX IF NOT EXISTS idx_local_favorite ON bookshelf_local(is_favorite);
