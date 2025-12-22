'use client';

import { type ReactNode } from 'react';

interface SidebarContainerProps {
  /**
   * Header content to display at the top of the sidebar
   */
  header: ReactNode;
  /**
   * Main content of the sidebar
   */
  children: ReactNode;
  /**
   * Optional className for the sidebar container
   */
  className?: string;
  /**
   * Width class for the sidebar
   * @default 'w-64'
   */
  width?: string;
}

/**
 * Reusable sidebar container component with consistent styling.
 * Used by all sidebar components (TOC, History, Bookmarks, Windows).
 */
export function SidebarContainer({
  header,
  children,
  className = '',
  width = 'w-64',
}: SidebarContainerProps) {
  return (
    <aside
      className={`${width} shrink-0 border-r border-bg-tertiary bg-bg-secondary overflow-auto flex flex-col ${className}`}
    >
      <div className="px-3 py-2 border-b border-bg-tertiary shrink-0">
        {header}
      </div>
      <div className="flex-1 overflow-y-auto">
        {children}
      </div>
    </aside>
  );
}
