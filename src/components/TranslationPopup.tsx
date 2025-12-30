'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Loader2, Languages, AlertCircle, Settings, GripHorizontal, ChevronDown, ChevronUp, Sparkles, BookOpen, MessageSquare, Cpu } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import type { TextSelection, GeminiSettings, TranslationResponse } from '@/types';
import { translateWithGemini, explainTranslation, isGeminiConfigured, getGeminiSettings, GEMINI_MODELS } from '@/lib/settings';

interface TranslationPopupProps {
  selection: TextSelection;
  autoExplain?: boolean;
  onClose: () => void;
  onOpenSettings?: () => void;
}

// Custom components for ReactMarkdown to render ***text*** with yellow highlight
const markdownComponents = {
  // ***text*** renders as <strong><em>text</em></strong>
  // We style strong > em with yellow highlight
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-bold">
      {children}
    </strong>
  ),
  em: ({ children }: { children?: React.ReactNode }) => (
    <mark className="bg-yellow-500/30 text-yellow-200 font-bold px-0.5 rounded not-italic">
      {children}
    </mark>
  ),
  p: ({ children }: { children?: React.ReactNode }) => (
    <span>{children}</span>
  ),
};

// Collapsible section component
function CollapsibleSection({
  title,
  icon: Icon,
  children,
  defaultOpen = true,
}: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border border-bg-tertiary rounded-lg overflow-hidden mb-2">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-3 py-2 flex items-center justify-between bg-bg-tertiary/50 hover:bg-bg-tertiary transition-colors"
      >
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-accent" />
          <span className="text-sm font-medium text-text-primary">{title}</span>
        </div>
        {isOpen ? (
          <ChevronUp className="w-4 h-4 text-text-tertiary" />
        ) : (
          <ChevronDown className="w-4 h-4 text-text-tertiary" />
        )}
      </button>
      {isOpen && (
        <div className="px-3 py-2 bg-bg-primary/30">
          {children}
        </div>
      )}
    </div>
  );
}

export default function TranslationPopup({
  selection,
  autoExplain = false,
  onClose,
  onOpenSettings,
}: TranslationPopupProps) {
  const [translationResponse, setTranslationResponse] = useState<TranslationResponse | null>(null);
  const [explanationPoints, setExplanationPoints] = useState<string[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isExplaining, setIsExplaining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isConfigured, setIsConfigured] = useState(true);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showContext, setShowContext] = useState(false);
  const [geminiSettings, setGeminiSettingsState] = useState<GeminiSettings | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; popupX: number; popupY: number } | null>(null);

  // Calculate initial popup position
  const calculateInitialPosition = useCallback(() => {
    const { x, y } = selection.position;
    const popupWidth = 600;
    const popupMaxHeight = 700;
    const margin = 10;
    const headerHeight = 56; // h-14 = 56px
    const minTop = headerHeight + margin; // Ensure popup doesn't overlap with header

    let left = x - popupWidth / 2;
    if (left < margin) {
      left = margin;
    } else if (left + popupWidth > window.innerWidth - margin) {
      left = window.innerWidth - popupWidth - margin;
    }

    let top = y;
    // First, ensure popup doesn't go below viewport
    if (top + popupMaxHeight > window.innerHeight - margin) {
      top = selection.position.y - popupMaxHeight - 40;
    }
    // Then, ensure popup doesn't overlap with header (this takes priority)
    if (top < minTop) {
      top = minTop;
    }

    return { left, top };
  }, [selection.position]);

  const getPosition = useCallback(() => {
    const initial = calculateInitialPosition();
    const headerHeight = 56; // h-14 = 56px
    const margin = 10;
    const minTop = headerHeight + margin;

    if (dragOffset) {
      const newTop = initial.top + dragOffset.y;
      return {
        left: initial.left + dragOffset.x,
        // Ensure popup doesn't overlap with header even after dragging
        top: Math.max(newTop, minTop),
      };
    }
    return initial;
  }, [calculateInitialPosition, dragOffset]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-drag-handle]')) {
      e.preventDefault();
      const position = getPosition();
      dragStartRef.current = {
        mouseX: e.clientX,
        mouseY: e.clientY,
        popupX: position.left,
        popupY: position.top,
      };
      setIsDragging(true);
    }
  }, [getPosition]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStartRef.current) return;

      const deltaX = e.clientX - dragStartRef.current.mouseX;
      const deltaY = e.clientY - dragStartRef.current.mouseY;
      const initial = calculateInitialPosition();

      setDragOffset({
        x: dragStartRef.current.popupX - initial.left + deltaX,
        y: dragStartRef.current.popupY - initial.top + deltaY,
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      dragStartRef.current = null;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, calculateInitialPosition]);

  // Initial translation - wait for context to be loaded
  useEffect(() => {
    // Don't start translation while context is still loading
    if (selection.contextLoading) {
      setIsLoading(true);
      return;
    }

    let cancelled = false;

    const doTranslate = async () => {
      setIsLoading(true);
      setError(null);
      setTranslationResponse(null);
      setExplanationPoints(null);

      const configured = await isGeminiConfigured();
      if (!configured) {
        setIsConfigured(false);
        setIsLoading(false);
        return;
      }

      try {
        const settings = await getGeminiSettings();
        setGeminiSettingsState(settings);

        // Use the translation model setting
        const result = await translateWithGemini(
          selection.selectedText,
          selection.context,
          settings.model
        );

        if (!cancelled) {
          console.log('Translation result:', JSON.stringify(result, null, 2));
          setTranslationResponse(result);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    doTranslate();

    return () => {
      cancelled = true;
    };
  }, [selection]);

  // Handle "解説" button click - get more detailed explanation
  const handleExplain = useCallback(() => {
    if (!translationResponse || isExplaining || !geminiSettings) return;

    setIsExplaining(true);
    setError(null);

    // Use setTimeout to allow React to re-render before the blocking API call
    setTimeout(async () => {
      try {
        const result = await explainTranslation(
          selection.selectedText,
          translationResponse.translation,
          geminiSettings.explanationModel
        );

        // Only update the explanation points, keep the original translation
        setExplanationPoints(result.points);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsExplaining(false);
      }
    }, 0);
  }, [translationResponse, isExplaining, geminiSettings, selection.selectedText]);

  // Auto-trigger explanation when autoExplain is true and translation is done
  useEffect(() => {
    if (autoExplain && translationResponse && !isLoading && !explanationPoints && !isExplaining && geminiSettings) {
      handleExplain();
    }
  }, [autoExplain, translationResponse, isLoading, explanationPoints, isExplaining, geminiSettings, handleExplain]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);


  const position = getPosition();

  return (
    <div
      ref={popupRef}
      className="fixed z-50 bg-bg-secondary rounded-lg shadow-2xl border border-bg-tertiary w-[600px] max-h-[700px] overflow-hidden flex flex-col"
      style={{
        left: position.left,
        top: position.top,
      }}
      onMouseDown={handleMouseDown}
    >
      {/* Header - Draggable */}
      <div
        data-drag-handle
        className={`flex items-center justify-between px-3 py-2 border-b border-bg-tertiary bg-bg-tertiary/50 ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
      >
        <div className="flex items-center gap-2" data-drag-handle>
          <GripHorizontal className="w-4 h-4 text-text-tertiary" data-drag-handle />
          <Languages className="w-4 h-4 text-accent" data-drag-handle />
          <span className="text-xs font-medium text-text-primary select-none" data-drag-handle>
            Translation
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-bg-hover text-text-tertiary hover:text-text-primary transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Context (collapsible, for debugging) */}
      <div className="border-b border-bg-tertiary">
        <button
          onClick={() => setShowContext(!showContext)}
          className="w-full px-3 py-1.5 flex items-center justify-between text-xs text-text-tertiary hover:text-text-secondary transition-colors"
        >
          <span>Context (debug)</span>
          {showContext ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
        {showContext && (
          <div className="px-3 pb-2">
            <p className="text-xs text-text-tertiary font-mono whitespace-pre-wrap max-h-[150px] overflow-y-auto bg-bg-primary p-2 rounded">
              {selection.context || '(no context)'}
            </p>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {!isConfigured && (
          <div className="flex flex-col items-center justify-center py-4 text-center">
            <AlertCircle className="w-8 h-8 text-yellow-500 mb-2" />
            <p className="text-sm text-text-primary mb-2">API Key Not Configured</p>
            <p className="text-xs text-text-tertiary mb-3">
              Please set your Gemini API key in Settings to use translation.
            </p>
            {onOpenSettings && (
              <button
                onClick={() => {
                  onClose();
                  onOpenSettings();
                }}
                className="flex items-center gap-2 px-3 py-1.5 bg-accent text-white text-xs rounded hover:bg-accent/90 transition-colors"
              >
                <Settings className="w-3 h-3" />
                Open Settings
              </button>
            )}
          </div>
        )}

        {isConfigured && isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-accent" />
            <span className="ml-2 text-sm text-text-secondary">Translating...</span>
          </div>
        )}

        {isConfigured && error && (
          <div className="flex flex-col items-center py-4 text-center">
            <AlertCircle className="w-6 h-6 text-red-400 mb-2" />
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {isConfigured && translationResponse && (
          <div className="space-y-2">
            {/* Original Text Section */}
            <CollapsibleSection
              title="原文"
              icon={Languages}
              defaultOpen={false}
            >
              <p className="text-text-primary text-sm leading-relaxed font-mono whitespace-pre-wrap">
                {selection.selectedText}
              </p>
            </CollapsibleSection>

            {/* Translation Section */}
            <CollapsibleSection
              title="翻訳"
              icon={MessageSquare}
              defaultOpen={true}
            >
              <p className="text-text-primary text-sm leading-relaxed">
                {translationResponse.translation || '(翻訳結果がありません)'}
              </p>
            </CollapsibleSection>

            {/* Points Section */}
            <CollapsibleSection
              title="翻訳のポイント"
              icon={BookOpen}
              defaultOpen={true}
            >
              {translationResponse.points && translationResponse.points.length > 0 ? (
                <ul className="text-text-primary text-sm list-disc list-inside space-y-2">
                  {translationResponse.points.map((point, index) => (
                    <li key={index}>
                      <ReactMarkdown components={markdownComponents}>{point}</ReactMarkdown>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-text-tertiary text-sm">(ポイントがありません)</p>
              )}
            </CollapsibleSection>

            {/* Explanation Section (shown after clicking 解説 button) */}
            {explanationPoints && explanationPoints.length > 0 && (
              <CollapsibleSection
                title="解説"
                icon={Sparkles}
                defaultOpen={true}
              >
                <ul className="text-text-primary text-sm list-disc list-inside space-y-2">
                  {explanationPoints.map((point, index) => (
                    <li key={index}>
                      <ReactMarkdown components={markdownComponents}>{point}</ReactMarkdown>
                    </li>
                  ))}
                </ul>
              </CollapsibleSection>
            )}
          </div>
        )}
      </div>

      {/* Footer with model info and action buttons */}
      {isConfigured && translationResponse && !isLoading && (
        <div className="px-3 py-2 border-t border-bg-tertiary bg-bg-tertiary/30 flex items-center justify-between gap-2">
          {/* Model indicators */}
          <div className="flex items-center gap-3 text-xs text-text-tertiary">
            {geminiSettings && (
              <div className="flex items-center gap-1.5">
                <Cpu className="w-3 h-3" />
                <span>翻訳: {GEMINI_MODELS.find(m => m.id === geminiSettings.model)?.name || geminiSettings.model}</span>
              </div>
            )}
            {explanationPoints && geminiSettings && (
              <div className="flex items-center gap-1.5">
                <Sparkles className="w-3 h-3" />
                <span>解説: {GEMINI_MODELS.find(m => m.id === geminiSettings.explanationModel)?.name || geminiSettings.explanationModel}</span>
              </div>
            )}
          </div>

          {/* Action buttons - hide after explanation is loaded */}
          {!explanationPoints && (
            <button
              onClick={handleExplain}
              disabled={isExplaining}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded transition-colors ${
                isExplaining
                  ? 'bg-accent/40 text-accent cursor-wait'
                  : 'bg-accent/20 text-accent hover:bg-accent/30'
              }`}
            >
              {isExplaining ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  解説生成中...
                </>
              ) : (
                <>
                  <Sparkles className="w-3 h-3" />
                  解説
                </>
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
