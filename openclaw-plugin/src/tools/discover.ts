import type { ConnectionService } from '../services/connection.js';
import type { SessionService } from '../services/session.js';
import { PROTOCOL_VERSION, type Tags, type DiscoveryMatch } from '../types.js';

interface DiscoverParams {
  geohash: string;
  tags: Tags;
  intent_type: string;
  activity?: string;
  energy?: string;
  availability?: string;
  mode?: 'ephemeral' | 'persistent';
  ttl?: number;
}

interface DiscoverResult {
  session_id: string;
  expires_at: string;
  nearby_agents: Array<{
    session_id: string;
    proximity: string;
    relevance: number;
    intent: {
      intent_type: string;
      tags: Tags;
      activity: string;
      availability: string;
      energy: string;
    };
  }>;
}

export function createDiscoverTool(
  connection: ConnectionService,
  session: SessionService,
) {
  return {
    name: 'clawmates_discover',
    description:
      'Register presence on the ClawMates network and find interesting people nearby. ' +
      'Publishes your tags (broad/mid/specific interest categories) and searches for ' +
      'other agents in the area. Returns nearby agents ranked by tag relevance. ' +
      'The agent should then evaluate each match against the user\'s private context.',
    parameters: {
      type: 'object' as const,
      properties: {
        geohash: {
          type: 'string',
          description: 'Geohash of the user\'s location (5 chars = ~5km precision)',
        },
        tags: {
          type: 'object',
          description: 'Interest tags at three tiers of specificity',
          properties: {
            broad: { type: 'array', items: { type: 'string' }, description: '2-3 broad categories' },
            mid: { type: 'array', items: { type: 'string' }, description: '2-3 specific interest areas' },
            specific: { type: 'array', items: { type: 'string' }, description: '2-3 niche topics' },
          },
          required: ['broad', 'mid', 'specific'],
        },
        intent_type: {
          type: 'string',
          enum: ['meet', 'collaborate', 'cowork', 'network', 'hangout', 'learn'],
          description: 'What kind of interaction the user is looking for',
        },
        activity: {
          type: 'string',
          enum: ['coffee', 'walk', 'cowork', 'meal', 'drinks', 'virtual', 'event', 'any'],
          description: 'Preferred activity (default: any)',
        },
        energy: {
          type: 'string',
          enum: ['casual', 'professional', 'deep_dive', 'light', 'social'],
          description: 'Preferred energy level (default: casual)',
        },
        availability: {
          type: 'string',
          enum: ['now', 'next_hour', 'today', 'this_week', 'anytime'],
          description: 'When the user is available (default: now)',
        },
        mode: {
          type: 'string',
          enum: ['ephemeral', 'persistent'],
          description: 'ephemeral expires after TTL, persistent auto-refreshes (default: ephemeral)',
        },
        ttl: {
          type: 'number',
          description: 'Time-to-live in seconds (default: 7200 = 2 hours)',
        },
      },
      required: ['geohash', 'tags', 'intent_type'],
    },

    async execute(_id: string, params: DiscoverParams): Promise<DiscoverResult> {
      // Generate fresh session keypair
      const { publicKey } = session.createSession();

      // Register presence with the discovery service
      const ack = await connection.send({
        type: 'presence.register',
        protocol_version: PROTOCOL_VERSION,
        session_public_key: publicKey,
        geohash: params.geohash,
        intent: {
          intent_type: params.intent_type,
          tags: params.tags,
          activity: params.activity || 'any',
          availability: params.availability || 'now',
          energy: params.energy || 'casual',
        },
        ttl: params.ttl || 7200,
        mode: params.mode || 'ephemeral',
      }) as { session_id: string; expires_at: string };

      // Bind session locally
      session.bindSession({
        sessionId: ack.session_id,
        publicKey,
        geohash: params.geohash,
        expiresAt: ack.expires_at,
        mode: params.mode || 'ephemeral',
      });

      // Query for nearby agents
      const results = await connection.send({
        type: 'discovery.query',
        protocol_version: PROTOCOL_VERSION,
        session_id: ack.session_id,
        geohash_prefix: params.geohash.substring(0, 4),
        radius: 'nearby',
        limit: 20,
      }) as { matches: DiscoveryMatch[] };

      // Start mailbox pickup for incoming negotiations
      connection.startPickupLoop();

      // Return results for the agent's LLM to evaluate
      return {
        session_id: ack.session_id,
        expires_at: ack.expires_at,
        nearby_agents: results.matches.map((m) => ({
          session_id: m.session_id,
          proximity: m.proximity,
          relevance: m.relevance,
          intent: m.intent,
        })),
      };
    },
  };
}
