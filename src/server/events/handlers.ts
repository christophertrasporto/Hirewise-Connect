import type { Db } from "@/server/db/types";
import type { DomainEventMap, DomainEventType } from "./events";
import { notifyUser } from "@/server/services/notification.service";

export type EventHandler<T extends DomainEventType> = (db: Db, payload: DomainEventMap[T]) => Promise<void>;

/**
 * Event → side-effects. Handlers must be idempotent: the worker may retry an
 * event if the process dies after the handler but before markProcessed.
 */
export const EVENT_HANDLERS: { [T in DomainEventType]: EventHandler<T> } = {
  USER_CREATED: async (db, p) => {
    await notifyUser(db, {
      userId: p.userId,
      type: "WELCOME",
      title: "Welcome to Hirewise Connect",
      body: "Your account has been created. Complete the required agreements to continue.",
      email: { to: p.email },
      dedupeKey: `WELCOME:${p.userId}`,
    });
  },
  SETTING_CHANGED: async () => {
    // No side effects yet. Reserved for cache invalidation.
  },
};
