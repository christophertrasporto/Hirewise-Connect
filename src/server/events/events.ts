/**
 * Domain events written to the outbox inside the same transaction as the state
 * change (Section 3.3). The worker turns them into notifications, tasks, and emails.
 * Phase 0 defines the envelope and two events; later phases add the rest of Section 9.
 */
export type DomainEventMap = {
  USER_CREATED: { userId: string; role: string; email: string };
  SETTING_CHANGED: { key: string; changedBy: string | null };
};

export type DomainEventType = keyof DomainEventMap;

export type DomainEvent<T extends DomainEventType = DomainEventType> = {
  type: T;
  payload: DomainEventMap[T];
};
