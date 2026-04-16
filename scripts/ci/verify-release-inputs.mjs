#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const packageJson = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const version = packageJson.version?.trim() || '';
const tag = process.env.CI_COMMIT_TAG?.trim() || '';
const tnymaRef = process.env.TNYMA_AI_REF?.trim() || '';

if (!tag) {
  console.log('No CI tag detected, skipping release input verification.');
  process.exit(0);
}

if (!version) {
  throw new Error('package.json is missing a version field.');
}

const acceptedTags = new Set([version, `v${version}`]);
if (!acceptedTags.has(tag)) {
  throw new Error(`Release tag ${tag} does not match package.json version ${version}. Expected one of: ${Array.from(acceptedTags).join(', ')}`);
}

if (!tnymaRef) {
  throw new Error('TNYMA_AI_REF must be set for tag releases and should point to an immutable commit or tag.');
}

const looksLikeCommit = /^[0-9a-f]{7,40}$/i.test(tnymaRef);
const looksLikeTag = /^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/i.test(tnymaRef)
  || /^refs\/tags\/.+/.test(tnymaRef)
  || /^tags\/.+/.test(tnymaRef);
const looksLikeBranch = /^(main|master|develop|development|dev|release\/.+|hotfix\/.+|feat\/.+|feature\/.+)$/i.test(tnymaRef);

if (looksLikeBranch || (!looksLikeCommit && !looksLikeTag)) {
  throw new Error(
    `TNYMA_AI_REF=${tnymaRef} is not locked to an immutable ref. Use a commit SHA or version tag for tag releases.`,
  );
}

console.log(`Verified release inputs: tag=${tag}, installerVersion=${version}, tnymaAiRef=${tnymaRef}`);
