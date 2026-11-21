import Link from "next/link";
import { ExternalLink, PlayCircle } from "lucide-react";
import { Card } from "@/components/app/ui";
import { PARTNER_BUTTON_LABEL, PARTNER_DISCLOSURE, partnerPriceText } from "@/lib/partner-course";

/**
 * What a signed-in learner sees instead of Enrol or Checkout for a partner course: it is taught on another site, so there is
 * nothing to enrol in or pay for here. The button is the same one the public page has (a counted redirect, in a new tab).
 */
export function PartnerCoursePanel({ partner }: { partner: { provider: string | null; priceLabel: string | null; goPath: string; pagePath: string } }) {
  return (
    <Card title="Taught on a partner's site" description={partner.provider ? `This course is offered by ${partner.provider}.` : undefined}>
      <p className="font-display text-[1.5rem] font-extrabold text-ink-900">{partnerPriceText(partner.provider, partner.priceLabel)}</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <a href={partner.goPath} target="_blank" rel="sponsored nofollow noopener" className="inline-flex h-11 items-center gap-2 rounded-full bg-brand-500 px-5 text-[14.5px] font-semibold text-white shadow-soft hover:bg-brand-600">
          {PARTNER_BUTTON_LABEL} <ExternalLink className="h-4 w-4" />
        </a>
        <Link href={partner.pagePath} className="inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-brand-700 hover:text-brand-800">
          <PlayCircle className="h-4 w-4" /> Watch the free preview
        </Link>
      </div>
      <p className="mt-4 text-[13px] leading-relaxed text-ink-500">{PARTNER_DISCLOSURE}</p>
    </Card>
  );
}
