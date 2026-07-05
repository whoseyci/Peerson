import { App } from './app';
import { api } from './api/client';
import { openBarcodeScanner } from './scanner';

const app = new App();
(window as any).app = app;
(window as any).api = api;
(window as any).openBarcodeScanner = openBarcodeScanner;
app.init();
