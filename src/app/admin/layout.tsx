import type { Metadata, Viewport } from "next";
import { AdminSessionGate } from "@/components/admin/AdminSessionGate";
import { ControlPwaRegister } from "@/components/admin/control/ControlPwaRegister";

export const metadata: Metadata = {
  applicationName: "Homestead Control",
  title: {
    default: "Homestead Control",
    template: "%s · Homestead Control",
  },
  description: "Panel operativo de Homestead Services.",
  manifest: "/admin/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Control",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/admin/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/admin/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/admin/icons/apple-touch-180.png", sizes: "180x180" }],
  },
  robots: { index: false, follow: false, nocache: true },
};

export const viewport: Viewport = {
  themeColor: "#1f3344",
  width: "device-width",
  initialScale: 1,
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminSessionGate>
      <div className="min-h-full bg-cream pb-24 text-charcoal md:pb-0">
        {children}
        <ControlPwaRegister />
      </div>
    </AdminSessionGate>
  );
}
