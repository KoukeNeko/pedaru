/**
 * Zoom configuration and utility functions
 * Provides consistent zoom behavior across keyboard shortcuts and menu actions
 */

export const ZOOM_CONFIG = {
  /** Minimum zoom level */
  min: 0.25,
  /** Maximum zoom level */
  max: 4.0,
  /** Zoom step increment */
  step: 0.25,
  /** Default zoom level */
  default: 1.0,
} as const;

/**
 * Clamp zoom value to valid range
 */
export function clampZoom(zoom: number): number {
  return Math.max(ZOOM_CONFIG.min, Math.min(ZOOM_CONFIG.max, zoom));
}

/**
 * Increase zoom by one step
 */
export function zoomIn(current: number): number {
  return clampZoom(current + ZOOM_CONFIG.step);
}

/**
 * Decrease zoom by one step
 */
export function zoomOut(current: number): number {
  return clampZoom(current - ZOOM_CONFIG.step);
}

/**
 * Reset zoom to default value
 */
export function resetZoom(): number {
  return ZOOM_CONFIG.default;
}
