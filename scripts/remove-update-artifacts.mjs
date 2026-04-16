#!/usr/bin/env node

import { readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const RELEASE_DIR = path.resolve(process.env.CI_RELEASE_DIR?.trim() || path.join(ROOT, 'release'));

function shouldRemove(filename) {
  return /^latest.*\.yml$/i.test(filename) || /\.blockmap$/i.test(filename);
}

function main() {
  let removed = 0;

  for (const name of readdirSync(RELEASE_DIR)) {
    const targetPath = path.join(RELEASE_DIR, name);
    if (!statSync(targetPath).isFile() || !shouldRemove(name)) {
      continue;
    }

    rmSync(targetPath, { force: true });
    removed += 1;
    console.log(`Removed update artifact: ${name}`);
  }

  console.log(`Update artifact cleanup complete. Removed ${removed} file(s).`);
}

main();
