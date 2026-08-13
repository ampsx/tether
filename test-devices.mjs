// Parsing `adb devices -l`. Needs no watch attached — run it any time.
//
// The case that matters is the first one. Every time wireless debugging is
// toggled the watch re-advertises, and adb disambiguates the repeat by renaming
// the transport "adb-XXXX (2)._adb-tls-connect._tcp" — a serial with a space in
// it. Splitting that on whitespace gave a name no device answers to, so every
// command failed while the UI still looked connected: a nameless device above
// an empty folder listing.
import { parseDevices } from './server.mjs';

const cases = [
  [
    'renamed mDNS transport (the bug)',
    'List of devices attached\nadb-RFAXB1A1A5P-Fb3YGJ (2)._adb-tls-connect._tcp   device product:projectx2ulxx model:SM_L705F device:projectx2ul transport_id:3',
    [{ serial: 'adb-RFAXB1A1A5P-Fb3YGJ (2)._adb-tls-connect._tcp', transport: '3' }],
  ],
  [
    'plain ip:port',
    'List of devices attached\n192.168.1.233:35365    device product:projectx2ulxx model:SM_L705F device:projectx2ul transport_id:4',
    [{ serial: '192.168.1.233:35365', transport: '4' }],
  ],
  [
    'both transports at once (the usual state)',
    'List of devices attached\n192.168.1.233:35365    device product:x model:Y transport_id:4\nadb-RFAX-Fb3YGJ (2)._adb-tls-connect._tcp device product:x model:Y transport_id:3',
    [
      { serial: '192.168.1.233:35365', transport: '4' },
      { serial: 'adb-RFAX-Fb3YGJ (2)._adb-tls-connect._tcp', transport: '3' },
    ],
  ],
  ['none attached', 'List of devices attached\n', []],
  [
    'a sleeping watch leaves an offline transport behind',
    'List of devices attached\n192.168.1.233:35365    offline transport_id:9',
    [],
  ],
  [
    'daemon chatter is skipped',
    '* daemon not running; starting now at tcp:5037\n* daemon started successfully\nList of devices attached\nemulator-5554   device product:sdk model:Wear transport_id:1',
    [{ serial: 'emulator-5554', transport: '1' }],
  ],
  [
    'unauthorized is not attached',
    'List of devices attached\nZY22GHKLMN    unauthorized transport_id:2',
    [],
  ],
];

let failed = 0;
for (const [name, input, expected] of cases) {
  const got = parseDevices(input);
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) {
    console.log('       got ', JSON.stringify(got));
    console.log('       want', JSON.stringify(expected));
  }
}

process.exit(failed ? 1 : 0);
