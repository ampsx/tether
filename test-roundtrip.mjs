// End-to-end check against a real connected device: start the server, connect a
// watch (or a Wear emulator), then `npm test`. It writes only inside
// /sdcard/Download and removes everything it makes.
const base = `http://localhost:${process.env.TETHER_PORT ?? 7845}`;
const ok = (label, pass, extra = '') =>
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${extra ? '  — ' + extra : ''}`);

// A binary payload, so this also proves the stream is not being mangled as text.
const payload = Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 37) % 256));
const name = 'tether round trip.bin';
const folder = '/sdcard/Download';

// 1. upload
let res = await fetch(`${base}/api/upload?path=${encodeURIComponent(folder)}&name=${encodeURIComponent(name)}`,
  { method: 'POST', body: payload });
ok('upload', res.ok, await res.text());

// 2. it appears in the listing, with the right size
res = await fetch(`${base}/api/ls?path=${encodeURIComponent(folder)}`);
const { entries } = await res.json();
const found = entries.find((e) => e.name === name);
ok('listed with correct size', found?.size === payload.length, `got ${found?.size}`);

// 3. download it back byte-for-byte
res = await fetch(`${base}/api/file?path=${encodeURIComponent(`${folder}/${name}`)}`);
const back = Buffer.from(await res.arrayBuffer());
ok('download is byte-identical', back.equals(payload), `${back.length} vs ${payload.length} bytes`);

// 4. mkdir
res = await fetch(`${base}/api/mkdir`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ path: folder, name: 'tether test folder' }),
});
ok('mkdir', res.ok);

// 5. save to the laptop
res = await fetch(`${base}/api/save`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ paths: [`${folder}/${name}`] }),
});
const saved = await res.json();
ok('save to laptop', res.ok, saved.folder ?? saved.error);

// 6. delete both
res = await fetch(`${base}/api/delete`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ paths: [`${folder}/${name}`, `${folder}/tether test folder`] }),
});
ok('delete', res.ok, await res.text());

// 7. gone
res = await fetch(`${base}/api/ls?path=${encodeURIComponent(folder)}`);
const after = (await res.json()).entries.map((e) => e.name);
ok('gone from the watch', !after.includes(name) && !after.includes('tether test folder'), after.join(', '));

// 8. refuses to escape /sdcard
res = await fetch(`${base}/api/delete`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ paths: ['/data/local/tmp'] }),
});
ok('refuses paths outside /sdcard', res.status === 400);

// 9. refuses to delete the root itself
res = await fetch(`${base}/api/delete`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ paths: ['/sdcard'] }),
});
ok('refuses to delete /sdcard itself', res.status === 400);
