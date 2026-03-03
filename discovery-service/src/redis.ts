import Redis from 'ioredis';

export function createRedisClient(url: string): Redis {
  const redis = new Redis(url, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      const delay = Math.min(times * 200, 5000);
      return delay;
    },
    lazyConnect: false,
  });

  redis.on('error', (err) => {
    console.error('Redis connection error:', err.message);
  });

  redis.on('connect', () => {
    console.log('Connected to Redis');
  });

  return redis;
}

// Key namespace helpers
export const keys = {
  session: (id: string) => `cm:session:${id}`,
  geoIndex: () => 'cm:geo:agents',
  mailbox: (sessionId: string) => `cm:mailbox:${sessionId}`,
  rateLimit: (sessionId: string, action: string) => `cm:rate:${sessionId}:${action}`,
  sessionByKey: (publicKey: string) => `cm:pubkey:${publicKey}`,
};
