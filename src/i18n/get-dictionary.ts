export type { Dictionary } from "./es";
export { es } from "./es";

import { es, type Dictionary } from "./es";
import type { Locale } from "@/lib/site";

const dictionaries: Record<Locale, Dictionary> = {
  es,
};

export function getDictionary(locale: Locale = "es"): Dictionary {
  return dictionaries[locale] ?? es;
}
