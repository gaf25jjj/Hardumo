import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Hardumo Watch Party',
  description: 'Watch YouTube videos with friends in sync.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
