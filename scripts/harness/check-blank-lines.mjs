#!/usr/bin/env node
// Verify that consecutive blank lines add vertical space (only the last
// blank in a run collapses; earlier ones stay full-height).

import { openAtom, clickEdit, clickDone } from './lib.mjs';

async function main() {
  const { browser, page } = await openAtom();
  try {
    await clickEdit(page);
    await page.waitForTimeout(500);
    await page.keyboard.press('Meta+End');
    await page.waitForTimeout(100);

    // Add a marker paragraph, then N blanks, then another marker.
    // Check visible heights.
    const scenarios = [
      { label: 'single blank', blanks: 1 },
      { label: 'double blank', blanks: 2 },
      { label: 'triple blank', blanks: 3 },
    ];

    for (const s of scenarios) {
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
      await page.keyboard.type(`marker-before-${s.blanks}`, { delay: 10 });
      for (let i = 0; i <= s.blanks; i++) await page.keyboard.press('Enter');
      await page.keyboard.type(`marker-after-${s.blanks}`, { delay: 10 });
      await page.waitForTimeout(100);

      const m = await page.evaluate(({ blanks }) => {
        const lines = Array.from(document.querySelectorAll('.cm-line'));
        const before = lines.find((l) => (l.textContent || '') === `marker-before-${blanks}`);
        const after = lines.find((l) => (l.textContent || '') === `marker-after-${blanks}`);
        if (!before || !after) return null;
        const gap = after.getBoundingClientRect().top - before.getBoundingClientRect().bottom;
        // count blank lines between them
        let b = before;
        let blankCount = 0;
        let blankHeights = [];
        while (b?.nextElementSibling && b.nextElementSibling !== after) {
          b = b.nextElementSibling;
          if ((b.textContent || '') === '') {
            blankCount++;
            blankHeights.push(Math.round(b.getBoundingClientRect().height));
          }
        }
        return { gap: Math.round(gap), blankCount, blankHeights };
      }, s);
      console.log(`${s.label} (${s.blanks} typed Enters): `, JSON.stringify(m));
    }

    // Undo everything
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Meta+z');
      await page.waitForTimeout(10);
    }
    await clickDone(page);
  } finally {
    await browser.close();
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
