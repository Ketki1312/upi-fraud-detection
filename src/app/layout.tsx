import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "UPI Fraud Detection — Adaptive, Explainable, Multilingual AI Research Prototype",
  description:
    "Academic research prototype for detecting UPI fraud and financial scam messages. Trained on PaySim (synthetic mobile-money), Hindi/Hinglish (synthetic), and UCI SMS Spam (public). Real SHAP/LIME explanations, real PSI drift, real adaptive candidate retraining.",
  keywords: [
    "UPI fraud detection",
    "XAI",
    "SHAP",
    "LIME",
    "concept drift",
    "PSI",
    "adaptive learning",
    "scam message classifier",
    "research prototype",
  ],
  authors: [{ name: "UPI Fraud Detection Research Prototype" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "UPI Fraud Detection — Research Prototype",
    description:
      "Adaptive, explainable, multilingual AI for detecting UPI fraud and financial scam messages.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster />
          <SonnerToaster position="bottom-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
