"use client";

import { useTranslations } from "next-intl";
import { useState, useSyncExternalStore } from "react";
import { Button } from "@/ds/Button";

/**
 * "How to search": a collapsible block above the search form. For a first-time visitor it is open on a desktop and COLLAPSED on a
 * phone (640 px wide or less, where it would push the form off the screen); once they close it, it stays closed on this device. The one setting lives in the browser's local storage (key below, value "closed"), is never sent anywhere and
 * is not a cookie; the privacy page says so. Closing it again and opening it removes the setting.
 */
const KEY = "vinilium:search-help";
export const HELP_ID = "search-help";

const listeners = new Set<() => void>();
/** What was chosen in this page's lifetime; covers a browser that blocks storage (the choice then lasts until the page is reloaded). */
let chosen: boolean | null = null;
/** Phone-sized screens: the block starts collapsed there unless the person opened it during this page's lifetime. */
export const PHONE_QUERY = "(max-width: 640px)";
const onPhone = () => typeof window.matchMedia === "function" && window.matchMedia(PHONE_QUERY).matches;
const isClosed = () => {
  if (chosen !== null) return chosen;
  try {
    if (window.localStorage.getItem(KEY) === "closed") return true;
  } catch {
    /* storage blocked: behave like a first visit */
  }
  return onPhone(); // a first visit: collapsed on a phone, open elsewhere
};
function remember(closed: boolean) {
  chosen = closed;
  try {
    if (closed) window.localStorage.setItem(KEY, "closed");
    else window.localStorage.removeItem(KEY);
  } catch {
    /* storage blocked: the block still opens and closes, it just is not remembered */
  }
  listeners.forEach((l) => l());
}
function subscribe(onChange: () => void) {
  listeners.add(onChange);
  const onStorage = () => {
    chosen = null; // another tab changed the setting: it wins over what this page chose earlier
    onChange();
  };
  window.addEventListener("storage", onStorage);
  // Rotating a phone or resizing the window across the breakpoint changes the default (a choice made on this page still wins).
  const mq = typeof window.matchMedia === "function" ? window.matchMedia(PHONE_QUERY) : null;
  mq?.addEventListener("change", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
    mq?.removeEventListener("change", onChange);
  };
}

/** Open the help (from "Show search tips" on an empty result) without changing what is remembered. */
export function openSearchHelp() {
  const details = document.getElementById(HELP_ID) as HTMLDetailsElement | null;
  if (!details) return;
  details.open = true;
  const summary = details.querySelector("summary");
  summary?.scrollIntoView({ block: "center" });
  summary?.focus();
}

export function SearchHelp({ onExample }: { onExample: () => void }) {
  const t = useTranslations("finder.help");
  // Server and first render: closed markup (so a returning visitor never sees it flash open). A first-time visitor's browser then
  // reports "not closed" and the block opens right after hydration.
  const closed = useSyncExternalStore(subscribe, isClosed, () => true);
  const [filled, setFilled] = useState(false);

  return (
    <details id={HELP_ID} className="x-help" open={!closed}>
      <summary
        className="x-help__summary"
        onClick={(e) => {
          // A click (or Enter / Space) on the summary is the person's own choice. We do the toggling ourselves: if the browser did
          // it after React had re-rendered from the new setting, the two would undo each other.
          e.preventDefault();
          const details = e.currentTarget.parentElement as HTMLDetailsElement;
          const closing = details.open;
          details.open = !closing;
          remember(closing);
        }}
      >
        <span>{t("title")}</span>
      </summary>

      <p>{t("intro")}</p>
      <ul className="x-help__list">
        <li>{t("way1")}</li>
        <li>{t("way2")}</li>
        <li>{t("way3")}</li>
      </ul>

      <p className="x-help__label">{t("flowTitle")}</p>
      <ol className="x-help__list">
        <li>{t("flow1")}</li>
        <li>{t("flow2")}</li>
        <li>{t("flow3")}</li>
        <li>{t("flow4")}</li>
        <li>{t("flow5")}</li>
      </ol>

      <p className="x-help__label">{t("tipsTitle")}</p>
      <ul className="x-help__list">
        <li>{t("tip1")}</li>
        <li>{t("tip2")}</li>
        <li>{t("tip3")}</li>
        <li>{t("tip4")}</li>
        <li>{t("tip5")}</li>
        <li>{t("tip6")}</li>
      </ul>

      <div className="x-help__example">
        <span>{t("exampleLine")}</span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            onExample();
            setFilled(true);
          }}
        >
          {t("exampleButton")}
        </Button>
      </div>
      {/* Always in the page, so a screen reader announces the change. */}
      <p className="x-note" role="status">
        {filled ? t("exampleDone") : ""}
      </p>
    </details>
  );
}
