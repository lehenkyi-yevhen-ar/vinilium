"use client";

import { useEffect, type DependencyList, type RefObject } from "react";

/** Run `cb` once window.DS (bundle.js) is available; returns a cleanup. */
export function whenDSReady(cb: (ds: NonNullable<Window["DS"]>) => void): () => void {
  if (window.DS) {
    cb(window.DS);
    return () => {};
  }
  const onReady = () => window.DS && cb(window.DS);
  window.addEventListener("ds:ready", onReady, { once: true });
  return () => window.removeEventListener("ds:ready", onReady);
}

/**
 * Wires the design system's behaviour (dropdowns, modals, tabs, tooltips…) inside `ref`.
 * Equivalent of the upstream `DS.useDS`, which we can't use because it needs a global React.
 * DS.init is idempotent, so calling it again after a re-render is safe.
 */
export function useDS(ref: RefObject<HTMLElement | null>, deps: DependencyList = []) {
  useEffect(() => {
    return whenDSReady((ds) => {
      if (ref.current) ds.init(ref.current);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
