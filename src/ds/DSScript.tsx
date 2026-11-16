"use client";

import Script from "next/script";

/** Loads the vendored design-system behaviour layer and announces when window.DS is ready. */
export function DSScript() {
  return (
    <Script
      src="/ds/components/bundle.js"
      strategy="afterInteractive"
      onReady={() => {
        window.dispatchEvent(new Event("ds:ready"));
      }}
    />
  );
}
