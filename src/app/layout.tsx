import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { PlatformProvider } from '@/contexts/PlatformContext'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Pedaru - PDF Viewer',
  description: 'A beautiful PDF viewer built with Tauri and Next.js',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ja">
      <body className={inter.className}>
        <PlatformProvider>
          {children}
        </PlatformProvider>
      </body>
    </html>
  )
}
