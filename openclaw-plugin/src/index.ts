import { CryptoService } from './services/crypto.js';
import { SessionService } from './services/session.js';
import { ConnectionService } from './services/connection.js';
import { createDiscoverTool } from './tools/discover.js';
import { createNegotiateTool } from './tools/negotiate.js';
import { createRespondTool } from './tools/respond.js';
import { createWithdrawTool } from './tools/withdraw.js';
import type { NegotiationPayload, DiscoveryMatch } from './types.js';

/**
 * ClawMates OpenClaw Plugin
 *
 * Provides geo-based people discovery through agent-to-agent matching.
 * Registers four tools that the agent uses (guided by the SKILL.md):
 *   - clawmates_discover: Register presence and find nearby agents
 *   - clawmates_negotiate: Initiate or advance a negotiation
 *   - clawmates_respond: Respond to incoming negotiations
 *   - clawmates_withdraw: Remove from discovery network
 *
 * Also runs a background service that maintains the WebSocket connection
 * and periodically checks the async mailbox for incoming negotiations.
 */

// Type for OpenClaw's plugin API (peer dependency)
interface PluginAPI {
  registerTool(tool: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    handler: (params: any) => Promise<unknown>;
  }): void;
  registerService(service: {
    name: string;
    start: () => Promise<void>;
    stop: () => Promise<void>;
  }): void;
  registerHook(event: string, handler: (event: any) => Promise<unknown>): void;
  getConfig(path: string): unknown;
  log: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
    debug: (...args: unknown[]) => void;
  };
}

export default async function activate(api: PluginAPI) {
  // Read config from openclaw.json -> skills.entries.clawmates
  const serverUrl = (api.getConfig('skills.entries.clawmates.server') as string)
    || 'wss://clawmates.onrender.com';
  const pickupInterval = (api.getConfig('skills.entries.clawmates.pickupIntervalMs') as number)
    || 30000;

  api.log.info('[ClawMates] Initializing plugin, server:', serverUrl);

  // Initialize services
  const crypto = new CryptoService();
  const session = new SessionService(crypto);
  const connection = new ConnectionService(serverUrl, session);

  // Handle incoming relay messages — decrypt and track negotiations
  connection.on('relay.message_received', (msg: any) => {
    try {
      const negotiation = findNegotiationBySession(session, msg.from_session);
      if (!negotiation) {
        // New inbound negotiation — we need the sender's public key
        // The agent will handle this via the skill instructions
        api.log.info('[ClawMates] Incoming negotiation from', msg.from_session);
        return;
      }

      const decrypted = crypto.decrypt(msg.payload, negotiation.withPublicKey);
      const payload: NegotiationPayload = JSON.parse(decrypted);

      session.addNegotiationMessage(msg.from_session, payload);

      if (payload.type === 'negotiate.respond' && payload.wants_to_proceed) {
        session.updateNegotiationState(msg.from_session, 'mutual_interest');
        api.log.info('[ClawMates] Mutual interest with', msg.from_session);
      } else if (payload.type === 'negotiate.decline') {
        session.updateNegotiationState(msg.from_session, 'declined');
        api.log.info('[ClawMates] Declined by', msg.from_session);
      } else if (payload.type === 'negotiate.intro') {
        session.updateNegotiationState(msg.from_session, 'completed');
        api.log.info('[ClawMates] Intro received from', msg.from_session);
      }
    } catch (err) {
      api.log.error('[ClawMates] Failed to process relay message:', err);
    }
  });

  // Register tools
  const discoverTool = createDiscoverTool(connection, session);
  api.registerTool(discoverTool);

  const negotiateTool = createNegotiateTool(connection, session, crypto);
  api.registerTool(negotiateTool);

  const respondTool = createRespondTool(connection, session, crypto);
  api.registerTool(respondTool);

  const withdrawTool = createWithdrawTool(connection, session);
  api.registerTool(withdrawTool);

  // Background service: maintain connection
  api.registerService({
    name: 'clawmates-connection',
    async start() {
      try {
        await connection.connect();
        api.log.info('[ClawMates] Connected to discovery service');
      } catch (err) {
        api.log.warn('[ClawMates] Could not connect to discovery service:', err);
        // Will retry via reconnect logic in ConnectionService
      }
    },
    async stop() {
      // Withdraw if active
      if (session.isActive()) {
        try {
          await withdrawTool.handler();
        } catch {
          // Best effort
        }
      }
      await connection.disconnect();
      api.log.info('[ClawMates] Disconnected from discovery service');
    },
  });

  // Hook: inject context when there are pending inbound negotiations
  api.registerHook('agent:bootstrap', async () => {
    if (session.hasPendingNegotiations()) {
      const pending = session.getPendingInbound();
      return {
        inject: `[ClawMates] You have ${pending.length} pending match request(s). ` +
          `Use clawmates_respond to evaluate and reply to each.`,
      };
    }
    return {};
  });

  api.log.info('[ClawMates] Plugin activated. Tools: clawmates_discover, clawmates_negotiate, clawmates_respond, clawmates_withdraw');
}

function findNegotiationBySession(session: SessionService, sessionId: string) {
  return session.getNegotiation(sessionId);
}
