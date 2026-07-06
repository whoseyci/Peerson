const loadingScripts = new Map<string, Promise<void>>();

/**
 * Loads a browser script once and shares the in-flight promise across callers.
 * Failed attempts remove their script tag and cache entry so a later retry can
 * create a fresh request instead of waiting on an already-fired error event.
 */
export function loadExternalScript(src: string): Promise<void> {
  const loaded = document.querySelector<HTMLScriptElement>(`script[src="${src}"][data-loaded="true"]`);
  if (loaded) return Promise.resolve();

  const inFlight = loadingScripts.get(src);
  if (inFlight) return inFlight;

  const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
  if (existing && existing.dataset.loaded !== 'true') {
    existing.remove();
  }

  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.dataset.loading = 'true';

    script.addEventListener('load', () => {
      script.dataset.loaded = 'true';
      script.dataset.loading = 'false';
      loadingScripts.delete(src);
      resolve();
    }, { once: true });

    script.addEventListener('error', () => {
      script.dataset.loading = 'false';
      loadingScripts.delete(src);
      script.remove();
      reject(new Error(`Failed to load ${src}`));
    }, { once: true });

    document.head.appendChild(script);
  });

  loadingScripts.set(src, promise);
  return promise;
}
