'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  WebviewWindow,
  getCurrentWebviewWindow,
} from '@tauri-apps/api/webviewWindow';
import { emit } from '@tauri-apps/api/event';

// Merge zone distance threshold in pixels
const MERGE_THRESHOLD_PX = 100;
// Wait time in ms before triggering merge (stability check)
const STABILITY_DELAY_MS = 200;

interface PhysicalPosition {
  x: number;
  y: number;
}

interface PhysicalSize {
  width: number;
  height: number;
}

/**
 * Custom hook for detecting window proximity and triggering auto-merge
 *
 * Used in standalone windows to detect when they are dragged close to the main window.
 * When a standalone window is positioned near the main window and stays stable for
 * STABILITY_DELAY_MS, it automatically merges as a tab.
 *
 * @param currentPage - Current page number in the standalone window
 * @param isStandaloneMode - Whether the window is in standalone mode
 * @returns Object containing isInMergeZone state
 */
export function useWindowProximityMerge(
  currentPage: number,
  isStandaloneMode: boolean
) {
  const [isInMergeZone, setIsInMergeZone] = useState(false);
  const stabilityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasInMergeZoneRef = useRef(false);
  const isMergingRef = useRef(false);

  /**
   * Calculate if standalone window overlaps with main window bounds (with threshold)
   */
  const checkProximity = useCallback(async (): Promise<boolean> => {
    if (!isStandaloneMode) return false;

    try {
      const mainWindow = await WebviewWindow.getByLabel('main');
      if (!mainWindow) return false;

      const currentWindow = getCurrentWebviewWindow();

      const [mainPos, mainSize, standPos, standSize] = await Promise.all([
        mainWindow.outerPosition(),
        mainWindow.outerSize(),
        currentWindow.outerPosition(),
        currentWindow.outerSize(),
      ]);

      // Expand main window bounds by threshold
      const mainRight = mainPos.x + mainSize.width + MERGE_THRESHOLD_PX;
      const mainBottom = mainPos.y + mainSize.height + MERGE_THRESHOLD_PX;
      const mainLeft = mainPos.x - MERGE_THRESHOLD_PX;
      const mainTop = mainPos.y - MERGE_THRESHOLD_PX;

      const standRight = standPos.x + standSize.width;
      const standBottom = standPos.y + standSize.height;

      // Check for overlap with expanded bounds
      const overlaps = !(
        standPos.x > mainRight ||
        standRight < mainLeft ||
        standPos.y > mainBottom ||
        standBottom < mainTop
      );

      return overlaps;
    } catch (e) {
      console.warn('Failed to check proximity:', e);
      return false;
    }
  }, [isStandaloneMode]);

  /**
   * Trigger merge: emit event and close window
   */
  const triggerMerge = useCallback(async () => {
    if (isMergingRef.current) return;
    isMergingRef.current = true;

    try {
      const currentWindow = getCurrentWebviewWindow();
      await emit('move-window-to-tab', {
        label: currentWindow.label,
        page: currentPage,
      });
      await currentWindow.close();
    } catch (e) {
      console.error('Failed to trigger merge:', e);
      isMergingRef.current = false;
    }
  }, [currentPage]);

  // Set up window move listener
  useEffect(() => {
    if (!isStandaloneMode) return;

    let unlistenFn: (() => void) | null = null;
    const currentWindow = getCurrentWebviewWindow();

    const setupListener = async () => {
      unlistenFn = await currentWindow.onMoved(async () => {
        // Clear any pending stability check
        if (stabilityTimerRef.current) {
          clearTimeout(stabilityTimerRef.current);
          stabilityTimerRef.current = null;
        }

        // Schedule stability check after delay
        stabilityTimerRef.current = setTimeout(async () => {
          const inZone = await checkProximity();
          setIsInMergeZone(inZone);

          // Emit events for main window UI feedback
          if (inZone && !wasInMergeZoneRef.current) {
            emit('standalone-entering-merge-zone', {
              label: currentWindow.label,
              page: currentPage,
            }).catch(console.warn);
          } else if (!inZone && wasInMergeZoneRef.current) {
            emit('standalone-leaving-merge-zone', {
              label: currentWindow.label,
            }).catch(console.warn);
          }
          wasInMergeZoneRef.current = inZone;

          // Trigger merge if stable in zone
          if (inZone) {
            triggerMerge();
          }
        }, STABILITY_DELAY_MS);
      });
    };

    setupListener();

    return () => {
      if (stabilityTimerRef.current) {
        clearTimeout(stabilityTimerRef.current);
      }
      unlistenFn?.();
    };
  }, [isStandaloneMode, currentPage, checkProximity, triggerMerge]);

  // Emit leaving event on unmount if was in merge zone
  useEffect(() => {
    return () => {
      if (wasInMergeZoneRef.current && isStandaloneMode) {
        const currentWindow = getCurrentWebviewWindow();
        emit('standalone-leaving-merge-zone', {
          label: currentWindow.label,
        }).catch(console.warn);
      }
    };
  }, [isStandaloneMode]);

  return { isInMergeZone };
}
