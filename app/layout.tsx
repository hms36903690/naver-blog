import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "블로그 조종석",
  description: "네이버 블로그 글을 대신 써서 올리는 로컬 앱",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
