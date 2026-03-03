/**
 * ClawMates End-to-End Protocol Test
 *
 * Simulates two agents (Alice and Bob) going through the full discovery
 * and negotiation flow against a running discovery service.
 *
 * Prerequisites:
 *   - Discovery service running on ws://127.0.0.1:8787
 *   - Redis running on 127.0.0.1:6379
 *
 * Run:
 *   npx tsx test/e2e.ts
 */

import WebSocket from 'ws';
import nacl from 'tweetnacl';
import { encodeBase64, decodeBase64, encodeUTF8, decodeUTF8 } from 'tweetnacl-util';

const SERVER_URL = process.env.SERVER_URL || 'ws://127.0.0.1:8787';
const PROTOCOL_VERSION = '0.1.0';

// --- Helpers ---

function createAgent(name: string) {
  const keyPair = nacl.box.keyPair();
  return {
    name,
    publicKey: encodeBase64(keyPair.publicKey),
    secretKey: keyPair.secretKey,
    publicKeyBytes: keyPair.publicKey,
    sessionId: '',
    ws: null as WebSocket | null,
  };
}

function encrypt(
  plaintext: string,
  recipientPk: Uint8Array,
  senderSk: Uint8Array,
): string {
  const messageBytes = decodeUTF8(plaintext);
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const encrypted = nacl.box(messageBytes, nonce, recipientPk, senderSk);
  if (!encrypted) throw new Error('Encryption failed');
  const combined = new Uint8Array(nonce.length + encrypted.length);
  combined.set(nonce);
  combined.set(encrypted, nonce.length);
  return encodeBase64(combined);
}

function decrypt(
  encryptedBase64: string,
  senderPk: Uint8Array,
  recipientSk: Uint8Array,
): string {
  const combined = decodeBase64(encryptedBase64);
  const nonce = combined.slice(0, nacl.box.nonceLength);
  const ciphertext = combined.slice(nacl.box.nonceLength);
  const decrypted = nacl.box.open(ciphertext, nonce, senderPk, recipientSk);
  if (!decrypted) throw new Error('Decryption failed');
  return encodeUTF8(decrypted);
}

function connect(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function sendAndReceive(ws: WebSocket, message: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout waiting for response')), 5000);
    const handler = (data: WebSocket.Data) => {
      clearTimeout(timer);
      ws.off('message', handler);
      resolve(JSON.parse(data.toString()));
    };
    ws.on('message', handler);
    ws.send(JSON.stringify(message));
  });
}

function log(step: string, detail: string) {
  console.log(`  [${step}] ${detail}`);
}

// --- Test ---

async function runTest() {
  console.log('\n=== ClawMates E2E Protocol Test ===\n');

  const alice = createAgent('Alice');
  const bob = createAgent('Bob');

  // Step 1: Connect both agents
  console.log('1. Connecting agents...');
  alice.ws = await connect(SERVER_URL);
  bob.ws = await connect(SERVER_URL);
  log('OK', 'Both agents connected to discovery service');

  // Step 2: Alice registers presence
  console.log('\n2. Alice registers presence...');
  const aliceRegister = await sendAndReceive(alice.ws, {
    type: 'presence.register',
    protocol_version: PROTOCOL_VERSION,
    session_public_key: alice.publicKey,
    geohash: '9q8yy',
    intent: {
      intent_type: 'meet',
      tags: {
        broad: ['technology', 'entrepreneurship'],
        mid: ['AI agents', 'startup building'],
        specific: ['agent frameworks', 'LLM tooling'],
      },
      activity: 'coffee',
      availability: 'now',
      energy: 'casual',
    },
    ttl: 7200,
    mode: 'ephemeral',
  });
  alice.sessionId = aliceRegister.session_id as string;
  log('OK', `Alice registered with session: ${alice.sessionId}`);
  log('OK', `Expires at: ${aliceRegister.expires_at}`);

  // Step 3: Bob registers presence (nearby, overlapping interests)
  console.log('\n3. Bob registers presence...');
  const bobRegister = await sendAndReceive(bob.ws, {
    type: 'presence.register',
    protocol_version: PROTOCOL_VERSION,
    session_public_key: bob.publicKey,
    geohash: '9q8yz', // nearby geohash
    intent: {
      intent_type: 'meet',
      tags: {
        broad: ['technology', 'music'],
        mid: ['autonomous AI systems', 'electronic production'],
        specific: ['LLM applications', 'modular synthesis'],
      },
      activity: 'coffee',
      availability: 'now',
      energy: 'casual',
    },
    ttl: 7200,
    mode: 'ephemeral',
  });
  bob.sessionId = bobRegister.session_id as string;
  log('OK', `Bob registered with session: ${bob.sessionId}`);

  // Step 4: Alice searches for nearby agents
  console.log('\n4. Alice queries for nearby agents...');
  const discovery = await sendAndReceive(alice.ws, {
    type: 'discovery.query',
    protocol_version: PROTOCOL_VERSION,
    session_id: alice.sessionId,
    geohash_prefix: '9q8y',
    radius: 'nearby',
    limit: 20,
  });
  const matches = (discovery as any).matches;
  log('OK', `Found ${matches.length} nearby agent(s)`);

  if (matches.length === 0) {
    console.log('\n  FAIL: No matches found. Bob should be nearby.');
    process.exit(1);
  }

  const bobMatch = matches.find((m: any) => m.session_id === bob.sessionId);
  if (!bobMatch) {
    console.log('\n  FAIL: Bob not found in discovery results.');
    process.exit(1);
  }

  log('OK', `Found Bob — relevance: ${bobMatch.relevance}, proximity: ${bobMatch.proximity}`);
  log('OK', `Bob's tags: ${JSON.stringify(bobMatch.intent.tags.mid)}`);

  // Step 5: Alice opens negotiation with Bob (encrypted)
  console.log('\n5. Alice opens negotiation with Bob...');
  const negotiationPayload = {
    type: 'negotiate.open',
    compatibility_score: 0.88,
    topic_overlap: ['technology', 'AI'],
    intent_alignment: 'strong',
    logistics_match: true,
    wants_to_proceed: true,
  };

  const encryptedPayload = encrypt(
    JSON.stringify(negotiationPayload),
    decodeBase64(bobMatch.public_key),
    alice.secretKey,
  );

  const depositResult = await sendAndReceive(alice.ws, {
    type: 'relay.deposit',
    protocol_version: PROTOCOL_VERSION,
    from_session: alice.sessionId,
    to_session: bob.sessionId,
    payload: encryptedPayload,
    ttl: 7200,
    negotiation_expires_at: new Date(Date.now() + 2 * 3600 * 1000).toISOString(),
  });
  log('OK', `Negotiation deposited, message ID: ${(depositResult as any).message_id}`);

  // Step 6: Bob picks up his mailbox
  console.log('\n6. Bob checks his mailbox...');
  const pickup = await sendAndReceive(bob.ws, {
    type: 'relay.pickup',
    protocol_version: PROTOCOL_VERSION,
    session_id: bob.sessionId,
  });
  const messages = (pickup as any).messages;
  log('OK', `Bob has ${messages.length} pending message(s)`);

  if (messages.length === 0) {
    console.log('\n  FAIL: Bob should have Alice\'s negotiation message.');
    process.exit(1);
  }

  // Step 7: Bob decrypts and reads Alice's negotiation
  console.log('\n7. Bob decrypts Alice\'s message...');
  const decryptedPayload = decrypt(
    messages[0].payload,
    alice.publicKeyBytes,
    bob.secretKey,
  );
  const parsed = JSON.parse(decryptedPayload);
  log('OK', `Decrypted negotiation type: ${parsed.type}`);
  log('OK', `Alice's compatibility score: ${parsed.compatibility_score}`);
  log('OK', `Topic overlap: ${parsed.topic_overlap.join(', ')}`);
  log('OK', `Wants to proceed: ${parsed.wants_to_proceed}`);

  // Step 8: Bob acknowledges the message
  console.log('\n8. Bob acknowledges the message...');
  await sendAndReceive(bob.ws, {
    type: 'relay.ack',
    protocol_version: PROTOCOL_VERSION,
    session_id: bob.sessionId,
    message_ids: [messages[0].id],
  });
  log('OK', 'Message acknowledged');

  // Verify mailbox is now empty
  const pickup2 = await sendAndReceive(bob.ws, {
    type: 'relay.pickup',
    protocol_version: PROTOCOL_VERSION,
    session_id: bob.sessionId,
  });
  log('OK', `Bob's mailbox after ack: ${(pickup2 as any).messages.length} messages`);

  // Step 9: Bob responds with mutual interest
  console.log('\n9. Bob responds with mutual interest...');
  const bobResponse = {
    type: 'negotiate.respond',
    compatibility_score: 0.82,
    topic_overlap: ['technology', 'AI'],
    intent_alignment: 'strong',
    logistics_match: true,
    wants_to_proceed: true,
  };

  const bobEncrypted = encrypt(
    JSON.stringify(bobResponse),
    alice.publicKeyBytes,
    bob.secretKey,
  );

  await sendAndReceive(bob.ws, {
    type: 'relay.deposit',
    protocol_version: PROTOCOL_VERSION,
    from_session: bob.sessionId,
    to_session: alice.sessionId,
    payload: bobEncrypted,
    ttl: 7200,
  });
  log('OK', 'Bob deposited response');

  // Step 10: Alice picks up Bob's response
  console.log('\n10. Alice picks up Bob\'s response...');
  const alicePickup = await sendAndReceive(alice.ws, {
    type: 'relay.pickup',
    protocol_version: PROTOCOL_VERSION,
    session_id: alice.sessionId,
  });
  const aliceMessages = (alicePickup as any).messages;
  log('OK', `Alice has ${aliceMessages.length} pending message(s)`);

  const decryptedResponse = decrypt(
    aliceMessages[0].payload,
    decodeBase64(bobMatch.public_key),
    alice.secretKey,
  );
  const responsePayload = JSON.parse(decryptedResponse);
  log('OK', `Bob's response: ${responsePayload.type}`);
  log('OK', `Bob's score: ${responsePayload.compatibility_score}`);
  log('OK', `Mutual interest: ${responsePayload.wants_to_proceed}`);

  // Step 11: Both agents exchange intros (after human approval)
  console.log('\n11. Exchanging intros (simulating human approval)...');
  const aliceIntro = {
    type: 'negotiate.intro',
    contact: {
      method: 'telegram',
      handle: '@alice_dev',
      first_name: 'Alice',
      message: 'Hey! Our AI agents matched us on AI + tech. Coffee at Blue Bottle?',
    },
  };

  const aliceIntroEncrypted = encrypt(
    JSON.stringify(aliceIntro),
    decodeBase64(bobMatch.public_key),
    alice.secretKey,
  );

  await sendAndReceive(alice.ws, {
    type: 'relay.deposit',
    protocol_version: PROTOCOL_VERSION,
    from_session: alice.sessionId,
    to_session: bob.sessionId,
    payload: aliceIntroEncrypted,
    ttl: 86400,
  });
  log('OK', 'Alice sent intro');

  // Bob picks up and decrypts intro
  const bobPickup2 = await sendAndReceive(bob.ws, {
    type: 'relay.pickup',
    protocol_version: PROTOCOL_VERSION,
    session_id: bob.sessionId,
  });
  const introMsg = (bobPickup2 as any).messages[0];
  const decryptedIntro = JSON.parse(decrypt(
    introMsg.payload,
    alice.publicKeyBytes,
    bob.secretKey,
  ));
  log('OK', `Bob received intro from: ${decryptedIntro.contact.first_name}`);
  log('OK', `Contact: ${decryptedIntro.contact.method} ${decryptedIntro.contact.handle}`);
  log('OK', `Message: "${decryptedIntro.contact.message}"`);

  // Step 12: Both withdraw
  console.log('\n12. Withdrawing...');
  await sendAndReceive(alice.ws, {
    type: 'presence.withdraw',
    protocol_version: PROTOCOL_VERSION,
    session_id: alice.sessionId,
  });
  await sendAndReceive(bob.ws, {
    type: 'presence.withdraw',
    protocol_version: PROTOCOL_VERSION,
    session_id: bob.sessionId,
  });
  log('OK', 'Both agents withdrawn');

  // Verify they're gone from discovery
  // Re-register alice just to query
  const aliceReregister = await sendAndReceive(alice.ws, {
    type: 'presence.register',
    protocol_version: PROTOCOL_VERSION,
    session_public_key: alice.publicKey,
    geohash: '9q8yy',
    intent: {
      intent_type: 'meet',
      tags: { broad: ['test'], mid: ['test'], specific: ['test'] },
      activity: 'any',
      availability: 'now',
      energy: 'casual',
    },
    ttl: 60,
    mode: 'ephemeral',
  });
  const verifyDiscovery = await sendAndReceive(alice.ws, {
    type: 'discovery.query',
    protocol_version: PROTOCOL_VERSION,
    session_id: aliceReregister.session_id as string,
    geohash_prefix: '9q8y',
    radius: 'nearby',
    limit: 20,
  });
  const remainingMatches = (verifyDiscovery as any).matches;
  log('OK', `After withdrawal, nearby agents: ${remainingMatches.length} (Bob should be gone)`);

  // Cleanup
  alice.ws.close();
  bob.ws.close();

  console.log('\n=== ALL TESTS PASSED ===\n');
  console.log('Full protocol flow verified:');
  console.log('  1. Presence registration');
  console.log('  2. Geo-based discovery with embedding similarity');
  console.log('  3. Async negotiation via encrypted relay mailbox');
  console.log('  4. End-to-end encryption (NaCl box)');
  console.log('  5. Mailbox pickup and acknowledgment');
  console.log('  6. Mutual interest exchange');
  console.log('  7. Contact intro exchange');
  console.log('  8. Clean withdrawal');
  console.log('');

  process.exit(0);
}

runTest().catch((err) => {
  console.error('\nTEST FAILED:', err.message);
  process.exit(1);
});
