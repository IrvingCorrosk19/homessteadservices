import Link from "next/link";
import { ButtonLink } from "@/components/ui/Button";
import { getDictionary } from "@/i18n/get-dictionary";

export default function NotFound() {
  const dictionary = getDictionary();

  return (
    <section className="flex min-h-[80svh] items-center bg-cream pt-20">
      <div className="container-home">
        <h1 className="font-display text-4xl text-navy md:text-5xl">
          {dictionary.notFound.title}
        </h1>
        <p className="mt-4 max-w-lg text-lg text-navy-soft">
          {dictionary.notFound.body}
        </p>
        <div className="mt-8">
          <ButtonLink href="/">{dictionary.notFound.home}</ButtonLink>
        </div>
        <p className="mt-6 text-sm">
          <Link href="/contact" className="text-navy underline-offset-4 hover:underline">
            {dictionary.common.request}
          </Link>
        </p>
      </div>
    </section>
  );
}
