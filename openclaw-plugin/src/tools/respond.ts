import type { ConnectionService } from '../services/connection.js';
import type { SessionService } from '../services/session.js';
import type { CryptoService } from '../services/crypto.js';
import { PROTOCOL_VERSION, type NegotiateRespond, type NegotiateDecline } from '../types.js';

interface RespondParams {
  target_session_id: string;
  action: 'accept' | 'decline';
  // For 'accept':
  compatibility_score?: number;
  topic_overlap?: string[];
  intent_alignment?: 'strong' | 'moderate' | 'weak';
  logistics_match?: boolean;
  // For 'decline':
  reason?: 'not_a_fit' | 'unavailable' | 'busy';
}

interface RespondResult {
  status: 'deposited' | 'error';
  message_id?: string;
  error?: string;
}

export function createRespondTool(
  connection: ConnectionService,
  session: SessionService,
  crypto: CryptoService,
) {
  return {
    name: 'clawmates_respond',
    description:
      'Respond to an incoming negotiation from another agent. Use action "accept" ' +
      'to indicate mutual interest (sends your compatibility assessment back). ' +
      'Use action "decline" to politely pass. After both agents accept, the skill ' +
      'should ask both humans if they want to proceed to intro.',
    parameters: {
      type: 'object' as const,
      properties: {
        target_session_id: {
          type: 'string',
          description: 'Session ID of the agent who initiated the negotiation',
        },
        action: {
          type: 'string',
          enum: ['accept', 'decline'],
          description: '"accept" to express mutual interest, "decline" to pass',
        },
        compatibility_score: {
          type: 'number',
          description: 'Your compatibility score (0-1). Required for action "accept"',
        },
        topic_overlap: {
          type: 'array',
          items: { type: 'string' },
          description: 'Overlapping topic tags. Required for action "accept"',
        },
        intent_alignment: {
          type: 'string',
          enum: ['strong', 'moderate', 'weak'],
        },
        logistics_match: { type: 'boolean' },
        reason: {
          type: 'string',
          enum: ['not_a_fit', 'unavailable', 'busy'],
          description: 'Reason for declining (optional)',
        },
      },
      required: ['target_session_id', 'action'],
    },

    async execute(_id: string, params: RespondParams): Promise<RespondResult> {
      const activeSession = session.getActiveSession();
      if (!activeSession) {
        return { status: 'error', error: 'No active session.' };
      }

      const negotiation = session.getNegotiation(params.target_session_id);
      if (!negotiation) {
        return { status: 'error', error: 'No pending negotiation from this session.' };
      }

      let payload: NegotiateRespond | NegotiateDecline;

      if (params.action === 'accept') {
        payload = {
          type: 'negotiate.respond',
          compatibility_score: params.compatibility_score ?? 0,
          topic_overlap: params.topic_overlap ?? [],
          intent_alignment: params.intent_alignment ?? 'moderate',
          logistics_match: params.logistics_match ?? false,
          wants_to_proceed: true,
        };
        session.updateNegotiationState(params.target_session_id, 'mutual_interest');
      } else {
        payload = {
          type: 'negotiate.decline',
          reason: params.reason ?? 'not_a_fit',
        };
        session.updateNegotiationState(params.target_session_id, 'declined');
      }

      const encrypted = crypto.encrypt(
        JSON.stringify(payload),
        negotiation.withPublicKey,
      );

      const response = await connection.send({
        type: 'relay.deposit',
        protocol_version: PROTOCOL_VERSION,
        from_session: activeSession.sessionId,
        to_session: params.target_session_id,
        payload: encrypted,
        ttl: 7200,
      }) as { message_id: string };

      session.addNegotiationMessage(params.target_session_id, payload);

      return {
        status: 'deposited',
        message_id: response.message_id,
      };
    },
  };
}
