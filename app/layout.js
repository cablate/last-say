import './globals.css';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';

export const metadata = {
  title: 'Finance Viewer',
  description: '本機優先的財務資料審核、匯入與分類工作台。',
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-Hant">
      <body>
        <TooltipProvider delayDuration={200}>
          {children}
        </TooltipProvider>
        <Toaster richColors position="top-center" />
      </body>
    </html>
  );
}
