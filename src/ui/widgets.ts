// Small, dependency-free UI widgets shared by the menus and the HUD.

const CHEV_L = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M8 1.5 3 6l5 4.5z"/></svg>';
const CHEV_R = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4 1.5 9 6l-5 4.5z"/></svg>';

export interface SpinOption<T> {
  value: T;
  label: string;
}

/** Arrow spinner (◀ value ▶) that replaces native <select>. Keyboard: ←/→ when focused. */
export function spinner<T>(options: SpinOption<T>[], value: T, onChange: (v: T) => void, cls = ''): HTMLElement & { setValue(v: T): void } {
  const el = document.createElement('div') as unknown as HTMLElement & { setValue(v: T): void };
  el.className = 'spin ' + cls;
  el.tabIndex = 0;
  el.setAttribute('role', 'spinbutton');
  el.innerHTML = `<button type="button" class="spin-b l" tabindex="-1" aria-label="Previous">${CHEV_L}</button><span class="spin-v"></span><button type="button" class="spin-b r" tabindex="-1" aria-label="Next">${CHEV_R}</button>`;
  const label = el.querySelector('.spin-v') as HTMLElement;
  let idx = Math.max(0, options.findIndex((o) => o.value === value));
  const render = () => {
    label.textContent = options[idx]?.label ?? '';
    el.setAttribute('aria-valuetext', label.textContent);
  };
  const step = (d: number) => {
    idx = (idx + d + options.length) % options.length;
    render();
    label.classList.remove('bump');
    void label.offsetWidth;
    label.classList.add('bump');
    onChange(options[idx].value);
  };
  el.querySelector('.l')!.addEventListener('click', (e) => {
    e.stopPropagation();
    step(-1);
  });
  el.querySelector('.r')!.addEventListener('click', (e) => {
    e.stopPropagation();
    step(1);
  });
  label.addEventListener('click', () => step(1));
  el.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowRight') step(1);
    else return;
    e.preventDefault();
    e.stopPropagation();
  });
  el.setValue = (v: T) => {
    const i = options.findIndex((o) => o.value === v);
    if (i >= 0) idx = i;
    render();
  };
  render();
  return el;
}

/** On/off switch. */
export function toggle(on: boolean, onChange: (v: boolean) => void, labels: [string, string] = ['OFF', 'ON']): HTMLElement & { setValue(v: boolean): void } {
  const el = document.createElement('button') as unknown as HTMLElement & { setValue(v: boolean): void };
  el.setAttribute('type', 'button');
  el.className = 'switch';
  el.setAttribute('role', 'switch');
  el.innerHTML = '<i></i><span></span>';
  const span = el.querySelector('span') as HTMLElement;
  const render = () => {
    el.classList.toggle('on', on);
    el.setAttribute('aria-checked', String(on));
    span.textContent = on ? labels[1] : labels[0];
  };
  el.addEventListener('click', () => {
    on = !on;
    render();
    onChange(on);
  });
  el.setValue = (v: boolean) => {
    on = v;
    render();
  };
  render();
  return el;
}

// ------------------------------------------------------------------ fullscreen
type FsDoc = Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => Promise<void> };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };

export function isFullscreen(): boolean {
  const d = document as FsDoc;
  return !!(d.fullscreenElement || d.webkitFullscreenElement);
}
export function fullscreenSupported(): boolean {
  const el = document.documentElement as FsEl;
  return !!(el.requestFullscreen || el.webkitRequestFullscreen);
}
export function toggleFullscreen() {
  const d = document as FsDoc;
  try {
    if (isFullscreen()) {
      if (d.exitFullscreen) void d.exitFullscreen().catch(() => undefined);
      else d.webkitExitFullscreen?.();
    } else {
      const el = document.documentElement as FsEl;
      if (el.requestFullscreen) void el.requestFullscreen({ navigationUI: 'hide' }).catch(() => undefined);
      else el.webkitRequestFullscreen?.();
    }
  } catch {
    /* ignore */
  }
}
/** Calls fn now and whenever fullscreen state changes; returns an unsubscribe function. */
export function onFullscreenChange(fn: (fs: boolean) => void): () => void {
  const h = () => fn(isFullscreen());
  document.addEventListener('fullscreenchange', h);
  document.addEventListener('webkitfullscreenchange', h);
  h();
  return () => {
    document.removeEventListener('fullscreenchange', h);
    document.removeEventListener('webkitfullscreenchange', h);
  };
}

export const ICONS = {
  fullscreen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9V3h6v2H5v4H3zm12-6h6v6h-2V5h-4V3zM5 15v4h4v2H3v-6h2zm14 0h2v6h-6v-2h4v-4z"/></svg>',
  exitFullscreen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h2v6H3V7h4V3zm8 0h2v4h4v2h-6V3zM3 15h6v6H7v-4H3v-2zm12 0h6v2h-4v4h-2v-6z"/></svg>',
  wrench: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.7 6.3a6 6 0 0 1-7.9 7.1L6.5 20.7a2.1 2.1 0 0 1-3-3l7.3-7.3a6 6 0 0 1 7.1-7.9L14.4 6l.6 3 3 .6 3.7-3.3z"/></svg>',
  dollar: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2v2.1c2.3.4 4 1.9 4.2 4.1h-2.6c-.2-1-1.1-1.8-2.9-1.8-1.9 0-2.8.8-2.8 1.8 0 .9.6 1.5 3 2.1 3 .7 5.6 1.8 5.6 4.9 0 2.3-1.8 3.9-4.5 4.3V22h-2.4v-2.5c-2.6-.4-4.5-2-4.7-4.5h2.6c.2 1.3 1.3 2.2 3.2 2.2 2 0 3.1-.9 3.1-2 0-1-.7-1.6-3.4-2.2-2.7-.6-5.2-1.8-5.2-4.8 0-2.2 1.7-3.7 4.4-4.1V2H13z"/></svg>',
  log: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v12H8l-4 4V4zm3 3v2h10V7H7zm0 4v2h7v-2H7z"/></svg>',
  target: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 2h2v3.1A7 7 0 0 1 18.9 11H22v2h-3.1A7 7 0 0 1 13 18.9V22h-2v-3.1A7 7 0 0 1 5.1 13H2v-2h3.1A7 7 0 0 1 11 5.1V2zm1 5a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4z"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6 10.6 12 5 6.4z"/></svg>',
  flag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 2h2v20H5zM8 3h11l-2.5 4L19 11H8z"/></svg>',
  lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10V7a5 5 0 0 1 10 0v3h2v12H5V10h2zm2 0h6V7a3 3 0 0 0-6 0v3z"/></svg>',
};

// ------------------------------------------------------------------ tooltips
let tipEl: HTMLElement | null = null;
let tipTarget: HTMLElement | null = null;
/** Installs a single fast tooltip for any element with a data-tip attribute. */
export function installTooltips() {
  if (tipEl) return;
  tipEl = document.createElement('div');
  tipEl.className = 'ui-tip';
  document.body.appendChild(tipEl);
  const hide = () => {
    tipTarget = null;
    tipEl!.classList.remove('show');
  };
  document.addEventListener('mouseover', (e) => {
    const t = (e.target as HTMLElement | null)?.closest?.('[data-tip]') as HTMLElement | null;
    if (t === tipTarget) return;
    if (!t) return hide();
    tipTarget = t;
    const text = t.dataset.tip ?? '';
    if (!text) return hide();
    tipEl!.innerHTML = text;
    tipEl!.classList.add('show');
    const r = t.getBoundingClientRect();
    const tw = tipEl!.offsetWidth, th = tipEl!.offsetHeight;
    const place = t.dataset.tipPos ?? 'top';
    let x = r.left + r.width / 2 - tw / 2;
    let y = place === 'bottom' ? r.bottom + 8 : place === 'left' ? r.top + r.height / 2 - th / 2 : r.top - th - 8;
    if (place === 'left') x = r.left - tw - 10;
    if (y < 4) y = r.bottom + 8;
    x = Math.max(6, Math.min(window.innerWidth - tw - 6, x));
    y = Math.max(6, Math.min(window.innerHeight - th - 6, y));
    tipEl!.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  });
  document.addEventListener('mousedown', hide, true);
  window.addEventListener('blur', hide);
}
export function hideTooltip() {
  tipTarget = null;
  tipEl?.classList.remove('show');
}

// ------------------------------------------------------------------ scroll fades
/** Adds top/bottom edge fades to a scroll container while there is more content in that direction. */
export function scrollFades(el: HTMLElement) {
  const upd = () => {
    const max = el.scrollHeight - el.clientHeight;
    el.classList.toggle('fade-top', el.scrollTop > 2);
    el.classList.toggle('fade-bot', el.scrollTop < max - 2);
  };
  el.addEventListener('scroll', upd, { passive: true });
  new ResizeObserver(upd).observe(el);
  requestAnimationFrame(upd);
  return upd;
}

// ------------------------------------------------------------------ misc
/** Resolves the UI font family so it can be used in canvas ctx.font strings. */
export function uiFont(): string {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--ui-font').trim();
    if (v) return v;
  } catch {
    /* ignore */
  }
  return "'Arial Narrow', sans-serif";
}

export function isMac(): boolean {
  return typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || navigator.userAgent);
}

export function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
export function lsSet(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* ignore */
  }
}

/** Trackpad mode default: on for Macs. Stored as 'riftfall.trackpad' = '1' | '0'. */
export function trackpadMode(): boolean {
  const v = lsGet('riftfall.trackpad');
  if (v === '1' || v === '0') return v === '1';
  return isMac();
}

export function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function hex(c: number) {
  return '#' + c.toString(16).padStart(6, '0');
}
