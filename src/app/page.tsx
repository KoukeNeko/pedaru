'use client';

import { useCallback, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import { open, confirm, save } from '@tauri-apps/plugin-dialog';
import { writeTextFile, readTextFile } from '@tauri-apps/plugin-fs';
import Header from '@/components/Header';
import { Columns, History, PanelTop, Bookmark as BookmarkIcon, Search, X, List, Loader2 } from 'lucide-react';
import { getCurrentWebviewWindow, WebviewWindow, getAllWebviewWindows } from '@tauri-apps/api/webviewWindow';
import TocSidebar from '@/components/TocSidebar';
import HistorySidebar from '@/components/HistorySidebar';
import WindowSidebar from '@/components/WindowSidebar';
import BookmarkSidebar, { Bookmark } from '@/components/BookmarkSidebar';
import SearchResultsSidebar, { SearchResult } from '@/components/SearchResultsSidebar';
import { ViewMode } from '@/components/Settings';

// Dynamic import for PdfViewer to avoid SSR issues with pdfjs-dist
const PdfViewer = dynamic(() => import('@/components/PdfViewer'), {
  ssr: false,
  loading: () => (
    <div className="flex-1 flex items-center justify-center bg-bg-primary">
      <Loader2 className="w-10 h-10 animate-spin text-accent" />
    </div>
  ),
});
import { PdfInfo } from '@/types/pdf';
import {
  saveSessionState,
  loadSessionState,
  getLastOpenedPath,
  getAllSessions,
  importSessions,
  getRecentFiles,
  TabState,
  WindowState,
  PdfSessionState,
} from '@/lib/database';
import { getChapterForPage as getChapter } from '@/lib/pdfUtils';
import { useTauriEventListener, useTauriEventListeners } from '@/lib/eventUtils';
import { zoomIn, zoomOut, resetZoom } from '@/lib/zoomConfig';
import { useBookmarks } from '@/hooks/useBookmarks';
import { useNavigation } from '@/hooks/useNavigation';
import { useSearch } from '@/hooks/useSearch';
import { useTabManagement } from '@/hooks/useTabManagement';
import { useWindowManagement } from '@/hooks/useWindowManagement';
import { usePdfLoader } from '@/hooks/usePdfLoader';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useStartup } from '@/hooks/useStartup';
import { usePdfViewerState } from '@/hooks/usePdfViewerState';
import type { OpenWindow, Tab, HistoryEntry } from '@/hooks/types';

export default function Home() {
  // Debug: Log immediately on component mount
  console.log('=== Home component mounting ===');
  console.log('window.location.href:', typeof window !== 'undefined' ? window.location.href : 'SSR');
  console.log('window.location.search:', typeof window !== 'undefined' ? window.location.search : 'SSR');
  
  // All state managed via usePdfViewerState hook
  const {
    // State groups
    pdfFile,
    viewer,
    ui,
    search,
    history,
    tabWindow,
    pendingRestore,
    // Setters
    pdfFileSetters,
    viewerSetters,
    uiSetters,
    searchSetters,
    historySetters,
    tabWindowSetters,
    pendingRestoreSetters,
    // Refs
    refs,
    // Bookmarks
    bookmarks,
    setBookmarks,
    // Utility
    resetAllState,
  } = usePdfViewerState();

  // Destructure for easier access (compatibility with existing code)
  const { fileData, fileName, filePath, pdfInfo } = pdfFile;
  const { setFileData, setFileName, setFilePath, setPdfInfo } = pdfFileSetters;

  const { currentPage, totalPages, zoom, viewMode, isLoading, isStandaloneMode } = viewer;
  const { setCurrentPage, setTotalPages, setZoom, setViewMode, setIsLoading, setIsStandaloneMode } = viewerSetters;

  const { isTocOpen, showHistory, showBookmarks, showWindows, showHeader, showSearchResults, showStandaloneSearch, sidebarWidth } = ui;
  const { setIsTocOpen, setShowHistory, setShowBookmarks, setShowWindows, setShowHeader, setShowSearchResults, setShowStandaloneSearch, setSidebarWidth } = uiSetters;

  const searchQuery = search.query;
  const searchResults = search.results;
  const currentSearchIndex = search.currentIndex;
  const isSearching = search.isSearching;
  const { setSearchQuery, setSearchResults, setCurrentSearchIndex, setIsSearching } = searchSetters;

  const { pageHistory, historyIndex } = history;
  const { setPageHistory, setHistoryIndex } = historySetters;

  const { tabs, activeTabId, openWindows } = tabWindow;
  const { setTabs, setActiveTabId, setOpenWindows } = tabWindowSetters;

  const { pendingTabsRestore, pendingActiveTabIndex, pendingWindowsRestore } = pendingRestore;
  const { setPendingTabsRestore, setPendingActiveTabIndex, setPendingWindowsRestore } = pendingRestoreSetters;

  const {
    filePathRef,
    tabIdRef,
    headerWasHiddenBeforeSearchRef,
    tempShowHeaderRef,
    headerTimerRef,
    standaloneSearchInputRef,
    pdfDocRef,
    saveTimeoutRef,
    isRestoringSessionRef,
  } = refs;

  // Keep filePathRef in sync with filePath state
  useEffect(() => {
    filePathRef.current = filePath;
  }, [filePath, filePathRef]);

  const updateNativeWindowTitle = useCallback(async (page: number, forceStandalone?: boolean) => {
    // Check if we're in standalone mode - use forceStandalone for initial load
    // since isStandaloneMode state might not be set yet
    const isStandalone = forceStandalone ?? isStandaloneMode;
    if (!isStandalone) return;
    try {
      const win = getCurrentWebviewWindow();
      await win.setTitle(`Page ${page}`);
    } catch (e) {
      console.warn('Failed to update window title:', e);
    }
  }, [isStandaloneMode]);

  // Debug: Log component state changes
  useEffect(() => {
    console.log('Component state:', {
      hasFileData: !!fileData,
      fileName,
      filePath,
      currentPage,
      totalPages,
      isStandaloneMode,
      isLoading
    });
  }, [fileData, fileName, filePath, currentPage, totalPages, isStandaloneMode, isLoading]);

  // Helper function for getting chapter names
  const getChapterForPage = useCallback(
    (page: number) => getChapter(pdfInfo, page),
    [pdfInfo]
  );

  // Initialize custom hooks
  const {
    navigateToPageWithoutTabUpdate,
    goToPage,
    goToPageWithoutHistory,
    goToPrevPage,
    goToNextPage,
    goBack,
    goForward,
    canGoBack,
    canGoForward,
  } = useNavigation(
    currentPage,
    setCurrentPage,
    totalPages,
    viewMode,
    pageHistory,
    setPageHistory,
    historyIndex,
    setHistoryIndex,
    isStandaloneMode,
    tabs,
    setTabs,
    activeTabId,
    pdfInfo
  );

  const {
    toggleBookmark,
    removeBookmark,
    clearBookmarks,
    isCurrentPageBookmarked,
  } = useBookmarks(
    bookmarks,
    setBookmarks,
    currentPage,
    getChapterForPage,
    isStandaloneMode
  );

  const {
    performSearch,
    handleSearchChange,
    handleSearchNext,
    handleSearchPrev,
    handleSearchNextPreview,
    handleSearchPrevPreview,
    handleSearchConfirm,
    handlePdfDocumentLoad,
  } = useSearch(
    searchQuery,
    setSearchQuery,
    searchResults,
    setSearchResults,
    currentSearchIndex,
    setCurrentSearchIndex,
    isSearching,
    setIsSearching,
    showSearchResults,
    setShowSearchResults,
    totalPages,
    goToPage,
    goToPageWithoutHistory,
    isStandaloneMode,
    setViewMode
  );

  // Close PDF and reset to empty state
  const closePdf = useCallback(() => {
    console.log('[closePdf] Closing PDF and resetting state');
    resetAllState();
  }, [resetAllState]);

  const {
    addTabFromCurrent,
    addTabForPage,
    selectTab,
    closeCurrentTab,
  } = useTabManagement(
    tabs,
    setTabs,
    activeTabId,
    setActiveTabId,
    currentPage,
    tabIdRef,
    getChapterForPage,
    navigateToPageWithoutTabUpdate,
    goToPage,
    pdfInfo,
    isStandaloneMode,
    pendingTabsRestore,
    setPendingTabsRestore,
    pendingActiveTabIndex,
    setPendingActiveTabIndex,
    closePdf
  );

  const {
    focusWindow,
    openStandaloneWindowWithState,
    openStandaloneWindow,
    closeWindow,
    closeAllWindows,
    moveWindowToTab,
  } = useWindowManagement(
    filePath,
    openWindows,
    setOpenWindows,
    zoom,
    isStandaloneMode,
    pdfInfo,
    getChapterForPage,
    tabs,
    setTabs,
    activeTabId,
    setActiveTabId,
    tabIdRef,
    pendingWindowsRestore,
    setPendingWindowsRestore
  );

  const { loadPdfFromPath, loadPdfInternal: loadPdfFromPathInternal } = usePdfLoader({
    setFileData,
    setFileName,
    setFilePath,
    setPdfInfo,
    setCurrentPage,
    setZoom,
    setViewMode,
    setBookmarks,
    setPageHistory,
    setHistoryIndex,
    setSearchQuery,
    setSearchResults,
    setShowSearchResults,
    setIsLoading,
    setOpenWindows,
    setTabs,
    setActiveTabId,
    setPendingTabsRestore,
    setPendingActiveTabIndex,
    setPendingWindowsRestore,
    openWindows,
    isRestoringSessionRef,
  });

  // Zoom handlers using centralized config (consistent across keyboard and menu)
  const handleZoomIn = useCallback(() => {
    setZoom(zoomIn);
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom(zoomOut);
  }, []);

  const handleZoomReset = useCallback(() => {
    setZoom(resetZoom());
  }, []);

  const handleToggleHeader = useCallback(() => {
    setShowHeader((prev) => !prev);
  }, []);

  const showHeaderTemporarily = useCallback(() => {
    // If header is permanently shown by user (not temp), don't auto-hide
    if (showHeader && !tempShowHeaderRef.current) {
      return;
    }

    // Show header temporarily if not already shown
    if (!showHeader) {
      tempShowHeaderRef.current = true;
      setShowHeader(true);
    }

    // Clear any existing timer and reset
    if (headerTimerRef.current) {
      clearTimeout(headerTimerRef.current);
    }

    // Hide after 2 seconds of no tab operations
    headerTimerRef.current = setTimeout(() => {
      tempShowHeaderRef.current = false;
      setShowHeader(false);
      headerTimerRef.current = null;
    }, 2000);
  }, [showHeader]);

  // Initialize keyboard shortcuts
  useKeyboardShortcuts({
    currentPage,
    totalPages,
    goToPage,
    goToPrevPage,
    goToNextPage,
    goBack,
    goForward,
    handleZoomIn,
    handleZoomOut,
    handleZoomReset,
    isStandaloneMode,
    searchQuery,
    searchResults,
    handleSearchNextPreview,
    handleSearchPrevPreview,
    handleSearchConfirm,
    showSearchResults,
    setSearchQuery,
    setSearchResults,
    setShowSearchResults,
    setShowStandaloneSearch,
    standaloneSearchInputRef,
    tabs,
    activeTabId,
    addTabFromCurrent,
    closeCurrentTab,
    selectTab,
    toggleBookmark,
    openStandaloneWindow,
    toggleTwoColumn: () => setViewMode((prev) => (prev === 'two-column' ? 'single' : 'two-column')),
    toggleHeader: handleToggleHeader,
    showHeader,
    setShowHeader,
    headerWasHiddenBeforeSearchRef,
    showHeaderTemporarily,
  });

  // Note: loadPdfFromPathInternal and loadPdfFromPath now provided by usePdfLoader hook
  // Note: New PDFs are opened in new windows via the Opened event in Rust (like Preview app).

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
      keysToRemove.forEach(key => localStorage.removeItem(key));

      // Reset current state (including viewMode for full reset)
      resetAllState({ resetViewMode: true });
    }
  }, [resetAllState]);

  // Listen for reset all data request from app menu (main window only)
  useTauriEventListener(
    'reset-all-data-requested',
    handleResetAllData,
    [isStandaloneMode, handleResetAllData]
  );

  // Menu event handlers
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
        filters: [{ name: 'JSON', extensions: ['json'] }]
      });

      if (savePath) {
        await writeTextFile(savePath, JSON.stringify(exportData, null, 2));
        console.log('Session data exported successfully to:', savePath);
      }
    } catch (error) {
      console.error('Failed to export session data:', error);
    }
  }, []);

  const handleImportSession = useCallback(async () => {
    try {
      const importPath = await open({
        title: 'Import Session Data',
        multiple: false,
        filters: [{ name: 'JSON', extensions: ['json'] }]
      });

      if (!importPath) return;

      const jsonString = await readTextFile(importPath as string);
      const importData = JSON.parse(jsonString);

      if (!importData.version || !Array.isArray(importData.sessions)) {
        throw new Error('Invalid session data format');
      }

      const importCount = await importSessions(importData.sessions);
      await confirm(
        `Successfully imported ${importCount} session(s).`,
        { title: 'Import Complete', kind: 'info' }
      );
      console.log('Session data imported successfully:', importCount);
    } catch (error) {
      console.error('Failed to import session data:', error);
      await confirm(
        `Failed to import session data: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { title: 'Import Failed', kind: 'error' }
      );
    }
  }, []);

  const handleOpenRecent = useCallback(async (selectedFilePath: string) => {
    try {
      if (selectedFilePath === filePathRef.current) {
        console.log('File already open, skipping reload');
        return;
      }
      await loadPdfFromPath(selectedFilePath);
    } catch (error) {
      console.error('Failed to open recent file:', error);
    }
  }, [loadPdfFromPath]);

  // Listen for menu events from system menu bar (zoom, view mode, session export/import)
  useTauriEventListeners([
    { event: 'menu-zoom-in', handler: handleZoomIn },
    { event: 'menu-zoom-out', handler: handleZoomOut },
    { event: 'menu-zoom-reset', handler: handleZoomReset },
    { event: 'menu-toggle-two-column', handler: () => setViewMode((prev) => (prev === 'two-column' ? 'single' : 'two-column')) },
    { event: 'menu-toggle-header', handler: handleToggleHeader },
    { event: 'export-session-data-requested', handler: handleExportSession },
    { event: 'import-session-data-requested', handler: handleImportSession },
  ], [handleZoomIn, handleZoomOut, handleZoomReset, handleToggleHeader, handleExportSession, handleImportSession]);

  // Listen for open recent file selection (needs payload access)
  useTauriEventListener<string>(
    'menu-open-recent-selected',
    handleOpenRecent,
    [handleOpenRecent]
  );

  // Application startup logic (standalone mode, CLI file, session restore)
  useStartup({
    setIsStandaloneMode,
    setIsTocOpen,
    setCurrentPage,
    setZoom,
    setViewMode,
    setPdfInfo,
    setBookmarks,
    setPageHistory,
    setHistoryIndex,
    setPendingTabsRestore,
    setPendingActiveTabIndex,
    setPendingWindowsRestore,
    loadPdfFromPathInternal,
    loadPdfFromPath,
    updateNativeWindowTitle,
  });

  // Note: Tab and window restoration are handled via refs to avoid circular dependencies
  const pendingTabsRestoreRef = useRef<{ tabs: TabState[]; activeIndex: number | null } | null>(null);
  const pendingWindowsRestoreRef = useRef<WindowState[] | null>(null);

  // Update refs when pending restore states change
  useEffect(() => {
    if (pendingTabsRestore) {
      pendingTabsRestoreRef.current = { tabs: pendingTabsRestore, activeIndex: pendingActiveTabIndex };
      setPendingTabsRestore(null);
      setPendingActiveTabIndex(null);
    }
  }, [pendingTabsRestore, pendingActiveTabIndex]);

  useEffect(() => {
    if (pendingWindowsRestore) {
      pendingWindowsRestoreRef.current = pendingWindowsRestore;
      setPendingWindowsRestore(null);
    }
  }, [pendingWindowsRestore]);

  const handleOpenFile = useCallback(async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });

      if (selected && typeof selected === 'string') {
        await loadPdfFromPath(selected);
      }
    } catch (error) {
      console.error('Error opening file:', error);
      setIsLoading(false);
    }
  }, [loadPdfFromPath]);

  // Listen for open file menu event (must be after handleOpenFile is defined)
  useTauriEventListener(
    'menu-open-file-requested',
    handleOpenFile,
    [handleOpenFile]
  );

  const handleLoadSuccess = useCallback((numPages: number) => {
    setTotalPages(numPages);
  }, []);

  // Note: Navigation, bookmarks, search, tabs, and window management functions
  // are now provided by custom hooks above

  // Save current session state (debounced)
  const saveCurrentSession = useCallback(() => {
    if (!filePath || isStandaloneMode) return;
    // Don't save during session restoration to prevent overwriting restored data
    if (isRestoringSessionRef.current) return;

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(() => {
      const activeIndex = tabs.findIndex((t) => t.id === activeTabId);
      const savedHistory = pageHistory.slice(-100); // Keep last 100 history entries
      // Adjust historyIndex to match the sliced history
      const overflow = pageHistory.length - 100;
      const adjustedHistoryIndex = overflow > 0 ? Math.max(0, historyIndex - overflow) : historyIndex;
      const state: PdfSessionState = {
        lastOpened: Date.now(),
        page: currentPage,
        zoom,
        viewMode,
        activeTabIndex: activeIndex >= 0 ? activeIndex : null,
        tabs: tabs.map((t) => ({ page: t.page, label: t.label })),
        windows: openWindows.map((w) => ({
          page: w.page,
          zoom: w.zoom,
          viewMode: w.viewMode,
        })),
        bookmarks: bookmarks.map((b) => ({
          page: b.page,
          label: b.label,
          createdAt: b.createdAt,
        })),
        pageHistory: savedHistory,
        historyIndex: Math.min(adjustedHistoryIndex, savedHistory.length - 1),
      };
      // Save to database (async, fire and forget)
      saveSessionState(filePath, state).catch((error) => {
        console.error('Failed to save session state:', error);
      });
    }, 500);
  }, [filePath, isStandaloneMode, currentPage, zoom, viewMode, tabs, activeTabId, openWindows, bookmarks, pageHistory, historyIndex]);

  // Auto-save session on state changes (main window only)
  useEffect(() => {
    if (!isStandaloneMode && filePath) {
      saveCurrentSession();
    }
  }, [currentPage, zoom, viewMode, tabs, activeTabId, openWindows, bookmarks, pageHistory, historyIndex, filePath, isStandaloneMode, saveCurrentSession]);

  // Note: Zoom handlers and keyboard shortcuts are now provided by custom hooks

  // Update document title
  useEffect(() => {
    if (pdfInfo?.title) {
      document.title = `${pdfInfo.title} - Pedaru`;
    } else if (fileName) {
      document.title = `${fileName} - Pedaru`;
    } else {
      document.title = 'Pedaru - PDF Viewer';
    }
  }, [pdfInfo, fileName]);

  // Update standalone window title when page changes
  useEffect(() => {
    if (!isStandaloneMode) return;

    const updateTitle = async () => {
      try {
        const chapter = pdfInfo ? getChapterForPage(currentPage) : undefined;
        const title = chapter ? `${chapter} (Page ${currentPage})` : `Page ${currentPage}`;
        document.title = title;
        const win = getCurrentWebviewWindow();
        await win.setTitle(title);
      } catch (e) {
        console.error('Failed to update window title:', e);
      }
    };

    updateTitle();
  }, [isStandaloneMode, currentPage, pdfInfo, getChapterForPage]);

  // Window event handlers (main window only)
  const handleWindowPageChanged = useCallback((payload: { label: string; page: number }) => {
    if (isStandaloneMode) return;
    const { label, page } = payload;
    const chapter = getChapterForPage(page);
    setOpenWindows(prev => prev.map(w =>
      w.label === label ? { ...w, page, chapter } : w
    ));
    WebviewWindow.getByLabel(label).then(win => {
      if (win) {
        win.setTitle(chapter ? `${chapter} (Page ${page})` : `Page ${page}`).catch(console.warn);
      }
    });
  }, [isStandaloneMode, getChapterForPage]);

  const handleWindowStateChanged = useCallback((payload: { label: string; zoom: number; viewMode: ViewMode }) => {
    if (isStandaloneMode) return;
    const { label, zoom: winZoom, viewMode: winViewMode } = payload;
    setOpenWindows(prev => prev.map(w =>
      w.label === label ? { ...w, zoom: winZoom, viewMode: winViewMode } : w
    ));
  }, [isStandaloneMode]);

  const handleMoveWindowToTab = useCallback((payload: { label: string; page: number }) => {
    if (isStandaloneMode) return;
    const { label, page } = payload;
    setOpenWindows(prev => prev.filter(w => w.label !== label));
    const newId = tabIdRef.current++;
    const chapter = getChapterForPage(page);
    const tabLabel = chapter ? `P${page}: ${chapter}` : `Page ${page}`;
    setTabs(prev => [...prev, { id: newId, page, label: tabLabel }]);
    setActiveTabId(newId);
    setCurrentPage(page);
  }, [isStandaloneMode, getChapterForPage]);

  const handleBookmarkSync = useCallback((payload: { bookmarks: Bookmark[]; sourceLabel: string }) => {
    const myLabel = isStandaloneMode ? getCurrentWebviewWindow().label : 'main';
    const { bookmarks: newBookmarks, sourceLabel } = payload;
    if (sourceLabel === myLabel) return;
    setBookmarks(newBookmarks);
  }, [isStandaloneMode]);

  // Listen for window events using the utility hooks
  useTauriEventListener<{ label: string; page: number }>(
    'window-page-changed',
    handleWindowPageChanged,
    [handleWindowPageChanged]
  );

  useTauriEventListener<{ label: string; zoom: number; viewMode: ViewMode }>(
    'window-state-changed',
    handleWindowStateChanged,
    [handleWindowStateChanged]
  );

  useTauriEventListener<{ label: string; page: number }>(
    'move-window-to-tab',
    handleMoveWindowToTab,
    [handleMoveWindowToTab]
  );

  useTauriEventListener<{ bookmarks: Bookmark[]; sourceLabel: string }>(
    'bookmark-sync',
    handleBookmarkSync,
    [handleBookmarkSync]
  );

  // Emit state changes from standalone windows to main window
  useEffect(() => {
    if (!isStandaloneMode) return;

    const win = getCurrentWebviewWindow();
    emit('window-state-changed', {
      label: win.label,
      zoom,
      viewMode,
    }).catch(console.warn);
  }, [isStandaloneMode, zoom, viewMode]);


  // Show sidebar in main window for all sidebar types, or in standalone for ToC/History/Bookmarks
  const showSidebar = isStandaloneMode
    ? (isTocOpen || showHistory || showBookmarks)
    : (isTocOpen || showHistory || showBookmarks || showWindows);

  return (
    <main className="flex flex-col h-screen bg-bg-primary relative group">
      {!isStandaloneMode && showHeader && (
        <Header
          fileName={fileName}
          pdfTitle={pdfInfo?.title || null}
          currentPage={currentPage}
          totalPages={totalPages}
          zoom={zoom}
          viewMode={viewMode}
          isLoading={isLoading}
          showHistory={showHistory}
          showBookmarks={showBookmarks}
          searchQuery={searchQuery}
          searchResultCount={searchResults.length}
          currentSearchIndex={currentSearchIndex}
          onOpenFile={handleOpenFile}
          onPrevPage={goToPrevPage}
          onNextPage={goToNextPage}
          onPageChange={goToPage}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onToggleToc={() => setIsTocOpen(!isTocOpen)}
          onViewModeChange={setViewMode}
          onToggleHistory={() => setShowHistory((prev) => !prev)}
          onToggleWindows={() => setShowWindows((prev) => !prev)}
          onToggleBookmarks={() => setShowBookmarks((prev) => !prev)}
          onSearchChange={handleSearchChange}
          onSearchPrev={handleSearchPrev}
          onSearchNext={handleSearchNext}
          windowCount={openWindows.length}
          tabCount={tabs.length}
          bookmarkCount={bookmarks.length}
          onCloseAllWindows={closeAllWindows}
          showWindows={showWindows}
        />
      )}

      {/* Tabs bar - shows when tabs exist OR when windows exist (for drop target) */}
      {!isStandaloneMode && showHeader && (tabs.length > 0 || openWindows.length > 0) && (
        <div
          className="flex items-center gap-2 px-4 py-2 bg-bg-secondary border-b border-bg-tertiary min-h-[44px] overflow-x-auto scrollbar-thin scrollbar-thumb-bg-tertiary scrollbar-track-transparent"
          onDragOver={(e) => {
            // Accept window drops
            if (e.dataTransfer.types.includes('application/x-pedaru-window')) {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
            }
          }}
          onDrop={(e) => {
            const windowData = e.dataTransfer.getData('application/x-pedaru-window');
            if (windowData) {
              e.preventDefault();
              try {
                const { label, page } = JSON.parse(windowData);
                moveWindowToTab(label, page);
              } catch (err) {
                console.warn('Failed to parse window data', err);
              }
            }
          }}
        >
          {tabs.length === 0 && openWindows.length > 0 && (
            <span
              className="text-text-secondary text-sm flex-1 py-2"
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes('application/x-pedaru-window')) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                }
              }}
              onDrop={(e) => {
                const windowData = e.dataTransfer.getData('application/x-pedaru-window');
                if (windowData) {
                  e.preventDefault();
                  try {
                    const { label, page } = JSON.parse(windowData);
                    moveWindowToTab(label, page);
                  } catch (err) {
                    console.warn('Failed to parse window data', err);
                  }
                }
              }}
            >
              Drag windows here to create tabs
            </span>
          )}
          {tabs.map((tab) => (
            <div
              key={tab.id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('application/x-pedaru-tab', JSON.stringify({ id: tab.id, page: tab.page }));
              }}
              onDragOver={(e) => {
                // Accept window drops on tabs
                if (e.dataTransfer.types.includes('application/x-pedaru-window')) {
                  e.preventDefault();
                  e.stopPropagation();
                  e.dataTransfer.dropEffect = 'move';
                }
              }}
              onDrop={(e) => {
                // Handle window drops on tabs
                const windowData = e.dataTransfer.getData('application/x-pedaru-window');
                if (windowData) {
                  e.preventDefault();
                  e.stopPropagation();
                  try {
                    const { label, page } = JSON.parse(windowData);
                    moveWindowToTab(label, page);
                  } catch (err) {
                    console.warn('Failed to parse window data', err);
                  }
                }
              }}
              onDragEnd={(e) => {
                // Check if dropped outside the tabs bar (open as window)
                const rect = e.currentTarget.parentElement?.getBoundingClientRect();
                if (rect && (e.clientY < rect.top - 50 || e.clientY > rect.bottom + 50 || e.clientX < rect.left - 50 || e.clientX > rect.right + 50)) {
                  // Dropped outside - open as standalone window and remove tab
                  openStandaloneWindow(tab.page);
                  setTabs(prev => prev.filter(t => t.id !== tab.id));
                  if (activeTabId === tab.id) {
                    const remaining = tabs.filter(t => t.id !== tab.id);
                    if (remaining.length > 0) {
                      setActiveTabId(remaining[0].id);
                      goToPage(remaining[0].page);
                    } else {
                      setActiveTabId(null);
                    }
                  }
                }
              }}
              onClick={() => selectTab(tab.id)}
              className={`group/tab flex items-center gap-1 pl-3 pr-1.5 py-1.5 rounded-lg text-sm transition-colors cursor-grab active:cursor-grabbing max-w-[220px] shrink-0 ${
                activeTabId === tab.id ? 'bg-accent text-white' : 'bg-bg-tertiary hover:bg-bg-hover text-text-primary'
              }`}
              title={`${tab.label} - Drag outside to open in new window`}
            >
              <span className="truncate">{tab.label}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const tabIndex = tabs.findIndex((t) => t.id === tab.id);
                  const newTabs = tabs.filter((t) => t.id !== tab.id);
                  setTabs(newTabs);
                  if (activeTabId === tab.id && newTabs.length > 0) {
                    const newIndex = Math.min(tabIndex, newTabs.length - 1);
                    setActiveTabId(newTabs[newIndex].id);
                    navigateToPageWithoutTabUpdate(newTabs[newIndex].page);
                  } else if (newTabs.length === 0) {
                    setActiveTabId(null);
                    closePdf();
                  }
                }}
                className={`p-0.5 rounded opacity-0 group-hover/tab:opacity-100 transition-opacity ${
                  activeTabId === tab.id ? 'hover:bg-white/20' : 'hover:bg-bg-tertiary'
                }`}
                title="Close tab"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Standalone mode: Floating navigation */}
      {isStandaloneMode && totalPages > 0 && (
        <div className="absolute top-4 right-4 z-10 flex items-center gap-2 bg-bg-secondary/95 backdrop-blur-sm px-4 py-2 rounded-lg shadow-lg border border-bg-tertiary transition-opacity duration-150 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto">
          {/* History back/forward */}
          <button
            onClick={goBack}
            disabled={!canGoBack}
            className="p-1.5 rounded hover:bg-bg-tertiary text-text-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title="Back"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <button
            onClick={goForward}
            disabled={!canGoForward}
            className="p-1.5 rounded hover:bg-bg-tertiary text-text-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title="Forward"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
          <button
            onClick={goToPrevPage}
            disabled={currentPage <= 1}
            className="p-1.5 rounded hover:bg-bg-tertiary text-text-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title="Previous Page (←)"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          
          <span className="text-text-primary text-sm font-medium min-w-[80px] text-center">
            {currentPage} / {totalPages}
          </span>
          
          <button
            onClick={goToNextPage}
            disabled={currentPage >= totalPages}
            className="p-1.5 rounded hover:bg-bg-tertiary text-text-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title="Next Page (→)"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>

          {/* ToC toggle for standalone window */}
          <button
            onClick={() => setIsTocOpen((prev) => !prev)}
            className={`ml-2 p-1.5 rounded hover:bg-bg-tertiary text-text-primary transition-colors ${isTocOpen ? 'text-accent' : ''}`}
            title={isTocOpen ? 'Hide Table of Contents' : 'Show Table of Contents'}
            aria-label={isTocOpen ? 'Hide Table of Contents' : 'Show Table of Contents'}
          >
            <List className="w-5 h-5" />
          </button>

          {/* View mode toggle for standalone window */}
          <button
            onClick={() => setViewMode(prev => (prev === 'two-column' ? 'single' : 'two-column'))}
            className="p-1.5 rounded hover:bg-bg-tertiary text-text-primary transition-colors"
            title={viewMode === 'two-column' ? 'Switch to Single Page' : 'Switch to Two-Column'}
          >
            <Columns className={`w-5 h-5 ${viewMode === 'two-column' ? 'text-accent' : ''}`} />
          </button>

          {/* History toggle next to view mode */}
          <button
            onClick={() => setShowHistory((prev) => !prev)}
            className={`p-1.5 rounded hover:bg-bg-tertiary text-text-primary transition-colors ${showHistory ? 'text-accent' : ''}`}
            title={showHistory ? 'Hide History' : 'Show History'}
            aria-label={showHistory ? 'Hide History' : 'Show History'}
          >
            <History className="w-5 h-5" />
          </button>

          {/* Bookmark toggle for standalone window */}
          <button
            onClick={toggleBookmark}
            className={`relative p-1.5 rounded hover:bg-bg-tertiary transition-colors ${isCurrentPageBookmarked ? 'text-yellow-500' : 'text-text-primary'}`}
            title={isCurrentPageBookmarked ? 'Remove Bookmark' : 'Add Bookmark'}
            aria-label={isCurrentPageBookmarked ? 'Remove Bookmark' : 'Add Bookmark'}
          >
            <BookmarkIcon className={`w-5 h-5 ${isCurrentPageBookmarked ? 'fill-yellow-500' : ''}`} />
            {bookmarks.length > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] flex items-center justify-center bg-yellow-500 text-white text-[10px] font-bold rounded-full px-0.5">
                {bookmarks.length > 99 ? '99+' : bookmarks.length}
              </span>
            )}
          </button>

          {/* Zoom controls for standalone window */}
          <div className="ml-2 flex items-center gap-2">
            <button
              onClick={handleZoomOut}
              className="p-1.5 rounded hover:bg-bg-tertiary text-text-primary transition-colors"
              title="Zoom Out"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 12H5" />
              </svg>
            </button>
            <span className="text-text-primary text-sm min-w-[50px] text-center">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={handleZoomIn}
              className="p-1.5 rounded hover:bg-bg-tertiary text-text-primary transition-colors"
              title="Zoom In"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14M19 12H5" />
              </svg>
            </button>
          </div>

          {/* Text search for standalone window */}
          <div className="ml-2 flex items-center gap-1">
            {showStandaloneSearch ? (
              <div className="flex items-center gap-1 bg-bg-primary rounded-md px-2 py-1">
                <Search className="w-4 h-4 text-text-secondary" />
                <input
                  ref={standaloneSearchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setShowStandaloneSearch(false);
                      setSearchQuery('');
                    }
                  }}
                  placeholder="Search in page..."
                  className="w-32 bg-transparent text-sm text-text-primary placeholder-text-secondary outline-none"
                  autoFocus
                />
                <button
                  onClick={() => {
                    setShowStandaloneSearch(false);
                    setSearchQuery('');
                  }}
                  className="p-0.5 rounded hover:bg-bg-tertiary text-text-secondary hover:text-text-primary transition-colors"
                  title="Close search"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => {
                  setShowStandaloneSearch(true);
                  setTimeout(() => standaloneSearchInputRef.current?.focus(), 0);
                }}
                className="p-1.5 rounded hover:bg-bg-tertiary text-text-primary transition-colors"
                title="Search in page (Cmd/Ctrl+F)"
              >
                <Search className="w-5 h-5" />
              </button>
            )}
          </div>

          {/* Move to Tab button */}
          <button
            onClick={async () => {
              const win = getCurrentWebviewWindow();
              // Emit event to main window to create a tab
              await emit('move-window-to-tab', {
                label: win.label,
                page: currentPage,
              });
              // Close this window
              await win.close();
            }}
            className="ml-2 p-1.5 rounded bg-accent hover:bg-accent/80 text-white transition-colors"
            title="Move to Tab"
          >
            <PanelTop className="w-5 h-5" />
          </button>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Side column for TOC (top) and History (bottom) in main mode, shown only when needed */}
        {showSidebar && (
          <div
            className="flex flex-col overflow-hidden shrink-0 border-r border-bg-tertiary bg-bg-secondary relative"
            style={{ width: sidebarWidth, minWidth: 220, maxWidth: 600 }}
          >
            {/* Resize handle */}
            <div
              className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-accent/50 active:bg-accent z-10"
              onMouseDown={(e) => {
                e.preventDefault();
                const startX = e.clientX;
                const startWidth = sidebarWidth;
                const handleMouseMove = (moveEvent: MouseEvent) => {
                  const newWidth = startWidth + (moveEvent.clientX - startX);
                  setSidebarWidth(Math.max(220, Math.min(600, newWidth)));
                };
                const handleMouseUp = () => {
                  document.removeEventListener('mousemove', handleMouseMove);
                  document.removeEventListener('mouseup', handleMouseUp);
                };
                document.addEventListener('mousemove', handleMouseMove);
                document.addEventListener('mouseup', handleMouseUp);
              }}
            />
            {isTocOpen && (
              <div className="flex-[2] min-h-[200px] max-h-[60vh] overflow-auto border-b border-bg-tertiary resize-y">
                <TocSidebar
                  toc={pdfInfo?.toc || []}
                  currentPage={currentPage}
                  isOpen={isTocOpen}
                  onPageSelect={goToPage}
                />
              </div>
            )}
            {showWindows && (
              <div className="flex-1 min-h-[100px] max-h-[40vh] overflow-auto border-b border-bg-tertiary resize-y">
                <WindowSidebar
                  windows={openWindows}
                  currentPage={currentPage}
                  onFocus={focusWindow}
                  onClose={(label) => {
                    closeWindow(label);
                    setOpenWindows((prev) => prev.filter((w) => w.label !== label));
                  }}
                  onMoveToTab={(label, page) => moveWindowToTab(label, page)}
                />
              </div>
            )}
            {showHistory && (
              <div className="flex-1 min-h-[100px] max-h-[40vh] overflow-auto border-b border-bg-tertiary resize-y">
                <HistorySidebar
                  history={pageHistory}
                  index={historyIndex}
                  currentPage={currentPage}
                  onSelect={(p) => goToPage(p)}
                  onClear={() => {
                    setPageHistory([]);
                    setHistoryIndex(-1);
                  }}
                />
              </div>
            )}
            {showBookmarks && (
              <div className="flex-1 min-h-[100px] max-h-[40vh] overflow-auto border-b border-bg-tertiary resize-y">
                <BookmarkSidebar
                  bookmarks={bookmarks}
                  currentPage={currentPage}
                  onSelect={(p) => goToPage(p)}
                  onRemove={removeBookmark}
                  onClear={clearBookmarks}
                />
              </div>
            )}
          </div>
        )}

        {/* Main viewer */}
        <div className="flex-1 min-w-0 relative flex flex-col">
          <PdfViewer
            fileData={fileData}
            currentPage={currentPage}
            totalPages={totalPages}
            zoom={zoom}
            viewMode={viewMode}
            filePath={filePath}
            searchQuery={searchQuery}
            focusedSearchPage={searchResults[currentSearchIndex]?.page}
            focusedSearchMatchIndex={searchResults[currentSearchIndex]?.matchIndex}
            bookmarkedPages={bookmarks.map(b => b.page)}
            onToggleBookmark={(page) => {
              const existingIndex = bookmarks.findIndex((b) => b.page === page);
              if (existingIndex >= 0) {
                setBookmarks((prev) => prev.filter((b) => b.page !== page));
              } else {
                const chapter = getChapterForPage(page);
                const label = chapter ? `P${page}: ${chapter}` : `Page ${page}`;
                setBookmarks((prev) => [...prev, { page, label, createdAt: Date.now() }]);
              }
            }}
            onLoadSuccess={handleLoadSuccess}
            onDocumentLoad={handlePdfDocumentLoad}
            onNavigatePage={(page) => {
              goToPage(page);
            }}
          />
        </div>

        {/* Search results sidebar on the right */}
        {showSearchResults && (
          <SearchResultsSidebar
            query={searchQuery}
            results={searchResults}
            currentIndex={currentSearchIndex}
            isSearching={isSearching}
            onSelect={(index) => {
              setCurrentSearchIndex(index);
              // Switch to single page mode only in standalone window
              if (isStandaloneMode) {
                setViewMode('single');
              }
              goToPage(searchResults[index].page);
            }}
            onOpenInWindow={(page) => openStandaloneWindow(page)}
            onClose={() => {
              setShowSearchResults(false);
              setSearchQuery('');
              setSearchResults([]);
            }}
          />
        )}
      </div>
    </main>
  );
}
