import Link from "next/link";
import type { ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "light";

const variants: Record<Variant, string> = {
  primary:
    "bg-navy text-cream hover:bg-navy-soft border-navy",
  secondary:
    "bg-transparent text-cream border-cream/50 hover:border-cream hover:bg-cream/10",
  ghost:
    "bg-transparent text-navy border-navy/20 hover:border-navy hover:bg-navy/[0.04]",
  light:
    "bg-cream text-navy border-cream hover:bg-white",
};

const base =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border px-6 text-[0.78rem] font-medium tracking-[0.14em] uppercase transition-colors duration-300";

type Common = {
  children: ReactNode;
  className?: string;
  variant?: Variant;
};

export function ButtonLink({
  href,
  children,
  className = "",
  variant = "primary",
  target,
  rel,
}: Common & { href: string; target?: string; rel?: string }) {
  const external = href.startsWith("http") || href.startsWith("tel:") || href.startsWith("mailto:");
  if (external) {
    return (
      <a
        href={href}
        target={target}
        rel={rel}
        className={`${base} ${variants[variant]} ${className}`}
      >
        {children}
      </a>
    );
  }

  return (
    <Link href={href} className={`${base} ${variants[variant]} ${className}`}>
      {children}
    </Link>
  );
}

export function Button({
  children,
  className = "",
  variant = "primary",
  type = "button",
  disabled,
  loading,
}: Common & {
  type?: "button" | "submit";
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={`${base} ${variants[variant]} ${className} disabled:cursor-not-allowed disabled:opacity-60`}
    >
      {children}
    </button>
  );
}
