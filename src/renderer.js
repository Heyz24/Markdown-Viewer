const editor = document.getElementById('editor');
const preview = document.getElementById('preview');
const filenameEl = document.getElementById('filename');
const container = document.getElementById('container');

let currentPath = null;
let dirty = false;
let mermaidCounter = 0;

// Initialize mermaid once, dark theme to match the app, manual rendering
// (we call mermaid.run() ourselves after each preview update).
if (window.mermaid) {
  mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'strict' });
}

// Custom renderer: fenced ```mermaid blocks become a div mermaid renders
// into; everything else gets our lightweight syntax highlighter.
const customRenderer = new marked.Renderer();
customRenderer.code = function (code, infostring) {
  const lang = (infostring || '').trim().split(/\s+/)[0];
  if (lang === 'mermaid') {
    const id = 'mermaid-' + (mermaidCounter++);
    // Store raw source in a data attribute (escaped) for mermaid.run to read.
    const escaped = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<div class="mermaid" id="${id}">${escaped}</div>`;
  }
  const highlighted = (window.miniHighlight && lang) ? window.miniHighlight(code, lang) : escapeHtmlFallback(code);
  return `<pre><code class="hljs lang-${lang || 'plain'}">${highlighted}</code></pre>`;
};

// Resolve relative image paths (sample-image.png, images/foo.png, ./foo.png)
// against the folder of the currently-open markdown file, so <img src=...>
// actually finds the file on disk instead of resolving relative to the
// app's own internal index.html.
function resolveImageSrc(src) {
  if (!src) return src;
  const isAbsolute = /^([a-zA-Z]+:|\/|\\\\)/.test(src); // http(s):, file:, data:, C:\, \\server, /root
  if (!currentPath || isAbsolute) return src;
  const dir = currentPath.replace(/[\\/][^\\/]*$/, ''); // strip filename, keep folder
  const normalizedSrc = src.replace(/\\/g, '/').replace(/^\.\//, '');
  const fullPath = dir.replace(/\\/g, '/') + '/' + normalizedSrc;
  return 'file:///' + fullPath.replace(/^\/+/, '');
}

customRenderer.image = function (href, title, text) {
  const resolved = resolveImageSrc(href);
  const titleAttr = title ? ` title="${title}"` : '';
  return `<img src="${resolved}" alt="${text || ''}"${titleAttr}>`;
};

function escapeHtmlFallback(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

marked.setOptions({ renderer: customRenderer, gfm: true, breaks: false });

function render() {
  let src = editor.value || '';
  if (window.replaceEmojiShortcodes) src = window.replaceEmojiShortcodes(src);
  preview.innerHTML = marked.parse(src);
  makeCheckboxesInteractive();
  renderMermaidBlocks();
}

// GFM task list checkboxes are rendered disabled by marked; re-enable them
// and sync clicks back into the raw markdown source.
function makeCheckboxesInteractive() {
  const boxes = preview.querySelectorAll('li input[type="checkbox"]');
  boxes.forEach((box, idx) => {
    box.disabled = false;
    box.dataset.idx = idx;
    box.addEventListener('change', onCheckboxToggle);
  });
}

function onCheckboxToggle(e) {
  const idx = Number(e.target.dataset.idx);
  const checked = e.target.checked;
  // Find the Nth task-list checkbox in the raw markdown and flip its marker.
  const lines = editor.value.split('\n');
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
  editor.value = lines.join('\n');
  dirty = true;
  setTitle();
  render();
}

function renderMermaidBlocks() {
  if (!window.mermaid) return;
  const nodes = preview.querySelectorAll('div.mermaid');
  if (!nodes.length) return;
  // mermaid.run mutates matched nodes in place, replacing text content with SVG.
  mermaid.run({ nodes: Array.from(nodes) }).catch(err => {
    nodes.forEach(n => {
      if (!n.querySelector('svg')) {
        n.innerHTML = `<div class="mermaid-error">Diagram error: ${escapeHtmlFallback(err.message || String(err))}</div>`;
      }
    });
  });
}

function setTitle() {
  const base = currentPath ? currentPath.split(/[\\/]/).pop() : 'Untitled.md';
  filenameEl.textContent = (dirty ? '● ' : '') + base;
}

editor.addEventListener('input', () => {
  render();
  dirty = true;
  setTitle();
});

// Debounced render for large files
let renderTimer;
editor.addEventListener('input', () => {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(render, 80);
});

window.api.onOpenFile(({ path, content }) => {
  currentPath = path;
  editor.value = content;
  dirty = false;
  render();
  setTitle();
});

document.getElementById('btnOpen').addEventListener('click', async () => {
  const res = await window.api.openFileDialog();
  if (res) {
    currentPath = res.path;
    editor.value = res.content;
    dirty = false;
    render();
    setTitle();
  }
});

document.getElementById('btnSave').addEventListener('click', async () => {
  const saved = await window.api.save({ path: currentPath, content: editor.value });
  if (saved) {
    currentPath = saved;
    dirty = false;
    setTitle();
  }
});

// Preview toggle: split -> editor-only -> preview-only -> split
const modes = ['', 'editor-only', 'preview-only'];
const modeLabels = { '': 'Split', 'editor-only': 'Editor', 'preview-only': 'Preview' };
let modeIdx = 0;
document.getElementById('btnTogglePreview').addEventListener('click', () => {
  modeIdx = (modeIdx + 1) % modes.length;
  container.className = modes[modeIdx];
  document.getElementById('btnTogglePreview').textContent = 'Preview: ' + modeLabels[modes[modeIdx]];
});

// Export menu
const exportBtn = document.getElementById('btnExport');
const exportMenu = document.getElementById('exportMenu');
exportBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  exportMenu.classList.toggle('hidden');
});
document.addEventListener('click', () => exportMenu.classList.add('hidden'));

const FULL_HTML_TEMPLATE = (bodyHtml, title) => `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${title}</title>
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

function baseName() {
  const b = currentPath ? currentPath.split(/[\\/]/).pop().replace(/\.[^.]+$/, '') : 'Untitled';
  return b;
}

// Walk preview DOM to build paragraph descriptors for docx export
function buildDocxParagraphs() {
  const paragraphs = [];
  const headingMap = { H1: 1, H2: 2, H3: 3, H4: 4, H5: 5, H6: 6 };
  preview.childNodes.forEach(node => {
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
    const full = FULL_HTML_TEMPLATE(preview.innerHTML, name);
    await window.api.saveAs({ content: full, defaultName: name + '.html', filters: [{ name: 'HTML', extensions: ['html'] }] });
  } else if (fmt === 'txt') {
    await window.api.saveAs({ content: preview.innerText, defaultName: name + '.txt', filters: [{ name: 'Text', extensions: ['txt'] }] });
  } else if (fmt === 'pdf') {
    const full = FULL_HTML_TEMPLATE(preview.innerHTML, name);
    await window.api.exportPdf({ html: full, defaultName: name + '.pdf' });
  } else if (fmt === 'docx') {
    const paragraphs = buildDocxParagraphs();
    await window.api.exportDocx({ paragraphs, defaultName: name + '.docx' });
  }
});

// Keyboard shortcuts
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 's') { e.preventDefault(); document.getElementById('btnSave').click(); }
  if (e.ctrlKey && e.key === 'o') { e.preventDefault(); document.getElementById('btnOpen').click(); }
});

// ---- Image insertion (button, drag-drop, paste) ----

function insertAtCursor(text) {
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  editor.value = editor.value.slice(0, start) + text + editor.value.slice(end);
  const newPos = start + text.length;
  editor.selectionStart = editor.selectionEnd = newPos;
  editor.dispatchEvent(new Event('input'));
  editor.focus();
}

document.getElementById('btnInsertImage').addEventListener('click', async () => {
  const res = await window.api.pickImage();
  if (res) insertAtCursor(`![${res.altSuggestion}](${res.path})\n`);
});

// Drag a local image file from Explorer straight into the editor
editor.addEventListener('dragover', (e) => e.preventDefault());
editor.addEventListener('drop', (e) => {
  e.preventDefault();
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if (file && /\.(png|jpe?g|gif|svg|webp|bmp)$/i.test(file.name)) {
    const alt = file.name.replace(/\.[^.]+$/, '');
    insertAtCursor(`![${alt}](${file.path.replace(/\\/g, '/')})\n`);
  }
});

// Paste an image from clipboard (e.g. a screenshot) — saved next to the
// current file (or a temp folder if unsaved) so the markdown stays portable.
editor.addEventListener('paste', async (e) => {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      const blob = item.getAsFile();
      const buffer = await blob.arrayBuffer();
      const res = await window.api.saveClipboardImage({
        data: Array.from(new Uint8Array(buffer)),
        currentPath,
        ext: item.type.split('/')[1] || 'png'
      });
      if (res) insertAtCursor(`![pasted-image](${res.path.replace(/\\/g, '/')})\n`);
      break;
    }
  }
});

render();
setTitle();
