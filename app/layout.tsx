import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { Manrope, DM_Sans, Rubik, Inter } from 'next/font/google'
import './globals.css'

const _manrope = Manrope({ subsets: ['latin', 'cyrillic'] })
const _dmSans = DM_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700'] })
const _rubik = Rubik({ subsets: ['latin', 'cyrillic'], weight: ['400', '500', '600'] })
const _inter = Inter({ subsets: ['latin'] })

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
  colorScheme: 'dark',
  themeColor: '#0b1424',
  // фикс для телефонов: сайт не масштабируется случайно (пинч/двойной тап)
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
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
