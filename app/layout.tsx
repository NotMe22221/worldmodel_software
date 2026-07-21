import type { Metadata } from "next";
import { vercelSystemDeploymentOrigin } from "@/server/request-origin";
import "./globals.css";
import "./warm-theme.css";
import "./premium.css";

const publicOrigin = process.env.WORLDMODEL_PUBLIC_ORIGIN?.trim()
  || vercelSystemDeploymentOrigin(process.env)
  || "https://worldmodel-software.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(publicOrigin),
  title: "WorldModel for Software — Verified resilience engineering",
  description: "Map your software, simulate production failures safely, and verify repairs before your users are affected.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  openGraph: {
    title: "WorldModel for Software",
    description: "Map your software, simulate failures safely, and verify the fix before production.",
    images: [{ url: "/og-v2.png", width: 1200, height: 630, alt: "WorldModel for Software failure and verified repair transformation" }],
  },
  twitter: { card: "summary_large_image", title: "WorldModel for Software", description: "Break your software before your users do.", images: ["/og-v2.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
