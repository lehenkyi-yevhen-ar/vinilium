import type { ReactNode } from "react";

/** Shared shell for the auth pages: narrow card, one h1, optional lead and footer links. */
export function AuthCard({
  title,
  lead,
  children,
  footer,
}: {
  title: ReactNode;
  lead?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="container x-page">
      <div className="x-narrow">
        <div className="x-card">
          <h1>{title}</h1>
          {lead ? <p className="x-lead">{lead}</p> : null}
          {children}
          {footer ? <div className="x-foot">{footer}</div> : null}
        </div>
      </div>
    </div>
  );
}
