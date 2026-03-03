export const config = {
  port: parseInt(process.env.PORT || '8787'),
  redis: {
    url: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  },
  embedding: {
    modelPath: process.env.EMBEDDING_MODEL_PATH || './models/all-MiniLM-L6-v2',
  },
  limits: {
    maxSessionsPerIp: 5,
    maxNegotiationsPerHour: 10,
    maxActiveNegotiations: 3,
    maxQueryResultsDefault: 20,
    maxRelayMessageSize: 8192, // bytes
    maxMailboxSize: 50, // messages per session
  },
  geohash: {
    // Neighboring geohash expansion by radius
    radiusConfig: {
      immediate: 0, // same geohash only
      nearby: 1,    // +1 char less precision (neighbors)
      area: 2,      // +2 chars less precision (wider)
    } as Record<string, number>,
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    // Privacy: don't log IPs in production
    redactIps: process.env.NODE_ENV === 'production',
  },
};
