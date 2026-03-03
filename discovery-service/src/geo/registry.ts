import type Redis from 'ioredis';
import { nanoid } from 'nanoid';
import { keys } from '../redis.js';
import { config } from '../config.js';
import type { EmbeddingService } from '../embedding/embedding.js';
import type { Intent, StoredSession, DiscoveryResultMatch } from '../types.js';
import { expandGeohashForRadius, geohashMatchesAny } from './geohash.js';

interface RegisterParams {
  publicKey: string;
  geohash: string;
  intent: Intent;
  ttl: number;
  mode: 'ephemeral' | 'persistent';
}

interface QueryParams {
  sessionId: string;
  geohashPrefix: string;
  radius: 'immediate' | 'nearby' | 'area';
  limit: number;
}

export class GeoRegistry {
  constructor(
    private redis: Redis,
    private embedding: EmbeddingService,
  ) {}

  async register(params: RegisterParams): Promise<{ session_id: string; expires_at: string }> {
    const sessionId = nanoid(21);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + params.ttl * 1000);

    // Generate embedding for the intent tags
    const embeddingVec = await this.embedding.embed(params.intent.tags);

    const session: StoredSession = {
      session_id: sessionId,
      public_key: params.publicKey,
      geohash: params.geohash,
      intent: params.intent,
      mode: params.mode,
      embedding: embeddingVec,
      registered_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    };

    const pipeline = this.redis.pipeline();

    // Store session data with TTL
    pipeline.set(
      keys.session(sessionId),
      JSON.stringify(session),
      'EX',
      params.ttl,
    );

    // Map public key to session ID (for dedup)
    pipeline.set(
      keys.sessionByKey(params.publicKey),
      sessionId,
      'EX',
      params.ttl,
    );

    // Add to geohash-based sets for prefix matching
    // We store the session in a set keyed by its geohash prefix
    // This enables efficient prefix-based lookups
    for (let prefixLen = 2; prefixLen <= params.geohash.length; prefixLen++) {
      const prefix = params.geohash.slice(0, prefixLen);
      pipeline.sadd(`cm:geo:prefix:${prefix}`, sessionId);
      pipeline.expire(`cm:geo:prefix:${prefix}`, params.ttl);
    }

    await pipeline.exec();

    return {
      session_id: sessionId,
      expires_at: expiresAt.toISOString(),
    };
  }

  async refresh(
    sessionId: string,
    newTtl?: number,
  ): Promise<{ expires_at: string } | null> {
    const sessionData = await this.redis.get(keys.session(sessionId));
    if (!sessionData) return null;

    const session: StoredSession = JSON.parse(sessionData);
    const ttl = newTtl || Math.floor(
      (new Date(session.expires_at).getTime() - new Date(session.registered_at).getTime()) / 1000,
    );

    const expiresAt = new Date(Date.now() + ttl * 1000);
    session.expires_at = expiresAt.toISOString();

    const pipeline = this.redis.pipeline();

    pipeline.set(keys.session(sessionId), JSON.stringify(session), 'EX', ttl);
    pipeline.expire(keys.sessionByKey(session.public_key), ttl);

    // Refresh geohash prefix sets
    for (let prefixLen = 2; prefixLen <= session.geohash.length; prefixLen++) {
      const prefix = session.geohash.slice(0, prefixLen);
      pipeline.expire(`cm:geo:prefix:${prefix}`, ttl);
    }

    await pipeline.exec();

    return { expires_at: expiresAt.toISOString() };
  }

  async withdraw(sessionId: string): Promise<void> {
    const sessionData = await this.redis.get(keys.session(sessionId));
    if (!sessionData) return;

    const session: StoredSession = JSON.parse(sessionData);

    const pipeline = this.redis.pipeline();
    pipeline.del(keys.session(sessionId));
    pipeline.del(keys.sessionByKey(session.public_key));

    // Remove from geohash prefix sets
    for (let prefixLen = 2; prefixLen <= session.geohash.length; prefixLen++) {
      const prefix = session.geohash.slice(0, prefixLen);
      pipeline.srem(`cm:geo:prefix:${prefix}`, sessionId);
    }

    await pipeline.exec();
  }

  async sessionExists(sessionId: string): Promise<boolean> {
    const exists = await this.redis.exists(keys.session(sessionId));
    return exists === 1;
  }

  async getSession(sessionId: string): Promise<StoredSession | null> {
    const data = await this.redis.get(keys.session(sessionId));
    if (!data) return null;
    return JSON.parse(data);
  }

  async query(params: QueryParams): Promise<DiscoveryResultMatch[]> {
    const { sessionId, geohashPrefix, radius, limit } = params;

    // Get the querying session's embedding for similarity ranking
    const querySession = await this.getSession(sessionId);
    if (!querySession) return [];

    // Expand geohash based on radius
    const expansionLevel = config.geohash.radiusConfig[radius] ?? 1;
    const searchPrefixes = expandGeohashForRadius(geohashPrefix, expansionLevel);

    // Collect candidate session IDs from all matching prefix sets
    const candidateIds = new Set<string>();
    for (const prefix of searchPrefixes) {
      const members = await this.redis.smembers(`cm:geo:prefix:${prefix}`);
      for (const id of members) {
        if (id !== sessionId) { // Exclude self
          candidateIds.add(id);
        }
      }
    }

    if (candidateIds.size === 0) return [];

    // Fetch all candidate sessions
    const pipeline = this.redis.pipeline();
    for (const id of candidateIds) {
      pipeline.get(keys.session(id));
    }
    const results = await pipeline.exec();
    if (!results) return [];

    // Parse sessions and compute similarity
    const scored: Array<{ session: StoredSession; relevance: number }> = [];

    for (const [err, data] of results) {
      if (err || !data) continue;
      try {
        const session: StoredSession = JSON.parse(data as string);

        // Verify the geohash actually matches our search prefixes
        if (!geohashMatchesAny(session.geohash, searchPrefixes)) continue;

        // Compute embedding similarity
        const relevance = await this.embedding.cosineSimilarity(
          querySession.embedding,
          session.embedding,
        );

        scored.push({ session, relevance });
      } catch {
        // Skip malformed sessions
        continue;
      }
    }

    // Sort by relevance, take top N
    scored.sort((a, b) => b.relevance - a.relevance);
    const topMatches = scored.slice(0, limit);

    // Determine proximity label
    return topMatches.map(({ session, relevance }) => ({
      session_id: session.session_id,
      geohash: session.geohash,
      public_key: session.public_key,
      intent: session.intent,
      proximity: this.computeProximity(geohashPrefix, session.geohash),
      relevance: Math.round(relevance * 1000) / 1000, // 3 decimal places
      registered_at: session.registered_at,
    }));
  }

  private computeProximity(
    queryPrefix: string,
    targetGeohash: string,
  ): 'immediate' | 'nearby' | 'area' {
    // How much of the prefix matches?
    let matchLen = 0;
    for (let i = 0; i < Math.min(queryPrefix.length, targetGeohash.length); i++) {
      if (queryPrefix[i] === targetGeohash[i]) {
        matchLen++;
      } else {
        break;
      }
    }

    if (matchLen >= queryPrefix.length) return 'immediate';
    if (matchLen >= queryPrefix.length - 1) return 'nearby';
    return 'area';
  }
}
