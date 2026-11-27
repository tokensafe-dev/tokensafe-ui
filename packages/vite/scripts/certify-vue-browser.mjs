#!/usr/bin/env node
/**
 * Certifies the Vue/Vite adapter in a real browser.
 *
 * Starts the app's own Vite dev server (its config already mounts the plugin),
 * opens it in headless Chrome through playwright-core, waits until the Vue bridge
 * is live, and then runs `oumv-certify --url` against the dev server. With a real
 * tab connected `oumv/verify` dispatches to the app's registered store and the
 * bridge streams real traces, so levels 2–3 are certified rather than claimed.
 *
 *   node packages/vite/scripts/certify-vue-browser.mjs \
 *     --root certification/app-vue \
 *     --certify ../agent-oumv/packages/conformance/dist/cli/certify.js \
 *     --report certification/vue-vite-browser.json
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index > -1 ? process.argv[index + 1] : fallback;
};

const root = fs.existsSync(arg('--root', '')) ? fs.realpathSync(path.resolve(arg('--root', ''))) : path.resolve(arg('--root', ''));
const reportPath = path.resolve(arg('--report', 'certification/vue-vite-browser.json'));
const certifyPath = path.resolve(arg('--certify', '../agent-oumv/packages/conformance/dist/cli/certify.js'));
const fixturesPath = path.resolve(arg('--fixtures', '../agent-oumv/fixtures/conformance-cases.json'));
const browserChannel = arg('--channel', 'chrome');
if (!root) {
  console.error('--root <app> is required');
  process.exit(2);
}

const run = (command, args, options = {}) =>
  new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.on('exit', (code) => resolve(code ?? 1));
  });

const server = await createServer({
  root,
  // realpath the root: on macOS /tmp is a symlink and Vite's fs.allow list would
  // otherwise reject the served files with a 404.
  server: { host: '127.0.0.1', port: 0, fs: { allow: [root] } },
  logLevel: 'error',
});
await server.listen();
const address = server.httpServer.address();
const port = typeof address === 'object' && address ? address.port : 5173;
const baseUrl = `http://127.0.0.1:${port}`;
console.log(`▸ Vite dev server: ${baseUrl}`);

const browser = await chromium.launch({ channel: browserChannel, headless: true });
let exitCode = 1;
try {
  const page = await browser.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') console.log(`  [browser] ${message.text()}`);
  });
  await page.goto(`${baseUrl}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => Boolean(window.__OUMV_VUE_BRIDGE_INSTALLED__), { timeout: 15_000 });
  // The app registers its probe store and issues one fetch; give both a moment.
  await page.waitForTimeout(750);

  const sha = (text) => 'sha256:' + crypto.createHash('sha256').update(text, 'utf-8').digest('hex');
  const symbolBefore = `<template>
  <div>probe</div>
</template>

<script setup>
function probe() {
  return 41;
}
</script>
`;
  const symbolAfter = `<template>
  <div>probe</div>
</template>

<script setup>
function probe() {
  return 42;
}
</script>
`;
  const deleteSource = 'export const deleteMe = true;\n';
  const renameSource = 'export const renameMe = true;\n';
  const editContent = 'export const value = 42;\n';

  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/SymbolTarget.vue'), symbolBefore, 'utf-8');
  fs.writeFileSync(path.join(root, 'src/DeleteTarget.js'), deleteSource, 'utf-8');
  fs.writeFileSync(path.join(root, 'src/RenameSource.js'), renameSource, 'utf-8');
  fs.writeFileSync(path.join(root, 'src/EditTarget.js'), editContent, 'utf-8');
  fs.rmSync(path.join(root, 'src/RenameTarget.js'), { force: true });

  const markers = {
    fixtureFile: 'src/EditTarget.js',
    missingFile: 'src/Missing.js',
    editTarget: 'src/EditTarget.js',
    newFile: 'src/Created_New.js',
    editContent,
    editContentVersion: sha(editContent),
    patchReplacement: 'export const value = 43;\n',
    brokenContent: 'export function Broken( {\n',
    l2Target: 'App',
    l3Target: 'src/App.vue',
    verifyTarget: 'certificationProbe',
    symbolFile: 'src/SymbolTarget.vue',
    symbolName: 'probe',
    symbolReplacement: 'function probe() {\n  return 42;\n}',
    symbolVersion: sha(symbolBefore),
    symbolFileContent: symbolAfter,
    deleteFile: 'src/DeleteTarget.js',
    deleteVersion: sha(deleteSource),
    renameSource: 'src/RenameSource.js',
    renameTarget: 'src/RenameTarget.js',
    renameVersion: sha(renameSource),
  };
  const markersFile = path.join(os.tmpdir(), `oumv-vue-markers-${process.pid}.json`);
  fs.writeFileSync(markersFile, JSON.stringify(markers, null, 2));

  const createdFile = path.resolve(root, markers.newFile);
  const cleanCreated = () => {
    if (createdFile.startsWith(path.resolve(root) + path.sep)) fs.rmSync(createdFile, { force: true });
  };
  cleanCreated();

  fs.rmSync(reportPath, { force: true }); // a stale report must never pass for this run
  const code = await run(process.execPath, [
    certifyPath,
    '--adapter',
    'frontend/vue',
    '--framework',
    'vue',
    '--profile',
    'frontend',
    '--url',
    `${baseUrl}/__oumv/rpc`,
    '--fixtures',
    fixturesPath,
    '--markers',
    `@${markersFile}`,
    '--report',
    reportPath,
    '--min-level',
    '1',
    '--timeout',
    process.env.OUMV_CERT_TIMEOUT || '30000',
  ]);
  fs.rmSync(markersFile, { force: true });
  cleanCreated();

  if (fs.existsSync(reportPath)) {
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
    report.environment = {
      ...(report.environment || {}),
      transport: 'http',
      browser: `${browserChannel} (headless)`,
      vite: server.config?.plugins?.length ? 'dev server via vite createServer' : 'unknown',
      note: 'real browser tab connected: verify dispatches to the registered Vue store and L4 traces come from the bridge',
    };
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
    console.log(`\nlevel ${report.attainedLevel} · ${report.passed}/${report.total} · report: ${reportPath}`);
  }
  exitCode = code;
} finally {
  await browser.close();
  await server.close();
}
process.exit(exitCode);
