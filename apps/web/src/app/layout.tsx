import type { Metadata, Viewport } from "next";
import "@fontsource-variable/noto-sans-kr/wght.css";
import "@fontsource-variable/noto-serif-kr/wght.css";
import "@fontsource-variable/source-serif-4/wght.css";
import "@fontsource-variable/jetbrains-mono/wght.css";

import { ThemeProvider } from "@/components/providers/theme-provider";
import "@/styles/local-fonts.css";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: "Project Light House",
  description: "작업, 지식, 관계, 생활기록을 한곳에서 이어 보는 개인 작업 공간입니다.",
  applicationName: "Project Light House",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/icons/icon-192.svg", type: "image/svg+xml" }],
    shortcut: [{ url: "/icons/icon-192.svg", type: "image/svg+xml" }],
    apple: [{ url: "/icons/icon-192.svg", type: "image/svg+xml" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Light House",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#111827",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html data-scroll-behavior="smooth" lang="ko" suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="data-theme" defaultTheme="dark" enableSystem={false}>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
