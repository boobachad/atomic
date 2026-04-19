#!/usr/bin/env node
// Reproduce the list-exit issue. Create a list, double-enter to exit,
// type text, check what decorations end up on the line.

import { openAtom, clickEdit, clickDone } from './lib.mjs';

async function main() {
  const { browser, page } = await openAtom();
  try {
    await clickEdit(page);
    await page.waitForTimeout(500);
    // Focus the editor at the very end.
    await page.evaluate(() => {
      const view = document.querySelector('.cm-content');
      view?.focus();
      const sel = window.getSelection();
      if (!sel) return;
      const lines = Array.from(document.querySelectorAll('.cm-line'));
      const last = lines[lines.length - 1];
      if (!last) return;
      const r = document.createRange();
      r.selectNodeContents(last);
      r.collapse(false);
      sel.removeAllRanges();
      sel.addRange(r);
    });
    await page.waitForTimeout(200);

    // Go to the end of the document explicitly via CM command.
    await page.keyboard.press('Meta+End');
    await page.waitForTimeout(200);

    // Add two blank lines to start fresh.
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);

    // Type a list, exit via double-Enter, type text.
    await page.keyboard.type('- first item', { delay: 15 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(80);
    await page.keyboard.type('second item', { delay: 15 });
    await page.keyboard.press('Enter');  // creates "- " on next line
    await page.waitForTimeout(80);
    await page.keyboard.press('Enter');  // exits list (removes "- ")
    await page.waitForTimeout(80);
    // User types directly without an extra Enter
    await page.keyboard.type('hello world', { delay: 15 });
    await page.waitForTimeout(200);

    const afterType = await page.evaluate(() => {
      const sel = window.getSelection();
      let el = sel?.anchorNode?.nodeType === 1 ? sel.anchorNode : sel?.anchorNode?.parentElement;
      while (el && !el.classList?.contains('cm-line')) el = el.parentElement;
      const lines = Array.from(document.querySelectorAll('.cm-line')).slice(-8);
      return {
        currentLineClass: el?.className,
        currentLineText: el ? (el.textContent || '') : null,
        lastLines: lines.map((l) => ({
          class: l.className,
          text: (l.textContent || '').slice(0, 40),
          paddingLeft: parseFloat(getComputedStyle(l).paddingLeft),
        })),
      };
    });
    console.log('\nafter typing "hello world":', JSON.stringify(afterType, null, 2));

    // Dump the CM editor's syntax tree around the "hello world" line
    const tree = await page.evaluate(() => {
      const view = (window).__cmView;
      if (!view) return null;
      const doc = view.state.doc;
      const lines = [];
      for (let i = 1; i <= doc.lines; i++) {
        lines.push({ n: i, text: doc.line(i).text });
      }
      const helloLineIdx = lines.findIndex((l) => l.text === 'hello world');
      if (helloLineIdx < 0) return null;
      const helloLine = doc.line(helloLineIdx + 1);
      return {
        helloLine: { from: helloLine.from, to: helloLine.to, text: helloLine.text, n: helloLineIdx + 1 },
        totalLines: doc.lines,
        precedingLines: lines.slice(Math.max(0, helloLineIdx - 5), helloLineIdx).map((l) => ({
          ...l,
          rawHex: Array.from(l.text).map(c => c.charCodeAt(0).toString(16)).join(' '),
        })),
      };
    });
    console.log('\ntree context:', JSON.stringify(tree, null, 2));
    // Also just dump the raw doc text at the very end
    const rawTail = await page.evaluate(() => {
      const view = (window).__cmView;
      if (!view) return null;
      return view.state.sliceDoc(Math.max(0, view.state.doc.length - 200));
    });
    console.log('raw tail:', JSON.stringify(rawTail));

    // Don't save; revert
    // Press Cmd+Z a bunch to undo
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Meta+z');
      await page.waitForTimeout(10);
    }
    await clickDone(page);
  } finally {
    await browser.close();
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
