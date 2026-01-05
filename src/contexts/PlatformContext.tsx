'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { platform } from '@tauri-apps/plugin-os';

export type PlatformName = 'macos' | 'windows' | 'linux' | 'ios' | 'android' | '';

interface PlatformContextValue {
    platform: PlatformName;
    isMacOS: boolean;
    isWindows: boolean;
    isLinux: boolean;
    isLoading: boolean;
}

const PlatformContext = createContext<PlatformContextValue | null>(null);

/**
 * Sync detection from userAgent for immediate render (avoids layout shift)
 */
function getInitialPlatform(): PlatformName {
    if (typeof navigator === 'undefined') return '';
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes('mac')) return 'macos';
    if (ua.includes('win')) return 'windows';
    if (ua.includes('linux')) return 'linux';
    return '';
}

/**
 * Provider component that wraps the application with platform detection
 * Uses sync userAgent detection first, then verifies with Tauri's platform() API
 */
export function PlatformProvider({ children }: { children: ReactNode }) {
    const [platformName, setPlatformName] = useState<PlatformName>(getInitialPlatform);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        async function detectPlatform() {
            try {
                const p = await platform();
                setPlatformName(p as PlatformName);
            } catch (e) {
                console.error('Failed to get platform:', e);
                // Keep the userAgent-based detection as fallback
            } finally {
                setIsLoading(false);
            }
        }
        detectPlatform();
    }, []);

    const value: PlatformContextValue = {
        platform: platformName,
        isMacOS: platformName === 'macos',
        isWindows: platformName === 'windows',
        isLinux: platformName === 'linux',
        isLoading,
    };

    return (
        <PlatformContext.Provider value={value}>
            {children}
        </PlatformContext.Provider>
    );
}

/**
 * Hook to access platform information from context
 * Must be used within a PlatformProvider
 */
export function usePlatform(): PlatformContextValue {
    const context = useContext(PlatformContext);
    if (context === null) {
        throw new Error('usePlatform must be used within a PlatformProvider');
    }
    return context;
}
