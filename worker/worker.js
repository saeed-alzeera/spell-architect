/*
 * Spell Architect signaling worker.
 *
 *   /mp/*   public multiplayer signaling (room codes + WebRTC handshake only; see mp.js)
 *   /runs   run analytics store: public upload, admin read (see runs.js)
 */
import { DurableObject } from 'cloudflare:workers';
import { MPRoomCore, handleMp } from './mp.js';
import { RunStoreCore, handleRuns } from './runs.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
};

/** One Durable Object per multiplayer room code; all logic lives in MPRoomCore (mp.js). */
export class MPRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.core = new MPRoomCore(ctx.storage);
  }
  create(hostKey, now) { return this.core.create(hostKey, now); }
  info() { return this.core.info(); }
  join(name) { return this.core.join(name); }
  signal(as, key, to, kind, data) { return this.core.signal(as, key, to, kind, data); }
  poll(as, key, after, waitMs) { return this.core.poll(as, key, after, waitMs); }
  lock(key) { return this.core.lock(key); }
  close(key) { return this.core.close(key); }
  async alarm() { await this.core.expire(); }
}

/** One Durable Object holds all uploaded runs; logic lives in RunStoreCore (runs.js). */
export class RunStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.core = new RunStoreCore(ctx.storage);
  }
  put(rec) { return this.core.put(rec); }
  list(opts) { return this.core.list(opts); }
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const parts = new URL(request.url).pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (parts[0] === 'mp') return handleMp(request, env, parts);
    if (parts[0] === 'runs') return handleRuns(request, env, parts);
    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json', ...CORS } });
  },
};
