let seq = 0;

/** Inline SVG wordmark: bevelled steel letters split by a glowing Riftite crack. */
export function logoSvg(cls = 'logo-svg'): string {
  const id = 'lg' + seq++;
  const crack = 'M334 -4 L322 30 L338 50 L318 74 L331 96 L322 124';
  return `<svg class="${cls}" viewBox="0 0 640 132" role="img" aria-label="RIFTFALL">
  <defs>
    <linearGradient id="${id}f" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/><stop offset="0.44" stop-color="#dfe5ec"/>
      <stop offset="0.5" stop-color="#8b96a3"/><stop offset="0.56" stop-color="#b7c0ca"/><stop offset="1" stop-color="#eef2f6"/>
    </linearGradient>
    <linearGradient id="${id}e" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity="0.9"/><stop offset="0.5" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    <mask id="${id}m" maskUnits="userSpaceOnUse" x="0" y="0" width="640" height="132">
      <rect width="640" height="132" fill="#fff"/>
      <path d="${crack}" fill="none" stroke="#000" stroke-width="7" stroke-linejoin="miter"/>
    </mask>
    <filter id="${id}g" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="4"/></filter>
    <filter id="${id}s" x="-5%" y="-10%" width="110%" height="130%"><feDropShadow dx="0" dy="4" stdDeviation="2" flood-color="#000" flood-opacity="0.85"/></filter>
  </defs>
  <g filter="url(#${id}s)">
    <g mask="url(#${id}m)">
      <text x="6" y="112" text-anchor="start" textLength="628" lengthAdjust="spacingAndGlyphs" class="logo-text" fill="url(#${id}f)" stroke="#07090c" stroke-width="3" paint-order="stroke">RIFTFALL</text>
      <text x="6" y="112" text-anchor="start" textLength="628" lengthAdjust="spacingAndGlyphs" class="logo-text" fill="none" stroke="url(#${id}e)" stroke-width="1.2" transform="translate(0,-1.5)">RIFTFALL</text>
    </g>
  </g>
  <path d="${crack}" fill="none" stroke="#3fffc0" stroke-width="7" opacity="0.55" filter="url(#${id}g)" class="logo-crack-glow"/>
  <path d="${crack}" fill="none" stroke="#b8fff0" stroke-width="1.6"/>
</svg>`;
}

export function emblemSvg(f: 'aegis' | 'covenant', size = 54, color?: string): string {
  const c = color ?? (f === 'aegis' ? '#e8b64c' : '#ff4a3d');
  return f === 'aegis'
    ? `<svg width="${size}" height="${size}" viewBox="0 0 54 54" aria-hidden="true"><path d="M27 3 L48 11 V27 C48 40 38 48 27 52 C16 48 6 40 6 27 V11 Z" fill="none" stroke="${c}" stroke-width="3"/><path d="M27 12 L38 17 V27 C38 34 33 39 27 42 C21 39 16 34 16 27 V17 Z" fill="${c}"/></svg>`
    : `<svg width="${size}" height="${size}" viewBox="0 0 54 54" aria-hidden="true"><path d="M27 3 L50 45 H4 Z" fill="none" stroke="${c}" stroke-width="3" stroke-linejoin="round"/><circle cx="27" cy="32" r="8" fill="${c}"/><path d="M27 12 L27 24" stroke="${c}" stroke-width="3"/></svg>`;
}
