import type { PagesFunction } from '@cloudflare/workers-types';
import type { Env as BaseEnv } from '../_middleware';
import { jsonError } from '../http';

// Extends the shared Env with the secret + repo config needed to talk to
// GitHub on the server. GITHUB_PAT must be set as an encrypted environment
// variable in the Cloudflare Pages project settings (Settings -> Environment
// variables -> Production/Preview -> "GITHUB_PAT", type "Secret"). It should
// be a fine-grained PAT scoped only to this repo with "Issues: write" and
// "Contents: write" permissions (Contents is only needed if you want
// screenshots committed into the repo — see below).
export interface Env extends BaseEnv {
  GITHUB_PAT?: string;
  GITHUB_REPO?: string; // "owner/repo", defaults to whoseyci/Peerson below
}

const DEFAULT_REPO = 'whoseyci/Peerson';
const GITHUB_API = 'https://api.github.com';

function githubHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'peerson-bug-reporter',
    'Content-Type': 'application/json',
  };
}

// GitHub strips <img src="data:..."> from issue bodies for security reasons,
// so a base64 screenshot embedded directly in the markdown body would never
// actually render. Instead we commit the PNG into a dedicated branch-less
// orphan-ish folder in the repo via the Contents API and link to the raw
// file, which GitHub *will* render inline.
async function uploadScreenshot(
  token: string,
  repo: string,
  dataUrl: string,
  issueSlug: string
): Promise<string | null> {
  const match = /^data:image\/png;base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  const base64 = match[1];

  // Guardrail: refuse absurdly large screenshots rather than silently
  // failing against GitHub's ~100MB per-file / request-size limits.
  const approxBytes = (base64.length * 3) / 4;
  if (approxBytes > 8 * 1024 * 1024) return null;

  const path = `bug-reports/${issueSlug}.png`;
  const res = await fetch(`${GITHUB_API}/repos/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: githubHeaders(token),
    body: JSON.stringify({
      message: `Bug report screenshot: ${issueSlug}`,
      content: base64,
      branch: 'main',
    }),
  });

  if (!res.ok) {
    console.error('Screenshot upload failed', res.status, await res.text());
    return null;
  }

  const data = await res.json<{ content: { html_url: string } }>();
  // Use the "raw" githubusercontent URL so it renders as an image, not a
  // link to the GitHub file-viewer page.
  return `https://raw.githubusercontent.com/${repo}/main/${path}`;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const token = env.GITHUB_PAT;
  if (!token) {
    return new Response(
      JSON.stringify({ error: 'Bug reporting is not configured on the server (missing GITHUB_PAT).' }),
      { status: 501 }
    );
  }

  const repo = env.GITHUB_REPO || DEFAULT_REPO;
  const userId = request.headers.get('X-User-Id') || 'unknown';

  let body: {
    title?: string;
    description?: string;
    context?: Record<string, string>;
    lastActions?: string;
    screenshot?: string; // data:image/png;base64,...
  };
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'Invalid JSON body');
  }

  const title = (body.title || '').trim();
  if (!title) {
    return jsonError(400, 'Title required');
  }

  const issueSlug = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let screenshotUrl: string | null = null;
  if (body.screenshot) {
    try {
      screenshotUrl = await uploadScreenshot(token, repo, body.screenshot, issueSlug);
    } catch (e) {
      console.error('Screenshot upload threw', e);
    }
  }

  const contextRows = Object.entries(body.context || {})
    .map(([k, v]) => `| ${k} | \`${v}\` |`)
    .join('\n');

  const issueBody = `## Beschreibung
${body.description?.trim() || '_(keine Beschreibung)_'}

## Kontext
| Feld | Wert |
|------|------|
${contextRows}

## Letzte Aktionen
\`\`\`
${body.lastActions || 'Keine Aktionen aufgezeichnet'}
\`\`\`
${screenshotUrl ? `\n## Screenshot\n![Screenshot](${screenshotUrl})\n` : body.screenshot ? '\n_(Screenshot konnte nicht hochgeladen werden)_\n' : ''}
---
*Automatisch erstellt über die Peerson-App (User-ID: \`${userId}\`)*`;

  const issueRes = await fetch(`${GITHUB_API}/repos/${repo}/issues`, {
    method: 'POST',
    headers: githubHeaders(token),
    body: JSON.stringify({
      title,
      body: issueBody,
      labels: ['bug', 'from-app'],
    }),
  });

  if (!issueRes.ok) {
    const errText = await issueRes.text();
    console.error('GitHub issue creation failed', issueRes.status, errText);
    return new Response(
      JSON.stringify({ error: 'Konnte Issue nicht erstellen. Bitte später erneut versuchen.' }),
      { status: 502 }
    );
  }

  const issue = await issueRes.json<{ html_url: string; number: number }>();
  return Response.json({ url: issue.html_url, number: issue.number });
};
