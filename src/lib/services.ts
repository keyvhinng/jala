import { createLogMailer, createResendMailer } from "@/lib/mailer";
import { getEnv } from "@/lib/env";
import { createMatchingApplication } from "@/modules/matching/application/matching.service";
import { createRoomEvents } from "@/modules/notifications/application/room-events";
import { createActivityRepository } from "@/modules/notifications/infrastructure/activity.repository";
import { createNotificationService } from "@/modules/notifications/application/notification.service";
import {
  createLogPushSender,
  createWebPushSender,
} from "@/modules/notifications/infrastructure/push-sender";
import { createPushSubscriptionRepository } from "@/modules/notifications/infrastructure/push-subscription.repository";
import { createMatchingRepository } from "@/modules/matching/infrastructure/matching.repository";
import { createRoadMatchingService } from "@/modules/matching/domain/road-matching";
import { createOsrmRoutingProvider } from "@/modules/routing/infrastructure/osrm-routing-provider";
import { createPartyRepository } from "@/modules/parties/infrastructure/party.repository";
import { createPartyMessageRepository } from "@/modules/parties/infrastructure/party-message.repository";
import { createParticipationRepository } from "@/modules/sessions/infrastructure/participation.repository";
import { getDb } from "@/db";
import { createAuthService } from "@/modules/auth/application/auth.service";
import { createAuthRepository } from "@/modules/auth/infrastructure/auth.repository";
import { createAtomicMemoryRidePreferences } from "@/modules/ride-preferences/infrastructure/atomic-memory-ride-preferences";
import { createSessionService } from "@/modules/sessions/application/session.service";
import { createSessionRepository } from "@/modules/sessions/infrastructure/session.repository";

/** Composition root: wires repositories into application services. */
export function getServices() {
  const db = getDb();
  const matching = createMatchingApplication(
    createMatchingRepository(db),
    createRoadMatchingService(
      createOsrmRoutingProvider({ baseUrl: getEnv().ROUTING_BASE_URL }),
    ),
    "osrm",
  );
  const env = getEnv();
  const pushSubscriptions = createPushSubscriptionRepository(db);
  const notifications = createNotificationService(
    pushSubscriptions,
    env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY
      ? createWebPushSender({
          publicKey: env.VAPID_PUBLIC_KEY,
          privateKey: env.VAPID_PRIVATE_KEY,
          subject: env.VAPID_SUBJECT,
        })
      : createLogPushSender(),
  );
  return {
    matching,
    activity: createActivityRepository(db),
    pushSubscriptions,
    roomEvents: createRoomEvents({ matching, notifications }),
    auth: createAuthService(
      createAuthRepository(db),
      getEnv().RESEND_API_KEY
        ? createResendMailer(getEnv().RESEND_API_KEY!, getEnv().MAIL_FROM)
        : createLogMailer(),
      getEnv().NEXT_PUBLIC_APP_URL,
    ),
    participation: createParticipationRepository(db),
    parties: createPartyRepository(db),
    partyMessages: createPartyMessageRepository(db),
    // Optional: without Atomic Memory the planner starts from its usual defaults.
    ridePreferences:
      env.ATOMICMEMORY_API_URL && env.ATOMICMEMORY_API_KEY
        ? createAtomicMemoryRidePreferences({
            apiUrl: env.ATOMICMEMORY_API_URL,
            apiKey: env.ATOMICMEMORY_API_KEY,
          })
        : null,
    sessions: createSessionService(createSessionRepository(db)),
  };
}
