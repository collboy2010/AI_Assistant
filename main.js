const {
  app,
  BrowserWindow,
  globalShortcut,
  Tray,
  Menu,
  ipcMain,
  desktopCapturer,
  nativeImage,
  shell,
  safeStorage,
  dialog,
} = require('electron');
const path = require('path');
const fs = require('fs');

const SECRET_CONFIG_KEYS = ['apiKey', 'geminiKey', 'openaiKey', 'anthropicKey', 'deepseekKey', 'customKey'];

/* ── Force software rendering ──────────────────────────────── */
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('use-gl', 'swiftshader');
app.commandLine.appendSwitch('disable-software-rasterizer');

/* ── Portable vs Installed Data Directory ───────────────────────── */
const isPortable = Boolean(process.env.PORTABLE_EXECUTABLE_DIR);
let customDataDir = null;

if (isPortable) {
  customDataDir = path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'data');
} else if (!app.isPackaged) {
  customDataDir = path.join(__dirname, 'data');
}

if (customDataDir) {
  try {
    if (!fs.existsSync(customDataDir)) {
      fs.mkdirSync(customDataDir, { recursive: true });
    }
    app.setPath('userData', customDataDir);
  } catch (err) {
    console.warn('[DataDir] Could not set custom userData path:', err);
  }
}

/* ── Prevent multiple instances ────────────────────────────── */
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

/* ── Paths & State ─────────────────────────────────────────── */
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
let mainWindow = null;
let tray = null;
let isQuitting = false;

/* ── Config helpers (with safeStorage encryption) ──────────── */
function decryptSecret(val) {
  if (typeof val !== 'string' || !val.startsWith('enc:')) return val;
  try {
    if (safeStorage && safeStorage.isEncryptionAvailable()) {
      const buf = Buffer.from(val.slice(4), 'base64');
      return safeStorage.decryptString(buf);
    }
  } catch {}
  return '';
}

function encryptSecret(val) {
  if (typeof val !== 'string' || !val || val.startsWith('enc:')) return val;
  try {
    if (safeStorage && safeStorage.isEncryptionAvailable()) {
      return 'enc:' + safeStorage.encryptString(val).toString('base64');
    }
  } catch {}
  return val;
}

function loadConfig() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      const fallback = path.join(app.getPath('appData'), 'ai-overlay', 'config.json');
      if (fs.existsSync(fallback)) {
        fs.writeFileSync(CONFIG_PATH, fs.readFileSync(fallback, 'utf8'), 'utf8');
      }
    }
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    for (const k of SECRET_CONFIG_KEYS) {
      if (raw[k]) raw[k] = decryptSecret(raw[k]);
    }
    return raw;
  } catch {
    return {};
  }
}

function saveConfig(data) {
  const current = loadConfig();
  const cleanedData = {};
  for (const [k, v] of Object.entries(data || {})) {
    if (v !== undefined) cleanedData[k] = v;
  }
  const merged = { ...current, ...cleanedData };
  const toDisk = { ...merged };
  for (const k of SECRET_CONFIG_KEYS) {
    if (toDisk[k]) toDisk[k] = encryptSecret(toDisk[k]);
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(toDisk, null, 2));
}

/* ── Window ────────────────────────────────────────────────── */
function createWindow() {
  const W = 750;
  const H = 460;

  mainWindow = new BrowserWindow({
    width: W,
    height: H,
    x: 24,
    y: 24,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    frame: false,
    transparent: true,
    resizable: true,
    minWidth: 400,
    minHeight: 250,
    maxWidth: 1200,
    maxHeight: 800,
    skipTaskbar: false,
    show: true,
    alwaysOnTop: true,
    fullscreenable: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  mainWindow.webContents.on('console-message', (_, level, message, line, sourceId) => {
    console.log(`[Renderer ${level}] ${message} (${sourceId}:${line})`);
  });

  mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.show();
  mainWindow.focus();

  // Context menu for text copy
  mainWindow.webContents.on('context-menu', (e, params) => {
    if (params.selectionText && params.selectionText.trim() !== '') {
      Menu.buildFromTemplate([{ label: 'Копировать', role: 'copy' }])
        .popup({ window: mainWindow });
    }
  });

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function toggleWindow() {
  if (!mainWindow) return;
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

/* ── Tray ──────────────────────────────────────────────────── */
function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'icon-tray.png');
  let icon;
  try {
    icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
    if (typeof icon.setTemplateImage === 'function') icon.setTemplateImage(true);
  } catch {
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon);
  tray.setToolTip('AI Chat Overlay');

  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Открыть чат', click: () => { mainWindow.show(); mainWindow.focus(); } },
    { type: 'separator' },
    { label: 'Выход', click: () => { isQuitting = true; app.quit(); } },
  ]));

  tray.on('click', toggleWindow);
}

/* ── API Helpers ───────────────────────────────────────────── */
function decodeBase64ToUtf8(b64) {
  try { return Buffer.from(b64, 'base64').toString('utf-8'); }
  catch { return ''; }
}

function getRawBase64(val) {
  if (!val) return null;
  if (typeof val === 'string') {
    if (val === '(image)' || val.trim() === '') return null;
    return val.replace(/^data:[^;]+;base64,/, '').trim();
  }
  if (typeof val === 'object') {
    if (val.base64) return getRawBase64(val.base64);
    if (val.dataUrl) return getRawBase64(val.dataUrl);
    if (val.data) return getRawBase64(val.data);
  }
  return null;
}

function extractMessageImage(m) {
  if (!m) return null;
  if (m.image) {
    const raw = getRawBase64(m.image);
    if (raw) {
      const mime = (typeof m.image === 'object' && m.image.mimeType) || 'image/png';
      const fileName = (typeof m.image === 'object' && m.image.fileName) || 'screenshot.png';
      return { mime, data: raw, fileName };
    }
  }
  if (Array.isArray(m.parts)) {
    for (const p of m.parts) {
      if (p && p.inlineData) {
        const raw = getRawBase64(p.inlineData.data || p.inlineData);
        if (raw) {
          const mime = p.inlineData.mimeType || 'image/png';
          return { mime, data: raw, fileName: 'screenshot.png' };
        }
      }
    }
  }
  return null;
}

function extractMessageText(m) {
  if (m.content && typeof m.content === 'string') return m.content;
  if (Array.isArray(m.parts)) {
    const texts = m.parts.filter(p => p && p.text).map(p => p.text);
    if (texts.length > 0) return texts.join('\n');
  }
  return '';
}

function sanitizeConversation(messages) {
  const result = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const role = (m.role === 'model' || m.role === 'assistant' || m.role === 'ai') ? 'assistant' : 'user';
    const text = extractMessageText(m);
    const imgInfo = extractMessageImage(m);

    // If first message is assistant, skip it (Gemini / Anthropic require conversation to begin with user)
    if (result.length === 0 && role === 'assistant') {
      continue;
    }

    if (result.length > 0 && result[result.length - 1].role === role) {
      // Merge with previous message of the same role to maintain strict alternation
      const prev = result[result.length - 1];
      if (text) {
        prev.text = prev.text ? `${prev.text}\n\n${text}` : text;
      }
      if (imgInfo && !prev.imgInfo) {
        prev.imgInfo = imgInfo;
      }
    } else {
      result.push({ role, text: text || (imgInfo ? 'Что на изображении?' : ''), imgInfo });
    }
  }
  if (result.length === 0) {
    result.push({ role: 'user', text: 'Привет', imgInfo: null });
  }
  return result;
}

function toOpenAiMessages(messages) {
  const clean = sanitizeConversation(messages);
  let latestImgIdx = -1;
  for (let i = clean.length - 1; i >= 0; i--) {
    if (clean[i].imgInfo) { latestImgIdx = i; break; }
  }

  return clean.map((m, idx) => {
    const role = m.role;
    const text = m.text || '';

    // Only send heavy base64 image on the latest turn that has an image
    if (m.imgInfo && idx === latestImgIdx) {
      return {
        role,
        content: [
          { type: 'text', text: text || 'Что изображено на этом снимке?' },
          { type: 'image_url', image_url: { url: `data:${m.imgInfo.mime};base64,${m.imgInfo.data}` } }
        ]
      };
    } else if (m.imgInfo) {
      const histText = text ? `[Прикреплённый снимок экрана] ${text}` : '[Прикреплённый снимок экрана]';
      return { role, content: histText };
    }

    return { role, content: text || '...' };
  });
}

function toAnthropicMessages(messages) {
  const clean = sanitizeConversation(messages);
  let latestImgIdx = -1;
  for (let i = clean.length - 1; i >= 0; i--) {
    if (clean[i].imgInfo) { latestImgIdx = i; break; }
  }

  return clean.map((m, idx) => {
    const role = m.role;
    const text = m.text || '';

    if (m.imgInfo && idx === latestImgIdx) {
      return {
        role,
        content: [
          { type: 'image', source: { type: 'base64', media_type: m.imgInfo.mime, data: m.imgInfo.data } },
          { type: 'text', text: text || 'Проанализируй это изображение.' }
        ]
      };
    }

    return { role, content: text || '...' };
  });
}

/* ── Google Gemini API ── */
async function callGemini(apiKey, model, messages) {
  let cleanModel = (model || 'gemini-2.0-flash').trim();
  if (!cleanModel || cleanModel === 'gemini-2.5-flash' || cleanModel === 'gemini-3.5-flash-lite') {
    cleanModel = 'gemini-2.0-flash';
  }
  cleanModel = cleanModel.replace(/^models\//, '');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent`;

  const clean = sanitizeConversation(messages);
  let latestImgIdx = -1;
  for (let i = clean.length - 1; i >= 0; i--) {
    if (clean[i].imgInfo) { latestImgIdx = i; break; }
  }

  const contents = clean.map((m, idx) => {
    const role = m.role === 'assistant' ? 'model' : 'user';
    const parts = [];

    if (m.imgInfo && idx === latestImgIdx) {
      parts.push({ inlineData: { mimeType: m.imgInfo.mime, data: m.imgInfo.data } });
    }

    const t = m.text || (m.imgInfo ? 'Что на этом изображении?' : '...');
    parts.push({ text: t });

    return { role, parts };
  });

  const systemText =
    'Ты — полезный AI-помощник в оверлей-чате. Отвечай кратко и по делу. ' +
    'Если пользователь отправляет скриншот, анализируй его содержимое. ' +
    'Отвечай на том языке, на котором к тебе обращаются.';

  const body = {
    contents,
    generationConfig: { temperature: 0.7, maxOutputTokens: 4096 },
    systemInstruction: { parts: [{ text: systemText }] },
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!res.ok) {
      let errMsg = `Gemini API error (${res.status})`;
      try {
        const errData = await res.json();
        if (errData?.error?.message) errMsg = errData.error.message;
      } catch {
        try {
          const text = await res.text();
          if (text) errMsg += ` - ${text.slice(0, 180)}`;
        } catch {}
      }
      throw new Error(errMsg);
    }

    const data = await res.json();
    if (data.error) throw new Error(data.error.message || `Gemini API error (${res.status})`);
    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    let thoughtText = '';
    let contentText = '';
    for (const p of parts) {
      if (p.thought) thoughtText += p.text || '';
      else if (p.text) contentText += p.text;
    }
    let text = contentText;
    if (thoughtText && contentText) text = `<think>${thoughtText}</think>\n\n` + contentText;
    else if (!text && thoughtText) text = thoughtText;

    if (!text) {
      if (candidate?.finishReason && candidate.finishReason !== 'STOP') {
        throw new Error(`Модель завершила ответ с кодом: ${candidate.finishReason}`);
      }
      throw new Error('Модель вернула пустой ответ');
    }
    return text;
  } finally {
    clearTimeout(timeoutId);
  }
}

function normalizeBaseUrl(rawUrl, provider) {
  if (provider === 'deepseek') return 'https://api.deepseek.com';
  if (!rawUrl || !rawUrl.trim()) {
    if (provider === 'custom') return 'http://localhost:11434/v1';
    return 'https://api.openai.com/v1';
  }
  let u = rawUrl.trim().replace(/\/+$/, '');
  u = u.replace(/\/chat\/completions$/, '');

  try {
    const parsed = new URL(u);
    if (!parsed.pathname || parsed.pathname === '/' || parsed.pathname === '') {
      u = parsed.origin + '/v1';
    }
  } catch {
    if (/^https?:\/\/[^\/]+$/i.test(u)) {
      u += '/v1';
    }
  }
  return u;
}

/* ── OpenAI / Custom compatible API ── */
async function callOpenAI(apiKey, model, messages, baseUrl = 'https://api.openai.com/v1') {
  const systemInstruction =
    'Ты — полезный AI-помощник в оверлей-чате. Отвечай кратко и по делу. ' +
    'Если пользователь отправляет скриншот, анализируй его содержимое. ' +
    'Отвечай на том языке, на котором к тебе обращаются.';

  const formatted = toOpenAiMessages(messages);
  formatted.unshift({ role: 'system', content: systemInstruction });

  const cleanBase = normalizeBaseUrl(baseUrl);
  let targetUrl = `${cleanBase}/chat/completions`;

  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const payload = JSON.stringify({
    model: model || 'gpt-4o-mini',
    messages: formatted,
    temperature: 0.7,
    max_tokens: 4096
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);

  try {
    let res = await fetch(targetUrl, {
      method: 'POST',
      headers,
      body: payload,
      signal: controller.signal
    });

    // If 404, automatically attempt alternate route (/v1/chat/completions <-> /chat/completions)
    if (res.status === 404) {
      const altUrl = targetUrl.includes('/v1/chat/completions')
        ? targetUrl.replace('/v1/chat/completions', '/chat/completions')
        : targetUrl.replace('/chat/completions', '/v1/chat/completions');

      if (altUrl !== targetUrl) {
        try {
          const altRes = await fetch(altUrl, {
            method: 'POST',
            headers,
            body: payload,
            signal: controller.signal
          });
          if (altRes.ok || altRes.status !== 404) {
            res = altRes;
          }
        } catch {}
      }
    }

    if (!res.ok) {
      let errMsg = `HTTP ${res.status}: ${res.statusText || 'Error'}`;
      try {
        const errData = await res.json();
        if (errData?.error?.message) errMsg = errData.error.message;
        else if (errData?.error) errMsg = typeof errData.error === 'string' ? errData.error : JSON.stringify(errData.error);
        else if (errData?.message) errMsg = errData.message;
      } catch {
        try {
          const text = await res.text();
          if (text) errMsg += ` - ${text.slice(0, 180)}`;
        } catch {}
      }
      throw new Error(errMsg);
    }

    const data = await res.json();
    if (data.error) {
      const msg = data.error.message || (typeof data.error === 'string' ? data.error : JSON.stringify(data.error));
      throw new Error(msg);
    }

    const choiceMsg = data.choices?.[0]?.message;
    const content = choiceMsg?.content || choiceMsg?.text || '';
    const reasoning = choiceMsg?.reasoning_content || '';
    let replyContent = content;
    if (reasoning && content) {
      replyContent = `<think>${reasoning}</think>\n\n` + content;
    } else if (!replyContent && reasoning) {
      replyContent = reasoning;
    }
    if (!replyContent) throw new Error('No response from AI');
    return replyContent;
  } finally {
    clearTimeout(timeoutId);
  }
}

/* ── Anthropic API ── */
async function callAnthropic(apiKey, model, messages) {
  const systemInstruction =
    'Ты — полезный AI-помощник в оверлей-чате. Отвечай кратко и по делу. ' +
    'Если пользователь отправляет скриншот, анализируй его содержимое. ' +
    'Отвечай на том языке, на котором к тебе обращаются.';

  const formatted = toAnthropicMessages(messages);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: model || 'claude-3-5-sonnet-20241022',
        max_tokens: 4096,
        messages: formatted,
        system: systemInstruction,
        temperature: 0.7
      }),
      signal: controller.signal
    });

    if (!res.ok) {
      let errMsg = `Anthropic API error (${res.status})`;
      try {
        const errData = await res.json();
        if (errData?.error?.message) errMsg = errData.error.message;
      } catch {
        try {
          const text = await res.text();
          if (text) errMsg += ` - ${text.slice(0, 180)}`;
        } catch {}
      }
      throw new Error(errMsg);
    }

    const data = await res.json();
    if (data.error) throw new Error(data.error.message || 'Anthropic API error');
    const textBlocks = (data.content || []).filter(c => c.type === 'text' && c.text).map(c => c.text);
    const replyText = textBlocks.join('\n\n') || data.content?.[0]?.text || '';
    if (!replyText) throw new Error('Модель вернула пустой ответ');
    return replyText;
  } finally {
    clearTimeout(timeoutId);
  }
}

const SYSTEM_INSTRUCTION =
  'Ты — полезный AI-помощник в оверлей-чате. Отвечай кратко и по делу. ' +
  'Если пользователь отправляет скриншот, анализируй его содержимое. ' +
  'Отвечай на том языке, на котором к тебе обращаются.';

/* ── SSE Streaming Helpers ─────────────────────────────────── */
async function parseSseStream(res, onData) {
  if (!res.body || !res.body.getReader) {
    return new Promise((resolve, reject) => {
      let buffer = '';
      res.body.on('data', (chunk) => {
        buffer += chunk.toString('utf-8');
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line || line.startsWith(':')) continue;
          if (line.startsWith('data:')) {
            const payload = line.slice(5).trim();
            if (payload === '[DONE]') return resolve();
            try { onData(JSON.parse(payload)); } catch {}
          }
        }
      });
      res.body.on('end', () => {
        if (buffer.trim().startsWith('data:')) {
          const payload = buffer.trim().slice(5).trim();
          if (payload !== '[DONE]') {
            try { onData(JSON.parse(payload)); } catch {}
          }
        }
        resolve();
      });
      res.body.on('error', reject);
    });
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith(':')) continue;
      if (line.startsWith('data:')) {
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') return;
        try {
          const json = JSON.parse(payload);
          onData(json);
        } catch {}
      }
    }
  }

  if (buffer.trim()) {
    const line = buffer.trim();
    if (line.startsWith('data:')) {
      const payload = line.slice(5).trim();
      if (payload !== '[DONE]') {
        try {
          const json = JSON.parse(payload);
          onData(json);
        } catch {}
      }
    }
  }
}

async function streamGemini(apiKey, model, messages, streamId, win, signal) {
  let cleanModel = (model || 'gemini-2.0-flash').trim();
  if (!cleanModel || cleanModel === 'gemini-2.5-flash' || cleanModel === 'gemini-3.5-flash-lite') {
    cleanModel = 'gemini-2.0-flash';
  }
  cleanModel = cleanModel.replace(/^models\//, '');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:streamGenerateContent?alt=sse&key=${apiKey}`;

  const clean = sanitizeConversation(messages);
  let latestImgIdx = -1;
  for (let i = clean.length - 1; i >= 0; i--) {
    if (clean[i].imgInfo) { latestImgIdx = i; break; }
  }

  const contents = clean.map((m, idx) => {
    const role = m.role === 'assistant' ? 'model' : 'user';
    const parts = [];
    if (m.imgInfo && idx === latestImgIdx) {
      parts.push({ inlineData: { mimeType: m.imgInfo.mime, data: m.imgInfo.data } });
    }
    const t = m.text || (m.imgInfo ? 'Что на этом изображении?' : '...');
    parts.push({ text: t });
    return { role, parts };
  });

  const body = {
    contents,
    generationConfig: { temperature: 0.7, maxOutputTokens: 4096 },
    systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    let errMsg = `Gemini API error (${res.status})`;
    try {
      const errData = await res.json();
      if (errData?.error?.message) errMsg = errData.error.message;
    } catch {
      try { const t = await res.text(); if (t) errMsg += ` - ${t.slice(0, 180)}`; } catch {}
    }
    throw new Error(errMsg);
  }

  let fullText = '';
  let inThinking = false;
  await parseSseStream(res, (data) => {
    if (data.error) throw new Error(data.error.message || 'Gemini streaming error');
    const parts = data.candidates?.[0]?.content?.parts || [];
    for (const p of parts) {
      const isThought = Boolean(p.thought);
      const text = p.text || '';
      if (!text) continue;

      if (isThought) {
        if (!inThinking) {
          inThinking = true;
          const startTag = '<think>';
          fullText += startTag;
          win?.webContents.send('stream-token', { streamId, token: startTag, fullText, done: false });
        }
        fullText += text;
        win?.webContents.send('stream-token', { streamId, token: text, fullText, done: false });
      } else {
        if (inThinking) {
          inThinking = false;
          const endTag = '</think>\n\n';
          fullText += endTag;
          win?.webContents.send('stream-token', { streamId, token: endTag, fullText, done: false });
        }
        fullText += text;
        win?.webContents.send('stream-token', { streamId, token: text, fullText, done: false });
      }
    }
  });

  if (inThinking) {
    inThinking = false;
    fullText += '</think>\n\n';
    win?.webContents.send('stream-token', { streamId, token: '</think>\n\n', fullText, done: false });
  }

  return fullText;
}

async function streamOpenAI(apiKey, model, messages, baseUrl = 'https://api.openai.com/v1', streamId, win, signal) {
  const formatted = toOpenAiMessages(messages);
  formatted.unshift({ role: 'system', content: SYSTEM_INSTRUCTION });

  const cleanBase = normalizeBaseUrl(baseUrl);
  let targetUrl = `${cleanBase}/chat/completions`;

  const headers = { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const payload = JSON.stringify({
    model: model || 'gpt-4o-mini',
    messages: formatted,
    temperature: 0.7,
    max_tokens: 4096,
    stream: true,
  });

  let res = await fetch(targetUrl, {
    method: 'POST',
    headers,
    body: payload,
    signal,
  });

  if (res.status === 404) {
    const altUrl = targetUrl.includes('/v1/chat/completions')
      ? targetUrl.replace('/v1/chat/completions', '/chat/completions')
      : targetUrl.replace('/chat/completions', '/v1/chat/completions');
    if (altUrl !== targetUrl) {
      try {
        const altRes = await fetch(altUrl, { method: 'POST', headers, body: payload, signal });
        if (altRes.ok || altRes.status !== 404) res = altRes;
      } catch {}
    }
  }

  if (!res.ok) {
    let errMsg = `HTTP ${res.status}: ${res.statusText || 'Error'}`;
    try {
      const errData = await res.json();
      if (errData?.error?.message) errMsg = errData.error.message;
      else if (errData?.error) errMsg = typeof errData.error === 'string' ? errData.error : JSON.stringify(errData.error);
    } catch {
      try { const t = await res.text(); if (t) errMsg += ` - ${t.slice(0, 180)}`; } catch {}
    }
    throw new Error(errMsg);
  }

  let fullText = '';
  let inThinking = false;
  await parseSseStream(res, (data) => {
    if (data.error) {
      const msg = data.error.message || (typeof data.error === 'string' ? data.error : JSON.stringify(data.error));
      throw new Error(msg);
    }
    const choice = data.choices?.[0];
    const delta = choice?.delta;

    // Handle reasoning/thinking content
    if (delta?.reasoning_content) {
      if (!inThinking) {
        inThinking = true;
        const startTag = '<think>';
        fullText += startTag;
        win?.webContents.send('stream-token', { streamId, token: startTag, fullText, done: false });
      }
      fullText += delta.reasoning_content;
      win?.webContents.send('stream-token', { streamId, token: delta.reasoning_content, fullText, done: false });
    }

    // Handle actual message content
    const content = delta?.content || (delta && !delta.reasoning_content ? delta.text : '') || '';
    if (content) {
      if (inThinking) {
        inThinking = false;
        const endTag = '</think>\n\n';
        fullText += endTag;
        win?.webContents.send('stream-token', { streamId, token: endTag, fullText, done: false });
      }
      fullText += content;
      win?.webContents.send('stream-token', { streamId, token: content, fullText, done: false });
    }
  });

  if (inThinking) {
    inThinking = false;
    fullText += '</think>\n\n';
    win?.webContents.send('stream-token', { streamId, token: '</think>\n\n', fullText, done: false });
  }

  return fullText;
}

async function streamAnthropic(apiKey, model, messages, streamId, win, signal) {
  const formatted = toAnthropicMessages(messages);

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: model || 'claude-3-5-sonnet-20241022',
      max_tokens: 4096,
      messages: formatted,
      system: SYSTEM_INSTRUCTION,
      temperature: 0.7,
      stream: true,
    }),
    signal,
  });

  if (!res.ok) {
    let errMsg = `Anthropic API error (${res.status})`;
    try {
      const errData = await res.json();
      if (errData?.error?.message) errMsg = errData.error.message;
    } catch {
      try { const t = await res.text(); if (t) errMsg += ` - ${t.slice(0, 180)}`; } catch {}
    }
    throw new Error(errMsg);
  }

  let fullText = '';
  await parseSseStream(res, (data) => {
    if (data.type === 'content_block_delta' && data.delta?.text) {
      const token = data.delta.text;
      fullText += token;
      win?.webContents.send('stream-token', { streamId, token, fullText, done: false });
    }
  });

  return fullText;
}

const activeStreams = new Map();

/* ── IPC ───────────────────────────────────────────────────── */
function setupIPC() {
  ipcMain.handle('get-config', () => loadConfig());
  ipcMain.handle('save-config', (_, data) => { saveConfig(data); return true; });

  ipcMain.handle('stream-message', async (_, { provider, apiKey, model, messages, customUrl, streamId }) => {
    const controller = new AbortController();
    activeStreams.set(streamId, controller);
    try {
      let fullText = '';
      const p = provider || 'gemini';

      if (p === 'gemini') {
        fullText = await streamGemini(apiKey, model, messages, streamId, mainWindow, controller.signal);
      } else if (p === 'openai') {
        fullText = await streamOpenAI(apiKey, model, messages, 'https://api.openai.com/v1', streamId, mainWindow, controller.signal);
      } else if (p === 'anthropic') {
        fullText = await streamAnthropic(apiKey, model, messages, streamId, mainWindow, controller.signal);
      } else if (p === 'deepseek') {
        fullText = await streamOpenAI(apiKey, model, messages, 'https://api.deepseek.com', streamId, mainWindow, controller.signal);
      } else if (p === 'custom') {
        const conf = loadConfig();
        const effectiveUrl = customUrl || conf.customUrl || 'http://localhost:11434/v1';
        fullText = await streamOpenAI(apiKey, model, messages, effectiveUrl, streamId, mainWindow, controller.signal);
      } else {
        throw new Error(`Unknown provider: ${p}`);
      }

      mainWindow?.webContents.send('stream-token', { streamId, fullText, done: true });
      return { success: true, text: fullText };
    } catch (err) {
      if (controller.signal.aborted) {
        mainWindow?.webContents.send('stream-token', { streamId, stopped: true, done: true });
        return { success: true, stopped: true };
      }
      mainWindow?.webContents.send('stream-token', { streamId, error: err.message, done: true });
      return { success: false, error: err.message };
    } finally {
      activeStreams.delete(streamId);
    }
  });

  ipcMain.handle('stop-stream', (_, streamId) => {
    const controller = activeStreams.get(streamId);
    if (controller) {
      controller.abort();
      activeStreams.delete(streamId);
      return { success: true };
    }
    return { success: false };
  });

  ipcMain.handle('send-message', async (_, { provider, apiKey, model, messages, customUrl }) => {
    try {
      let response;
      const p = provider || 'gemini';

      if (p === 'gemini') response = await callGemini(apiKey, model, messages);
      else if (p === 'openai') response = await callOpenAI(apiKey, model, messages, 'https://api.openai.com/v1');
      else if (p === 'anthropic') response = await callAnthropic(apiKey, model, messages);
      else if (p === 'deepseek') response = await callOpenAI(apiKey, model, messages, 'https://api.deepseek.com');
      else if (p === 'custom') {
        const conf = loadConfig();
        const effectiveUrl = customUrl || conf.customUrl || 'http://localhost:11434/v1';
        response = await callOpenAI(apiKey, model, messages, effectiveUrl);
      }
      else throw new Error(`Unknown provider: ${p}`);

      return { success: true, text: response, response };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('set-hotkey', (_, newShortcut) => {
    try {
      const config = loadConfig();
      const oldShortcut = config.hotkey || 'CommandOrControl+Shift+Space';
      try { globalShortcut.unregister(oldShortcut); } catch {}

      const ok = globalShortcut.register(newShortcut, toggleWindow);
      if (ok) {
        saveConfig({ hotkey: newShortcut });
        return { success: true };
      } else {
        try { globalShortcut.register(oldShortcut, toggleWindow); } catch {}
        return { success: false, error: 'Сочетание клавиш занято другой программой' };
      }
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('take-screenshot', async () => {
    try {
      mainWindow.hide();
      await new Promise(r => setTimeout(r, 350));

      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1920, height: 1080 },
      });

      mainWindow.show();
      mainWindow.focus();

      if (sources.length > 0) {
        const dataUrl = sources[0].thumbnail.toDataURL();
        const base64 = dataUrl.replace(/^data:[^;]+;base64,/, '');
        return { success: true, dataUrl, base64 };
      }
      return { success: false, error: 'No screen found' };
    } catch (err) {
      mainWindow.show();
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('export-chat', async (_, { content, filename }) => {
    try {
      if (!mainWindow) return { success: false, error: 'Окно недоступно' };
      const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
        defaultPath: filename,
        title: 'Экспорт диалога',
        filters: [
          { name: 'Все файлы', extensions: ['*'] }
        ]
      });
      if (canceled || !filePath) return { success: false, canceled: true };
      fs.writeFileSync(filePath, content, 'utf8');
      return { success: true, filePath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('hide-window', () => mainWindow.hide());

  ipcMain.handle('open-external', (_, url) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        return shell.openExternal(url);
      }
    } catch {}
    return Promise.reject(new Error('Invalid URL'));
  });

  ipcMain.handle('set-window-scale', (_, scale) => {
    if (!mainWindow) return;
    const W = Math.round(750 * (scale / 100));
    const H = Math.round(460 * (scale / 100));
    mainWindow.setMinimumSize(Math.round(400 * (scale / 100)), Math.round(250 * (scale / 100)));
    mainWindow.setMaximumSize(Math.round(1200 * (scale / 100)), Math.round(800 * (scale / 100)));
    const bounds = mainWindow.getBounds();
    const cx = bounds.x + Math.round(bounds.width / 2);
    const cy = bounds.y + Math.round(bounds.height / 2);
    mainWindow.setBounds({ x: cx - Math.round(W / 2), y: cy - Math.round(H / 2), width: W, height: H });
  });
}

/* ── Lifecycle ─────────────────────────────────────────────── */
app.whenReady().then(() => {
  console.log('[AI Overlay 2.0] Starting...');
  createWindow();
  createTray();
  setupIPC();
  const hotkey = loadConfig().hotkey || 'CommandOrControl+Shift+Space';
  try {
    globalShortcut.register(hotkey, toggleWindow);
  } catch (err) {
    console.warn('[Hotkey] Registration failed:', err);
  }
  console.log('[AI Overlay 2.0] Ready!');
}).catch(err => {
  console.error('[AI Overlay 2.0] Fatal:', err);
});

app.on('second-instance', () => {
  if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {});
