//! Secure secrets management using OS Keychain
//!
//! This module provides secure storage for sensitive data like API keys and OAuth tokens.
//! It uses the OS keychain (via keyring-rs) for cross-platform secure storage:
//! - macOS: Keychain
//! - Windows: Credential Manager
//! - Linux: Secret Service (gnome-keyring, KWallet, etc.)

use crate::error::PedaruError;

/// Service name for keyring storage
const KEYRING_SERVICE: &str = "pedaru";

/// Keys for secrets stored in keyring
pub mod keys {
    pub const GEMINI_API_KEY: &str = "gemini_api_key";
    pub const GOOGLE_CLIENT_ID: &str = "google_client_id";
    pub const GOOGLE_CLIENT_SECRET: &str = "google_client_secret";
    pub const GOOGLE_ACCESS_TOKEN: &str = "google_access_token";
    pub const GOOGLE_REFRESH_TOKEN: &str = "google_refresh_token";
    pub const GOOGLE_TOKEN_EXPIRY: &str = "google_token_expiry";
}

/// Store a secret in the OS keychain
pub fn store_secret(_app: &tauri::AppHandle, key: &str, value: &str) -> Result<(), PedaruError> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, key)
        .map_err(|e| PedaruError::Secrets(format!("Failed to create keyring entry: {}", e)))?;

    entry
        .set_password(value)
        .map_err(|e| PedaruError::Secrets(format!("Failed to store secret '{}': {}", key, e)))?;

    Ok(())
}

/// Retrieve a secret from the OS keychain
pub fn get_secret(_app: &tauri::AppHandle, key: &str) -> Result<Option<String>, PedaruError> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, key)
        .map_err(|e| PedaruError::Secrets(format!("Failed to create keyring entry: {}", e)))?;

    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(PedaruError::Secrets(format!(
            "Failed to get secret '{}': {}",
            key, e
        ))),
    }
}

/// Delete a secret from the OS keychain
pub fn delete_secret(_app: &tauri::AppHandle, key: &str) -> Result<(), PedaruError> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, key)
        .map_err(|e| PedaruError::Secrets(format!("Failed to create keyring entry: {}", e)))?;

    match entry.delete_credential() {
        Ok(()) => {
            eprintln!("[Pedaru] Deleted secret: {}", key);
            Ok(())
        }
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(PedaruError::Secrets(format!(
            "Failed to delete secret '{}': {}",
            key, e
        ))),
    }
}

/// Delete all secrets from the OS keychain
pub fn delete_all_secrets(_app: &tauri::AppHandle) -> Result<(), PedaruError> {
    // Delete all known keys
    let all_keys = [
        keys::GEMINI_API_KEY,
        keys::GOOGLE_CLIENT_ID,
        keys::GOOGLE_CLIENT_SECRET,
        keys::GOOGLE_ACCESS_TOKEN,
        keys::GOOGLE_REFRESH_TOKEN,
        keys::GOOGLE_TOKEN_EXPIRY,
    ];

    for key in all_keys {
        let entry = keyring::Entry::new(KEYRING_SERVICE, key)
            .map_err(|e| PedaruError::Secrets(format!("Failed to create keyring entry: {}", e)))?;

        match entry.delete_credential() {
            Ok(()) => eprintln!("[Pedaru] Deleted secret: {}", key),
            Err(keyring::Error::NoEntry) => {}
            Err(e) => {
                eprintln!("[Pedaru] Failed to delete secret '{}': {}", key, e);
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    // Tests would require mocking the keyring, skipped for now
}
