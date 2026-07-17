import type { Metadata } from "next";
import { Manrope, Space_Grotesk } from "next/font/google";

import { Providers } from "@/components/providers";

import "react-toastify/dist/ReactToastify.css";
import "./globals.css";

const headingFont = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-heading",
  weight: ["500", "600", "700"],
});

const bodyFont = Manrope({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Veridis Finance",
  description:
    "Plataforma de finanzas y facturación CFDI para empresas en México, integrada con tu CRM.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className={`${headingFont.variable} ${bodyFont.variable} min-h-screen bg-background font-body text-foreground antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
