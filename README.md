# TitoDocs

TitoDocs is a self-hosted editor that people use together in real time. It has three kinds of files:

- **Documents**, like Google Docs and Microsoft Word.
- **Code and text files**, like Notepad++.
- **Workspaces** of pages with live components, like Microsoft Loop.

Everyone who opens a file edits the same copy, sees the others' cursors, and changes are saved as you type.

## Features

### Documents

- **Formatting:** paragraph styles, fonts and sizes, bold, italic, underline, strikethrough, superscript, subscript, text and highlight colors, alignment, indentation, line spacing, capitalization, paint format and clear formatting.
- **Content:** bulleted, numbered and check lists, tables, images (uploaded or linked, with alt text), links, quotes, code blocks with syntax highlighting, collapsible sections, horizontal lines, page breaks, a table of contents, special characters and dates.
- **Quick insert:** type `/` at the start of a line for the commands menu, or `@` to mention someone.
- **Comments** on selected text, with replies and resolving.
- **Version history:** name versions and restore earlier ones.
- **Find and replace**, outline, word count, zoom, full screen, a viewing mode, non-printing characters, spell check (the browser's), page setup (paper size, orientation and margins) and printing.
- **Import** Word (.docx), Markdown, HTML and text files.
- **Download** as PDF, .docx, .html, .md or .txt. The PDF is made in the browser, with the document's formatting and page setup, bookmarks for its headings and page numbers in its table of contents.
- **Templates:** letter, meeting notes, project proposal and résumé.

### Code and text files

- **Syntax highlighting** for 143 languages, picked from the file name or from the Language menu.
- **Tabs:** open several files in tabs.
- **Templates:** text, Python, HTML, JavaScript and Markdown.
- **Search:**
  - Find and replace in normal, extended (`\n`, `\t`) or regular-expression mode, with match case and whole word.
  - List all matching lines, select all matches, or bookmark the matching lines.
  - Go to line and to the matching bracket.
- **Editing:**
  - Multiple cursors (Ctrl/⌘+click), rectangular selection (Alt/⌥+drag) and a column editor.
  - Line operations: sort, reverse, shuffle, join, move, duplicate and delete lines, and remove duplicate or empty lines.
  - Case conversion, comment and uncomment, trimming, TAB and space conversion, and inserting the date and time.
  - Auto-closing brackets and auto-completion.
- **Bookmarks:** toggle them, jump between them, invert them, and copy or remove the bookmarked lines.
- **View:** word wrap, visible spaces, tabs and line endings, indent guides, line numbers, folding, a document map, zoom, and light and dark themes.
- **Line endings and encodings:** line endings (Windows, Unix, classic Mac) and encodings (UTF-8 with or without BOM, UTF-16 LE and BE) are detected when you open a file and used when you download it.
- **Tools:**
  - SHA-1, SHA-256, SHA-384 and SHA-512 hashes.
  - Base64, URL and HTML encoding and decoding.
  - JSON format and minify.
  - A document summary.
  - Compare the file with another file, an earlier version, a file on your computer or pasted text.
- **Macros:** record one, then play it back once or many times.
- **Status bar:** language, length, cursor position, indentation, line ending, encoding and zoom.

### Workspaces and live components

- **Workspaces** hold a tree of pages and subpages. You can:
  - Add and rename pages.
  - Reorder pages by dragging them, or with Move up and Move down.
  - Move pages to "Recently deleted" and restore them.
- **Pages** are rich text, with the same `/` menu and `@` mentions as documents, and a drag handle for moving blocks. They can be downloaded as PDF, .md, .html or .txt.
- **Live components:** task list (with assignees and due dates), progress tracker, voting table, Q&A and paragraph.
  - Insert them from the `/` menu or the Insert menu.
  - Each component has its own link, so people can open just the component. Their changes show up live on the page.
- **Phones:** on small screens the page tree moves into a drawer.

### Everywhere

- **Real-time collaboration:** live cursors with names, and the avatars of everyone in the file.
- **Sharing:** invite people as viewers, commenters or editors, or turn on link sharing for everyone signed in. Access changes apply to files that are already open, right away.
- **Home:** your recent files, your own files, files shared with you, starred files and the trash, with search by name and content.
- **Accounts and settings:** accounts with a username and password, a light, dark or system theme, and a keyboard shortcuts list.

## Running it

TitoDocs needs [Node.js](https://nodejs.org/) 24 or later. Node runs the server's TypeScript directly and provides the SQLite database (`node:sqlite`), so nothing else needs to be installed.

### Development

```sh
npm install
npm run dev
```

Open <http://localhost:3000> and create an account. The client reloads as you edit it, and the server restarts. Data goes to `./data`.

### Production

```sh
npm ci
npm run build
npm start
```

### Docker

```sh
docker build -t titodocs .
docker run -d --name titodocs -p 3000:3000 -v titodocs-data:/data titodocs
```

The container runs as the unprivileged `node` user and keeps its data in the `/data` volume.

### Configuration

Set these environment variables to configure the server:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Port to listen on. |
| `HOST` | `0.0.0.0` | Address to listen on. |
| `DATA_DIR` | `./data` (`/data` in Docker) | Where the SQLite database (`titodocs.db`) and uploaded images (`uploads/`) are kept. |
| `ALLOW_REGISTRATION` | `true` | Set to `false` to stop new sign-ups. |
| `SECURE_COOKIES` | `false` | Set to `true` when the site is served over HTTPS. |
| `TRUST_PROXY` | `false` | Set to `true` behind a reverse proxy. Rate limits then use the client address from `X-Forwarded-For`, and the same-origin check uses `X-Forwarded-Host`. |
| `ALLOWED_ORIGINS` | (none) | Comma-separated extra origins that may change data and open live-editing connections. |
| `MAX_UPLOAD_MB` | `10` | Largest image upload, in MB. |
| `NODE_ENV` | | `production` serves the built client, like `npm start`. |

**Sign-ups and rate limits.** Anyone who can reach the server can create an account. Once everyone has signed up, set `ALLOW_REGISTRATION=false`. The server allows:
- 10 sign-in attempts per user and address every 15 minutes.
- 30 sign-in attempts per address every 15 minutes, across all users.
- 20 sign-ups per address per hour.

**Behind a reverse proxy:**
- Forward WebSocket upgrades on `/collab`, which live editing uses.
- Set `TRUST_PROXY=true`, and set `SECURE_COOKIES=true` for HTTPS.
- Requests that change data must come from the server's own origin. If the browser sees a different host name than the server does, add the public origin to `ALLOWED_ORIGINS`.

**Backups.** Everything is in the data directory. Stop the server before copying it: SQLite runs in WAL mode, so a copy taken while the server is running may be inconsistent.

## Tests

```sh
npm run typecheck
npm test                          # server tests
npx playwright install chromium   # once
npm run test:e2e                  # end-to-end tests in Chromium
```

The end-to-end tests build the app and serve it on port 4790 with an empty data directory. They save screenshots to `test-results/screenshots/`.

On every pull request, CI:
- Runs the typecheck and server tests on Node 24 and 26.
- Runs the end-to-end tests and uploads the screenshots and the Playwright report as artifacts.
- Builds the Docker image.

## How it's built

- `client/`: React and TypeScript, built with Vite. Documents and workspace pages use [TipTap](https://tiptap.dev/) (ProseMirror). Code files use [CodeMirror](https://codemirror.net/) 6.
- `server/`: an Express API, plus a [Hocuspocus](https://tiptap.dev/docs/hocuspocus) server that syncs [Yjs](https://yjs.dev/) documents for live editing. Data is stored in SQLite.
- `shared/`: types used by both.
- `e2e/`: [Playwright](https://playwright.dev/) tests.

## Known limitations

**Documents**
- There's no suggesting mode (tracked changes).
- There's no automatic pagination: page breaks are manual.
- Comment rules are enforced by the app, not the server. The app only lets you edit your own comments, and delete your own (or anyone's, if you moderate). Someone who may comment could still change other people's comments with a modified client.
- The .docx export hasn't been tested in Microsoft Word, and the PDF download has only been checked with pdf.js.
- The PDF download draws every font as Arimo, Tinos or Cousine (which have the widths of Arial, Times New Roman and Courier New), so other fonts look different. Code blocks are light, as in the .docx download. Images from other sites become links.
- The PDF download can't show characters that its fonts lack, such as Chinese, Japanese and Korean, and right-to-left text may come out in the wrong order. It warns about both and suggests printing to PDF instead.

**Workspaces**
- Anyone signed in who has a component's link can open and edit it.
- Components aren't included in version history, search or downloads.
- Dragging a block re-creates it, so text someone else types into that block at the same moment is lost.
- The owner can still edit the pages of a workspace that is in the trash.

**Collaboration**
- An edit made at the very moment someone's access is lowered is not saved.
- If someone's access changes just as they connect, the change may only apply once they reconnect.
- Selecting text in read-only files depends on internals of `prosemirror-view`.
- There's no password reset or admin screen, so a forgotten password can't be recovered in the app.

**Testing**
- Tested in Chromium only: on desktop, and in a phone-sized window for workspaces.
- Not tested: Firefox, Safari, real phones, the system clipboard and printing.

## License

[AGPL-3.0-or-later](LICENSE)
