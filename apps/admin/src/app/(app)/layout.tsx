import React from 'react'

export const metadata = {
  title: 'CrewShift Admin',
  description: 'CrewShift AI Operations Platform - Super Admin Panel',
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          padding: 0,
          backgroundColor: '#0A0A0A',
          color: '#FAFAFA',
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        }}
      >
        {children}
      </body>
    </html>
  )
}
