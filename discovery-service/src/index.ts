import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { pino } from 'pino';
import { config } from './config.js';
import { createRedisClient } from './redis.js';
import { GeoRegistry } from './geo/registry.js';
import { Relay } from './relay/relay.js';
import { EmbeddingService } from './embedding/embedding.js';
import { RateLimiter } from './middleware/rateLimit.js';
import { Stats } from './stats.js';
import { handleMessage } from './handler.js';
import { PROTOCOL_VERSION } from './types.js';

const log = pino({
  level: config.logging.level,
  ...(config.logging.redactIps ? { redact: ['req.remoteAddress'] } : {}),
});

async function main() {
  log.info('Starting ClawMates Discovery Service v%s', PROTOCOL_VERSION);

  // Initialize services
  const redis = createRedisClient(config.redis.url);
  const embedding = new EmbeddingService(config.embedding.modelPath);
  const geoRegistry = new GeoRegistry(redis, embedding);
  const relay = new Relay(redis, config.limits.maxMailboxSize);
  const rateLimiter = new RateLimiter(redis);
  const stats = new Stats(redis);

  await embedding.load();
  log.info('Embedding model loaded');

  // Track WebSocket connections by session ID for real-time relay
  const sessionSockets = new Map<string, WebSocket>();

  // HTTP server (health + stats endpoints)
  const server = createServer(async (req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        protocol_version: PROTOCOL_VERSION,
        uptime: process.uptime(),
        connected_clients: sessionSockets.size,
      }));
      return;
    }

    if (req.url === '/stats') {
      try {
        const funnel = await stats.getFunnel();
        const all = await stats.getAll();

        // Extract geo distribution (keys starting with "geo:")
        const geoDistribution: Record<string, number> = {};
        for (const [key, val] of Object.entries(all)) {
          if (key.startsWith('geo:')) {
            geoDistribution[key.replace('geo:', '')] = val;
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          protocol_version: PROTOCOL_VERSION,
          uptime: process.uptime(),
          connected_clients: sessionSockets.size,
          funnel,
          geo_distribution: geoDistribution,
        }, null, 2));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to fetch stats' }));
      }
      return;
    }

    res.writeHead(404);
    res.end();
  });

  // WebSocket server
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws, req) => {
    const clientId = config.logging.redactIps
      ? 'redacted'
      : req.socket.remoteAddress || 'unknown';

    log.debug({ clientId }, 'New WebSocket connection');

    let boundSessionId: string | null = null;

    ws.on('message', async (data) => {
      try {
        const raw = data.toString();
        if (raw.length > 16384) {
          ws.send(JSON.stringify({
            type: 'error',
            protocol_version: PROTOCOL_VERSION,
            code: 'message_too_large',
            message: 'Message exceeds 16KB limit',
          }));
          return;
        }

        const parsed = JSON.parse(raw);
        const response = await handleMessage(parsed, {
          geoRegistry,
          relay,
          embedding,
          rateLimiter,
          stats,
          sessionSockets,
          log,
        });

        // Bind WebSocket to session for real-time relay
        if (response && 'session_id' in response && response.type === 'presence.ack') {
          const sid = (response as { session_id: string }).session_id;
          boundSessionId = sid;
          sessionSockets.set(sid, ws);
        }

        if (response) {
          ws.send(JSON.stringify(response));
        }

        // If this was a relay.deposit, try real-time delivery too
        if (parsed.type === 'relay.deposit') {
          const targetWs = sessionSockets.get(parsed.to_session);
          if (targetWs && targetWs.readyState === WebSocket.OPEN) {
            targetWs.send(JSON.stringify({
              type: 'relay.notify',
              protocol_version: PROTOCOL_VERSION,
              pending_count: 1,
            }));
          }
        }
      } catch (err) {
        log.error({ err }, 'Error handling message');
        ws.send(JSON.stringify({
          type: 'error',
          protocol_version: PROTOCOL_VERSION,
          code: 'internal_error',
          message: 'Failed to process message',
        }));
      }
    });

    ws.on('close', () => {
      if (boundSessionId) {
        sessionSockets.delete(boundSessionId);
        log.debug({ sessionId: boundSessionId }, 'Session socket unbound');
      }
    });

    ws.on('error', (err) => {
      log.error({ err, clientId }, 'WebSocket error');
    });
  });

  // Start server
  server.listen(config.port, () => {
    log.info('ClawMates Discovery Service listening on port %d', config.port);
    log.info('Stats endpoint: http://localhost:%d/stats', config.port);
  });

  // Graceful shutdown
  const shutdown = async () => {
    log.info('Shutting down...');
    wss.close();
    server.close();
    await redis.quit();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
