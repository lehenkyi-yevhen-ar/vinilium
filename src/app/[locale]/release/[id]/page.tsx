import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { resolveLocale } from "@/i18n/locale";
import { ReleaseView } from "@/components/finder/ReleaseView";
import { SignInRequired } from "@/components/finder/SignInRequired";
import { getSession } from "@/server/auth/session";

export async function generateMetadata({ params }: PageProps<"/[locale]/release/[id]">): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: "release" });
  return { title: t("details") };
}

/** The release card: details, tracklist, and Add to Wishlist / Add to Collection. */
export default async function ReleasePage({ params }: PageProps<"/[locale]/release/[id]">) {
  await resolveLocale(params);
  const { id } = await params;
  if (!/^[1-9]\d{0,9}$/.test(id)) notFound();
  if (!(await getSession())) return <SignInRequired next="/search" />;
  return <ReleaseView releaseId={Number(id)} />;
}
