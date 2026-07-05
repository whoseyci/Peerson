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

  let resolveResult: (value: string | null) => void;
  const result = new Promise<string | null>((resolve) => {
    resolveResult = resolve;
  });

  async function stopScanner() {
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
    const qrbox = mode === '1d' ? { width: 280, height: 120 } : { width: 240, height: 240 };

    scanner
      .start(
        { facingMode: 'environment' },
        { fps: 10, qrbox, aspectRatio: 1.5 },
        (decodedText: string) => cleanup(decodedText),
        () => {
          /* per-frame "nothing found" callback -- expected constantly, ignore */
        }
      )
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
