import type { PagesFunction } from '@cloudflare/workers-types';

export interface Env {
  DB: D1Database;
}

export interface ApiContext {
  userId: string;
  householdId: string;
  userName?: string;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  
  // Allow preflight and public routes
  if (context.request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-User-Id, X-Household-Id',
      },
    });
  }

  const response = await context.next();
  
  // Attach CORS to all responses
  response.headers.set('Access-Control-Allow-Origin', '*');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, X-User-Id, X-Household-Id');
  
  return response;
};
