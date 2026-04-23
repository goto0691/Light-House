import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Noto_Serif_KR } from "next/font/google";

import { ThemeProvider } from "@/components/providers/theme-provider";
import "@/styles/globals.css";

const sans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
});

const serif = Noto_Serif_KR({
  subsets: ["latin"],
  variable: "--font-serif",
  weight: ["400", "600", "700"],
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Project Light House",
  description: "Personal second-brain workspace for action, knowledge, relationships, and life ops.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html className={`${sans.variable} ${serif.variable} ${mono.variable}`} lang="ko" suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="data-theme" defaultTheme="dark" enableSystem={false}>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
