import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Flowdesk — Công việc & Ý tưởng",
  description: "Không gian cá nhân để quản lý công việc, thu thập ý tưởng và theo dõi tiến độ.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi">
      <body className="antialiased">{children}</body>
    </html>
  );
}
