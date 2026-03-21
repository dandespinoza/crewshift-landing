import type { Metadata } from 'next';
import { Toaster } from 'sonner';
import { redHatDisplay } from '@/lib/fonts';
import './globals.css';
import './landing.css';

export const metadata: Metadata = {
  title: 'CrewShift — The AI Compliance Engine for Construction & Real Estate',
  description: 'Upload a violation notice, get a resolution plan in seconds. AI-powered compliance platform for property owners, managers, contractors, and developers.',
  metadataBase: new URL('https://crewshiftai.com'),
  openGraph: {
    title: 'CrewShift — The AI Compliance Engine for Construction & Real Estate',
    description: 'Upload a violation notice, get a resolution plan in seconds.',
    siteName: 'CrewShift AI',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'CrewShift — The AI Compliance Engine for Construction & Real Estate',
    description: 'Upload a violation notice, get a resolution plan in seconds.',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={redHatDisplay.variable}>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-accent-600 focus:px-4 focus:py-2 focus:text-text-inverse"
        >
          Skip to content
        </a>
        {children}
        <Toaster
          position="top-right"
          toastOptions={{
            style: {
              borderRadius: '12px',
              fontFamily: 'var(--font-red-hat-display), Red Hat Display, system-ui, sans-serif',
            },
          }}
        />
      </body>
    </html>
  );
}
