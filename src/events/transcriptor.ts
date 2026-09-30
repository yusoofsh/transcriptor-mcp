import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { mkdir, readFile, open, rename, lstat } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  EventHub,
  type EventStore,
  type Subscription,
  type Delivery,
  type EventDefinition,
} from './core.js';
import { webhookPost } from './webhook.js';

export const transcriptEvents: EventDefinition[] = [
  {
    name: 'transcript.completed',
    description:
      'A background Whisper transcription completed. Payload contains video and language references; retrieve the transcript with the existing tools.',
    delivery: ['webhook'],
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string' }, language: { type: 'string' } },
      additionalProperties: false,
    },
    payloadSchema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        language: { type: 'string' },
        format: { type: 'string' },
      },
      required: ['url', 'language', 'format'],
      additionalProperties: false,
    },
  },
];
/** One private single-owner deployment. Authentication stays at the existing OAuth ingress. */
export class FileEventStore implements EventStore {
  private state: { subscriptions: Subscription[]; deliveries: Delivery[] } = {
    subscriptions: [],
    deliveries: [],
  };
  private initialized = false;
  constructor(
    readonly path: string,
    readonly key: Buffer
  ) {
    if (key.length !== 32) throw new Error('MCP_EVENTS_STATE_KEY must be 32 bytes');
  }
  private async load() {
    if (this.initialized) return;
    try {
      const info = await lstat(this.path);
      if (!info.isFile() || info.mode & 0o077) throw new Error('Unsafe event state file');
      const data = await readFile(this.path),
        iv = data.subarray(0, 12),
        tag = data.subarray(12, 28);
      const cipher = createDecipheriv('aes-256-gcm', this.key, iv);
      cipher.setAAD(Buffer.from('mcp-events-v1'));
      cipher.setAuthTag(tag);
      this.state = JSON.parse(
        Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString()
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    this.initialized = true;
  }
  private async save() {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const iv = Buffer.from(randomBytes(12)),
      cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from('mcp-events-v1'));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(this.state)), cipher.final()]);
    const temp = this.path + '.' + Buffer.from(randomBytes(12)).toString('hex') + '.tmp';
    const file = await open(temp, 'wx', 0o600);
    try {
      await file.writeFile(Buffer.concat([iv, cipher.getAuthTag(), encrypted]));
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temp, this.path);
  }
  async subscriptions() {
    await this.load();
    return structuredClone(this.state.subscriptions);
  }
  async deliveries() {
    await this.load();
    return structuredClone(this.state.deliveries);
  }
  async putSubscription(s: Subscription) {
    await this.load();
    this.state.subscriptions = this.state.subscriptions.filter((x) => x.id !== s.id);
    this.state.subscriptions.push(s);
    await this.save();
  }
  async deleteSubscription(id: string) {
    await this.load();
    this.state.subscriptions = this.state.subscriptions.filter((x) => x.id !== id);
    await this.save();
  }
  async putDelivery(d: Delivery) {
    await this.load();
    this.state.deliveries = this.state.deliveries.filter((x) => x.id !== d.id);
    this.state.deliveries.push(d);
    await this.save();
  }
  async deleteDelivery(id: string) {
    await this.load();
    this.state.deliveries = this.state.deliveries.filter((x) => x.id !== id);
    await this.save();
  }
}
let hub: EventHub | undefined;
export function getTranscriptEventHub(): EventHub | undefined {
  if (hub) return hub;
  const key = process.env.MCP_EVENTS_STATE_KEY;
  if (!key) return undefined;
  if (!/^[a-fA-F0-9]{64}$/.test(key))
    throw new Error('MCP_EVENTS_STATE_KEY must be a 64-character hex key');
  const owner = process.env.MCP_EVENTS_PRINCIPAL;
  if (!owner)
    throw new Error('MCP_EVENTS_PRINCIPAL must identify the single trusted OAuth ingress owner');
  const check = process.env.MCP_EVENTS_AUTH_CHECK_URL,
    token = process.env.MCP_EVENTS_AUTH_CHECK_TOKEN;
  if (!check?.startsWith('https://') || !token)
    throw new Error('Events require an HTTPS OAuth authorization check and service token');
  hub = new EventHub(
    transcriptEvents,
    new FileEventStore(
      process.env.MCP_EVENTS_STATE_PATH ?? '/data/events/state.enc',
      Buffer.from(key, 'hex')
    ),
    webhookPost,
    async (s) => {
      if (s.owner !== owner) return false;
      try {
        const response = await fetch(check, {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(5000),
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ principal: owner }),
        });
        return (
          response.ok && ((await response.json()) as { authorized?: boolean }).authorized === true
        );
      } catch {
        return false;
      }
    }
  );
  return hub;
}
export async function transcriptCompleted(url: string, language: string, format: string) {
  const events = getTranscriptEventHub();
  if (!events) return;
  const timestamp = new Date().toISOString();
  await events.emit(
    'transcript.completed',
    { url, language, format },
    'evt_' +
      createHash('sha256')
        .update(url + '\0' + language + '\0' + format + '\0' + timestamp)
        .digest('hex'),
    timestamp
  );
  await events.flush();
}
