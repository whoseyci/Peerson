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

  let resolveResult: (value: string | null) => void;
  const result = new Promise<string | null>((resolve) => {
    resolveResult = resolve;
  });

  async function cleanup(value: string | null) {
    if (settled) return;
    settled = true;
    if (scanner) {
      try {
        await scanner.stop();
        scanner.clear();
      } catch {
        // Scanner may already be stopped (e.g. camera permission was never
        // granted) -- safe to ignore.
      }
    }
    modal.classList.remove('active');
    modal.innerHTML = '';
    resolveResult(value);
  }

  modal.innerHTML = `
    <div class="scanner-header">
      <div class="scanner-title"><i class="ph ph-barcode"></i> Barcode scannen</div>
      <button class="close-btn" id="scannerCloseBtn"><i class="ph ph-x"></i></button>
    </div>
    <div id="${READER_ID}" class="scanner-reader"></div>
    <div class="scanner-hint">Halte den Barcode ruhig vor die Kamera</div>
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

  if (!window.Html5Qrcode) {
    const reader = document.getElementById(READER_ID);
    if (reader) {
      reader.innerHTML = `<div class="scanner-error"><i class="ph ph-warning"></i> Kamera-Scanner konnte nicht geladen werden. Bitte Barcode manuell eingeben.</div>`;
    }
    return { result, close: () => cleanup(null) };
  }

  scanner = new window.Html5Qrcode(READER_ID, {
    formatsToSupport: window.Html5QrcodeSupportedFormats
      ? [
          window.Html5QrcodeSupportedFormats.EAN_13,
          window.Html5QrcodeSupportedFormats.EAN_8,
          window.Html5QrcodeSupportedFormats.UPC_A,
          window.Html5QrcodeSupportedFormats.UPC_E,
          window.Html5QrcodeSupportedFormats.CODE_128,
        ]
      : undefined,
  });

  scanner
    .start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 260, height: 160 }, aspectRatio: 1.5 },
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

  return { result, close: () => cleanup(null) };
}
