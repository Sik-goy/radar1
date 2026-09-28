import type { Metadata } from 'next';
import './globals.css';
import { Header } from '@/components/Header';
import { getLang } from '@/lib/i18n/server';

export const metadata: Metadata = {
  title: 'Radar',
  description: 'Events from Slovakia and Czechia in one place',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = await getLang();
  return (
    <html lang={lang}>
      <body className="bg-zinc-50 text-zinc-900 antialiased">
        <Header lang={lang} />
        <main>{children}</main>
      </body>
    </html>
  );
}
