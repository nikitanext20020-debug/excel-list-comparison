import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { Golos_Text, IBM_Plex_Mono } from 'next/font/google'
import './globals.css'

const _golos = Golos_Text({ subsets: ['latin', 'cyrillic'] })
const _plexMono = IBM_Plex_Mono({ subsets: ['latin', 'cyrillic'], weight: ['400', '500', '600'] })

export const metadata: Metadata = {
  title: 'Сверка списков — ФИО и телефоны',
  description:
    'Локальная сверка Excel-файлов: нечёткий поиск по ФИО, телефонам и датам рождения, разбор спорных случаев, поиск дублей. Данные не покидают браузер.',
  generator: 'v0.app',
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  colorScheme: 'light',
  themeColor: '#f2f3ee',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="ru" className="bg-background">
      <body className="antialiased font-sans">
        {children}
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
