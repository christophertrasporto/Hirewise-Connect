"use client";

import { useEffect } from "react";

/**
 * When a public page was opened with ?ref=CODE, tells the server once so the referral cookie is set, then removes the code
 * from the address bar (the cookie now carries it, and a copied address stays clean). Renders nothing. Used on every public
 * Academy page: catalog, category, course, and coach pages.
 */
export function ReferralCapture() {
  useEffect(() => {
    let ref: string | null = null;
    try {
      const url = new URL(window.location.href);
      ref = url.searchParams.get("ref");
      if (!ref) return;
      void fetch("/api/referral/capture", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ref, path: window.location.pathname }), keepalive: true }).catch(() => undefined);
    } catch {
      // A blocked network call must never affect the page.
    }
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("ref");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    } catch {
      // Leaving the code in the address bar is harmless.
    }
  }, []);
  return null;
}
