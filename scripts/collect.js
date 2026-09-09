'use strict';
/** Copy the finished installers out of the build folder into ./dist. */
const fs = require('fs');
const os = require('os');
const path = require('path');

const from = path.join(os.homedir(), '.lead-cleaner-build');
const to = path.join(__dirname, '..', 'dist');

fs.mkdirSync(to, { recursive: true });
const found = fs.existsSync(from)
  ? fs.readdirSync(from).filter((f) => /\.(dmg|exe)$/i.test(f))
  : [];

for (const f of found) fs.copyFileSync(path.join(from, f), path.join(to, f));
console.log(found.length ? found.map((f) => '  ' + f).join('\n') : '  (no installers found)');
