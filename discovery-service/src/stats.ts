import type { RedisClient } from './redis.js';

const STATS_PREFIX = 'cm:stats:';

/**
 * Lightweight analytics — Redis counters only.
 * No PII, no session correlation, just aggregate numbers.
 */
export class Stats {
  constructor(private redis: RedisClient) {}

  async increment(metric: string): Promise<void> {
    await this.redis.incr(`${STATS_PREFIX}${metric}`);
  }

  async decrement(metric: string): Promise<void> {
    await this.redis.decr(`${STATS_PREFIX}${metric}`);
  }

  async get(metric: string): Promise<number> {
    const val = await this.redis.get(`${STATS_PREFIX}${metric}`);
    return val ? parseInt(val, 10) : 0;
  }

  /**
   * Returns all tracked stats as a flat object.
   * Used by the /stats HTTP endpoint.
   */
  async getAll(): Promise<Record<string, number>> {
    const keys = await this.redis.keys(`${STATS_PREFIX}*`);
    if (keys.length === 0) return {};

    const pipeline = this.redis.pipeline();
    for (const key of keys) {
      pipeline.get(key);
    }
    const results = await pipeline.exec();
    if (!results) return {};

    const stats: Record<string, number> = {};
    for (let i = 0; i < keys.length; i++) {
      const metricName = keys[i].replace(STATS_PREFIX, '');
      const [err, val] = results[i];
      if (!err && val) {
        stats[metricName] = parseInt(val as string, 10);
      }
    }

    return stats;
  }

  /**
   * Returns the funnel metrics — the ones that actually matter.
   */
  async getFunnel(): Promise<{
    registrations: number;
    active_sessions: number;
    discovery_queries: number;
    negotiations_opened: number;
    mutual_interests: number;
    intros_exchanged: number;
    withdrawals: number;
  }> {
    const [
      registrations,
      activeSessions,
      discoveryQueries,
      negotiationsOpened,
      mutualInterests,
      introsExchanged,
      withdrawals,
    ] = await Promise.all([
      this.get('registrations'),
      this.get('active_sessions'),
      this.get('discovery_queries'),
      this.get('negotiations_opened'),
      this.get('mutual_interests'),
      this.get('intros_exchanged'),
      this.get('withdrawals'),
    ]);

    return {
      registrations,
      active_sessions: activeSessions,
      discovery_queries: discoveryQueries,
      negotiations_opened: negotiationsOpened,
      mutual_interests: mutualInterests,
      intros_exchanged: introsExchanged,
      withdrawals,
    };
  }
}
