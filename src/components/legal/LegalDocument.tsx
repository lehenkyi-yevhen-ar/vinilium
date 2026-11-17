import { hasLegalMark, splitLegalMark, type LegalSection } from "@/lib/legal";
import { Link } from "@/i18n/navigation";

function Text({ children }: { children: string }) {
  return (
    <>
      {splitLegalMark(children).map((part, i) =>
        part.mark ? (
          <mark key={i} className="x-legal-mark">
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}

/**
 * A legal page: title, date, lead, a DRAFT banner while any passage is still marked for legal review, numbered sections, and the
 * contact details. Pure presentation; the text comes from the message files.
 */
export function LegalDocument({
  title,
  updated,
  lead,
  banner,
  sections,
  contactLabel,
  contactPageLabel,
  email,
}: {
  title: string;
  updated: string;
  lead: string;
  banner: string;
  sections: LegalSection[];
  contactLabel: string;
  contactPageLabel: string;
  email: string | null;
}) {
  const draft = sections.some((s) => [s.intro, ...(s.items ?? []), ...(s.paragraphs ?? [])].some((t) => t && hasLegalMark(t)));
  return (
    <div className="container x-page">
      <div className="x-narrow">
        <article className="x-card x-legal">
          <h1>{title}</h1>
          <p className="x-note">{updated}</p>
          {draft ? (
            <p className="x-legal-banner" role="note">
              <Text>{banner}</Text>
            </p>
          ) : null}
          <p className="x-lead">{lead}</p>

          {sections.map((s) => (
            <section key={s.id} className="x-section" aria-labelledby={`legal-${s.id}`}>
              <h2 id={`legal-${s.id}`}>{s.title}</h2>
              {s.intro ? (
                <p>
                  <Text>{s.intro}</Text>
                </p>
              ) : null}
              {s.items?.length ? (
                <ul className="x-list">
                  {s.items.map((item) => (
                    <li key={item}>
                      <Text>{item}</Text>
                    </li>
                  ))}
                </ul>
              ) : null}
              {s.paragraphs?.map((p) => (
                <p key={p}>
                  <Text>{p}</Text>
                </p>
              ))}
            </section>
          ))}

          <p className="x-note">
            {contactLabel}:{" "}
            {email ? (
              <a className="link" href={`mailto:${email}`}>
                {email}
              </a>
            ) : (
              <Link className="link" href="/contact">
                {contactPageLabel}
              </Link>
            )}
            {email ? (
              <>
                {" · "}
                <Link className="link" href="/contact">
                  {contactPageLabel}
                </Link>
              </>
            ) : null}
          </p>
        </article>
      </div>
    </div>
  );
}
