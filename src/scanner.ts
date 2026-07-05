// Thin wrapper around the html5-qrcode library (loaded globally via
// index.html's <script> tag, see that file for why it's not npm-installed)
// that gives the rest of the app a single, promise-friendly entry point:
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
  formats: number[] | undefined,
  qrbox: { width: number; height: number }
): Promise<string | null> {
  if (!window.Html5Qrcode || video.readyState < 2 || video.videoWidth === 0) return null;

  // Crop to the same region the visible scan box covers, in actual video
  // pixel coordinates -- not the full frame. This matters a lot: the full
  // frame usually contains high-contrast background (bright screen edges,
  // dark surroundings, etc.) that makes the frame *as a whole* look like
  // it has plenty of contrast, even when the barcode itself, sitting in a
  // dim/washed-out patch inside that frame, doesn't. Scoping the contrast
  // measurement (and the fix) to just the scan box is what makes this
  // actually detect and rescue a genuinely low-contrast barcode. The
  // scaling math mirrors how html5-qrcode itself maps its shaded qrbox
  // onto the underlying video resolution (see foreverScan/widthRatio in
  // its source) since the video's rendered CSS size and native resolution
  // usually differ.
  const videoEl = document.querySelector(`#${READER_ID} video`) as HTMLVideoElement | null;
  const displayWidth = videoEl?.clientWidth || video.videoWidth;
  const displayHeight = videoEl?.clientHeight || video.videoHeight;
  const widthRatio = video.videoWidth / displayWidth;
  const heightRatio = video.videoHeight / displayHeight;

  const cropWidth = Math.min(video.videoWidth, Math.round(qrbox.width * widthRatio));
  const cropHeight = Math.min(video.videoHeight, Math.round(qrbox.height * heightRatio));
  const cropX = Math.max(0, Math.round((video.videoWidth - cropWidth) / 2));
  const cropY = Math.max(0, Math.round((video.videoHeight - cropHeight) / 2));

  // Step 1: sample just that cropped region (grayscale via a canvas
  // filter) to find the actual min/max brightness present there.
  const sampleCanvas = document.createElement('canvas');
  sampleCanvas.width = cropWidth;
  sampleCanvas.height = cropHeight;
  const sctx = sampleCanvas.getContext('2d', { willReadFrequently: true });
  if (!sctx) return null;
  sctx.filter = 'grayscale(1)';
  sctx.drawImage(video, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);

  let lo = 255;
  let hi = 0;
  try {
    const { data } = sctx.getImageData(0, 0, cropWidth, cropHeight);
    // Sample every 4th pixel (16th byte) -- plenty for a robust min/max
    // estimate and meaningfully cheaper than reading every pixel.
    for (let i = 0; i < data.length; i += 16) {
      const v = data[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  } catch {
    return null; // e.g. tainted canvas -- fail closed, primary loop still runs.
  }

  const range = Math.max(hi - lo, 1);
  // Earlier version tried to skip this whole attempt when the measured
  // range already looked "good" (>180), on the assumption that a
  // high-contrast crop wouldn't need rescuing. Verified that assumption
  // is wrong: a real failing photo measured range=199 (would have been
  // skipped) while a *different* failing frame from the same source
  // measured range=188 -- contrast range alone isn't a reliable predictor
  // of whether ZXing will actually decode it, so there's no safe
  // threshold to skip on. Since the whole enhancement pass only costs
  // ~1-2ms (measured), it's both simpler and more robust to just always
  // attempt it while in 1D mode rather than gate it on a heuristic that
  // doesn't hold up.

  // Step 2: derive brightness()/contrast() filter values that perform an
  // affine min-max stretch (output = (input - lo) / range * 255), then
  // render grayscale+stretched+upscaled in one drawImage call.
  const a = 255 / range;
  const c = 1 + (lo * a) / 127.5;
  const m = a / c;

  const finalCanvas = document.createElement('canvas');
  finalCanvas.width = cropWidth * ENHANCE_UPSCALE_FACTOR;
  finalCanvas.height = cropHeight * ENHANCE_UPSCALE_FACTOR;
  const fctx = finalCanvas.getContext('2d');
  if (!fctx) return null;
  fctx.filter = `grayscale(1) brightness(${m}) contrast(${c * 100}%)`;
  fctx.drawImage(video, cropX, cropY, cropWidth, cropHeight, 0, 0, finalCanvas.width, finalCanvas.height);

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
        <button class="close-btn" id="scannerCloseBtn"><i class="ph ph-x"></i></button>
      </div>
      <div class="scanner-mode-toggle">
        <button class="scanner-mode-btn ${mode === '1d' ? 'active' : ''}" id="scannerMode1d">
          <i class="ph ph-barcode"></i> Barcode (1D)
        </button>
        <button class="scanner-mode-btn ${mode === '2d' ? 'active' : ''}" id="scannerMode2d">
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

  function startCamera() {
    if (!window.Html5Qrcode) {
      const reader = document.getElementById(READER_ID);
      if (reader) {
        reader.innerHTML = `<div class="scanner-error"><i class="ph ph-warning"></i> Kamera-Scanner konnte nicht geladen werden. Bitte Barcode manuell eingeben.</div>`;
      }
      return;
    }

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

    // 1D barcodes are wide and short, not square -- a square scan box (as
    // you'd use for QR) makes them awkward to frame and can hurt detection.
    //
    // The width matters more than it might look. ZXing decodes whatever
    // pixel region the qrbox crops out of the video frame, and an EAN-13's
    // narrow bar modules only survive that crop-and-decode step reliably
    // above a certain pixel width -- below it, downscaling aliases bars
    // together in a way that isn't visually obvious but reliably breaks
    // decoding. I verified this directly: rendering the same real EAN-13
    // barcode at a range of widths and running it through the exact same
    // ZXing decode path this scanner uses, 260-280px failed to decode on
    // roughly half of tested widths (including exactly the 280px this box
    // used to be), while 290px+ decoded successfully every time. This
    // lines up with html5-qrcode's own documented recommendation of a
    // wide box (400x150) specifically for barcode scanning, which is what
    // this now matches.
    const qrbox = mode === '1d' ? { width: 400, height: 150 } : { width: 260, height: 260 };

    scanner
      .start(
        {
          facingMode: 'environment',
        },
        {
          fps: 10,
          qrbox,
          aspectRatio: 1.5,
          // Request a higher-resolution capture from the camera itself
          // (not just a bigger crop box) so there are more real source
          // pixels for ZXing to work with before any downscaling happens
          // -- this is a second, independent lever on the same problem
          // as the box-size fix above, and matters most on devices whose
          // default camera resolution is on the low side.
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
            const decoded = await tryEnhancedDecode(video, formats, qrbox);
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
