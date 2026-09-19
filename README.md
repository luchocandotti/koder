# koder

A code editor that runs **on the server it edits**. Two PHP files for the backend, one JS file and one CSS file for the frontend. No build step, no framework, no database, no `node_modules`. You open a URL, you type a password, and you are editing the site you are standing on — from a phone, from a tablet, from a borrowed laptop, from anything with a browser.

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
- **Recursive search** across the active root with line/column jumping, plus `:42` to jump to a line in the current file.
- **Trash with an index** (`.koder-trash/.index.json`): anything you delete remembers where it came from and can be restored there.
- **Live preview** of the folder's `index.php` / `index.html` in the second pane, with aggressive cache busting on every referenced asset.
- **Collect** (`collect.php`): concatenates the whole project into a single `project.txt`. That file is meant to be pasted into an LLM — it is how this editor was largely built.
- **Zip export** of any root, **raw download**, drag-a-file-out-of-the-browser.
- **Seven themes**, all of them just a block of CSS custom properties.
- **Touch-first details that nobody ships**: long-press context menus, inertia-free custom scrollbars (the native ones fight CodeMirror's virtual rendering), single-axis scroll locking so the gutter stops chasing the text, a floating toolbar that follows `visualViewport` when the keyboard comes up, and an on-screen-keyboard lock for when a hardware keyboard is attached and iOS refuses to admit it.

## Architecture

```
index.php     gate (auth) + the entire DOM skeleton
head.php      shared <head> for editor and login
login.php     login view, no logic
auth.php      single-user password, sessions, per-IP exponential backoff
api.php       the file system: one endpoint, ?a=<action>
collect.php   standalone: folder -> project.txt
config.php    the only two paths you need to set
app.js        the whole client (~1.4k lines, no imports)
app.css       tokens, layout, themes, CodeMirror theme
.htaccess     no-cache + deny direct access to internal files
```

The API is one file and one switch. Actions: `ls, read, save, search, upload, create, rename, trash, trashlist, restore, purge, indexfor, collect, zipcheck, zip, raw, roots, logout`. Everything is `POST` + JSON except `raw` and `zip`, which have to be navigations because that is how a browser downloads.

State lives in `localStorage` under `editor.session`: open roots, tabs per pane, cursor positions, pane sizes, theme, toggles. There is no server-side state beyond the PHP session.

**Requirements:** PHP 8.0+ (uses `str_contains`, `str_starts_with`, enums of nothing, first-class callables not required), Apache or LiteSpeed for the `.htaccess`, `ZipArchive` if you want zip export. That is it.

## Install

1. Copy this folder into your web root, e.g. `public_html/koder/`.
2. Decide your two paths. Defaults: `KODER_BASE` is the folder containing `koder/`, `KODER_DATA` is `../../koder-data` — outside the web root. To change them, create `config.local.php`:

   ```php
   <?php
   define('KODER_BASE', '/home/you/domains/example.com/public_html');
   define('KODER_DATA', '/home/you/koder-data');
   ```

3. Make sure `KODER_DATA` exists and is writable by PHP, and that it is **not** reachable over HTTP and **not** inside `KODER_BASE`.
4. Open `https://example.com/koder/`. The first screen asks you to set a password (16 characters minimum). There is no username — there is one user, and it is you.
5. Optional: drop your favicons in `koder/img/` (see `head.php`).

Serve it over HTTPS. The session cookie is `Secure`; without TLS you will not stay logged in, which is the correct behaviour.

---

## Danger

Read this part twice. **koder is a remote shell with a nicer face.**

It writes arbitrary files anywhere under `KODER_BASE`. On a PHP host, writing an arbitrary file means executing arbitrary code, which means whoever gets in owns the hosting account: your sites, your databases' credentials, your visitors' traffic, your domain's reputation, your mail. There is no sandbox. There is no undo beyond a trash folder that lives on the same disk.

The only thing between the internet and that power is one password.

**What is in place:**

- `password_hash()` with the default algorithm; the hash lives outside the document root, so the editor itself cannot reach it and delete it to reopen the setup screen.
- Session cookie: `HttpOnly`, `Secure`, `SameSite=Lax`, scoped to the install path, 30 days rolling.
- Per-IP exponential backoff after 5 failed attempts (30s doubling to a 1h ceiling) plus a fixed 1s delay on every failure.
- Origin check on the login POST.
- Anti-CSRF by requiring a custom `X-Koder: 1` header on every mutating request; `GET` can only reach `raw` and `zip`.
- Path confinement through `realpath()` + prefix check on every single path that comes from the client.
- `.htaccess` denies direct access to `auth.php`, `login.php`, `head.php`, `collect.php`, `config.php` and `project.txt`, and writes a deny-all `.htaccess` into the trash folder.

**What is not, and you should know before deploying:**

- **No 2FA, no audit log, no rate limit on the API itself.** One credential, one factor, no record of what was changed or by whom.
- **`.htaccess` is Apache/LiteSpeed only.** On nginx those files are served as plain text unless you write the equivalent `location` blocks yourself. `project.txt` in particular is your entire codebase, publicly readable, including any secret you ever hardcoded.
- **`project.txt` is a loaded gun.** It is generated inside the project folder, it includes `.env` and `.htaccess` by design, and it is one URL away from anyone who guesses the name. It is git-ignored here; keep it that way, and delete it when you are done.
- **CodeMirror loads from a CDN without Subresource Integrity.** A compromised CDN response is a compromised editor with your session attached. Pinning the version helps; self-hosting the assets helps more. Doing that properly is an open issue and a good first contribution.
- **No Content-Security-Policy.** The preview renders your own site inside an `iframe` with `srcdoc`, in the same origin as the editor.
- **The trash is not a backup and the editor is not version control.** Use git. koder is where you type; it is not where your history should live.
- **Broadening `KODER_BASE` broadens the blast radius.** Pointing it at your home directory gives the editor every site on the account, and gives an intruder the same.
- **If your hosting panel, your mail, or your browser is compromised, none of the above matters.**

If you are not comfortable with the sentence *"a single password stands between a stranger and arbitrary code execution on my hosting account"*, do not deploy this. Put it behind a VPN, behind an IP allowlist, behind HTTP Basic Auth as a second layer, or do not put it on the public internet at all. Those are all reasonable. Shipping it bare on a domain you care about, with a short password, is not.

The honest framing: this tool trades a real, quantifiable security surface for the ability to work at all. That trade is only worth making consciously.

---

## Why it looks like this

A few decisions that were not accidents:

**No build step.** The file you read is the file that runs. You can open `app.js` *inside koder itself*, change a line, save, and reload — the entire feedback loop fits inside the tool. A transpiler would have broken that, and with it the only thing that makes the project maintainable from a tablet.

**No dependencies but one.** CodeMirror 5 does the text editing, because writing a text editor is a career, not an afternoon. Everything else — tree, tabs, menus, scrollbars, dialogs, uploads, themes — is written here, in plain DOM, because each of those is fifty lines and a package is a liability with a version number.

**Comments are in prose.** The code explains *why*, not *what*. The weird parts are all weird for a reason (iOS reads `inputmode` only on refocus; a finger never scrolls in a straight line; `contenteditable` versus `textarea` changes who paints the selection). Those reasons are written down where the hack is, because in six months the hack will look like a mistake.

**Touch is not a degraded mouse.** Hover does not exist, right-click does not exist, inertial scrolling fights virtualized rendering, the keyboard eats half the screen and lies about it. Every one of those had to be answered directly instead of hidden behind a media query.

**It is small on purpose.** Roughly 2,500 lines total. Small enough that one person can hold it in their head, which is the only kind of software an individual can actually own. Legibility is a security property too: you can read all of it before you trust it, and you should.

There is an older idea underneath all this. A tool shapes the hand that uses it. Most software asks you to adapt — to its workflow, to its hardware requirements, to its business model — and after a while you stop noticing that the shape of your work is being decided somewhere else. Building your own instrument, even a crude one, is a way of taking that decision back. The limitation that produced koder (no laptop, no terminal, no budget) stopped being an obstacle the moment it became the design brief. That inversion is the interesting part; the editor is just the evidence.

## Contributing

This started as one person's workaround. If you have the same limitation, it is yours now.

Genuinely useful contributions, roughly in order of value:

- **nginx / Caddy deployment notes** and the equivalent of the `.htaccess` rules. Right now a non-Apache install is quietly less safe.
- **Self-hosted CodeMirror assets with SRI**, or a documented vendoring script. Removes the CDN from the trust chain and makes koder work offline-ish.
- **Hardening**: optional TOTP, an IP allowlist, an append-only change log, a CSP that does not break the preview.
- **Git, minimally**: status, add, commit, push against the working directory. Not a full client — just enough that koder stops being a reason to skip version control.
- **Selection and cursor handling on iOS.** It is the weakest part of the experience and it is hard.
- **Internationalisation.** The UI strings were Spanish until this commit; they are now hardcoded English. A small string table would let both exist.
- **Other stacks.** The client is backend-agnostic: anything that answers the same ~18 actions works. A Node, Ruby or Go `api` would let this run where PHP does not.

Open an issue before a large PR so we can agree on the shape. Keep it dependency-free, keep it readable on a small screen, and keep the comments explaining *why*.

## Non-goals

LSP and real IntelliSense. Multi-user and collaboration. Debuggers, terminals, package managers. Being an IDE. koder is a good place to fix things and a decent place to build small ones — anything bigger deserves a real machine, and it is fine to admit that.

## License

Not chosen yet. Until one is added, treat it as "all rights reserved, ask first". MIT is the likely outcome; open an issue if it matters to you.

## Note for anyone upgrading from the Spanish version

Three things were renamed and will not migrate themselves: `recop.php` → `collect.php`, `proyecto.txt` → `project.txt`, and the trash folder `.koder-papelera` → `.koder-trash`. Rescue anything you still want from the old trash before deleting the leftovers by hand. Paths that used to be hardcoded in `api.php` and `auth.php` now come from `config.php`.
