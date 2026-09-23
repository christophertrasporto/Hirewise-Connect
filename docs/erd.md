# Entity relationship diagram

All phases. Phase 0: identity, clients, agents, agreements, operations. Phase 1: marketplace (shortlists, views, introductions). Phase 2: interview requests, interviews, messages, placements, reservations, flags. Phase 3: academy (courses, exams, enrollments, assessments, certifications, verification requirements). Phase 4: commercial (billing rates, compensation, rate history, deposit policies, deposits, invoices, payments, deployment checklist). Phase 5: incidents, saved searches. Keep this file current when the Prisma schema changes.

```mermaid
erDiagram
    Role ||--o{ User : "has"
    Role ||--o{ RolePermission : "grants"
    Permission ||--o{ RolePermission : "in"
    User ||--o{ UserPermissionOverride : "subject"
    Permission ||--o{ UserPermissionOverride : "grants"

    Client ||--o{ ClientContact : "has"
    Client ||--o| ClientOnboarding : "has"
    Client ||--o{ ClientRequirement : "posts"
    User ||--o| ClientContact : "logs in as"
    User ||--o{ Client : "account manager"

    User ||--o| AgentProfile : "owns"
    AgentProfile ||--o| AgentPrivateContact : "restricted"
    AgentProfile ||--o{ AgentSkill : "has"
    Skill ||--o{ AgentSkill : "in"
    AgentProfile ||--o{ Experience : "lists"
    AgentProfile ||--o{ IndustryExperience : "lists"
    AgentProfile ||--o{ SoftwareExperience : "lists"
    Software ||--o{ SoftwareExperience : "in"
    AgentProfile ||--o{ AgentAvailability : "history"
    AgentProfile ||--o{ Reservation : "held by"
    Client ||--o{ Reservation : "for"
    AgentProfile ||--o{ Video : "uploads"
    AgentProfile ||--o{ Recording : "uploads"
    AgentProfile ||--o{ Portfolio : "uploads"

    Agreement ||--o{ AgreementAcceptance : "accepted as"
    User ||--o{ AgreementAcceptance : "accepts"

    User ||--o{ Notification : "receives"
    User ||--o{ NotificationPreference : "sets"
    User ||--o{ Document : "uploads"
    User ||--o{ Setting : "updates"

    AuditLog {
        string action
        string entityType
        string entityId
        json previousValue
        json newValue
        string reason
    }
    OutboxEvent {
        string type
        json payload
        datetime processedAt
    }
    Job {
        string type
        json payload
        datetime runAt
        enum status
    }
```

## Notes on sensitive tables

| Table | Rule |
|---|---|
| `AgentPrivateContact` | Read requires `agent.read_private_contact`. Never joined into client-facing views (INV-P1). |
| `ClientContact.phone` | Never in agent-facing views (INV-P2). |
| `AuditLog` | Append-only. Trigger rejects UPDATE and DELETE (INV-I3). |
| `AgreementAcceptance` | Stores agreement version, body checksum, IP, and user agent (INV-I2). |
| `Reservation` | Partial unique index: one `ACTIVE` reservation per agent. |
| `Video`, `Recording`, `Portfolio` | Only `APPROVED` rows appear in client projections. `reviewFeedback` is never client-visible. |

## Planned (not yet in schema)

Phase 1: `Shortlist`, `ShortlistCandidate`, `CandidateView`, `Introduction`, `AdminNote`, `Session`.
Phase 2: `InterviewRequest`, `InterviewRequestCandidate`, `Interview`, `InterviewMessage`, `Placement`, `DeploymentChecklist*`, `Task`, `Incident`, `ActivityFlag`.
Phase 3: `AcademyCourse`, `CourseCoach`, `TrainingGroup*`, `CourseEnrollment`, `CourseCompletion`, `Assessment`, `AssessmentResultLabel`, `CoachEvaluation`, `CertificationTemplate`, `Certification`, `CertificationRequirement`, `VerificationRequirement`.
Phase 4: `ClientBillingRate`, `AgentCompensation`, `RateHistory`, `DepositPolicy`, `Deposit`, `Invoice`, `Payment`.

## Phases 1–5 additions

```mermaid
erDiagram
    Client ||--o{ Shortlist : "owns"
    Shortlist ||--o{ ShortlistCandidate : "lists"
    AgentProfile ||--o{ ShortlistCandidate : "in"
    Client ||--o{ CandidateView : "views"
    Client ||--o{ Introduction : "ledger"
    Client ||--o{ InterviewRequest : "raises"
    ClientRequirement ||--o{ InterviewRequest : "for"
    InterviewRequest ||--o{ InterviewRequestCandidate : "has"
    InterviewRequest ||--o{ Interview : "schedules"
    InterviewRequest ||--o{ InterviewMessage : "thread"
    Interview ||--o| Placement : "selected into"
    Client ||--o{ Placement : "has"
    AgentProfile ||--o{ Placement : "placed"
    ClientBillingRate ||--o{ Placement : "snapshot"
    AgentCompensation ||--o{ Placement : "snapshot (restricted)"
    Placement ||--o| Deposit : "requires"
    DepositPolicy ||--o{ Deposit : "computed by"
    Placement ||--o{ Invoice : "bills"
    Deposit ||--o{ Invoice : "invoiced as"
    Client ||--o{ Invoice : "pays"
    Invoice ||--o{ Payment : "settled by"
    Placement ||--o{ DeploymentChecklistItem : "checklist"
    AgentProfile ||--o{ ClientBillingRate : "priced"
    AgentProfile ||--o{ AgentCompensation : "paid"
    User ||--o{ RateHistory : "changes"
    User ||--o{ AcademyCourse : "coaches (owner)"
    AcademyCourse ||--o{ CourseCoach : "co-coached"
    AcademyCourse ||--o| Exam : "has"
    Exam ||--o{ ExamQuestion : "asks"
    AcademyCourse ||--o{ CourseEnrollment : "enrols"
    AgentProfile ||--o{ CourseEnrollment : "takes"
    CourseEnrollment ||--o| CourseCompletion : "completes"
    CourseEnrollment ||--o{ ExamAttempt : "attempts"
    AgentProfile ||--o{ Assessment : "assessed"
    AssessmentResultLabel ||--o{ Assessment : "labelled"
    AgentProfile ||--o{ CoachEvaluation : "evaluated"
    CertificationTemplate ||--o{ AcademyCourse : "awarded by"
    CertificationTemplate ||--o{ Certification : "instances"
    AgentProfile ||--o{ Certification : "holds"
    Assessment ||--o{ Certification : "supports"
    User ||--o{ ActivityFlag : "flagged"
    User ||--o{ Incident : "subject"
    User ||--o{ Incident : "reported"
    Client ||--o{ SavedSearch : "saves"
```
