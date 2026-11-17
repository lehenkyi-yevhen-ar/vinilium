import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { site } from "@/config/site";
import { LegalDocument } from "@/components/legal/LegalDocument";
import { buildSections } from "@/components/legal/build-sections";
import { resolveLocale } from "@/i18n/locale";

export async function generateMetadata({ params }: PageProps<"/[locale]/terms">): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: "legal.terms" });
  return { title: t("title"), description: t("metaDescription") };
}

/** Public. A DRAFT: passages marked [NEEDS LEGAL REVIEW] need a lawyer (see docs/legal-review-checklist.md). */
export default async function TermsPage({ params }: PageProps<"/[locale]/terms">) {
  const locale = await resolveLocale(params);
  const p = await getTranslations({ locale, namespace: "legal.terms" });
  const l = await getTranslations({ locale, namespace: "legal" });
  const f = await getTranslations({ locale, namespace: "footer" });
  const tp = ((k: string, v?: Record<string, string>) => p(k as never, v as never)) as (k: string, v?: Record<string, string>) => string;
  const tl = ((k: string, v?: Record<string, string>) => l(k as never, v as never)) as (k: string, v?: Record<string, string>) => string;

  const sections = buildSections(tp, [
    { id: "s1", paragraphs: ["P1"] },
    { id: "s2", intro: true, items: ["A", "B", "C"] },
    { id: "s3", paragraphs: ["P1", "P2"] },
    // The Discogs non-affiliation sentence is prescribed by the Discogs API Terms: it is the same message as in the footer, verbatim (English).
    { id: "s4", paragraphs: ["P1"] },
    { id: "s5", paragraphs: ["P1", "P2"] },
    { id: "s6", paragraphs: ["P1"] },
    { id: "s7", paragraphs: ["P1"] },
    { id: "s8", paragraphs: ["P1", "P2"] },
    { id: "s9", paragraphs: ["P1"] },
  ]);
  const s4 = sections.find((s) => s.id === "s4");
  s4?.paragraphs?.push(f("discogsNotice"));

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
