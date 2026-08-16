import Link from "next/link";

type LogoProps = {
  href: string;
  inverted?: boolean;
  compact?: boolean;
};

export function Logo({ href, inverted = false, compact = false }: LogoProps) {
  const color = inverted ? "text-cream" : "text-navy";
  const roof = inverted ? "stroke-cream" : "stroke-navy";
  const door = inverted ? "fill-accent" : "fill-accent";

  return (
    <Link
      href={href}
      className={`group flex items-center gap-3 ${color}`}
      aria-label="HOMESTEAD SERVICES"
    >
      <svg
        viewBox="0 0 36 36"
        className="h-9 w-9 shrink-0"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M6.5 16.2 18 6.8l11.5 9.4V29a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 29V16.2Z"
          className={roof}
          strokeWidth="1.4"
        />
        <rect x="15.2" y="20.2" width="5.6" height="10.3" rx="0.6" className={door} />
      </svg>
      <span className="flex flex-col leading-none">
        <span className="font-display text-[1.12rem] tracking-[0.04em]">
          HOMESTEAD
        </span>
        {!compact && (
          <span className="mt-1 text-[0.62rem] tracking-[0.22em] uppercase text-current/55">
            Services
          </span>
        )}
      </span>
    </Link>
  );
}
