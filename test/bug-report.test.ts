import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { Env } from '../functions/api/bug-report';

function makeRequest(body: any, userId = 'test-user'): Request {
  return new Request('http://test/api/bug-report', {
    method: 'POST',
    headers: { 'X-User-Id': userId, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function runHandler(handler: any, request: Request, env: Env) {
  return handler({ request, env, params: {} } as any);
}

describe('POST /api/bug-report', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('returns 501 when GITHUB_PAT is not configured', async () => {
    const { onRequestPost } = await import('../functions/api/bug-report');
    const env = {} as Env;
    const response = await runHandler(onRequestPost, makeRequest({ title: 'Bug' }), env);
    expect(response.status).toBe(501);
    const data = await response.json();
    expect(data.error).toContain('GITHUB_PAT');
  });

  it('returns 400 when title is missing', async () => {
    const { onRequestPost } = await import('../functions/api/bug-report');
    const env = { GITHUB_PAT: 'fake-token' } as Env;
    const response = await runHandler(onRequestPost, makeRequest({ title: '' }), env);
    expect(response.status).toBe(400);
  });

  it('creates an issue via the GitHub API and returns its URL', async () => {
    const fetchMock = vi.fn(async (url: string, init: any) => {
      if (url.includes('/issues') && init.method === 'POST') {
        const body = JSON.parse(init.body);
        expect(body.title).toBe('Something broke');
        expect(body.labels).toContain('bug');
        return new Response(
          JSON.stringify({ html_url: 'https://github.com/whoseyci/Peerson/issues/42', number: 42 }),
          { status: 201 }
        );
      }
      throw new Error('Unexpected fetch call: ' + url);
    });
    global.fetch = fetchMock as any;

    const { onRequestPost } = await import('../functions/api/bug-report');
    const env = { GITHUB_PAT: 'fake-token' } as Env;
    const response = await runHandler(
      onRequestPost,
      makeRequest({ title: 'Something broke', description: 'It broke badly', context: { View: 'inventory' } }),
      env
    );
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.number).toBe(42);
    expect(data.url).toBe('https://github.com/whoseyci/Peerson/issues/42');
  });

  it('uploads a screenshot via the Contents API and links the raw URL in the issue body', async () => {
    let issueBody = '';
    const fetchMock = vi.fn(async (url: string, init: any) => {
      if (url.includes('/contents/')) {
        expect(init.method).toBe('PUT');
        const payload = JSON.parse(init.body);
        expect(payload.content).toBeTruthy();
        return new Response(
          JSON.stringify({ content: { html_url: 'https://github.com/whoseyci/Peerson/blob/main/bug-reports/x.png' } }),
          { status: 201 }
        );
      }
      if (url.includes('/issues')) {
        const body = JSON.parse(init.body);
        issueBody = body.body;
        return new Response(
          JSON.stringify({ html_url: 'https://github.com/whoseyci/Peerson/issues/43', number: 43 }),
          { status: 201 }
        );
      }
      throw new Error('Unexpected fetch call: ' + url);
    });
    global.fetch = fetchMock as any;

    const { onRequestPost } = await import('../functions/api/bug-report');
    const env = { GITHUB_PAT: 'fake-token' } as Env;
    const tinyPng =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const response = await runHandler(
      onRequestPost,
      makeRequest({ title: 'With screenshot', screenshot: tinyPng }),
      env
    );
    expect(response.status).toBe(200);
    expect(issueBody).toContain('raw.githubusercontent.com');
    expect(issueBody).not.toContain('data:image/png;base64');
  });

  it('returns 502 if GitHub rejects the issue creation', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 401 }));
    global.fetch = fetchMock as any;

    const { onRequestPost } = await import('../functions/api/bug-report');
    const env = { GITHUB_PAT: 'bad-token' } as Env;
    const response = await runHandler(onRequestPost, makeRequest({ title: 'Bug' }), env);
    expect(response.status).toBe(502);
  });
});
