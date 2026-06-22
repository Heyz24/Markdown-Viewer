// ============================================================
// MDViewer renderer — multi-file editor with CodeMirror, live
// preview (mermaid/katex/highlight/emoji/footnotes), file tree
// sidebar, tabs, outline panel, find & replace, themes.
// ============================================================

// If anything in this script throws during startup, show it directly in
// the page instead of leaving a silent blank window with no clue why —
// press F12 / Ctrl+Shift+I for the full console, but this banner alone
// is usually enough to tell what broke and where.
window.addEventListener('error', (e) => {
  showFatalError(e.error || e.message, e.filename, e.lineno);
});
window.addEventListener('unhandledrejection', (e) => {
  showFatalError(e.reason);
});

function showFatalError(err, filename, lineno) {
  let banner = document.getElementById('fatalErrorBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'fatalErrorBanner';
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#5a1d1d;color:#fff;padding:10px 16px;font:13px/1.5 Consolas,monospace;z-index:9999;white-space:pre-wrap;max-height:40vh;overflow-y:auto;border-bottom:2px solid #f48771;';
    document.body.appendChild(banner);
  }
  const msg = (err && err.stack) ? err.stack : String(err);
  const location = filename ? `\n(${filename}:${lineno})` : '';
  banner.textContent = 'MDViewer hit an error and may not work correctly:\n' + msg + location + '\n\nPress F12 for full details.';
}

// ---- Tab/document state ----
// Each open document: { path, content, dirty, cmDoc (CodeMirror.Doc) }
let tabs = [];
let activeTabIdx = -1;
let folderRoot = null;
let mermaidCounter = 0;
let renderTimer = null;

const els = {
  sidebar: document.getElementById('sidebar'),
  fileTree: document.getElementById('fileTree'),
  sidebarRootName: document.getElementById('sidebarRootName'),
  tabBar: document.getElementById('tabBar'),
  editorHost: document.getElementById('editorHost'),
  preview: document.getElementById('preview'),
  outlinePanel: document.getElementById('outlinePanel'),
  outlineList: document.getElementById('outlineList'),
  container: document.getElementById('container'),
  filenameEl: document.getElementById('filename'),
  contextMenu: document.getElementById('contextMenu'),
  modalOverlay: document.getElementById('modalOverlay'),
  modalTitle: document.getElementById('modalTitle'),
  modalInput: document.getElementById('modalInput'),
  modalOk: document.getElementById('modalOk'),
  modalCancel: document.getElementById('modalCancel')
};

// ---- CodeMirror editor setup ----
const cm = CodeMirror(els.editorHost, {
  mode: 'markdown',
  theme: 'default',
  lineWrapping: true,
  lineNumbers: false,
  styleActiveLine: true,
  extraKeys: {
    'Enter': 'newlineAndIndentContinueMarkdownList',
    'Ctrl-F': () => openFind(),
    'Ctrl-H': () => openFind(true)
  }
});

// ---- Theme ----
let isDark = true;
function applyTheme() {
  document.body.classList.toggle('theme-dark', isDark);
  document.body.classList.toggle('theme-light', !isDark);
  document.getElementById('btnTheme').textContent = isDark ? '🌙' : '☀️';
  if (window.mermaid) {
    mermaid.initialize({ startOnLoad: false, theme: isDark ? 'dark' : 'default', securityLevel: 'strict' });
  }
  scheduleRender();
}
document.getElementById('btnTheme').addEventListener('click', () => { isDark = !isDark; applyTheme(); });

if (window.mermaid) {
  mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'strict' });
}

// ---- Markdown rendering pipeline ----

if (window.markedFootnote) marked.use(window.markedFootnote());

function escapeHtmlFallback(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Resolve relative image paths against the active tab's folder, so <img
// src=...> finds the file on disk instead of resolving relative to the
// app's own internal index.html.
function resolveImageSrc(src) {
  if (!src) return src;
  const isAbsolute = /^([a-zA-Z]+:|\/|\\\\)/.test(src);
  const tab = tabs[activeTabIdx];
  if (!tab || !tab.path || isAbsolute) return src;
  const dir = tab.path.replace(/[\\/][^\\/]*$/, '');
  const normalizedSrc = src.replace(/\\/g, '/').replace(/^\.\//, '');
  const fullPath = dir.replace(/\\/g, '/') + '/' + normalizedSrc;
  return 'file:///' + fullPath.replace(/^\/+/, '');
}

// Inverse of resolveImageSrc: given an absolute image path (e.g. from the
// sidebar tree), produce a path relative to the active document's folder
// when both live under the same project root, so inserted markdown stays
// portable instead of hardcoding an absolute path tied to one machine.
function makeRelativeToActiveDoc(absPath) {
  const tab = tabs[activeTabIdx];
  const normalizedAbs = absPath.replace(/\\/g, '/');
  if (!tab || !tab.path) return normalizedAbs;
  const dir = tab.path.replace(/\\/g, '/').replace(/[\\/][^\\/]*$/, '');
  if (normalizedAbs.toLowerCase().startsWith(dir.toLowerCase() + '/')) {
    return normalizedAbs.slice(dir.length + 1);
  }
  return normalizedAbs;
}

const customRenderer = new marked.Renderer();

customRenderer.code = function (code, infostring) {
  const lang = (infostring || '').trim().split(/\s+/)[0];
  if (lang === 'mermaid') {
    const id = 'mermaid-' + (mermaidCounter++);
    const escaped = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<div class="mermaid" id="${id}">${escaped}</div>`;
  }
  const highlighted = (window.miniHighlight && lang) ? window.miniHighlight(code, lang) : escapeHtmlFallback(code);
  return `<pre><code class="hljs lang-${lang || 'plain'}">${highlighted}</code></pre>`;
};

customRenderer.image = function (href, title, text) {
  const resolved = resolveImageSrc(href);
  const titleAttr = title ? ` title="${title}"` : '';
  return `<img src="${resolved}" alt="${text || ''}"${titleAttr}>`;
};

marked.setOptions({ renderer: customRenderer, gfm: true, breaks: false });

function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(render, 80);
}

function render() {
  const tab = tabs[activeTabIdx];
  let src = tab ? tab.content : '';
  if (window.replaceEmojiShortcodes) src = window.replaceEmojiShortcodes(src);
  els.preview.innerHTML = marked.parse(src);
  makeCheckboxesInteractive();
  renderMermaidBlocks();
  renderMath();
  buildOutline();
}

function renderMath() {
  if (!window.renderMathInElement) return;
  try {
    renderMathInElement(els.preview, {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '$', right: '$', display: false }
      ],
      throwOnError: false
    });
  } catch (e) { /* malformed LaTeX — leave raw text visible */ }
}

function renderMermaidBlocks() {
  if (!window.mermaid) return;
  const nodes = els.preview.querySelectorAll('div.mermaid');
  if (!nodes.length) return;
  mermaid.run({ nodes: Array.from(nodes) }).catch(err => {
    nodes.forEach(n => {
      if (!n.querySelector('svg')) {
        n.innerHTML = `<div class="mermaid-error">Diagram error: ${escapeHtmlFallback(err.message || String(err))}</div>`;
      }
    });
  });
}

// GFM task list checkboxes are rendered disabled by marked; re-enable them
// and sync clicks back into the raw markdown source.
function makeCheckboxesInteractive() {
  const boxes = els.preview.querySelectorAll('li input[type="checkbox"]');
  boxes.forEach((box, idx) => {
    box.disabled = false;
    box.dataset.idx = idx;
    box.onchange = onCheckboxToggle;
  });
}

function onCheckboxToggle(e) {
  const idx = Number(e.target.dataset.idx);
  const checked = e.target.checked;
  const tab = tabs[activeTabIdx];
  if (!tab) return;
  const lines = tab.content.split('\n');
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*[-*+]\s+)\[([ xX])\](.*)$/);
    if (m) {
      if (count === idx) {
        lines[i] = m[1] + '[' + (checked ? 'x' : ' ') + ']' + m[3];
        break;
      }
      count++;
    }
  }
  const newContent = lines.join('\n');
  tab.content = newContent;
  cm.setValue(newContent);
  markDirty(tab);
  render();
}

// Outline panel: walk the rendered preview headings and build a clickable TOC
function buildOutline() {
  const headings = els.preview.querySelectorAll('h1, h2, h3, h4, h5, h6');
  els.outlineList.innerHTML = '';
  headings.forEach((h, i) => {
    if (!h.id) h.id = 'heading-' + i;
    const level = Number(h.tagName[1]);
    const item = document.createElement('div');
    item.className = 'outline-item outline-level-' + level;
    item.textContent = h.textContent;
    item.addEventListener('click', () => h.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    els.outlineList.appendChild(item);
  });
}

// ---- Tab management ----

function findTabByPath(filePath) {
  return tabs.findIndex(t => t.path === filePath);
}

function openInTab(filePath, content) {
  const existing = findTabByPath(filePath);
  if (existing !== -1) {
    switchToTab(existing);
    return;
  }
  tabs.push({ path: filePath, content: content, dirty: false });
  switchToTab(tabs.length - 1);
}

function openUntitledTab() {
  tabs.push({ path: null, content: '', dirty: false, untitledName: nextUntitledName() });
  switchToTab(tabs.length - 1);
}

let untitledCounter = 1;
function nextUntitledName() {
  return `Untitled-${untitledCounter++}.md`;
}

let suppressChangeEvent = false;

function switchToTab(idx) {
  // Persist current editor content back into the outgoing tab before switching
  if (activeTabIdx !== -1 && tabs[activeTabIdx]) {
    tabs[activeTabIdx].content = cm.getValue();
  }
  activeTabIdx = idx;
  const tab = tabs[idx];
  suppressChangeEvent = true;
  cm.setValue(tab.content || '');
  cm.clearHistory();
  suppressChangeEvent = false;
  cm.refresh();
  renderTabBar();
  setTitle();
  render();
  highlightActiveTreeRow();
}

function closeTab(idx, force) {
  const tab = tabs[idx];
  if (!force && tab.dirty) {
    const proceed = confirm(`"${tabName(tab)}" has unsaved changes. Close anyway?`);
    if (!proceed) return;
  }
  tabs.splice(idx, 1);
  if (tabs.length === 0) {
    openUntitledTab();
    return;
  }
  if (activeTabIdx >= tabs.length) activeTabIdx = tabs.length - 1;
  if (idx <= activeTabIdx) activeTabIdx = Math.max(0, activeTabIdx);
  switchToTab(Math.min(activeTabIdx, tabs.length - 1));
}

function tabName(tab) {
  if (tab.path) return tab.path.split(/[\\/]/).pop();
  return tab.untitledName || 'Untitled.md';
}

function renderTabBar() {
  els.tabBar.innerHTML = '';
  tabs.forEach((tab, idx) => {
    const el = document.createElement('div');
    el.className = 'tab' + (idx === activeTabIdx ? ' active' : '');
    const label = document.createElement('span');
    label.textContent = (tab.dirty ? '● ' : '') + tabName(tab);
    el.appendChild(label);
    const closeBtn = document.createElement('span');
    closeBtn.className = 'tab-close';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', (e) => { e.stopPropagation(); closeTab(idx); });
    el.appendChild(closeBtn);
    el.addEventListener('click', () => switchToTab(idx));
    els.tabBar.appendChild(el);
  });
}

function markDirty(tab) {
  if (!tab.dirty) {
    tab.dirty = true;
    renderTabBar();
    setTitle();
  }
}

function setTitle() {
  const tab = tabs[activeTabIdx];
  const label = tab ? (tab.dirty ? '● ' : '') + tabName(tab) : 'Untitled.md';
  els.filenameEl.textContent = label;
  document.title = (tab && tab.dirty ? '● ' : '') + (tab ? tabName(tab) : 'Untitled.md') + ' — MDViewer';
}

cm.on('change', () => {
  if (suppressChangeEvent) return;
  const tab = tabs[activeTabIdx];
  if (!tab) return;
  const newValue = cm.getValue();
  // Defense in depth: even if something ever calls setValue() without going
  // through the suppression flag (e.g. a CodeMirror-internal deferred event
  // from clearHistory/refresh), a value that's identical to what's already
  // stored is never a real edit and must never mark the tab dirty or kick
  // off an autosave — only an actual content difference counts as a change.
  if (newValue === tab.content) return;
  tab.content = newValue;
  markDirty(tab);
  scheduleRender();
});

// ---- Open / Save handlers ----

window.api.onOpenFile(({ path, content }) => {
  // If the only open tab is the blank starting "Untitled" tab with no edits,
  // replace it instead of stacking a second tab next to it — this is the
  // common case when launching via double-click / file association.
  if (tabs.length === 1 && tabs[0].path === null && !tabs[0].dirty && tabs[0].content === '') {
    tabs.pop();
  }
  openInTab(path, content);
});

document.getElementById('btnOpen').addEventListener('click', async () => {
  const res = await window.api.openFileDialog();
  if (res) openInTab(res.path, res.content);
});

document.getElementById('btnSave').addEventListener('click', async () => {
  const tab = tabs[activeTabIdx];
  if (!tab) return;
  tab.content = cm.getValue();
  const saved = await window.api.save({ path: tab.path, content: tab.content });
  if (saved) {
    tab.path = saved;
    tab.dirty = false;
    renderTabBar();
    setTitle();
  }
});

// Warn before app close if any tab has unsaved changes
window.api.onCheckUnsavedBeforeClose(() => {
  const anyDirty = tabs.some(t => t.dirty);
  if (!anyDirty || confirm('You have unsaved changes. Close MDViewer anyway?')) {
    window.api.confirmClose();
  }
});

// ---- File tree sidebar ----

document.getElementById('btnToggleSidebar').addEventListener('click', () => {
  els.sidebar.classList.toggle('collapsed');
});

document.getElementById('btnOpenFolder').addEventListener('click', async () => {
  const res = await window.api.openFolder();
  if (!res) return;
  folderRoot = res.root;
  els.sidebarRootName.textContent = res.root.split(/[\\/]/).pop();
  renderFileTree(res.tree);
});

async function refreshTree() {
  if (!folderRoot) return;
  const res = await window.api.refreshFolder(folderRoot);
  renderFileTree(res.tree);
}

function renderFileTree(tree) {
  els.fileTree.innerHTML = '';
  els.fileTree.appendChild(buildTreeDOM(tree, 0));
  highlightActiveTreeRow();
}

// Highlights whichever sidebar row corresponds to the currently active tab,
// so it's visually clear which open file you're looking at.
function highlightActiveTreeRow() {
  const activeTab = tabs[activeTabIdx];
  els.fileTree.querySelectorAll('.tree-row.active').forEach(r => r.classList.remove('active'));
  if (!activeTab || !activeTab.path) return;
  const row = els.fileTree.querySelector(`.tree-row[data-path="${cssEscape(activeTab.path)}"]`);
  if (row) row.classList.add('active');
}

function cssEscape(s) {
  return s.replace(/["\\]/g, '\\$&');
}

function buildTreeDOM(nodes, depth) {
  const container = document.createElement('div');
  nodes.forEach(node => {
    const row = document.createElement('div');
    row.className = 'tree-row tree-' + node.type;
    row.style.paddingLeft = (10 + depth * 14) + 'px';
    row.dataset.path = node.path;
    row.dataset.type = node.type;

    const icon = node.type === 'folder' ? '📁' : node.type === 'image' ? '🖼️' : '📄';
    row.textContent = icon + ' ' + node.name;

    if (node.type === 'folder') {
      row.addEventListener('click', () => {
        const childWrap = row.nextSibling;
        if (childWrap) childWrap.classList.toggle('hidden');
      });
      container.appendChild(row);
      const childWrap = buildTreeDOM(node.children, depth + 1);
      container.appendChild(childWrap);
    } else if (node.type === 'file') {
      row.addEventListener('click', async () => {
        const res = await window.api.readFile(node.path);
        if (res) openInTab(res.path, res.content);
      });
      row.addEventListener('contextmenu', (e) => showContextMenu(e, node.path));
      container.appendChild(row);
    } else {
      // image — clicking inserts a reference into the active editor
      row.addEventListener('click', () => {
        const relPath = makeRelativeToActiveDoc(node.path);
        insertAtCursor(`![${node.name.replace(/\.[^.]+$/, '')}](${relPath})\n`);
      });
      row.addEventListener('contextmenu', (e) => showContextMenu(e, node.path));
      container.appendChild(row);
    }
  });
  return container;
}

// Right-click context menu: rename / delete
let contextMenuTargetPath = null;
function showContextMenu(e, filePath) {
  e.preventDefault();
  contextMenuTargetPath = filePath;
  els.contextMenu.style.left = e.pageX + 'px';
  els.contextMenu.style.top = e.pageY + 'px';
  els.contextMenu.classList.remove('hidden');
}
document.addEventListener('click', () => els.contextMenu.classList.add('hidden'));

els.contextMenu.addEventListener('click', async (e) => {
  const action = e.target.dataset.action;
  if (!action || !contextMenuTargetPath) return;
  if (action === 'rename') {
    const oldName = contextMenuTargetPath.split(/[\\/]/).pop();
    openModal('rename', { currentName: oldName, targetPath: contextMenuTargetPath });
  } else if (action === 'delete') {
    const res = await window.api.deleteFile(contextMenuTargetPath);
    if (res && res.deleted) {
      const tabIdx = findTabByPath(contextMenuTargetPath);
      if (tabIdx !== -1) closeTab(tabIdx, true);
      refreshTree();
    } else if (res && res.error) {
      alert(res.error);
    }
  }
});

// New file / new folder / rename modal
let modalMode = null; // 'file' | 'folder' | 'rename'
let renameTargetPath = null;
document.getElementById('btnNewFile').addEventListener('click', () => openModal('file'));
document.getElementById('btnNewFolder').addEventListener('click', () => openModal('folder'));

function openModal(mode, opts) {
  if (mode !== 'rename' && !folderRoot) { alert('Open a folder first.'); return; }
  modalMode = mode;
  if (mode === 'file') {
    els.modalTitle.textContent = 'New File';
    els.modalInput.value = 'untitled.md';
  } else if (mode === 'folder') {
    els.modalTitle.textContent = 'New Folder';
    els.modalInput.value = 'new-folder';
  } else if (mode === 'rename') {
    els.modalTitle.textContent = 'Rename';
    els.modalInput.value = opts.currentName;
    renameTargetPath = opts.targetPath;
  }
  els.modalOverlay.classList.remove('hidden');
  els.modalInput.focus();
  els.modalInput.select();
}

function closeModal() { els.modalOverlay.classList.add('hidden'); }
els.modalCancel.addEventListener('click', closeModal);
els.modalOverlay.addEventListener('click', (e) => { if (e.target === els.modalOverlay) closeModal(); });

els.modalOk.addEventListener('click', async () => {
  const name = els.modalInput.value.trim();
  if (!name) return;
  if (modalMode === 'file') {
    const res = await window.api.createFile({ dirPath: folderRoot, name });
    if (res.error) alert(res.error);
    else { closeModal(); await refreshTree(); const fileRes = await window.api.readFile(res.path); openInTab(fileRes.path, fileRes.content); }
  } else if (modalMode === 'folder') {
    const res = await window.api.createSubfolder({ dirPath: folderRoot, name });
    if (res.error) alert(res.error);
    else { closeModal(); await refreshTree(); }
  } else if (modalMode === 'rename') {
    const oldName = renameTargetPath.split(/[\\/]/).pop();
    if (name === oldName) { closeModal(); return; }
    const res = await window.api.renameFile({ oldPath: renameTargetPath, newName: name });
    if (res && res.error) { alert(res.error); return; }
    closeModal();
    const tabIdx = findTabByPath(renameTargetPath);
    if (tabIdx !== -1) { tabs[tabIdx].path = res.path; renderTabBar(); setTitle(); }
    await refreshTree();
  }
});
els.modalInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') els.modalOk.click(); });

// ---- Preview mode toggle: Split / Editor / Preview ----
const modes = ['', 'editor-only', 'preview-only'];
const modeLabels = { '': 'Split', 'editor-only': 'Editor', 'preview-only': 'Preview' };
let modeIdx = 0;
document.getElementById('btnTogglePreview').addEventListener('click', () => {
  modeIdx = (modeIdx + 1) % modes.length;
  els.container.className = modes[modeIdx];
  document.getElementById('btnTogglePreview').textContent = 'Preview: ' + modeLabels[modes[modeIdx]];
  cm.refresh();
});

// ---- Outline panel toggle ----
document.getElementById('btnOutline').addEventListener('click', () => {
  els.outlinePanel.classList.toggle('hidden');
});

// ---- Find & Replace (CodeMirror's built-in dialog-based search addon) ----
function openFind(withReplace) {
  cm.focus();
  cm.execCommand(withReplace ? 'replace' : 'find');
}
document.getElementById('btnFind').addEventListener('click', () => openFind(false));

// ---- Export menu ----
const exportBtn = document.getElementById('btnExport');
const exportMenu = document.getElementById('exportMenu');
exportBtn.addEventListener('click', (e) => { e.stopPropagation(); exportMenu.classList.toggle('hidden'); });
document.addEventListener('click', () => exportMenu.classList.add('hidden'));

// KaTeX CSS is inlined at export time (read once, cached) so exported HTML
// never depends on a CDN — keeping the "fully offline" guarantee intact.
// Font glyph files aren't embedded (would bloat exported HTML significantly);
// math symbols fall back to default styling without the icon fonts when the
// exported file is opened with zero internet access, but layout/sizing still
// applies correctly since that's pure CSS, not font-dependent.
let katexCssCache = null;
async function getKatexCss() {
  if (katexCssCache !== null) return katexCssCache;
  try {
    const res = await fetch('katex/katex.min.css');
    katexCssCache = await res.text();
  } catch (e) {
    katexCssCache = '';
  }
  return katexCssCache;
}

function fullHtmlTemplate(bodyHtml, title, katexCss) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>${katexCss}</style>
<style>
body{font-family:-apple-system,Segoe UI,sans-serif;max-width:800px;margin:40px auto;padding:0 20px;line-height:1.65;color:#222;}
code{background:#f2f2f2;padding:2px 5px;border-radius:4px;font-family:Consolas,monospace;}
pre{background:#f2f2f2;padding:12px;border-radius:6px;overflow-x:auto;}
pre code{background:none;padding:0;}
blockquote{border-left:3px solid #4fa3ff;margin:0;padding-left:12px;color:#555;}
table{border-collapse:collapse;width:100%;}
th,td{border:1px solid #ddd;padding:6px 10px;}
img{max-width:100%;}
h1,h2,h3{border-bottom:1px solid #eee;padding-bottom:6px;}
</style></head><body>${bodyHtml}</body></html>`;
}

function baseName() {
  const tab = tabs[activeTabIdx];
  const name = tab ? tabName(tab) : 'Untitled.md';
  return name.replace(/\.[^.]+$/, '');
}

function buildDocxParagraphs() {
  const paragraphs = [];
  const headingMap = { H1: 1, H2: 2, H3: 3, H4: 4, H5: 5, H6: 6 };
  els.preview.childNodes.forEach(node => {
    if (node.nodeType !== 1) return;
    const tag = node.tagName;
    if (headingMap[tag]) {
      paragraphs.push({ text: node.textContent, heading: headingMap[tag] });
    } else if (tag === 'PRE') {
      node.textContent.split('\n').forEach(line => paragraphs.push({ text: line, code: true }));
    } else if (tag === 'UL' || tag === 'OL') {
      node.querySelectorAll('li').forEach(li => paragraphs.push({ text: '• ' + li.textContent }));
    } else if (tag === 'TABLE') {
      node.querySelectorAll('tr').forEach(tr => {
        const cells = [...tr.children].map(c => c.textContent).join(' | ');
        paragraphs.push({ text: cells });
      });
    } else {
      paragraphs.push({ text: node.textContent });
    }
  });
  return paragraphs;
}

exportMenu.addEventListener('click', async (e) => {
  const fmt = e.target.dataset.fmt;
  if (!fmt) return;
  exportMenu.classList.add('hidden');
  const name = baseName();

  if (fmt === 'html') {
    const css = await getKatexCss();
    const full = fullHtmlTemplate(els.preview.innerHTML, name, css);
    await window.api.saveAs({ content: full, defaultName: name + '.html', filters: [{ name: 'HTML', extensions: ['html'] }] });
  } else if (fmt === 'txt') {
    await window.api.saveAs({ content: els.preview.innerText, defaultName: name + '.txt', filters: [{ name: 'Text', extensions: ['txt'] }] });
  } else if (fmt === 'pdf') {
    const css = await getKatexCss();
    const full = fullHtmlTemplate(els.preview.innerHTML, name, css);
    await window.api.exportPdf({ html: full, defaultName: name + '.pdf' });
  } else if (fmt === 'print') {
    const css = await getKatexCss();
    const full = fullHtmlTemplate(els.preview.innerHTML, name, css);
    await window.api.exportPrintPreview({ html: full });
  } else if (fmt === 'docx') {
    const paragraphs = buildDocxParagraphs();
    await window.api.exportDocx({ paragraphs, defaultName: name + '.docx' });
  }
});

// ---- Image insertion (button, drag-drop, paste) ----

function insertAtCursor(text) {
  const cursor = cm.getCursor();
  cm.replaceRange(text, cursor);
  cm.focus();
}

document.getElementById('btnInsertImage').addEventListener('click', async () => {
  const res = await window.api.pickImage();
  if (res) insertAtCursor(`![${res.altSuggestion}](${res.path})\n`);
});

els.editorHost.addEventListener('dragover', (e) => e.preventDefault());
els.editorHost.addEventListener('drop', (e) => {
  e.preventDefault();
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if (file && /\.(png|jpe?g|gif|svg|webp|bmp)$/i.test(file.name)) {
    const alt = file.name.replace(/\.[^.]+$/, '');
    insertAtCursor(`![${alt}](${file.path.replace(/\\/g, '/')})\n`);
  }
});

els.editorHost.addEventListener('paste', async (e) => {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      const blob = item.getAsFile();
      const buffer = await blob.arrayBuffer();
      const tab = tabs[activeTabIdx];
      const res = await window.api.saveClipboardImage({
        data: Array.from(new Uint8Array(buffer)),
        currentPath: tab ? tab.path : null,
        ext: item.type.split('/')[1] || 'png'
      });
      if (res) insertAtCursor(`![pasted-image](${res.path.replace(/\\/g, '/')})\n`);
      break;
    }
  }
}, true);

// ---- Keyboard shortcuts ----
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 's') { e.preventDefault(); document.getElementById('btnSave').click(); }
  if (e.ctrlKey && e.key === 'o') { e.preventDefault(); document.getElementById('btnOpen').click(); }
});

// ---- Init ----
applyTheme();

// Ask main process for a launch file (double-click / file association)
// BEFORE creating the default Untitled tab. The previous approach created
// an empty tab first and then swapped it for the real file once the async
// IPC call resolved — that meant calling cm.setValue('') immediately
// followed by cm.setValue(realContent) a few milliseconds later, two
// separate CodeMirror operations firing back to back while the editor was
// still completing its very first layout pass. That double mutation is
// the suspected cause of the corrupted/blank render seen only on
// double-click launch (never on in-app Open, which only ever calls
// setValue once on an editor that's long since settled). Checking first
// and only ever calling setValue() once, with the right content from the
// start, removes the double-mutation entirely rather than racing it.
// Wait for one full paint cycle after CodeMirror's construction before the
// very first setValue() call. The old plain-<textarea> version (1.0.0)
// never had this problem because a textarea has no internal layout/
// measurement system to settle — setting .value was instantaneous with no
// side effects. CodeMirror, with lineWrapping enabled, does real line
// measurement work on construction; calling setValue() with real content
// before that settles is the suspected cause of the corrupted render seen
// specifically on double-click launch (in-app Open never hit this because
// the editor was already long-settled by the time a user could click it).
requestAnimationFrame(() => {
  window.api.getInitialFile().then((res) => {
    if (res) {
      openInTab(res.path, res.content);
    } else {
      openUntitledTab();
    }
  }).catch(() => {
    openUntitledTab();
  });
});
