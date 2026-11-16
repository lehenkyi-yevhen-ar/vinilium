import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { resolveLocale } from "@/i18n/locale";
import { PressingsView } from "@/components/finder/PressingsView";
import { SignInRequired } from "@/components/finder/SignInRequired";
import { getSession } from "@/server/auth/session";

export async function generateMetadata({ params }: PageProps<"/[locale]/master/[id]">): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: "pressings" });
  return { title: t("title") };
}

/** Step 4 of the finder: the pressings of one album, with country / year / label filters. */
export default async function MasterPage({ params }: PageProps<"/[locale]/master/[id]">) {
  await resolveLocale(params);
  const { id } = await params;
  if (!/^[1-9]\d{0,9}$/.test(id)) notFound();
  if (!(await getSession())) return <SignInRequired next="/search" />;
  return <PressingsView masterId={Number(id)} />;
}
