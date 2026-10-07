import { AdminTopBar } from "@/components/admin/AdminTopBar";
import { ControlIntakeForm } from "@/components/admin/control/ControlIntakeForm";
import { ControlSubnav } from "@/components/admin/control/ControlSubnav";

export default function ControlNuevoPage() {
  return (
    <>
      <AdminTopBar />
      <main className="mx-auto w-[min(720px,calc(100%-1.5rem))] py-8 md:py-12">
        <h1 className="font-display text-4xl text-navy">Cargar fotos</h1>
        <ControlSubnav current="/admin/contenido/nuevo" />
        <div className="mt-6 rounded-[28px] border border-navy/8 bg-white p-5">
          <ControlIntakeForm />
        </div>
        <section className="mt-6 rounded-2xl border border-navy/10 bg-white p-5 text-sm text-charcoal/75">
          <h2 className="font-display text-2xl text-navy">Modos de publicación</h2>
          <p className="mt-3">
            Con 2 o más fotos puedes crear un álbum: un carrusel oficial en Instagram y una multi-foto en Facebook, con
            el mismo texto y el orden elegido. También puedes crear una pieza independiente por foto. Video/Reels aún no
            están soportados.
          </p>
        </section>
      </main>
    </>
  );
}
