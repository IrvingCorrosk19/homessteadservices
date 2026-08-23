import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Solicitudes",
  robots: { index: false, follow: false, nocache: true },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-full bg-cream pb-24 text-charcoal md:pb-0">{children}</div>;
}
