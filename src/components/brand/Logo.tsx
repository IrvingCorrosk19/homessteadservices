import Image from "next/image";
import Link from "next/link";
import { brandLogo } from "@/data/images";

type LogoProps = {
  href: string;
  variant?: "header" | "footer";
};

export function Logo({ href, variant = "header" }: LogoProps) {
  return (
    <Link
      href={href}
      className={`logo-link logo-${variant}`}
      aria-label="Homestead Services"
    >
      <Image
        src={brandLogo.src}
        alt="Homestead Services"
        width={brandLogo.width}
        height={brandLogo.height}
        className="logo-img"
        sizes={variant === "footer" ? "288px" : "176px"}
        priority={variant === "header"}
        unoptimized
      />
    </Link>
  );
}
