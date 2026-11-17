import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { resolveLocale } from "@/i18n/locale";
import { SearchFlow } from "@/components/finder/SearchFlow";
import { SignInRequired } from "@/components/finder/SignInRequired";
import { finderQuery, fromRecord, parseFinder, withQuery } from "@/lib/finder-state";
import { getSession } from "@/server/auth/session";

export async function generateMetadata({ params }: PageProps<"/[locale]/search">): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: "finder" });
  return { title: t("title") };
}

/** Step 1-3 of the finder: track -> artist -> album. Signed-in users only (see SignInRequired). */
export default async function SearchPage({ params, searchParams }: PageProps<"/[locale]/search">) {
  await resolveLocale(params);
  // Signed out: after signing in the person returns to THIS step (the query is rebuilt from validated values, never copied raw).
  if (!(await getSession())) return <SignInRequired next={withQuery("/search", finderQuery(parseFinder(fromRecord(await searchParams))))} />;
  return <SearchFlow />;
}
