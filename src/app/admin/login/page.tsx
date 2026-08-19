import { AdminLoginForm } from "@/components/admin/AdminLoginForm";
import { safeAdminReturnUrl } from "@/lib/admin-auth";

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ returnUrl?: string }>;
}) {
  const params = await searchParams;
  const returnUrl = safeAdminReturnUrl(params.returnUrl);

  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-16">
      <div className="w-full max-w-md rounded-[28px] border border-navy/10 bg-white p-8 shadow-[0_24px_60px_rgba(31,51,68,0.08)]">
        <p className="text-[0.72rem] tracking-[0.2em] uppercase text-accent">
          Homestead Services
        </p>
        <h1 className="mt-4 font-display text-4xl text-navy">Solicitudes</h1>
        <p className="mt-3 text-sm leading-6 text-mist">
          Acceso privado para responder a los clientes.
        </p>
        <div className="mt-8">
          <AdminLoginForm returnUrl={returnUrl} />
        </div>
      </div>
    </main>
  );
}
