/**
 * Centralized type definitions for Pedaru
 * All shared types should be imported from this file
 */

// Re-export PDF-related types
export type { PdfInfo, TocEntry } from './pdf';

// ============================================
// View Mode
// ============================================

/**
 * PDF display mode
 */
export type ViewMode = 'single' | 'two-column';

// ============================================
// Bookmark Types
// ============================================

/**
 * Represents a bookmark in the PDF viewer
 */
export interface Bookmark {
  page: number;
  label: string;
  createdAt: number;
}

/**
 * Bookmark state for database storage (alias for Bookmark)
 */
export type BookmarkState = Bookmark;

// ============================================
// Search Types
// ============================================

/**
 * Represents a search result with context
 */
export interface SearchResult {
  page: number;
  matchIndex: number;
  contextBefore: string;
  matchText: string;
  contextAfter: string;
}

// ============================================
// Tab Types
// ============================================

/**
 * Tab state for database storage
 */
export interface TabState {
  page: number;
  label: string;
}

/**
 * Represents an active tab in the main window
 */
export interface Tab {
  id: number;
  page: number;
  label: string;
}

// ============================================
// Window Types
// ============================================

/**
 * Window state for database storage
 */
export interface WindowState {
  page: number;
  zoom: number;
  viewMode: ViewMode;
}

/**
 * Represents an open standalone window with its current state
 */
export interface OpenWindow {
  page: number;
  label: string;
  chapter?: string;
  zoom: number;
  viewMode: ViewMode;
}

// ============================================
// History Types
// ============================================

/**
 * Represents an entry in the page navigation history
 */
export interface HistoryEntry {
  page: number;
  timestamp: string;
}

// ============================================
// Session Types
// ============================================

/**
 * Complete session state for a PDF document
 */
export interface PdfSessionState {
  filePath?: string;
  name?: string;
  lastOpened: number;
  page: number;
  zoom: number;
  viewMode: ViewMode;
  activeTabIndex: number | null;
  tabs: TabState[];
  windows: WindowState[];
  bookmarks: BookmarkState[];
  pageHistory?: HistoryEntry[];
  historyIndex?: number;
}
