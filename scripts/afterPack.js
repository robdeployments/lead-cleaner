'use strict';
/**
 * Ad-hoc sign the macOS bundle after electron-builder packs it.
 *
 * Electron's prebuilt binaries ship a linker ad-hoc signature. electron-builder
 * renames and edits the bundle without resealing it, so the signature is left
 * present but invalid — which is what makes macOS say the app "is damaged and
 * can't be opened" rather than showing the ordinary unidentified-developer
 * warning. Re-signing produces a valid ad-hoc signature, so a downloaded copy
 * can be opened via System Settings > Privacy & Security > Open Anyway.
 *
 * A real Developer ID cert, once configured, re-signs over this.
 */
const { execFileSync } = require('child_process');

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const app = `${context.appOutDir}/${context.packager.appInfo.productFilename}.app`;

  // codesign refuses to touch anything carrying com.apple.FinderInfo, and that
  // attribute cannot be removed from a directory with xattr -d. Building inside
  // an iCloud File Provider domain (~/Documents, ~/Desktop) re-applies it to the
  // bundle as fast as it is stripped, so builds must run outside those folders —
  // see directories.output in package.json.
  execFileSync('xattr', ['-cr', app]);
  execFileSync('chmod', ['-RN', app]);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app]);

  // Fail the build rather than ship another bundle macOS calls "damaged".
  execFileSync('codesign', ['--verify', '--deep', '--strict', app]);
  console.log(`  • ad-hoc signed and verified  ${app}`);
};
