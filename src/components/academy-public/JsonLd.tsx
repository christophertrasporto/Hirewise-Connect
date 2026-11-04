import { jsonLd } from "@/lib/seo";

/** Structured data for search engines. `data` is built by the helpers in `@/lib/seo` from our own records. */
export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(data) }} />;
}
