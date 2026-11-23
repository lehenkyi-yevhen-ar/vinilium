import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { site } from "@/config/site";
import { emailPasswordEnabled } from "@/lib/auth-flags";
import { LegalDocument } from "@/components/legal/LegalDocument";
import { buildSections } from "@/components/legal/build-sections";
import { resolveLocale } from "@/i18n/locale";
import { publicMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: PageProps<"/[locale]/privacy">): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: "legal.privacy" });
  return publicMetadata(locale, "/privacy", { title: t("title"), description: t("metaDescription") });
}

/** Read per request: the text follows AUTH_EMAIL_PASSWORD_ENABLED (no password or email lines in Google-only mode). */
export const dynamic = "force-dynamic";

/** Public. Prepared without professional legal advice (the notice says so); passages marked [NEEDS LEGAL REVIEW] are open questions (docs/legal-review-checklist.md). */
export default async function PrivacyPage({ params }: PageProps<"/[locale]/privacy">) {
  const locale = await resolveLocale(params);
  const p = await getTranslations({ locale, namespace: "legal.privacy" });
  const l = await getTranslations({ locale, namespace: "legal" });
  const tp = ((k: string, v?: Record<string, string>) => p(k as never, v as never)) as (k: string, v?: Record<string, string>) => string;
  const tl = ((k: string, v?: Record<string, string>) => l(k as never, v as never)) as (k: string, v?: Record<string, string>) => string;

  const withPasswords = emailPasswordEnabled();
  const sections = buildSections(tp, [
    { id: "s1", paragraphs: ["P1", "P2"] },
    { id: "s2", intro: true, items: withPasswords ? ["Account", "Sessions", "Lists", "Counters", "Logs", "Emails"] : ["AccountGoogleOnly", "Sessions", "Lists", "Counters", "Logs"] },
    { id: "s2b", paragraphs: withPasswords ? ["P1"] : ["P1GoogleOnly"] },
    { id: "s3", paragraphs: ["P1"] },
    { id: "s4", paragraphs: ["P1"] },
    { id: "s5", paragraphs: ["P1", "P3", "P2"] },
    { id: "s6", intro: true, items: withPasswords ? ["Hosting", "Database", "Email", "Google", "Discogs"] : ["Hosting", "Database", "Google", "Discogs"], paragraphs: withPasswords ? ["P1"] : ["P1GoogleOnly"] },
    { id: "s7", paragraphs: withPasswords ? ["P1", "P2"] : ["P1GoogleOnly", "P2GoogleOnly"] },
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
      marksNote={l("openMarksNote")}
      sections={sections}
      contactLabel={tl("contactLabel")}
      contactPageLabel={tl("contactPage")}
      email={site.contact.email ?? tl("emailUnset")}
    />
  );
}
