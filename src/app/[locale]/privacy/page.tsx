import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { site } from "@/config/site";
import { LegalDocument } from "@/components/legal/LegalDocument";
import { buildSections } from "@/components/legal/build-sections";
import { resolveLocale } from "@/i18n/locale";

export async function generateMetadata({ params }: PageProps<"/[locale]/privacy">): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: "legal.privacy" });
  return { title: t("title"), description: t("metaDescription") };
}

/** Public. A DRAFT: passages marked [NEEDS LEGAL REVIEW] need a lawyer (see docs/legal-review-checklist.md). */
export default async function PrivacyPage({ params }: PageProps<"/[locale]/privacy">) {
  const locale = await resolveLocale(params);
  const p = await getTranslations({ locale, namespace: "legal.privacy" });
  const l = await getTranslations({ locale, namespace: "legal" });
  const tp = ((k: string, v?: Record<string, string>) => p(k as never, v as never)) as (k: string, v?: Record<string, string>) => string;
  const tl = ((k: string, v?: Record<string, string>) => l(k as never, v as never)) as (k: string, v?: Record<string, string>) => string;

  const sections = buildSections(tp, [
    { id: "s1", paragraphs: ["P1", "P2"] },
    { id: "s2", intro: true, items: ["Account", "Sessions", "Lists", "Counters", "Emails"] },
    { id: "s3", paragraphs: ["P1"] },
    { id: "s4", paragraphs: ["P1"] },
    { id: "s5", paragraphs: ["P1", "P2"] },
    { id: "s6", intro: true, items: ["Hosting", "Database", "Email", "Google", "Discogs"], paragraphs: ["P1"] },
    { id: "s7", paragraphs: ["P1", "P2"] },
    { id: "s8", items: ["Delete", "Export", "Correct"], paragraphs: ["P1"] },
    { id: "s9", paragraphs: ["P1"] },
    { id: "s10", paragraphs: ["P1"] },
    { id: "s11", paragraphs: ["P1", "P2"] },
  ]);

  return (
    <LegalDocument
      title={p("title")}
      updated={p("updated")}
      lead={p("lead")}
      banner={l("draftBanner")}
      sections={sections}
      contactLabel={tl("contactLabel")}
      contactPageLabel={tl("contactPage")}
      email={site.contact.email ?? tl("emailUnset")}
    />
  );
}
