import type { Metadata } from "next";
import { Baloo_2, Quicksand } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

// Fonts and palette borrowed from github.com/kmw-bufs2012/multi-image-studio's
// design (headings in Baloo 2, body in Quicksand) — see globals.css for the
// matching color tokens.
const baloo = Baloo_2({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-baloo",
});

const quicksand = Quicksand({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-quicksand",
});

export const metadata: Metadata = {
  title: "Venice AllChat",
  description: "올인원 멀티 모델 AI 챗봇 — Venice.ai 전체 LLM 채팅 모델",
};

// Applies a stored explicit light/dark choice before first paint, so
// there's no flash of the wrong theme. "system" (no stored value, or the
// literal string "system") leaves the data-theme attribute unset entirely
// and lets the CSS prefers-color-scheme query decide.
const themeInitScript = `(function(){
  try {
    var stored = localStorage.getItem('theme');
    if (stored === 'light' || stored === 'dark') {
      document.documentElement.setAttribute('data-theme', stored);
      document.documentElement.style.colorScheme = stored;
    }
  } catch (e) {}
})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko" className={`${baloo.variable} ${quicksand.variable}`} suppressHydrationWarning>
      <body suppressHydrationWarning>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        {children}
      </body>
    </html>
  );
}
