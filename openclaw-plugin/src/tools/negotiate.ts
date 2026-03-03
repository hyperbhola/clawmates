import type { ConnectionService } from '../services/connection.js';
import type { SessionService } from '../services/session.js';
import type { CryptoService } from '../services/crypto.js';
import { PROTOCOL_VERSION, type NegotiateOpen, type NegotiateIntro } from '../types.js';

interface NegotiateParams {
  target_session_id: string;
  action: 'open' | 'intro';
  // For 'open' action:
  compatibility_score?: number;
  topic_overlap?: string[];
  intent_alignment?: 'strong' | 'moderate' | 'weak';
  logistics_match?: boolean;
  // For 'intro' action:
  contact_method?: string;
  contact_handle?: string;
  first_name?: string;
  intro_message?: string;
}

interface NegotiateResult {
  status: 'deposited' | 'error';
  message_id?: string;
  expires_at?: string;
  error?: string;
}

export function createNegotiateTool(
  connection: ConnectionService,
  session: SessionService,
  crypto: CryptoService,
) {
  return {
    name: 'clawmates_negotiate',
    description:
      'Send a negotiation message to another agent. Use action "open" to initiate ' +
      'interest in a match (sends your compatibility assessment). Use action "intro" ' +
      'to exchange contact info after both humans have agreed to connect. ' +
      'All payloads are end-to-end encrypted — the server cannot read them.',
    parameters: {
      type: 'object' as const,
      properties: {
        target_session_id: {
          type: 'string',
          description: 'Session ID of the agent to negotiate with',
        },
        action: {
          type: 'string',
          enum: ['open', 'intro'],
          description: '"open" to start negotiation, "intro" to exchange contact info',
        },
        compatibility_score: {
          type: 'number',
          description: 'Your compatibility score (0-1). Required for action "open"',
        },
        topic_overlap: {
          type: 'array',
          items: { type: 'string' },
          description: 'Overlapping topic tags. Required for action "open"',
        },
        intent_alignment: {
          type: 'string',
          enum: ['strong', 'moderate', 'weak'],
          description: 'How well intents align. Required for action "open"',
        },
        logistics_match: {
          type: 'boolean',
          description: 'Whether activity/availability/energy match. Required for action "open"',
        },
        contact_method: {
          type: 'string',
          description: 'Platform for contact (e.g., "telegram", "whatsapp"). Required for action "intro"',
        },
        contact_handle: {
          type: 'string',
          description: 'Handle or username on the contact platform. Required for action "intro"',
        },
        first_name: {
          type: 'string',
          description: 'First name to share (optional, for action "intro")',
        },
        intro_message: {
          type: 'string',
          description: 'Opening message to send with the intro (optional)',
        },
      },
      required: ['target_session_id', 'action'],
    },

    async execute(_id: string, params: NegotiateParams): Promise<NegotiateResult> {
      const activeSession = session.getActiveSession();
      if (!activeSession) {
        return { status: 'error', error: 'No active session. Call clawmates_discover first.' };
      }

      // Get the target's public key for encryption
      const negotiation = session.getNegotiation(params.target_session_id);
      let targetPublicKey: string;

      if (negotiation) {
        targetPublicKey = negotiation.withPublicKey;
      } else {
        return {
          status: 'error',
          error: 'No negotiation context for this session. Target must be from discovery results.',
        };
      }

      // Build the negotiation payload
      let payload: NegotiateOpen | NegotiateIntro;

      if (params.action === 'open') {
        payload = {
          type: 'negotiate.open',
          compatibility_score: params.compatibility_score ?? 0,
          topic_overlap: params.topic_overlap ?? [],
          intent_alignment: params.intent_alignment ?? 'moderate',
          logistics_match: params.logistics_match ?? false,
          wants_to_proceed: true,
        };
      } else {
        payload = {
          type: 'negotiate.intro',
          contact: {
            method: params.contact_method ?? '',
            handle: params.contact_handle ?? '',
            ...(params.first_name ? { first_name: params.first_name } : {}),
            ...(params.intro_message ? { message: params.intro_message } : {}),
          },
        };
      }

      // Encrypt the payload
      const encrypted = crypto.encrypt(
        JSON.stringify(payload),
        targetPublicKey,
      );

      // Determine TTL based on the active session's availability
      const negotiationTtl = params.action === 'open' ? 7200 : 86400;
      const negotiationExpiresAt = activeSession.mode === 'ephemeral'
        ? new Date(Date.now() + 2 * 3600 * 1000).toISOString() // 2 hours for ephemeral
        : new Date(Date.now() + 24 * 3600 * 1000).toISOString(); // 24 hours for persistent

      // Deposit via relay
      const response = await connection.send({
        type: 'relay.deposit',
        protocol_version: PROTOCOL_VERSION,
        from_session: activeSession.sessionId,
        to_session: params.target_session_id,
        payload: encrypted,
        ttl: negotiationTtl,
        negotiation_expires_at: negotiationExpiresAt,
      }) as { message_id: string; expires_at: string };

      // Track the negotiation
      session.addNegotiationMessage(params.target_session_id, payload);
      if (params.action === 'open') {
        session.updateNegotiationState(params.target_session_id, 'pending');
      } else if (params.action === 'intro') {
        session.updateNegotiationState(params.target_session_id, 'completed');
      }

      return {
        status: 'deposited',
        message_id: response.message_id,
        expires_at: response.expires_at,
      };
    },
  };
}
