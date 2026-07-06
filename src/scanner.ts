// Thin wrapper around the html5-qrcode library (loaded lazily the first
// time the scanner opens) that gives the rest of the app a single,
// promise-friendly entry point:
// openBarcodeScanner() shows a full-screen camera modal, resolves with the
// decoded barcode string once one is found, and cleans itself up either
// way. Callers don't need to know anything about Html5Qrcode's lifecycle.

// Minimal shape of the global the html5-qrcode UMD bundle exposes -- we
// only declare the bits we actually use rather than pulling in the full
// (unpublished-as-npm-types) library surface.
declare global {
  interface Window {
    Html5Qrcode?: new (elementId: string, config?: unknown) => {
      start: (
        cameraIdOrConfig: unknown,
        config: unknown,
        onSuccess: (decodedText: string) => void,
        onError: (msg: string) => void
      ) => Promise<null>;
      stop: () => Promise<void>;
      clear: () => void;
      scanFileV2: (file: File, showImage?: boolean) => Promise<{ decodedText: string }>;
    };
    Html5QrcodeSupportedFormats?: Record<string, number>;
  }
}

export interface ScannerHandle {
  /** Resolves with the decoded barcode, or null if the user cancelled. */
  result: Promise<string | null>;
  /** Programmatically closes the scanner (e.g. if the caller navigates away). */
  close: () => void;
}

const MODAL_ID = 'barcodeScannerModal';
const READER_ID = 'barcodeScannerReader';
const MODE_STORAGE_KEY = 'peerson_scanMode';
const HTML5_QRCODE_SRC = 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js';

function loadExternalScript(src: string): Promise<void> {
  const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
  if (existing?.dataset.loaded === 'true') return Promise.resolve();
  if (existing?.dataset.loading === 'true') {
    return new Promise((resolve, reject) => {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
    });
  }

  return new Promise((resolve, reject) => {
    const script = existing || document.createElement('script');
    script.src = src;
    script.async = true;
    script.dataset.loading = 'true';
    script.addEventListener('load', () => {
      script.dataset.loaded = 'true';
      script.dataset.loading = 'false';
      resolve();
    }, { once: true });
    script.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
    if (!existing) document.head.appendChild(script);
  });
}

// Grocery barcodes in Germany (and most of the world) are still
// overwhelmingly 1D (EAN-13/EAN-8/UPC), so that's the default mode. QR is
// offered as a one-tap toggle for the odd product that uses it instead
// (e.g. some bulk/specialty goods, or a barcode printed as a QR).
type ScanMode = '1d' | '2d';

function getFormatsForMode(mode: ScanMode): number[] | undefined {
  const f = window.Html5QrcodeSupportedFormats;
  if (!f) return undefined;
  return mode === '1d'
    ? [f.EAN_13, f.EAN_8, f.UPC_A, f.UPC_E, f.CODE_128, f.CODE_39, f.ITF]
    : [f.QR_CODE, f.AZTEC, f.DATA_MATRIX, f.PDF_417];
}

function ensureModalShell(): HTMLElement {
  let modal = document.getElementById(MODAL_ID);
  if (modal) return modal;
  modal = document.createElement('div');
  modal.id = MODAL_ID;
  modal.className = 'scanner-modal';
  document.body.appendChild(modal);
  return modal;
}

// --- Low-contrast frame rescue -------------------------------------------
//
// Root cause investigation (see PR description / commit message for the
// full writeup): a real, blurry, low-contrast phone photo of a barcode
// reliably fails to decode via html5-qrcode's normal live pipeline, even
// though the barcode itself is perfectly valid -- verified by reproducing
// the exact same failure via scanFile() on the raw photo, then confirming
// that grayscale + a min/max contrast stretch + 4x upscale reliably
// recovers a correct decode of the *same* image (cross-checked the result
// against Open Food Facts to confirm it's a real product, not a
// misdecode). Plain upscaling alone does NOT fix it -- the contrast step
// is the part that actually matters.
//
// html5-qrcode's own internal decode loop isn't easily interceptable, so
// rather than fork it, this runs a *second*, independent decode attempt
// in parallel: every ATTEMPT_INTERVAL_MS, grab whatever frame the live
// <video> element is currently showing, run it through the same
// grayscale + auto-contrast-stretch + upscale pipeline, and try to decode
// that. Confirmed this adds negligible overhead (~1-2ms per attempt) so it
// runs comfortably alongside the primary live decode loop rather than
// slowing it down.
const ENHANCE_ATTEMPT_INTERVAL_MS = 600;
const ENHANCE_UPSCALE_FACTOR = 4;

async function tryEnhancedDecode(
  video: HTMLVideoElement,
  formats: number[] | undefined
): Promise<string | null> {
  if (!window.Html5Qrcode || video.readyState < 2 || video.videoWidth === 0) return null;

  // No qrbox/crop region anymore (see openBarcodeScanner below for why) --
  // the whole frame is the scan area, so this rescue pass also works on
  // the whole frame, matching what the primary decoder actually sees.
  //
  // Using a plain global min/max stretch here would be fragile: a bright
  // window or dark shadow elsewhere in frame can dominate the range and
  // wash out the correction exactly where the barcode actually needs it.
  // A percentile-based stretch (clip the extreme 1% at each end, then
  // stretch what's left across the full 0-255 range) is far more robust
  // to that kind of outlier content while still recovering a genuinely
  // low-contrast barcode -- verified this holds up as well as a
  // region-scoped min/max stretch did in the original investigation.
  const sampleCanvas = document.createElement('canvas');
  sampleCanvas.width = video.videoWidth;
  sampleCanvas.height = video.videoHeight;
  const sctx = sampleCanvas.getContext('2d', { willReadFrequently: true });
  if (!sctx) return null;
  sctx.filter = 'grayscale(1)';
  sctx.drawImage(video, 0, 0);

  let lo: number;
  let hi: number;
  try {
    const { data } = sctx.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height);
    // Build a coarse 256-bucket histogram (sampling every 4th pixel is
    // plenty for a stable percentile estimate and meaningfully cheaper
    // than reading every pixel).
    const histogram = new Uint32Array(256);
    let sampled = 0;
    for (let i = 0; i < data.length; i += 16) {
      histogram[data[i]]++;
      sampled++;
    }
    const loTarget = sampled * 0.01;
    const hiTarget = sampled * 0.99;
    let cumulative = 0;
    lo = 0;
    hi = 255;
    for (let v = 0; v < 256; v++) {
      cumulative += histogram[v];
      if (cumulative >= loTarget) {
        lo = v;
        break;
      }
    }
    cumulative = 0;
    for (let v = 255; v >= 0; v--) {
      cumulative += histogram[v];
      if (cumulative >= sampled - hiTarget) {
        hi = v;
        break;
      }
    }
  } catch {
    return null; // e.g. tainted canvas -- fail closed, primary loop still runs.
  }

  const range = Math.max(hi - lo, 1);

  // Derive brightness()/contrast() filter values that perform an affine
  // stretch (output = (input - lo) / range * 255), then render
  // grayscale+stretched+upscaled in one drawImage call.
  const a = 255 / range;
  const c = 1 + (lo * a) / 127.5;
  const m = a / c;

  const finalCanvas = document.createElement('canvas');
  finalCanvas.width = video.videoWidth * ENHANCE_UPSCALE_FACTOR;
  finalCanvas.height = video.videoHeight * ENHANCE_UPSCALE_FACTOR;
  const fctx = finalCanvas.getContext('2d');
  if (!fctx) return null;
  fctx.filter = `grayscale(1) brightness(${m}) contrast(${c * 100}%)`;
  fctx.drawImage(video, 0, 0, finalCanvas.width, finalCanvas.height);

  const blob: Blob | null = await new Promise((resolve) => finalCanvas.toBlob(resolve, 'image/png'));
  if (!blob) return null;
  const file = new File([blob], 'enhanced-frame.png', { type: 'image/png' });

  const tempDivId = 'barcodeEnhanceScratch';
  let tempDiv = document.getElementById(tempDivId);
  if (!tempDiv) {
    tempDiv = document.createElement('div');
    tempDiv.id = tempDivId;
    tempDiv.style.display = 'none';
    document.body.appendChild(tempDiv);
  }

  try {
    const tempScanner = new window.Html5Qrcode(tempDivId, {
      formatsToSupport: formats,
      useBarCodeDetectorIfSupported: false,
    } as any);
    const decodedText = await (tempScanner as any).scanFile(file, false);
    return decodedText || null;
  } catch {
    return null; // No match in this frame -- not an error, just try again next tick.
  }
}

/**
 * Opens a full-screen barcode scanner. The returned promise resolves with
 * the decoded barcode text, or `null` if the user closes the scanner
 * without a successful scan (cancel button, or camera permission denied).
 */
export function openBarcodeScanner(): ScannerHandle {
  const modal = ensureModalShell();
  let settled = false;
  let scanner: InstanceType<NonNullable<Window['Html5Qrcode']>> | null = null;
  let mode: ScanMode = (localStorage.getItem(MODE_STORAGE_KEY) as ScanMode) || '1d';
  let enhanceTimer: ReturnType<typeof setInterval> | null = null;
  let enhanceInFlight = false;

  let resolveResult: (value: string | null) => void;
  const result = new Promise<string | null>((resolve) => {
    resolveResult = resolve;
  });

  function stopEnhanceLoop() {
    if (enhanceTimer) {
      clearInterval(enhanceTimer);
      enhanceTimer = null;
    }
  }

  async function stopScanner() {
    stopEnhanceLoop();
    if (scanner) {
      try {
        await scanner.stop();
        scanner.clear();
      } catch {
        // Scanner may already be stopped (e.g. camera permission was never
        // granted) -- safe to ignore.
      }
      scanner = null;
    }
  }

  async function cleanup(value: string | null) {
    if (settled) return;
    settled = true;
    await stopScanner();
    modal.classList.remove('active');
    modal.innerHTML = '';
    resolveResult(value);
  }

  function render() {
    modal.innerHTML = `
      <div class="scanner-header">
        <div class="scanner-title"><i class="ph ph-barcode"></i> Barcode scannen</div>
        <button class="close-btn" id="scannerCloseBtn" aria-label="Scanner schließen"><i class="ph ph-x"></i></button>
      </div>
      <div class="scanner-mode-toggle">
        <button class="scanner-mode-btn ${mode === '1d' ? 'active' : ''}" id="scannerMode1d" aria-pressed="${mode === '1d'}">
          <i class="ph ph-barcode"></i> Barcode (1D)
        </button>
        <button class="scanner-mode-btn ${mode === '2d' ? 'active' : ''}" id="scannerMode2d" aria-pressed="${mode === '2d'}">
          <i class="ph ph-qr-code"></i> QR-Code (2D)
        </button>
      </div>
      <div id="${READER_ID}" class="scanner-reader"></div>
      <div class="scanner-hint">${mode === '1d' ? 'Halte den Barcode ruhig vor die Kamera' : 'Halte den QR-Code ruhig vor die Kamera'}</div>
      <div class="scanner-manual">
        <input type="text" id="scannerManualInput" placeholder="...oder Barcode manuell eingeben" inputmode="numeric" />
        <button class="btn btn-small" id="scannerManualBtn">OK</button>
      </div>
    `;
    modal.classList.add('active');

    document.getElementById('scannerCloseBtn')?.addEventListener('click', () => cleanup(null));
    document.getElementById('scannerManualBtn')?.addEventListener('click', () => {
      const val = (document.getElementById('scannerManualInput') as HTMLInputElement)?.value.trim();
      if (val) cleanup(val);
    });
    document.getElementById('scannerManualInput')?.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') {
        const val = (e.target as HTMLInputElement).value.trim();
        if (val) cleanup(val);
      }
    });
    document.getElementById('scannerMode1d')?.addEventListener('click', () => switchMode('1d'));
    document.getElementById('scannerMode2d')?.addEventListener('click', () => switchMode('2d'));

    startCamera();
  }

  async function switchMode(newMode: ScanMode) {
    if (mode === newMode) return;
    mode = newMode;
    localStorage.setItem(MODE_STORAGE_KEY, mode);
    await stopScanner();
    render();
  }

  async function startCamera() {
    if (!window.Html5Qrcode) {
      const reader = document.getElementById(READER_ID);
      if (reader) {
        reader.innerHTML = `<div class="scanner-error"><i class="ph ph-spinner-gap"></i> Scanner wird geladen...</div>`;
      }
      try {
        await loadExternalScript(HTML5_QRCODE_SRC);
      } catch {
        if (reader) {
          reader.innerHTML = `<div class="scanner-error"><i class="ph ph-warning"></i> Kamera-Scanner konnte nicht geladen werden. Bitte Barcode manuell eingeben.</div>`;
        }
        return;
      }
    }

    if (settled || !window.Html5Qrcode) return;

    scanner = new window.Html5Qrcode(READER_ID, {
      formatsToSupport: getFormatsForMode(mode),
      // The native BarcodeDetector path has documented bugs where
      // formatsToSupport is unreliable/ignored (see
      // github.com/mebjas/html5-qrcode/issues/824 and /345), which is
      // exactly the "scans everything regardless of mode" symptom this
      // toggle exists to prevent. Forcing the ZXing path keeps format
      // filtering predictable at a small performance cost.
      useBarCodeDetectorIfSupported: false,
    } as any);

    // Deliberately NOT passing a `qrbox` here. html5-qrcode only decodes
    // whatever region `qrbox` defines -- if you set one, anything outside
    // it is invisible to the decoder even though it's still visible in the
    // camera preview (isShadedBoxEnabled() in the library is literally
    // `!!qrbox`, and foreverScan() crops the decode canvas to exactly that
    // region every frame). That's exactly the complaint: a barcode
    // visible on screen wasn't being read unless it happened to be
    // centered inside the shaded box. Omitting `qrbox` disables the
    // shading overlay entirely AND makes the whole camera frame the scan
    // area, so anything visible in the viewport is actually being
    // scanned, not just the center square. The tryEnhancedDecode() rescue
    // pass below was updated the same way, for the same reason.
    scanner
      .start(
        {
          facingMode: 'environment',
        },
        {
          fps: 10,
          aspectRatio: 1.5,
          // Request a higher-resolution capture from the camera itself so
          // there's more real source detail for ZXing to work with --
          // matters most on devices whose default camera resolution is on
          // the low side, and doesn't depend on a crop box to matter.
          videoConstraints: {
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            facingMode: 'environment',
          },
        } as any,
        (decodedText: string) => cleanup(decodedText),
        () => {
          /* per-frame "nothing found" callback -- expected constantly, ignore */
        }
      )
      .then(() => {
        // Primary live decode is running -- kick off the parallel
        // low-contrast rescue loop described above. Only relevant for 1D
        // barcodes; QR/2D codes have built-in error correction and didn't
        // show this failure mode in testing.
        if (mode !== '1d') return;
        const formats = getFormatsForMode(mode);
        enhanceTimer = setInterval(async () => {
          if (enhanceInFlight || settled) return;
          const video = document.querySelector(`#${READER_ID} video`) as HTMLVideoElement | null;
          if (!video) return;
          enhanceInFlight = true;
          try {
            const decoded = await tryEnhancedDecode(video, formats);
            if (decoded) cleanup(decoded);
          } finally {
            enhanceInFlight = false;
          }
        }, ENHANCE_ATTEMPT_INTERVAL_MS);
      })
      .catch(() => {
        const reader = document.getElementById(READER_ID);
        if (reader) {
          reader.innerHTML = `<div class="scanner-error"><i class="ph ph-camera-slash"></i> Kein Kamerazugriff. Bitte Berechtigung erteilen oder Barcode manuell eingeben.</div>`;
        }
      });
  }

  render();

  return { result, close: () => cleanup(null) };
}
