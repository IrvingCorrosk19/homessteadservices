import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { MobileBar } from "@/components/layout/MobileBar";
import { JsonLd } from "@/components/seo/JsonLd";
import { ConciergeMount } from "@/components/concierge/ConciergeMount";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mobile-bar-space">
      <JsonLd />
      <Header />
      <main>{children}</main>
      <Footer />
      <MobileBar />
      <ConciergeMount />
    </div>
  );
}
