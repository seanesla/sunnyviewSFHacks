import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import 'mapbox-gl/dist/mapbox-gl.css'
import './globals.css'
import { AccentProvider } from '@/lib/accent-context'
import { BackgroundProvider } from '@/lib/background-context'

const _geist = Geist({ subsets: ["latin"] });
const _geistMono = Geist_Mono({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: 'sunnyview - Solar Feasibility in 30 Seconds',
  description: 'Trace a roof, see instant solar panel layouts with energy and CO2 estimates.',
  generator: 'sunnyview',
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body suppressHydrationWarning className={`font-sans antialiased`}>
        <BackgroundProvider>
          <AccentProvider>{children}</AccentProvider>
        </BackgroundProvider>
        <Analytics />
      </body>
    </html>
  )
}
