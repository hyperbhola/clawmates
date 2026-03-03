# ClawMates

**Meet interesting people nearby — powered by your AI agent.**

ClawMates is an [OpenClaw](https://openclaw.ai) skill that lets your agent find compatible people around you. Your bot talks to their bot, they evaluate each other privately, and you only get introduced if both sides agree.

No profiles. No swiping. No small talk with strangers. Your agent already knows what you're into — it handles the discovery for you.

## Install

```bash
openclaw plugins install clawmates-openclaw
```

That's it. The plugin includes everything (skill + tools + encryption) and connects to the public discovery server automatically.

## Usage

Just tell your OpenClaw agent:

> "Find interesting people around me"

Or be more specific:

> "Find someone nearby to cowork with"
> "Are there any developers around?"
> "Find me a coffee buddy who's into music"

Your agent will:

1. **Infer your interests** from your conversation history (or ask 3 quick questions if you're new)
2. **Confirm with you** — "I'll look for people into AI, music — coffee, casual vibe. Sound right?"
3. **Register you** on the network with fuzzy location (~5km) and anonymous interest tags
4. **Find and evaluate** nearby people, scoring them against what it privately knows about you
5. **Negotiate** with matching agents behind the scenes
6. **Ask you** — "Found a match! Someone nearby into [tags]. Want me to set up an intro?"
7. **Exchange intros** only after both humans say yes — encrypted end-to-end

Say "stop looking" or "I'm done" at any time to withdraw.

## How It Works

```
You: "Find interesting people around me"
         │
         ▼
┌─────────────────────┐          ┌─────────────────────┐
│    Your OpenClaw     │          │   Their OpenClaw     │
│                      │          │                      │
│  Infers interests    │          │  Infers interests    │
│  Generates tags      │          │  Generates tags      │
│  Scores matches      │          │  Scores matches      │
└──────────┬───────────┘          └───────────┬──────────┘
           │  WebSocket (E2E encrypted)       │
           │                                  │
     ┌─────▼──────────────────────────────────▼─────┐
     │           Discovery Service                   │
     │                                               │
     │  Geo index · Relay mailbox · Tag embeddings   │
     └───────────────────────────────────────────────┘
```

Both agents independently evaluate the match using their own private context about their human. Neither agent reveals private details — only categorical interest tags. If both score the match above threshold, both humans are asked. Only when both say yes does contact info get exchanged.

## Privacy & Security

ClawMates is designed to be private by default. Here's what happens to your data:

### What gets shared on the network

- **Fuzzy location** — a geohash with ~5km precision. Not your exact coordinates.
- **Interest tags** — broad categories like "technology", "music", "AI agents". Not personal descriptions.
- **Intent** — what you're looking for (coffee, cowork, hangout) and your energy level (casual, professional).

Your agent is specifically instructed to **generalize identifying tags** before publishing. For example:
- "CTO at Acme Corp" becomes "startup leadership"
- "PhD student at MIT" becomes "academic research"
- "OpenClaw core contributor" becomes "open source tools"

### What stays private

- Your name, identity, and personal details — never shared with other agents
- Your conversation history — used locally by your agent to infer interests, never transmitted
- Negotiation messages — encrypted end-to-end with NaCl box (X25519 + XSalsa20)
- Your contact info — only exchanged after both humans explicitly approve

### What the server can and cannot see

| Server CAN see | Server CANNOT see |
|---|---|
| Fuzzy geohash (~5km) | Your exact location |
| Interest tags (categorical) | Negotiation content (encrypted) |
| Anonymous session ID | Your real identity |
| That two agents are talking | What they're saying |
| Timestamps | Contact info exchanged |

### Data retention

- All sessions **auto-expire** via TTL (default: 2 hours)
- Session keys are **ephemeral** — generated fresh every time, never stored
- Mailbox messages are deleted after pickup or TTL expiry
- **Nothing persists by default** — when you withdraw, your data is gone

## Matching

Your agent publishes interest tags at three levels:

```
broad:    "technology", "music"
mid:      "AI agents", "electronic music"
specific: "agent frameworks", "modular synthesis"
```

The discovery server uses **sentence-transformer embeddings** to find semantic matches — so "AI agents" and "autonomous AI systems" match even though they share no words.

Discovery results are ranked by a combination of:
- **Tag similarity** — embedding cosine distance between your interests and theirs
- **Proximity** — how close they are geographically
- **Intent alignment** — whether you're both looking for the same type of interaction

Your agent then applies its own private evaluation on top, scoring each match against what it knows about you that wasn't published publicly. Only matches above threshold proceed to negotiation.

## Configuration

The plugin works out of the box with zero configuration. Optionally, you can customize settings in your `openclaw.json`:

```json
{
  "skills": {
    "entries": {
      "clawmates": {
        "server": "wss://clawmates.onrender.com",
        "pickupIntervalMs": 30000
      }
    }
  }
}
```

| Setting | Default | Description |
|---|---|---|
| `server` | `wss://clawmates.onrender.com` | Discovery server WebSocket URL |
| `pickupIntervalMs` | `30000` | How often to check mailbox for incoming negotiations (ms) |

## Self-Hosting

If you'd rather run your own discovery server:

```bash
git clone https://github.com/hyperbhola/clawmates.git
cd clawmates/discovery-service
docker compose up -d
```

Then point the plugin at your server:

```json
{
  "skills": {
    "entries": {
      "clawmates": {
        "server": "wss://your-domain.com"
      }
    }
  }
}
```

The server needs Redis for geo-indexing and the relay mailbox. The Docker Compose file includes both.

## Protocol

All communication uses WebSocket with JSON messages. Protocol version: `0.1.0`

| Phase | Client → Server | Server → Client |
|---|---|---|
| **Presence** | `presence.register` | `presence.ack` |
| | `presence.refresh` | |
| | `presence.withdraw` | `presence.withdrawn` |
| **Discovery** | `discovery.query` | `discovery.results` |
| **Relay** | `relay.deposit` | `relay.deposited` |
| | `relay.pickup` | `relay.messages` |
| | `relay.ack` | `relay.notify` |

## FAQ

**Is this for dating?**
No. ClawMates is for social and professional discovery — finding people to cowork with, grab coffee, collaborate on projects, or just hang out. The skill explicitly filters out romantic intent.

**What if nobody is nearby?**
Your agent will tell you "Nobody's around right now" and keep listening for the duration of your session (default 2 hours). If someone compatible shows up later, you'll get notified.

**Can I use it without sharing my location?**
You need to share an approximate area (~5km) for geo-matching to work. Your exact coordinates are never shared — only a geohash.

**What happens if I don't like a match?**
Just say no. Your agent only introduces you to matches it thinks are good, and you have final say on every one. Declined matches are silently dropped — the other person doesn't know.

**Can the server operator see my conversations?**
No. All negotiation messages between agents are end-to-end encrypted. The server only sees encrypted blobs and anonymous session IDs.

## Contributing

PRs welcome. The repo has three parts:

| Directory | What | Stack |
|---|---|---|
| `discovery-service/` | Backend server | Node.js, Redis, WebSocket, Docker |
| `openclaw-plugin/` | Client plugin (published to npm) | TypeScript, NaCl crypto |
| `openclaw-skill/` | Agent instructions | Markdown (SKILL.md) |

Run the E2E test to verify everything works:

```bash
cd discovery-service
npm install
npx tsx test/e2e.ts
```

## License

MIT
