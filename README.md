# MDViewer

A lightweight, fully **offline** Markdown viewer and editor for Windows, built with Electron and Chromium. No telemetry, no network calls, no cloud account — your files stay on your machine.

This repo contains **two versions**, kept side by side so you can pick the one that fits your needs:

| | `mdviewer-1.0/` | `mdviewer-1.1/` |
|---|---|---|
| **Best for** | Quick, minimal viewing/editing | Full editor experience, multi-file projects |
| **Size** | Small, very fast to start | Larger, still fast, more capable |
| **Editor** | Plain textarea | Real code editor (CodeMirror) — in-editor syntax coloring, find & replace |
| **Files** | One file at a time | Open a whole folder — file tree sidebar, tabs, outline panel |
| **Diagrams** | ❌ | ✅ Mermaid |
| **Math** | ❌ | ✅ KaTeX (`$...$`, `$$...$$`) |
| **Footnotes** | ❌ | ✅ |
| **Emoji shortcodes** | ✅ | ✅ |
| **Syntax highlighting (preview)** | ✅ | ✅ |
| **Light/dark theme** | ❌ (dark only) | ✅ |
| **Export** | HTML / PDF / DOCX / TXT | HTML / PDF / Print Preview / DOCX / TXT |
| **Double-click `.md` to open** | ✅ | ✅ |

If you just want to open a markdown file and read it, **1.0** is the simplest, leanest option. If you're actively writing/editing multiple files, want diagrams or math, or want a real code-editor feel, use **1.1**.

---

## Why two versions instead of one?

1.1 adds genuinely useful features, but they come with real weight — CodeMirror, KaTeX, and Mermaid together add several megabytes of vendored libraries and a more complex editor lifecycle. 1.0 stays intentionally minimal: a plain textarea has zero layout/measurement overhead, starts faster, and is less code to ever go wrong. Neither is "deprecated" — they're different tradeoffs for different needs, both maintained here.

---

## Quick Start (either version)

```bash
cd mdviewer-1.0   # or mdviewer-1.1
npm install
npm run dist
```

This produces, inside that folder's `bin/`:

| File | What it is |
|---|---|
| `MDViewer <version>.msi` | Standard installer — Desktop + Start Menu shortcuts, file association, clean uninstall |
| `MDViewer.exe` | Portable, no-install version |

Double-click the `.msi` to install. No admin rights required — installs per-user. After install, double-clicking any `.md` or `.markdown` file on your system opens it directly in MDViewer.

Each version's own `README.md` (inside its folder) has the full setup guide, architecture notes, troubleshooting, and command reference specific to that version.

### If `npm install` warns about blocked install scripts

Newer npm versions block native install scripts (used by Electron) by default. Fix once, project-wide:

```bash
npm config set allowScripts true
npm install
```

---

## Project Structure

```text
mdviewer/
├── mdviewer-1.0/     # Lightweight, single-file version
│   ├── src/
│   ├── package.json
│   └── README.md
├── mdviewer-1.1/     # Full editor: multi-file, CodeMirror, Mermaid, KaTeX
│   ├── src/
│   ├── package.json
│   └── README.md
├── LICENSE
├── .gitignore
└── README.md          # This file
```

---

## Tech Stack (both versions)

- **Electron** + Chromium — native window, no server, fully local
- **marked** — markdown parsing (vendored, no CDN)
- Custom dependency-free syntax highlighter for code blocks
- Chromium's built-in `printToPDF` for PDF export — no extra library
- Hand-rolled OOXML writer (Node's built-in `zlib`) for `.docx` export — no extra library
- **electron-builder** → WiX MSI for the Windows installer

1.1 additionally vendors **CodeMirror 5**, **KaTeX**, and **Mermaid** — all loaded locally, no CDN, fully offline.

---

## License

Apache License 2.0 — see [LICENSE](./LICENSE).

Copyright 2026 Harshal Vakharia
