import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;

  return {
    title: "Wayfinder — Learn flags & capitals",
    description: "Adaptive geography quizzes for learning every country, flag, and capital.",
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: {
      title: "Wayfinder — Learn flags & capitals",
      description: "Know the world at a glance with adaptive geography quizzes.",
      images: [{ url: `${origin}/og.png`, width: 1536, height: 1024, alt: "Wayfinder geography quiz" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Wayfinder — Learn flags & capitals",
      description: "Know the world at a glance with adaptive geography quizzes.",
      images: [`${origin}/og.png`],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
