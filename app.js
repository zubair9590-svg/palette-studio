/**
 * Palette Studio — generate beautiful, accessible color palettes.
 * Vanilla JavaScript, no dependencies.
 */

const SIZE = 5;
const LIBRARY_KEY = 'palette-studio:library';
const MAX_UNDO = 50;
const WHITE = [255, 255, 255];
const INK = [17, 19, 24];

const ICONS = {
  locked: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  unlocked: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.75-1.4"/></svg>',
  copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>',
  edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
};

/* ---------- Color math ---------- */

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const random = (min, max) => min + Math.random() * (max - min);
const wrapHue = (hue) => ((hue % 360) + 360) % 360;

function hslToRgb(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const channel = (n) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [channel(0), channel(8), channel(4)].map((v) => Math.round(v * 255));
}

function rgbToHsl([r, g, b]) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

const rgbToHex = (rgb) => `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase();

function hexToRgb(hex) {
  const value = parseInt(hex.replace('#', ''), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function relativeLuminance(rgb) {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a, b) {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

function wcagRating(ratio) {
  if (ratio >= 7) return 'AAA';
  if (ratio >= 4.5) return 'AA';
  if (ratio >= 3) return 'AA Large';
  return 'Low';
}

/* ---------- Palette generation ---------- */

// Hue offset (in degrees) for a swatch `step` positions away from the anchor color.
const HARMONIES = {
  analogous: (step) => step * 18,
  monochromatic: () => 0,
  complementary: (step) => (Math.abs(step) >= 2 ? 180 : 0) + step * 5,
  triadic: (step) => [0, 120, 240][((step % 3) + 3) % 3],
  split: (step) => [0, 150, 210][((step % 3) + 3) % 3],
};
const HARMONY_NAMES = Object.keys(HARMONIES);

function generatePalette(colors, mode) {
  const harmony = mode === 'auto' ? HARMONY_NAMES[Math.floor(Math.random() * HARMONY_NAMES.length)] : mode;

  // Locked colors stay put, and the first one becomes the anchor the others harmonize with.
  const lockedIndex = colors.findIndex((c) => c.locked);
  const anchor = lockedIndex >= 0 ? lockedIndex : Math.floor(Math.random() * SIZE);
  const [baseHue, baseSat] = lockedIndex >= 0
    ? rgbToHsl(hexToRgb(colors[lockedIndex].hex))
    : [random(0, 360), random(0.45, 0.85)];

  const spread = harmony === 'monochromatic' ? 0.06 : 0.14;
  const dark = random(0.16, 0.3);
  const light = random(0.74, 0.9);
  const reversed = Math.random() < 0.5;

  return colors.map((color, i) => {
    if (color.locked) return color;
    const t = i / (SIZE - 1);
    const hue = wrapHue(baseHue + HARMONIES[harmony](i - anchor) + random(-6, 6));
    const sat = clamp(baseSat + random(-spread, spread), 0.18, 0.92);
    const lightness = clamp(dark + (light - dark) * (reversed ? 1 - t : t) + random(-0.04, 0.04), 0.08, 0.95);
    return { hex: rgbToHex(hslToRgb(hue, sat, lightness)), locked: false };
  });
}

/* ---------- State & elements ---------- */

const state = {
  colors: Array.from({ length: SIZE }, () => ({ hex: '#000000', locked: false })),
  undo: [],
  mode: 'auto',
  exportFormat: 'css',
};

const $ = (selector) => document.querySelector(selector);
const paletteEl = $('#palette');
const undoBtn = $('#undo-btn');
const toastEl = $('#toast');
const exportDialog = $('#export-dialog');
const exportCode = $('#export-code');
const libraryDialog = $('#library-dialog');
const libraryList = $('#library-list');
const libraryEmpty = $('#library-empty');
const libraryCount = $('#library-count');

const swatches = Array.from({ length: SIZE }, (_, i) => createSwatch(i));
paletteEl.append(...swatches);

/* ---------- Rendering ---------- */

function createSwatch(index) {
  const el = document.createElement('section');
  el.className = 'swatch';
  el.innerHTML = `
    <div class="swatch-actions">
      <button class="icon-btn lock-btn" type="button"></button>
      <button class="icon-btn copy-btn" type="button" title="Copy HEX">${ICONS.copy}</button>
      <label class="icon-btn edit-btn" title="Adjust color">
        ${ICONS.edit}
        <input type="color" aria-label="Adjust color ${index + 1}" />
      </label>
    </div>
    <div class="swatch-info">
      <button class="hex" type="button" title="Copy HEX"></button>
      <span class="meta"></span>
      <span class="badge"></span>
    </div>`;

  el.querySelector('.lock-btn').addEventListener('click', () => toggleLock(index));
  el.querySelector('.copy-btn').addEventListener('click', () => copy(state.colors[index].hex));
  el.querySelector('.hex').addEventListener('click', () => copy(state.colors[index].hex));

  // Record one undo step per picker session, not one per `input` event.
  const picker = el.querySelector('input[type="color"]');
  let editing = false;
  picker.addEventListener('input', () => {
    if (!editing) {
      pushUndo();
      editing = true;
    }
    state.colors[index] = { ...state.colors[index], hex: picker.value.toUpperCase() };
    render();
  });
  picker.addEventListener('change', () => {
    editing = false;
  });

  return el;
}

function paint(el, color, index) {
  const rgb = hexToRgb(color.hex);
  const onWhite = contrastRatio(rgb, WHITE);
  const onInk = contrastRatio(rgb, INK);
  const useWhite = onWhite >= onInk;
  const ratio = Math.max(onWhite, onInk);
  const [h, s, l] = rgbToHsl(rgb);
  const action = color.locked ? 'Unlock' : 'Lock';

  el.style.setProperty('--c', color.hex);
  el.style.setProperty('--fg', useWhite ? '#FFFFFF' : '#111318');
  el.classList.toggle('is-locked', color.locked);

  const lockBtn = el.querySelector('.lock-btn');
  lockBtn.innerHTML = color.locked ? ICONS.locked : ICONS.unlocked;
  lockBtn.setAttribute('aria-pressed', String(color.locked));
  lockBtn.setAttribute('aria-label', `${action} color ${index + 1}`);
  lockBtn.title = `${action} (${index + 1})`;

  el.querySelector('.copy-btn').setAttribute('aria-label', `Copy ${color.hex}`);
  el.querySelector('.hex').textContent = color.hex.slice(1);
  el.querySelector('.meta').textContent = `hsl(${Math.round(h)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;

  const badge = el.querySelector('.badge');
  badge.textContent = `${wcagRating(ratio)} · ${ratio.toFixed(1)}:1`;
  badge.title = `WCAG contrast of ${useWhite ? 'white' : 'dark'} text on this color`;

  el.querySelector('input[type="color"]').value = color.hex.toLowerCase();
}

function render() {
  state.colors.forEach((color, i) => paint(swatches[i], color, i));
  undoBtn.disabled = state.undo.length === 0;

  // Keep the URL shareable: #/264653-2A9D8F-E9C46A-F4A261-E76F51
  const hash = `#/${state.colors.map((c) => c.hex.slice(1)).join('-')}`;
  if (location.hash !== hash) window.history.replaceState(null, '', hash);
}

/* ---------- Actions ---------- */

function pushUndo() {
  state.undo.push(state.colors.map((c) => ({ ...c })));
  if (state.undo.length > MAX_UNDO) state.undo.shift();
}

function generate() {
  if (state.colors.every((c) => c.locked)) {
    toast('Unlock a color to generate new ones');
    return;
  }
  pushUndo();
  state.colors = generatePalette(state.colors, state.mode);
  render();
}

function undo() {
  const previous = state.undo.pop();
  if (!previous) return;
  state.colors = previous;
  render();
}

function toggleLock(index) {
  const color = state.colors[index];
  state.colors[index] = { ...color, locked: !color.locked };
  render();
}

async function copy(text, message = `Copied ${text}`) {
  try {
    await navigator.clipboard.writeText(text);
    toast(message);
  } catch {
    toast('Clipboard unavailable, copy it manually');
  }
}

let toastTimer;
function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1800);
}

function readHash() {
  const codes = location.hash.replace(/^#\/?/, '').split('-');
  if (codes.length !== SIZE || !codes.every((code) => /^[0-9a-f]{6}$/i.test(code))) return null;
  return codes.map((code) => ({ hex: `#${code.toUpperCase()}`, locked: false }));
}

/* ---------- Library (localStorage) ---------- */

function readLibrary() {
  try {
    const items = JSON.parse(localStorage.getItem(LIBRARY_KEY));
    return Array.isArray(items) ? items.filter((item) => Array.isArray(item?.colors) && item.colors.length === SIZE) : [];
  } catch {
    return [];
  }
}

function writeLibrary(items) {
  try {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(items));
  } catch {
    toast('Could not save, storage is unavailable');
  }
  libraryCount.textContent = String(items.length);
}

function savePalette() {
  const colors = state.colors.map((c) => c.hex);
  const items = readLibrary();
  if (items.some((item) => item.colors.join() === colors.join())) {
    toast('Already in your library');
    return;
  }
  writeLibrary([{ colors, savedAt: Date.now() }, ...items].slice(0, 100));
  toast('Saved to your library');
}

function renderLibrary() {
  const items = readLibrary();
  libraryEmpty.hidden = items.length > 0;
  libraryList.replaceChildren(...items.map((item, index) => {
    const li = document.createElement('li');

    const strip = document.createElement('button');
    strip.type = 'button';
    strip.className = 'strip';
    strip.setAttribute('aria-label', `Load palette ${item.colors.join(', ')}`);
    strip.append(...item.colors.map((hex) => {
      const chip = document.createElement('span');
      chip.style.background = hex;
      return chip;
    }));
    strip.addEventListener('click', () => {
      pushUndo();
      state.colors = item.colors.map((hex) => ({ hex, locked: false }));
      render();
      libraryDialog.close();
      toast('Palette loaded');
    });

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn btn-small';
    remove.textContent = 'Delete';
    remove.addEventListener('click', () => {
      writeLibrary(readLibrary().filter((_, i) => i !== index));
      renderLibrary();
    });

    li.append(strip, remove);
    return li;
  }));
}

/* ---------- Export ---------- */

const EXPORTERS = {
  css: (hexes) => `:root {\n${hexes.map((hex, i) => `  --color-${i + 1}: ${hex};`).join('\n')}\n}`,
  scss: (hexes) => hexes.map((hex, i) => `$color-${i + 1}: ${hex};`).join('\n'),
  json: (hexes) => JSON.stringify(hexes, null, 2),
  link: () => location.href,
};

function renderExport() {
  exportCode.textContent = EXPORTERS[state.exportFormat](state.colors.map((c) => c.hex));
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.setAttribute('aria-selected', String(tab.dataset.format === state.exportFormat));
  });
}

function openExport() {
  renderExport();
  exportDialog.showModal();
}

/* ---------- Events ---------- */

$('#generate-btn').addEventListener('click', generate);
undoBtn.addEventListener('click', undo);
$('#save-btn').addEventListener('click', savePalette);
$('#export-btn').addEventListener('click', openExport);
$('#library-btn').addEventListener('click', () => {
  renderLibrary();
  libraryDialog.showModal();
});
$('#mode').addEventListener('change', (event) => {
  state.mode = event.target.value;
  generate();
});
$('#copy-export').addEventListener('click', () => copy(exportCode.textContent, 'Export copied to clipboard'));
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    state.exportFormat = tab.dataset.format;
    renderExport();
  });
});

// Clicking the backdrop closes a dialog.
for (const dialog of [exportDialog, libraryDialog]) {
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
}

// Don't leave mouse focus on buttons, so Space keeps generating palettes.
document.addEventListener('click', (event) => {
  if (event.detail > 0) event.target.closest('button')?.blur();
});

document.addEventListener('keydown', (event) => {
  if (document.querySelector('dialog[open]') || event.target.closest('input, select, textarea')) return;

  const key = event.key.toLowerCase();
  if ((event.ctrlKey || event.metaKey) && key === 'z') {
    event.preventDefault();
    undo();
    return;
  }
  if (event.ctrlKey || event.metaKey || event.altKey) return;

  if (event.code === 'Space') {
    if (event.target.closest('button, a')) return; // let focused controls handle Space
    event.preventDefault();
    generate();
  } else if (key === 'z') {
    undo();
  } else if (key === 's') {
    savePalette();
  } else if (key === 'e') {
    openExport();
  } else if (/^[1-9]$/.test(key) && Number(key) <= SIZE) {
    toggleLock(Number(key) - 1);
  }
});

window.addEventListener('hashchange', () => {
  const shared = readHash();
  if (!shared) return;
  pushUndo();
  state.colors = shared;
  render();
});

/* ---------- Start ---------- */

state.colors = readHash() ?? generatePalette(state.colors, state.mode);
libraryCount.textContent = String(readLibrary().length);
render();
