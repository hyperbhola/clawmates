import { z } from 'zod';

export const PROTOCOL_VERSION = '0.1.0';

// --- Intent & Tags ---

export const TagsSchema = z.object({
  broad: z.array(z.string().max(50)).max(5),
  mid: z.array(z.string().max(80)).max(5),
  specific: z.array(z.string().max(100)).max(5),
});

export const IntentSchema = z.object({
  intent_type: z.enum(['meet', 'collaborate', 'cowork', 'network', 'hangout', 'learn']),
  tags: TagsSchema,
  activity: z.enum(['coffee', 'walk', 'cowork', 'meal', 'drinks', 'virtual', 'event', 'any']).default('any'),
  availability: z.enum(['now', 'next_hour', 'today', 'this_week', 'anytime']).default('now'),
  energy: z.enum(['casual', 'professional', 'deep_dive', 'light', 'social']).default('casual'),
});

// --- Presence Messages ---

export const PresenceRegisterSchema = z.object({
  type: z.literal('presence.register'),
  protocol_version: z.string().default(PROTOCOL_VERSION),
  session_public_key: z.string().min(1),
  geohash: z.string().min(3).max(8),
  intent: IntentSchema,
  ttl: z.number().min(300).max(604800).default(7200), // 5 min to 7 days
  mode: z.enum(['ephemeral', 'persistent']).default('ephemeral'),
});

export const PresenceAckSchema = z.object({
  type: z.literal('presence.ack'),
  protocol_version: z.string(),
  session_id: z.string(),
  expires_at: z.string(),
});

export const PresenceRefreshSchema = z.object({
  type: z.literal('presence.refresh'),
  protocol_version: z.string().default(PROTOCOL_VERSION),
  session_id: z.string(),
  ttl: z.number().min(300).max(604800).optional(),
});

export const PresenceWithdrawSchema = z.object({
  type: z.literal('presence.withdraw'),
  protocol_version: z.string().default(PROTOCOL_VERSION),
  session_id: z.string(),
});

// --- Discovery Messages ---

export const DiscoveryQuerySchema = z.object({
  type: z.literal('discovery.query'),
  protocol_version: z.string().default(PROTOCOL_VERSION),
  session_id: z.string(),
  geohash_prefix: z.string().min(2).max(7),
  radius: z.enum(['immediate', 'nearby', 'area']).default('nearby'),
  limit: z.number().min(1).max(50).default(20),
});

export const DiscoveryResultMatchSchema = z.object({
  session_id: z.string(),
  geohash: z.string(),
  public_key: z.string(),
  intent: IntentSchema,
  proximity: z.enum(['immediate', 'nearby', 'area']),
  relevance: z.number().min(0).max(1),
  registered_at: z.string(),
});

export const DiscoveryResultsSchema = z.object({
  type: z.literal('discovery.results'),
  protocol_version: z.string(),
  matches: z.array(DiscoveryResultMatchSchema),
});

// --- Relay Messages (async mailbox) ---

export const RelayDepositSchema = z.object({
  type: z.literal('relay.deposit'),
  protocol_version: z.string().default(PROTOCOL_VERSION),
  from_session: z.string(),
  to_session: z.string(),
  payload: z.string().max(8192), // encrypted blob, max 8KB
  ttl: z.number().min(60).max(604800).default(86400), // 1 min to 7 days
  negotiation_expires_at: z.string().optional(),
});

export const RelayPickupSchema = z.object({
  type: z.literal('relay.pickup'),
  protocol_version: z.string().default(PROTOCOL_VERSION),
  session_id: z.string(),
});

export const RelayMessageSchema = z.object({
  id: z.string(),
  from_session: z.string(),
  payload: z.string(),
  deposited_at: z.string(),
  expires_at: z.string(),
  negotiation_expires_at: z.string().optional(),
});

export const RelayMessagesSchema = z.object({
  type: z.literal('relay.messages'),
  protocol_version: z.string(),
  messages: z.array(RelayMessageSchema),
});

export const RelayAckSchema = z.object({
  type: z.literal('relay.ack'),
  protocol_version: z.string().default(PROTOCOL_VERSION),
  session_id: z.string(),
  message_ids: z.array(z.string()),
});

// --- Error ---

export const ErrorSchema = z.object({
  type: z.literal('error'),
  protocol_version: z.string(),
  code: z.string(),
  message: z.string(),
});

// --- Union of all inbound messages ---

export const InboundMessageSchema = z.discriminatedUnion('type', [
  PresenceRegisterSchema,
  PresenceRefreshSchema,
  PresenceWithdrawSchema,
  DiscoveryQuerySchema,
  RelayDepositSchema,
  RelayPickupSchema,
  RelayAckSchema,
]);

// --- Inferred types ---

export type Tags = z.infer<typeof TagsSchema>;
export type Intent = z.infer<typeof IntentSchema>;
export type PresenceRegister = z.infer<typeof PresenceRegisterSchema>;
export type PresenceAck = z.infer<typeof PresenceAckSchema>;
export type PresenceRefresh = z.infer<typeof PresenceRefreshSchema>;
export type PresenceWithdraw = z.infer<typeof PresenceWithdrawSchema>;
export type DiscoveryQuery = z.infer<typeof DiscoveryQuerySchema>;
export type DiscoveryResultMatch = z.infer<typeof DiscoveryResultMatchSchema>;
export type DiscoveryResults = z.infer<typeof DiscoveryResultsSchema>;
export type RelayDeposit = z.infer<typeof RelayDepositSchema>;
export type RelayPickup = z.infer<typeof RelayPickupSchema>;
export type RelayMessage = z.infer<typeof RelayMessageSchema>;
export type RelayMessages = z.infer<typeof RelayMessagesSchema>;
export type RelayAck = z.infer<typeof RelayAckSchema>;
export type InboundMessage = z.infer<typeof InboundMessageSchema>;

// --- Session stored in Redis ---

export interface StoredSession {
  session_id: string;
  public_key: string;
  geohash: string;
  intent: Intent;
  mode: 'ephemeral' | 'persistent';
  embedding: number[];
  registered_at: string;
  expires_at: string;
}
