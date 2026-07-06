import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Env } from '../functions/api/receipt-scan';

const SAMPLE_IMAGE = `data:image/png;base64,${Buffer.from('fake-png-bytes').toString('base64')}`;

function makeRequest(body: any, userId = 'test-user'): Request {
  return new Request('http://test/api/receipt-scan', {
    method: 'POST',
    headers: { 'X-User-Id': userId, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function runHandler(handler: any, request: Request, env: Env) {
  return handler({ request, env, params: {} } as any);
}

describe('POST /api/receipt-scan', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('returns 401 without a user id', async () => {
    const { onRequestPost } = await import('../functions/api/receipt-scan');
    const request = new Request('http://test/api/receipt-scan', {
      method: 'POST',
      body: JSON.stringify({ image: SAMPLE_IMAGE }),
    });
    const response = await onRequestPost({ request, env: {} as Env, params: {} } as any);
    expect(response.status).toBe(401);
  });

  it('degrades gracefully (configured: false) when GEMINI_API_KEY is not set, rather than erroring', async () => {
    const { onRequestPost } = await import('../functions/api/receipt-scan');
    const env = {} as Env;
    const response = await runHandler(onRequestPost, makeRequest({ image: SAMPLE_IMAGE }), env);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.configured).toBe(false);
    expect(data.items).toEqual([]);
  });

  it('rejects a malformed image payload', async () => {
    const { onRequestPost } = await import('../functions/api/receipt-scan');
    const env = { GEMINI_API_KEY: 'fake-key' } as Env;
    const response = await runHandler(onRequestPost, makeRequest({ image: 'not-a-data-url' }), env);
    expect(response.status).toBe(400);
  });

  it('parses a successful Gemini response into structured line items', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain('generativelanguage.googleapis.com');
      expect(url).toContain('key=fake-key');
      return new Response(JSON.stringify({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                merchant: 'REWE',
                total: 12.5,
                items: [
                  { name: 'Milch', price: 1.29, quantity: null },
                  { name: 'Bananen', price: 2.49, quantity: '1kg' },
                ],
              }),
            }],
          },
        }],
      }), { status: 200 });
    });
    global.fetch = fetchMock as any;

    const { onRequestPost } = await import('../functions/api/receipt-scan');
    const env = { GEMINI_API_KEY: 'fake-key' } as Env;
    const response = await runHandler(onRequestPost, makeRequest({ image: SAMPLE_IMAGE }), env);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.configured).toBe(true);
    expect(data.merchant).toBe('REWE');
    expect(data.total).toBe(12.5);
    expect(data.items).toEqual([
      { name: 'Milch', price: 1.29, quantity: null },
      { name: 'Bananen', price: 2.49, quantity: '1kg' },
    ]);
  });

  it('strips a markdown code fence if the model wraps its JSON in one', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: '```json\n{"merchant":null,"total":null,"items":[{"name":"Brot","price":2,"quantity":null}]}\n```' }] } }],
    }), { status: 200 }));
    global.fetch = fetchMock as any;

    const { onRequestPost } = await import('../functions/api/receipt-scan');
    const env = { GEMINI_API_KEY: 'fake-key' } as Env;
    const response = await runHandler(onRequestPost, makeRequest({ image: SAMPLE_IMAGE }), env);
    const data = await response.json();
    expect(data.items).toEqual([{ name: 'Brot', price: 2, quantity: null }]);
  });

  it('returns 502 if the upstream call fails', async () => {
    global.fetch = vi.fn(async () => new Response('error', { status: 500 })) as any;
    const { onRequestPost } = await import('../functions/api/receipt-scan');
    const env = { GEMINI_API_KEY: 'fake-key' } as Env;
    const response = await runHandler(onRequestPost, makeRequest({ image: SAMPLE_IMAGE }), env);
    expect(response.status).toBe(502);
  });

  it('returns 502 if the model output cannot be parsed as JSON', async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'sorry, I cannot read this receipt' }] } }],
    }), { status: 200 })) as any;
    const { onRequestPost } = await import('../functions/api/receipt-scan');
    const env = { GEMINI_API_KEY: 'fake-key' } as Env;
    const response = await runHandler(onRequestPost, makeRequest({ image: SAMPLE_IMAGE }), env);
    expect(response.status).toBe(502);
  });
});
