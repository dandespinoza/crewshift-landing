import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'CrewShift — AI Agents for Trade Businesses',
  description: 'AI agents that handle invoicing, estimates, collections, and scheduling for HVAC, plumbing, electrical, and roofing companies.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
