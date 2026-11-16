import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { resolveLocale } from "@/i18n/locale";
import { SearchFlow } from "@/components/finder/SearchFlow";
import { SignInRequired } from "@/components/finder/SignInRequired";
import { getSession } from "@/server/auth/session";

export async function generateMetadata({ params }: PageProps<"/[locale]/search">): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: "finder" });
  return { title: t("title") };
}

/** Step 1-3 of the finder: track -> artist -> album. Signed-in users only (see SignInRequired). */
export default async function SearchPage({ params }: PageProps<"/[locale]/search">) {
  await resolveLocale(params);
  if (!(await getSession())) return <SignInRequired next="/search" />;
  return <SearchFlow />;
}
