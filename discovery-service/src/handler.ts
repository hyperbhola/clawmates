import type { WebSocket } from 'ws';
import type { Logger } from 'pino';
import type { GeoRegistry } from './geo/registry.js';
import type { Relay } from './relay/relay.js';
import type { EmbeddingService } from './embedding/embedding.js';
import {
  InboundMessageSchema,
  PROTOCOL_VERSION,
  type PresenceRegister,
  type PresenceRefresh,
  type PresenceWithdraw,
  type DiscoveryQuery,
  type RelayDeposit,
  type RelayPickup,
  type RelayAck,
} from './types.js';

export interface HandlerContext {
  geoRegistry: GeoRegistry;
  relay: Relay;
  embedding: EmbeddingService;
  sessionSockets: Map<string, WebSocket>;
  log: Logger;
}

export async function handleMessage(
  raw: unknown,
  ctx: HandlerContext,
): Promise<Record<string, unknown> | null> {
  // Validate against schema
  const result = InboundMessageSchema.safeParse(raw);
  if (!result.success) {
    return {
      type: 'error',
      protocol_version: PROTOCOL_VERSION,
      code: 'invalid_message',
      message: result.error.issues.map((i) => i.message).join('; '),
    };
  }

  const msg = result.data;

  switch (msg.type) {
    case 'presence.register':
      return handlePresenceRegister(msg, ctx);
    case 'presence.refresh':
      return handlePresenceRefresh(msg, ctx);
    case 'presence.withdraw':
      return handlePresenceWithdraw(msg, ctx);
    case 'discovery.query':
      return handleDiscoveryQuery(msg, ctx);
    case 'relay.deposit':
      return handleRelayDeposit(msg, ctx);
    case 'relay.pickup':
      return handleRelayPickup(msg, ctx);
    case 'relay.ack':
      return handleRelayAck(msg, ctx);
    default:
      return {
        type: 'error',
        protocol_version: PROTOCOL_VERSION,
        code: 'unknown_message_type',
        message: `Unknown message type`,
      };
  }
}

async function handlePresenceRegister(
  msg: PresenceRegister,
  ctx: HandlerContext,
): Promise<Record<string, unknown>> {
  ctx.log.debug({ geohash: msg.geohash }, 'Registering presence');

  const session = await ctx.geoRegistry.register({
    publicKey: msg.session_public_key,
    geohash: msg.geohash,
    intent: msg.intent,
    ttl: msg.ttl,
    mode: msg.mode,
  });

  return {
    type: 'presence.ack',
    protocol_version: PROTOCOL_VERSION,
    session_id: session.session_id,
    expires_at: session.expires_at,
  };
}

async function handlePresenceRefresh(
  msg: PresenceRefresh,
  ctx: HandlerContext,
): Promise<Record<string, unknown>> {
  const refreshed = await ctx.geoRegistry.refresh(msg.session_id, msg.ttl);

  if (!refreshed) {
    return {
      type: 'error',
      protocol_version: PROTOCOL_VERSION,
      code: 'session_not_found',
      message: 'Session does not exist or has expired',
    };
  }

  return {
    type: 'presence.ack',
    protocol_version: PROTOCOL_VERSION,
    session_id: msg.session_id,
    expires_at: refreshed.expires_at,
  };
}

async function handlePresenceWithdraw(
  msg: PresenceWithdraw,
  ctx: HandlerContext,
): Promise<Record<string, unknown>> {
  await ctx.geoRegistry.withdraw(msg.session_id);

  return {
    type: 'presence.withdrawn',
    protocol_version: PROTOCOL_VERSION,
    session_id: msg.session_id,
  };
}

async function handleDiscoveryQuery(
  msg: DiscoveryQuery,
  ctx: HandlerContext,
): Promise<Record<string, unknown>> {
  ctx.log.debug({ geohash: msg.geohash_prefix, radius: msg.radius }, 'Discovery query');

  const matches = await ctx.geoRegistry.query({
    sessionId: msg.session_id,
    geohashPrefix: msg.geohash_prefix,
    radius: msg.radius,
    limit: msg.limit,
  });

  return {
    type: 'discovery.results',
    protocol_version: PROTOCOL_VERSION,
    matches,
  };
}

async function handleRelayDeposit(
  msg: RelayDeposit,
  ctx: HandlerContext,
): Promise<Record<string, unknown>> {
  // Verify the sending session exists
  const senderExists = await ctx.geoRegistry.sessionExists(msg.from_session);
  if (!senderExists) {
    return {
      type: 'error',
      protocol_version: PROTOCOL_VERSION,
      code: 'session_not_found',
      message: 'Sender session does not exist',
    };
  }

  // Verify the target session exists
  const targetExists = await ctx.geoRegistry.sessionExists(msg.to_session);
  if (!targetExists) {
    return {
      type: 'error',
      protocol_version: PROTOCOL_VERSION,
      code: 'target_not_found',
      message: 'Target session does not exist',
    };
  }

  const deposited = await ctx.relay.deposit({
    fromSession: msg.from_session,
    toSession: msg.to_session,
    payload: msg.payload,
    ttl: msg.ttl,
    negotiationExpiresAt: msg.negotiation_expires_at,
  });

  return {
    type: 'relay.deposited',
    protocol_version: PROTOCOL_VERSION,
    message_id: deposited.id,
    expires_at: deposited.expires_at,
  };
}

async function handleRelayPickup(
  msg: RelayPickup,
  ctx: HandlerContext,
): Promise<Record<string, unknown>> {
  const messages = await ctx.relay.pickup(msg.session_id);

  return {
    type: 'relay.messages',
    protocol_version: PROTOCOL_VERSION,
    messages,
  };
}

async function handleRelayAck(
  msg: RelayAck,
  ctx: HandlerContext,
): Promise<Record<string, unknown>> {
  await ctx.relay.acknowledge(msg.session_id, msg.message_ids);

  return {
    type: 'relay.ack_confirmed',
    protocol_version: PROTOCOL_VERSION,
    acknowledged: msg.message_ids.length,
  };
}
