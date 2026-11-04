import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/site-url";

/**
 * Everything signed-in, financial, or internal stays out of search results. The public Academy (`/academy`, `/coaches`)
 * and the marketing pages are open. Unlisted courses are open to anyone with the link but carry a noindex tag.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/academy", "/coaches"],
        disallow: ["/api/", "/staff/", "/dashboard", "/courses", "/wallet", "/account", "/billing", "/profile", "/messages", "/notifications", "/onboarding", "/refer", "/agency", "/coach", "/company", "/interviews", "/opportunities", "/partners", "/placements", "/shortlist", "/talent", "/certificates", "/login", "/register", "/join", "/forgot-password", "/reset-password", "/mfa", "/agreements", "/verify-email"],
      },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
