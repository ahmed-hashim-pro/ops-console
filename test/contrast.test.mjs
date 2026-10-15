// The colour tokens in src/styles.css, checked pair by pair in both themes.
// axe checks the text it can see in the rendered page; this also covers
// states it may not catch (a selected row scrolled out of view) and what it
// can't see at all (lines drawn on a canvas, the focus ring).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

function tokens(selector) {
  const start = css.indexOf(selector);
  assert.ok(start >= 0, selector);
  const block = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));
}

function luminance(hex) {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// [foreground, background, minimum]: 4.5 for text, 3 for lines and focus rings.
const PAIRS = [
  ['text', 'bg', 4.5],
  ['text', 'surface', 4.5],
  ['text', 'surface-2', 4.5],
  ['text', 'row-selected', 4.5],
  ['muted', 'bg', 4.5],
  ['muted', 'surface', 4.5],
  ['muted', 'surface-2', 4.5],
  ['accent', 'surface', 4.5],
  ['accent', 'row-hover', 4.5],
  ['link-selected', 'row-selected', 4.5],
  ['accent-text', 'accent', 4.5],
  ['ok-fg', 'ok-bg', 4.5],
  ['warn-fg', 'warn-bg', 4.5],
  ['crit-fg', 'crit-bg', 4.5],
  ['off-fg', 'off-bg', 4.5],
  ['crit-fg', 'surface', 4.5],
  ['warn-fg', 'surface', 4.5],
  ['chart-cpu', 'surface', 3],
  ['chart-lat', 'surface', 3],
  ['focus', 'surface', 3],
  ['focus', 'bg', 3],
  ['focus', 'row-selected', 3],
];

for (const [theme, selector] of [
  ['light', ":root[data-theme='light']"],
  ['dark', ":root[data-theme='dark']"],
]) {
  test(`${theme} theme: every colour pair meets its contrast minimum`, () => {
    const t = tokens(selector);
    const failures = [];
    for (const [fg, bg, min] of PAIRS) {
      assert.ok(t[fg] && t[bg], `${fg} and ${bg} are defined`);
      const c = contrast(t[fg], t[bg]);
      if (c < min) failures.push(`${fg} on ${bg}: ${c.toFixed(2)} < ${min}`);
    }
    assert.deepEqual(failures, []);
  });
}

test('the old selected-row colour would have failed (what CI caught)', () => {
  assert.ok(contrast('#4493f8', '#12304f') < 4.5);
});
