'use client';

import { useState, useCallback, useRef } from 'react';
import type { TextSelection } from '@/types';

/**
 * Hook for detecting and managing PDF text selection
 *
 * Translation is triggered manually via Cmd+J, not automatically on selection.
 *
 * @param pdfDocRef - Ref to the PDF document proxy from pdf.js
 * @param currentPage - The current page number
 * @param totalPages - Total number of pages in the document
 * @returns Selection data, clear function, and trigger function
 */
export function useTextSelection(
  pdfDocRef: React.MutableRefObject<any>,
  currentPage: number,
  totalPages: number
) {
  const [selection, setSelection] = useState<TextSelection | null>(null);
  const [autoExplain, setAutoExplain] = useState(false);
  const pageTextCacheRef = useRef<Map<number, string>>(new Map());

  // Clear selection
  const clearSelection = useCallback(() => {
    setSelection(null);
    setAutoExplain(false);
  }, []);

  // Get text content from a page
  const getPageText = useCallback(
    async (pageNum: number): Promise<string> => {
      // Check cache first
      const cached = pageTextCacheRef.current.get(pageNum);
      if (cached !== undefined) {
        return cached;
      }

      const pdfDocument = pdfDocRef.current;
      if (!pdfDocument || pageNum < 1 || pageNum > totalPages) {
        return '';
      }

      try {
        if (pdfDocument._transport?.destroyed) {
          return '';
        }

        const page = await pdfDocument.getPage(pageNum);
        const textContent = await page.getTextContent();
        const text = textContent.items
          .filter((item: any) => 'str' in item)
          .map((item: any) => item.str)
          .join(' ');

        // Cache the result
        pageTextCacheRef.current.set(pageNum, text);
        return text;
      } catch (error) {
        console.warn('Failed to get page text:', error);
        return '';
      }
    },
    [pdfDocRef, totalPages]
  );

  // Get surrounding context for the selection
  const getContext = useCallback(
    async (selectedText: string, pageNum: number): Promise<string> => {
      const contextLength = 500; // Characters before/after

      // Get text from current page and adjacent pages
      const prevPageText =
        pageNum > 1 ? await getPageText(pageNum - 1) : '';
      const currentPageText = await getPageText(pageNum);
      const nextPageText =
        pageNum < totalPages ? await getPageText(pageNum + 1) : '';

      // Combine texts
      const fullText = [prevPageText, currentPageText, nextPageText].join(' ');

      // Find the selection position in the text
      const selectionIndex = fullText.indexOf(selectedText);
      if (selectionIndex === -1) {
        // If exact match not found, just return current page text as context
        return currentPageText.slice(0, contextLength * 2);
      }

      // Extract context around the selection
      const startIndex = Math.max(0, selectionIndex - contextLength);
      const endIndex = Math.min(
        fullText.length,
        selectionIndex + selectedText.length + contextLength
      );

      let context = fullText.slice(startIndex, endIndex);

      // Add ellipsis if truncated
      if (startIndex > 0) {
        context = '...' + context;
      }
      if (endIndex < fullText.length) {
        context = context + '...';
      }

      return context;
    },
    [getPageText, totalPages]
  );

  // Determine if selection is a single word
  const isWordSelection = useCallback((text: string): boolean => {
    const trimmed = text.trim();

    // Check if text contains spaces or is very short
    if (!trimmed.includes(' ') && trimmed.length <= 30) {
      // Also check for punctuation that indicates sentences
      const sentencePunctuation = /[.!?;:,。、！？；：，]/;
      if (!sentencePunctuation.test(trimmed)) {
        return true;
      }
    }

    return false;
  }, []);

  // Manually trigger translation for current selection (called by Cmd+J or Cmd+E)
  const triggerTranslation = useCallback(async (withExplanation: boolean = false) => {
    const windowSelection = window.getSelection();
    if (!windowSelection || windowSelection.isCollapsed) {
      return;
    }

    const selectedText = windowSelection.toString().trim();
    if (!selectedText || selectedText.length === 0) {
      return;
    }

    // Check if selection is within the PDF viewer
    const range = windowSelection.getRangeAt(0);
    const container = range.commonAncestorContainer;
    const pdfViewer = document.getElementById('pdf-viewer-container');
    if (!pdfViewer || !pdfViewer.contains(container as Node)) {
      return;
    }

    // Determine if word or sentence
    const isWord = isWordSelection(selectedText);

    // Get position for popup
    const rect = range.getBoundingClientRect();
    const position = {
      x: rect.left + rect.width / 2,
      y: rect.bottom + 10,
    };

    // Set auto-explain flag if Cmd+E was used
    setAutoExplain(withExplanation);

    // Show popup immediately with loading state
    setSelection({
      selectedText,
      context: '',
      isWord,
      position,
      contextLoading: true,
    });

    // Get context asynchronously and update
    const context = await getContext(selectedText, currentPage);
    setSelection({
      selectedText,
      context,
      isWord,
      position,
      contextLoading: false,
    });
  }, [currentPage, getContext, isWordSelection]);

  // Trigger translation with auto-explanation (called by Cmd+E)
  const triggerExplanation = useCallback(async () => {
    await triggerTranslation(true);
  }, [triggerTranslation]);

  // Clear cache
  const clearCache = useCallback(() => {
    pageTextCacheRef.current.clear();
  }, []);

  return {
    selection,
    autoExplain,
    clearSelection,
    triggerTranslation,
    triggerExplanation,
    clearCache,
  };
}
