/* ───────────────────────────────────────────────
	 editor — app.js
	 ─────────────────────────────────────────────── */

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

addEventListener('error', e => toast('js: ' + e.message));
addEventListener('unhandledrejection', e => toast('js: ' + (e.reason?.message || e.reason)));

const API = 'api.php';
// every request to api.php goes through here: anti-CSRF header + expired session → login
async function kfetch(url, opts = {}) {
	const r = await fetch(url, { ...opts, headers: { 'X-Koder': '1', ...opts.headers } });
	if (r.status === 401) { location.reload(); throw new Error('session expired'); }
	return r;
}
async function api(action, body = {}) {
	const r = await kfetch(`${API}?a=${action}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ ...body, a: action, ...(action === 'ls' && { hidden: S.hidden }) })
	});
	const txt = await r.text();
	let d;
	try { d = JSON.parse(txt); }
	catch { throw new Error(`HTTP ${r.status} — ${txt.slice(0, 300) || '(empty response)'}`); }
	if (d.error) throw new Error(d.error);
	return d;
}

/* ── state ─────────────────────────────────── */

const LS = 'editor.session';
const S = {
	roots: [],
	active: '',
	recent: [],
	wrap: false,
	sidebar: true,
	search: false,
	lockKb: false,
	hidden: false,
	theme: 'citric',
	sizes: { sidebar: 224, pane: 45, search: 220 },
	cursors: {},
	focus: 0
};
Object.assign(S, JSON.parse(localStorage.getItem(LS) || '{}'));

// old sessions stored a single root
if (typeof S.root === 'string' && S.root) { S.roots = [S.root]; S.active = S.root; }
delete S.root;
if (!S.roots.includes(S.active)) S.active = S.roots[0] || '';

// the root a path belongs to (roots never overlap: only one can contain it)
const under = (p, r) => p === r || p.startsWith(r + '/');
const rootOf = p => S.roots.find(r => under(p, r)) || S.active;

// returns the conflicting root, or undefined: either they are siblings, or it does not open
const overlaps = p => S.roots.find(r => under(p, r) || under(r, p));

const base = p => p.replace(/\/$/, '').split('/').pop() || p;

// the .active class only matters with more than one folder
const multi = () => S.roots.length > 1;

const FILES = new Map();   // path -> { master, savedGen, dirty, inUse }
const PANES = [];          // { el, tabsEl, cm, tabs:[{path,name,doc}], active }
const OPEN_DIRS = new Set();

function pickDir(path) {
	S.active = path;
	$$('#tree .row.dir').forEach(r => r.classList.toggle('picked', r.dataset.path === path));
}
const DIRS = new Map();   // path -> { el, kids, row, depth }

function persist() {
	localStorage.setItem(LS, JSON.stringify({
		roots: S.roots, active: S.active, recent: S.recent, wrap: S.wrap, sidebar: S.sidebar,
		search: S.search, lockKb: S.lockKb, hidden: S.hidden, theme: S.theme, sizes: S.sizes, cursors: S.cursors,
		tabs: PANES.map(p => ({ paths: p.tabs.filter(t => !t.virtual).map(t => t.path), active: p.active }))
	}));
}

/* ── icons per language ────────────────────── */

const ICONS = {
	php:  ['ph', '#8099d4'], html: ['ht', '#c4763a'], htm: ['ht', '#c4763a'],
	js:   ['js', '#c4943a'], mjs:  ['js', '#c4943a'], cjs: ['js', '#c4943a'],
	jsx:  ['jx', '#c4943a'], ts:   ['ts', '#8099d4'], tsx: ['tx', '#8099d4'],
	css:  ['cs', '#6f9bb5'], scss: ['sc', '#6f9bb5'], sass:['sa', '#6f9bb5'], less:['le', '#6f9bb5'],
	json: ['{}', '#8a8a80'], md:   ['md', '#c8c6bc'], markdown:['md', '#c8c6bc'],
	txt:  ['tx', '#6f6d64'], sql:  ['sq', '#a98fc4'], rb:  ['rb', '#c45a5a'], erb: ['rb', '#c45a5a'],
	py:   ['py', '#7aaa6a'], sh:   ['sh', '#7aaa6a'], bash:['sh', '#7aaa6a'],
	yml:  ['yl', '#a98fc4'], yaml: ['yl', '#a98fc4'], xml: ['xm', '#c4763a'],
	svg:  ['sv', '#7aaa6a'], png:  ['im', '#7aaa6a'], jpg: ['im', '#7aaa6a'], jpeg:['im', '#7aaa6a'],
	gif:  ['im', '#7aaa6a'], webp: ['im', '#7aaa6a'], avif:['im', '#7aaa6a'],
	woff: ['aa', '#6f6d64'], woff2:['aa', '#6f6d64'], ttf: ['aa', '#6f6d64'], otf: ['aa', '#6f6d64'],
	env:  ['env','#c4943a'], lock: ['lk', '#6f6d64'], log: ['lg', '#6f6d64']
};
const iconFor = ext => ICONS[ext] || ['··', '#4a4a46'];

const MODES = {
	php: 'application/x-httpd-php', html: 'htmlmixed', htm: 'htmlmixed', vue: 'htmlmixed',
	js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
	ts: 'text/typescript', tsx: 'text/typescript', json: { name: 'javascript', json: true },
	css: 'css', scss: 'text/x-scss', less: 'text/x-less',
	md: 'markdown', markdown: 'markdown', sql: 'sql', rb: 'ruby', erb: 'application/x-erb',
	yml: 'yaml', yaml: 'yaml', xml: 'xml', svg: 'xml', py: 'python', htaccess: null, txt: null
};
const modeFor = ext => MODES[ext] ?? null;

/* ── autocomplete ──────────────────────────── */

const PHP_WORDS = ('abstract array break callable case catch class clone const continue declare default do echo else elseif empty enum extends final finally fn for foreach function global if implements include include_once instanceof interface isset list match namespace new print private protected public readonly require require_once return static switch throw trait try unset use var while yield ' +
	'array_filter array_key_exists array_keys array_map array_merge array_reduce array_slice array_values count implode in_array json_decode json_encode sprintf printf str_contains str_replace str_starts_with strlen strpos strtolower strtoupper substr trim rtrim ltrim preg_match preg_replace preg_split file_get_contents file_put_contents fopen fclose is_array is_dir is_file isset htmlspecialchars number_format date time usort uasort sort ksort ' +
	'$_GET $_POST $_SERVER $_SESSION $_FILES $_COOKIE $this true false null').split(/\s+/);

function wordHint(cm, extra = []) {
	const cur = cm.getCursor(), line = cm.getLine(cur.line);
	let start = cur.ch;
	while (start && /[\w$_-]/.test(line.charAt(start - 1))) start--;
	const pre = line.slice(start, cur.ch);
	if (pre.length < 1) return null;

	const words = new Set(extra);
	(cm.getValue().match(/[$A-Za-z_][\w$-]{1,}/g) || []).forEach(w => words.add(w));
	const low = pre.toLowerCase();
	const list = [...words]
		.filter(w => w !== pre && w.toLowerCase().startsWith(low))
		.sort((a, b) => a.length - b.length || a.localeCompare(b))
		.slice(0, 40);
	if (!list.length) return null;
	return { list, from: CodeMirror.Pos(cur.line, start), to: cur };
}

function hint(cm) {
	let name = '';
	try {
		const tok = cm.getTokenAt(cm.getCursor());
		name = (CodeMirror.innerMode(cm.getMode(), tok.state).mode.name || '').toLowerCase();
	} catch { /* mode without state */ }

	try {
		if (name === 'xml' || name === 'html' || name === 'htmlmixed') return CodeMirror.hint.html(cm) || wordHint(cm);
		if (name === 'css') return CodeMirror.hint.css(cm) || wordHint(cm);
		if (name === 'javascript') return CodeMirror.hint.javascript(cm) || wordHint(cm);
	} catch { /* a mode's own hint can blow up on odd files */ }

	if (name === 'php' || name === 'clike') return wordHint(cm, PHP_WORDS);
	return wordHint(cm);
}

function maybeHint(cm, change) {
	if (cm.state.completionActive) return;
	if (change.origin !== '+input') return;
	const t = change.text[0];
	if (!t || !/[\w$<.\-@]/.test(t)) return;
	cm.showHint({ hint, completeSingle: false, closeOnUnfocus: true });
}

/* ── scrollbar without inertia ─────────────── */

function attachScrollbar(pane) {
	const syncs = [axisBar(pane, 'y'), axisBar(pane, 'x')];
	const sync = () => syncs.forEach(s => s());
	pane.syncBar = sync;
	pane.cm.on('scroll', sync);
	pane.cm.on('refresh', sync);
	pane.cm.on('changes', sync);
}

function axisBar(pane, ax) {
	const X = ax === 'x';
	const bar = document.createElement('div');
	bar.className = X ? 'hbar' : 'vbar';
	const thumb = document.createElement('div');
	thumb.className = X ? 'hthumb' : 'vthumb';
	bar.appendChild(thumb);
	$('.editor', pane.el).appendChild(bar);

	const geom = () => {
		const i = pane.cm.getScrollInfo();
		const total = X ? i.width : i.height;
		const view  = X ? i.clientWidth : i.clientHeight;
		const track = X ? bar.clientWidth : bar.clientHeight;
		return { pos: X ? i.left : i.top, range: total - view, track,
		         th: Math.max(30, track * view / Math.max(1, total)) };
	};

	const sync = () => {
		const { pos, range, track, th } = geom();
		if (range <= 2) { bar.classList.remove('vis'); return; }
		bar.classList.add('vis');
		thumb.style[X ? 'width' : 'height'] = th + 'px';
		const d = (track - th) * (pos / range);
		thumb.style.transform = X ? `translateX(${d}px)` : `translateY(${d}px)`;
	};

	const jump = c => {
		const { range, track, th } = geom();
		if (range <= 2) return;
		const r = pane.el.getBoundingClientRect();
		const off = c - (X ? bar.getBoundingClientRect().left : bar.getBoundingClientRect().top) - th / 2;
		const v = Math.max(0, Math.min(1, off / (track - th))) * range;
		X ? pane.cm.scrollTo(v, null) : pane.cm.scrollTo(null, v);
	};

	let dragging = false;
	const block = e => e.preventDefault();
	const move = e => { if (dragging) { e.preventDefault(); jump(X ? e.clientX : e.clientY); } };
	const end = () => {
		if (!dragging) return;
		dragging = false;
		bar.classList.remove('on');
		document.body.classList.remove('bardrag');
		document.removeEventListener('pointermove', move);
		document.removeEventListener('pointerup', end);
		document.removeEventListener('pointercancel', end);
		document.removeEventListener('touchmove', block);
	};

	bar.addEventListener('touchstart', block, { passive: false });
	bar.addEventListener('pointerdown', e => {
		e.preventDefault();
		e.stopPropagation();
		dragging = true;
		bar.classList.add('on');
		document.body.classList.add('bardrag');
		jump(X ? e.clientX : e.clientY);
		document.addEventListener('pointermove', move);
		document.addEventListener('pointerup', end);
		document.addEventListener('pointercancel', end);
		document.addEventListener('touchmove', block, { passive: false });
	});

	return sync;
}

/* ── cheat sheet ───────────────────────────── */

const CHEAT_PATH = 'koder:shortcuts.md';

const CHEAT = `# koder — shortcuts

All of them with **Control**. On an Apple keyboard, Command does the same,
except copy / cut / paste, which only work with Control.

| key        | action                             |
| ---------- | ---------------------------------- |
| C / X / V  | copy, cut, paste                   |
| Z / Y      | undo, redo                         |
| A          | select all                         |
| S          | save                               |
| Shift + S  | export the folder as a zip         |
| F          | search (bottom panel)              |
| B          | show / hide the sidebar            |
| K          | soft wrap or clipped lines         |
| O          | open folder                        |
| Shift + T  | open folder (same dialog)          |
| Shift + A  | this sheet                         |
| Shift + K  | lock / unlock the on-screen keyboard |
| Shift + P  | preview the folder's index         |
| W          | close tab                          |
| N          | new file in the root               |
| Shift + N  | new folder in the root             |
| D          | open / close the second pane       |
| , / .      | previous / next tab                |
| E          | jump to the other pane             |
| G          | go to a line                       |
| Space      | autocomplete                       |
| Escape     | close the search panel or dialog   |

## Without a keyboard

Long press on a file or folder: rename, new file, new folder,
convert indentation to tabs, move to trash.

Long press on the empty part of the sidebar: create in the root.

Long press on "trash": empty it.

The bar on the right of the editor drags without inertia.

In the search panel, a colon and a number (:42) jump to that line of the
active file. Enter confirms and gives focus back to the editor.

## Notes

This sheet is a virtual tab: it does not exist on disk, it is not saved
and it does not come back by itself on reload. Shift + A brings it back.
`;

function openCheatsheet() {
	const pane = PANES[S.focus];
	let tab = pane.tabs.find(t => t.path === CHEAT_PATH);
	if (!tab) {
		let f = FILES.get(CHEAT_PATH);
		if (!f) {
			const master = CodeMirror.Doc(CHEAT, 'markdown');
			f = { master, savedGen: master.changeGeneration(true), dirty: false, inUse: false, virtual: true };
			FILES.set(CHEAT_PATH, f);
		}
		const doc = f.inUse ? f.master.linkedDoc({ sharedHist: true }) : f.master;
		f.inUse = true;
		tab = { path: CHEAT_PATH, name: 'shortcuts.md', doc, virtual: true };
		pane.tabs.push(tab);
	}
	activate(pane, tab);
	pane.cm.focus();
}

/* ── one axis per gesture ──────────────────── */
   // a finger never travels perfectly straight: diagonal scrolling
   // leaves the line-number column chasing the text. The first 6px
   // of the gesture pick the axis and the other one freezes until release.

function lockAxis(cm) {
	const sc = cm.getScrollerElement();
	let x0, y0, top, left, axis;

	sc.addEventListener('touchstart', e => {
		if (e.touches.length !== 1) return;
		x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
		({ top, left } = cm.getScrollInfo());
		axis = null;
	}, { passive: true });

	sc.addEventListener('touchmove', e => {
		if (e.touches.length !== 1) return;
		const dx = e.touches[0].clientX - x0;
		const dy = e.touches[0].clientY - y0;
		if (!axis) {
			if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
			axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
		}
		if (axis === 'x') cm.scrollTo(null, top);
		else cm.scrollTo(left, null);
	}, { passive: true });

	sc.addEventListener('touchend', () => { axis = null; }, { passive: true });
}

/* ── editor panes ───────────────────────────── */

const EMPTIES = [
	'works on my machine',
	'// TODO: do the damn thing',
	'undefined is not a function',
	'waiting for the robot to answer',
	'have you tried turning it off and on again?',
	'git blame points at nobody',
	'if it works, do not touch it',
	'Uncaught TypeError: cannot read properties of null',
	'it was not a bug, it was a feature',
	'commit -m "please work"',
	'99 little bugs in the code',
	'it is the cache, obviously',
	'pushed straight to main',
	'it worked yesterday'
];
const rollEmpty = el => {
	$('.empty', el).textContent = EMPTIES[Math.floor(Math.random() * EMPTIES.length)];
};

function buildPane(i) {
	const el = $(`.pane[data-pane="${i}"]`);
	const cm = CodeMirror($('.editor', el), {
		theme: 'claude',
		lineNumbers: true,
		lineWrapping: S.wrap,
		autoCloseBrackets: true,
		autoCloseTags: true,
		matchBrackets: true,
		styleActiveLine: true,
		indentUnit: 2,
		tabSize: 2,
		indentWithTabs: true,
		smartIndent: true,
		viewportMargin: 60,
		readOnly: true,     // with no file open you cannot type
		dragDrop: false,    // the drop is handled by the pane, not by CodeMirror
		inputStyle: matchMedia('(any-hover:hover)').matches ? 'textarea' : 'contenteditable',
		extraKeys: {
			'Ctrl-Space': c => c.showHint({ hint, completeSingle: false }),
			'Ctrl-Z': c => c.undo(),
			'Ctrl-Y': c => c.redo(),
			'Shift-Ctrl-Z': c => c.redo(),
			'Ctrl-A': c => c.execCommand('selectAll'),
			'Cmd-/': c => c.toggleComment(),
			'Ctrl-/': c => c.toggleComment(),
			'Tab': c => c.somethingSelected() ? c.indentSelection('add') : c.replaceSelection('\t', 'end'),
			'Shift-Tab': c => c.indentSelection('subtract')
		}
	});
	cm.on('inputRead', maybeHint);
	cm.on('beforeChange', tabsOnPaste);
	applyKbLock({ cm });
	cm.on('focus', () => setFocus(i));
	cm.on('cursorActivity', () => trackCursor(i));
	lockAxis(cm);

	const iframe = document.createElement('iframe');
	iframe.className = 'preview-frame';
	iframe.hidden = true;
	$('.editor', el).appendChild(iframe);
	el.addEventListener('pointerdown', () => setFocus(i));

	el.addEventListener('dragover', e => {
		if (![...e.dataTransfer.types].includes('application/x-editor-file')) return;
		e.preventDefault(); el.classList.add('dragover');
	});
	el.addEventListener('dragleave', () => el.classList.remove('dragover'));
	el.addEventListener('drop', e => {
		const p = e.dataTransfer.getData('application/x-editor-file');
		el.classList.remove('dragover');
		if (!p) return;
		e.preventDefault();
		openFile(p, i);
	});

	const pane = { el, tabsEl: $('.tabs', el), cm, iframe, tabs: [], active: null };
	PANES[i] = pane;
	attachScrollbar(pane);
	rollEmpty(el);
	return pane;
}

function setFocus(i) {
	S.focus = i;
	PANES.forEach((p, n) => p.el.classList.toggle('focused', n === i));
	markTree();
}

let cursorTimer;
function trackCursor(i) {
	const pane = PANES[i];
	if (!pane?.active) return;
	if (pane.tabs.find(t => t.path === pane.active)?.virtual) return;
	const pos = pane.cm.getCursor();
	S.cursors[pane.active] = { line: pos.line, ch: pos.ch };
	clearTimeout(cursorTimer);
	cursorTimer = setTimeout(persist, 400);
}

function fileEntry(path, content) {
	let f = FILES.get(path);
	if (f) return f;
	const master = CodeMirror.Doc(content, modeFor(path.split('.').pop().toLowerCase()));
	f = { master, savedGen: master.changeGeneration(true), dirty: false, inUse: false };
	master.on('change', () => {
		const d = !master.isClean(f.savedGen);
		if (d !== f.dirty) { f.dirty = d; PANES.forEach(renderTabs); }
	});
	FILES.set(path, f);
	return f;
}

async function openFile(path, paneIdx = S.focus, line = null, sel = null) {
	if (IMG_RX.test(path)) return openImage(path);
	const pane = PANES[paneIdx] || PANES[0];
	if (pane.el.hidden) toggleSplit(true);

	let tab = pane.tabs.find(t => t.path === path);
	let isNew = false;
	if (!tab) {
		isNew = true;
		let f = FILES.get(path);
		if (!f) {
			let d;
			try { d = await api('read', { path }); }
			catch (e) { return toast(e.message); }
			f = fileEntry(path, d.content);
		}
		const doc = f.inUse ? f.master.linkedDoc({ sharedHist: true, mode: f.master.getMode() }) : f.master;
		f.inUse = true;
		tab = { path, name: path.split('/').pop(), doc };
		pane.tabs.push(tab);
	}
	activate(pane, tab);
	if (line == null && isNew && S.cursors[path]) {
		const pos = S.cursors[path];
		pane.cm.setCursor(pos);
		pane.cm.scrollIntoView(pos, 120);
	}
	if (line != null) {
		if (sel) {
			const parts = sel.q.split('\n');
			const from = { line: line - 1, ch: sel.col };
			const to = parts.length === 1
				? { line: line - 1, ch: sel.col + parts[0].length }
				: { line: line - 1 + parts.length - 1, ch: parts[parts.length - 1].length };
			pane.cm.setSelection(from, to);
			pane.cm.scrollIntoView({ from, to }, 90);
		} else {
			pane.cm.setCursor({ line: line - 1, ch: 0 });
			pane.cm.scrollIntoView({ line: line - 1, ch: 0 }, 120);
		}
	}
	pane.cm.focus();
	setFocus(PANES.indexOf(pane));
	markTree();
	persist();
}

function activate(pane, tab) {
	pane.active = tab.path;
	pane.el.classList.add('has-file');

	if (tab.preview) {
		pane.iframe.srcdoc = tab.html;
		pane.iframe.hidden = false;
	} else {
		pane.iframe.hidden = true;
		pane.cm.swapDoc(tab.doc);
		pane.cm.setOption('readOnly', !!tab.virtual);
		pane.cm.refresh();
	}

	renderTabs(pane);
	requestAnimationFrame(() => pane.syncBar?.());
	markTree();
}

async function closeTab(pane, path) {
	const i = pane.tabs.findIndex(t => t.path === path);
	if (i < 0) return;
	const tab = pane.tabs[i];
	const f = FILES.get(path);
	if (f?.dirty) {
		const ok = await confirmBox(`Close "${tab.name}" without saving?`, 'Close');
		if (!ok) return;
		f.dirty = false;
	}
	if (f && tab.doc !== f.master) f.master.unlinkDoc(tab.doc);
	pane.tabs.splice(i, 1);

	const stillOpen = PANES.some(p => p.tabs.some(t => t.path === path));
	if (f && !stillOpen) { f.inUse = false; if (!f.dirty) FILES.delete(path); }

	if (path === PREVIEW_TAB && pane === PANES[1]) {
		pane.active = null;
		if (!pane.el.hidden) toggleSplit(false);
		return;
	}

	if (pane.active === path) {
		const next = pane.tabs[i] || pane.tabs[i - 1];
		if (next) activate(pane, next);
		else {
			pane.active = null;
			pane.cm.swapDoc(CodeMirror.Doc(''));
			pane.iframe.hidden = true;
			pane.cm.setOption('readOnly', true);
			pane.el.classList.remove('has-file');
			rollEmpty(pane.el);
			renderTabs(pane);
		}
	} else renderTabs(pane);
	markTree();
	persist();
	maybeExpandPreview();
}

// the prefix is not stored on the tab: it is computed when painting, so it
// appears and disappears on its own as you open or close folders
function tabLabel(t) {
	if (!multi() || t.virtual) return t.name;
	const r = S.roots.find(x => under(t.path, x));
	return r ? `<span class="tabroot">${base(r)}/</span>${t.name}` : t.name;
}

function renderTabs(pane) {
	pane.tabsEl.innerHTML = '';
	for (const t of pane.tabs) {
		const f = FILES.get(t.path);
		const el = document.createElement('div');
		el.className = 'tab' + (t.path === pane.active ? ' active' : '') + (f?.dirty ? ' dirty' : '');
		el.draggable = true;
		el.title = t.path;

		const icon = t.preview && !t.img
			? `<span class="ico prev-ico"><svg viewBox="0 2 24 24"><circle cx="12" cy="12" r="7.5"/></svg></span>`
			: (([label, color]) => `<span class="ico" style="color:${color}">${label}</span>`)(iconFor(t.name.split('.').pop().toLowerCase()));

		el.innerHTML = icon +
				`<span class="label">${tabLabel(t)}</span><span class="dot"></span><span class="x">×</span>`;

		el.addEventListener('mousedown', e => { if (e.button === 1) { e.preventDefault(); closeTab(pane, t.path); } });
		el.addEventListener('click', e => {
			if (e.target.classList.contains('x')) return closeTab(pane, t.path);
			activate(pane, t);
			if (!t.preview) pane.cm.focus();
		});
		el.addEventListener('dragstart', e => {
			e.dataTransfer.setData('application/x-editor-file', t.path);
			e.dataTransfer.setData('text/plain', t.path);
			e.dataTransfer.effectAllowed = 'copyMove';
		});
		pane.tabsEl.appendChild(el);
	}
}

function toB64(str) {
	const bytes = new TextEncoder().encode(str);
	let bin = '';
	const chunk = 0x8000;
	for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
	return btoa(bin);
}

async function saveActive() {
	const pane = PANES[S.focus];
	if (!pane?.active) return;
	if (pane.tabs.find(t => t.path === pane.active)?.virtual) return toast('this is a reference sheet');
	const f = FILES.get(pane.active);
	try {
		await api('save', { path: pane.active, b64: toB64(f.master.getValue()) });
		f.savedGen = f.master.changeGeneration(true);
		f.dirty = false;
		PANES.forEach(renderTabs);
		toast('saved  ' + pane.active.split('/').pop(), 'ok');
	} catch (e) { toast(e.message); }
}

/* ── export folder ─────────────────────────── */

async function exportFolder() {
	const root = S.active;
	if (!root) return toast('no folder open');
	try { await api('zipcheck', { path: root }); }
	catch (e) { return toast(e.message); }
	toast('building ' + base(root) + '.zip…');
	location.href = `${API}?a=zip&path=${encodeURIComponent(root)}`;
}

/* ── collect the code ──────────────────────── */

async function collectCode() {
	const row = $('#collectrow');
	const root = S.active;
	if (!root) return toast('open a folder first');
	if (row.classList.contains('on')) return;
	row.classList.add('on');
	toast('collecting…', 'busy');
	try {
		const d = await api('collect', { root });
		toast(`project.txt  ${d.files} files`, 'ok');
		if (!$$('#tree .row').some(r => r.dataset.path === d.path)) await reloadDir(root);
	} catch (e) { toast(e.message); }
	finally { row.classList.remove('on'); }
}

/* ── context menu ──────────────────────────── */

let menuEl = null;

const MI = {
	eye:       '<path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
	copy:      '<rect x="9" y="9" width="11" height="11" rx="1.5"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
	rename:    '<path d="M4 20h4L18 10l-4-4L4 16v4z"/><path d="M14.5 5.5l4 4"/>',
	newfile:   '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M12 12v5M9.5 14.5h5"/>',
	newfolder: '<path d="M3 7.5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 11v6M9 14h6"/>',
	download:  '<path d="M12 4v11"/><polyline points="8 11 12 15 16 11"/><path d="M5 19.5h14"/>',
	plus:      '<path d="M12 5v14M5 12h14"/>',
	tabs:      '<polyline points="4 8 8 12 4 16"/><line x1="11" y1="6" x2="20" y2="6"/><line x1="11" y1="12" x2="20" y2="12"/><line x1="11" y1="18" x2="20" y2="18"/>',
	trash:     '<path d="M4 7h16"/><path d="M9 7V4.5h6V7"/><path d="M6.5 7l1 13h9l1-13"/>',
	restore:   '<path d="M4.5 11a7.5 7.5 0 1 1 2.2 5.3"/><polyline points="4.5 5.5 4.5 11 10 11"/>',
	purge:     '<circle cx="12" cy="12" r="7.5"/><path d="M9.5 9.5l5 5M14.5 9.5l-5 5"/>'
};
const miSvg = k => `<span class="mi">${MI[k] ? `<svg viewBox="0 0 24 24">${MI[k]}</svg>` : ''}</span>`;

// stand-alone icons for the dialog and the folder headers
const DICO = {
	open: '<svg viewBox="0 0 24 24"><path d="M10 4.5H18.5v15H10"/><line x1="3" y1="12" x2="13.5" y2="12"/><polyline points="10 8.5 13.5 12 10 15.5"/></svg>',
	add:  '<svg viewBox="0 0 24 24"><line x1="12" y1="5.5" x2="12" y2="18.5"/><line x1="5.5" y1="12" x2="18.5" y2="12"/></svg>',
	folder: `<svg viewBox="0 0 24 24">${MI.newfolder.replace('<path d="M12 11v6M9 14h6"/>', '')}</svg>`
};

function closeMenu() {
	if (!menuEl) return;
	document.removeEventListener('pointerdown', menuEl._away, true);
	menuEl.remove();
	menuEl = null;
}

function showMenu(x, y, items, opts = {}) {
	closeMenu();
	const m = document.createElement('div');
	m.className = 'menu';
	for (const it of items) {
		const b = document.createElement('div');
		b.className = 'menu-item' + (it.danger ? ' danger' : '');
		b.innerHTML = miSvg(it.icon) + `<span>${it.label}</span>`;
		b.addEventListener('click', () => { closeMenu(); it.run(); });
		m.appendChild(b);
	}
	document.body.appendChild(m);
	m.style.left = Math.max(6, Math.min(x, innerWidth  - m.offsetWidth  - 8)) + 'px';
	m.style.top  = Math.max(6, Math.min(y, innerHeight - m.offsetHeight - 8)) + 'px';
	m._anchor = opts.anchor || null;
	m._away = e => {
		if (m.contains(e.target)) return;
		if (m._anchor && m._anchor.contains(e.target)) return;  // the button closes it on its own
		closeMenu();
	};
	document.addEventListener('pointerdown', m._away, true);
	menuEl = m;
}

function bindMenu(el, build, opts = {}) {
	let timer = null, sx = 0, sy = 0;
	const skip = e => opts.skip && e.target.closest(opts.skip);
	el.addEventListener('contextmenu', e => {
		if (skip(e)) return;
		e.preventDefault();
		showMenu(e.clientX, e.clientY, build());
	});
	el.addEventListener('pointerdown', e => {
		if (e.pointerType === 'mouse' || skip(e)) return;
		sx = e.clientX; sy = e.clientY;
		timer = setTimeout(() => {
			timer = null;
			el._skipClick = true;
			showMenu(sx, sy, build());
		}, 460);
	});
	el.addEventListener('pointermove', e => {
		if (timer && (Math.abs(e.clientX - sx) > 8 || Math.abs(e.clientY - sy) > 8)) {
			clearTimeout(timer); timer = null;
		}
	});
	const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
	el.addEventListener('pointerup', cancel);
	el.addEventListener('pointercancel', cancel);
}

/* ── confirm ───────────────────────────────── */

function confirmBox(text, yesLabel = 'Delete') {
	return new Promise(resolve => {
		const box = $('#confirm');
		$('#confirm-text').textContent = text;
		$('#confirm-yes').textContent = yesLabel;
		box.hidden = false;
		const done = v => {
			box.hidden = true;
			$('#confirm-yes').onclick = null;
			$('#confirm-no').onclick = null;
			box.onpointerdown = null;
			resolve(v);
		};
		$('#confirm-yes').onclick = () => done(true);
		$('#confirm-no').onclick  = () => done(false);
		box.onpointerdown = e => { if (e.target === box) done(false); };
	});
}

/* ── inline name editing in the sidebar ────── */

function inlineEdit(row, initial, commit) {
	const nameEl = $('.name', row);
	const inp = document.createElement('input');
	inp.className = 'nameinput';
	inp.value = initial;
	inp.spellcheck = false;
	nameEl.replaceWith(inp);
	inp.focus();
	const dot = initial.lastIndexOf('.');
	if (dot > 0) inp.setSelectionRange(0, dot); else inp.select();

	let done = false;
	const finish = ok => {
		if (done) return;
		done = true;
		const v = inp.value.trim();
		inp.replaceWith(nameEl);
		commit(ok && v && v !== initial ? v : null);
	};
	inp.addEventListener('keydown', e => {
		e.stopPropagation();
		if (e.key === 'Enter')  { e.preventDefault(); finish(true); }
		if (e.key === 'Escape') { e.preventDefault(); finish(false); }
	});
	inp.addEventListener('blur', () => finish(true));
}

/* ── file operations ───────────────────────── */

const parentOf = p => p.replace(/\/[^/]+\/?$/, '') || '/';

function retargetTabs(oldPath, newPath) {
	const f = FILES.get(oldPath);
	if (f) { FILES.delete(oldPath); FILES.set(newPath, f); }
	for (const p of PANES) {
		for (const t of p.tabs) {
			if (t.path === oldPath) { t.path = newPath; t.name = newPath.split('/').pop(); }
		}
		if (p.active === oldPath) p.active = newPath;
		renderTabs(p);
	}
	persist();
}

function closeTabsUnder(path) {
	for (const p of PANES) {
		for (const t of [...p.tabs]) {
			if (t.path === path || t.path.startsWith(path + '/')) closeTab(p, t.path);
		}
	}
}

async function reloadDir(path) {
	const d = DIRS.get(path);
	if (!d) return;
	let r;
	try { r = await api('ls', { path }); } catch (e) { return toast(e.message); }
	for (const k of [...DIRS.keys()]) if (k !== path && k.startsWith(path + '/')) DIRS.delete(k);
	d.el.innerHTML = '';
	renderItems(r.items, d.el, d.depth);
	markTree();
}

async function openDir(path) {
	const d = DIRS.get(path);
	if (!d || !d.kids) return;
	if (!d.kids.dataset.loaded) {
		try {
			const r = await api('ls', { path });
			renderItems(r.items, d.kids, d.depth);
			d.kids.dataset.loaded = '1';
		} catch (e) { return toast(e.message); }
	}
	d.kids.hidden = false;
	d.row?.classList.add('open');
	OPEN_DIRS.add(path);
}

async function newEntry(dirPath, folder) {
	if (DIRS.get(dirPath)?.kids) await openDir(dirPath);
	const d = DIRS.get(dirPath);
	if (!d) return toast('folder not loaded');

	const wrap = document.createElement('div');
	const row = document.createElement('div');
	row.className = 'row ' + (folder ? 'dir' : 'file');
	row.style.paddingLeft = (8 + d.depth * 11) + 'px';
	row.innerHTML = folder
		? '<span class="chev">▶</span><span class="name"></span>'
		: '<span class="ico">··</span><span class="name"></span>';
	wrap.appendChild(row);
	d.el.prepend(wrap);

	inlineEdit(row, '', async name => {
		if (!name) return wrap.remove();
		try { await api('create', { dir: dirPath, name, folder: folder ? 1 : 0 }); }
		catch (e) { toast(e.message); }
		await reloadDir(dirPath);
	});
}

function renameEntry(it, row) {
	inlineEdit(row, it.name, async name => {
		if (!name) return;
		try {
			const r = await api('rename', { path: it.path, name });
			retargetTabs(it.path, r.path);
			await reloadDir(parentOf(it.path));
		} catch (e) { toast(e.message); }
	});
}

async function trashEntry(it) {
	const ok = await confirmBox(`Move “${it.name}” to the trash?`, 'Move');
	if (!ok) return;
	try { await api('trash', { path: it.path, root: rootOf(it.path) }); }
	catch (e) { return toast(e.message); }
	closeTabsUnder(it.path);
	await reloadDir(parentOf(it.path));
	loadTrash();
}

function toTabs(text, unit = 2) {
	return text.split('\n').map(line => {
		const m = line.match(/^[ \t]+/);
		if (!m) return line;
		let width = 0;
		for (const ch of m[0]) width += ch === '\t' ? unit - (width % unit) : 1;
		return '\t'.repeat(Math.floor(width / unit)) + ' '.repeat(width % unit) + line.slice(m[0].length);
	}).join('\n');
}

const NO_TABS = ['yaml', 'markdown', 'python'];

// guess whether the text is indented in steps of 2 or 4
function spaceUnit(text) {
	const gcd = (a, b) => b ? gcd(b, a % b) : a;
	const g = (text.match(/^ {2,}(?=[^\s*])/gm) || []).reduce((a, s) => gcd(a, s.length), 0);
	return g && g % 4 === 0 ? 4 : 2;
}

function tabsOnPaste(cm, ch) {
	if (ch.origin !== 'paste' || NO_TABS.includes(cm.getMode().name)) return;
	const text = ch.text.join('\n');
	if (!/^ {2,}/m.test(text)) return;
	ch.update(null, null, toTabs(text, spaceUnit(text)).split('\n'));
}

async function indentToTabs(it) {
	await openFile(it.path);
	const f = FILES.get(it.path);
	if (!f) return;
	const before = f.master.getValue();
	const after  = toTabs(before, 2);
	if (after === before) return toast('already using tabs');
	f.master.setValue(after);
	toast('converted — review it and save with ⌘S');
}

function entryMenu(it, row) {
	const dir = it.dir ? it.path : parentOf(it.path);
	const items = [
		{ label: 'Rename', icon: 'rename', run: () => renameEntry(it, row) },
		{ label: 'New file', icon: 'newfile', run: () => newEntry(dir, false) },
		{ label: 'New folder', icon: 'newfolder', run: () => newEntry(dir, true) }
	];
	if (!it.dir) {
		items.push({ label: 'Copy', icon: 'copy', run: async () => {
			try {
				const f = FILES.get(it.path);
				const text = f ? f.master.getValue() : await (await fetch(`${API}?a=raw&path=${encodeURIComponent(it.path)}`)).text();
				await navigator.clipboard.writeText(text);
				toast('copied', 'ok');
			} catch (e) { toast('could not copy'); }
		} });
		items.push({ label: 'Download', icon: 'download', run: () => {
			location.href = `${API}?a=raw&path=${encodeURIComponent(it.path)}`;
		} });
		items.push({ label: 'Indent with tabs', icon: 'tabs', run: () => indentToTabs(it) });
	}
	items.push({ label: 'Move to trash', icon: 'trash', danger: true, run: () => trashEntry(it) });
	return items;
}

/* ── trash ─────────────────────────────────── */

async function loadTrash() {
	const root = S.active;
	if (!root) return;
	let d;
	try { d = await api('trashlist', { root }); } catch { return; }
	const list = $('#trashlist');
	list.innerHTML = '';
	$('#trashrow .count').textContent = d.items.length || '';

	for (const it of d.items) {
		const row = document.createElement('div');
		row.className = 'row file';
		row.style.paddingLeft = '19px';
		const [label, color] = iconFor(it.ext);
		row.innerHTML = `<span class="ico" style="color:${color}">${label}</span><span class="name">${it.name}</span>`;
		row.title = it.from || it.name;
		bindMenu(row, () => [
			{ label: 'Restore', icon: 'restore', run: async () => {
					try { await api('restore', { path: it.path, root }); }
					catch (e) { return toast(e.message); }
					await reloadDir(parentOf(it.from || root));
					loadTrash();
				} },
			{ label: 'Delete permanently', icon: 'purge', danger: true, run: async () => {
					const ok = await confirmBox(`“${it.name}” will be gone for good. There is no undo.`);
					if (!ok) return;
					try { await api('purge', { path: it.path, root }); }
					catch (e) { return toast(e.message); }
					loadTrash();
				} }
		]);
		list.appendChild(row);
	}
}

/* ── file tree ─────────────────────────────── */

// empties the sidebar and reopens exactly this list
async function reopenRoots(list, active) {
	PANES.forEach(p => [...p.tabs].forEach(t => closeTab(p, t.path)));
	S.roots = [];
	OPEN_DIRS.clear();
	DIRS.clear();
	$('#tree').innerHTML = '';
	for (const r of list) await addRoot(r);
	if (S.roots.includes(active)) setActive(active);
}

// replaces everything: closes tabs and leaves a single folder
const setRoot = path => reopenRoots([path], path);

// adds a sibling folder without touching what is already open
async function addRoot(path) {
	let d;
	try { d = await api('ls', { path }); } catch (e) { return toast(e.message); }

	const clash = overlaps(d.path);
	if (clash) return toast(`“${base(clash)}” is already open: folders cannot contain each other`);

	S.roots.push(d.path);
	S.recent = [d.path, ...S.recent.filter(p => p !== d.path)].slice(0, 8);

	const block = document.createElement('div');
	block.dataset.root = d.path;
	block.className = 'rootblock open';
	block.innerHTML = `<div class="roothead"><span class="chev">▶</span>${DICO.folder}<span class="name"></span></div><div class="rootkids"></div>`;

	const head = block.querySelector('.roothead');
	head.querySelector('.name').textContent = base(d.path);
	head.title = d.path;
	head.addEventListener('click', () => setActive(d.path));
	// the chevron collapses; the rest of the header selects
	head.querySelector('.chev').addEventListener('click', e => {
		e.stopPropagation();
		block.classList.toggle('open');
	});
	bindMenu(head, () => [
		{ label: 'New file', icon: 'newfile', run: () => newEntry(d.path, false) },
		{ label: 'New folder', icon: 'newfolder', run: () => newEntry(d.path, true) },
		{ label: 'Close folder', icon: 'trash', danger: true, run: () => closeRoot(d.path) }
	]);

	const kids = block.querySelector('.rootkids');
	DIRS.set(d.path, { el: kids, depth: 0 });
	renderItems(d.items, kids, 0);
	$('#tree').appendChild(block);

	setActive(d.path);
}

// closes a folder and everything hanging from it
function closeRoot(root) {
	if (S.roots.length < 2) return toast('it is the only folder open');
	S.roots = S.roots.filter(r => r !== root);
	$(`.rootblock[data-root="${CSS.escape(root)}"]`)?.remove();
	for (const p of [...DIRS.keys()])     if (under(p, root)) DIRS.delete(p);
	for (const p of [...OPEN_DIRS])       if (under(p, root)) OPEN_DIRS.delete(p);
	PANES.forEach(pn => [...pn.tabs].forEach(t => { if (under(t.path, root)) closeTab(pn, t.path); }));
	setActive(S.roots[0] || '');
}

// the only door to the "active" state: nobody writes S.active by hand
function setActive(root) {
	S.active = root;
	$('#tree').classList.toggle('multi', multi());
	$$('#tree .rootblock').forEach(b => b.classList.toggle('active', b.dataset.root === root));
	$('#rootname').innerHTML = `<span class="appname">k/</span>${root ? base(root) : 'no folder'}`;
	$('#rootname').title = root || '';
	$('#trashrow .name').textContent = multi() && root ? `${base(root)}/trash` : 'trash';
	$('#dropzone').dataset.root = multi() && root ? base(root) : '';
	PANES.forEach(renderTabs);
	loadTrash();
	persist();
}

function renderItems(items, container, depth) {
	for (const it of items) container.appendChild(rowFor(it, depth));
}

function rowFor(it, depth) {
	const wrap = document.createElement('div');
	const row = document.createElement('div');
	row.className = 'row ' + (it.dir ? 'dir' : 'file');
	row.style.paddingLeft = (8 + depth * 11) + 'px';
	row.dataset.path = it.path;

	if (it.dir) {
		row.innerHTML = `<span class="chev">▶</span><span class="name">${it.name}</span>`;
	} else {
		const [label, color] = iconFor(it.ext);
		row.innerHTML = `<span class="ico" style="color:${color}">${label}</span><span class="name">${it.name}</span>`;
		row.draggable = true;
		row.addEventListener('dragstart', e => {
			const url = new URL(`api.php?a=raw&path=${encodeURIComponent(it.path)}`, location.href).href;
			const f = FILES.get(it.path);
			if (f) e.dataTransfer.items.add(new File([f.master.getValue()], it.name, { type: 'text/plain' }));
			e.dataTransfer.setData('application/x-editor-file', it.path);
			e.dataTransfer.setData('text/plain', it.path);
			e.dataTransfer.setData('text/uri-list', url);
			e.dataTransfer.setData('DownloadURL', `application/octet-stream:${it.name}:${url}`);
			e.dataTransfer.effectAllowed = 'copyLink';
		});
		row.addEventListener('click', () => { if (row._skipClick) { row._skipClick = false; return; } openFile(it.path); });
	}

	const kids = document.createElement('div');
	kids.hidden = true;

	if (it.dir) {
		DIRS.set(it.path, { el: kids, kids, row, depth: depth + 1 });
		row.addEventListener('click', async () => {
			if (row._skipClick) { row._skipClick = false; return; }
			pickDir(it.path);
			if (!kids.dataset.loaded) {
				try {
					const d = await api('ls', { path: it.path });
					renderItems(d.items, kids, depth + 1);
					kids.dataset.loaded = '1';
				} catch (e) { return toast(e.message); }
			}
			kids.hidden = !kids.hidden;
			row.classList.toggle('open', !kids.hidden);
			kids.hidden ? OPEN_DIRS.delete(it.path) : OPEN_DIRS.add(it.path);
		});
		row.addEventListener('dragover', e => {
			if (!e.dataTransfer?.types.includes('Files')) return;
			e.preventDefault(); e.stopPropagation(); row.classList.add('dragover');
		});
		row.addEventListener('dragleave', () => row.classList.remove('dragover'));
		row.addEventListener('drop', async e => {
			row.classList.remove('dragover');
			if (!e.dataTransfer?.files.length) return;
			e.preventDefault(); e.stopPropagation();
			pickDir(it.path);
			uploadMany(it.path, await readDrop(e.dataTransfer), () => reloadDir(it.path));
		});
	}

	bindMenu(row, () => entryMenu(it, row));

	wrap.appendChild(row);
	wrap.appendChild(kids);
	return wrap;
}

function markTree() {
	const open = new Set(PANES.flatMap(p => p.tabs.map(t => t.path)));
	const current = PANES[S.focus]?.active;
	$$('#tree .row.file').forEach(r => {
		const p = r.dataset.path;
		r.classList.toggle('active', p === current);
		r.classList.toggle('loaded', open.has(p) && p !== current);
	});
	syncPreviewRow();
}

/* ── search ────────────────────────────────── */

let searchTimer;
function runSearch(commit = false) {
	const q = $('#q').value.replace(/^[\r\n]+|[\s\r\n]+$/g, '');
	const box = $('#results');

	const jump = q.match(/^:\s*(\d+)$/);
	if (jump) {
		const n = +jump[1];
		box.innerHTML = jumpToLine(n, commit)
			? `<div class="res-note">line ${n}</div>`
			: '<div class="res-note">open a file first</div>';
		return;
	}

	if (q.length < 2) { box.innerHTML = ''; return; }
	if (!S.active) { box.innerHTML = '<div class="res-note">open a folder first</div>'; return; }

	box.innerHTML = '<div class="res-note">searching…</div>';
	api('search', { root: S.active, q }).then(d => {
		if (!d.hits.length) { box.innerHTML = '<div class="res-note">no results</div>'; return; }
		box.innerHTML = '';
		const esc = s => s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
		const first = q.split('\n')[0];
		const rx = new RegExp(first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig');

		for (const h of d.hits) {
			const row = document.createElement('div');
			row.className = 'res';
			row.innerHTML =
				`<span class="rel">${esc(h.rel)}</span>` +
				`<span class="ln">${h.line}</span>` +
				`<span class="tx">${esc(h.text).replace(rx, m => `<mark>${m}</mark>`)}</span>`;
			row.addEventListener('click', () => openFile(h.file, S.focus, h.line, { col: h.col, q }));
			box.appendChild(row);
		}
		if (d.capped) box.insertAdjacentHTML('beforeend', '<div class="res-note">results truncated</div>');
	}).catch(e => { box.innerHTML = `<div class="res-note">${e.message}</div>`; });
}

/* ── panes: show / hide / size ─────────────── */

function toggleSidebar(force) {
	S.sidebar = force ?? !S.sidebar;
	$('#sidebar').hidden = !S.sidebar;
	$('.gutter[data-resize="sidebar"]').hidden = !S.sidebar;
	refreshAll(); persist();
}

function toggleSearch(force) {
	S.search = force ?? !S.search;
	$('#search').hidden = !S.search;
	$('.gutter[data-resize="search"]').hidden = !S.search;
	if (S.search) { $('#q').focus(); $('#q').select(); }
	refreshAll(); persist();
}

function toggleSplit(force) {
	const pane = PANES[1];
	const show = force ?? pane.el.hidden;
	pane.el.hidden = !show;
	$('.gutter[data-resize="pane"]').hidden = !show;
	if (!show) { [...pane.tabs].forEach(t => closeTab(pane, t.path)); setFocus(0); }
	refreshAll(); persist();
}

const WRAP_ICONS = {
	on:  '<path d="M4 6.5h16"/><path d="M4 12h12.5a3 3 0 0 1 0 6H14"/><polyline points="16.5 15 13.5 18 16.5 21"/><path d="M4 17.5h6"/>',
	off: '<line x1="4" y1="6.5" x2="20" y2="6.5"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17.5" x2="20" y2="17.5"/>'
};
function syncWrapIcon() {
	const svg = $('#mobar [data-act="wrap"] svg');
	if (svg) svg.innerHTML = WRAP_ICONS[S.wrap ? 'on' : 'off'];
}

function toggleWrap() {
	S.wrap = !S.wrap;
	PANES.forEach(p => p.cm.setOption('lineWrapping', S.wrap));
	syncWrapIcon();
	refreshAll();
	toast(S.wrap ? 'soft wrap on' : 'soft wrap off');
	persist();
}

function refreshAll() { PANES.forEach(p => { p.cm.refresh(); p.syncBar?.(); }); }

function applySizes() {
	$('#sidebar').style.flexBasis  = S.sizes.sidebar + 'px';
	$('#search').style.flexBasis   = S.sizes.search + 'px';
	PANES[1].el.style.flexBasis    = S.sizes.pane + '%';
}

function initResizers() {
	for (const g of $$('.gutter')) {
		g.addEventListener('pointerdown', e => {
			e.preventDefault();
			g.setPointerCapture?.(e.pointerId);
			const kind = g.dataset.resize;
			g.classList.add('dragging');
			document.body.style.cursor = g.classList.contains('gutter-v') ? 'col-resize' : 'row-resize';

			const app = $('#app').getBoundingClientRect();
			const sec = kind === 'search' ? $('#search').getBoundingClientRect().bottom : 0;

			const move = ev => {
				const main = $('#main').getBoundingClientRect();
				const panes = $('#panes').getBoundingClientRect();
				if (kind === 'sidebar')  S.sizes.sidebar  = clamp(ev.clientX - main.left, 120, 520);
				if (kind === 'search')   S.sizes.search   = clamp(sec - ev.clientY, 90, app.height - 180);
				if (kind === 'pane')     S.sizes.pane     = clamp((panes.right - ev.clientX) / panes.width * 100, 15, 85);
				applySizes();
			};
			const up = () => {
				document.removeEventListener('pointermove', move);
				document.removeEventListener('pointerup', up);
				document.removeEventListener('pointercancel', up);
				g.classList.remove('dragging');
				document.body.style.cursor = '';
				refreshAll(); persist();
			};
			document.addEventListener('pointermove', move);
			document.addEventListener('pointerup', up);
			document.addEventListener('pointercancel', up);
		});
	}
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ── open-folder dialog ────────────────────── */

let DPATH = '/';
let ROOTS = [];

const isTouch = () => matchMedia('(hover:none)').matches;

/* ── themes ────────────────────────────────── */

const THEMES = [
	{ id: 'citric',      label: 'Citric',      bg: '#1a1a18', text: '#c8c6bc', dim: '#6f6d64', accent: '#7aaa6a' },
	{ id: '9009',        label: '9009',        bg: '#ebe8df', text: '#0c0d0d', dim: '#8e8976', accent: '#799878' },
	{ id: 'viridescent', label: 'Viridescent', bg: '#282d2d', text: '#e8f2d8', dim: '#7e9d83', accent: '#94ccab' },
	{ id: 'camping',     label: 'Camping',     bg: '#f8efe1', text: '#353834', dim: '#b9afa2', accent: '#9c4b47' },
	{ id: 'carbon',      label: 'Carbon',      bg: '#2b2b2b', text: '#f2e2c4', dim: '#565656', accent: '#e96b29' },
	{ id: 'matrix',      label: 'Matrix',      bg: '#000000', text: '#d2fccb', dim: '#205717', accent: '#5df742' },
	{ id: 'olive',       label: 'Olive',       bg: '#e6e1c8', text: '#30302c', dim: '#aeaa96', accent: '#888867' },
];

function applyTheme(id) {
	S.theme = id;
	document.documentElement.dataset.theme = id;
	persist();
	renderThemeList();
}

function renderThemeList() {
	const list = $('#themelist');
	list.innerHTML = '';
	for (const t of THEMES) {
		const row = document.createElement('div');
		row.className = 'theme-row';
		row.style.background = t.bg;
		row.innerHTML = `
			<span class="theme-swatches">
				<span class="theme-dot" style="background:${t.accent}"></span>
				<span class="theme-dot" style="background:${t.text}"></span>
				<span class="theme-dot" style="background:${t.dim}"></span>
			</span>
			<span class="name" style="color:${t.text}">${t.label}</span>`;
		row.addEventListener('mouseenter', () => { document.documentElement.dataset.theme = t.id; });
		row.addEventListener('mouseleave', () => { document.documentElement.dataset.theme = S.theme; });
		row.addEventListener('click', () => { applyTheme(t.id); $('#thememodal').hidden = true; });
		list.appendChild(row);
	}
}

function openThemeModal() {
	renderThemeList();
	$('#thememodal').hidden = false;
}

async function openDialog() {
	$('#dialog').hidden = false;
	$('#dpath').value = '';
	$('#dhere').onclick = async () => {
		const typed = $('#dpath').value.trim();
		if (typed) return chooseDir(typed);
		if (!DPATH) return alert('no folder to open');
		chooseDir(DPATH);
	};
	// with nothing open there is no "next to" anything
	$('#dadd').hidden = !S.roots.length;
	$('#dadd').onclick = async () => {
		const target = $('#dpath').value.trim() || DPATH;
		if (!target) return alert('no folder to open');
		$('#dialog').hidden = true;
		await addRoot(target);
	};
	if (!ROOTS.length) {
		try { ROOTS = (await api('roots')).roots || []; }
		catch (e) { alert('roots failed:\n' + e.message); ROOTS = []; }
	}
	renderRecent();
	await browseTo(S.active || ROOTS[0] || '/');
	if (!isTouch()) $('#dpath').focus();
}

function dialogNewFolder() {
	const wrap = document.createElement('div');
	const row = document.createElement('div');
	row.className = 'drow';
	row.innerHTML = '<span class="chev">▶</span><span class="name"></span>';
	wrap.appendChild(row);
	$('#dlist').prepend(wrap);

	inlineEdit(row, '', async name => {
		if (!name) return wrap.remove();
		try { await api('create', { dir: DPATH, name, folder: 1 }); }
		catch (e) { toast(e.message); }
		browseTo(DPATH);
	});
}

async function renameCurrentDir() {
	const initial = DPATH.replace(/\/$/, '').split('/').pop() || DPATH;
	const name = prompt('new name', initial);
	if (!name || name === initial) return;
	try {
		const r = await api('rename', { path: DPATH, name });
		if (S.roots.includes(DPATH))
			await reopenRoots(S.roots.map(x => x === DPATH ? r.path : x), S.active === DPATH ? r.path : S.active);
		else await browseTo(r.path);
	} catch (e) { toast(e.message); }
}

async function moveCurrentDirToTrash() {
	if (S.roots.includes(DPATH)) return toast('cannot move a folder that is open');
	const name = DPATH.replace(/\/$/, '').split('/').pop();
	const ok = await confirmBox(`Move “${name}” to the trash?`, 'Move');
	if (!ok) return;
	const root = parentOf(DPATH);
	try { await api('trash', { path: DPATH, root }); }
	catch (e) { return toast(e.message); }
	closeTabsUnder(DPATH);
	await browseTo(root);
}

function dialogMoreMenu() {
	return [
		{ label: S.hidden ? 'Hide hidden files' : 'Show hidden files', icon: 'eye', run: toggleHidden },
		{ label: 'Rename', icon: 'rename', run: renameCurrentDir },
		{ label: 'Move to trash', icon: 'trash', danger: true, run: moveCurrentDirToTrash }
	];
}

function uploadOne(dir, file, onProg) {
	const fd = new FormData();
	fd.append('dir', dir);
	fd.append('file', file, file.name);
	return new Promise((ok, ko) => {
		const x = new XMLHttpRequest();
		x.open('POST', `${API}?a=upload`);
		x.setRequestHeader('X-Koder', '1');
		x.upload.onprogress = e => e.lengthComputable && onProg?.(e.loaded / e.total);
		x.onerror = () => ko(new Error('no connection'));
		x.onload = () => {
			if (x.status === 401) { location.reload(); return ko(new Error('session expired')); }
			let d;
			try { d = JSON.parse(x.responseText); }
			catch { return ko(new Error(`HTTP ${x.status} — ${x.responseText.slice(0, 200) || '(empty response)'}`)); }
			d.error ? ko(new Error(d.error)) : ok(d);
		};
		x.send(fd);
	});
}

// entries: [{file, rel}] — rel may carry subfolders ("sub/file.txt")
async function uploadMany(dir, entries, done = () => browseTo(dir)) {
	const n = entries.length, errs = [], made = new Set([dir]);
	for (const [i, { file, rel }] of entries.entries()) {
		const tag = `uploading ${n > 1 ? `${i + 1}/${n} · ` : ''}${rel}`;
		toast(tag, 'up');
		try {
			const sub = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
			const dest = sub ? await ensureSubdir(dir, sub, made) : dir;
			await uploadOne(dest, file, p => toast(`${tag} · ${Math.round(p * 100)}%`, 'up'));
		} catch (e) { errs.push(`${rel}: ${e.message}`); }
	}
	toast(errs.length ? errs.join(' · ') : `done · ${n > 1 ? n + ' files' : entries[0].rel}`, errs.length ? '' : 'ok');
	done();
}

// creates the chain of subfolders (idempotent — ignores "already exists")
async function ensureSubdir(root, sub, made) {
	let cur = root;
	for (const part of sub.split('/')) {
		const parent = cur;
		cur += '/' + part;
		if (!made.has(cur)) {
			try { await api('create', { dir: parent, name: part, folder: 1 }); }
			catch (e) { if (!/already exists/i.test(e.message)) throw e; }
			made.add(cur);
		}
	}
	return cur;
}

// lazy destination: the folder is resolved on drop, not when wiring up
const upTo = (dir, done) => entries => {
	const d = dir();
	if (!d) return toast('open a folder first');
	if (entries.length) uploadMany(d, entries, done);
};
function onFiles(input, send) {
	input.addEventListener('change', () => {
		const f = [...input.files].map(file => ({ file, rel: file.name }));
		input.value = ''; send(f);
	});
}
function onDropFiles(el, send) {
	el.addEventListener('dragover', e => {
		if (!e.dataTransfer?.types.includes('Files')) return;
		e.preventDefault(); el.classList.add('dragover');
	});
	el.addEventListener('dragleave', () => el.classList.remove('dragover'));
	el.addEventListener('drop', async e => {
		el.classList.remove('dragover');
		if (!e.dataTransfer?.files.length) return;
		e.preventDefault(); send(await readDrop(e.dataTransfer));
	});
}
// if a file lands outside a drop zone, the browser neither opens it nor drops the session
['dragover', 'drop'].forEach(ev => addEventListener(ev, e => e.dataTransfer?.types.includes('Files') && e.preventDefault()));

// reads a drop keeping folders: walks each entry with the File System API
function entryFiles(entry, base = '') {
	return new Promise(res => {
		if (entry.isFile) return entry.file(f => res([{ file: f, rel: base + f.name }]), () => res([]));
		if (!entry.isDirectory) return res([]);
		const reader = entry.createReader(), pending = [];
		const step = () => reader.readEntries(async es => {
			if (!es.length) return res((await Promise.all(pending)).flat());
			pending.push(...es.map(e => entryFiles(e, base + entry.name + '/')));
			step();
		}, () => res([]));
		step();
	});
}
async function readDrop(dt) {
	const entries = [...(dt.items || [])].map(i => i.webkitGetAsEntry?.()).filter(Boolean);
	if (!entries.length) return [...dt.files].map(file => ({ file, rel: file.name }));
	return (await Promise.all(entries.map(e => entryFiles(e)))).flat();
}

function chooseDir(path) {
	$('#dialog').hidden = true;
	setRoot(path);
}

async function browseTo(path) {
	let d;
	try { d = await api('ls', { path }); }
	catch (e) {
		$('#dlist').innerHTML = `<div class="dnote">${e.message}</div>`;
		alert('ls failed ' + path + ':\n' + e.message);
		return;
	}
	DPATH = d.path;

	const crumb = $('#dcrumb');
	crumb.innerHTML = '';
	const go = (label, target) => {
		const el = document.createElement('span');
		el.className = 'crumb';
		el.textContent = label;
		el.addEventListener('click', () => browseTo(target));
		crumb.appendChild(el);
	};
	go('/', '/');
	let acc = '';
	DPATH.split('/').filter(Boolean).forEach((p, i) => {
		acc += '/' + p;
		if (i > 0) {
			const sep = document.createElement('span');
			sep.className = 'crumb sep';
			sep.textContent = '/';
			crumb.appendChild(sep);
		}
		go(p, acc);
	});

	const list = $('#dlist');
	list.innerHTML = '';
	const parent = DPATH.replace(/\/[^/]+\/?$/, '') || '/';
	if (parent !== DPATH) {
		const up = document.createElement('div');
		up.className = 'drow';
		up.innerHTML = '<span class="chev">▲</span><span class="name">..</span>';
		up.addEventListener('click', () => browseTo(parent));
		list.appendChild(up);
	}
	const dirs = d.items.filter(i => i.dir);
	if (!dirs.length) list.insertAdjacentHTML('beforeend', '<div class="dnote">no subfolders</div>');
	for (const it of dirs) {
		const el = document.createElement('div');
		el.className = 'drow';
		el.innerHTML = `<span class="chev">▶</span><span class="name">${it.name}</span>`;
		el.addEventListener('click', () => browseTo(it.path));
		list.appendChild(el);
	}
	const nm = base(DPATH);
	$('#dhere').innerHTML = `${DICO.open}<span class="label">open ${nm}</span>`;
	$('#dadd').innerHTML  = `${DICO.add}<span class="label">add ${nm}</span>`;
}

function renderRecent() {
	const box = $('#drecent');
	box.innerHTML = '';
	const seen = new Set();
	for (const p of S.recent) {
		seen.add(p);
		const el = document.createElement('div');
		el.className = 'recent';
		el.textContent = p;
		el.addEventListener('click', () => chooseDir(p));
		box.appendChild(el);
	}
	for (const p of ROOTS) {
		if (seen.has(p)) continue;
		const el = document.createElement('div');
		el.className = 'recent';
		el.textContent = p;
		el.addEventListener('click', () => browseTo(p));
		box.appendChild(el);
	}
}

/* ── transient toast ───────────────────────── */

let toastTimer;
function toast(msg, kind = '') {
	const t = $('#toast');
	t.textContent = msg;
	['ok', 'busy', 'up'].forEach(k => t.classList.toggle(k, kind === k));
	t.hidden = false;
	requestAnimationFrame(() => t.classList.add('on'));
	clearTimeout(toastTimer);
	if (kind === 'busy' || kind === 'up') return;
	toastTimer = setTimeout(() => {
		t.classList.remove('on');
		setTimeout(() => { t.hidden = true; }, 300);
	}, 1600);
}

/* ── lock the on-screen keyboard ───────────── */
	 // iOS does not tell you whether a hardware keyboard is connected; this is
	 // a manual switch via inputmode="none" on CodeMirror's real input field —
	 // typing on an external keyboard keeps working, only the automatic
	 // appearance of the virtual keyboard is turned off.

// files starting with a dot: api.php filters them out unless we ask for hidden
function toggleHidden() {
	S.hidden = !S.hidden;
	persist();
	toast(S.hidden ? 'hidden files: shown' : 'hidden files: hidden');
	S.roots.forEach(r => reloadDir(r));
	if (!$('#dialog').hidden) browseTo(DPATH);
}

function applyKbLock(pane) {
	const el = pane.cm?.getInputField?.();
	if (!el) return;
	if (S.lockKb) el.setAttribute('inputmode', 'none');
	else el.removeAttribute('inputmode');
	if (el._kbRelock) return;
	el._kbRelock = true;
	el.addEventListener('blur', () => S.lockKb && el.setAttribute('inputmode', 'none'));
}

// iOS re-reads inputmode only when the field is refocused; focus() must be synchronous with the tap
function refocusKb(cm, unlock) {
	const el = cm.getInputField();
	el.blur();
	if (unlock) el.removeAttribute('inputmode');
	cm.focus();
}

function summonKb() {
	const cm = PANES[S.focus]?.cm;
	if (cm) refocusKb(cm, true);
}

function toggleKbLock() {
	S.lockKb = !S.lockKb;
	PANES.forEach(applyKbLock);
	const cm = PANES[S.focus]?.cm;
	if (cm?.hasFocus()) refocusKb(cm);
	syncKbRow();

	toast(S.lockKb ? 'on-screen keyboard locked' : 'on-screen keyboard unlocked');
	persist();
}

function syncKbRow() {
	$('#kbrow')?.classList.toggle('on', S.lockKb);
	$('#mobar [data-act="kb"]')?.classList.toggle('on', S.lockKb);
}

/* ── preview ────────────────────────────────── */
	 // a virtual tab, same mechanism as shortcuts.md: no FILES entry,
	 // no persistence, except that instead of a CodeMirror doc it shows
	 // an iframe with the folder's real index.
	 //
	 // It always lives in the second pane — so its width is adjusted with
	 // the same divider you already use between panes. If it ends up being
	 // the only tab open in the whole app, it moves itself to the main pane
	 // and the split closes.

const PREVIEW_TAB = 'koder:preview';

async function openPreview() {
	// the open file wins, but only if it lives inside the active folder;
	// otherwise the selection wins. The focused pane has priority.
	const order = [PANES[S.focus], ...PANES.filter((_, i) => i !== S.focus)];
	const src = order.find(p => p?.active && !p.active.startsWith('koder:') && under(p.active, S.active));
	const dir = src ? parentOf(src.active) : S.active;
	if (!dir) return toast('open a folder first');

	let d;
	try { d = await api('indexfor', { path: dir }); }
	catch (e) { return toast(e.message); }
	if (!d.url) return toast(d.why || 'no index.php or index.html in this folder');

	showPreview('Preview', await fetchFreshHtml(d.url));
}

// a single preview tab in pane 2: its content changes, it is never duplicated
function showPreview(name, html, img = false) {
	if (PANES[1].el.hidden) toggleSplit(true);
	const pane = PANES[1];
	let tab = pane.tabs.find(t => t.path === PREVIEW_TAB);
	if (!tab) pane.tabs.push(tab = { path: PREVIEW_TAB, virtual: true, preview: true });
	Object.assign(tab, { name, html, img });
	activate(pane, tab);
	setFocus(1);
}

const IMG_RX = /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp)$/i;
const rawUrl = path => new URL(`${API}?a=raw&path=${encodeURIComponent(path)}`, location.href).href;

function openImage(path) {
	const cs = getComputedStyle(document.documentElement);
	const cBg = cs.getPropertyValue('--bg').trim();
	const cSq = cs.getPropertyValue('--bg-hover').trim();
	showPreview(path.split('/').pop(), `<style>
		html,body{margin:0;height:100%}
		body{display:grid;place-items:center;background:${cBg} repeating-conic-gradient(${cSq} 0 25%,transparent 0 50%) 0 0/16px 16px}
		img{max-width:100%;max-height:100%;object-fit:contain}
	</style><img src="${rawUrl(path)}&kdr=${Date.now()}">`, true);
}

// fetches the html with no cache and busts the cache of every local asset
// (css/js/img) it references, so the iframe never shows stale files.
async function fetchFreshHtml(url) {
	const abs = location.origin + url;
	const html = await fetch(abs, { cache: 'no-store' }).then(r => r.text());
	const ts = Date.now();
	const busted = html.replace(
		/\s(src|href)=(["'])(?!https?:|data:|#|mailto:)([^"']+)\2/gi,
		(m, attr, q, val) => ` ${attr}=${q}${val}${val.includes('?') ? '&' : '?'}kdr=${ts}${q}`
	);
	const base = abs.slice(0, abs.lastIndexOf('/') + 1);
	return `<base href="${base}">` + busted;
}

function togglePreview() {
	const pane = PANES[1];
	const cur = pane.tabs.find(t => t.path === PREVIEW_TAB);
	if (!pane.el.hidden && pane.active === PREVIEW_TAB && !cur?.img) closeTab(pane, PREVIEW_TAB);
	else openPreview();
}

// if the preview ends up being the only tab open in the whole app,
// it moves to the main pane and the split closes: full width.
function maybeExpandPreview() {
	const all = PANES.flatMap(p => p.tabs);
	const home = PANES.find(p => p.tabs.some(t => t.path === PREVIEW_TAB));
	if (all.length !== 1 || home !== PANES[1] || PANES[1].el.hidden) return;

	const tab = PANES[1].tabs.pop();
	PANES[1].active = null;
	toggleSplit(false);          // pane1.tabs is already empty: nothing else gets closed
	PANES[0].tabs.push(tab);
	activate(PANES[0], tab);
	persist();
}

function syncPreviewRow() {
	const pane = PANES.find(p => p.active === PREVIEW_TAB && !p.el.hidden);
	$('#previewrow')?.classList.toggle('on', !!pane);
}

/* ── clipboard with Control ────────────────── */

async function clipboard(kind, force = false) {
	const cm = PANES[S.focus]?.cm;
	if (!cm || (!force && !cm.hasFocus())) return;
	try {
		if (kind === 'v') {
			const t = await Promise.race([
				navigator.clipboard.readText(),
				new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), force ? 15000 : 1200))
			]);
			cm.replaceSelection(t, 'end', 'paste');
		} else {
			await navigator.clipboard.writeText(cm.getSelection());
			if (kind === 'x') cm.replaceSelection('');
		}
	} catch {
		toast(kind === 'v'
			? 'iOS will not let JS read the clipboard — paste with the touch menu'
			: 'the browser blocked the clipboard');
	}
}

function cycleTab(dir) {
	const pane = PANES[S.focus];
	if (!pane || pane.tabs.length < 2) return;
	const i = pane.tabs.findIndex(t => t.path === pane.active);
	const next = pane.tabs[(i + dir + pane.tabs.length) % pane.tabs.length];
	activate(pane, next);
	pane.cm.focus();
}

function jumpToLine(n, focusEditor = true) {
	const pane = PANES[S.focus];
	if (!pane?.active || !n || n < 1) return false;
	const line = Math.min(n, pane.cm.lastLine() + 1) - 1;
	pane.cm.setCursor({ line, ch: 0 });
	pane.cm.scrollIntoView({ line, ch: 0 }, 120);
	if (focusEditor) pane.cm.focus();
	return true;
}

function gotoLine() {
	jumpToLine(parseInt(prompt('go to line') || '', 10));
}

/* ── mobile bar ────────────────────────────── */

function initMobar() {
	const bar = $('#mobar');
	if (!bar) return;

	const act = {
		sidebar: () => toggleSidebar(),
		search:  () => toggleSearch(),
		wrap:    () => toggleWrap(),
		paste:   () => clipboard('v', true),
		undo:    b => b._long ? (b._long = false) : PANES[S.focus]?.cm.undo(),
		redo:    () => PANES[S.focus]?.cm.redo(),
		save:    () => saveActive(),
		fold:    () => { closeMenu(); bar.classList.toggle('folded'); },
		kb:      b => b._long ? (b._long = false) : (S.lockKb ? summonKb() : toggleKbLock()),
		refresh: () => location.reload(),
	};

	// keyboard button: icon cloned from #kbrow; a long press unlocks
	const kb = bar.querySelector('[data-act="kb"]');
	kb.append($('#kbrow .ki').cloneNode(true));
	let kbT;
	kb.addEventListener('pointerdown', () => kbT = setTimeout(() => { kb._long = true; toggleKbLock(); }, 500));
	kb.addEventListener('pointerup', () => clearTimeout(kbT));

	// vertical swipe: moves the floating bar (iPhone) up/down, both ways
	let dockY = null;
	bar.addEventListener('pointerdown', e => { if (innerWidth <= 480) dockY = e.clientY; });
	bar.addEventListener('pointermove', e => {
		if (dockY === null) return;
		const dy = e.clientY - dockY;
		if (dy > 30 && !bar.classList.contains('docked')) { bar.classList.add('docked'); dockY = null; }
		else if (dy < -30 && bar.classList.contains('docked')) { bar.classList.remove('docked'); dockY = null; }
	});
	bar.addEventListener('pointerup', () => dockY = null);
	bar.addEventListener('pointercancel', () => dockY = null);

	// redo hides inside undo: a long press reveals it for 5s and covers the fold
	const undo = bar.querySelector('[data-act="undo"]');
	let undoT, expandT;
	undo.addEventListener('pointerdown', () => undoT = setTimeout(() => {
		undo._long = true;
		bar.classList.add('expanded');
		clearTimeout(expandT);
		expandT = setTimeout(() => bar.classList.remove('expanded'), 5000);
	}, 500));
	undo.addEventListener('pointerup', () => clearTimeout(undoT));

	for (const b of bar.querySelectorAll('button')) {
		// do not steal focus from the editor: without this, copy loses the selection
		b.addEventListener('pointerdown', e => e.preventDefault());
		b.addEventListener('click', () => {
			b.classList.add('hit');
			setTimeout(() => b.classList.remove('hit'), 140);
			act[b.dataset.act]?.(b);
		});
	}
	syncWrapIcon();

	// lift the bar when the keyboard comes up
	const vv = window.visualViewport;
	if (!vv) return;
	const lift = () => {
		const gap = Math.max(0, innerHeight - (vv.height + vv.offsetTop));
		const kb = gap > 40 ? gap : 0;
		// the iPhone floating bar positions itself from this variable in the CSS
		if (kb === lift.kb) return;
		lift.kb = kb;
		document.documentElement.style.setProperty('--kb', kb + 'px');
		refreshAll();
		// the wide bar (iPad in split view) keeps growing from the bottom
		bar.style.paddingBottom = (kb && innerWidth > 480) ? `${kb + 7}px` : '';
	};
	vv.addEventListener('resize', lift);
	vv.addEventListener('scroll', lift);
}

/* ── shortcuts ─────────────────────────────── */

function initKeys() {
	document.addEventListener('keydown', e => {
		const mod = e.metaKey || e.ctrlKey;
		const k = e.key.toLowerCase();

		if (k === 'escape') {
			if (!$('#thememodal').hidden) { document.documentElement.dataset.theme = S.theme; $('#thememodal').hidden = true; return; }
			if (!$('#dialog').hidden) { $('#dialog').hidden = true; return; }
			if ($('#search').contains(document.activeElement)) { toggleSearch(false); PANES[S.focus].cm.focus(); return; }
		}
		if (!mod) return;

		if (e.shiftKey && k === 't') { e.preventDefault(); return openDialog(); }
		if (e.shiftKey && k === 'a') { e.preventDefault(); return openCheatsheet(); }
		if (e.shiftKey && k === 'k') { e.preventDefault(); return toggleKbLock(); }
		if (e.shiftKey && k === 'h') { e.preventDefault(); return toggleHidden(); }
		if (e.shiftKey && k === 'p') { e.preventDefault(); return togglePreview(); }
		if (e.shiftKey && k === 's') { e.preventDefault(); return exportFolder(); }
		if (e.shiftKey && k === 'n') { e.preventDefault(); return newEntry(S.active, true); }
		if (e.shiftKey) return;

		switch (k) {
			case 'b': e.preventDefault(); toggleSidebar(); break;
			case 'f': e.preventDefault(); toggleSearch(); break;
			case 's': e.preventDefault(); saveActive(); break;
			case 'k': e.preventDefault(); toggleWrap(); break;
			case 'o': e.preventDefault(); openDialog(); break;
			case 'w': e.preventDefault(); if (PANES[S.focus].active) closeTab(PANES[S.focus], PANES[S.focus].active); break;
			case '\\': e.preventDefault(); toggleSplit(); break;
			case 'n': e.preventDefault(); newEntry(S.active, false); break;
			case 'd': e.preventDefault(); toggleSplit(); break;
			case 'g': e.preventDefault(); gotoLine(); break;
			case ',': e.preventDefault(); cycleTab(-1); break;
			case '.': e.preventDefault(); cycleTab(1); break;
			case 'c': case 'x': case 'v':
				if (e.ctrlKey && !e.metaKey) { e.preventDefault(); clipboard(k); }
				break;
			case 'e': {
				e.preventDefault();
				if (PANES[1].el.hidden) toggleSplit(true);
				const other = S.focus === 0 ? 1 : 0;
				setFocus(other);
				PANES[other].cm.focus();
				break;
			}
			case '1': e.preventDefault(); setFocus(0); PANES[0].cm.focus(); break;
			case '2': e.preventDefault(); if (PANES[1].el.hidden) toggleSplit(true); setFocus(1); PANES[1].cm.focus(); break;
			default:
				toast(`unbound: key="${e.key}" code="${e.code}" ctrl=${e.ctrlKey} meta=${e.metaKey}`);
		}
	});
}

/* ── boot ──────────────────────────────────── */

(async function init() {
	if (typeof CodeMirror === 'undefined') {
		alert('CodeMirror did not load — check your connection to the CDN');
		return;
	}
	buildPane(0);
	buildPane(1);
	applySizes();
	initResizers();
	initKeys();
	initMobar();
	PANES.forEach(applyKbLock);
	syncKbRow();
	$('#kbrow').addEventListener('click', toggleKbLock);
	$('#previewrow').addEventListener('click', () => togglePreview());
	$('#logoutrow').addEventListener('click', () => api('logout').then(() => location.reload()));
	$('#themerow').addEventListener('click', openThemeModal);
	$('#thememodal').addEventListener('pointerdown', e => { if (e.target.id === 'thememodal') { document.documentElement.dataset.theme = S.theme; $('#thememodal').hidden = true; } });
	$('#collectrow').addEventListener('click', collectCode);
	setFocus(0);

	$('#rootbar').addEventListener('click', openDialog);

	$('#trashrow').addEventListener('click', () => {
		const el = $('#trashrow');
		if (el._skipClick) { el._skipClick = false; return; }
		const list = $('#trashlist');
		list.hidden = !list.hidden;
		el.classList.toggle('open', !list.hidden);
		if (!list.hidden) loadTrash();
	});
	bindMenu($('#trashrow'), () => [
		{ label: 'Empty trash', icon: 'trash', danger: true, run: async () => {
				const ok = await confirmBox('Everything in the trash will be gone for good. There is no undo.', 'Empty');
				if (!ok) return;
				try { await api('purge', { root: S.active }); } catch (e) { return toast(e.message); }
				loadTrash();
			} }
	]);
	bindMenu($('#tree'), () => [
		{ label: 'New file', icon: 'newfile', run: () => newEntry(S.active, false) },
		{ label: 'New folder', icon: 'newfolder', run: () => newEntry(S.active, true) },
		{ label: 'Add project', icon: 'plus', run: openDialog },
		{ label: 'Download', icon: 'download', run: exportFolder }
	], { skip: '.row, .roothead' });
	$('#dialog').addEventListener('pointerdown', e => { if (e.target.id === 'dialog') $('#dialog').hidden = true; });
	$('#dpath').addEventListener('keydown', e => {
		if (e.key !== 'Enter') return;
		const v = $('#dpath').value.trim();
		if (v) chooseDir(v); else $('#dialog').hidden = true;
	});

	$('#dmore').addEventListener('click', () => {
		const btn = $('#dmore');
		if (menuEl && menuEl._anchor === btn) return closeMenu();
		const r = btn.getBoundingClientRect();
		showMenu(r.left, r.bottom + 4, dialogMoreMenu(), { anchor: btn });
	});
	$('#dnewfolder').addEventListener('click', dialogNewFolder);

	const toDialog = upTo(() => DPATH);
	$('#dupload').addEventListener('click', () => $('#dfile').click());
	onFiles($('#dfile'), toDialog);
	onDropFiles($('#dlist'), toDialog);

	const toRoot = upTo(() => S.active, () => reloadDir(S.active));
	$('#dropzone').addEventListener('click', () => $('#sfile').click());
	onFiles($('#sfile'), toRoot);
	onDropFiles($('#dropzone'), toRoot);

	$('#q').addEventListener('focus', () => { if ($('#q').value) { $('#q').value = ''; $('#results').innerHTML = ''; } });
	$('#q').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 280); });
	$('#q').addEventListener('keydown', e => {
		if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); clearTimeout(searchTimer); runSearch(true); }
	});
	$('#q').addEventListener('input', () => {
		const t = $('#q');
		t.style.height = 'auto';
		t.style.height = Math.min(t.scrollHeight, 120) + 'px';
	});

	// saved state
	$('#sidebar').hidden = !S.sidebar;
	$('.gutter[data-resize="sidebar"]').hidden = !S.sidebar;
	$('#search').hidden = !S.search;
	$('.gutter[data-resize="search"]').hidden = !S.search;

	const saved = JSON.parse(localStorage.getItem(LS) || '{}');
	if (S.roots.length) {
		await reopenRoots(S.roots.slice(), S.active);
		if (saved.tabs) {
			for (const [i, p] of saved.tabs.entries()) {
				if (!p.paths?.length) continue;
				if (i === 1) toggleSplit(true);
				for (const path of p.paths) await openFile(path, i).catch(() => {});
				if (p.active) { const t = PANES[i].tabs.find(t => t.path === p.active); if (t) activate(PANES[i], t); }
			}
			setFocus(0);
		}
	} else {
		openDialog();
	}

	window.addEventListener('beforeunload', e => {
		if ([...FILES.values()].some(f => f.dirty)) { e.preventDefault(); e.returnValue = ''; }
	});
	window.addEventListener('resize', refreshAll);
	window.addEventListener('orientationchange', () => setTimeout(refreshAll, 250));
	document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshAll(); });
})();
