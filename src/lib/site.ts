export const site = {
  name: "Hirewise Connect",
  company: "Hirewise Virtual Assistance Services",
  tagline: "Hire verified virtual assistants, not résumés.",
  email: "hello@hirewise.example",
};

export const nav = [
  { href: "/for-clients", label: "For clients" },
  { href: "/for-talent", label: "For talent" },
  { href: "/academy", label: "Academy" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/about", label: "About" },
];

export const footerNav: { heading: string; links: { href: string; label: string }[] }[] = [
  {
    heading: "Platform",
    links: [
      { href: "/for-clients", label: "For clients" },
      { href: "/for-talent", label: "For talent" },
      { href: "/academy", label: "VA Academy" },
      { href: "/how-it-works", label: "How it works" },
    ],
  },
  {
    heading: "Company",
    links: [
      { href: "/about", label: "About Hirewise" },
      { href: "/contact", label: "Contact" },
      { href: "/login", label: "Log in" },
      { href: "/register", label: "Create account" },
    ],
  },
  {
    heading: "Policies",
    links: [
      { href: "/legal/terms", label: "Terms of Service" },
      { href: "/legal/privacy", label: "Privacy Policy" },
      { href: "/legal/hiring-terms", label: "Hiring Terms" },
      { href: "/legal/non-circumvention", label: "Non-Circumvention Policy" },
      { href: "/legal/communication-policy", label: "Communication Policy" },
    ],
  },
];

export const flow = [
  { step: "Learn", who: "talent", text: "Agents complete courses in the Hirewise VA Academy." },
  { step: "Certify", who: "talent", text: "Hirewise coaches assess and certify with structured scores." },
  { step: "Showcase", who: "talent", text: "Certifications, videos, and recordings appear on the Connect profile." },
  { step: "Discover", who: "client", text: "Clients search qualified talent with evidence-based filters." },
  { step: "Shortlist", who: "client", text: "Clients save, compare, and annotate candidates." },
  { step: "Interview", who: "hirewise", text: "Hirewise Sales coordinates every interview." },
  { step: "Select", who: "client", text: "The client chooses their preferred talent." },
  { step: "Contract", who: "hirewise", text: "Hirewise finalises the commercial agreement." },
  { step: "Pay", who: "client", text: "The client pays the required deposit." },
  { step: "Deploy", who: "hirewise", text: "Hirewise deploys and manages the agent." },
] as const;

export const verificationLadder = [
  { level: "Profile Submitted", detail: "Registration and agreements complete." },
  { level: "Profile Verified", detail: "Identity, résumé, and experience reviewed by Hirewise." },
  { level: "Skills Assessed", detail: "Structured coach assessment on record." },
  { level: "Hirewise Certified", detail: "At least one Academy certification approved." },
  { level: "Interview Ready", detail: "Approved video, voice sample, and published rate." },
  { level: "Deployment Ready", detail: "All requirements met. Can be placed immediately." },
];

export const courses = [
  "Cold Calling",
  "Appointment Setting",
  "Sales",
  "Customer Service",
  "Virtual Assistance",
  "CRM",
  "Lead Generation",
  "Communication",
  "Leadership",
  "Campaign-Specific Training",
];
