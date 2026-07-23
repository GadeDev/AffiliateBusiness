import type { Metadata } from 'next';
import './globals.css';
import { Footer } from './components/Footer';

export const metadata: Metadata = {
  title: {
    default: 'くらべて選ぶラボ',
    template: '%s | くらべて選ぶラボ',
  },
  description: '家計・通信費・ふるさと納税・転職など、暮らしに関わるサービスを公式情報に基づいて紹介する情報サイト',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="min-h-screen flex flex-col bg-white text-gray-900 antialiased">
        <div className="flex-1">{children}</div>
        <Footer />
      </body>
    </html>
  );
}
