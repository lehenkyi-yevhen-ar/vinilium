"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";
import { CONDITIONS, NOTES_MAX, type Condition, type ListName, type StoredItemJson } from "@/lib/lists/rules";
import { Link } from "@/i18n/navigation";
import { Button } from "@/ds/Button";
import { DiscIcon } from "@/ds/icons";
import { StatusMessage } from "@/ds/StatusMessage";
import { DiscogsAttribution } from "../DiscogsAttribution";
import { Cover } from "../finder/parts";
import type { CardState } from "./use-library";

interface Props {
  item: StoredItemJson;
  card: CardState;
  /** A request for this item is in flight: its actions wait (the screen already shows the new value). */
  busy: boolean;
  /** Set when the last change to this item failed and was rolled back. */
  problem: string | null;
  onSaveNotes: (notes: string | null) => void;
  onCondition: (field: "conditionMedia" | "conditionSleeve", value: Condition | null) => void;
  onMove: () => void;
  onRemove: (opener: HTMLElement) => void;
  onRetryDetails: () => void;
}

function Skeleton({ label }: { label: string }) {
  return (
    <div className="x-item__discogs" aria-busy="true" role="status" aria-label={label}>
      <div className="skel x-cover" aria-hidden="true" />
      <div className="x-result__body" aria-hidden="true">
        <div className="skel x-skel-line x-skel-line--wide" />
        <div className="skel x-skel-line" />
        <div className="skel x-skel-line x-skel-line--short" />
      </div>
    </div>
  );
}

function GradeSelect({ id, label, value, disabled, onChange }: { id: string; label: string; value: Condition | null; disabled: boolean; onChange: (v: Condition | null) => void }) {
  const t = useTranslations("library");
  return (
    <div className="field x-item__grade">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <div className="select-wrap">
        <select id={id} className="select" value={value ?? ""} disabled={disabled} onChange={(e) => onChange((e.target.value || null) as Condition | null)}>
          <option value="">{t("notGraded")}</option>
          {CONDITIONS.map((c) => (
            <option key={c} value={c}>
              {t(`grades.${c}`)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function NotesEditor({ title, initial, onSave, onCancel }: { title: string; initial: string; onSave: (v: string | null) => void; onCancel: () => void }) {
  const t = useTranslations("library");
  const [draft, setDraft] = useState(initial);
  const id = useId();
  function submit(e: FormEvent) {
    e.preventDefault();
    onSave(draft.trim() === "" ? null : draft);
  }
  return (
    <form className="x-item__edit" onSubmit={submit}>
      <label className="field__label" htmlFor={id}>
        {t("notesFor", { title })}
      </label>
      <textarea id={id} className="textarea" rows={3} maxLength={NOTES_MAX} value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus aria-describedby={`${id}-help`} />
      <p className="x-note" id={`${id}-help`}>
        {t("notesLimit", { max: NOTES_MAX })}
      </p>
      <div className="x-actions">
        <Button type="submit" size="sm">
          {t("saveNotes")}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t("cancel")}
        </Button>
      </div>
    </form>
  );
}

/** One record on a list: Discogs data (or its loading / waiting / gone state) on top, the user's own data and actions below. */
export function LibraryItem({ item, card, busy, problem, onSaveNotes, onCondition, onMove, onRemove, onRetryDetails }: Props) {
  const t = useTranslations("library");
  const format = useFormatter();
  const [editing, setEditing] = useState(false);
  const gradeId = useId();

  const list: ListName = item.list;
  const title = card.kind === "ok" ? card.card.title : t("unknownTitle");
  const moveLabel = list === "wishlist" ? t("moveToCollection") : t("moveToWishlist");
  const added = format.dateTime(new Date(item.addedAt), { dateStyle: "medium" });

  const retry = (
    <Button variant="outline" size="sm" onClick={onRetryDetails}>
      {t("retry")}
    </Button>
  );

  return (
    <article className="card x-item" data-testid="library-item" data-release-id={item.releaseId} aria-busy={busy || undefined}>
      {card.kind === "loading" ? <Skeleton label={t("loadingDetails")} /> : null}

      {card.kind === "ok" ? (
        <div className="x-item__discogs">
          <Link href={`/release/${card.card.id}`} className="x-result__media" tabIndex={-1} aria-hidden="true">
            <Cover src={card.card.thumb} />
          </Link>
          <div className="x-result__body">
            <h3 className="x-result__title">
              <Link href={`/release/${card.card.id}`}>{card.card.title}</Link>
            </h3>
            <p className="x-result__meta">
              {[card.card.artist, card.card.year, card.card.country].filter(Boolean).join(" · ")}
            </p>
            {card.card.label || card.card.format ? (
              <p className="x-result__meta">{[card.card.label ? [card.card.label, card.card.catno].filter(Boolean).join(" ") : null, card.card.format].filter(Boolean).join(" · ")}</p>
            ) : null}
            <DiscogsAttribution href={card.card.discogsUrl} />
          </div>
        </div>
      ) : null}

      {card.kind === "gone" ? (
        <div className="x-item__discogs x-item__gone" data-testid="library-gone">
          <div className="x-cover x-cover--empty" aria-hidden="true">
            <DiscIcon />
          </div>
          <div className="x-result__body">
            <h3 className="x-result__title">{t("goneTitle")}</h3>
            <p className="x-result__meta">{t("goneId", { id: item.releaseId })}</p>
            <p className="x-note">{t("goneText")}</p>
          </div>
        </div>
      ) : null}

      {card.kind === "pending" || card.kind === "error" ? (
        <div className="x-item__discogs" data-testid="library-unresolved">
          <div className="x-cover x-cover--empty" aria-hidden="true">
            <DiscIcon />
          </div>
          <div className="x-result__body">
            <h3 className="x-result__title">{t("goneId", { id: item.releaseId })}</h3>
            {card.kind === "pending" ? (
              <StatusMessage tone="throttled" title={t("waitingTitle")} actions={retry}>
                {t("waitingText")}
              </StatusMessage>
            ) : (
              <StatusMessage tone="warning" title={t("itemErrorTitle")} actions={card.unconfigured ? undefined : retry}>
                {card.unconfigured ? t("itemUnconfiguredText") : t("itemErrorText")}
              </StatusMessage>
            )}
          </div>
        </div>
      ) : null}

      <div className="x-item__own">
        <p className="x-note">{t("addedOn", { date: added })}</p>

        {editing ? (
          <NotesEditor
            title={title}
            initial={item.notes ?? ""}
            onCancel={() => setEditing(false)}
            onSave={(v) => {
              setEditing(false);
              onSaveNotes(v);
            }}
          />
        ) : (
          <div className="x-item__notes">
            <p className="x-item__notes-text" data-testid="item-notes">
              {item.notes ? item.notes : <span className="x-note">{t("noNotes")}</span>}
            </p>
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)} aria-label={`${item.notes ? t("editNotes") : t("addNotes")}: ${title}`}>
              {item.notes ? t("editNotes") : t("addNotes")}
            </Button>
          </div>
        )}

        {list === "collection" ? (
          <div className="x-item__grades">
            <GradeSelect id={`${gradeId}-media`} label={t("mediaCondition")} value={item.conditionMedia} disabled={busy} onChange={(v) => onCondition("conditionMedia", v)} />
            <GradeSelect id={`${gradeId}-sleeve`} label={t("sleeveCondition")} value={item.conditionSleeve} disabled={busy} onChange={(v) => onCondition("conditionSleeve", v)} />
          </div>
        ) : null}

        {problem ? <StatusMessage tone="error">{problem}</StatusMessage> : null}

        <div className="x-actions">
          <Button variant="outline" size="sm" disabled={busy} onClick={onMove} aria-label={t("moveAria", { action: moveLabel, title })}>
            {moveLabel}
          </Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={(e) => onRemove(e.currentTarget)} aria-label={t("removeAria", { title })}>
            {t("remove")}
          </Button>
        </div>
      </div>
    </article>
  );
}
