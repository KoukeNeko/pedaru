'use client';

import { useState, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-shell';
import type { AuthStatus, DriveFolder, StoredFolder } from '@/types';

/**
 * Hook for managing Google OAuth authentication and Drive folder configuration
 */
export function useGoogleAuth() {
  const [authStatus, setAuthStatus] = useState<AuthStatus>({
    authenticated: false,
    configured: false,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncedFolders, setSyncedFolders] = useState<StoredFolder[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);

  // Check authentication status on mount
  useEffect(() => {
    if (isInitialized) return;
    setIsInitialized(true);

    const doInit = async () => {
      try {
        setIsLoading(true);
        const [status, folders] = await Promise.all([
          invoke<AuthStatus>('get_google_auth_status'),
          invoke<StoredFolder[]>('get_drive_folders'),
        ]);
        setAuthStatus(status);
        setSyncedFolders(folders);
        setError(null);
      } catch (err) {
        console.error('Failed to initialize auth:', err);
        // Don't set error here - auth might just not be configured
      } finally {
        setIsLoading(false);
      }
    };

    doInit();
  }, [isInitialized]);

  /**
   * Check current authentication status
   */
  const checkAuthStatus = useCallback(async () => {
    try {
      setIsLoading(true);
      const status = await invoke<AuthStatus>('get_google_auth_status');
      setAuthStatus(status);
      setError(null);
    } catch (err) {
      console.error('Failed to check auth status:', err);
      setError(String(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Save OAuth credentials
   */
  const saveCredentials = useCallback(async (clientId: string, clientSecret: string) => {
    try {
      setIsLoading(true);
      await invoke('save_oauth_credentials', { clientId, clientSecret });
      await checkAuthStatus();
      setError(null);
      return true;
    } catch (err) {
      console.error('Failed to save credentials:', err);
      setError(String(err));
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [checkAuthStatus]);

  /**
   * Start OAuth login flow
   */
  const login = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      // Get OAuth URL from backend
      const authUrl = await invoke<string>('start_google_auth');

      // Open in default browser
      await open(authUrl);

      // Poll for auth completion (the callback server handles token exchange)
      // We poll every 2 seconds for up to 5 minutes
      const maxAttempts = 150;
      let attempts = 0;

      const pollInterval = setInterval(async () => {
        attempts++;
        try {
          const status = await invoke<AuthStatus>('get_google_auth_status');
          if (status.authenticated) {
            clearInterval(pollInterval);
            setAuthStatus(status);
            setIsLoading(false);
          }
        } catch {
          // Ignore polling errors
        }

        if (attempts >= maxAttempts) {
          clearInterval(pollInterval);
          setError('Authentication timed out. Please try again.');
          setIsLoading(false);
        }
      }, 2000);

    } catch (err) {
      console.error('Failed to start login:', err);
      setError(String(err));
      setIsLoading(false);
    }
  }, []);

  /**
   * Logout from Google
   */
  const logout = useCallback(async () => {
    try {
      setIsLoading(true);
      await invoke('logout_google');
      setAuthStatus({ authenticated: false, configured: true });
      setError(null);
    } catch (err) {
      console.error('Failed to logout:', err);
      setError(String(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Load synced folders from database
   */
  const loadSyncedFolders = useCallback(async () => {
    try {
      const folders = await invoke<StoredFolder[]>('get_drive_folders');
      setSyncedFolders(folders);
    } catch (err) {
      console.error('Failed to load synced folders:', err);
    }
  }, []);

  /**
   * List folders in Google Drive
   */
  const listDriveFolders = useCallback(async (parentId?: string): Promise<DriveFolder[]> => {
    try {
      const folders = await invoke<DriveFolder[]>('list_drive_folders', { parentId });
      return folders;
    } catch (err) {
      console.error('Failed to list drive folders:', err);
      setError(String(err));
      return [];
    }
  }, []);

  /**
   * Add a folder to sync list
   */
  const addSyncFolder = useCallback(async (folderId: string, folderName: string) => {
    try {
      await invoke('add_drive_folder', { folderId, folderName });
      await loadSyncedFolders();
      return true;
    } catch (err) {
      console.error('Failed to add sync folder:', err);
      setError(String(err));
      return false;
    }
  }, [loadSyncedFolders]);

  /**
   * Remove a folder from sync list
   */
  const removeSyncFolder = useCallback(async (folderId: string) => {
    try {
      await invoke('remove_drive_folder', { folderId });
      await loadSyncedFolders();
      return true;
    } catch (err) {
      console.error('Failed to remove sync folder:', err);
      setError(String(err));
      return false;
    }
  }, [loadSyncedFolders]);

  return {
    // State
    authStatus,
    isLoading,
    error,
    syncedFolders,

    // Auth actions
    checkAuthStatus,
    saveCredentials,
    login,
    logout,

    // Folder actions
    loadSyncedFolders,
    listDriveFolders,
    addSyncFolder,
    removeSyncFolder,
  };
}
