#!/usr/bin/env node

// USAGE:
//    node fv/run.js [CONFIG]* [--all]
// EXAMPLES:
//    node fv/run.js --all
//    node fv/run.js ERC721
//    node fv/run.js fv/specs/ERC721.conf

const glob = require('glob');
const fs = require('fs');
const path = require('path');
const pLimit = require('p-limit').default;
const { hideBin } = require('yargs/helpers');
const yargs = require('yargs/yargs');
const { spawn } = require('child_process');

const { argv } = yargs(hideBin(process.argv))
  .env('')
  .options({
    all: {
      type: 'boolean',
    },
    parallel: {
      alias: 'p',
      type: 'number',
      default: 4,
    },
    verbose: {
      alias: 'v',
      type: 'count',
      default: 0,
    },
  });

const pattern = 'fv/specs/*.conf';
const limit = pLimit(argv.parallel);

function resolveConfig(name) {
  const candidate = fs.existsSync(name)
    ? name
    : path.posix.join('fv/specs', `${path.posix.basename(String(name), path.posix.extname(String(name)))}.conf`);

  const resolved = path.resolve(candidate);
  const allowedRoot = path.resolve('fv/specs');
  if (!resolved.startsWith(allowedRoot + path.sep) && resolved !== allowedRoot) {
    throw new Error(`Invalid config path: ${name}`);
  }
  return resolved;
}

function extractCertoraUrl(output) {
  for (const token of String(output).split(/\s+/)) {
    try {
      const url = new URL(token);
      if (url.protocol === 'https:' && url.hostname === 'prover.certora.com' && url.pathname.startsWith('/output/')) {
        return url.toString();
      }
    } catch {}
  }
  return null;
}

if (argv._.length == 0 && !argv.all) {
  console.error(`Warning: No specs requested. Did you forget to toggle '--all'?`);
  process.exitCode = 1;
} else {
  Promise.all(
    (argv.all ? glob.sync(pattern) : argv._.map(name => resolveConfig(name))).map(
      (conf, i, { length }) =>
        limit(
          () =>
            new Promise(resolve => {
              if (argv.verbose) console.log(`[${i + 1}/${length}] Running ${conf}`);
              const child = spawn('certoraRun', [conf], { shell: false });
              let stdout = '';
              let stderr = '';

              child.stdout.on('data', chunk => {
                stdout += chunk.toString();
              });
              child.stderr.on('data', chunk => {
                stderr += chunk.toString();
              });
              child.on('close', code => {
                const certoraUrl = extractCertoraUrl(stdout);
                if (code !== 0) {
                  console.error(`[ERR] ${conf} failed with:\n${stderr || stdout}`);
                  process.exitCode = 1;
                } else if (certoraUrl) {
                  console.log(`${conf} - ${certoraUrl}`);
                } else {
                  console.error(`[ERR] Could not parse stdout for ${conf}:\n${stdout}`);
                  process.exitCode = 1;
                }
                resolve();
              });
            }),
        ),
    ),
  );
}
