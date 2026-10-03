import { isControlIsolated } from "@/lib/control-isolation";

export function ControlIsolatedBanner() {
  if (!isControlIsolated()) return null;
  return (
    <p className="mt-4 rounded-2xl border border-amber-800/20 bg-amber-50 px-4 py-3 text-sm text-amber-950">
      Base local aislada. Las piezas, lotes y campañas que ves aquí son de desarrollo o prueba. No son datos de
      producción y no se envían a Meta, Telegram, correo ni OpenAI.
    </p>
  );
}
