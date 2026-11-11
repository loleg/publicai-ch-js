# Apertus Demo

A standalone chat client in the spirit of the Hugging Face chat interface: attach pictures or sound
clips, edit any prompt to regenerate from that point, and stream answers from an
OpenAI-compatible API through a small Node.js proxy. An embeddable widget
(`assets/widget.js`) opens the same chat as a pop-up on any third-party website —
see [Chat widget](#chat-widget).

The UI is based on the design system of [Public AI](https://publicai.ch) (red brand, Public Sans)

## Quickstart

```sh
npm install
npm start            # or: node server.js
```

Then open <http://localhost:5173/>. No npm dependencies are required —
the proxy uses Node.js core modules only (Node ≥ 18 for `fetch` and web streams).

A running server or deployment is required: the page must be served over
http(s). Opening `index.html` directly from the file system (`file://`) is not
supported.

Validation (no dependencies, no network — exercises the request handler with mocks):

```sh
npm test             # or: node test/smoke.js
```

## Configuration

| Variable           | Default                              | Purpose                                                       |
| ------------------ | ------------------------------------ | ------------------------------------------------------------- |
| `APERTUS_API_KEY`  | `OPENAI_API_KEY` fallback            | API key forwarded as `Authorization: Bearer …`. Required for chat. |
| `APERTUS_BASE_URL` | `OPENAI_BASE_URL`, else `https://api.openai.com/v1` | Any OpenAI-compatible endpoint.                 |
| `APERTUS_MODEL`    | `swissai/Apertus-v1.5-8B`             | Model injected when the client omits one.                     |
| `PORT` / `HOST`    | `5173` / `localhost`                 | Bind address.                                                 |

Examples:

```sh
# Hugging Face Inference Providers (OpenAI-compatible router)
APERTUS_BASE_URL=https://router.huggingface.co/v1 \
APERTUS_API_KEY=hf_… \
APERTUS_MODEL=swissai/Apertus-v1.5-8B npm start

# A local vLLM or Ollama endpoint
APERTUS_BASE_URL=http://localhost:8000/v1 APERTUS_API_KEY=local npm start
```

## Chat widget

`assets/widget.js` is a self-contained, zero-dependency script that adds a
floating launcher button to any page and opens the chat in a **pop-up browser
window** (default) or an **in-page panel** with an embedded iframe. It injects
its own namespaced styles, so it neither inherits host stylesheets nor leaks
its own, and it holds no secrets: the chat inside the pop-up talks to the
`/api` proxy of the deployment that serves the widget.

To try it
locally, run `npm start` and open <http://localhost:5173/demo.html>, a
page that pretends to be a third-party site (including a clashing CSS reset
and a high stacking-order header).

### Adding to your site

1. Deploy this repository as documented above.
2. Paste one script tag before `</body>`:

```html
<script src="https://<your address>/assets/widget.js" defer></script>
```

That is all when the script is served by the deployment itself — the widget
derives the deployment origin from its own URL. There is no fallback: a
deployment is required, and `file://` pages are not supported. If you mirror
`widget.js` onto a CDN or another origin, point it at the deployment with
`data-url`:

```html
<script src="https://<your address>/apertus/widget.js"
        data-url="https://<your address>" defer></script>
```

The pop-up loads `/popup.html` from the deployment — a chat-only page without
the demo header and footer, running the same client as `index.html`. 

### Configuration

Set options with `data-*` attributes on the script tag; the same keys are also
accepted on a `window.ApertusChatWidget` object defined before the script
loads. `data-*` attributes win over the global object, which wins over the
defaults.

| `data-*` attribute | Global key  | Default              | Purpose                                                              |
| ------------------ | ----------- | -------------------- | -------------------------------------------------------------------- |
| `data-url`         | `url`       | script origin        | Deployment base URL; the pop-up loads `<url>/popup.html`.            |
| `data-mode`        | `mode`      | `window`             | `window` (pop-up browser window) or `panel` (in-page dialog + iframe). |
| `data-label`       | `label`     | `Chat with Apertus`  | Accessible name and `title` of the launcher and panel.               |
| `data-position`    | `position`  | `right`              | `right` or `left` corner for the launcher (and panel).               |
| `data-width`       | `width`     | `420`                | Pop-up width in px (window mode), clamped to the screen.             |
| `data-height`      | `height`    | `640`                | Pop-up height in px (window mode), clamped to the screen.            |

### Programmatic API

The widget exposes a small API on `window.ApertusChat`:

```js
ApertusChat.open();    // open the pop-up window (or panel)
ApertusChat.close();   // close the panel; window mode closes the pop-up
ApertusChat.toggle();  // open/focus, or close the panel
```

Example — open the chat from your own button:

```html
<button onclick="ApertusChat.open()">Ask Apertus</button>
```

### Modes and behavior

- **`window` (default)** — opens a centered pop-up browser window named
  `apertus-chat` via `window.open()`; clicking the launcher again focuses the
  existing window instead of opening a second one. Because it is a real
  window, it works no matter how the deployment sets framing headers. If the
  browser blocks the pop-up, the widget shows a dismissible notice with a
  fallback link that opens the chat in a new tab.
- **`panel`** — a fixed in-page dialog with an iframe pointing at the same
  `/popup.html`, loaded lazily on first open and kept across close/open so the
  conversation survives. This mode requires the deployment to allow framing:
  the server in this repo sets neither `X-Frame-Options` nor a CSP
  `frame-ancestors` directive, so it works out of the box, but a reverse proxy
  that adds `X-Frame-Options: DENY` (or similar) will blank the panel — use
  `window` mode there.

The launcher is a real `<button>` (56×56 px) with `aria-haspopup="dialog"`,
`aria-expanded`, and a visible focus ring; the panel is a `role="dialog"` with
an accessible name; animations are disabled under `prefers-reduced-motion`.

### Theming

Every color, shadow, and offset in the injected stylesheet is a CSS custom
property with a design-system fallback, so a host site can re-theme the widget
without touching it:

```css
:root {
  --apertus-launcher-bg: #003a70;
  --apertus-launcher-hover: #00509e;
  --apertus-launcher-offset: 16px;
}
```

Available properties: `--apertus-launcher-bg/-fg/-hover/-border/-shadow/-offset`,
`--apertus-panel-bg/-width/-height/-radius/-shadow/-offset`,
`--apertus-panel-header-bg/-fg`, `--apertus-toast-bg/-fg/-border`,
`--apertus-border`, `--apertus-focus-ring`, and `--apertus-z-index`. The widget
does not load web fonts itself; it uses `Inter` and `Geist Mono` when the host
page provides them and falls back to system fonts otherwise.

### Security notes

- Only the public URL of your deployment is embedded. `APERTUS_API_KEY` stays
  on the server, and the widget and pop-up hold no secrets.
- The chat page runs on the deployment's origin inside the pop-up or iframe
  and does not read cookies or storage from the host page. Conversations are
  kept in memory only — a new pop-up or a page reload starts empty; the panel
  keeps its conversation until the host page is reloaded.
- Anyone you give the widget to can spend your proxy quota — put rate limits
  or authentication in front of `/api` before embedding it publicly.

## API surface

The server hosts two JSON endpoints under `/api/` (CORS-enabled for
cross-origin calls):

- `GET /health` — `{ ok, configured, baseUrl, model, node }`. The API key is never returned.
- `POST /chat/completions` — pass-through proxy to `{APERTUS_BASE_URL}/chat/completions`.
  Supports OpenAI-compatible request bodies, including `stream: true` (Server-Sent Events
  are piped through untouched) and vision/`input_audio` content parts. Browser
  disconnections (Clear button while generating) abort the upstream request. Errors from
  the upstream API are forwarded with their original status code.

Attachments travel as base64: images as `image_url` data URLs (any `image/*`), sound
clips as `input_audio` parts (WAV and MP3, per the OpenAI audio format). File size is
capped at 10 MB per attachment client-side and 32 MB per request server-side.

## Features

- Chat log with user/assistant bubbles, streaming responses, and a single Clear button
  that stops generation while a response is streaming and clears the dialog otherwise.
- Attach pictures (rendered inline) and sound clips (rendered with an audio player).
- Prompt editing: every user message has an edit action; sending an edit truncates the
  conversation and regenerates from that point.
- Sample prompts, composer validation, 10 MB attachment cap, markdown-lite rendering
  (paragraphs, `code`, **bold** — HTML is escaped before any transformation).
- Embeddable widget (`assets/widget.js`): launcher button that opens the chat in a
  pop-up window or an in-page panel on any third-party site.
- Proxy status chip in the header plus dismissible setup notices; the page renders and
  reads fine without JavaScript or without the proxy.

## Accessibility (WCAG 2.2 AA)

- Skip link, semantic landmarks (`header`/`nav`/`main`/`footer`), one `h1` per page.
- The chat log is a `role="log"` live region; `aria-busy` is set while generating.
- All controls are native `button`/`textarea`/`input` elements with labels or
  `aria-label`s; interactive targets are at least 44×44 px.
- Focus is visible everywhere (design-system `:focus-visible` ring); Enter sends,
  Shift+Enter inserts a newline, IME composition is respected.
- Sky-blue user bubbles always carry anthracite text (6.3:1); warnings use the verified
  error-container pair; reduced motion disables the typing caret and status pulse.

## File structure

```
  README.md
  package.json        # start + test scripts, zero dependencies
  server.js           # static server (repo root) + OpenAI-compatible proxy
  index.html          # single-page app shell
  popup.html          # chat-only page for the widget pop-up / panel
  demo.html    # fake third-party page embedding the widget
  test/
    smoke.js          # zero-dependency handler smoke test (npm test)
  assets/
    public-ai.css     # Public AI retheme of the design-system bundle
    app.css           # chat components on the design-system tokens
    app.js            # chat client, progressive enhancement
    widget.js         # embeddable launcher: pop-up window / in-page panel
    popup.css         # chat-only layout for popup.html
    favicon.svg
```
