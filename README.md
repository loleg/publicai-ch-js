# Apertus Demo

A standalone chat client in the spirit of the Hugging Face chat interface: attach pictures or sound
clips, edit any prompt to regenerate from that point, and stream answers from an
OpenAI-compatible API through a small Node.js proxy.

The UI is based on the design system of [swiss-ai.org](https://swiss-ai.github.io/design-system/)

## Quickstart

```sh
npm install
npm start            # or: node server.js
```

Then open <http://localhost:5173/>. No npm dependencies are required —
the proxy uses Node.js core modules only (Node ≥ 18 for `fetch` and web streams).

You can also open `index.html` directly from the file system: the page renders, and the
client falls back to `http://localhost:5173/api` so it works alongside a
locally running server.

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

## API surface

The server hosts two JSON endpoints under `/api/` (CORS-enabled so the
page also works from `file://`):

- `GET /health` — `{ ok, configured, baseUrl, model, node }`. The API key is never returned.
- `POST /chat/completions` — pass-through proxy to `{APERTUS_BASE_URL}/chat/completions`.
  Supports OpenAI-compatible request bodies, including `stream: true` (Server-Sent Events
  are piped through untouched) and vision/`input_audio` content parts. Browser
  disconnections (Stop button) abort the upstream request. Errors from the upstream API
  are forwarded with their original status code.

Attachments travel as base64: images as `image_url` data URLs (any `image/*`), sound
clips as `input_audio` parts (WAV and MP3, per the OpenAI audio format). File size is
capped at 10 MB per attachment client-side and 32 MB per request server-side.

## Features

- Chat log with user/assistant bubbles, streaming responses, and a Stop button.
- Attach pictures (rendered inline) and sound clips (rendered with an audio player).
- Prompt editing: every user message has an edit action; sending an edit truncates the
  conversation and regenerates from that point.
- Sample prompts, composer validation, 10 MB attachment cap, markdown-lite rendering
  (paragraphs, `code`, **bold** — HTML is escaped before any transformation).
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
  test/
    smoke.js          # zero-dependency handler smoke test (npm test)
  assets/
    app.css           # chat components on the design-system tokens
    app.js            # chat client, progressive enhancement
    favicon.svg
```
