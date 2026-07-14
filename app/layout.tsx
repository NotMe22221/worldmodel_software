import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL("https://worldmodel-software.karthikuppala.chatgpt.site"),
  title: "WorldModel for Software — Failure simulator",
  description: "Map, simulate, repair, and verify software failures before production.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  openGraph: {
    title: "WorldModel for Software",
    description: "Simulate failure. Verify the fix.",
    images: [{ url: "/og-v2.png", width: 1200, height: 630, alt: "WorldModel for Software failure and verified repair transformation" }],
  },
  twitter: { card: "summary_large_image", title: "WorldModel for Software", description: "Break your software before your users do.", images: ["/og-v2.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body></html>;
}
