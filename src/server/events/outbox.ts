import type { Db } from "@/server/db/types";
import { outboxRepository } from "@/server/repositories/outbox.repository";
import type { DomainEventMap, DomainEventType } from "./events";

/** Publish inside the caller's transaction. Never call outside one for state changes. */
export async function publishEvent<T extends DomainEventType>(db: Db, type: T, payload: DomainEventMap[T]): Promise<void> {
  await outboxRepository.insert(db, type, payload);
}
