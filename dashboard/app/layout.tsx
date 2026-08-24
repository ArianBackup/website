/* ---------------------------------------------------------------------------
 * The root layout for the dashboard app.
 *
 * This is a SECOND Next app living beside the portfolio in the same repo, with
 * its own Vercel project rooted at this directory. The portfolio is a static
 * webpack/Three.js build and cannot host a Next server; the portal needs one
 * for its middleware wall and its sign-in endpoint. See ../vercel.json for the
 * rewrite that puts this behind arianfarhadi.com so the browser only ever sees
 * one origin.
 *
 * Pared down from Sculptr's root layout to what the portal actually reads:
 *
 *   `theme-v2` on <body>       is LOAD-BEARING, and not only for colour. It
 *                              carries `isolation: isolate`, which makes body a
 *                              stacking context — the brightness sheets hang off
 *                              <html> and paint over the whole of it. Remove the
 *                              class and the dimmer stops covering dialogs.
 *   the two fonts              --font-inter and --font-satoshi, referenced by
 *                              the kit's type tokens.
 *   globals + theme-v2         Tailwind's base and the tokens `.glass-button`
 *                              and the sign-in screen are built out of.
 *   viewport-fit=cover         the portal's safe-area insets resolve to real
 *                              values on a notched phone only with this.
 *
 * Left behind deliberately: react-query, next-themes, the intl and global-data
 * providers, the dot-grid layer and the two SVG filters for Sculptr's own
 * chrome. The portal paints its own ground and carries its own token block.
 * ------------------------------------------------------------------------- */

import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import localFont from 'next/font/local';

import { Toaster } from './toaster';

import './globals.css';
import './theme-v2.css';
import './theme-app.css';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
  weight: ['400', '500', '600', '700'],
});

const satoshi = localFont({
  src: [
    { path: '../components/brand/Satoshi-Light.otf', weight: '300', style: 'normal' },
    { path: '../components/brand/Satoshi-LightItalic.otf', weight: '300', style: 'italic' },
    { path: '../components/brand/Satoshi-Regular.otf', weight: '400', style: 'normal' },
    { path: '../components/brand/Satoshi-Italic.otf', weight: '400', style: 'italic' },
    { path: '../components/brand/Satoshi-Medium.otf', weight: '500', style: 'normal' },
    { path: '../components/brand/Satoshi-MediumItalic.otf', weight: '500', style: 'italic' },
    { path: '../components/brand/Satoshi-Bold.otf', weight: '700', style: 'normal' },
    { path: '../components/brand/Satoshi-BoldItalic.otf', weight: '700', style: 'italic' },
  ],
  variable: '--font-satoshi',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Home',
  /* Belt and braces over the middleware. Nothing here should ever be indexed,
     and the one page a stranger can reach — the sign-in — must not be either. */
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${satoshi.variable}`} suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </head>
      <body className="theme-v2 min-h-[100dvh] antialiased relative">
        <main>{children}</main>
        <Toaster />
      </body>
    </html>
  );
}
