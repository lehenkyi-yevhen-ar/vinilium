import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { resolveLocale } from "@/i18n/locale";
import { SignInRequired } from "@/components/finder/SignInRequired";
import { LibraryView } from "@/components/library/LibraryView";
import { getSession } from "@/server/auth/session";

export async function generateMetadata({ params }: PageProps<"/[locale]/lists">): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: "library" });
  return { title: t("metaTitle") };
}

/** The signed-in user's Wishlist and Collection. */
export default async function ListsPage({ params }: PageProps<"/[locale]/lists">) {
  await resolveLocale(params);
  if (!(await getSession())) return <SignInRequired next="/lists" />;
  return <LibraryView />;
}
