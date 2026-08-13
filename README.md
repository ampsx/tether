# Tether

A file manager for a Wear OS watch, over wireless adb, from the laptop.

Built as a sibling to [Quotidian](../quotidian) — same palette, so the two tools
read as one set. Quotidian's mark is a dial, so Tether takes the other half of
that vocabulary: two bodies and the line between them, the large amber ring
being the watch and the small bone one the laptop. Earlier drafts hung a solid
dot off a tangent cord, which at favicon size is simply a magnifying glass.

`public/logo.svg` is the source; `public/tether.ico` is generated from it for
the Windows shortcut and carries sizes from 16 to 256.

## Running it

Double-click the **Tether** shortcut on the Desktop, or `tether.cmd` here, or:

```powershell
node server.mjs      # then open http://localhost:7845
```

The server binds **127.0.0.1 only**. It can read and delete everything on the
watch, so nothing about it should be reachable from the network.

## Using it

The watch has to be awake and on the same Wi-Fi as the laptop, with
**Settings → Developer options → Wireless debugging** turned on.

- **First time, or any time you toggle wireless debugging off and on:** open
  *Pair new device* on the watch and put its address and 6-digit code into the
  **Pair** row. Tether pairs, then finds the (different) debugging port over
  mDNS and connects on its own.
- **Already paired:** press **Find it** to discover the address, then
  **Connect**.

Then:

| To do this | Do that |
|---|---|
| Open a folder | Click its name |
| Download a file | Click its name |
| Save several at once | Tick them, press **Save** — they land in `downloads/` |
| Send files to the watch | Drag them onto the window, or press **Send files** |
| Update Quotidian | Run `E:\quotidian\release.cmd`, then drag `Quotidian.apk` from the Desktop onto the window |
| Install any APK | Drag the `.apk` on and confirm the install prompt |
| Free up space | Tick, press **Delete** |

The dial in the corner is the watch's storage: the amber arc is how full it is.

## Testing

With the server running and a watch (or a Wear emulator) connected:

```powershell
npm test
```

It uploads a 4 KB binary file, checks the listing reports the right size, pulls
it back and compares byte for byte, makes and removes a folder, saves to the
laptop, and confirms the server refuses paths outside `/sdcard` and refuses to
delete the root. It cleans up after itself.

## Notes

- **The link drops whenever the watch's screen sleeps** — Wear OS parks Wi-Fi to
  save battery. Tether re-checks every five seconds and drops back to the connect
  panel when it goes. Keep the screen on (or the watch on its charger) for a long
  transfer.
- **The pairing port and the debugging port are different**, and both change each
  time wireless debugging is toggled. That is why pairing and connecting are two
  separate rows rather than one.
- Only `/sdcard` is reachable. App-private storage needs root, which a retail
  Galaxy Watch does not give you.
- Directory listings come from one `stat -c '%F|%s|%Y|%n'` call per folder rather
  than parsing `ls -l`, so filenames containing spaces survive.
- **The watch often ends up attached twice** — once from an explicit `connect`
  and once because adb rediscovered it over mDNS — and any command without `-s`
  then fails with "more than one device". Every device-directed call names one
  serial, preferring the `ip:port` transport, since the mDNS name gains a `(2)`
  suffix each time the watch re-advertises.
- **node comes from fnm**, which lives under `%APPDATA%\fnm` and only reaches
  PATH via the shell profile — which a double-clicked shortcut never runs.
  `tether.cmd` resolves `aliases\default` itself.
