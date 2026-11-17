/**
 * The privacy policy and terms are DRAFTS until a lawyer has reviewed them. Every passage that makes a legal claim (or needs the
 * operator's own details) starts with LEGAL_MARK; the pages show the marks visibly and a banner while any remain. Remove the mark
 * from a string only after that string has been reviewed. `npm run legal:checklist` lists what is still open.
 */
export const LEGAL_MARK = "[NEEDS LEGAL REVIEW]";

export const hasLegalMark = (text: string) => text.includes(LEGAL_MARK);

/** Splits a paragraph into plain text and the marker so the page can highlight the marker. */
export function splitLegalMark(text: string): Array<{ mark: boolean; text: string }> {
  const parts: Array<{ mark: boolean; text: string }> = [];
  let rest = text;
  for (;;) {
    const i = rest.indexOf(LEGAL_MARK);
    if (i < 0) break;
    if (i > 0) parts.push({ mark: false, text: rest.slice(0, i) });
    parts.push({ mark: true, text: LEGAL_MARK });
    rest = rest.slice(i + LEGAL_MARK.length);
  }
  if (rest) parts.push({ mark: false, text: rest });
  return parts;
}

export interface LegalSection {
  id: string;
  title: string;
  intro?: string;
  items?: string[];
  paragraphs?: string[];
}
