import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { headers } from 'next/headers';
import { getAppConfig } from '@/lib/utils';
import '@/styles/globals.css';
import '@/styles/paper.css';

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
});

const jetBrainsMono = JetBrains_Mono({
  variable: '--font-jbmono',
  subsets: ['latin'],
  weight: ['400', '500'],
});

// Base URL for resolving the file-based opengraph-image into an absolute URL.
export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.SITE_URL ?? process.env.RENDER_EXTERNAL_URL ?? 'http://localhost:3000'
  ),
};

interface RootLayoutProps {
  children: React.ReactNode;
}

export default async function RootLayout({ children }: RootLayoutProps) {
  const hdrs = await headers();
  const appConfig = await getAppConfig(hdrs);
  const { pageTitle, pageDescription } = appConfig;

  return (
    <html
      lang="en"
      data-theme="paper"
      suppressHydrationWarning
      className={`${inter.variable} ${jetBrainsMono.variable}`}
    >
      <head>
        <title>{pageTitle}</title>
        <meta name="description" content={pageDescription} />
      </head>
      <body>{children}</body>
    </html>
  );
}
