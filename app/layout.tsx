import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Abandoned Institutions — Inter-RC Halloween Night 2026',
  description: 'Join and track the six NUS residential college haunted house queues for Inter-RC Halloween Night 2026.',
  openGraph: {
    title: 'Abandoned Institutions',
    description: 'Inter-RC Halloween Night 2026',
    type: 'website',
    images: [{ url: '/og.png', width: 1536, height: 1024, alt: 'Abandoned Institutions — Inter-RC Halloween Night 2026' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Abandoned Institutions',
    description: 'Inter-RC Halloween Night 2026',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
