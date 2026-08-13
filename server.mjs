import { createServer } from 'node:http';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.TETHER_PORT ?? 7845);
const DOWNLOADS = join(HERE, 'downloads');

/** Where the watch's own storage starts. Everything above it needs root. */
const ROOT = '/sdcard';

const ADB = [
  join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
  'adb',
].find((candidate) => candidate === 'adb' || existsSync(candidate)) ?? 'adb';

/** Remote paths go through a single-quoted shell, so only the quote itself needs care. */
const shellQuote = (path) => `'${String(path).replace(/'/g, `'\\''`)}'`;

/**
 * The watch usually ends up attached twice — once from an explicit `connect`
 * and once because adb found the same device over mDNS. Both transports work,
 * but any command without `-s` then fails with "more than one device". Every
 * device-directed call goes through [target] so it names one.
 */
let serial = null;

const target = (args) => (serial ? ['-s', serial, ...args] : args);

async function adb(args, options = {}) {
  try {
    const { stdout, stderr } = await run(ADB, args, { maxBuffer: 64 * 1024 * 1024, ...options });
    return { ok: true, stdout, stderr };
  } catch (error) {
    return { ok: false, stdout: error.stdout ?? '', stderr: error.stderr ?? String(error) };
  }
}

const adbShell = (command) => adb(target(['shell', command]));

// ---------------------------------------------------------------- device

async function device() {
  const { stdout } = await adb(['devices', '-l']);
  const attached = stdout
    .split('\n')
    .slice(1)
    .map((row) => row.trim())
    .filter((row) => row && !row.startsWith('*') && /\sdevice(\s|$)/.test(row))
    .map((row) => row.split(/\s+/)[0]);

  if (!attached.length) {
    serial = null;
    return { connected: false };
  }

  // Prefer the ip:port transport: it survives a reconnect, where the mDNS name
  // picks up a "(2)" suffix each time the watch re-advertises.
  serial = attached.find((id) => /^\d+\.\d+\.\d+\.\d+:\d+$/.test(id)) ?? attached[0];

  const props = await adbShell(
    'getprop ro.product.model; getprop ro.build.version.release; getprop ro.product.manufacturer'
  );
  const [model, release, maker] = props.stdout.trim().split('\n').map((v) => v.trim());

  return { connected: true, serial, model, release, maker, transports: attached.length };
}

async function storage() {
  const { stdout } = await adbShell(`df -k ${shellQuote(ROOT)}`);
  const row = stdout.trim().split('\n').at(-1) ?? '';
  const parts = row.split(/\s+/);
  // Filesystem 1K-blocks Used Available Use% Mounted
  const used = Number(parts.at(-4)) * 1024;
  const free = Number(parts.at(-3)) * 1024;
  if (!Number.isFinite(used) || !Number.isFinite(free)) return null;
  return { used, free, total: used + free };
}

// ---------------------------------------------------------------- listing

/**
 * One `stat` call per directory rather than one per entry. The pipe-delimited
 * format survives spaces in names, which `ls -l` parsing does not.
 */
async function list(path) {
  const quoted = shellQuote(path);
  const command =
    `stat -c '%F|%s|%Y|%n' ${quoted}/* ${quoted}/.[!.]* 2>/dev/null; echo "--END--"`;
  const { stdout } = await adbShell(command);

  const entries = [];
  for (const line of stdout.split('\n')) {
    const row = line.trim();
    if (!row || row === '--END--') continue;
    const [kind, size, mtime, ...rest] = row.split('|');
    const full = rest.join('|');
    if (!full) continue;
    entries.push({
      name: basename(full),
      path: full,
      directory: kind === 'directory',
      size: Number(size) || 0,
      modified: Number(mtime) * 1000 || 0,
    });
  }

  entries.sort((a, b) =>
    a.directory === b.directory
      ? a.name.localeCompare(b.name, undefined, { numeric: true })
      : a.directory ? -1 : 1
  );
  return entries;
}

// ---------------------------------------------------------------- routes

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return {}; }
}

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

const routes = {
  'GET /api/state': async (req, res) => {
    const info = await device();
    json(res, 200, {
      ...info,
      storage: info.connected ? await storage() : null,
      root: ROOT,
    });
  },

  'GET /api/discover': async (req, res) => {
    const { stdout } = await adb(['mdns', 'services']);
    const found = stdout
      .split('\n')
      .filter((line) => line.includes('_adb-tls-connect'))
      .map((line) => line.trim().split(/\s+/).at(-1))
      .filter(Boolean);
    json(res, 200, { found: [...new Set(found)] });
  },

  'POST /api/pair': async (req, res) => {
    const { address, code } = await readJsonBody(req);
    if (!address || !code) return json(res, 400, { error: 'Need the address and the pairing code.' });
    const result = await adb(['pair', address, String(code)]);
    const text = `${result.stdout}${result.stderr}`.trim();
    if (!/Successfully paired/i.test(text)) return json(res, 400, { error: text || 'Pairing failed.' });
    json(res, 200, { message: text });
  },

  'POST /api/connect': async (req, res) => {
    const { address } = await readJsonBody(req);
    if (!address) return json(res, 400, { error: 'Need an address to connect to.' });
    const result = await adb(['connect', address]);
    const text = `${result.stdout}${result.stderr}`.trim();
    if (/cannot connect|failed/i.test(text)) return json(res, 400, { error: text });
    json(res, 200, { message: text });
  },

  'POST /api/disconnect': async (req, res) => {
    await adb(['disconnect']);
    json(res, 200, { ok: true });
  },

  'GET /api/ls': async (req, res, url) => {
    const path = url.searchParams.get('path') || ROOT;
    if (!path.startsWith(ROOT)) return json(res, 400, { error: 'Outside the watch storage.' });
    json(res, 200, { path, entries: await list(path) });
  },

  'GET /api/file': async (req, res, url) => {
    const path = url.searchParams.get('path');
    if (!path?.startsWith(ROOT)) return json(res, 400, { error: 'Outside the watch storage.' });

    // exec-out keeps the stream binary-clean, unlike `adb shell`.
    const child = spawn(ADB, target(['exec-out', `cat ${shellQuote(path)}`]));
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${basename(path).replace(/"/g, '')}"`,
    });
    child.stdout.pipe(res);
    child.on('error', () => res.destroy());
  },

  'POST /api/upload': async (req, res, url) => {
    const destination = url.searchParams.get('path') || ROOT;
    const name = url.searchParams.get('name');
    if (!name) return json(res, 400, { error: 'The upload has no filename.' });

    const staged = join(tmpdir(), `tether-${randomUUID()}${extname(name)}`);
    await writeFile(staged, await readRawBody(req));
    try {
      const result = await adb(target(['push', staged, `${destination}/${name}`]));
      if (!result.ok) return json(res, 400, { error: result.stderr.trim() || 'The watch refused the file.' });
      json(res, 200, { ok: true });
    } finally {
      await rm(staged, { force: true });
    }
  },

  'POST /api/install': async (req, res, url) => {
    const name = url.searchParams.get('name') ?? 'app.apk';
    const staged = join(tmpdir(), `tether-${randomUUID()}.apk`);
    await writeFile(staged, await readRawBody(req));
    try {
      const result = await adb(target(['install', '-r', staged]));
      const text = `${result.stdout}${result.stderr}`.trim();
      if (!/Success/i.test(text)) return json(res, 400, { error: text || 'The install failed.' });
      json(res, 200, { message: `Installed ${name}.` });
    } finally {
      await rm(staged, { force: true });
    }
  },

  'POST /api/save': async (req, res) => {
    const { paths } = await readJsonBody(req);
    if (!Array.isArray(paths) || !paths.length) return json(res, 400, { error: 'Nothing selected.' });
    await mkdir(DOWNLOADS, { recursive: true });
    for (const path of paths) {
      if (!path.startsWith(ROOT)) continue;
      const result = await adb(target(['pull', path, DOWNLOADS]));
      if (!result.ok) return json(res, 400, { error: result.stderr.trim() || `Could not fetch ${path}.` });
    }
    json(res, 200, { message: `Saved to ${DOWNLOADS}`, folder: DOWNLOADS });
  },

  'POST /api/delete': async (req, res) => {
    const { paths } = await readJsonBody(req);
    if (!Array.isArray(paths) || !paths.length) return json(res, 400, { error: 'Nothing selected.' });
    for (const path of paths) {
      if (!path.startsWith(ROOT) || path === ROOT) {
        return json(res, 400, { error: 'That path is out of bounds.' });
      }
      const result = await adbShell(`rm -rf ${shellQuote(path)}`);
      if (!result.ok) return json(res, 400, { error: result.stderr.trim() });
    }
    json(res, 200, { ok: true });
  },

  'POST /api/mkdir': async (req, res) => {
    const { path, name } = await readJsonBody(req);
    if (!path?.startsWith(ROOT) || !name) return json(res, 400, { error: 'Need a folder name.' });
    if (name.includes('/')) return json(res, 400, { error: 'A folder name cannot contain a slash.' });
    const result = await adbShell(`mkdir -p ${shellQuote(`${path}/${name}`)}`);
    if (!result.ok) return json(res, 400, { error: result.stderr.trim() });
    json(res, 200, { ok: true });
  },
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const handler = routes[`${req.method} ${url.pathname}`];

  try {
    if (handler) return await handler(req, res, url);
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const page = await readFile(join(HERE, 'public', 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(page);
    }
    json(res, 404, { error: 'No such route.' });
  } catch (error) {
    json(res, 500, { error: String(error?.message ?? error) });
  }
});

// Loopback only: this process can read and delete everything on the watch, and
// nothing about it should be reachable from the network.
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Tether is up:  http://localhost:${PORT}`);
  console.log(`adb:           ${ADB}`);
  console.log(`Saves land in: ${DOWNLOADS}`);
});
