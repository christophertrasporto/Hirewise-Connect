# Entity relationship diagram

Phase 0 scope: identity, clients, agents, agreements, and operations tables. Later phases add marketplace (shortlists, introductions), interviews, placements, commercial (rates, deposits, invoices, payments), and academy aggregates from MASTER_PROMPT.md Section 4. Keep this file current when the Prisma schema changes.

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
