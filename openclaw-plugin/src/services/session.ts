import type { CryptoService } from './crypto.js';
import type { DiscoveryMatch, NegotiationPayload } from '../types.js';

export interface ActiveSession {
  sessionId: string;
  publicKey: string;
  geohash: string;
  expiresAt: string;
  mode: 'ephemeral' | 'persistent';
}

export interface ActiveNegotiation {
  withSessionId: string;
  withPublicKey: string;
  direction: 'outbound' | 'inbound';
  state: 'pending' | 'mutual_interest' | 'intro_pending' | 'completed' | 'declined';
  matchData: DiscoveryMatch;
  messages: NegotiationPayload[];
  startedAt: string;
}

/**
 * Manages the current session state for the ClawMates plugin.
 * Tracks active session, ongoing negotiations, and known sessions
 * from the current device.
 *
 * All state is in-memory. Nothing persists beyond the OpenClaw process lifetime.
 * For persistent user preferences, the skill uses OpenClaw's memory system.
 */
export class SessionService {
  private crypto: CryptoService;
  private activeSession: ActiveSession | null = null;
  private negotiations: Map<string, ActiveNegotiation> = new Map();
  private knownSessionIds: Set<string> = new Set();

  constructor(crypto: CryptoService) {
    this.crypto = crypto;
  }

  /**
   * Create a new discovery session with a fresh keypair.
   */
  createSession(): { publicKey: string } {
    const { publicKey } = this.crypto.generateKeyPair();
    return { publicKey };
  }

  /**
   * Bind the session after successful registration with the server.
   */
  bindSession(params: {
    sessionId: string;
    publicKey: string;
    geohash: string;
    expiresAt: string;
    mode: 'ephemeral' | 'persistent';
  }): void {
    this.activeSession = {
      sessionId: params.sessionId,
      publicKey: params.publicKey,
      geohash: params.geohash,
      expiresAt: params.expiresAt,
      mode: params.mode,
    };
    this.knownSessionIds.add(params.sessionId);
  }

  getActiveSession(): ActiveSession | null {
    return this.activeSession;
  }

  isActive(): boolean {
    if (!this.activeSession) return false;
    return new Date(this.activeSession.expiresAt) > new Date();
  }

  clearSession(): void {
    this.activeSession = null;
    this.negotiations.clear();
  }

  // --- Negotiation tracking ---

  startNegotiation(
    match: DiscoveryMatch,
    direction: 'outbound' | 'inbound',
  ): ActiveNegotiation {
    const negotiation: ActiveNegotiation = {
      withSessionId: match.session_id,
      withPublicKey: match.public_key,
      direction,
      state: 'pending',
      matchData: match,
      messages: [],
      startedAt: new Date().toISOString(),
    };

    this.negotiations.set(match.session_id, negotiation);
    return negotiation;
  }

  getNegotiation(sessionId: string): ActiveNegotiation | undefined {
    return this.negotiations.get(sessionId);
  }

  updateNegotiationState(
    sessionId: string,
    state: ActiveNegotiation['state'],
  ): void {
    const neg = this.negotiations.get(sessionId);
    if (neg) {
      neg.state = state;
    }
  }

  addNegotiationMessage(sessionId: string, message: NegotiationPayload): void {
    const neg = this.negotiations.get(sessionId);
    if (neg) {
      neg.messages.push(message);
    }
  }

  removeNegotiation(sessionId: string): void {
    this.negotiations.delete(sessionId);
  }

  getActiveNegotiations(): ActiveNegotiation[] {
    return Array.from(this.negotiations.values()).filter(
      (n) => n.state !== 'completed' && n.state !== 'declined',
    );
  }

  hasPendingNegotiations(): boolean {
    return this.getActiveNegotiations().some(
      (n) => n.direction === 'inbound' && n.state === 'pending',
    );
  }

  getPendingInbound(): ActiveNegotiation[] {
    return this.getActiveNegotiations().filter(
      (n) => n.direction === 'inbound' && n.state === 'pending',
    );
  }

  /**
   * Check if a session ID belongs to this device (for multi-device dedup).
   */
  isOwnSession(sessionId: string): boolean {
    return this.knownSessionIds.has(sessionId);
  }
}
