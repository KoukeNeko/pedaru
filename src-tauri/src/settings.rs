//! Application settings storage
//!
//! This module handles storing and retrieving app settings from the SQLite database.

use serde::{Deserialize, Serialize};

use crate::db::{now_timestamp, open_db};
use crate::error::{DatabaseError, PedaruError};

// ============================================================================
// Constants - Setting Keys
// ============================================================================

pub const KEY_GEMINI_API_KEY: &str = "gemini_api_key";
pub const KEY_GEMINI_MODEL: &str = "gemini_model";
pub const KEY_GEMINI_EXPLANATION_MODEL: &str = "gemini_explanation_model";
pub const KEY_GEMINI_PROMPT_WORD: &str = "gemini_prompt_word";

/// Default Gemini model for translation (fast)
pub const DEFAULT_GEMINI_MODEL: &str = "gemini-2.0-flash";
/// Default Gemini model for detailed explanation (can be more capable)
pub const DEFAULT_GEMINI_EXPLANATION_MODEL: &str = "gemini-2.0-flash";

// ============================================================================
// Default Prompts
// ============================================================================

pub const DEFAULT_PROMPT_WORD: &str = r#"以下のテキストを文脈を考慮して翻訳・解説し、Markdown形式で出力してください。

## コンテキスト（選択されたテキストの前後）:
{context}

## テキスト:
{text}

## 出力形式（必ずこの形式で出力）:

### 翻訳
[この文脈での意味を日本語で簡潔に]

### 翻訳のポイント
- **品詞**: [品詞（単語の場合）]
- **用法**: [基本的な用法]
- **例文**: [簡単な例文]
- **関連表現**: [類義語など]"#;

// ============================================================================
// Types
// ============================================================================

/// Gemini translation settings
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeminiSettings {
    pub api_key: String,
    pub model: String,
    pub explanation_model: String,
    pub prompt_word: String,
}

impl Default for GeminiSettings {
    fn default() -> Self {
        Self {
            api_key: String::new(),
            model: DEFAULT_GEMINI_MODEL.to_string(),
            explanation_model: DEFAULT_GEMINI_EXPLANATION_MODEL.to_string(),
            prompt_word: DEFAULT_PROMPT_WORD.to_string(),
        }
    }
}

// ============================================================================
// Database Operations
// ============================================================================

/// Get a setting value by key
pub fn get_setting(app: &tauri::AppHandle, key: &str) -> Result<Option<String>, PedaruError> {
    let conn = open_db(app)?;

    let result: Result<String, rusqlite::Error> =
        conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| {
            row.get(0)
        });

    match result {
        Ok(value) => Ok(Some(value)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(PedaruError::Database(DatabaseError::OpenFailed {
            source: e,
        })),
    }
}

/// Set a setting value
pub fn set_setting(app: &tauri::AppHandle, key: &str, value: &str) -> Result<(), PedaruError> {
    let conn = open_db(app)?;
    let now = now_timestamp();

    conn.execute(
        "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET value = ?2, updated_at = ?3",
        rusqlite::params![key, value, now],
    )
    .map_err(|source| PedaruError::Database(DatabaseError::OpenFailed { source }))?;

    Ok(())
}

/// Get all Gemini settings
pub fn get_gemini_settings(app: &tauri::AppHandle) -> Result<GeminiSettings, PedaruError> {
    let api_key = get_setting(app, KEY_GEMINI_API_KEY)?.unwrap_or_default();
    let model =
        get_setting(app, KEY_GEMINI_MODEL)?.unwrap_or_else(|| DEFAULT_GEMINI_MODEL.to_string());
    let explanation_model = get_setting(app, KEY_GEMINI_EXPLANATION_MODEL)?
        .unwrap_or_else(|| DEFAULT_GEMINI_EXPLANATION_MODEL.to_string());
    let prompt_word = get_setting(app, KEY_GEMINI_PROMPT_WORD)?
        .unwrap_or_else(|| DEFAULT_PROMPT_WORD.to_string());

    Ok(GeminiSettings {
        api_key,
        model,
        explanation_model,
        prompt_word,
    })
}

/// Save Gemini settings
pub fn save_gemini_settings(
    app: &tauri::AppHandle,
    settings: &GeminiSettings,
) -> Result<(), PedaruError> {
    set_setting(app, KEY_GEMINI_API_KEY, &settings.api_key)?;
    set_setting(app, KEY_GEMINI_MODEL, &settings.model)?;
    set_setting(
        app,
        KEY_GEMINI_EXPLANATION_MODEL,
        &settings.explanation_model,
    )?;
    set_setting(app, KEY_GEMINI_PROMPT_WORD, &settings.prompt_word)?;
    Ok(())
}
