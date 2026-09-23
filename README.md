# koder

A code editor that runs **on the server it edits**. A handful of PHP files for the backend, one JS file and one CSS file for the frontend. No build step, no framework, no database, no `node_modules`. You open a URL, you type a password, and you are editing the site you are standing on — from a phone, from a tablet, from a borrowed laptop, from anything with a browser.

It exists because an iPad is not allowed to have a terminal.

---

## Why

Cheap shared hosting has no SSH. Tablets have no file system you can point a real editor at. Mobile git clients are clumsy, and FTP apps turn a one-character fix into a five-minute ritual: download, edit, upload, refresh, pray. Meanwhile the constraint is not going away — a lot of people, in a lot of places, do their work on a device that the industry considers a consumption device.

Every existing answer asks you to move: get a laptop, get a VPS, get a CI pipeline, get a subscription. koder answers the other way around. If the code lives on the server, put the editor there too. The edit becomes local again — it just happens to be local to the machine that serves the file instead of the one holding the keyboard.

That is the whole idea. Everything else in this repository is the consequence of taking it seriously on a touchscreen.

## What it does

- **File tree** with multiple open project roots side by side, lazy-loaded, drag-and-drop upload (folders included, via the File System API).
- **Two editor panes**, split with a draggable divider. CodeMirror 5 with linked docs, so the same file open in both panes shares history and dirty state.
- **Tabs** with unsaved indicator, restored on reload along with cursor position per file.
- **Syntax checking as you type.** JavaScript is parsed in the browser with acorn; PHP goes to `php -l` on the server. A red dot in the gutter, a dotted underline on the line, and the broken file turns red in the sidebar until you fix it. Saving asks again, right then, and offers to jump to the line instead of writing a file that will 500.
- **Error console** (`Ctrl+J`): every toast that is not a success lands there with a timestamp, including errors from inside the live preview. One tap copies the whole log — which is how you paste a stack trace to whoever is helping you, on a device with no devtools.
- **Recursive search** across the active root with line/column jumping, plus `:42` to jump to a line in the current file. A single hit opens straight away instead of making you tap the list.
- **Multi-select and move**: shift-click for a range, ⌘-click to add one, then Move — which reuses the folder dialog as a destination picker. Folders drag their children along; a parent and its child never move twice.
- **Extract archives on the server**: zip, tar, tar.gz/tgz, tar.bz2, gz, bz2. Path traversal inside the archive is rejected and the uncompressed size is capped before anything is written.
- **Trash with an index** (`.koder-trash/.index.json`): anything you delete remembers where it came from and can be restored there.
- **Live preview** of the folder's `index.php` / `index.html` in the second pane, with aggressive cache busting on every referenced asset, and an injected bridge that forwards the page's own errors to koder's console.
- **Collect** (`collect.php`): concatenates the whole project into a single txt, written to `KODER_DATA/collected/<folder>.txt` and opened in a tab. That file is meant to be pasted into an LLM — it is how this editor was largely built. It lands outside the web root on purpose; see the note in the Danger section.
- **Zip export** of any root, **raw download**, drag-a-file-out-of-the-browser.
- **Seven themes**, all of them just a block of CSS custom properties.
- **Touch-first details that nobody ships**: long-press context menus, inertia-free custom scrollbars (the native ones fight CodeMirror's virtual rendering), single-axis scroll locking so the gutter stops chasing the text, a floating toolbar that follows `visualViewport` when the keyboard comes up, and an on-screen-keyboard lock for when a hardware keyboard is attached and iOS refuses to admit it.
- **Optional two-factor approval** on login — see its own section below.

## Architecture

```
index.php     gate (auth) + the entire DOM skeleton
head.php      shared <head> for editor, login and the waiting screen
login.php     login view, no logic
wait.php      waiting-for-approval view, no logic
check.php     the waiting screen's polling endpoint
auth.php      single-user password, sessions, per-IP backoff, approval requests
api.php       the file system: one endpoint, ?a=<action>
collect.php   standalone: folder -> one txt
config.php    the handful of install-specific constants
app.js        the whole client (~2.3k lines, no imports)
app.css       tokens, layout, themes, CodeMirror theme
.htaccess     no-cache + deny direct access to internal files
```

The API is one file and one switch. Actions: `ls, read, save, lint, search, upload, extract, create, rename, move, trash, trashlist, restore, purge, indexfor, page, collect, zipcheck, zip, raw, roots, logout`. Everything is `POST` + JSON except `raw` and `zip`, which have to be navigations because that is how a browser downloads.

The only things koder writes outside your project are in `KODER_DATA`: the password hash, sessions, rate-limit counters, approval requests and the collected txt files.

State lives in `localStorage` under `editor.session`: open roots, tabs per pane, cursor positions, pane sizes, theme, pinned folders, toggles. There is no server-side state beyond the PHP session and, if you enable it, one pending-approval file.

**Requirements:** PHP 8.0+, Apache or LiteSpeed for the `.htaccess`, `ZipArchive` for zip export/extract, `PharData` for tar archives, `shell_exec` for PHP syntax checking, `curl` for previewing a site served from another host. Every one of those degrades quietly if it is missing — except the `.htaccess`, which does not.

## Install

1. Copy this folder into your web root, e.g. `public_html/koder/`.
2. Set your paths. Defaults: `KODER_BASE` is the folder containing `koder/`, `KODER_DATA` is `../../koder-data`, `KODER_SITE` is `https://` plus the basename of `KODER_BASE`. To change any of them, create `config.local.php`:

   ```php
   <?php
   define('KODER_BASE', '/home/you/domains/example.com/public_html');
   define('KODER_DATA', '/home/you/koder-data');
   define('KODER_SITE', 'https://example.com');
   ```

3. Make sure `KODER_DATA` exists and is writable by PHP, and that it is **not** reachable over HTTP. Keeping it outside `KODER_BASE` as well is stronger: then koder cannot rewrite its own credentials.
4. Open `https://example.com/koder/`. The first screen asks you to set a password (16 characters minimum). There is no username — there is one user, and it is you.
5. Optional: drop your favicons in `koder/img/` (see `head.php`).

Serve it over HTTPS. The session cookie is `Secure`; without TLS you will not stay logged in, which is the correct behaviour.

---

## Two-factor approval

A password is one factor. koder can require a second one: after the password is accepted, the login does **not** open a session. It writes a request and waits for something outside koder to approve it.

Turn it on with `define('KODER_2FA', true);` in `config.local.php`. **It is off by default, and for good reason: with nothing on the other side to approve, turning it on locks you out.** Build the approver first, test it with your hosting file manager open in another tab, and only then leave it on.

### How it works

1. Password correct → `auth.php` writes `KODER_DATA/pending.json` with a random **4-digit code**, the client IP, the user-agent, a timestamp, and the SHA-256 of a nonce. The nonce itself goes to that browser as a cookie.
2. koder shows a waiting screen with the code in large type, polling `check.php` every 2 seconds.
3. Your approver — a page, an app, a script, anything that can read and write that file — shows the request and asks you to confirm.
4. You approve. The approver sets `"ok": true` in the file.
5. `check.php` sees it, verifies the nonce cookie, opens the session, deletes the request, and appends a line to `KODER_DATA/approvals.log`.

Requests expire after 90 seconds (`K_2FA_TTL`) and are single-use.

**The 4-digit code is not decoration.** Without it, someone who has your password can fire a request at the exact moment you are working and you will approve it by reflex. Matching numbers means an approval you did not initiate is visibly wrong before you tap. It is the same reason Microsoft added number matching to its push prompts after push-fatigue attacks.

**The nonce cookie matters too.** Without it, approving would let in whoever asked last — not necessarily you.

### If you do not have a second app

The reference implementation approves from another web app the author already runs on the same hosting account. You almost certainly do not have that one. You have options, roughly in order of effort:

**Write a one-file approver.** The contract is a JSON file, so this is genuinely small. Put it somewhere koder cannot reach (a second domain, a subfolder with its own password, your hosting file manager) and have it:

```php
<?php
$f = '/path/to/koder-data/pending.json';
$d = json_decode(file_get_contents($f), true);

// GET: is there a live request? Show code, IP and user-agent.
if (!$d || $d['at'] + 90 < time()) exit('nothing pending');

// POST with the code echoed back: approve it.
if (($_POST['code'] ?? '') === $d['code']) {
    $d['ok'] = true;
    file_put_contents($f, json_encode($d), LOCK_EX);
}
```

Requiring the code to come back from the client is what turns "I tapped yes" into "I looked at the other screen and it matched". Never expose the `hash` field — it is the only thing tying the request to the browser that made it.

**Approve by hand.** No code at all: open `pending.json` in your hosting's file manager, compare the code, change `false` to `true`, save. Clumsy, but it proves the mechanism works before you build anything, and it is a perfectly good fallback if your approver ever breaks.

**Use a phone notification instead of a page.** Have `k_pending_new()` also POST the code to [ntfy](https://ntfy.sh), Telegram, or Pushover, and approve from a tiny endpoint the notification links to. Same file contract, nicer ergonomics, one more third party in the trust chain.

**Or skip the push model entirely.** These need no second app at all:

- **TOTP** (Google Authenticator / 1Password): ~40 lines of PHP, no dependencies — the algorithm is HMAC-SHA1 over a counter plus base32. Works offline, works when the server is the only thing up. It does not show you *who* is trying to get in, which the push model does. This is the option most people should pick, and a PR adding it would be welcome.
- **IP allowlist** in `.htaccess` or `config.local.php`. Free, instant, and useless the day you need to fix something from a hotel.
- **HTTP Basic Auth** in front of the whole folder, with a different password than koder's. Crude, effective, supported by every browser and every host.
- **A VPN or a Cloudflare Access policy** in front of the URL. The strongest option, and the one that requires the most setup elsewhere.

### The limit

This protects the *door*, not the room. Once inside koder you can edit `auth.php` and turn the second factor off for next time. That is unavoidable in any 2FA whose code is editable from the app it protects; keeping `KODER_DATA` outside `KODER_BASE` at least stops the credentials themselves from being rewritten. The barrier is still where it matters: on the way in.

---

## Danger

Read this part twice. **koder is a remote shell with a nicer face.**

It writes arbitrary files anywhere under `KODER_BASE`. On a PHP host, writing an arbitrary file means executing arbitrary code, which means whoever gets in owns the hosting account: your sites, your databases' credentials, your visitors' traffic, your domain's reputation, your mail. There is no sandbox. There is no undo beyond a trash folder that lives on the same disk.

**What is in place:**

- `password_hash()` with the default algorithm; the hash lives outside the document root.
- Session cookie: `HttpOnly`, `Secure`, `SameSite=Lax`, scoped to the install path, 30 days rolling.
- Per-IP exponential backoff after 5 failed attempts (30s doubling to a 1h ceiling) plus a fixed 1s delay on every failure.
- Origin check on the login POST.
- Optional second factor with number matching and a nonce bound to the requesting browser (see above).
- An append-only approval log in `KODER_DATA/approvals.log` — every request and every approval, with IP, user-agent and time.
- Anti-CSRF by requiring a custom `X-Koder: 1` header on every mutating request; `GET` can only reach `raw` and `zip`.
- Path confinement through `realpath()` + prefix check on every single path that comes from the client; archive extraction rejects `..` entries and caps the uncompressed size.
- `.htaccess` denies direct access to `auth.php`, `login.php`, `head.php`, `wait.php`, `collect.php` and `config.php`, and writes a deny-all `.htaccess` into the trash folder.

**What is not, and you should know before deploying:**

- **The second factor is opt-in and needs something you build.** Out of the box this is still one password.
- **No rate limit on the API itself**, and the audit log covers logins, not edits. Nothing records which file changed, or to what.
- **`.htaccess` is Apache/LiteSpeed only.** On nginx those files are served as plain text unless you write the equivalent `location` blocks yourself — `config.php` and the trash folder included.
- **The collected txt is your whole codebase in one file.** It includes `.env` and `.htaccess` by design. Earlier versions wrote it next to the code, where it was one guessed URL away from anyone — it now goes to `KODER_DATA/collected/`, which is not served over the web at all. Do not move it back into a public folder to make it easier to reach, and delete the old `project.txt` files those earlier versions left behind.
- **`lint` runs `shell_exec('php -n -l …')`.** The input is a temp file and the path is escaped, but if shelling out at all is unacceptable in your threat model, delete that action — JavaScript checking keeps working without it.
- **CodeMirror and acorn load from a CDN without Subresource Integrity.** A compromised CDN response is a compromised editor with your session attached. Pinning the version helps; self-hosting the assets helps more. Doing that properly is an open issue and a good first contribution.
- **No Content-Security-Policy.** The preview renders your own site inside an `iframe` with `srcdoc`, in the same origin as the editor, and injects a script into it on purpose.
- **The trash is not a backup and the editor is not version control.** Use git. koder is where you type; it is not where your history should live.
- **Broadening `KODER_BASE` broadens the blast radius.** Pointing it at your home directory gives the editor every site on the account, and gives an intruder the same.
- **If your hosting panel, your mail, or your browser is compromised, none of the above matters.**

If you are not comfortable with the sentence *"a single password stands between a stranger and arbitrary code execution on my hosting account"*, do not deploy this without a second factor, an allowlist, or a VPN in front. Shipping it bare on a domain you care about, with a short password, is not a reasonable trade.

The honest framing: this tool trades a real, quantifiable security surface for the ability to work at all. That trade is only worth making consciously.

---

## The interface, and why it is shaped that way

Most of these exist because a finger is not a mouse and a tablet has no second window.

**The sidebar is a picker, not just a tree.** Tapping a folder makes it the target for "new file", "new folder" and uploads, without changing which root is active — the active root only follows you if you tap into a different tree. Creating things where you are looking turns out to be the whole ergonomic difference on a small screen.

**Multi-select with a keyboard, long-press without one.** Shift-click selects a range, ⌘-click toggles one, a plain click clears. Long press (460ms, cancelled if the finger drifts 8px) opens the same context menu that right-click opens on desktop.

**Move reuses the open-folder dialog.** There is no drag-to-a-folder-you-cannot-see on a phone, so "Move" opens the browser you already know, in *picking* mode: the upload button and the recent list disappear, and the confirm button says `move 3 items to <folder>` instead of `open`.

**Pinned folders.** Long press any folder in the dialog to pin it: it floats to the top of every listing and shows in bold with a green chevron. The pin icon fills in when it is already pinned. Pins live in `localStorage`, not on the server — they are about your habits, not the project.

**Folding and indent guides.** `Ctrl+Q` folds the block under the cursor, `Ctrl+Shift+Q` folds or unfolds everything. Folded regions collapse to `…`, and the gutter arrow turns green so a fold never hides code silently. Indent guides are one hairline per level, drawn by each line itself; blank lines inherit the shallower of their two neighbours so the guides do not jump across empty space.

**Errors are visible in three places at once.** The gutter dot (tap it on a touchscreen — there is no hover — and the message comes up as a toast), the dotted underline, and the file's name going red in the tree. That last one matters most: you can see that a file three folders down is broken without opening it.

**The error console is a panel, not an alert.** It shares its shell with the search panel, keeps the last 300 entries with timestamps, and the *copy* link puts the whole thing on the clipboard. Preview errors arrive prefixed `preview ·`, including failed asset loads and rejected `play()` calls, because a blank iframe tells you nothing by itself.

**Tidy up (`Ctrl+Shift+R`).** After enough dragging, the layout ends up crooked. This puts the sidebar back, opens and clears the search panel, scrolls the tree home, and resets every pane to its default size — without touching a single open tab.

**The mobile bar hides things inside other things.** Redo lives inside a long press on undo (and shows for 5 seconds). The keyboard button toggles the on-screen keyboard lock, and a long press summons the keyboard anyway. On a phone the whole bar floats, can be swiped to the top or bottom edge, and folds into a single chevron when it is in the way.

**Toasts carry state, not just text.** A spinner for work in progress, amber with a live percentage for uploads, green for success. Anything without a kind is an error — and that is exactly the rule that decides what goes to the console.

**The empty pane talks back.** Fourteen programmer jokes, one at random. It is the only frivolous thing in the codebase and it stays.

---

## Why it looks like this

A few decisions that were not accidents:

**No build step.** The file you read is the file that runs. You can open `app.js` *inside koder itself*, change a line, save, and reload — the entire feedback loop fits inside the tool. A transpiler would have broken that, and with it the only thing that makes the project maintainable from a tablet.

**Almost no dependencies.** CodeMirror 5 does the text editing, because writing a text editor is a career, not an afternoon; acorn parses JavaScript, because writing a parser is worse. Everything else — tree, tabs, menus, scrollbars, dialogs, uploads, themes, folding UI — is written here, in plain DOM, because each of those is fifty lines and a package is a liability with a version number.

**Comments are in prose.** The code explains *why*, not *what*. The weird parts are all weird for a reason (iOS reads `inputmode` only on refocus; a finger never scrolls in a straight line; `contenteditable` versus `textarea` changes who paints the selection). Those reasons are written down where the hack is, because in six months the hack will look like a mistake.

**Touch is not a degraded mouse.** Hover does not exist, right-click does not exist, inertial scrolling fights virtualized rendering, the keyboard eats half the screen and lies about it. Every one of those had to be answered directly instead of hidden behind a media query.

**It is small on purpose.** Roughly 3,000 lines total. Small enough that one person can hold it in their head, which is the only kind of software an individual can actually own. Legibility is a security property too: you can read all of it before you trust it, and you should.

There is an older idea underneath all this. A tool shapes the hand that uses it. Most software asks you to adapt — to its workflow, to its hardware requirements, to its business model — and after a while you stop noticing that the shape of your work is being decided somewhere else. Building your own instrument, even a crude one, is a way of taking that decision back. The limitation that produced koder (no laptop, no terminal, no budget) stopped being an obstacle the moment it became the design brief. That inversion is the interesting part; the editor is just the evidence.

## Contributing

This started as one person's workaround. If you have the same limitation, it is yours now.

Genuinely useful contributions, roughly in order of value:

- **TOTP as a built-in second factor.** The approval model needs a companion app; TOTP needs nothing. Both should exist, sharing the same gate.
- **nginx / Caddy deployment notes** and the equivalent of the `.htaccess` rules. Right now a non-Apache install is quietly less safe.
- **Self-hosted CodeMirror assets with SRI**, or a documented vendoring script. Removes the CDN from the trust chain and makes koder work offline-ish.
- **More hardening**: an edit log, a CSP that does not break the preview, a rate limit on the API.
- **Git, minimally**: status, add, commit, push against the working directory. Not a full client — just enough that koder stops being a reason to skip version control.
- **Selection and cursor handling on iOS.** It is the weakest part of the experience and it is hard.
- **Internationalisation.** The UI strings are hardcoded English. A small string table would let other languages exist.
- **Other stacks.** The client is backend-agnostic: anything that answers the same ~21 actions works. A Node, Ruby or Go `api` would let this run where PHP does not.

Open an issue before a large PR so we can agree on the shape. Keep it dependency-free, keep it readable on a small screen, and keep the comments explaining *why*.

## Non-goals

LSP and real IntelliSense. Multi-user and collaboration. Debuggers, terminals, package managers. Being an IDE. koder is a good place to fix things and a decent place to build small ones — anything bigger deserves a real machine, and it is fine to admit that.

## License

AGPL-3.0. See `LICENSE`.

The Affero variant on purpose: koder runs on a server and is used over the network, which plain GPL does not count as distribution. Under AGPL, if you run a modified koder for others, you share the changes — the same deal you got here.

## Note for anyone upgrading from the Spanish version

Two things were renamed and will not migrate themselves: `recop.php` → `collect.php` and the trash folder `.koder-papelera` → `.koder-trash`. The collected txt moved too: it used to be `proyecto.txt` inside the project, and now lands in `KODER_DATA/collected/`. Delete the old ones by hand — they are the exposed copies — and rescue anything you still want from the old trash first. Paths that used to be hardcoded in `api.php` and `auth.php` now come from `config.php`, including the site origin the preview fetches from.
