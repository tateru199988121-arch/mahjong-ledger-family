import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "麻將有帳｜家人的麻將戰績",
  description: "一家人的麻將場、每日牌局、輸贏與東錢紀錄。",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hant">
      <head>
        <meta name="theme-color" content="#143b32" />
        <link rel="stylesheet" href="/styles.css" />
        <script src="/app.js" defer />
      </head>
      <body>{children}</body>
    </html>
  );
}
