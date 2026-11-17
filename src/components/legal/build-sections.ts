import { site } from "@/config/site";
import type { LegalSection } from "@/lib/legal";

type Translate = (key: string, values?: Record<string, string>) => string;

export interface SectionSpec {
  /** "s1": the keys are `<id>Title`, `<id>Intro`, and the suffixes listed below. */
  id: string;
  intro?: boolean;
  /** key suffixes, e.g. ["Account", "Sessions"] -> s2Account, s2Sessions */
  items?: string[];
  /** key suffixes, e.g. ["P1", "P2"] -> s1P1, s1P2 */
  paragraphs?: string[];
}

/** The operator's details for {operator} / {country}: the configured values, or the visible placeholders from the message files. */
export function operatorValues(t: Translate) {
  return {
    operator: site.operator.name ?? t("operatorUnset"),
    country: site.operator.country ?? t("countryUnset"),
  };
}

/** Builds the sections of a legal page from the message files, in the order the spec lists them. */
export function buildSections(t: Translate, specs: SectionSpec[]): LegalSection[] {
  const values = operatorValues(t);
  return specs.map((s) => ({
    id: s.id,
    title: t(`${s.id}Title`),
    ...(s.intro ? { intro: t(`${s.id}Intro`) } : {}),
    ...(s.items ? { items: s.items.map((k) => t(`${s.id}${k}`, values)) } : {}),
    ...(s.paragraphs ? { paragraphs: s.paragraphs.map((k) => t(`${s.id}${k}`, values)) } : {}),
  }));
}
