"use client";

import { useEffect } from "react";

/** When the page was opened with ?ref=CODE, tells the server once so the referral cookie is set; renders nothing. */
export function ReferralCapture() {
  useEffect(() => {
    try {
      const ref = new URLSearchParams(window.location.search).get("ref");
      if (!ref) return;
      void fetch("/api/referral/capture", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ref, path: window.location.pathname }), keepalive: true });
    } catch {
      // A blocked network call must never affect the page.
    }
  }, []);
  return null;
}
