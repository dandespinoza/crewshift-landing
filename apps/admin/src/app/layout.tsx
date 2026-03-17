import React from 'react'

export const metadata = {
  title: 'CrewShift Admin',
  description: 'CrewShift AI Operations Platform - Super Admin Panel',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
