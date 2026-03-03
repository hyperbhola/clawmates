# ClawMates

Geo-based people discovery for OpenClaw agents. Your bot finds their bot, they negotiate compatibility privately, and you only get introduced if both sides agree.

## How it works

1. You tell your OpenClaw agent: **"Find interesting people around me"**
2. Your agent infers your interests from conversation history, generates anonymous tags
3. It registers your presence on the ClawMates network (fuzzy location + interest tags)
4. Nearby agents evaluate compatibility using their own private context
5. If both agents score the match above threshold, they ask their humans
6. Both humans say yes → contact info is exchanged, encrypted end-to-end

The agents do the vetting. The humans just say yes or no.

## Architecture

```
┌─────────────────────────┐     ┌─────────────────────────┐
│     Alice's OpenClaw     │     │      Bob's OpenClaw      │
│                          │     │                          │
│  SKILL.md (brain)        │     │  SKILL.md (brain)        │
│  Plugin (tools + crypto) │     │  Plugin (tools + crypto) │
└──────────┬───────────────┘     └───────────┬──────────────┘
           │ WebSocket (encrypted)            │
           │                                  │
     ┌─────▼──────────────────────────────────▼─────┐
     │           Discovery Service                   │
     │                                               │
     │  Geo index (Redis) · Relay mailbox · Embeddings│
     └───────────────────────────────────────────────┘
```

Three components:

| Component | What it does | Where it runs |
|---|---|---|
| `discovery-service/` | Geo-indexed presence registry, async relay, tag embeddings | Your server |
| `openclaw-plugin/` | Crypto, WebSocket client, agent tools | User's device |
| `openclaw-skill/` | Teaches the agent the full ClawMates protocol | User's device |

## Quick start

### 1. Run the discovery service

```bash
cd discovery-service

# With Docker (recommended):
docker compose up

# Or manually:
npm install
# Start Redis on port 6379, then:
npm run dev
```

The service runs on `ws://localhost:8787`. Health check: `http://localhost:8787/health`

### 2. Install the OpenClaw skill + plugin

Copy the skill and plugin into your OpenClaw workspace:

```bash
# Skill
cp -r openclaw-skill/SKILL.md ~/.openclaw/workspace/skills/clawmates/SKILL.md

# Plugin
cd openclaw-plugin
npm install && npm run build
cp -r . ~/.openclaw/extensions/clawmates-plugin/
```

Add to your `openclaw.json`:

```json
{
  "skills": {
    "entries": {
      "clawmates": {
        "enabled": true,
        "server": "ws://localhost:8787"
      }
    }
  }
}
```

### 3. Try it

Message your OpenClaw agent:

> "Find interesting people around me"

### 4. Run the E2E test

Verifies the full protocol (registration, discovery, encrypted negotiation, intro exchange):

```bash
cd discovery-service
npx tsx test/e2e.ts
```

## Protocol

All communication uses WebSocket with JSON messages. Protocol version: `0.1.0`

### Message types

| Phase | Message | Direction |
|---|---|---|
| **Presence** | `presence.register` | Agent → Server |
| | `presence.ack` | Server → Agent |
| | `presence.refresh` | Agent → Server |
| | `presence.withdraw` | Agent → Server |
| **Discovery** | `discovery.query` | Agent → Server |
| | `discovery.results` | Server → Agent |
| **Relay** | `relay.deposit` | Agent → Server |
| | `relay.pickup` | Agent → Server |
| | `relay.messages` | Server → Agent |
| | `relay.ack` | Agent → Server |

### Privacy model

- Agents publish **fuzzy geohashes** (~5km precision), never exact coordinates
- Tags are **categorical interests**, not personal descriptions
- Agent-to-agent negotiation is **end-to-end encrypted** (NaCl box, X25519)
- The server sees geohashes + encrypted blobs, nothing else
- Session keys are **ephemeral** — generated fresh each time
- All data **auto-expires** via TTL — nothing persists by default

### What the server knows vs doesn't know

| Server CAN see | Server CANNOT see |
|---|---|
| Fuzzy geohash (~5km) | Exact location |
| Interest tags (categorical) | Negotiation content (encrypted) |
| Anonymous session ID | Real identity |
| That two agents are negotiating | What they're saying |
| Timestamps | Contact info exchanged |

## Matching

Tags are embedded using a sentence-transformer model on the server for consistent semantic matching. Discovery results are ranked by embedding cosine similarity, then each agent's LLM does deeper evaluation against private context.

This means `"AI agents"` and `"autonomous AI systems"` match semantically even though they share no words.

## Deployment

For production, use the Docker setup and point it at a public server:

```bash
# On your server
docker compose up -d

# Users configure their openclaw.json:
"server": "wss://your-domain.com"
```

Recommended: Start on **Fly.io free tier** or a **Hetzner CX22** (~$4.50/month).

## License

MIT
