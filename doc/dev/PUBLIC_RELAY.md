# Running a Public Relay

How to host the REVELation socket relay on a public server, and why it is a
separate mode rather than a firewall configuration.

---

## What a relay is for

Reveal Remote and the presenter-plugins channel normally run on the
presenter's own machine, and everything stays on the LAN. That is the default
and the right choice almost always.

A relay exists for the case where a participant cannot reach that LAN:

- a phone acting as a remote control over cellular rather than the venue Wi-Fi
- a viewer following a presentation from another site
- an exported standalone presentation, which has no local server at all

`revealremote.fiforms.org` is such a relay. This document is about running
one.

In the app, users opt in per install with **Settings → Networking → Route Live
Features Through the Public Server**. Exported standalone presentations always
use the relay, because there is nothing local for them to talk to.

---

## Why a dedicated mode

The Vite server hosts a lot besides the sockets: the presentations tree, the
plugin tree, a thumbnail service that spawns `ffmpeg`, an admin UI, peer
pairing endpoints, and Vite's own static root including `/@fs`. Several of
those are protected only by a loopback check —
`isLoopbackAddress(req.socket.remoteAddress)`.

**A same-machine reverse proxy defeats every one of them.** Forwarded requests
arrive from `127.0.0.1`, so the gate passes for whoever is on the other side of
the proxy — which, on a public relay, is the internet. Anyone could read
`index.json`, open `/admin`, or `POST /peer/command`.

The fix is not a longer list of proxy `deny` rules. Blocklists rot: a route
added later is exposed by default, and one missing rule is a breach. Public
relay mode instead **never registers** the local-machine features, so there is
nothing behind the gates to reach.

---

## Starting a relay

```bash
cd revelation
npm ci
npm run relay          # REVELATION_PUBLIC_SERVER=1 vite --host
```

Equivalents:

```bash
REVELATION_PUBLIC_SERVER=1 npx vite --host --port 8000
npx vite --host --public-server
```

Prefer the environment variable. It cannot collide with Vite's own CLI option
parsing, and it survives being wrapped by a process manager.

Confirm the banner on startup:

```
🔒 PUBLIC RELAY MODE
   serving: /socket.io, /presenter-plugins-socket, /_remote/ui/
   disabled: presentations, plugins, thumbnails, media, admin, peer endpoints, file watching, Vite static root
```

If that line is absent, the mode is **not** active — do not expose the port.
The most common cause is starting Vite from the wrong working directory, so
`vite.config.js` (and therefore the plugin) never loads.

---

## What the relay serves

| Path | Purpose |
|---|---|
| `/socket.io` | Reveal Remote broker: presenter, remote, multiplex follower |
| `/presenter-plugins-socket` | Presenter-plugins channel (slidecontrol, markerboard, captions, videostream, bibletext live verse) |
| `/_remote/ui/**` | Static remote-control web UI, self-contained |
| `/` | One-line liveness string. No hostname, no version |

Everything else returns a flat `404` with no indication whether the path
exists.

Explicitly **not** mounted:

- `/presentations_<key>/`, `/plugins_<key>/`, `/thumbs_<key>/`
- `/media-share/<token>`, `/publish/`, `/admin/`
- `/peer/*` and the `/peer-commands` socket namespace
- `**/index.json`
- Vite's static root, `/@fs`, `/@id`, `/@vite/client`
- The chokidar file watcher and presentation/media index generation

A relay therefore needs no presentations directory, no `config.json`, no
plugins folder and no `ffmpeg`. The presentations path is never resolved, so
the usual "No presentations folder found" startup error cannot occur.

---

## Deployment notes

**Put TLS in front of it.** The relay speaks plain HTTP; terminate TLS at a
proxy or load balancer. Browsers require a secure context for several deck
features, and a `wss://` origin for the socket connection.

**Forward WebSocket upgrades.** Socket.IO will fall back to HTTP long-polling
if upgrades are dropped, which works but is slow and chatty. In nginx:

```nginx
location / {
    proxy_pass         http://127.0.0.1:8000;
    proxy_http_version 1.1;
    proxy_set_header   Upgrade $http_upgrade;
    proxy_set_header   Connection "upgrade";
    proxy_set_header   Host $host;
    proxy_read_timeout 7d;      # sockets idle between slide changes
}
```

No `deny` rules are needed. That is the point of the mode.

**Run it as an unprivileged user** with no access to presentation content. The
relay never reads any.

**Rooms are unauthenticated by design.** Anyone holding a room id is a full
participant — see `revelation/SECURITY.md` §1.6. A relay is shared
infrastructure: every install that points at it uses the same namespaces,
separated only by room id. Reveal Remote ids are UUIDv4 and
`presenterLiveRoomId` is 128 random bits, so collisions and guesses are not a
practical concern, but a relay operator can read all traffic passing through.
Run your own if that matters.

**Expect no persistence.** All room state is in memory and is dropped when the
presenter disconnects. Restarting the relay ends every active session.

---

## Verifying a deployment

```bash
curl -s https://relay.example.org/                       # one-line liveness string
curl -s -o /dev/null -w '%{http_code}\n' \
     https://relay.example.org/admin/                    # expect 404
curl -s -o /dev/null -w '%{http_code}\n' \
     https://relay.example.org/package.json              # expect 404
curl -s -o /dev/null -w '%{http_code}\n' \
     https://relay.example.org/@fs/etc/passwd            # expect 404
curl -s 'https://relay.example.org/socket.io/?EIO=4&transport=polling' | head -c 80
                                                         # expect a JSON handshake with "sid"
```

If any of the 404 checks returns content, relay mode is not active. Take the
server off the network before investigating.
