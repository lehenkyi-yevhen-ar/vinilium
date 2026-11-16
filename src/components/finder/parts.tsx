"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/ds/Button";
import { DiscIcon } from "@/ds/icons";
import { StatusMessage } from "@/ds/StatusMessage";
import { cx } from "@/ds/classes";
import { SignInRequired } from "./SignInRequired";
import type { Fetched } from "./use-discogs";

/**
 * Cover art from our image proxy. If the proxy says no (throttled, not found) or the image is missing, a neutral
 * placeholder takes its place: a failed thumbnail never breaks the page.
 */
export function Cover({ src, className }: { src: string | null; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className={cx("x-cover x-cover--empty", className)} aria-hidden="true">
        <DiscIcon />
      </div>
    );
  }
  return (
    // Plain <img>: the source is our own proxy route (already cached and rate limited), so next/image adds nothing.
    // eslint-disable-next-line @next/next/no-img-element
    <img className={cx("x-cover", className)} src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
  );
}

/** Placeholder rows that match the result cards, so the page does not jump when results arrive. */
export function ResultSkeleton({ rows = 6, label }: { rows?: number; label: string }) {
  return (
    <div className="x-result-grid" aria-busy="true" aria-label={label} role="status">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="card x-result" aria-hidden="true">
          <div className="skel x-cover" />
          <div className="x-result__body">
            <div className="skel x-skel-line x-skel-line--wide" />
            <div className="skel x-skel-line" />
            <div className="skel x-skel-line x-skel-line--short" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function PanelSkeleton({ label }: { label: string }) {
  return (
    <div className="x-card" aria-busy="true" aria-label={label} role="status">
      <div className="skel x-skel-line x-skel-line--wide x-skel-line--tall" />
      <div className="skel x-skel-line" />
      <div className="skel x-skel-line x-skel-line--short" />
    </div>
  );
}

function Countdown({ seconds, onDone, children }: { seconds: number; onDone: () => void; children: (left: number) => React.ReactNode }) {
  // The component is mounted fresh for every throttled state, so a lazy initial deadline is enough.
  const [deadline] = useState(() => Date.now() + seconds * 1000);
  const [now, setNow] = useState(() => Date.now());
  const fired = useRef(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  const left = Math.max(0, Math.ceil((deadline - now) / 1000));
  useEffect(() => {
    if (left === 0 && !fired.current) {
      fired.current = true;
      onDone();
    }
  }, [left, onDone]);

  return <>{children(left)}</>;
}

/**
 * Everything that is not "loading" or "ok": a clear message per case, with a countdown and an automatic retry when
 * we are being throttled. It never throws, so one block failing does not take the page down with it.
 */
export function Problem({ state, onRetry, compact }: { state: Fetched<unknown>; onRetry: () => void; compact?: boolean }) {
  const t = useTranslations("discogsStates");
  const retryButton = (
    <Button variant="outline" size="sm" onClick={onRetry}>
      {t("retryNow")}
    </Button>
  );

  switch (state.kind) {
    case "throttled":
      return (
        <Countdown seconds={state.retryAfter} onDone={onRetry}>
          {(left) => (
            <StatusMessage tone="throttled" title={t("throttledTitle")} actions={retryButton}>
              <p>{state.scope === "app" ? t("throttledApp") : t("throttledDiscogs")}</p>
              <p>{t("retryIn", { seconds: left })}</p>
            </StatusMessage>
          )}
        </Countdown>
      );
    case "unauthorized":
      return <SignInRequired expired compact={compact} />;
    case "not_found":
      return (
        <StatusMessage tone="info" title={t("notFoundTitle")}>
          {t("notFoundText")}
        </StatusMessage>
      );
    case "unconfigured":
      return (
        <StatusMessage tone="warning" title={t("errorTitle")}>
          {t("unconfiguredText")}
        </StatusMessage>
      );
    case "error":
      return (
        <StatusMessage tone="error" title={t("errorTitle")} actions={retryButton}>
          {t("errorText")}
        </StatusMessage>
      );
    default:
      return null;
  }
}

/** Search steps. `current` is 0-based; earlier steps show as done. */
export function Stepper({ current, label, steps }: { current: number; label: string; steps: string[] }) {
  return (
    <ol className="steps x-steps-bar" aria-label={label}>
      {steps.map((s, i) => (
        <li key={s} className={i < current ? "is-done" : i === current ? "is-current" : undefined} aria-current={i === current ? "step" : undefined}>
          {s}
        </li>
      ))}
    </ol>
  );
}
