<?php require __DIR__ . '/auth.php'; k_gate(); $editor = true; ?>
<!doctype html>
<html lang="en">
<head>
<?php require __DIR__ . '/head.php'; ?>
</head>
<body>

<script>
// any JS error shows up on screen: there is no console on an iPad
window.addEventListener('error', e => {
	const box = document.createElement('pre');
	box.style.cssText = 'position:fixed;inset:0;z-index:9999;margin:0;padding:18px;overflow:auto;' +
		'background:#1a1a18;color:#c45a5a;font:12px/1.6 ui-monospace,Menlo,monospace;white-space:pre-wrap';
	box.textContent = 'ERROR\n\n' + e.message + '\n\n' +
		(e.filename || '') + '  line ' + e.lineno + ', col ' + e.colno;
	(document.body || document.documentElement).appendChild(box);
});
</script>

<div id="app">
	<div id="main">

		<aside id="sidebar">
			<header id="rootbar" title="Change folder (⌘O)"><span id="rootname">no folder</span></header>
			<div id="tree"></div>
			<div id="dropzone" title="Upload to the root folder">dropzone</div>
			<input id="sfile" type="file" multiple hidden>
			<footer id="sidefoot">
				<div id="previewrow" title="Preview the folder index (⌃⇧P)">
					<svg class="ki" viewBox="0 0 24 24"><circle cx="12" cy="12" r="7.5"/></svg>
					<span class="name">Preview</span>
				</div>
				<div id="kbrow" title="Lock the on-screen keyboard (⌃⇧K)">
					<svg class="ki" viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="2"/><line x1="6.5" y1="10" x2="6.5" y2="10"/><line x1="10" y1="10" x2="10" y2="10"/><line x1="13.5" y1="10" x2="13.5" y2="10"/><line x1="17" y1="10" x2="17" y2="10"/><line x1="6.5" y1="13.5" x2="6.5" y2="13.5"/><line x1="17" y1="13.5" x2="17" y2="13.5"/><line x1="9" y1="13.5" x2="15" y2="13.5"/></svg>
					<span class="name">Hardware keyboard</span>
				</div>
				<div id="collectrow" title="Collect the code into project.txt">
					<svg class="ki" viewBox="0 0 24 24"><path d="M6 3.5h8.5l3.5 3.5v13.5H6z"/><path d="M9 11h6M9 14h6M9 17h4"/></svg>
					<span class="name">Collect</span>
				</div>
				<div id="themerow" title="Change theme">
					<svg class="ki" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="8" r="1.2"/><circle cx="15.5" cy="12" r="1.2"/><circle cx="12" cy="16" r="1.2"/><circle cx="8.5" cy="12" r="1.2"/></svg>
					<span class="name">Theme</span>
				</div>
				<div id="logoutrow" title="Log out">
					<svg class="ki" viewBox="0 0 24 24"><path d="M14 4.5H6v15h8"/><line x1="10.5" y1="12" x2="19.5" y2="12"/><polyline points="16.5 8.5 20 12 16.5 15.5"/></svg>
					<span class="name">Log out</span>
				</div>
				<div id="trashrow"><span class="chev">▶</span><span class="name">trash</span><span class="count"></span></div>
				<div id="trashlist" hidden></div>
			</footer>
		</aside>
		<div class="gutter gutter-v" data-resize="sidebar"></div>

		<div id="panes">
			<section class="pane" data-pane="0">
				<div class="tabs"></div>
				<div class="editor"></div>
				<div class="empty">drag a file here</div>
			</section>
			<div class="gutter gutter-v" data-resize="pane" hidden></div>
			<section class="pane" data-pane="1" hidden>
				<div class="tabs"></div>
				<div class="editor"></div>
				<div class="empty">drag a file here</div>
			</section>
		</div>

	</div>

	<div class="gutter gutter-h" data-resize="search" hidden></div>
	<section id="search" hidden>
		<div id="searchbar"><textarea id="q" rows="1" spellcheck="false" autocomplete="off" placeholder="search in the folder — :line"></textarea></div>
		<div id="results"></div>
	</section>

</div>

<div id="thememodal" hidden>
	<div class="dialog-box">
		<div id="themelist"></div>
	</div>
</div>

<div id="dialog" hidden>
	<div class="dialog-box">
		<div id="dcrumb"></div>
		<div id="dtools">
			<div class="dtools-left">
				<button id="dnewfolder" type="button">+ folder</button>
				<button id="dupload" type="button">upload files</button>
				<input id="dfile" type="file" multiple hidden>
			</div>
			<button id="dmore" type="button">⋯</button>
		</div>
		<div id="dlist"></div>
		<div id="dherow"><div id="dhere">open</div><div id="dadd">add folder</div></div>
		<input id="dpath" type="text" spellcheck="false" autocomplete="off" placeholder="or type a path">
		<div id="drecent"></div>
	</div>
</div>

<nav id="mobar">
	<button data-act="sidebar" aria-label="Sidebar"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="9.5" y1="4" x2="9.5" y2="20"/></svg></button>
	<button data-act="search" aria-label="Search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><line x1="16" y1="16" x2="20.5" y2="20.5"/></svg></button>
	<button data-act="wrap" aria-label="Wrap lines"><svg viewBox="0 0 24 24"><line x1="4" y1="6.5" x2="20" y2="6.5"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17.5" x2="20" y2="17.5"/></svg></button>
	<button data-act="undo" aria-label="Undo"><svg viewBox="0 0 24 24"><path d="M4.5 10h10a4.75 4.75 0 0 1 0 9.5h-5.5"/><polyline points="8.5 6 4.5 10 8.5 14"/></svg></button>
	<button data-act="redo" aria-label="Redo"><svg viewBox="0 0 24 24"><path d="M19.5 10h-10a4.75 4.75 0 0 0 0 9.5h5.5"/><polyline points="15.5 6 19.5 10 15.5 14"/></svg></button>

	<button data-act="paste" aria-label="Paste"><svg viewBox="0 0 24 24"><path d="M9 5H7.5A1.5 1.5 0 0 0 6 6.5v12.5a1.5 1.5 0 0 0 1.5 1.5h9a1.5 1.5 0 0 0 1.5-1.5V6.5A1.5 1.5 0 0 0 16.5 5H15"/><rect x="9" y="3.5" width="6" height="3" rx="1"/></svg></button>
	<button data-act="save" aria-label="Save"><svg viewBox="0 0 24 24"><path d="M5 4.5h11l3 3v12H5z"/><path d="M8.5 4.5v5h7v-5"/><rect x="8.5" y="13" width="7" height="6.5"/></svg></button>
	<button data-act="kb" aria-label="Keyboard"></button>
<button data-act="refresh" aria-label="Reload"><svg viewBox="0 0 24 24"><polyline points="15.7 4 18.6 6.9 15.7 9.8"/><path d="M5.4 11.3V9.8a2.9 2.9 0 0 1 2.9-2.9h10.2"/><polyline points="8.4 20 5.4 17.1 8.4 14.2"/><path d="M18.6 12.7v1.5a2.9 2.9 0 0 1-2.9 2.9H5.4"/></svg></button>
<button data-act="fold" aria-label="Collapse">
<svg viewBox="0 0 24 24"><polyline points="8.5 6 14.5 12 8.5 18"/><polyline points="14.5 6 20.5 12 14.5 18"/></svg></button>
</nav>

<div id="confirm" hidden>
	<div class="confirm-box">
		<p id="confirm-text"></p>
		<div class="confirm-acts">
			<button id="confirm-no">Cancel</button>
			<button id="confirm-yes" class="danger">Delete</button>
		</div>
	</div>
</div>

<div id="toast" hidden></div>

<script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/codemirror.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/xml/xml.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/javascript/javascript.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/css/css.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/htmlmixed/htmlmixed.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/clike/clike.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/php/php.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/markdown/markdown.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/sql/sql.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/ruby/ruby.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/yaml/yaml.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/python/python.min.js"></script>

<script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/hint/show-hint.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/hint/xml-hint.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/hint/html-hint.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/hint/css-hint.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/hint/javascript-hint.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/hint/anyword-hint.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/edit/closebrackets.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/edit/closetag.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/edit/matchbrackets.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/selection/active-line.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/comment/comment.min.js"></script>

<script src="app.js?v=<?= @filemtime(__DIR__ . '/app.js') ?>"></script>
</body>
</html>
