"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Loader } from "@/components/ui/Loader";

export function AdminLoginForm({ returnUrl }: { returnUrl: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, returnUrl }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        redirect?: string;
      };
      if (!response.ok || !body.ok) {
        setError(
          response.status === 429
            ? "Demasiados intentos. Espera unos minutos."
            : "La clave no es correcta.",
        );
        return;
      }
      router.replace(body.redirect || "/admin/solicitudes");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <label className="block">
        <span className="text-[0.72rem] tracking-[0.16em] uppercase text-mist">
          Clave de acceso
        </span>
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="mt-3 w-full rounded-xl border border-navy/10 bg-white px-4 py-3 text-base text-charcoal outline-none focus:border-accent"
          required
        />
      </label>
      {error ? <p className="text-sm text-accent-deep">{error}</p> : null}
      <Button type="submit" loading={loading} className="w-full">
        {loading ? <Loader /> : "Entrar"}
      </Button>
    </form>
  );
}
