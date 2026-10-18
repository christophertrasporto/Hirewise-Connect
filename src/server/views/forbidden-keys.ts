/**
 * Keys that must never appear in the named audience's projections (Section 12).
 * Projection tests feed a fixture containing every key and assert none survive.
 */
export const FORBIDDEN_FOR_CLIENT = [
  "fullLegalName",
  "personalEmail",
  "phone",
  "addressLine",
  "resumeKey",
  "governmentIdRefs",
  "privateContact",
  "passwordHash",
  "mfaSecretEnc",
  "reviewFeedback",
  "salesNotes",
  "internalFeedback",
  "positioningNotes",
  "agentCompensationId",
  "compensation",
  "userId",
  "user",
  // Academy internals (Section 6, footnote 3; INV-I1)
  "correctIndex",
  "comments",
  "areasForImprovement",
  "certificationRecommended",
  "coachUserId",
  "revokedReason",
  "priceCents",
  "paidCents",
  "paymentReference",
  // Commercial (INV-C1, INV-C2, footnote 7)
  "agentCompensation",
  "decisionReason",
  "proposedBy",
  "monthlyCompensation",
  "margin",
  // Identity phase 1: the platform identity never leaves Hirewise
  "platformIdentity",
  "platformIdentityId",
  "identityContacts",
  "idVerificationRefs",
  "duplicateFlags",
  "attemptedData",
  // Client protection phase 5: agent-chosen names, real agency identity, raw storage keys and links
  "displayName",
  "logoKey",
  "website",
  "contactEmail",
  "contactPhone",
  "registrationDetails",
  "billingEmail",
  "storageKey",
  "originalStorageKey",
  "sanitizedStorageKey",
  "url",
  "meetingProvider",
  "meetingExternalId",
  "primaryAgency",
  "primaryAgencyId",
  "ownerUserId",
] as const;

/**
 * Keys that must never appear in anything an Agency Owner or Manager receives (Identity phase 1 starts the list;
 * client-facing identity and commercial masking extend it in later phases).
 */
export const FORBIDDEN_FOR_AGENCY = [
  "platformIdentity",
  "platformIdentityId",
  "identityContacts",
  "idVerificationRefs",
  "duplicateFlags",
  "privateContact",
  "fullLegalName",
  "personalEmail",
  "addressLine",
  "governmentIdRefs",
  "passwordHash",
  "mfaSecretEnc",
  "clientBillingRate",
  "billingRate",
  "agentCompensation",
  "compensation",
  "salesNotes",
  "internalFeedback",
  "reviewFeedback",
  "businessEmail",
  // Client protection phase 5: client identity reaches agencies only through a disclosure grant
  "companyName",
] as const;

export const FORBIDDEN_FOR_AGENT = [
  "phone", // client contact phone
  "businessEmail",
  "budgetMin",
  "budgetMax",
  "salesNotes",
  "internalFeedback",
  "positioningNotes",
  "clientBillingRate",
  "billingRate",
  "accountManagerUserId",
  "passwordHash",
  "mfaSecretEnc",
  // Commercial (INV-C2): amounts the client pays never reach the agent
  "clientBillingRateId",
  "clientRate",
  "deposit",
  "invoices",
  "requiredAmount",
  "positioningNotes",
  "monthlyBilling",
] as const;

/** Recursively collects every key in an object graph. */
export function collectKeys(value: unknown, acc = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => collectKeys(v, acc));
  else if (value && typeof value === "object" && !(value instanceof Date)) {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      acc.add(k);
      collectKeys(v, acc);
    }
  }
  return acc;
}
