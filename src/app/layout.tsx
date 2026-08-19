import { Newsreader, Outfit } from "next/font/google";
import type { Metadata, Viewport } from "next";
import { ToastProvider } from "@/components/ui/Toast";
import { site } from "@/lib/site";
import { getDictionary } from "@/i18n/get-dictionary";
import "./globals.css";

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
  display: "swap",
});

const newsreader = Newsreader({
  subsets: ["latin"],
  variable: "--font-newsreader",
  display: "swap",
});

const dictionary = getDictionary();

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: {
    default: dictionary.meta.homeTitle,
    template: `%s | ${site.name}`,
  },
  description: dictionary.meta.homeDescription,
  applicationName: site.name,
  keywords: [
    "servicios de mantenimiento en Panamá",
    "mantenimiento de aire acondicionado",
    "plomería",
    "pintura",
    "cerrajería",
    "reparaciones del hogar",
    "mantenimiento residencial",
    "pequeñas remodelaciones",
  ],
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    locale: "es_PA",
    siteName: site.name,
    title: dictionary.meta.homeTitle,
    description: dictionary.meta.homeDescription,
  },
};

export const viewport: Viewport = {
  themeColor: "#1f3344",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="es"
      className={`${outfit.variable} ${newsreader.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-cream font-sans text-charcoal">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
