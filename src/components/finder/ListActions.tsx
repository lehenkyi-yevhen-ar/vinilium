"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "@/ds/Button";
import { StatusMessage } from "@/ds/StatusMessage";
import { SignInRequired } from "./SignInRequired";

type ListName = "wishlist" | "collection";
type Where = { kind: "loading" } | { kind: "ready"; list: ListName | null } | { kind: "signin" } | { kind: "error" };

interface ItemBody {
  item: { list: ListName } | null;
  result?: "added" | "moved" | "unchanged";
}

async function call(releaseId: number, method: "GET" | "PUT" | "DELETE", list?: ListName, signal?: AbortSignal) {
  const res = await fetch(`/api/lists/items/${releaseId}`, {
    method,
    signal,
    credentials: "same-origin",
    headers: list ? { "content-type": "application/json" } : undefined,
    body: list ? JSON.stringify({ list }) : undefined,
  });
  if (res.status === 401) return { status: "signin" as const };
  if (!res.ok) return { status: "error" as const };
  return { status: "ok" as const, body: (await res.json()) as ItemBody };
}

/**
 * Add to Wishlist / Add to Collection for one pressing. One list per pressing: when it is already on the other list
 * the button says "Move", and it is a single update on the server. Talks to the real /api/lists/items API.
 */
export function ListActions({ releaseId }: { releaseId: number }) {
  const t = useTranslations("lists");
  const [where, setWhere] = useState<Where>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    call(releaseId, "GET", undefined, ac.signal)
      .then((r) => setWhere(r.status === "ok" ? { kind: "ready", list: r.body.item?.list ?? null } : r.status === "signin" ? { kind: "signin" } : { kind: "error" }))
      .catch(() => {});
    return () => ac.abort();
  }, [releaseId]);

  async function put(list: ListName) {
    setBusy(true);
    setFailed(false);
    setMessage(null);
    const r = await call(releaseId, "PUT", list).catch(() => ({ status: "error" as const }));
    setBusy(false);
    if (r.status === "ok") {
      setWhere({ kind: "ready", list });
      setMessage(t(r.body.result === "moved" ? "moved" : "added", { list: t(list) }));
    } else if (r.status === "signin") setWhere({ kind: "signin" });
    else setFailed(true);
  }

  async function remove() {
    setBusy(true);
    setFailed(false);
    setMessage(null);
    const r = await call(releaseId, "DELETE").catch(() => ({ status: "error" as const }));
    setBusy(false);
    if (r.status === "ok") {
      setWhere({ kind: "ready", list: null });
      setMessage(t("removed"));
    } else if (r.status === "signin") setWhere({ kind: "signin" });
    else setFailed(true);
  }

  if (where.kind === "signin") return <SignInRequired expired compact next="/search" />;

  const list = where.kind === "ready" ? where.list : null;
  return (
    <section className="x-section x-lists" aria-labelledby={`lists-h-${releaseId}`}>
      <h2 id={`lists-h-${releaseId}`}>{t("heading")}</h2>

      {where.kind === "loading" ? <p className="x-note">{t("loading")}</p> : null}
      {where.kind === "error" ? <StatusMessage tone="error">{t("error")}</StatusMessage> : null}

      {where.kind === "ready" ? (
        <>
          {list ? (
            <p>
              <span className="badge badge--success" data-testid="list-state">
                {list === "wishlist" ? t("inWishlist") : t("inCollection")}
              </span>
            </p>
          ) : null}
          <div className="x-actions">
            {list !== "wishlist" ? (
              <Button variant={list ? "outline" : "primary"} loading={busy} onClick={() => put("wishlist")}>
                {list === "collection" ? t("moveToWishlist") : t("addWishlist")}
              </Button>
            ) : null}
            {list !== "collection" ? (
              <Button variant={list ? "outline" : "secondary"} loading={busy} onClick={() => put("collection")}>
                {list === "wishlist" ? t("moveToCollection") : t("addCollection")}
              </Button>
            ) : null}
            {list ? (
              <Button variant="ghost" loading={busy} onClick={remove}>
                {t("remove")}
              </Button>
            ) : null}
          </div>
          <p className="x-note">{t("note")}</p>
        </>
      ) : null}

      {failed ? <StatusMessage tone="error">{t("error")}</StatusMessage> : null}
      <p className="x-note" role="status" aria-live="polite">
        {message}
      </p>
    </section>
  );
}
