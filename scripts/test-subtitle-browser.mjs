import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { subtitleViewerHtml } from '../dist/workflows/subtitle-viewer.js';

const browserRequire = createRequire('/tmp/subtitle-browser/package.json');
const { chromium } = browserRequire('playwright');
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [375, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<iframe id="viewer" title="Subtitle fixture" style="display:block;width:100%;height:850px;border:0"></iframe>');
    await page.evaluate(html => {
      window.hostReads = []; window.contextUpdates = []; window.subscriptions = [];
      const frame = document.querySelector('#viewer');
      const descriptor = { file: { name: 'fixture.srt', resourceUri: 'host-file://fixture/subtitles' } };
      window.addEventListener('message', event => {
        if (event.source !== frame.contentWindow) return;
        const message = event.data;
        if (message?.method === 'ui/notifications/initialized') {
          frame.contentWindow.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: descriptor } }, '*');
          return;
        }
        if (!message?.id) return;
        let result = {};
        if (message.method === 'ui/initialize') result = { protocolVersion: '2026-01-26', hostInfo: { name: 'fixture', version: '1' }, hostCapabilities: { updateModelContext: {}, experimental: { 'openai/resource': {} } } };
        else if (message.method === 'resources/read') {
          window.hostReads.push(message.params);
          if (message.params.uri !== descriptor.file.resourceUri) throw new Error('Unexpected resource read');
          result = { contents: [{ uri: descriptor.file.resourceUri, mimeType: 'text/plain', text: '1\n00:00:01,200 --> 00:00:03,400\n<img src=x onerror="window.executed=true">\n\n2\n00:00:04,000 --> 00:00:05,000\nUseful study segment' }] };
        } else if (message.method === 'resources/subscribe') window.subscriptions.push(message.params);
        else if (message.method === 'ui/update-model-context') window.contextUpdates.push(message.params);
        else throw new Error('Unexpected host method: ' + message.method);
        frame.contentWindow.postMessage({ jsonrpc: '2.0', id: message.id, result }, '*');
      });
      frame.srcdoc = html;
    }, subtitleViewerHtml);
    const view = page.frameLocator('#viewer');
    await view.locator('#status').filter({ hasText: 'Host file selected:' }).waitFor();
    assert.equal((await page.evaluate(() => window.hostReads)).length, 0, 'File reads require a click');
    assert.equal((await page.evaluate(() => window.contextUpdates)).length, 0, 'No automatic context sharing');
    await view.locator('#reload').click();
    await view.locator('#results article').first().waitFor();
    assert.equal(await view.locator('#results article').count(), 2);
    assert.equal(await view.locator('#results img').count(), 0);
    assert.match(await view.locator('#results').innerText(), /<img src=x/);
    await view.locator('#search').fill('Useful');
    assert.equal(await view.locator('#results article').count(), 1);
    await view.locator('#results button').click();
    await view.locator('#share').click();
    await page.waitForFunction(() => window.contextUpdates.length === 1);
    assert.match((await page.evaluate(() => window.contextUpdates[0])).content[0].text, /Useful study segment/);
    assert.equal((await page.evaluate(() => window.hostReads)).length, 1);
    await page.evaluate(() => document.querySelector('#viewer').contentWindow.postMessage({ jsonrpc: '2.0', method: 'notifications/resources/updated', params: { uri: 'host-file://fixture/subtitles' } }, '*'));
    await view.locator('#status').filter({ hasText: 'changed' }).waitFor();
    assert.equal((await page.evaluate(() => window.hostReads)).length, 1, 'A notification only marks stale state');
    assert.equal(await view.locator('body').evaluate(body => body.scrollWidth > window.innerWidth + 1), false, 'No horizontal mobile overflow');
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('Subtitle viewer browser fixtures passed: explicit reads/context, literal rendering, stale notifications, mobile and desktop layout.');
} finally { await browser.close(); }
