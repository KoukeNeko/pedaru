/**
 * Utility functions for formatting
 */

/**
 * Formats a timestamp as a short date/time string (M/D HH:mm)
 * @param timestamp - Unix timestamp in milliseconds
 * @returns Formatted date string
 *
 * @example
 * formatDateTime(1703123456789) // "12/21 10:30"
 */
export function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${month}/${day} ${hours}:${minutes}`;
}

/**
 * Generates a tab label from page number and optional chapter title
 * @param page - The page number
 * @param chapter - Optional chapter title
 * @returns Formatted tab label
 *
 * @example
 * getTabLabel(5, "Introduction") // "P5: Introduction"
 * getTabLabel(5) // "Page 5"
 */
export function getTabLabel(page: number, chapter?: string | null): string {
  if (chapter) {
    return `P${page}: ${chapter}`;
  }
  return `Page ${page}`;
}

/**
 * Generates a window title from page number and optional chapter title
 * @param page - The page number
 * @param chapter - Optional chapter title
 * @returns Formatted window title
 *
 * @example
 * getWindowTitle(5, "Introduction") // "Introduction (Page 5)"
 * getWindowTitle(5) // "Page 5"
 */
export function getWindowTitle(page: number, chapter?: string | null): string {
  if (chapter) {
    return `${chapter} (Page ${page})`;
  }
  return `Page ${page}`;
}

/**
 * Caps an array to a maximum length, removing oldest entries first
 * @param array - The array to cap
 * @param maxLength - Maximum number of elements to keep
 * @returns A new array with at most maxLength elements
 *
 * @example
 * capArrayLength([1, 2, 3, 4, 5], 3) // [3, 4, 5]
 */
export function capArrayLength<T>(array: T[], maxLength: number): T[] {
  if (array.length <= maxLength) {
    return array;
  }
  const overflow = array.length - maxLength;
  return array.slice(overflow);
}
