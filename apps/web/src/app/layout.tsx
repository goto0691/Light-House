import type { Metadata } from "next";
import "@fontsource-variable/noto-sans-kr/wght.css";
import "@fontsource-variable/noto-serif-kr/wght.css";
import "@fontsource-variable/source-serif-4/wght.css";
import "@fontsource-variable/jetbrains-mono/wght.css";

import { ThemeProvider } from "@/components/providers/theme-provider";
import "@/styles/local-fonts.css";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: "Project Light House",
  description: "Personal second-brain workspace for action, knowledge, relationships, and life ops.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="data-theme" defaultTheme="dark" enableSystem={false}>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
