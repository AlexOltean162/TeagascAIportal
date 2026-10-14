/*
 * Teag-Ask attachments: PDFs and images (invoices, receipts, soil / milk reports, photos).
 *
 *   📎 button, drag-and-drop anywhere, or paste an image → a chip appears above the question box
 *   → the file is read straight away by /api/attachments/extract (OCR by the chat model's vision)
 *   → on send, the extracted text rides along with the question (and with every follow-up in the
 *     same conversation, until "New chat"), so "what was the VAT?" works without re-uploading.
 *
 * Like teag-ask-voice.js this sits beside the React bundle: it adds DOM to the composer and adds an
 * `attachments` field to the bundle's own /api/chat(/stream) request by wrapping window.fetch.
 */
(function () {
  'use strict';
  const ACCESS_KEY_STORAGE = 'teagask-preprod-access-key';
  const TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif'];
  const MAX_BYTES = 10 * 1024 * 1024;
  const MAX_FILES = 5;

  const ICON = {
    clip: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M20 11.5l-7.8 7.8a5 5 0 0 1-7.1-7.1l8.1-8.1a3.4 3.4 0 0 1 4.8 4.8l-8.1 8.1a1.7 1.7 0 0 1-2.4-2.4l7.4-7.4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    pdf: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M6 2.8h8.2L19 7.6v13.6H6z" fill="currentColor" opacity=".16"/><path d="M6 2.8h8.2L19 7.6v13.6H6zM14 2.8v5h5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><text x="12.5" y="17.6" text-anchor="middle" font-size="5.2" font-weight="700" fill="currentColor" font-family="Inter,Arial,sans-serif">PDF</text></svg>',
    x: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
    warn: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M12 3l10 18H2z" fill="currentColor"/><path d="M12 10v5M12 17.6v.4" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>',
  };

  let pending = [];      // in the composer, not sent yet: { id, file, name, type, size, status, text, thumb, error, promise }
  let convo = [];        // sent in this conversation, re-sent with each follow-up
  let labelNext = null;  // names to show on the next user message row
  let seq = 0;

  const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html) n.innerHTML = html; return n; };
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const kb = n => n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`;
  const accessKey = () => { try { return localStorage.getItem(ACCESS_KEY_STORAGE) || ''; } catch (_) { return ''; } };

  // ---------------------------------------------------------------- adding files
  function add(files) {
    const list = [...files];
    for (const file of list) {
      if (pending.length + convo.length >= MAX_FILES) { notice(`Up to ${MAX_FILES} files per conversation. Start a new chat to attach more.`); break; }
      const type = file.type === 'image/jpg' ? 'image/jpeg' : file.type;
      if (!TYPES.includes(type)) { notice(`${file.name || 'That file'} isn’t supported. Attach a PDF or an image (PNG, JPG, WebP, GIF).`); continue; }
      if (file.size > MAX_BYTES) { notice(`${file.name} is over 10 MB.`); continue; }
      const item = {
        id: ++seq, file, type, size: file.size, status: 'reading', text: '', error: '',
        name: file.name || (type === 'application/pdf' ? 'document.pdf' : `pasted-image.${type.split('/')[1]}`),
        thumb: type.startsWith('image/') ? URL.createObjectURL(file) : '',
      };
      item.promise = read(item);
      pending.push(item);
    }
    render();
    document.getElementById('question')?.focus({ preventScroll: true });
  }

  async function read(item) {
    try {
      const res = await fetch('api/attachments/extract', {
        method: 'POST',
        headers: { 'Content-Type': item.type, 'x-app-key': accessKey(), 'x-file-name': encodeURIComponent(item.name) },
        body: item.file,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'That file could not be read.');
      item.text = String(data.text || '');
      item.status = 'ready';
    } catch (err) {
      item.status = 'error';
      item.error = err && err.message ? err.message : 'That file could not be read.';
    }
    render();
  }

  function remove(id) {
    const item = pending.find(p => p.id === id);
    if (item && item.thumb) URL.revokeObjectURL(item.thumb);
    pending = pending.filter(p => p.id !== id);
    render();
  }

  // ---------------------------------------------------------------- composer UI
  function chip(item, removable) {
    const c = el('div', `taa-chip taa-chip--${item.status || 'ready'}`);
    const visual = item.thumb
      ? `<img class="taa-thumb" src="${item.thumb}" alt="">`
      : `<span class="taa-thumb taa-thumb--pdf">${ICON.pdf}</span>`;
    const sub = item.status === 'reading' ? 'Reading…' : item.status === 'error' ? esc(item.error) : `${item.type === 'application/pdf' ? 'PDF' : 'Image'} · ${kb(item.size)}`;
    c.innerHTML = `${visual}<span class="taa-meta"><span class="taa-name" title="${esc(item.name)}">${esc(item.name)}</span>` +
      `<span class="taa-sub">${item.status === 'error' ? ICON.warn : ''}${sub}</span></span>` +
      (item.status === 'reading' ? '<span class="taa-scan" aria-hidden="true"></span>' : '');
    if (removable) {
      const x = el('button', 'taa-remove', ICON.x);
      x.type = 'button';
      x.setAttribute('aria-label', `Remove ${item.name}`);
      x.addEventListener('click', () => remove(item.id));
      c.appendChild(x);
    }
    return c;
  }

  function render() {
    document.querySelectorAll('.composer').forEach(composer => {
      let tray = composer.querySelector(':scope > .taa-tray');
      if (!pending.length) { if (tray) tray.remove(); return; }
      if (!tray) {
        tray = el('div', 'taa-tray');
        tray.setAttribute('aria-live', 'polite');
        composer.insertBefore(tray, composer.firstChild);
      }
      tray.replaceChildren(...pending.map(item => chip(item, true)));
      // shown only while the question box is empty (CSS: :placeholder-shown)
      if (pending.some(p => p.status === 'ready')) {
        const hint = el('button', 'taa-suggest', 'Extract the key details');
        hint.type = 'button';
        hint.addEventListener('click', () => {
          const names = pending.filter(p => p.status === 'ready').map(p => p.name).join(', ');
          setQuestion(`Extract the key details from ${names} as a table (for an invoice: supplier, invoice number, dates, line items, VAT and totals).`);
        });
        tray.appendChild(hint);
      }
    });
  }

  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  function setQuestion(text) {
    const q = document.getElementById('question');
    if (!q) return;
    setValue.call(q, text);
    q.dispatchEvent(new Event('input', { bubbles: true }));
    q.focus({ preventScroll: true });
    q.setSelectionRange(text.length, text.length);
    render();
  }

  function notice(text) {
    const main = document.querySelector('.composer-main');
    if (!main) return;
    main.querySelectorAll('.tav-toast').forEach(t => t.remove());
    const t = el('div', 'tav-toast');             // shares the voice-input toast style
    t.setAttribute('role', 'status');
    t.textContent = text;
    main.appendChild(t);
    setTimeout(() => t.classList.add('tav-toast--out'), 3800);
    setTimeout(() => t.remove(), 4200);
  }

  const picker = el('input');
  picker.type = 'file';
  picker.multiple = true;
  picker.accept = TYPES.join(',') + ',.pdf,.jpg,.jpeg,.png,.webp,.gif';
  picker.hidden = true;
  picker.addEventListener('change', () => { add(picker.files); picker.value = ''; });

  function attach(main) {
    if (main.querySelector(':scope > .taa-clip')) return;
    const anchor = main.querySelector(':scope > .tav-mic') || main.querySelector(':scope > .ask-button');
    if (!anchor) return;
    const b = el('button', 'tav-mic taa-clip', ICON.clip);   // same round ghost style as the mic
    b.type = 'button';
    b.setAttribute('aria-label', 'Attach a PDF or image');
    b.title = 'Attach a PDF or image';
    b.addEventListener('click', e => { e.preventDefault(); picker.click(); });
    main.insertBefore(b, anchor);
  }

  // ---------------------------------------------------------------- drag-and-drop and paste
  let dragDepth = 0, dropZone = null;
  const hasFiles = e => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  addEventListener('dragenter', e => {
    if (!hasFiles(e) || !document.querySelector('.composer')) return;
    e.preventDefault();
    if (++dragDepth === 1) {
      dropZone = el('div', 'taa-drop', `<div class="taa-drop-card">${ICON.clip}<strong>Drop to attach</strong><span>PDFs and images, up to 10 MB</span></div>`);
      if (document.querySelector('.app-shell.dark-mode')) dropZone.classList.add('taa-drop--dark');
      document.body.appendChild(dropZone);
    }
  });
  addEventListener('dragover', e => { if (hasFiles(e) && dropZone) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  addEventListener('dragleave', e => { if (hasFiles(e) && --dragDepth <= 0) clearDrop(); });
  addEventListener('drop', e => {
    if (!hasFiles(e) || !dropZone) return;
    e.preventDefault();
    clearDrop();
    add(e.dataTransfer.files);
  });
  function clearDrop() { dragDepth = 0; if (dropZone) { dropZone.remove(); dropZone = null; } }

  document.addEventListener('paste', e => {
    if (e.target.id !== 'question' || !e.clipboardData) return;
    const files = [...e.clipboardData.files].filter(f => TYPES.includes(f.type));
    if (files.length) { e.preventDefault(); add(files); }
  }, true);

  // ---------------------------------------------------------------- send the extracted text with the question
  const realFetch = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : input && input.url;
    const path = url ? new URL(url, location.href).pathname : '';
    if (/\/api\/chat(\/stream)?$/.test(path) && init && typeof init.body === 'string' && (pending.length || convo.length)) {
      const sending = pending;
      pending = [];
      render();
      await Promise.all(sending.map(p => p.promise));      // pressed send while a file was still being read
      const ready = sending.filter(p => p.status === 'ready');
      if (ready.length) labelNext = ready.map(p => ({ name: p.name, type: p.type, thumb: p.thumb, size: p.size }));
      convo.push(...ready);
      try {
        const body = JSON.parse(init.body);
        body.attachments = convo.map(p => ({ name: p.name, text: p.text }));
        init = { ...init, body: JSON.stringify(body) };
      } catch (_) { /* not JSON: send unchanged */ }
      labelRows();
    }
    return realFetch(input, init);
  };

  // show the files on the user's message, like ChatGPT / Claude
  function labelRows() {
    if (!labelNext) return;
    const rows = document.querySelectorAll('.message-row.user');
    const row = rows[rows.length - 1];
    if (!row || row.dataset.taa) return;
    const body = row.querySelector('.message-body');
    if (!body) return;
    row.dataset.taa = '1';
    const list = el('div', 'taa-sent');
    labelNext.forEach(item => list.appendChild(chip({ ...item, status: 'sent' }, false)));
    body.insertBefore(list, body.firstChild);
    labelNext = null;
  }

  // [A1] markers in answers (rendered by the bundle as .citation--attachment): give each the same
  // hover/focus popover as a web source, naming the file and showing the start of what was read.
  function annotateCitations() {
    document.querySelectorAll('.citation--attachment:not([data-taa-pop])').forEach(c => {
      const item = convo[parseInt((c.dataset.cite || '').slice(1), 10) - 1];
      if (!item) return;
      c.dataset.taaPop = '1';
      const excerpt = item.text.replace(/[#|*_>`-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
      const pop = el('span', 'citation-popover');
      pop.innerHTML = `<span class="citation-popover-title">${esc(item.name)}</span>` +
        `<span class="citation-popover-excerpt">${esc(excerpt)}${item.text.length > 180 ? '…' : ''}</span>` +
        `<span class="citation-popover-link taa-pop-kind">Your attached ${item.type === 'application/pdf' ? 'PDF' : 'image'} · ${kb(item.size)}</span>`;
      c.appendChild(pop);
      // keep the popover inside the window near either edge
      const place = () => requestAnimationFrame(() => {
        pop.style.setProperty('--taa-nudge', '0px');
        const r = pop.getBoundingClientRect(), pad = 8;
        const nudge = r.right > innerWidth - pad ? innerWidth - pad - r.right : r.left < pad ? pad - r.left : 0;
        pop.style.setProperty('--taa-nudge', `${Math.round(nudge)}px`);
      });
      c.addEventListener('mouseenter', place);
      c.addEventListener('focus', place);
      c.setAttribute('aria-label', `Attached file ${c.dataset.cite}: ${item.name}`);
    });
  }

  function reset() {
    [...pending, ...convo].forEach(p => p.thumb && URL.revokeObjectURL(p.thumb));
    pending = []; convo = []; labelNext = null;
    render();
  }
  document.addEventListener('click', e => { if (e.target.closest && e.target.closest('.new-chat-button')) reset(); }, true);

  function scan() {
    if (!document.body.contains(picker)) document.body.appendChild(picker);
    document.querySelectorAll('.composer-main').forEach(attach);
    // React swaps the composer (welcome → chat): put the tray back in the new one
    if (pending.length && !document.querySelector('.composer > .taa-tray')) render();
    labelRows();
    annotateCitations();
  }
  new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState !== 'loading') scan(); else document.addEventListener('DOMContentLoaded', scan);
})();
