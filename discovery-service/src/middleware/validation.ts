import { InboundMessageSchema, PROTOCOL_VERSION } from '../types.js';

export interface ValidationResult {
  valid: boolean;
  data?: unknown;
  error?: {
    type: 'error';
    protocol_version: string;
    code: string;
    message: string;
  };
}

/**
 * Validate and parse a raw WebSocket message.
 */
export function validateMessage(raw: string): ValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      valid: false,
      error: {
        type: 'error',
        protocol_version: PROTOCOL_VERSION,
        code: 'invalid_json',
        message: 'Message is not valid JSON',
      },
    };
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return {
      valid: false,
      error: {
        type: 'error',
        protocol_version: PROTOCOL_VERSION,
        code: 'invalid_message',
        message: 'Message must be a JSON object',
      },
    };
  }

  const result = InboundMessageSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    return {
      valid: false,
      error: {
        type: 'error',
        protocol_version: PROTOCOL_VERSION,
        code: 'validation_error',
        message: issues.join('; '),
      },
    };
  }

  return { valid: true, data: result.data };
}

/**
 * Validate that an encrypted payload doesn't exceed size limits.
 */
export function validatePayloadSize(payload: string, maxBytes: number): boolean {
  return new TextEncoder().encode(payload).length <= maxBytes;
}
