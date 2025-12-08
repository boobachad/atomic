// scripts/build-release.js
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const TAURI_DIR = path.join(PROJECT_ROOT, 'src-tauri');

function log(msg) {
  console.log(msg);
}

function error(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

function parseVersion(versionStr) {
  const match = versionStr.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return {
    major: parseInt(match[1]),
    minor: parseInt(match[2]),
    patch: parseInt(match[3])
  };
}

function formatVersion(v) {
  return `${v.major}.${v.minor}.${v.patch}`;
}

function bumpVersion(versionStr, type) {
  const v = parseVersion(versionStr);
  if (!v) error(`Invalid version: ${versionStr}`);

  if (type === 'major') {
    v.major++;
    v.minor = 0;
    v.patch = 0;
  } else if (type === 'minor') {
    v.minor++;
    v.patch = 0;
  } else if (type === 'patch') {
    v.patch++;
  }

  return formatVersion(v);
}

function getCurrentVersion() {
  const configPath = path.join(TAURI_DIR, 'tauri.conf.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  return config.version;
}

function updateVersion(newVersion) {
  log(`Updating version to ${newVersion}...`);

  // Update tauri.conf.json
  const tauriConfigPath = path.join(TAURI_DIR, 'tauri.conf.json');
  const tauriConfig = JSON.parse(fs.readFileSync(tauriConfigPath, 'utf8'));
  tauriConfig.version = newVersion;
  fs.writeFileSync(tauriConfigPath, JSON.stringify(tauriConfig, null, 2) + '\n');

  // Update Cargo.toml
  const cargoTomlPath = path.join(TAURI_DIR, 'Cargo.toml');
  let cargoToml = fs.readFileSync(cargoTomlPath, 'utf8');
  cargoToml = cargoToml.replace(/^version = ".*"$/m, `version = "${newVersion}"`);
  fs.writeFileSync(cargoTomlPath, cargoToml);

  // Update package.json
  const packageJsonPath = path.join(PROJECT_ROOT, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  packageJson.version = newVersion;
  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');

  log(`Updated version in all files`);
}

function exec(cmd) {
  execSync(cmd, { cwd: PROJECT_ROOT, stdio: 'inherit' });
}

function showHelp() {
  console.log(`
Usage: node scripts/build-release.js <bump-type>

Bump version, commit, tag, and push to trigger GitHub Actions release build.

Arguments:
  patch    Bump patch version (0.2.0 -> 0.2.1)
  minor    Bump minor version (0.2.0 -> 0.3.0)
  major    Bump major version (0.2.0 -> 1.0.0)

Examples:
  npm run release:patch
  npm run release:minor
  npm run release:major
  `);
}

function main() {
  const bumpType = process.argv[2];

  if (!bumpType || bumpType === '--help' || bumpType === '-h') {
    showHelp();
    process.exit(bumpType ? 0 : 1);
  }

  if (!['patch', 'minor', 'major'].includes(bumpType)) {
    error(`Invalid bump type: ${bumpType}. Use patch, minor, or major.`);
  }

  // Get current version and bump it
  const currentVersion = getCurrentVersion();
  const newVersion = bumpVersion(currentVersion, bumpType);
  const tagName = `v${newVersion}`;

  log(`\nReleasing ${tagName} (${currentVersion} -> ${newVersion})\n`);

  // Update version in all files
  updateVersion(newVersion);

  // Commit, tag, and push
  log('\nCommitting version bump...');
  exec('git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml');
  exec(`git commit -m "Bump version to ${tagName}"`);

  log(`\nCreating tag ${tagName}...`);
  exec(`git tag -a ${tagName} -m "Release ${tagName}"`);

  log('\nPushing to origin...');
  exec('git push && git push --tags');

  log(`\nDone! GitHub Actions will now build and release ${tagName}`);
  log('Watch progress at: https://github.com/kenforthewin/atomic/actions');
}

main();
