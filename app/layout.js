import './globals.css';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';

export const metadata = {
  title: 'Last Say',
  description: 'AI 先整理，最後由你決定的本機財務審查工作台。',
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
