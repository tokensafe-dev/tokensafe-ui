#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const targetArg = process.argv[2];

if (!targetArg || targetArg === '--help' || targetArg === '-h') {
  console.log(`
  🚀 TokenSafe UI Scaffolding CLI

  Usage:
    pnpm create tokensafe-ui <project-name>
    npm create tokensafe-ui <project-name>
    npx create-tokensafe-ui <project-name>

  Example:
    npx create-tokensafe-ui my-agent-app
  `);
  process.exit(0);
}

const targetDir = path.resolve(process.cwd(), targetArg);
const projectName = path.basename(targetDir);

if (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length > 0) {
  console.error(`❌ Error: Target directory '${targetDir}' is not empty.`);
  process.exit(1);
}

console.log(`\n📦 Scaffolding new TokenSafe UI project in ${targetDir}...\n`);

fs.mkdirSync(targetDir, { recursive: true });

const templateDir = path.resolve(__dirname, '../templates/default');

function copyRecursive(src, dest) {
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destName = entry.name.startsWith('_') ? '.' + entry.name.slice(1) : entry.name;
    const destPath = path.join(dest, destName);

    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyRecursive(srcPath, destPath);
    } else {
      let content = fs.readFileSync(srcPath, 'utf-8');
      if (entry.name === 'package.json') {
        content = content.replace(/__PROJECT_NAME__/g, projectName);
      }
      fs.writeFileSync(destPath, content, 'utf-8');
    }
  }
}

copyRecursive(templateDir, targetDir);

console.log(`✅ Project created successfully!

Next steps:
  cd ${targetArg}
  pnpm install (or npm install)
  pnpm dev     (or npm run dev)

🤖 Coding Agent Integration:
  Your project is pre-configured with .mcp.json for Antigravity, Claude Code, and Cursor.
`);
