import type { ConnectionService } from '../services/connection.js';
import type { SessionService } from '../services/session.js';
import { PROTOCOL_VERSION } from '../types.js';

interface WithdrawResult {
  status: 'withdrawn' | 'error';
  error?: string;
}

export function createWithdrawTool(
  connection: ConnectionService,
  session: SessionService,
) {
  return {
    name: 'clawmates_withdraw',
    description:
      'Remove the user from the ClawMates discovery network. Cancels presence, ' +
      'stops mailbox pickup, and cleans up the session. Use when the user wants ' +
      'to stop being discoverable or is done for now.',
    parameters: {
      type: 'object' as const,
      properties: {},
      required: [],
    },

    async execute(_id: string, _params?: any): Promise<WithdrawResult> {
      const activeSession = session.getActiveSession();
      if (!activeSession) {
        return { status: 'error', error: 'No active session to withdraw.' };
      }

      try {
        await connection.send({
          type: 'presence.withdraw',
          protocol_version: PROTOCOL_VERSION,
          session_id: activeSession.sessionId,
        });
      } catch {
        // Even if the server call fails, clean up locally
      }

      connection.stopPickupLoop();
      session.clearSession();

      return { status: 'withdrawn' };
    },
  };
}
