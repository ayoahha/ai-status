import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function buildInfo(version, sha) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) || !/^[a-f0-9]{40}$/.test(sha)) {
    throw new Error('Version ou commit de publication invalide');
  }
  return { version, sha };
}

export function writeBuildInfo() {
  const root = new URL('../', import.meta.url);
  const { version } = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const info = buildInfo(version, sha);
  writeFileSync(new URL('public/build-info.js', root), `export const BUILD_INFO = ${JSON.stringify(info)};\n`);
  return info;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) writeBuildInfo();
