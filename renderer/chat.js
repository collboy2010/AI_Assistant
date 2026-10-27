/* ══════════════════════════════════════════════════════════════
   AI Chat Overlay v0.20 — Chat Logic
   ══════════════════════════════════════════════════════════════ */

let activeProvider = 'gemini';
let providerKeys = { gemini: '', openai: '', anthropic: '', deepseek: '', custom: '' };
let selectedModel = '';
let opacity = 70;
let uiScale = 100;
let messages = [];
let currentScreenshot = null;
let isLoading = false;
let currentTheme = 'graphite';
let customAccentColor = null; // { accent, accentHover, accentText }

function normalizeBase64(input) {
  if (!input) return null;
  if (typeof input === 'string') {
    if (input === '(image)' || input.trim() === '') return null;
    return input.replace(/^data:[^;]+;base64,/, '').trim();
  }
  if (typeof input === 'object') {
    if (input.base64) return normalizeBase64(input.base64);
    if (input.dataUrl) return normalizeBase64(input.dataUrl);
    if (input.data) return normalizeBase64(input.data);
  }
  return null;
}

function extractThoughts(rawText) {
  if (!rawText) return { cleanText: '', thought: '', isThinking: false };

  let isThinking = false;
  const thoughts = [];
  let cleanText = rawText;

  // 1. Handle complete <think>...</think> tags
  cleanText = cleanText.replace(/<think>([\s\S]*?)<\/think>/gi, (_, th) => {
    if (th.trim()) thoughts.push(th.trim());
    return '';
  });

  // 2. Handle unclosed opening tag at the end (active streaming)
  const openMatch = cleanText.match(/<think>([\s\S]*)$/i);
  if (openMatch) {
    if (openMatch[1].trim()) thoughts.push(openMatch[1].trim());
    cleanText = cleanText.replace(/<think>([\s\S]*)$/i, '');
    isThinking = true;
  }

  const thought = thoughts.join('\n\n---\n\n').trim();
  cleanText = cleanText.trim();

  return { cleanText, thought, isThinking };
}

function updateAiMessageElement(div, rawText, isStreaming) {
  if (!div) return;
  const { cleanText, thought, isThinking } = extractThoughts(rawText);

  // Store clean text for copy button
  div.dataset.cleanText = cleanText;

  // 1. Update message text area
  const textDiv = div.querySelector('.message-text');
  if (textDiv) {
    if (isStreaming) {
      if (cleanText) {
        textDiv.innerHTML = renderMd(cleanText) + '<span class="streaming-cursor"></span>';
      } else if (isThinking || thought) {
        textDiv.innerHTML = '<span class="thinking-label">Модель думает...</span><span class="streaming-cursor"></span>';
      } else {
        textDiv.innerHTML = '<span class="streaming-cursor"></span>';
      }
    } else {
      if (cleanText) {
        textDiv.innerHTML = renderMd(cleanText);
      } else if (thought) {
        textDiv.innerHTML = '<span class="thinking-label" style="opacity:0.6;">(Ответ состоит только из размышлений)</span>';
      } else {
        textDiv.innerHTML = '';
      }
    }
  }

  // 2. Manage top-right ? thought badge & popover
  let thoughtBtn = div.querySelector('.msg-thought-btn');
  let popover = div.querySelector('.msg-thought-popover');

  if (thought || isThinking) {
    if (!thoughtBtn) {
      thoughtBtn = document.createElement('button');
      thoughtBtn.className = 'msg-thought-btn';
      thoughtBtn.innerHTML = '?';

      popover = document.createElement('div');
      popover.className = 'msg-thought-popover hidden';
      popover.innerHTML = `
        <div class="thought-popover-header">
          <span class="thought-popover-title">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            <span class="thought-popover-title-text">Ход мыслей</span>
          </span>
          <button class="thought-popover-close" title="Закрыть">✕</button>
        </div>
        <div class="thought-popover-body"></div>
      `;

      thoughtBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const willOpen = popover.classList.contains('hidden');
        document.querySelectorAll('.msg-thought-popover:not(.hidden)').forEach(p => {
          p.classList.add('hidden');
          p.parentElement?.querySelector('.msg-thought-btn')?.classList.remove('has-open-popover');
        });
        if (willOpen) {
          popover.classList.remove('hidden');
          thoughtBtn.classList.add('has-open-popover');
        }
      });

      popover.querySelector('.thought-popover-close')?.addEventListener('click', (e) => {
        e.stopPropagation();
        popover.classList.add('hidden');
        thoughtBtn.classList.remove('has-open-popover');
      });

      div.appendChild(thoughtBtn);
      div.appendChild(popover);
    }

    if (isThinking && isStreaming) {
      thoughtBtn.classList.add('is-thinking');
      thoughtBtn.title = 'Модель думает... (нажмите, чтобы посмотреть ход мыслей)';
      const titleText = popover.querySelector('.thought-popover-title-text');
      if (titleText) titleText.textContent = 'Модель размышляет...';
    } else {
      thoughtBtn.classList.remove('is-thinking');
      thoughtBtn.title = 'Ход мыслей модели';
      const titleText = popover.querySelector('.thought-popover-title-text');
      if (titleText) titleText.textContent = 'Ход мыслей';
    }

    const bodyEl = popover.querySelector('.thought-popover-body');
    if (bodyEl) {
      bodyEl.textContent = thought;
      if (isStreaming) {
        bodyEl.scrollTop = bodyEl.scrollHeight;
      }
    }
  } else {
    if (thoughtBtn) thoughtBtn.remove();
    if (popover) popover.remove();
  }
}

const THEMES = {
  graphite: {
    name: 'Графит', bg: [26,26,26], bgElevated: [34,34,34], bgHover: [42,42,42],
    border: '#3a3a3a', borderFocus: '#555555', text: '#e0e0e0', textDim: '#999999',
    textMuted: '#555555', accent: '#d4a017', accentHover: '#e0b030', accentText: '#111111',
    danger: '#cc3333', dangerHover: '#dd4444', logoBg: '#333333',
  },
  cobalt: {
    name: 'Кобальт', bg: [13,17,23], bgElevated: [22,27,34], bgHover: [30,37,48],
    border: '#30363d', borderFocus: '#484f58', text: '#d2d9e0', textDim: '#8b949e',
    textMuted: '#484f58', accent: '#58a6ff', accentHover: '#79b8ff', accentText: '#0d1117',
    danger: '#f85149', dangerHover: '#ff6a5f', logoBg: '#21262d',
  },
  ember: {
    name: 'Уголь', bg: [22,18,16], bgElevated: [32,26,22], bgHover: [44,36,30],
    border: '#3d3028', borderFocus: '#5a4a3c', text: '#e8ddd4', textDim: '#a0897a',
    textMuted: '#5a4a3c', accent: '#ef6040', accentHover: '#ff7855', accentText: '#1a1210',
    danger: '#ef4444', dangerHover: '#f87171', logoBg: '#2a2220',
  },
  'graphite-light': {
    name: 'Графит Light', bg: [245,245,245], bgElevated: [255,255,255], bgHover: [232,232,232],
    border: '#d0d0d0', borderFocus: '#aaaaaa', text: '#1a1a1a', textDim: '#666666',
    textMuted: '#aaaaaa', accent: '#c49010', accentHover: '#b08008', accentText: '#ffffff',
    danger: '#cc3333', dangerHover: '#bb2222', logoBg: '#f0f0f0',
  },
  'cobalt-light': {
    name: 'Кобальт Light', bg: [244,248,252], bgElevated: [255,255,255], bgHover: [228,238,248],
    border: '#c0d0e0', borderFocus: '#8ba5bd', text: '#0d1117', textDim: '#57606a',
    textMuted: '#8b949e', accent: '#0969da', accentHover: '#0757b5', accentText: '#ffffff',
    danger: '#cf222e', dangerHover: '#a40e26', logoBg: '#f0f5fa',
  },
  'ember-light': {
    name: 'Уголь Light', bg: [252,248,245], bgElevated: [255,255,255], bgHover: [242,234,228],
    border: '#d8ccc4', borderFocus: '#b09888', text: '#1a1210', textDim: '#6d5c50',
    textMuted: '#a09080', accent: '#d84828', accentHover: '#c03c20', accentText: '#ffffff',
    danger: '#cf222e', dangerHover: '#a40e26', logoBg: '#faf5f2',
  }
};

const $ = (id) => document.getElementById(id);

const profileView = $('profile-view'), settingsView = $('settings-view'), chatView = $('chat-view'), modelsView = $('models-view');
const settingsBackBtn = $('settings-back-btn'), modelsBackBtn = $('models-back-btn'), profileBackBtn = $('profile-back-btn');
const sidebarToggleBtn = $('sidebar-toggle-btn'), chatSidebar = $('chat-sidebar');
const sidebarNewChatBtn = $('sidebar-new-chat-btn'), sidebarSearchInput = $('sidebar-search-input');
const sidebarChatsList = $('sidebar-chats-list');

let currentChatId = 'chat_' + Date.now();
let currentChatTitle = 'Новый чат';
let currentChatCreatedAt = new Date().toISOString();
let localChats = [];
try { localChats = JSON.parse(localStorage.getItem('overlay_saved_chats') || '[]'); } catch { localChats = []; }

function saveLocalChats() {
  try { localStorage.setItem('overlay_saved_chats', JSON.stringify(localChats)); }
  catch (e) {
    if (e.name === 'QuotaExceededError' || e.code === 22) {
      localChats.slice(5).forEach(c => { if (Array.isArray(c.messages)) c.messages.forEach(m => { if (m.parts) m.parts = m.parts.filter(p => !p.inlineData); delete m.image; }); });
      if (localChats.length > 50) localChats = localChats.slice(0, 50);
      try { localStorage.setItem('overlay_saved_chats', JSON.stringify(localChats)); } catch {}
    }
  }
}

const modelSelect = $('model-select'), chatArea = $('chat-area');
const messageInput = $('message-input'), sendBtn = $('send-btn');
const screenshotBtn = $('screenshot-btn'), screenshotPrev = $('screenshot-preview');
const screenshotImg = $('screenshot-img'), removeScreenBtn = $('remove-screenshot');
const closeBtn = $('close-btn'), settingsBtn = $('settings-btn'), profileBtn = $('profile-btn');
const opacitySlider = $('opacity-slider'), opacityVal = $('opacity-val');
const scaleDown = $('scale-down'), scaleUp = $('scale-up'), scaleVal = $('scale-val');
const themePicker = $('theme-picker');

/* ── Trial Tokens (1000 Limit) ────────────────────────────── */
function getTrialTokens() {
  const v = localStorage.getItem('overlay_trial_tokens');
  return v !== null ? parseInt(v, 10) : 1000;
}

function setTrialTokens(num) {
  const val = Math.max(0, Math.min(1000, Math.round(num)));
  localStorage.setItem('overlay_trial_tokens', val.toString());
}

function getTrialColor(remaining) {
  const pct = (remaining / 1000) * 100;
  if (pct > 40) return '#22c55e'; // Green when 100% down to 40%
  if (pct > 10) return '#eab308'; // Yellow approaching 40% to 10%
  return '#ef4444'; // Red approaching 10% and below
}

function updateTrialUI() {
  const left = getTrialTokens();
  const used = 1000 - left;
  const pct = Math.max(0, Math.min(100, (left / 1000) * 100));
  const color = getTrialColor(left);

  const leftEl = $('trial-tokens-left');
  const usedEl = $('trial-tokens-used');
  const barEl = $('trial-progress-bar');
  const statusEl = $('trial-tokens-status');

  if (leftEl) leftEl.textContent = left;
  if (usedEl) usedEl.textContent = used;
  if (barEl) {
    barEl.style.width = pct + '%';
    barEl.style.background = color;
  }
  if (statusEl) {
    if (left > 0) {
      statusEl.textContent = 'Активен';
      statusEl.style.color = color;
    } else {
      statusEl.textContent = 'Исчерпан';
      statusEl.style.color = '#ef4444';
    }
  }
}

function resetTrialTokens() {
  setTrialTokens(1000);
  updateTrialUI();
}

/* ── Init ─────────────────────────────────────────────────── */
async function init() {
  const config = await window.api.getConfig();
  opacity = config.opacity ?? 70; applyOpacity(opacity);
  opacitySlider.value = opacity; opacityVal.textContent = opacity + '%';
  currentTheme = config.theme ?? 'graphite'; applyTheme(currentTheme, false);
  uiScale = config.uiScale ?? 100; applyScale(uiScale); scaleVal.textContent = uiScale + '%';

  activeProvider = config.provider ?? 'gemini';
  providerKeys.gemini = config.geminiKey ?? '';
  providerKeys.openai = config.openaiKey ?? '';
  providerKeys.anthropic = config.anthropicKey ?? '';
  providerKeys.deepseek = config.deepseekKey ?? '';
  providerKeys.custom = config.customKey ?? '';

  if (localStorage.getItem('overlay_sidebar_collapsed') === 'true') chatSidebar?.classList.add('collapsed');
  if (config.customAccent) {
    customAccentColor = { accent: config.customAccent, accentHover: config.customAccentHover || config.customAccent, accentText: config.customAccentText || '#ffffff' };
    document.documentElement.style.setProperty('--accent', customAccentColor.accent);
    document.documentElement.style.setProperty('--accent-hover', customAccentColor.accentHover);
    document.documentElement.style.setProperty('--accent-text', customAccentColor.accentText);
  }
  initColorPicker();
  renderSidebarHistory();
  updateTrialUI();
  initHotkeySettings(config.hotkey);

  const existingModels = getModels();
  if (existingModels.length === 0) {
    if (config.customModel) {
      existingModels.push({
        id: config.customModel,
        name: config.customModel,
        provider: 'custom',
        customProviderName: 'Custom',
        baseUrl: config.customUrl || 'http://localhost:11434/v1'
      });
    }
    if (config.model && config.model !== config.customModel) {
      existingModels.push({
        id: config.model,
        name: config.model,
        provider: config.provider || 'gemini'
      });
    }
    if (existingModels.length > 0) {
      saveModels(existingModels);
    }
  }

  populateModels(config.model || config.customModel);
  showChat();
}

function applyOpacity(val) {
  const t = THEMES[currentTheme] || THEMES.graphite; const a = val / 100;
  const [r,g,b] = t.bg, [er,eg,eb] = t.bgElevated, [hr,hg,hb] = t.bgHover;
  document.documentElement.style.setProperty('--bg', `rgba(${r},${g},${b},${a})`);
  document.documentElement.style.setProperty('--bg-elevated', `rgba(${er},${eg},${eb},${Math.min(a+0.05,1)})`);
  document.documentElement.style.setProperty('--bg-hover', `rgba(${hr},${hg},${hb},${Math.min(a+0.08,1)})`);
  document.documentElement.style.setProperty('--bg-input', `rgba(${r},${g},${b},${a})`);
}

function applyTheme(name, save = true) {
  const t = THEMES[name]; if (!t) return; currentTheme = name;
  const root = document.documentElement;
  root.style.setProperty('--border', t.border); root.style.setProperty('--border-focus', t.borderFocus);
  root.style.setProperty('--text', t.text); root.style.setProperty('--text-dim', t.textDim);
  root.style.setProperty('--text-muted', t.textMuted); root.style.setProperty('--accent', t.accent);
  root.style.setProperty('--accent-hover', t.accentHover); root.style.setProperty('--accent-text', t.accentText);
  root.style.setProperty('--danger', t.danger); root.style.setProperty('--danger-hover', t.dangerHover);
  root.style.setProperty('--logo-bg', t.logoBg); root.style.setProperty('--logo-border', t.border);
  applyOpacity(opacity);
  if (customAccentColor) {
    root.style.setProperty('--accent', customAccentColor.accent);
    root.style.setProperty('--accent-hover', customAccentColor.accentHover);
    root.style.setProperty('--accent-text', customAccentColor.accentText);
  }
  const ind = $('custom-color-indicator');
  if (ind) ind.style.background = customAccentColor?.accent || t.accent;
  if (themePicker) themePicker.querySelectorAll('.theme-swatch').forEach(btn => btn.classList.toggle('active', btn.dataset.theme === name));
  document.querySelectorAll('.theme-section .theme-swatch').forEach(btn => btn.classList.toggle('active', btn.dataset.theme === name));
  if (save) window.api.saveConfig({ theme: name });
}
if (themePicker) themePicker.addEventListener('click', (e) => { const s = e.target.closest('.theme-swatch'); if (s) applyTheme(s.dataset.theme); });
document.querySelector('.theme-section')?.addEventListener('click', (e) => { const s = e.target.closest('.theme-swatch'); if (s) applyTheme(s.dataset.theme); });

function applyScale(val) { window.api.setZoomFactor(val/100); window.api.setWindowScale(val); }
function changeScale(delta) { uiScale = Math.min(150, Math.max(70, uiScale+delta)); scaleVal.textContent = uiScale+'%'; applyScale(uiScale); window.api.saveConfig({ uiScale }); }
scaleDown.addEventListener('click', () => changeScale(-10));
scaleUp.addEventListener('click', () => changeScale(10));
opacitySlider.addEventListener('input', () => { opacity = parseInt(opacitySlider.value); opacityVal.textContent = opacity+'%'; applyOpacity(opacity); });
opacitySlider.addEventListener('change', () => window.api.saveConfig({ opacity }));

/* ── Views ────────────────────────────────────────────────── */
function hideAllViews() {
  profileView?.classList.add('hidden');
  settingsView.classList.add('hidden');
  chatView.classList.add('hidden');
  modelsView.classList.add('hidden');
}
function showProfile() {
  hideAllViews();
  profileView.classList.remove('hidden');
  updateTrialUI();
}
function showSettings() {
  hideAllViews();
  settingsView.classList.remove('hidden');
}
function showModels() {
  hideAllViews();
  modelsView.classList.remove('hidden');
  cancelEditModel();
  renderModelsList();
  updateModelProviderFields($('om-provider')?.value || 'gemini');
}
function showChat() {
  hideAllViews();
  chatView.classList.remove('hidden');
  messageInput.focus();
}

function updateModelProviderFields(provider) {
  const links = {
    gemini: ['https://aistudio.google.com/apikey', 'Получить ключ Gemini →', 'AIzaSy...'],
    openai: ['https://platform.openai.com/api-keys', 'Получить ключ OpenAI →', 'sk-...'],
    anthropic: ['https://console.anthropic.com/', 'Получить ключ Anthropic →', 'sk-ant-...'],
    deepseek: ['https://platform.deepseek.com/', 'Получить ключ DeepSeek →', 'sk-...']
  };

  const isCustom = provider === 'custom';
  $('om-custom-group-field')?.classList.toggle('hidden', !isCustom);
  $('om-url-field')?.classList.toggle('hidden', !isCustom);

  const keyInput = $('om-api-key');
  const link = $('om-get-key-link');

  if (keyInput) {
    if (isCustom) {
      keyInput.placeholder = 'API Ключ (необязательно)';
      keyInput.value = providerKeys.custom || '';
      if (link) link.classList.add('hidden');
    } else {
      const [href, text, ph] = links[provider] || links.gemini;
      keyInput.placeholder = ph;
      keyInput.value = providerKeys[provider] || '';
      if (link) {
        link.href = href;
        link.textContent = text;
        link.classList.remove('hidden');
        link.onclick = (e) => { e.preventDefault(); window.api.openExternal(href); };
      }
    }
  }
}
$('om-provider')?.addEventListener('change', () => updateModelProviderFields($('om-provider').value));

/* ── Models (manual only & grouped) ───────────────────────── */
let editingModelOriginal = null; // { id, provider }

function getModels() {
  try {
    const l = JSON.parse(localStorage.getItem('overlay_models') || '[]');
    return Array.isArray(l) ? l : [];
  } catch {
    return [];
  }
}

function saveModels(list) {
  localStorage.setItem('overlay_models', JSON.stringify(list));
}

function addModel(obj) {
  const list = getModels();
  if (list.find(m => m.id === obj.id && m.provider === obj.provider)) return;
  list.push(obj);
  saveModels(list);
  populateModels(obj.id);
  renderModelsList();
}

function removeModel(id, provider) {
  let list = getModels();
  list = list.filter(m => !(m.id === id && m.provider === provider));
  saveModels(list);
  if (selectedModel === id) {
    selectedModel = list[0]?.id || '';
    activeProvider = list[0]?.provider || 'gemini';
    window.api.saveConfig({ model: selectedModel, provider: activeProvider });
  }
  populateModels(selectedModel);
  renderModelsList();
  if (editingModelOriginal && editingModelOriginal.id === id && editingModelOriginal.provider === provider) {
    cancelEditModel();
  }
}

function populateModels(target = null) {
  modelSelect.innerHTML = '';
  const all = getModels();
  if (all.length === 0) {
    const o = document.createElement('option');
    o.value = '';
    o.textContent = 'Нет моделей';
    modelSelect.appendChild(o);
    selectedModel = '';
    return;
  }
  all.forEach(m => {
    const o = document.createElement('option');
    o.value = m.id;
    const provLabel = m.provider === 'custom' && m.customProviderName ? m.customProviderName : m.provider;
    o.textContent = `${m.id} (${provLabel})`;
    modelSelect.appendChild(o);
  });
  if (target && all.some(m => m.id === target)) {
    selectedModel = target;
  } else if (!all.some(m => m.id === selectedModel)) {
    selectedModel = all[0]?.id || '';
  }
  modelSelect.value = selectedModel;
  const active = all.find(m => m.id === selectedModel);
  if (active) activeProvider = active.provider || 'gemini';
}

function startEditModel(m) {
  editingModelOriginal = { id: m.id, provider: m.provider };
  if ($('models-form-title')) $('models-form-title').textContent = 'Редактировать модель';
  if ($('om-id')) $('om-id').value = m.id;
  if ($('om-provider')) $('om-provider').value = m.provider;
  updateModelProviderFields(m.provider);

  if ($('om-custom-provider')) $('om-custom-provider').value = m.customProviderName || '';
  if ($('om-url')) $('om-url').value = m.baseUrl || '';

  if ($('om-save-btn')) $('om-save-btn').textContent = 'Сохранить';
  $('om-cancel-edit-btn')?.classList.remove('hidden');
  $('om-id')?.focus();
}

function cancelEditModel() {
  editingModelOriginal = null;
  if ($('models-form-title')) $('models-form-title').textContent = 'Добавить модель';
  if ($('om-id')) { $('om-id').value = ''; $('om-id').style.borderColor = ''; }
  if ($('om-custom-provider')) $('om-custom-provider').value = '';
  if ($('om-url')) $('om-url').value = '';
  if ($('om-save-btn')) $('om-save-btn').textContent = 'Добавить модель';
  $('om-cancel-edit-btn')?.classList.add('hidden');
  updateModelProviderFields($('om-provider')?.value || 'gemini');
}

function renderModelsList() {
  const container = $('models-list');
  if (!container) return;
  const models = getModels();

  if (models.length === 0) {
    container.innerHTML = '<div class="models-empty">Нет добавленных моделей.<br>Добавьте модель через форму слева.</div>';
    return;
  }

  const PROVIDER_TITLES = {
    gemini: 'Google Gemini',
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    deepseek: 'DeepSeek',
    custom: 'Кастомные'
  };

  const groups = {};
  models.forEach(m => {
    let groupKey, groupTitle;
    if (m.provider === 'custom') {
      const customName = (m.customProviderName || '').trim();
      groupKey = customName ? 'custom_' + customName.toLowerCase() : 'custom_default';
      groupTitle = customName || 'Кастомные (Custom)';
    } else {
      groupKey = m.provider;
      groupTitle = PROVIDER_TITLES[m.provider] || m.provider;
    }

    if (!groups[groupKey]) {
      groups[groupKey] = { title: groupTitle, provider: m.provider, items: [] };
    }
    groups[groupKey].items.push(m);
  });

  container.innerHTML = '';

  Object.keys(groups).forEach(key => {
    const group = groups[key];
    if (!group.items.length) return;

    const groupSection = document.createElement('div');
    groupSection.className = 'models-group';

    const groupHeader = document.createElement('div');
    groupHeader.className = 'models-group-header';
    groupHeader.innerHTML = `
      <span class="models-group-title">${esc(group.title)}</span>
      <span class="models-group-badge">${group.items.length}</span>
    `;
    groupSection.appendChild(groupHeader);

    const groupItems = document.createElement('div');
    groupItems.className = 'models-group-items';

    group.items.forEach(m => {
      const row = document.createElement('div');
      row.className = 'model-item' + (m.id === selectedModel ? ' active' : '');

      row.innerHTML = `
        <div class="model-item-info">
          <div class="model-item-name">${esc(m.id)}</div>
          ${m.baseUrl ? `<div class="model-item-meta">${esc(m.baseUrl)}</div>` : ''}
        </div>
        <div class="model-item-actions">
          <button class="model-item-btn model-item-edit" title="Редактировать">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          </button>
          <button class="model-item-btn model-item-del" title="Удалить">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
      `;

      row.addEventListener('click', (e) => {
        if (e.target.closest('.model-item-actions')) return;
        selectedModel = m.id;
        activeProvider = m.provider;
        modelSelect.value = selectedModel;
        window.api.saveConfig({ model: selectedModel, provider: activeProvider });
        renderModelsList();
      });

      row.querySelector('.model-item-edit').addEventListener('click', (e) => {
        e.stopPropagation();
        startEditModel(m);
      });

      row.querySelector('.model-item-del').addEventListener('click', (e) => {
        e.stopPropagation();
        promptDeleteModel(m.id, m.provider);
      });

      groupItems.appendChild(row);
    });

    groupSection.appendChild(groupItems);
    container.appendChild(groupSection);
  });
}

modelSelect.addEventListener('change', () => {
  selectedModel = modelSelect.value;
  const m = getModels().find(it => it.id === selectedModel);
  if (m) activeProvider = m.provider || 'gemini';
  window.api.saveConfig({ model: selectedModel, provider: activeProvider });
});


let currentStreamId = null;
let currentAiMsgId = null;

function smartScroll() {
  const threshold = 120;
  const isNearBottom = chatArea.scrollHeight - chatArea.scrollTop - chatArea.clientHeight <= threshold;
  if (isNearBottom) {
    chatArea.scrollTop = chatArea.scrollHeight;
  }
}

function setStreamingState(active, streamId = null, msgId = null) {
  isLoading = active;
  currentStreamId = streamId;
  currentAiMsgId = msgId;

  if (active) {
    sendBtn.classList.add('is-streaming');
    sendBtn.classList.remove('loading');
    sendBtn.title = 'Остановить генерацию';
    sendBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="3"/></svg>`;
  } else {
    sendBtn.classList.remove('is-streaming');
    sendBtn.classList.remove('loading');
    sendBtn.title = 'Отправить (Enter)';
    sendBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>`;
  }
}

/* ── Send Message ─────────────────────────────────────────── */
async function sendMessage() {
  const text = messageInput.value.trim();
  if (!text && !currentScreenshot) return;
  if (isLoading) return;
  if (!selectedModel) { addErrorMsg('Не выбрана модель. Добавьте модель через менеджер.'); return; }

  const m = getModels().find(it => it.id === selectedModel);
  const provider = m?.provider || activeProvider;
  const key = providerKeys[provider] || '';

  const cleanScreen = normalizeBase64(currentScreenshot);
  const userParts = [];
  if (cleanScreen) userParts.push({ inlineData: { mimeType: 'image/png', data: cleanScreen } });
  if (text) userParts.push({ text });

  const userMsg = { role: 'user', parts: userParts, image: cleanScreen, id: 'msg_' + Date.now() };
  messages.push(userMsg);
  messageInput.value = '';
  messageInput.style.height = 'auto';
  currentScreenshot = null;
  screenshotPrev.classList.add('hidden');
  renderCurrentMessages();
  scroll();

  // If no key entered and not custom: operate in Free Demo Testing mode (1000 tokens) with simulated live streaming
  if (!key && provider !== 'custom') {
    const trialRemaining = getTrialTokens();
    if (trialRemaining <= 0) {
      addErrorMsg('Тестовые токены исчерпаны (0 / 1000). Добавьте API ключ в менеджере моделей или сбросьте баланс в профиле.');
      return;
    }

    const simReplies = [
      `[Тестовый режим] Привет! Это ответ модели ${selectedModel}. Ваше сообщение: «${text}» успешно обработано в рамках бесплатного теста.`,
      `[Тестовый режим] Модель ${selectedModel} приняла запрос. Токены списываются со шкалы расходов в вашем профиле (зеленый → желтый → красный).`,
      `[Тестовый режим] Тестовый ответ на «${text.substring(0, 30)}...». Для реальных запросов к API введите ключ в менеджере моделей.`
    ];
    const simText = simReplies[Math.floor(Math.random() * simReplies.length)];

    const aiMsgId = 'msg_' + Date.now();
    const streamId = 'stream_' + Date.now();
    const aiMsg = { role: 'model', parts: [{ text: '' }], id: aiMsgId, variants: [''], activeVariant: 0 };
    messages.push(aiMsg);
    renderCurrentMessages();
    smartScroll();

    setStreamingState(true, streamId, aiMsgId);

    const words = simText.split(' ');
    let wordIdx = 0;
    let accumulated = '';
    const interval = setInterval(() => {
      if (currentStreamId !== streamId) {
        clearInterval(interval);
        return;
      }
      if (wordIdx < words.length) {
        accumulated += (wordIdx > 0 ? ' ' : '') + words[wordIdx];
        aiMsg.parts[0].text = accumulated;
        aiMsg.variants[0] = accumulated;
        const msgEl = chatArea.querySelector(`[data-id="${aiMsgId}"]`);
        if (msgEl) {
          updateAiMessageElement(msgEl, accumulated, true);
        }
        smartScroll();
        wordIdx++;
      } else {
        clearInterval(interval);
        const msgEl = chatArea.querySelector(`[data-id="${aiMsgId}"]`);
        if (msgEl) {
          updateAiMessageElement(msgEl, accumulated, false);
          const bar = msgEl.querySelector('.msg-actions-bar');
          if (bar) bar.style.display = '';
        }
        const tokensUsed = Math.max(1, Math.ceil((text.length + simText.length) / 4));
        setTrialTokens(trialRemaining - tokensUsed);
        updateTrialUI();
        setStreamingState(false);
        autoSaveCurrentChat();
      }
    }, 35);
    return;
  }

  // Real Streaming API Call
  const apiMessages = messages.filter(m => m.role === 'user' || m.role === 'model').map(m => {
    const p = (m.parts || []).filter(pp => pp.text || pp.inlineData);
    return { role: m.role, parts: p.length ? p : [{ text: '' }] };
  });

  const aiMsgId = 'msg_' + Date.now();
  const streamId = 'stream_' + Date.now();
  const aiMsg = { role: 'model', parts: [{ text: '' }], id: aiMsgId, variants: [''], activeVariant: 0 };
  messages.push(aiMsg);
  renderCurrentMessages();
  smartScroll();

  setStreamingState(true, streamId, aiMsgId);

  try {
    const baseUrl = m?.baseUrl || undefined;
    const result = await window.api.streamMessage({
      provider,
      apiKey: key,
      model: selectedModel,
      messages: apiMessages,
      customUrl: baseUrl,
      streamId,
    });

    if (!result.success && !result.stopped) {
      addErrorMsg('Ошибка: ' + (result.error || 'Не удалось получить ответ от модели'));
      smartScroll();
    } else {
      const finalReply = aiMsg.parts[0]?.text || '';
      const tokensUsed = Math.max(1, Math.ceil((text.length + finalReply.length) / 4));
      setTrialTokens(getTrialTokens() - tokensUsed);
      updateTrialUI();
    }
  } catch (err) {
    addErrorMsg('Ошибка: ' + (err.message || 'Сбой сети'));
    smartScroll();
  } finally {
    const msgEl = chatArea.querySelector(`[data-id="${aiMsgId}"]`);
    if (msgEl) {
      updateAiMessageElement(msgEl, aiMsg.parts[0]?.text || '', false);
      const bar = msgEl.querySelector('.msg-actions-bar');
      if (bar) bar.style.display = '';
    }
    setStreamingState(false);
    autoSaveCurrentChat();
  }
}

function addErrorMsg(text) {
  const div = document.createElement('div');
  div.className = 'message error';
  div.textContent = text;
  chatArea.appendChild(div);
  scroll();
}

/* ── Render Messages ──────────────────────────────────────── */
function renderCurrentMessages() {
  const welcome = $('welcome-msg');
  if (messages.length === 0) { chatArea.innerHTML = ''; if (welcome) chatArea.appendChild(welcome); welcome?.classList.remove('hidden'); return; }
  if (welcome) welcome.classList.add('hidden');
  chatArea.innerHTML = '';
  messages.forEach((m, idx) => addMessage(m, idx));
}

function addMessage(m, idx) {
  const div = document.createElement('div');
  const isUser = m.role === 'user';
  div.className = 'message ' + (isUser ? 'user' : 'ai');
  div.dataset.idx = idx;
  if (m.id) div.dataset.id = m.id;

  const msgImageB64 = normalizeBase64(m.image) || (
    m.parts?.find(p => p && p.inlineData && p.inlineData.data && p.inlineData.data !== '(image)')
      ? normalizeBase64(m.parts.find(p => p && p.inlineData && p.inlineData.data && p.inlineData.data !== '(image)').inlineData.data)
      : null
  );

  if (isUser && msgImageB64) {
    const img = document.createElement('img');
    img.className = 'message-screenshot';
    img.src = 'data:image/png;base64,' + msgImageB64;
    img.alt = 'Снимок экрана';
    img.title = 'Нажмите, чтобы развернуть/свернуть';
    img.addEventListener('click', () => img.classList.toggle('expanded'));
    div.appendChild(img);
  }

  const rawTextContent = isUser
    ? (m.parts?.find(p => p.text)?.text || m.text || '')
    : (m.variants ? m.variants[m.activeVariant || 0] : (m.parts?.find(p => p.text)?.text || m.text || m.content || ''));

  const textDiv = document.createElement('div');
  textDiv.className = 'message-text';
  div.appendChild(textDiv);

  const isStreamingThis = isLoading && currentAiMsgId === m.id;

  if (isUser) {
    textDiv.textContent = rawTextContent;
  } else {
    updateAiMessageElement(div, rawTextContent, isStreamingThis);
  }

  // Variant nav for AI
  if (!isUser && m.variants && m.variants.length > 1) {
    const nav = document.createElement('div');
    nav.className = 'msg-variant-nav';
    const prev = document.createElement('button'); prev.textContent = '<'; prev.addEventListener('click', () => switchVariant(idx, -1));
    const label = document.createElement('span'); label.textContent = `${(m.activeVariant||0)+1}/${m.variants.length}`;
    const next = document.createElement('button'); next.textContent = '>'; next.addEventListener('click', () => switchVariant(idx, 1));
    nav.appendChild(prev); nav.appendChild(label); nav.appendChild(next);
    div.appendChild(nav);
  }

  // Actions bar (Icon-only)
  const bar = document.createElement('div');
  bar.className = 'msg-actions-bar';
  if (isUser) {
    const editBtn = document.createElement('button');
    editBtn.className = 'msg-action-btn';
    editBtn.title = 'Изменить';
    editBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`;
    editBtn.addEventListener('click', () => startEditMessage(idx));

    const delBtn = document.createElement('button');
    delBtn.className = 'msg-action-btn msg-delete-btn';
    delBtn.title = 'Удалить';
    delBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
    delBtn.addEventListener('click', () => promptDeleteMessage(idx));

    bar.appendChild(editBtn);
    bar.appendChild(delBtn);
  } else {
    const copyBtn = document.createElement('button');
    copyBtn.className = 'msg-action-btn';
    copyBtn.title = 'Копировать';
    copyBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
    copyBtn.addEventListener('click', () => {
      const textToCopy = div.dataset.cleanText !== undefined ? div.dataset.cleanText : rawTextContent;
      navigator.clipboard.writeText(textToCopy);
      copyBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>`;
      copyBtn.title = 'Скопировано!';
      setTimeout(() => {
        copyBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
        copyBtn.title = 'Копировать';
      }, 1200);
    });

    const regenBtn = document.createElement('button');
    regenBtn.className = 'msg-action-btn msg-regen-btn';
    regenBtn.title = 'Повторить';
    regenBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>`;
    regenBtn.addEventListener('click', () => regenerateResponse(idx));

    const delBtn = document.createElement('button');
    delBtn.className = 'msg-action-btn msg-delete-btn';
    delBtn.title = 'Удалить';
    delBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
    delBtn.addEventListener('click', () => promptDeleteMessage(idx));

    bar.appendChild(copyBtn);
    bar.appendChild(regenBtn);
    bar.appendChild(delBtn);
  }
  if (isStreamingThis) {
    bar.style.display = 'none';
  }
  div.appendChild(bar);
  chatArea.appendChild(div);
}

/* ── Edit / Delete / Regen / Variant ──────────────────────── */
function startEditMessage(idx) {
  const m = messages[idx]; if (!m || m.role !== 'user') return;
  const text = m.parts?.find(p => p.text)?.text || '';
  const div = chatArea.querySelector(`[data-idx="${idx}"]`); if (!div) return;
  const existing = div.querySelector('.msg-edit-box'); if (existing) { existing.remove(); return; }

  const box = document.createElement('div'); box.className = 'msg-edit-box';
  div.classList.add('is-editing');
  const ta = document.createElement('textarea'); ta.className = 'msg-edit-textarea'; ta.value = text; ta.rows = 3;
  const btns = document.createElement('div'); btns.style.cssText = 'display:flex;gap:6px;margin-top:6px;';
  const saveBtn = document.createElement('button'); saveBtn.className = 'btn-accent'; saveBtn.style.cssText = 'max-width:none;padding:4px 12px;font-size:11px;'; saveBtn.textContent = 'Сохранить';
  const cancelBtn = document.createElement('button'); cancelBtn.className = 'btn-secondary'; cancelBtn.style.cssText = 'max-width:none;padding:4px 12px;font-size:11px;'; cancelBtn.textContent = 'Отмена';

  saveBtn.addEventListener('click', () => {
    div.classList.remove('is-editing');
    const newText = ta.value.trim(); if (!newText) return;
    m.parts = m.parts.map(p => p.text !== undefined ? { text: newText } : p);
    messages = messages.slice(0, idx + 1); // remove everything after edit
    renderCurrentMessages(); scroll(); autoSaveCurrentChat();
  });
  cancelBtn.addEventListener('click', () => {
    div.classList.remove('is-editing');
    box.remove();
  });

  btns.appendChild(saveBtn); btns.appendChild(cancelBtn);
  box.appendChild(ta); box.appendChild(btns);
  div.appendChild(box);
  ta.focus();
}

async function regenerateResponse(idx) {
  const m = messages[idx]; if (!m || m.role !== 'model' || isLoading) return;

  const apiMessages = messages.slice(0, idx).filter(x => x.role === 'user' || x.role === 'model').map(x => {
    const p = (x.parts || []).filter(pp => pp.text || pp.inlineData);
    return { role: x.role, parts: p.length ? p : [{ text: '' }] };
  });

  const mdl = getModels().find(it => it.id === selectedModel);
  const provider = mdl?.provider || activeProvider;
  const key = providerKeys[provider] || '';
  const baseUrl = mdl?.baseUrl || undefined;

  if (!m.variants) m.variants = [m.parts?.[0]?.text || ''];
  m.variants.push('');
  m.activeVariant = m.variants.length - 1;
  m.parts = [{ text: '' }];
  renderCurrentMessages();
  smartScroll();

  const streamId = 'stream_' + Date.now();
  setStreamingState(true, streamId, m.id);

  try {
    const result = await window.api.streamMessage({
      provider,
      apiKey: key,
      model: selectedModel,
      messages: apiMessages,
      customUrl: baseUrl,
      streamId,
    });
    if (!result.success && !result.stopped) {
      addErrorMsg('Ошибка: ' + (result.error || 'Сбой генерации'));
    }
  } catch (err) {
    addErrorMsg('Ошибка: ' + err.message);
  } finally {
    setStreamingState(false);
    renderCurrentMessages();
    smartScroll();
    autoSaveCurrentChat();
  }
}

function switchVariant(idx, dir) {
  const m = messages[idx]; if (!m || !m.variants) return;
  let v = (m.activeVariant || 0) + dir;
  if (v < 0) v = m.variants.length - 1;
  if (v >= m.variants.length) v = 0;
  m.activeVariant = v;
  m.parts = [{ text: m.variants[v] }];
  renderCurrentMessages(); scroll(); autoSaveCurrentChat();
}

function deleteMessage(idx) {
  messages.splice(idx, 1);
  renderCurrentMessages(); autoSaveCurrentChat();
}

/* ── Export ────────────────────────────────────────────────── */
function exportChat(format) {
  if (messages.length === 0) return;
  let content, ext, mime;
  const textMsgs = messages.map(m => { const t = m.parts?.find(p => p.text)?.text || ''; return { role: m.role, text: t }; });

  if (format === 'json') {
    content = JSON.stringify(textMsgs, null, 2); ext = '.json'; mime = 'application/json';
  } else if (format === 'md') {
    content = textMsgs.map(m => `## ${m.role === 'user' ? 'Пользователь' : 'AI'}\n\n${m.text}\n`).join('\n---\n\n');
    ext = '.md'; mime = 'text/markdown';
  } else {
    content = textMsgs.map(m => `[${m.role === 'user' ? 'Вы' : 'AI'}]: ${m.text}`).join('\n\n');
    ext = '.txt'; mime = 'text/plain';
  }

  const filename = `chat_${Date.now()}${ext}`;
  try {
    if (window.api && typeof window.api.exportChat === 'function') {
      window.api.exportChat({ content, filename, mime });
    } else {
      const blob = new Blob([content], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    }
  } catch (err) {
    console.error('[Export] Error:', err);
  }
  $('export-overlay-modal')?.classList.add('hidden');
}

/* ── Chat Session Management ──────────────────────────────── */
function autoSaveCurrentChat() {
  const idx = localChats.findIndex(c => c.id === currentChatId);
  const data = { id: currentChatId, title: currentChatTitle, createdAt: currentChatCreatedAt, messages: messages.map(m => ({ role: m.role, parts: (m.parts || []).map(p => p.inlineData ? { inlineData: { mimeType: p.inlineData.mimeType, data: '(image)' } } : p), image: null, id: m.id, variants: m.variants, activeVariant: m.activeVariant })), updatedAt: new Date().toISOString() };
  if (messages.length > 0) {
    const firstUserMsg = messages.find(m => m.role === 'user');
    if (firstUserMsg && currentChatTitle === 'Новый чат') { const t = firstUserMsg.parts?.find(p => p.text)?.text || ''; if (t) { currentChatTitle = t.substring(0, 50); data.title = currentChatTitle; } }
  }
  if (idx >= 0) localChats[idx] = data; else if (messages.length > 0) localChats.unshift(data);
  saveLocalChats();
  renderSidebarHistory();
}

function loadChatSession(id) {
  if (id === currentChatId) return;
  autoSaveCurrentChat();
  const chat = localChats.find(c => c.id === id);
  if (!chat) return;
  currentChatId = chat.id;
  currentChatTitle = chat.title;
  currentChatCreatedAt = chat.createdAt;
  messages = (chat.messages || []).map(m => ({ ...m }));
  renderCurrentMessages(); scroll(); renderSidebarHistory();
}

let pendingDeleteAction = null; // { type: 'chat', id } or { type: 'message', idx }

function promptDeleteChat(id) {
  const chat = localChats.find(c => c.id === id);
  const title = chat?.title || 'Новый чат';
  pendingDeleteAction = { type: 'chat', id };
  const titleEl = $('confirm-delete-title');
  const textEl = $('confirm-delete-text');
  if (titleEl) titleEl.textContent = 'Удалить диалог';
  if (textEl) textEl.textContent = `Удалить диалог «${title}»? Это действие нельзя отменить.`;
  $('confirm-delete-modal')?.classList.remove('hidden');
}

function promptDeleteMessage(idx) {
  pendingDeleteAction = { type: 'message', idx };
  const titleEl = $('confirm-delete-title');
  const textEl = $('confirm-delete-text');
  if (titleEl) titleEl.textContent = 'Удалить сообщение';
  if (textEl) textEl.textContent = 'Удалить это сообщение из диалога?';
  $('confirm-delete-modal')?.classList.remove('hidden');
}

function promptDeleteModel(id, provider) {
  pendingDeleteAction = { type: 'model', id, provider };
  const titleEl = $('confirm-delete-title');
  const textEl = $('confirm-delete-text');
  if (titleEl) titleEl.textContent = 'Удалить модель';
  if (textEl) textEl.textContent = `Удалить модель «${id}» (${provider}) из списка?`;
  $('confirm-delete-modal')?.classList.remove('hidden');
}

function closeDeleteModal() {
  pendingDeleteAction = null;
  $('confirm-delete-modal')?.classList.add('hidden');
}

function executeDelete() {
  if (!pendingDeleteAction) return;
  if (pendingDeleteAction.type === 'chat') {
    deleteChatSession(pendingDeleteAction.id);
  } else if (pendingDeleteAction.type === 'message') {
    deleteMessage(pendingDeleteAction.idx);
  } else if (pendingDeleteAction.type === 'model') {
    removeModel(pendingDeleteAction.id, pendingDeleteAction.provider);
  }
  closeDeleteModal();
}

function deleteChatSession(id) {
  localChats = localChats.filter(c => c.id !== id);
  saveLocalChats();
  if (id === currentChatId) {
    currentChatId = 'chat_' + Date.now();
    currentChatTitle = 'Новый чат';
    currentChatCreatedAt = new Date().toISOString();
    messages = [];
    renderCurrentMessages();
    messageInput.focus();
  }
  renderSidebarHistory();
}

function startNewSession() {
  if (messages.length > 0) {
    autoSaveCurrentChat();
  }
  currentChatId = 'chat_' + Date.now();
  currentChatTitle = 'Новый чат';
  currentChatCreatedAt = new Date().toISOString();
  messages = [];
  renderCurrentMessages();
  renderSidebarHistory();
  messageInput.focus();
}

function startRenameChat(id) {
  const item = sidebarChatsList.querySelector(`[data-chat-id="${id}"]`);
  if (!item) return;
  const titleEl = item.querySelector('.sidebar-chat-item-title');
  const chat = localChats.find(c => c.id === id);
  if (!titleEl || !chat) return;

  const input = document.createElement('input');
  input.className = 'sidebar-rename-input';
  input.value = chat.title;
  titleEl.replaceWith(input);
  input.focus(); input.select();

  const finish = () => {
    const val = input.value.trim() || chat.title;
    chat.title = val;
    if (id === currentChatId) currentChatTitle = val;
    saveLocalChats(); renderSidebarHistory();
  };
  input.addEventListener('blur', finish);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(); } if (e.key === 'Escape') renderSidebarHistory(); });
}

function renderSidebarHistory() {
  if (!sidebarChatsList) return;
  const filter = (sidebarSearchInput?.value || '').toLowerCase();
  const list = localChats.filter(c => !filter || c.title.toLowerCase().includes(filter));

  if (list.length === 0) { sidebarChatsList.innerHTML = '<div class="sidebar-empty-state">Нет диалогов</div>'; return; }
  sidebarChatsList.innerHTML = '';
  list.forEach(c => {
    const item = document.createElement('div');
    item.className = 'sidebar-chat-item' + (c.id === currentChatId ? ' active' : '');
    item.dataset.chatId = c.id;

    const main = document.createElement('div'); main.className = 'sidebar-chat-item-main';
    const title = document.createElement('div'); title.className = 'sidebar-chat-item-title'; title.textContent = c.title;
    const meta = document.createElement('div'); meta.className = 'sidebar-chat-item-meta';
    const d = c.updatedAt ? new Date(c.updatedAt) : new Date(c.createdAt);
    meta.textContent = d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
    main.appendChild(title); main.appendChild(meta);

    const editBtn = document.createElement('button'); editBtn.className = 'sidebar-chat-edit-btn'; editBtn.textContent = '✎'; editBtn.title = 'Переименовать';
    editBtn.addEventListener('click', (e) => { e.stopPropagation(); startRenameChat(c.id); });

    const delBtn = document.createElement('button'); delBtn.className = 'sidebar-chat-del-btn'; delBtn.textContent = '✕'; delBtn.title = 'Удалить';
    delBtn.addEventListener('click', (e) => { e.stopPropagation(); promptDeleteChat(c.id); });

    item.appendChild(main); item.appendChild(editBtn); item.appendChild(delBtn);
    item.addEventListener('click', () => loadChatSession(c.id));
    sidebarChatsList.appendChild(item);
  });
}

/* ── Typing Indicator ─────────────────────────────────────── */
function addTyping() {
  removeTyping();
  const div = document.createElement('div');
  div.className = 'message ai typing';
  div.id = 'typing-indicator';
  div.innerHTML = '<div class="typing-dots"><span></span><span></span><span></span></div>';
  chatArea.appendChild(div);
  scroll();
}
function removeTyping() { const t = $('typing-indicator'); if (t) t.remove(); }
function scroll() { chatArea.scrollTop = chatArea.scrollHeight; }

/* ── Markdown Renderer ────────────────────────────────────── */
function renderMd(text) {
  if (!text) return '';
  // Strip any think tags so thoughts never leak into markdown rendering
  let clean = text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>[\s\S]*$/gi, '').trim();
  if (!clean) return '';
  const codeBlocks = [];
  let html = esc(clean);

  // code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push(`<pre><code>${code}</code></pre>`);
    return `%%CODEBLOCK_${idx}%%`;
  });
  // inline code
  html = html.replace(/`([^`]+)`/g, '<code class="inline">$1</code>');
  // bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // italic
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // lists
  html = html.replace(/^(\d+)\.\s+(.+)$/gm, '<li>$2</li>');
  html = html.replace(/^[-•]\s+(.+)$/gm, '<li>$1</li>');
  // paragraphs
  html = html.replace(/\n{2,}/g, '<br><br>');
  html = html.replace(/\n/g, '<br>');
  // restore code blocks
  html = html.replace(/%%CODEBLOCK_(\d+)%%/g, (_, i) => codeBlocks[Number(i)]);
  return html;
}

function esc(s) {
  const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
}

/* ── Color Picker (HSV Wheel) ──────────────────────────────── */
let pickerHue = 40, pickerSat = 1, pickerBright = 0.82;
let pickerDragging = false;

function hsvToRgb(h, s, v) {
  h = ((h % 360) + 360) % 360 / 360;
  const i = Math.floor(h * 6), f = h * 6 - i;
  const p = v*(1-s), q = v*(1-f*s), t = v*(1-(1-f)*s);
  let r, g, b;
  switch (i % 6) {
    case 0: r=v;g=t;b=p; break; case 1: r=q;g=v;b=p; break;
    case 2: r=p;g=v;b=t; break; case 3: r=p;g=q;b=v; break;
    case 4: r=t;g=p;b=v; break; case 5: r=v;g=p;b=q; break;
  }
  return [Math.round(r*255), Math.round(g*255), Math.round(b*255)];
}
function rgbToHex(r,g,b) { return '#'+[r,g,b].map(x=>x.toString(16).padStart(2,'0')).join(''); }
function luminance(r,g,b) { return (0.299*r + 0.587*g + 0.114*b) / 255; }

function drawColorWheel() {
  const canvas = $('color-wheel'); if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const size = canvas.width;
  const cx = size/2, cy = size/2, radius = size/2 - 2;
  const imageData = ctx.createImageData(size, size);
  const d = imageData.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x-cx, dy = y-cy, dist = Math.sqrt(dx*dx+dy*dy);
      const idx = (y*size+x)*4;
      if (dist <= radius) {
        const hue = (Math.atan2(dy,dx)*180/Math.PI+360)%360;
        const sat = dist/radius;
        const [r,g,b] = hsvToRgb(hue, sat, pickerBright);
        d[idx]=r; d[idx+1]=g; d[idx+2]=b; d[idx+3]=255;
      }
    }
  }
  ctx.putImageData(imageData, 0, 0);
  // indicator
  const angle = pickerHue*Math.PI/180, dist2 = pickerSat*radius;
  const px = cx+dist2*Math.cos(angle), py = cy+dist2*Math.sin(angle);
  ctx.beginPath(); ctx.arc(px,py,5,0,Math.PI*2); ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.stroke();
  ctx.beginPath(); ctx.arc(px,py,6,0,Math.PI*2); ctx.strokeStyle='#000'; ctx.lineWidth=1; ctx.stroke();
  updateColorPreview();
}

function updateColorPreview() {
  const [r,g,b] = hsvToRgb(pickerHue, pickerSat, pickerBright);
  const hex = rgbToHex(r,g,b);
  const prev = $('color-preview'); if (prev) prev.style.background = hex;
  const lbl = $('color-hex-val'); if (lbl) lbl.textContent = hex;
}

function handleWheelPick(e) {
  const canvas = $('color-wheel'); if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX-rect.left)*(canvas.width/rect.width);
  const y = (e.clientY-rect.top)*(canvas.height/rect.height);
  const cx = canvas.width/2, cy = canvas.height/2, radius = canvas.width/2-2;
  const dx = x-cx, dy = y-cy, dist = Math.sqrt(dx*dx+dy*dy);
  if (dist <= radius) { pickerHue = (Math.atan2(dy,dx)*180/Math.PI+360)%360; pickerSat = Math.min(dist/radius,1); drawColorWheel(); }
}

function applyCustomAccent() {
  const [r,g,b] = hsvToRgb(pickerHue, pickerSat, pickerBright);
  const hex = rgbToHex(r,g,b);
  const lum = luminance(r,g,b);
  const [hr,hg,hb] = hsvToRgb(pickerHue, Math.max(pickerSat-0.1,0), Math.min(pickerBright+0.1,1));
  const hoverHex = rgbToHex(hr,hg,hb);
  const accentText = lum > 0.55 ? '#111111' : '#ffffff';
  customAccentColor = { accent: hex, accentHover: hoverHex, accentText };
  document.documentElement.style.setProperty('--accent', hex);
  document.documentElement.style.setProperty('--accent-hover', hoverHex);
  document.documentElement.style.setProperty('--accent-text', accentText);
  const ind = $('custom-color-indicator');
  if (ind) ind.style.background = hex;
  $('custom-color-modal')?.classList.add('hidden');
  window.api.saveConfig({ customAccent: hex, customAccentHover: hoverHex, customAccentText: accentText });
}

function resetAccent() {
  customAccentColor = null;
  const t = THEMES[currentTheme] || THEMES.graphite;
  document.documentElement.style.setProperty('--accent', t.accent);
  document.documentElement.style.setProperty('--accent-hover', t.accentHover);
  document.documentElement.style.setProperty('--accent-text', t.accentText);
  const ind = $('custom-color-indicator');
  if (ind) ind.style.background = t.accent;
  $('custom-color-modal')?.classList.add('hidden');
  window.api.saveConfig({ customAccent: null, customAccentHover: null, customAccentText: null });
  drawColorWheel();
}

function initColorPicker() {
  const canvas = $('color-wheel'); if (!canvas) return;
  canvas.addEventListener('mousedown', (e) => { pickerDragging = true; handleWheelPick(e); });
  canvas.addEventListener('mousemove', (e) => { if (pickerDragging) handleWheelPick(e); });
  document.addEventListener('mouseup', () => { pickerDragging = false; });
  const bs = $('color-brightness');
  if (bs) { bs.addEventListener('input', () => { pickerBright = parseInt(bs.value)/100; drawColorWheel(); }); }
  $('color-apply-btn')?.addEventListener('click', applyCustomAccent);
  $('color-reset-btn')?.addEventListener('click', resetAccent);
  $('open-color-modal-btn')?.addEventListener('click', () => {
    $('custom-color-modal')?.classList.remove('hidden');
    drawColorWheel();
  });
  $('custom-color-close-btn')?.addEventListener('click', () => {
    $('custom-color-modal')?.classList.add('hidden');
  });
  drawColorWheel();
}

/* ── Hotkey Settings ──────────────────────────────────────── */
let currentHotkey = 'Ctrl+Shift+Space';

function formatHotkeyForDisplay(shortcut) {
  if (!shortcut) return 'Ctrl+Shift+Space';
  return shortcut
    .replace('CommandOrControl', 'Ctrl')
    .replace('Control', 'Ctrl');
}

function initHotkeySettings(savedShortcut) {
  currentHotkey = savedShortcut || 'CommandOrControl+Shift+Space';
  const input = $('hotkey-input');
  if (!input) return;
  input.value = formatHotkeyForDisplay(currentHotkey);

  const tag = document.querySelector('.shortcut-tag');
  if (tag) tag.textContent = formatHotkeyForDisplay(currentHotkey);

  let isRecording = false;

  input.addEventListener('click', () => {
    isRecording = true;
    input.classList.add('recording');
    input.value = 'Нажмите клавиши...';
  });

  input.addEventListener('keydown', async (e) => {
    if (!isRecording) return;
    e.preventDefault();
    e.stopPropagation();

    if (e.key === 'Escape') {
      isRecording = false;
      input.classList.remove('recording');
      input.value = formatHotkeyForDisplay(currentHotkey);
      return;
    }

    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;

    const parts = [];
    if (e.ctrlKey || e.metaKey) parts.push('CommandOrControl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');

    let keyName = '';
    if (e.code === 'Space') keyName = 'Space';
    else if (e.code.startsWith('Key')) keyName = e.code.replace('Key', '');
    else if (e.code.startsWith('Digit')) keyName = e.code.replace('Digit', '');
    else if (e.code.startsWith('F') && !isNaN(e.code.slice(1))) keyName = e.code;
    else if (e.key.length === 1) keyName = e.key.toUpperCase();

    if (!keyName) return;

    if (parts.length === 0) {
      input.value = 'Нужен Ctrl / Alt / Shift!';
      setTimeout(() => {
        if (isRecording) input.value = 'Нажмите клавиши...';
        else input.value = formatHotkeyForDisplay(currentHotkey);
      }, 1000);
      return;
    }

    parts.push(keyName);

    const newShortcut = parts.join('+');
    isRecording = false;
    input.classList.remove('recording');

    try {
      const res = await window.api.setHotkey(newShortcut);
      if (res && res.success) {
        currentHotkey = newShortcut;
        input.value = formatHotkeyForDisplay(currentHotkey);
        if (tag) tag.textContent = formatHotkeyForDisplay(currentHotkey);
      } else {
        input.value = 'Занято!';
        setTimeout(() => {
          input.value = formatHotkeyForDisplay(currentHotkey);
        }, 1200);
      }
    } catch {
      input.value = formatHotkeyForDisplay(currentHotkey);
    }
  });

  document.addEventListener('click', (e) => {
    if (isRecording && e.target !== input) {
      isRecording = false;
      input.classList.remove('recording');
      input.value = formatHotkeyForDisplay(currentHotkey);
    }
  });
}

/* ── Event Listeners ──────────────────────────────────────── */
sendBtn.addEventListener('click', () => {
  if (isLoading && currentStreamId) {
    window.api.stopStream(currentStreamId);
    setStreamingState(false);
    return;
  }
  sendMessage();
});

// Stream tokens listener from main process
window.api.onStreamToken?.((payload) => {
  if (payload.streamId !== currentStreamId) return;

  const msg = messages.find(m => m.id === currentAiMsgId);
  if (!msg) return;

  if (payload.token) {
    const newText = payload.fullText || ((msg.parts[0]?.text || '') + payload.token);
    msg.parts[0] = { text: newText };
    if (!msg.variants) msg.variants = [newText];
    else msg.variants[msg.activeVariant || 0] = newText;

    const el = chatArea.querySelector(`[data-id="${currentAiMsgId}"]`);
    if (el) {
      updateAiMessageElement(el, newText, true);
      const bar = el.querySelector('.msg-actions-bar');
      if (bar) bar.style.display = 'none';
    }
    smartScroll();
  }

  if (payload.done) {
    const el = chatArea.querySelector(`[data-id="${currentAiMsgId}"]`);
    if (el) {
      updateAiMessageElement(el, msg.parts[0]?.text || '', false);
      const bar = el.querySelector('.msg-actions-bar');
      if (bar) bar.style.display = '';
    }
    setStreamingState(false);
    autoSaveCurrentChat();
  }
});
messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});
messageInput.addEventListener('input', () => {
  messageInput.style.height = 'auto';
  messageInput.style.height = Math.min(messageInput.scrollHeight, 80) + 'px';
});

closeBtn.addEventListener('click', () => window.api.hideWindow());
settingsBtn.addEventListener('click', () => showSettings());
profileBtn?.addEventListener('click', () => showProfile());

// Close buttons on views
$('profile-close-btn')?.addEventListener('click', () => showChat());
$('settings-close-btn')?.addEventListener('click', () => showChat());
$('models-close-btn')?.addEventListener('click', () => showChat());

$('profile-back-btn')?.addEventListener('click', () => showChat());
$('trial-reset-btn')?.addEventListener('click', resetTrialTokens);
settingsBackBtn.addEventListener('click', () => { window.api.saveConfig({ opacity }); showChat(); });
$('models-back-btn')?.addEventListener('click', () => showChat());

// Models manager button
$('models-mgr-btn')?.addEventListener('click', () => showModels());

// Add/Edit model form
$('om-save-btn')?.addEventListener('click', async () => {
  const provider = $('om-provider')?.value || 'gemini';
  const id = $('om-id')?.value.trim();
  const key = $('om-api-key')?.value.trim();
  const customProviderName = $('om-custom-provider')?.value.trim() || undefined;
  const url = $('om-url')?.value.trim() || undefined;

  if (!id) {
    $('om-id').style.borderColor = '#f87171';
    setTimeout(() => { if ($('om-id')) $('om-id').style.borderColor = ''; }, 1200);
    return;
  }

  if (key !== undefined) {
    providerKeys[provider] = key;
    await window.api.saveConfig({
      provider,
      geminiKey: providerKeys.gemini,
      openaiKey: providerKeys.openai,
      anthropicKey: providerKeys.anthropic,
      deepseekKey: providerKeys.deepseek,
      customKey: providerKeys.custom,
      customUrl: provider === 'custom' ? url : undefined
    });
  }

  const modelData = {
    id,
    name: id,
    provider,
    customProviderName: provider === 'custom' ? customProviderName : undefined,
    baseUrl: provider === 'custom' ? url : undefined
  };

  if (editingModelOriginal) {
    let list = getModels();
    const idx = list.findIndex(m => m.id === editingModelOriginal.id && m.provider === editingModelOriginal.provider);
    if (idx >= 0) {
      list[idx] = modelData;
      saveModels(list);
    }
    if (selectedModel === editingModelOriginal.id) {
      selectedModel = id;
      activeProvider = provider;
      window.api.saveConfig({ model: id, provider });
    }
    cancelEditModel();
    populateModels(id);
    renderModelsList();
  } else {
    addModel(modelData);
    cancelEditModel();
  }
});

$('om-cancel-edit-btn')?.addEventListener('click', cancelEditModel);

// Export
$('export-chat-btn')?.addEventListener('click', () => { if (messages.length > 0) $('export-overlay-modal')?.classList.remove('hidden'); });
$('export-close-btn')?.addEventListener('click', () => $('export-overlay-modal')?.classList.add('hidden'));
$('export-overlay-md')?.addEventListener('click', () => exportChat('md'));
$('export-overlay-json')?.addEventListener('click', () => exportChat('json'));
$('export-overlay-txt')?.addEventListener('click', () => exportChat('txt'));

// Screenshot
screenshotBtn.addEventListener('click', async () => {
  const res = await window.api.takeScreenshot();
  const b64 = normalizeBase64(res);
  if (b64) {
    currentScreenshot = b64;
    screenshotImg.src = 'data:image/png;base64,' + b64;
    screenshotPrev.classList.remove('hidden');
  }
});
removeScreenBtn.addEventListener('click', () => { currentScreenshot = null; screenshotPrev.classList.add('hidden'); });

// Sidebar
sidebarToggleBtn?.addEventListener('click', () => {
  chatSidebar?.classList.toggle('collapsed');
  localStorage.setItem('overlay_sidebar_collapsed', chatSidebar?.classList.contains('collapsed'));
});
sidebarNewChatBtn?.addEventListener('click', () => startNewSession());
sidebarSearchInput?.addEventListener('input', () => renderSidebarHistory());

// Screenshot from main process
window.api.onScreenshot?.((res) => {
  const b64 = normalizeBase64(res);
  if (b64) {
    currentScreenshot = b64;
    screenshotImg.src = 'data:image/png;base64,' + b64;
    screenshotPrev.classList.remove('hidden');
    showChat();
    messageInput.focus();
  }
});

// Confirm Delete Modal
$('confirm-delete-btn')?.addEventListener('click', executeDelete);
$('cancel-delete-btn')?.addEventListener('click', closeDeleteModal);
$('confirm-delete-close-btn')?.addEventListener('click', closeDeleteModal);

// Click outside to dismiss thought popover
document.addEventListener('click', (e) => {
  if (!e.target.closest('.msg-thought-popover') && !e.target.closest('.msg-thought-btn')) {
    document.querySelectorAll('.msg-thought-popover:not(.hidden)').forEach(p => p.classList.add('hidden'));
    document.querySelectorAll('.msg-thought-btn.has-open-popover').forEach(b => b.classList.remove('has-open-popover'));
  }
});

// Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const openPopover = document.querySelector('.msg-thought-popover:not(.hidden)');
    if (openPopover) {
      openPopover.classList.add('hidden');
      openPopover.parentElement?.querySelector('.msg-thought-btn')?.classList.remove('has-open-popover');
      return;
    }
    const colorModal = $('custom-color-modal');
    if (colorModal && !colorModal.classList.contains('hidden')) { colorModal.classList.add('hidden'); return; }
    const deleteModal = $('confirm-delete-modal');
    if (deleteModal && !deleteModal.classList.contains('hidden')) { closeDeleteModal(); return; }
    const exportModal = $('export-overlay-modal');
    if (exportModal && !exportModal.classList.contains('hidden')) { exportModal.classList.add('hidden'); return; }
    if (!chatView.classList.contains('hidden')) { window.api.hideWindow(); return; }
    showChat();
  }
});

/* ── Start ────────────────────────────────────────────────── */
init();
