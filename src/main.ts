import { App } from './app';
import { api } from './api/client';

const app = new App();
(window as any).app = app;
(window as any).api = api;
app.init();
