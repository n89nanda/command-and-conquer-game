import './ui/style.css';
import { App } from './ui/App';

const root = document.getElementById('app')!;
const app = new App(root);
(window as unknown as { app: App }).app = app;
app.boot().catch((e) => {
  console.error(e);
  root.innerHTML = `<div style="padding:40px;color:#f88;font-family:sans-serif">Failed to start: ${String(e)}</div>`;
});
