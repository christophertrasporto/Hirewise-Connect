import type { TermsVersionRecord } from "@/server/repositories/terms.repository";
import type { TermsAudience, TermsSection } from "@/server/terms/placeholder-terms";

export type TermsSectionView = TermsSection & { number: number; relevant: boolean };

export type TermsDocumentView = {
  id: string;
  type: string;
  version: number;
  title: string;
  effectiveFrom: Date;
  checksum: string;
  isMaterialChange: boolean;
  requiresReacceptance: boolean;
  changeNote: string | null;
  sections: TermsSectionView[];
};

/** Sections stored on the row, or the whole body as one section for versions published without sections. */
export function sectionsOf(row: Pick<TermsVersionRecord, "sections" | "bodyMarkdown" | "title">): TermsSection[] {
  const raw = row.sections as unknown;
  if (Array.isArray(raw) && raw.length) {
    const items = (raw as unknown[]).filter((s): s is Record<string, unknown> => !!s && typeof s === "object" && !Array.isArray(s));
    return items.map((s, i) => {
      const audiences = Array.isArray(s.audiences) ? (s.audiences as unknown[]).filter((a): a is TermsAudience => typeof a === "string") : (["ALL"] as TermsAudience[]);
      return {
        key: typeof s.key === "string" ? s.key : `section-${i + 1}`,
        title: typeof s.title === "string" ? s.title : `Section ${i + 1}`,
        audiences: audiences.length ? audiences : (["ALL"] as TermsAudience[]),
        bodyMarkdown: typeof s.bodyMarkdown === "string" ? s.bodyMarkdown : "",
      };
    });
  }
  return [{ key: "body", title: row.title, audiences: ["ALL"], bodyMarkdown: row.bodyMarkdown }];
}

/** Public document view: no user data, every section, with the reader's relevant sections marked. */
export function toTermsDocumentView(row: TermsVersionRecord, audiences: TermsAudience[]): TermsDocumentView {
  return {
    id: row.id,
    type: row.type,
    version: row.version,
    title: row.title,
    effectiveFrom: row.effectiveFrom,
    checksum: row.bodyChecksum,
    isMaterialChange: row.isMaterialChange,
    requiresReacceptance: row.requiresReacceptance,
    changeNote: row.changeNote,
    sections: sectionsOf(row).map((s, i) => ({ ...s, number: i + 1, relevant: s.audiences.includes("ALL") || s.audiences.some((a) => audiences.includes(a)) })),
  };
}

/** Admin list row for a version. */
export function toTermsVersionAdminView(row: TermsVersionRecord & { _count: { acceptances: number } }) {
  return {
    id: row.id,
    type: row.type,
    version: row.version,
    title: row.title,
    isActive: row.isActive,
    effectiveFrom: row.effectiveFrom,
    publishedAt: row.publishedAt,
    isMaterialChange: row.isMaterialChange,
    requiresReacceptance: row.requiresReacceptance,
    privacyPolicyMode: row.privacyPolicyMode,
    requiredForRoles: row.requiredForRoles,
    changeNote: row.changeNote,
    acceptances: row._count.acceptances,
    placeholder: row.bodyMarkdown.includes("LEGAL_PLACEHOLDER"),
    sections: sectionsOf(row),
  };
}
