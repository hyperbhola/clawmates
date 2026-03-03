// Shared types for the ClawMates OpenClaw plugin.
// These mirror the discovery service protocol types
// but are kept separate to avoid a hard dependency.

export const PROTOCOL_VERSION = '0.1.0';

export interface Tags {
  broad: string[];
  mid: string[];
  specific: string[];
}

export interface Intent {
  intent_type: 'meet' | 'collaborate' | 'cowork' | 'network' | 'hangout' | 'learn';
  tags: Tags;
  activity: 'coffee' | 'walk' | 'cowork' | 'meal' | 'drinks' | 'virtual' | 'event' | 'any';
  availability: 'now' | 'next_hour' | 'today' | 'this_week' | 'anytime';
  energy: 'casual' | 'professional' | 'deep_dive' | 'light' | 'social';
}

export interface DiscoveryMatch {
  session_id: string;
  geohash: string;
  public_key: string;
  intent: Intent;
  proximity: 'immediate' | 'nearby' | 'area';
  relevance: number;
  registered_at: string;
}

export interface RelayMessage {
  id: string;
  from_session: string;
  payload: string; // encrypted
  deposited_at: string;
  expires_at: string;
  negotiation_expires_at?: string;
}

// Negotiation payload types (sent inside encrypted relay payloads)

export interface NegotiateOpen {
  type: 'negotiate.open';
  compatibility_score: number;
  topic_overlap: string[];
  intent_alignment: 'strong' | 'moderate' | 'weak';
  logistics_match: boolean;
  wants_to_proceed: boolean;
}

export interface NegotiateRespond {
  type: 'negotiate.respond';
  compatibility_score: number;
  topic_overlap: string[];
  intent_alignment: 'strong' | 'moderate' | 'weak';
  logistics_match: boolean;
  wants_to_proceed: boolean;
}

export interface NegotiateDecline {
  type: 'negotiate.decline';
  reason: 'not_a_fit' | 'unavailable' | 'busy';
}

export interface NegotiateIntro {
  type: 'negotiate.intro';
  contact: {
    method: string;
    handle: string;
    first_name?: string;
    message?: string;
  };
}

export interface NegotiateClose {
  type: 'negotiate.close';
}

export type NegotiationPayload =
  | NegotiateOpen
  | NegotiateRespond
  | NegotiateDecline
  | NegotiateIntro
  | NegotiateClose;

// Plugin configuration (from openclaw.json)

export interface ClawMatesConfig {
  server: string; // WebSocket URL of discovery service
  defaultTtl?: number;
  defaultMode?: 'ephemeral' | 'persistent';
  autoPickup?: boolean; // auto-check mailbox on connect
  pickupIntervalMs?: number; // how often to check mailbox
}
