import type Redis from 'ioredis';
import { nanoid } from 'nanoid';
import { keys } from '../redis.js';
import type { RelayMessage } from '../types.js';

interface DepositParams {
  fromSession: string;
  toSession: string;
  payload: string;
  ttl: number;
  negotiationExpiresAt?: string;
}

export class Relay {
  constructor(
    private redis: Redis,
    private maxMailboxSize: number,
  ) {}

  async deposit(params: DepositParams): Promise<{ id: string; expires_at: string }> {
    const messageId = nanoid(16);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + params.ttl * 1000);

    const message: RelayMessage = {
      id: messageId,
      from_session: params.fromSession,
      payload: params.payload,
      deposited_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      ...(params.negotiationExpiresAt
        ? { negotiation_expires_at: params.negotiationExpiresAt }
        : {}),
    };

    const mailboxKey = keys.mailbox(params.toSession);

    // Check mailbox size limit
    const currentSize = await this.redis.llen(mailboxKey);
    if (currentSize >= this.maxMailboxSize) {
      // Remove oldest messages to make room
      const overflow = currentSize - this.maxMailboxSize + 1;
      for (let i = 0; i < overflow; i++) {
        await this.redis.lpop(mailboxKey);
      }
    }

    // Add message to the target's mailbox (right-push = newest at end)
    await this.redis.rpush(mailboxKey, JSON.stringify(message));

    // Set mailbox TTL to the max of current TTL and new message TTL
    const currentTtl = await this.redis.ttl(mailboxKey);
    if (currentTtl < params.ttl) {
      await this.redis.expire(mailboxKey, params.ttl);
    }

    return {
      id: messageId,
      expires_at: expiresAt.toISOString(),
    };
  }

  async pickup(sessionId: string): Promise<RelayMessage[]> {
    const mailboxKey = keys.mailbox(sessionId);
    const rawMessages = await this.redis.lrange(mailboxKey, 0, -1);

    if (rawMessages.length === 0) return [];

    const now = new Date();
    const validMessages: RelayMessage[] = [];

    for (const raw of rawMessages) {
      try {
        const msg: RelayMessage = JSON.parse(raw);

        // Skip expired messages
        if (new Date(msg.expires_at) <= now) continue;

        // Skip messages with expired negotiations
        if (msg.negotiation_expires_at && new Date(msg.negotiation_expires_at) <= now) continue;

        validMessages.push(msg);
      } catch {
        // Skip malformed messages
        continue;
      }
    }

    return validMessages;
  }

  async acknowledge(sessionId: string, messageIds: string[]): Promise<void> {
    const mailboxKey = keys.mailbox(sessionId);
    const rawMessages = await this.redis.lrange(mailboxKey, 0, -1);

    if (rawMessages.length === 0) return;

    const idsToRemove = new Set(messageIds);

    // Remove acknowledged messages
    // We rebuild the list without the acked messages
    const remaining: string[] = [];
    for (const raw of rawMessages) {
      try {
        const msg: RelayMessage = JSON.parse(raw);
        if (!idsToRemove.has(msg.id)) {
          remaining.push(raw);
        }
      } catch {
        // Drop malformed messages during cleanup
        continue;
      }
    }

    const pipeline = this.redis.pipeline();
    pipeline.del(mailboxKey);
    if (remaining.length > 0) {
      pipeline.rpush(mailboxKey, ...remaining);
      // Preserve TTL
      const currentTtl = await this.redis.ttl(mailboxKey);
      if (currentTtl > 0) {
        pipeline.expire(mailboxKey, currentTtl);
      }
    }
    await pipeline.exec();
  }

  async getMailboxSize(sessionId: string): Promise<number> {
    return this.redis.llen(keys.mailbox(sessionId));
  }

  async clearMailbox(sessionId: string): Promise<void> {
    await this.redis.del(keys.mailbox(sessionId));
  }
}
