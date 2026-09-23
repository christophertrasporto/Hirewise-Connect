/** Shared option lists for forms. Taxonomies (skills, software) come from the database. */

export const SERVICES = [
  "Cold Calling",
  "Appointment Setting",
  "Lead Generation",
  "Sales",
  "Customer Service",
  "Technical Support",
  "Virtual Assistance",
  "Executive Assistance",
  "Bookkeeping",
  "Social Media",
  "Data Entry",
  "Other",
];

export const INDUSTRIES = [
  "Real Estate",
  "Insurance",
  "Solar / Energy",
  "Healthcare",
  "E-commerce",
  "SaaS / Technology",
  "Financial Services",
  "Legal",
  "Marketing Agency",
  "Logistics",
  "Education",
  "Hospitality",
  "Construction",
  "Other",
];

export const COUNTRIES = ["United States", "Australia", "United Kingdom", "Canada", "New Zealand", "Philippines", "Singapore", "United Arab Emirates", "Other"];

export const TIMEZONES = [
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Toronto",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Manila",
  "Australia/Perth",
  "Australia/Sydney",
  "Pacific/Auckland",
];

export const AGENT_ROLES = [
  "Cold Caller",
  "Appointment Setter",
  "Sales Development Representative",
  "Customer Service Representative",
  "Technical Support Representative",
  "Virtual Assistant",
  "Executive Assistant",
  "Bookkeeper",
  "Social Media Manager",
  "Lead Generation Specialist",
  "Transaction Coordinator",
  "Team Lead",
];

export const LANGUAGES = ["English", "Filipino", "Spanish", "Mandarin", "Cebuano", "French", "German", "Arabic", "Japanese"];

export const SHIFTS = ["US Day (PH Night)", "US Night (PH Day)", "AU Day", "UK Day", "Flexible", "Weekends"];

export const EXPERIENCE_LEVELS: Array<{ value: "ENTRY" | "JUNIOR" | "MID" | "SENIOR" | "LEAD"; label: string }> = [
  { value: "ENTRY", label: "Entry (0–1 years)" },
  { value: "JUNIOR", label: "Junior (1–2 years)" },
  { value: "MID", label: "Mid (2–5 years)" },
  { value: "SENIOR", label: "Senior (5+ years)" },
  { value: "LEAD", label: "Lead / Supervisor" },
];

export const SKILL_LEVELS: Array<{ value: "BASIC" | "INTERMEDIATE" | "ADVANCED" | "EXPERT"; label: string }> = [
  { value: "BASIC", label: "Basic" },
  { value: "INTERMEDIATE", label: "Intermediate" },
  { value: "ADVANCED", label: "Advanced" },
  { value: "EXPERT", label: "Expert" },
];

export const RECORDING_KINDS: Array<{ value: "INTRODUCTION" | "COLD_CALL" | "CUSTOMER_SERVICE" | "SALES" | "CUSTOM_CAMPAIGN"; label: string }> = [
  { value: "INTRODUCTION", label: "Introduction" },
  { value: "COLD_CALL", label: "Cold calling sample" },
  { value: "CUSTOMER_SERVICE", label: "Customer service sample" },
  { value: "SALES", label: "Sales sample" },
  { value: "CUSTOM_CAMPAIGN", label: "Custom campaign sample" },
];

export const STATUS_LABELS: Record<string, string> = {
  AWAITING_AGREEMENT: "Awaiting agreement",
  AWAITING_DEPOSIT: "Awaiting deposit",
  DEPLOYMENT_PREP: "Deployment prep",
  CANCELLED: "Cancelled",
  PARTIALLY_PAID: "Partially paid",
  ISSUED: "Issued",
  VOID: "Void",
  HOURLY: "per hour",
  MONTHLY: "per month",
  BANK_TRANSFER: "Bank transfer",
  CARD: "Card",
  PAYPAL: "PayPal",
  OTHER: "Other",
  ONE_MONTH: "One month",
  TWO_WEEKS: "Two weeks",
  FIXED: "Fixed amount",
  PERCENTAGE: "Percentage of a month",
  CUSTOM: "Custom amount",
  PENDING_APPROVAL: "Pending approval",
  PUBLISHED: "Published",
  ARCHIVED: "Archived",
  ENROLLED: "Enrolled",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  WITHDRAWN: "Withdrawn",
  NOT_REQUIRED: "Free",
  PENDING: "Payment pending",
  PAID: "Paid",
  WAIVED: "Waived",
  FINAL: "Final",
  EXPIRED: "Expired",
  REVOKED: "Revoked",
  ACADEMY: "Academy",
  ADMIN_ISSUED: "Issued by admin",
  examScore: "Exam",
  practicalScore: "Practical",
  roleplayScore: "Role-play",
  communicationScore: "Communication",
  EXAM: "Exam",
  PRACTICAL: "Practical",
  ROLEPLAY: "Role-play",
  MOCK_CALL: "Mock call",
  SKILL: "Skill check",
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  UNDER_REVIEW: "Under review",
  APPROVED: "Approved",
  REVISION_REQUIRED: "Revision required",
  REJECTED: "Rejected",
  HIDDEN: "Hidden",
  SUSPENDED: "Suspended",
  RETIRED: "Retired",
  UPLOADED: "Uploaded",
  PENDING_REVIEW: "Pending review",
  ACTIVE: "Active",
  AVAILABLE: "Available",
  AVAILABLE_SOON: "Available soon",
  INTERVIEWING: "Interviewing",
  RESERVED: "Reserved",
  PLACED: "Placed",
  UNAVAILABLE: "Unavailable",
  PAUSED: "Paused",
  PROFILE_SUBMITTED: "Profile submitted",
  PROFILE_VERIFIED: "Profile verified",
  SKILLS_ASSESSED: "Skills assessed",
  HIREWISE_CERTIFIED: "Hirewise certified",
  INTERVIEW_READY: "Interview ready",
  DEPLOYMENT_READY: "Deployment ready",
};

export function labelFor(status: string) {
  return STATUS_LABELS[status] ?? status;
}
