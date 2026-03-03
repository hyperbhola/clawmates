import type { RedisClient } from '../redis.js';
import { keys } from '../redis.js';
import { config } from '../config.js';

export class RateLimiter {
  constructor(private redis: RedisClient) {}

  /**
   * Check if a session has exceeded the rate limit for an action.
   * Uses a sliding window counter in Redis.
   */
  async check(
    sessionId: string,
    action: string,
    maxCount: number,
    windowSeconds: number,
  ): Promise<{ allowed: boolean; remaining: number; resetIn: number }> {
    const key = keys.rateLimit(sessionId, action);
    const now = Date.now();
    const windowStart = now - windowSeconds * 1000;

    const pipeline = this.redis.pipeline();

    // Remove entries outside the window
    pipeline.zremrangebyscore(key, '-inf', windowStart);
    // Count current entries
    pipeline.zcard(key);
    // Add current request
    pipeline.zadd(key, now, `${now}:${Math.random().toString(36).slice(2)}`);
    // Set TTL on the key
    pipeline.expire(key, windowSeconds);

    const results = await pipeline.exec();
    if (!results) {
      return { allowed: true, remaining: maxCount, resetIn: 0 };
    }

    const currentCount = (results[1]?.[1] as number) || 0;

    if (currentCount >= maxCount) {
      // Over limit — remove the entry we just added
      // (it was added optimistically in the pipeline)
      const ttl = await this.redis.ttl(key);
      return {
        allowed: false,
        remaining: 0,
        resetIn: ttl > 0 ? ttl : windowSeconds,
      };
    }

    return {
      allowed: true,
      remaining: maxCount - currentCount - 1,
      resetIn: windowSeconds,
    };
  }

  /**
   * Rate limit negotiate.open messages: max 10 per hour per session.
   */
  async checkNegotiationOpen(sessionId: string): Promise<{ allowed: boolean; remaining: number }> {
    const result = await this.check(
      sessionId,
      'negotiate_open',
      config.limits.maxNegotiationsPerHour,
      3600,
    );
    return { allowed: result.allowed, remaining: result.remaining };
  }

  /**
   * Rate limit discovery queries: max 30 per minute per session.
   */
  async checkDiscoveryQuery(sessionId: string): Promise<{ allowed: boolean; remaining: number }> {
    const result = await this.check(sessionId, 'discovery_query', 30, 60);
    return { allowed: result.allowed, remaining: result.remaining };
  }

  /**
   * Rate limit presence registrations: max 5 per hour per IP.
   * (called with IP hash instead of session ID)
   */
  async checkRegistration(ipHash: string): Promise<{ allowed: boolean; remaining: number }> {
    const result = await this.check(
      ipHash,
      'register',
      config.limits.maxSessionsPerIp,
      3600,
    );
    return { allowed: result.allowed, remaining: result.remaining };
  }
}
