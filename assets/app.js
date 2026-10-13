'use strict';
/* SPDX-License-Identifier: Apache-2.0 */
/* Apertus demo — chat client (progressive enhancement only).
 *
 * The page renders and reads fine without JavaScript; this module adds:
 *   - proxy health check with status chip and setup notices
 *   - prompt composer (Enter to send, Shift+Enter for newline, auto-grow)
 *   - image and audio attachments (OpenAI-compatible vision + input_audio)
 *   - streaming responses over SSE with a Clear button that stops generation
 *   - prompt editing: resend regenerates the conversation from that point
 *   - sample prompts, markdown-lite rendering, Clear
 *
 * Reduced motion is respected via CSS; JavaScript adds no essential animation.
 */

(function () {
  /* --- Configuration ------------------------------------------------------ */

  // Same-origin proxy path — a running server or deployment is required.
  const API_BASE = 'api';

  const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB per attachment
  const AUDIO_FORMATS = {
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/wave': 'wav',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
  };

  const SYSTEM_PROMPT =
    'You are Apertus, an open multilingual foundation model built by the Swiss AI Initiative. ' +
    'Answer clearly, precisely, and concisely.';

  const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* --- State ---------------------------------------------------------------- */

  const state = {
    messages: [], // { role, text, attachments: [{ kind, name, mime, base64, dataUrl, format }] }
    attachments: [], // pending tray
    editingIndex: null,
    controller: null,
    generating: false,
    health: null,
  };

  /* --- Elements --------------------------------------------------------------- */

  function element(id) {
    return document.getElementById(id);
  }

  const chatLog = element('chat-log');
  const emptyState = element('chat-empty');
  const noticeRegion = element('notice-region');
  const composer = element('composer');
  const promptInput = element('prompt-input');
  const sendButton = element('send-button');
  const clearButton = element('clear-button');
  const attachButton = element('attach-button');
  const fileInput = element('file-input');
  const tray = element('attachment-tray');
  const editBar = element('edit-bar');
  const editBarText = element('edit-bar-text');
  const editBarCancel = element('edit-bar-cancel');
  const statusChip = element('status-chip');
  const statusText = element('status-text');
  const samplePrompts = element('sample-prompts');

  const ICON_CLOSE =
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  const ICON_EDIT =
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M17 3a2.8 2.8 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  /* --- Small helpers ------------------------------------------------------------ */

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (char) {
      return {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      }[char];
    });
  }

  // Safe markdown-lite: escape first, then paragraphs, line breaks, `code`, **bold**.
  function renderMarkdown(text) {
    const escaped = escapeHtml(text);
    return escaped
      .split(/\n{2,}/)
      .map(function (block) {
        return (
          '<p>' +
          block
            .replace(/\n/g, '<br>')
            .replace(/`([^`\n]+)`/g, '<code>$1</code>')
            .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>') +
          '</p>'
        );
      })
      .join('');
  }

  function renderPlainText(text) {
    return escapeHtml(text)
      .split(/\n{2,}/)
      .map(function (block) {
        return '<p>' + block.replace(/\n/g, '<br>') + '</p>';
      })
      .join('');
  }

  function notice(kind, message) {
    const box = document.createElement('div');
    box.className = 'notice notice--' + kind;
    if (kind === 'warn') box.setAttribute('role', 'alert');

    const text = document.createElement('p');
    text.className = 'notice-text';
    text.textContent = message;
    box.append(text);

    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'notice-dismiss';
    dismiss.setAttribute('aria-label', 'Dismiss notification');
    dismiss.innerHTML = ICON_CLOSE;
    dismiss.addEventListener('click', function () {
      box.remove();
    });
    box.append(dismiss);

    noticeRegion.append(box);
    return box;
  }

  function setStatus(status, label) {
    statusChip.dataset.state = status;
    statusText.textContent = label;
  }

  function isNearBottom() {
    const remaining =
      document.documentElement.scrollHeight -
      window.scrollY -
      window.innerHeight;
    return remaining < 160;
  }

  function scrollToBottom() {
    if (!isNearBottom()) return;
    window.scrollTo({
      top: document.documentElement.scrollHeight,
      behavior: REDUCED_MOTION.matches ? 'auto' : 'smooth',
    });
  }

  /* --- Attachments ------------------------------------------------------------ */

  function readFile(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.addEventListener('load', function () {
        resolve(String(reader.result));
      });
      reader.addEventListener('error', function () {
        reject(new Error('Could not read ' + file.name + '.'));
      });
      reader.readAsDataURL(file);
    });
  }

  async function addFiles(fileList) {
    for (const file of Array.from(fileList)) {
      if (file.size > MAX_FILE_BYTES) {
        notice(
          'warn',
          file.name + ' is larger than 10 MB and was not attached.'
        );
        continue;
      }

      let record = null;
      if (file.type.startsWith('image/')) {
        try {
          const dataUrl = await readFile(file);
          record = {
            kind: 'image',
            name: file.name,
            mime: file.type,
            dataUrl: dataUrl,
            base64: dataUrl.split(',')[1] || '',
            format: '',
          };
        } catch (error) {
          notice('warn', error.message);
        }
      } else if (AUDIO_FORMATS[file.type]) {
        try {
          const dataUrl = await readFile(file);
          record = {
            kind: 'audio',
            name: file.name,
            mime: file.type,
            dataUrl: dataUrl,
            base64: dataUrl.split(',')[1] || '',
            format: AUDIO_FORMATS[file.type],
          };
        } catch (error) {
          notice('warn', error.message);
        }
      } else {
        notice(
          'warn',
          file.name + ': only pictures and WAV/MP3 sound clips can be sent to the model.'
        );
      }

      if (record) {
        state.attachments.push(record);
        renderTray();
      }
    }
  }

  function renderTray() {
    tray.textContent = '';
    tray.hidden = state.attachments.length === 0;

    state.attachments.forEach(function (attachment, index) {
      const chip = document.createElement('span');
      chip.className = 'attachment-chip';

      if (attachment.kind === 'image') {
        const image = document.createElement('img');
        image.src = attachment.dataUrl;
        image.alt = '';
        chip.append(image);
      } else {
        const icon = document.createElement('span');
        icon.className = 'attachment-chip-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.innerHTML =
          '<svg class="icon" viewBox="0 0 24 24"><path d="M12 3v10.5a2.5 2.5 0 0 1-5 0V6a4 4 0 0 1 8 0v8a5.5 5.5 0 0 1-11 0V7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
        chip.append(icon);
      }

      const name = document.createElement('span');
      name.className = 'chip-name';
      name.textContent = attachment.name;
      chip.append(name);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'attachment-remove';
      remove.setAttribute('aria-label', 'Remove attachment ' + attachment.name);
      remove.innerHTML = ICON_CLOSE;
      remove.addEventListener('click', function () {
        state.attachments.splice(index, 1);
        renderTray();
        promptInput.focus();
      });
      chip.append(remove);

      tray.append(chip);
    });
  }

  /* --- Messages ----------------------------------------------------------------- */

  function attachmentView(attachment) {
    const wrap = document.createElement('div');

    if (attachment.kind === 'image') {
      wrap.className = 'attachment-image';
      const image = document.createElement('img');
      image.src = attachment.dataUrl;
      image.alt = 'Attached image: ' + attachment.name;
      wrap.append(image);
    } else {
      wrap.className = 'attachment-audio';
      const audio = document.createElement('audio');
      audio.controls = true;
      audio.src = attachment.dataUrl;
      audio.preload = 'metadata';
      const label = document.createElement('p');
      label.className = 'attachment-caption';
      label.textContent = 'Sound clip: ' + attachment.name;
      wrap.append(audio, label);
    }

    return wrap;
  }

  function messageActions(index, role) {
    if (role !== 'user') return null;

    const actions = document.createElement('div');
    actions.className = 'message-actions';
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'message-action';
    edit.dataset.editIndex = String(index);
    edit.setAttribute('aria-label', 'Edit prompt and regenerate from this message');
    edit.title = 'Edit prompt and regenerate';
    edit.innerHTML = ICON_EDIT;
    actions.append(edit);
    return actions;
  }

  function appendMessage(record, index) {
    const item = document.createElement('li');
    item.className = 'message message--' + record.role;

    const role = document.createElement('p');
    role.className = 'message-role';
    role.textContent = record.role === 'user' ? 'You' : 'Apertus';
    item.append(role);

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    item.append(bubble);

    const attachments = document.createElement('div');
    attachments.className = 'message-attachments';
    record.attachments.forEach(function (attachment) {
      attachments.append(attachmentView(attachment));
    });
    if (record.attachments.length > 0) item.append(attachments);

    const actions = messageActions(index, record.role);
    if (actions) item.append(actions);

    chatLog.append(item);
    return bubble;
  }

  function renderMessageContent(record, bubble, streamed) {
    if (record.role === 'assistant' && !streamed) {
      bubble.innerHTML = record.text ? renderMarkdown(record.text) : '';
    } else if (record.role === 'assistant') {
      bubble.innerHTML = renderMarkdown(record.text);
    } else {
      bubble.innerHTML = renderPlainText(record.text || '');
    }
  }

  function showErrorBubble(message) {
    const item = document.createElement('li');
    item.className = 'message message--error';
    const role = document.createElement('p');
    role.className = 'message-role';
    role.textContent = 'Apertus';
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    bubble.textContent = message;
    item.append(role, bubble);
    chatLog.append(item);
  }

  /* --- API ------------------------------------------------------------------------ */

  function toApiMessage(record) {
    if (record.role === 'assistant') {
      return { role: 'assistant', content: record.text };
    }

    const parts = [];
    if (record.text) parts.push({ type: 'text', text: record.text });
    record.attachments.forEach(function (attachment) {
      if (attachment.kind === 'image') {
        parts.push({
          type: 'image_url',
          image_url: { url: attachment.dataUrl },
        });
      } else {
        parts.push({
          type: 'input_audio',
          input_audio: { data: attachment.base64, format: attachment.format },
        });
      }
    });
    return { role: 'user', content: parts };
  }

  function buildPayload() {
    const messages = [{ role: 'system', content: SYSTEM_PROMPT }];
    state.messages.forEach(function (record) {
      messages.push(toApiMessage(record));
    });

    const body = { messages: messages, stream: true };
    if (state.health && state.health.model) body.model = state.health.model;
    return body;
  }

  function extractErrorText(raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.error) {
        if (typeof parsed.error === 'string') return parsed.error;
        if (parsed.error.message) return parsed.error.message;
      }
      if (parsed && typeof parsed.message === 'string') return parsed.message;
    } catch (error) {
      // Not JSON — fall through.
    }
    return raw || '';
  }

  async function readEventStream(response, onDelta) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    for (;;) {
      const step = await reader.read();
      if (step.done) break;
      buffer += decoder.decode(step.value, { stream: true });

      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        newlineIndex = buffer.indexOf('\n');

        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') return;

        let event;
        try {
          event = JSON.parse(data);
        } catch (error) {
          continue; // Skip malformed keep-alive lines.
        }
        if (event.error) {
          throw new Error(extractErrorText(data) || 'The model returned an error.');
        }
        const delta =
          event.choices && event.choices[0] && event.choices[0].delta
            ? event.choices[0].delta.content
            : '';
        if (delta) onDelta(delta);
      }
    }
  }

  function setGenerating(active) {
    state.generating = active;
    sendButton.hidden = active;
    // One CLEAR button serves both roles: it stops generation while a response
    // is streaming, and clears the dialog otherwise. Update its accessible name
    // to match the role it currently plays.
    clearButton.setAttribute('aria-label', active ? 'Stop generation' : 'Clear the conversation');
    if (active) {
      chatLog.setAttribute('aria-busy', 'true');
    } else {
      chatLog.removeAttribute('aria-busy');
      state.controller = null;
    }
  }

  async function streamAssistant() {
    const placeholder = { role: 'assistant', text: '', attachments: [] };
    const index = state.messages.length;
    state.messages.push(placeholder);

    const bubble = appendMessage(placeholder, index);
    bubble.classList.add('is-streaming');
    const typing = document.createElement('p');
    typing.className = 'typing-line';
    typing.innerHTML =
      '<span class="typing-dots" role="img" aria-label="Generating response"><span></span><span></span><span></span></span>';
    bubble.append(typing);
    scrollToBottom();

    state.controller = new AbortController();
    setGenerating(true);

    try {
      const response = await fetch(API_BASE + '/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify(buildPayload()),
        signal: state.controller.signal,
      });

      if (!response.ok) {
        const raw = await response.text();
        throw new Error(
          extractErrorText(raw) || 'The proxy request failed with status ' + response.status + '.'
        );
      }

      const contentType = response.headers.get('content-type') || '';
      typing.remove();

      if (contentType.includes('text/event-stream') && response.body) {
        await readEventStream(response, function (delta) {
          placeholder.text += delta;
          renderMessageContent(placeholder, bubble, true);
          scrollToBottom();
        });
      } else {
        const data = await response.json();
        if (data.error) throw new Error(extractErrorText(JSON.stringify(data)));
        placeholder.text =
          data.choices && data.choices[0] && data.choices[0].message
            ? data.choices[0].message.content || ''
            : '';
        renderMessageContent(placeholder, bubble, true);
      }

      if (!placeholder.text) {
        state.messages.pop();
        bubble.closest('li').remove();
        notice('info', 'The model returned an empty response. Try rephrasing the prompt.');
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        if (placeholder.text) {
          renderMessageContent(placeholder, bubble, false);
        } else {
          state.messages.pop();
          bubble.closest('li').remove();
          notice('info', 'Generation stopped before any tokens arrived.');
        }
      } else {
        state.messages.pop();
        bubble.closest('li').remove();
        showErrorBubble(
          'The request failed: ' +
            (error.message || 'unknown error') +
            ' — the conversation was not changed.'
        );
        scrollToBottom();
      }
    } finally {
      setGenerating(false);
      if (!sendButton.hidden) sendButton.focus();
    }
  }

  /* --- Composer flow ------------------------------------------------------------------ */

  function resetComposer() {
    promptInput.value = '';
    autoGrow();
  }

  function beginEdit(index) {
    if (state.generating) return;
    const record = state.messages[index];
    if (!record || record.role !== 'user') return;

    state.editingIndex = index;
    promptInput.value = record.text;
    state.attachments = record.attachments.slice();
    renderTray();

    editBar.hidden = false;
    editBarText.textContent =
      'Editing prompt ' + (index + 1) + ' — sending will regenerate the conversation from here.';
    autoGrow();
    promptInput.focus();
  }

  function cancelEdit() {
    state.editingIndex = null;
    state.attachments = [];
    renderTray();
    editBar.hidden = true;
    resetComposer();
    promptInput.focus();
  }

  composer.addEventListener('submit', function (event) {
    event.preventDefault();
    if (state.generating) return;

    const text = promptInput.value.trim();
    if (!text && state.attachments.length === 0) return;

    if (state.editingIndex !== null) {
      state.messages = state.messages.slice(0, state.editingIndex);
      state.editingIndex = null;
      editBar.hidden = true;
    }

    const record = {
      role: 'user',
      text: text,
      attachments: state.attachments.slice(),
    };
    const index = state.messages.length;
    state.messages.push(record);

    emptyState.hidden = true;
    appendMessage(record, index);
    renderMessageContent(record, chatLog.lastElementChild.querySelector('.message-bubble'), false);

    state.attachments = [];
    renderTray();
    resetComposer();
    scrollToBottom();
    promptInput.focus();

    streamAssistant();
  });

  promptInput.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      composer.requestSubmit();
    }
  });

  function autoGrow() {
    promptInput.style.height = 'auto';
    promptInput.style.height = Math.min(promptInput.scrollHeight, 220) + 'px';
  }
  promptInput.addEventListener('input', autoGrow);

  attachButton.addEventListener('click', function () {
    fileInput.click();
  });
  fileInput.addEventListener('change', function () {
    if (fileInput.files && fileInput.files.length > 0) {
      addFiles(fileInput.files);
      fileInput.value = '';
    }
  });

  clearButton.addEventListener('click', function () {
    // Retrieval in progress: CLEAR acts as STOP.
    if (state.generating) {
      if (state.controller) state.controller.abort();
      return;
    }

    // No generation in progress: clear the dialog.
    state.messages = [];
    state.editingIndex = null;
    state.attachments = [];
    renderTray();
    editBar.hidden = true;
    chatLog.textContent = '';
    chatLog.append(emptyState);
    emptyState.hidden = false;
    resetComposer();
    promptInput.focus();
  });

  editBarCancel.addEventListener('click', cancelEdit);

  chatLog.addEventListener('click', function (event) {
    const button = event.target.closest('[data-edit-index]');
    if (!button) return;
    beginEdit(Number(button.dataset.editIndex));
  });

  if (samplePrompts) {
    samplePrompts.addEventListener('click', function (event) {
      const button = event.target.closest('.sample-prompt');
      if (!button) return;
      promptInput.value = button.textContent.trim();
      autoGrow();
      promptInput.focus();
    });
  }

  /* --- Health check ----------------------------------------------------------------------- */

  async function checkHealth() {
    try {
      const response = await fetch(API_BASE + '/health', {
        headers: { accept: 'application/json' },
      });
      if (!response.ok) throw new Error('health ' + response.status);
      state.health = await response.json();

      if (state.health.configured) {
        setStatus('ready', 'Proxy ready');
      } else {
        setStatus('error', 'Proxy not configured');
        notice(
          'info',
          'The proxy is running but no API key is configured. Set APERTUS_API_KEY (and optionally APERTUS_BASE_URL, APERTUS_MODEL), then restart `npm start`.'
        );
      }
    } catch (error) {
      setStatus('error', 'Proxy unreachable');
      notice(
        'warn',
        'Cannot reach the Node.js proxy.'
      );
    }
  }

  checkHealth();
  autoGrow();
})();
