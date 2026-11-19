import { notFound } from "next/navigation";
import { resolveLocale } from "@/i18n/locale";

/**
 * Every address under a locale that no page claims lands here and becomes a 404 INSIDE the normal layout (header, footer, the person's
 * language and theme): see ../not-found.tsx. This replaces the static global 404 for these addresses, which is rendered once at build
 * time without a request and therefore cannot carry a Content-Security-Policy nonce on Next.js's own inline scripts.
 */
export default async function UnknownPage({ params }: PageProps<"/[locale]/[...rest]">) {
  await resolveLocale(params);
  notFound();
}
