import type { Metadata } from "next";
import { Geist } from "next/font/google";

import { AppHeader } from "@/components/app-header";
import { APP_NAME, APP_TAGLINE } from "@/lib/app-copy";
import "./globals.css";

const defaultUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(defaultUrl),
  title: APP_NAME,
  description: APP_TAGLINE,
};

const geistSans = Geist({
  variable: "--font-geist-sans",
  display: "swap",
  subsets: ["latin"],
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.className} flex min-h-screen flex-col bg-background antialiased`}>
        <AppHeader />
        <div className="flex flex-1 flex-col">{children}</div>
      </body>
    </html>
  );
}
