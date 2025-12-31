import { useCallback, Dispatch, SetStateAction, MutableRefObject } from 'react';
import { confirm, save, open } from '@tauri-apps/plugin-dialog';
import { writeTextFile, readTextFile } from '@tauri-apps/plugin-fs';
import { getAllSessions, importSessions } from '@/lib/database';
import {
  useTauriEventListener,
  useTauriEventListeners,
} from '@/lib/eventUtils';
import type { ViewMode } from './types';

/**
 * Custom hook for handling application menu events
 *
 * Manages menu-triggered actions including reset, export/import sessions,
 * zoom controls, view mode toggles, and opening recent files
 *
 * @param resetAllState - Function to reset all application state
 * @param loadPdfFromPath - Function to load a PDF from path
 * @param filePathRef - Ref to current file path
 * @param isStandaloneMode - Whether running in standalone window mode
 * @param handleZoomIn - Function to zoom in
 * @param handleZoomOut - Function to zoom out
 * @param handleZoomReset - Function to reset zoom
 * @param handleToggleHeader - Function to toggle header visibility
 * @param setViewMode - Setter for view mode
 */
export function useMenuHandlers(
  resetAllState: (options?: { resetViewMode?: boolean }) => void,
  loadPdfFromPath: (path: string) => Promise<void>,
  filePathRef: MutableRefObject<string | null>,
  isStandaloneMode: boolean,
  handleZoomIn: () => void,
  handleZoomOut: () => void,
  handleZoomReset: () => void,
  handleToggleHeader: () => void,
  setViewMode: Dispatch<SetStateAction<ViewMode>>
) {
  // Handle reset all data request from app menu
  const handleResetAllData = useCallback(async () => {
    // Show native confirmation dialog
    const confirmed = await confirm(
      'This will delete:\n\n' +
        '• All bookmarks\n' +
        '• All session history\n' +
        '• Last opened file info\n\n' +
        'This action cannot be undone.',
      {
        title: 'Initialize App?',
        kind: 'warning',
        okLabel: 'Initialize',
        cancelLabel: 'Cancel',
      }
    );

    if (confirmed) {
      // Clear all localStorage data for this app
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('pedaru_')) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((key) => localStorage.removeItem(key));

      // Reset current state (including viewMode for full reset)
      resetAllState({ resetViewMode: true });
    }
  }, [resetAllState]);

  // Handle export session data
  const handleExportSession = useCallback(async () => {
    try {
      const sessions = await getAllSessions();
      const exportData = {
        exportDate: new Date().toISOString(),
        version: '1.0',
        sessions: sessions,
      };

      const savePath = await save({
        title: 'Export Session Data',
        defaultPath: `pedaru-sessions-${new Date().toISOString().split('T')[0]}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });

      if (savePath) {
        await writeTextFile(savePath, JSON.stringify(exportData, null, 2));
        console.log('Session data exported successfully to:', savePath);
      }
    } catch (error) {
      console.error('Failed to export session data:', error);
    }
  }, []);

  // Handle import session data
  const handleImportSession = useCallback(async () => {
    try {
      const importPath = await open({
        title: 'Import Session Data',
        multiple: false,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });

      if (!importPath) return;

      const jsonString = await readTextFile(importPath as string);
      const importData = JSON.parse(jsonString);

      if (!importData.version || !Array.isArray(importData.sessions)) {
        throw new Error('Invalid session data format');
      }

      const importCount = await importSessions(importData.sessions);
      await confirm(`Successfully imported ${importCount} session(s).`, {
        title: 'Import Complete',
        kind: 'info',
      });
      console.log('Session data imported successfully:', importCount);
    } catch (error) {
      console.error('Failed to import session data:', error);
      await confirm(
        `Failed to import session data: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { title: 'Import Failed', kind: 'error' }
      );
    }
  }, []);

  // Handle opening a recent file
  const handleOpenRecent = useCallback(
    async (selectedFilePath: string) => {
      try {
        if (selectedFilePath === filePathRef.current) {
          console.log('File already open, skipping reload');
          return;
        }
        await loadPdfFromPath(selectedFilePath);
      } catch (error) {
        console.error('Failed to open recent file:', error);
      }
    },
    [loadPdfFromPath, filePathRef]
  );

  // Toggle two-column mode
  const handleToggleTwoColumn = useCallback(() => {
    setViewMode((prev) => (prev === 'two-column' ? 'single' : 'two-column'));
  }, [setViewMode]);

  // Listen for reset all data request from app menu (main window only)
  useTauriEventListener(
    'reset-all-data-requested',
    handleResetAllData,
    [isStandaloneMode, handleResetAllData]
  );

  // Listen for menu events from system menu bar (zoom, view mode, session export/import)
  useTauriEventListeners(
    [
      { event: 'menu-zoom-in', handler: handleZoomIn },
      { event: 'menu-zoom-out', handler: handleZoomOut },
      { event: 'menu-zoom-reset', handler: handleZoomReset },
      { event: 'menu-toggle-two-column', handler: handleToggleTwoColumn },
      { event: 'menu-toggle-header', handler: handleToggleHeader },
      { event: 'export-session-data-requested', handler: handleExportSession },
      { event: 'import-session-data-requested', handler: handleImportSession },
    ],
    [
      handleZoomIn,
      handleZoomOut,
      handleZoomReset,
      handleToggleTwoColumn,
      handleToggleHeader,
      handleExportSession,
      handleImportSession,
    ]
  );

  // Listen for open recent file selection (needs payload access)
  useTauriEventListener<string>(
    'menu-open-recent-selected',
    handleOpenRecent,
    [handleOpenRecent]
  );
}
