import type { PagesFunction } from '@cloudflare/workers-types';
import type { Env as BaseEnv } from '../_middleware';
import { readVapidConfig, type PushEnv } from './_pushLib';

export interface Env extends BaseEnv, PushEnv {}

// Exposes just the *public* VAPID key + a boolean saying whether push is
// configured server-side. The client uses this before attempting to
// subscribe so it can (a) grab the applicationServerKey PushManager
// needs, and (b) short-circuit the subscribe flow with a clear message
// if the server isn't set up (rather than triggering a permission
// prompt that would then fail).
//
// Deliberately unauthenticated: the public key is, well, public — it's
// the same value baked into every subscription — and the "configured?"
// boolean leaks nothing sensitive.
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const vapid = readVapidConfig(env);
  if (!vapid) {
    return Response.json({ configured: false, publicKey: null });
  }
  return Response.json({ configured: true, publicKey: vapid.publicKey });
};
