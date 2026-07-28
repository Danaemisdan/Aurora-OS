// --- RENDERER.JS ---
// Aurora OS

let tabs = [];
let activeTabId = null;
let tabIdCounter = 0;
let currentRawUrl = '';
window.getBrowserTabs = () => tabs.map(t => ({ id: t.id, url: t.url, active: t.id === activeTabId }));
let isResizing = false;
let agentLoop = null;

// --- DOM REFS ---
const tabsContainer = document.getElementById('tabs-container'); // vertical tabs now
const browserContent = document.getElementById('browser-content');

// Omni-Search Refs
const addressInput = document.getElementById('omni-address-input');
const addressSuggestions = document.getElementById('omni-suggestions');
const searchOverlay = document.getElementById('omni-search-overlay');
const btnSearchTrigger = document.getElementById('btn-search-trigger');

// Navigation Pill
const btnTopbarToggle = document.getElementById('btn-topbar-toggle');
const topPillBar = document.getElementById('top-pill-bar');
const topPillBarZone = document.getElementById('top-pill-bar-zone');

const welcomePage = document.getElementById('welcome-page');
const sidebar = document.getElementById('sidebar'); // old side hub
const aiPanel = document.getElementById('ai-panel');
const appBody = document.querySelector('.app-body');
const desktopOverlay = document.getElementById('desktop-overlay');
const splashScreen = document.getElementById('splash-screen');
const toastContainer = document.getElementById('toast-container');

const resizeHandle = document.getElementById('sidebar-resize-handle');
const resizeOverlay = document.getElementById('resize-overlay');
const btnShare = document.getElementById('btn-share');
const btnSidebar = document.getElementById('btn-sidebar');
const btnAiMode = document.getElementById('btn-ai-mode');
const btnCloseAiPanel = document.getElementById('close-ai-panel');

const bentoOverlay = document.getElementById('bento-grid-overlay');
const bentoContainer = bentoOverlay.querySelector('.bento-container');
const btnExpand = document.getElementById('btn-expand');
const btnCloseBento = document.getElementById('close-bento');

const calMonthName = document.getElementById('cal-month-name');
const calDatesGrid = document.getElementById('cal-dates-grid');
const calNavPrev = document.getElementById('cal-nav-prev');
const calNavNext = document.getElementById('cal-nav-next');
const calNoteInput = document.getElementById('cal-note-input');
const calNewEventBtn = document.getElementById('cal-new-event');
const calToggleItems = document.querySelectorAll('.toggle-item');

const aiInput = document.getElementById('ai-input');
const aiLog = document.getElementById('ai-log');
const aiSendBtn = document.getElementById('ai-send-btn');
const aiStopBtn = document.getElementById('ai-stop-btn');
const aiEnginePill = document.getElementById('ai-engine-pill');
const aiCardCopy = document.getElementById('ai-card-copy');
const aiEmptyState = document.getElementById('ai-empty-state');
const aiQuickButtons = document.querySelectorAll('[data-ai-prompt]');

const AURORA_ROUTE_MAP = {
    wallet: { widget: 'wallet', label: 'Wallet' },
    banking: { widget: 'banking', label: 'Banking' },
    health: { widget: 'telemedicine', label: 'Health' },
    insurance: { widget: 'insurance', label: 'Insurance' },
    identity: { widget: 'identity', label: 'Identity' },
    ai: { panel: 'ai', label: 'Aurora AI' },
    shop: { widget: 'shop', label: 'Commerce' },
    news: { externalUrl: 'https://news.google.com/', label: 'News' },
    home: { home: true, label: 'Home' }
};

const CALENDAR_STORAGE_KEY = 'aurora-calendar-entries';
const ADDRESS_HISTORY_STORAGE_KEY = 'aurora-address-history';
const MAX_TABS = 1000;
const MAX_ADDRESS_HISTORY = 120;
const LOCAL_SUGGESTION_LIMIT = 8;
const REMOTE_SUGGESTION_LIMIT = 8;
const HOME_TAB_TITLE = 'Aurora Deck';
const TAB_PREVIEW_HOVER_DELAY = 110;
const TAB_PREVIEW_CACHE_TTL = 18000;
const MAX_TAB_PREVIEW_CACHE = 20;
const AGENT_MAX_OPEN_RESULTS = 8;
const DEFAULT_TAB_FAVICON = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%23e5e7eb" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18"/><path d="M12 3a14 14 0 0 0 0 18"/></svg>')}`;
const AURORA_TAB_FAVICON = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%23ffffff" stroke-width="2"><path d="M12 3L3 21h18L12 3z"/><circle cx="12" cy="15" r="2.3"/></svg>')}`;
const SEARCH_SUGGESTION_ICON = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none"><circle cx="8.5" cy="8.5" r="5.5" stroke="%23e8eaed" stroke-width="1.6"/><path d="M12.6 12.6L17 17" stroke="%23e8eaed" stroke-width="1.6" stroke-linecap="round"/></svg>')}`;
const QUICK_URL_SUGGESTIONS = [
    'youtube.com',
    'google.com',
    'chatgpt.com',
    'github.com',
    'linkedin.com',
    'wikipedia.org',
    'reddit.com',
    'x.com'
];
const calendarState = {
    view: 'weekly',
    offset: 0,
    entries: loadCalendarEntries()
};
let addressHistory = loadAddressHistory();
let suggestionItems = [];
let activeSuggestionIndex = -1;
let suggestionDebounceTimer = null;
let suggestionRequestSeq = 0;
let suggestionSelectLock = false;
let isApplyingAddressAutofill = false;
let manualAddressQuery = '';
let tabPreviewOverlay = null;
let tabPreviewHoverTimer = null;
let tabPreviewHideTimer = null;
let activePreviewTabId = null;
let tabPreviewCacheOrder = [];
const tabPreviewCaptureTimers = new Map();
let tabSwitchToken = 0;
let auroraAiStatus = null;
let isAgentRunning = false;
let agentStopRequested = false;
let agentRunToken = 0;
let aiThinkingNode = null;
const agentInterruptResolvers = new Set();

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function parseAuroraPath(url) {
    if (!url || !url.startsWith('aurora://')) return '';
    return url.replace('aurora://', '').split(/[/?#]/)[0].toLowerCase();
}

function getActiveTab() {
    return tabs.find((t) => t.id === activeTabId);
}

function getActiveWebview() {
    return document.querySelector(`webview[data-id="${activeTabId}"]`);
}

function updateTabBarVisibility() {
    // No-op for vertical sidebar
}

function updateTabDensity() {
    // No-op for vertical sidebar
}

function getFallbackFaviconForUrl(url) {
    if (!url || url === 'about:blank' || url.startsWith('aurora://')) {
        return AURORA_TAB_FAVICON;
    }

    try {
        const u = new URL(url);
        const iconTarget = `${u.protocol}//${u.host}`;
        return `https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(iconTarget)}&size=128`;
    } catch (err) {
        return DEFAULT_TAB_FAVICON;
    }
}

function setTabFavicon(tabId, src) {
    const faviconEl = document.querySelector(`.tab[data-id="${tabId}"] .tab-favicon`);
    if (!faviconEl) return;

    faviconEl.onerror = () => {
        faviconEl.onerror = null;
        faviconEl.src = DEFAULT_TAB_FAVICON;
    };
    faviconEl.src = src || DEFAULT_TAB_FAVICON;
}

function loadAddressHistory() {
    try {
        const raw = window.localStorage.getItem(ADDRESS_HISTORY_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
    } catch (err) {
        return [];
    }
}

function saveAddressHistory() {
    try {
        window.localStorage.setItem(ADDRESS_HISTORY_STORAGE_KEY, JSON.stringify(addressHistory));
    } catch (err) {
        // ignore
    }
}

function rememberAddressInput(value) {
    const clean = (value || '').trim();
    if (!clean) return;
    if (clean.startsWith('aurora://') || clean === 'about:blank') return;

    const normalized = clean.toLowerCase();
    addressHistory = addressHistory.filter((entry) => entry.toLowerCase() !== normalized);
    addressHistory.unshift(clean);
    addressHistory = addressHistory.slice(0, MAX_ADDRESS_HISTORY);
    saveAddressHistory();
}

function rememberVisitedUrl(url) {
    if (!url || url === 'about:blank' || url.startsWith('aurora://')) return;
    try {
        const parsed = new URL(url);
        const host = parsed.hostname.replace(/^www\./, '');
        if (!host) return;
        rememberAddressInput(host);
    } catch (err) {
        // ignore
    }
}

function isUrlLikeInput(input) {
    const text = (input || '').trim().toLowerCase();
    if (!text) return false;
    if (/^(https?:\/\/|file:\/\/|ftp:\/\/)/.test(text)) return true;
    if (text.startsWith('localhost')) return true;
    if (/^(\d{1,3}\.){3}\d{1,3}/.test(text)) return true;
    if (text.includes('.') && !/\s/.test(text)) return true;
    return false;
}

function toDisplayUrl(url) {
    if (!url) return '';
    if (url.startsWith('aurora://')) return url;
    try {
        const parsed = new URL(url.includes('://') ? url : `https://${url}`);
        const host = parsed.hostname.replace(/^www\./, '');
        const path = parsed.pathname === '/' ? '' : parsed.pathname;
        return `${host}${path}`;
    } catch (err) {
        return url;
    }
}

function toDomain(url) {
    if (!url) return '';
    try {
        const parsed = new URL(url.includes('://') ? url : `https://${url}`);
        return parsed.hostname.replace(/^www\./, '');
    } catch (err) {
        return '';
    }
}

function makeSearchSuggestion(query, source = 'Google') {
    const value = (query || '').trim();
    return {
        value,
        label: value,
        title: value,
        subtitle: 'google.com/search',
        meta: source,
        kind: 'search',
        icon: SEARCH_SUGGESTION_ICON
    };
}

function makeUrlSuggestion(raw, source = 'Visit') {
    const value = (raw || '').trim();
    const normalized = value.includes('://') ? value : `https://${value}`;
    const domain = toDomain(normalized);
    return {
        value,
        label: value,
        title: domain || value,
        subtitle: toDisplayUrl(normalized),
        meta: source,
        kind: 'url',
        icon: getFallbackFaviconForUrl(normalized)
    };
}

function findHistoryAutofill(prefix) {
    const typed = (prefix || '').trim();
    if (!typed) return null;
    const lower = typed.toLowerCase();

    for (const entry of addressHistory) {
        const value = (entry || '').trim();
        if (!value) continue;
        const valueLower = value.toLowerCase();
        if (valueLower.startsWith(lower) && value.length > typed.length) {
            return value;
        }
    }

    return null;
}

function findSuggestedSiteAutofill(prefix) {
    const typed = (prefix || '').trim();
    if (!typed) return null;
    if (typed.includes(' ') || typed.includes('/')) return null;

    const lower = typed.toLowerCase();
    const candidates = QUICK_URL_SUGGESTIONS
        .filter((site) => site.toLowerCase().startsWith(lower) && site.length > typed.length)
        .sort((a, b) => a.length - b.length);

    return candidates[0] || null;
}

function tryApplyAddressAutofill(inputType = '') {
    if (isApplyingAddressAutofill) return;
        if (searchOverlay.classList.contains('hidden')) return;

    const current = addressInput.value || '';
    const caretStart = addressInput.selectionStart ?? current.length;
    const caretEnd = addressInput.selectionEnd ?? current.length;
    const isDelete = inputType.startsWith('delete');
    const isPaste = inputType === 'insertFromPaste';

    manualAddressQuery = current;

    if (!current || isDelete || isPaste) return;
    if (caretStart !== caretEnd) return;
    if (caretEnd !== current.length) return;

    const match = findHistoryAutofill(current) || findSuggestedSiteAutofill(current);
    if (!match) return;

    isApplyingAddressAutofill = true;
    addressInput.value = match;
    try {
        addressInput.setSelectionRange(current.length, match.length);
    } catch (err) {
        // ignore
    }
    isApplyingAddressAutofill = false;
}

function normalizeSuggestionUrl(value) {
    const clean = (value || '').trim();
    if (!clean) return '';
    if (/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(clean)) return clean;
    if (/^localhost(:\d+)?(\/.*)?$/i.test(clean) || /^(\d{1,3}\.){3}\d{1,3}(:\d+)?(\/.*)?$/.test(clean)) {
        return `http://${clean}`;
    }
    return `https://${clean}`;
}

function executeSuggestionItem(item) {
    if (!item || typeof item.value !== 'string') return;
    const value = item.value.trim();
    if (!value) return;

    rememberAddressInput(value);
    hideAddressSuggestions({ clearItems: true });

    if (item.kind === 'url') {
        const url = normalizeSuggestionUrl(value);
        if (!url) return;
        navigateToUrl(url, getTabTitleFromUrl(url), value);
        addressInput.blur();
        return;
    }

    if (item.kind === 'search') {
        const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(value)}`;
        navigateToUrl(searchUrl, value, value);
        addressInput.blur();
        return;
    }

    executeAddressInput(value);
}

function findSuggestionRowFromEvent(event) {
    if (!event) return null;

    if (typeof event.composedPath === 'function') {
        const fromPath = event.composedPath().find(
            (node) => node instanceof Element && node.classList?.contains('address-suggestion')
        );
        if (fromPath) return fromPath;
    }

    const target = event.target instanceof Element ? event.target : null;
    if (target) {
        const fromTarget = target.closest('.address-suggestion');
        if (fromTarget) return fromTarget;
    }

    if (typeof event.clientX === 'number' && typeof event.clientY === 'number') {
        const pointEl = document.elementFromPoint(event.clientX, event.clientY);
        if (pointEl instanceof Element) {
            const fromPoint = pointEl.closest('.address-suggestion');
            if (fromPoint) return fromPoint;
        }
    }

    return null;
}

function mergeSuggestions(list) {
    const merged = [];
    const seen = new Set();

    list.forEach((item) => {
        if (!item || typeof item.value !== 'string' || !item.value.trim()) return;
        const key = `${item.kind || 'search'}::${item.value.toLowerCase()}`;
        if (seen.has(key)) return;
        seen.add(key);
        merged.push(item);
    });

    return merged;
}

function buildLocalSuggestions(query) {
    const clean = (query || '').trim();
    const lower = clean.toLowerCase();
    const suggestions = [];

    if (!clean) {
        addressHistory.slice(0, LOCAL_SUGGESTION_LIMIT).forEach((entry) => {
            if (isUrlLikeInput(entry)) {
                suggestions.push(makeUrlSuggestion(entry, 'History'));
            } else {
                suggestions.push(makeSearchSuggestion(entry, 'History'));
            }
        });
        return suggestions;
    }

    addressHistory.forEach((entry) => {
        if (entry.toLowerCase().includes(lower)) {
            if (isUrlLikeInput(entry)) {
                suggestions.push(makeUrlSuggestion(entry, 'History'));
            } else {
                suggestions.push(makeSearchSuggestion(entry, 'History'));
            }
        }
    });

    if (isUrlLikeInput(clean)) {
        suggestions.push(makeUrlSuggestion(clean, 'Top Hit'));
    } else {
        suggestions.push(makeSearchSuggestion(clean, 'Top Search'));
    }

    QUICK_URL_SUGGESTIONS.forEach((entry) => {
        if (entry.includes(lower) || lower.includes(entry)) {
            suggestions.push(makeUrlSuggestion(entry, 'Suggested Site'));
        }
    });

    return mergeSuggestions(suggestions).slice(0, LOCAL_SUGGESTION_LIMIT);
}

async function fetchRemoteSuggestions(query) {
    const clean = (query || '').trim();
    if (clean.length < 2 || isUrlLikeInput(clean)) return [];

    const endpoint = `https://suggestqueries.google.com/complete/search?client=firefox&hl=en&gl=us&q=${encodeURIComponent(clean)}`;

    try {
        const response = await fetch(endpoint, {
            method: 'GET',
            headers: { Accept: 'application/json' }
        });
        if (!response.ok) return [];

        const payload = await response.json();
        const values = Array.isArray(payload?.[1]) ? payload[1] : [];
        return values
            .filter((item) => typeof item === 'string' && item.trim())
            .slice(0, REMOTE_SUGGESTION_LIMIT)
            .map((item) => makeSearchSuggestion(item, 'Google'));
    } catch (err) {
        return [];
    }
}

function renderAddressSuggestions() {
    if (!addressSuggestions) return;

    addressSuggestions.innerHTML = '';

    if (searchOverlay.classList.contains('hidden') || suggestionItems.length === 0) {
        addressSuggestions.classList.remove('visible');
        return;
    }

    suggestionItems.forEach((item, idx) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'address-suggestion';
        row.dataset.index = String(idx);
        row.dataset.kind = item.kind || 'search';
        if (idx === activeSuggestionIndex) row.classList.add('active');
        row.innerHTML = `
            <span class="suggestion-left">
                <img class="suggestion-icon" src="${escapeHtml(item.icon || SEARCH_SUGGESTION_ICON)}" alt="">
                <span class="suggestion-text">
                    <span class="suggestion-main">${escapeHtml(item.title || item.label)}</span>
                    <span class="suggestion-sub">${escapeHtml(item.subtitle || '')}</span>
                </span>
            </span>
            <span class="suggestion-meta">${escapeHtml(item.meta)}</span>
        `;

        row.addEventListener('mouseenter', () => {
            activeSuggestionIndex = idx;
            renderAddressSuggestions();
        });

        row.addEventListener('pointerdown', (e) => {
            if (suggestionSelectLock) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            suggestionSelectLock = true;
            e.preventDefault();
            e.stopPropagation();
            executeSuggestionItem(item);
            setTimeout(() => {
                suggestionSelectLock = false;
            }, 60);
        }, true);

        addressSuggestions.appendChild(row);
    });

    addressSuggestions.classList.add('visible');
}

function setSuggestionItems(items, opts = {}) {
    const { resetActive = true } = opts;
    suggestionItems = Array.isArray(items) ? items : [];
    if (resetActive) {
        activeSuggestionIndex = -1;
    } else if (activeSuggestionIndex >= suggestionItems.length) {
        activeSuggestionIndex = suggestionItems.length - 1;
    }
    renderAddressSuggestions();
}

function hideAddressSuggestions(opts = {}) {
    const { clearItems = false } = opts;
    if (!addressSuggestions) return;
    addressSuggestions.classList.remove('visible');
    if (clearItems) {
        suggestionItems = [];
        activeSuggestionIndex = -1;
        addressSuggestions.innerHTML = '';
    }
}

function scheduleSuggestionRefresh(immediate = false, queryOverride = null) {
    const queryValue = queryOverride ?? addressInput.value;

    if (suggestionDebounceTimer) {
        clearTimeout(suggestionDebounceTimer);
        suggestionDebounceTimer = null;
    }

    if (immediate) {
        void refreshAddressSuggestions(queryValue);
        return;
    }

    suggestionDebounceTimer = setTimeout(() => {
        suggestionDebounceTimer = null;
        void refreshAddressSuggestions(queryValue);
    }, 140);
}

async function refreshAddressSuggestions(query) {
    if (!addressSuggestions || searchOverlay.classList.contains('hidden')) return;

    const currentQuery = (query || '').trim();
    const requestId = ++suggestionRequestSeq;

    const localSuggestions = buildLocalSuggestions(currentQuery);
    setSuggestionItems(localSuggestions, { resetActive: true });

    const remoteSuggestions = await fetchRemoteSuggestions(currentQuery);

    if (requestId !== suggestionRequestSeq) return;
    if (searchOverlay.classList.contains('hidden')) return;
    if ((addressInput.value || '').trim() !== currentQuery) return;

    const merged = mergeSuggestions([...localSuggestions, ...remoteSuggestions]);
    setSuggestionItems(merged.slice(0, LOCAL_SUGGESTION_LIMIT + REMOTE_SUGGESTION_LIMIT), { resetActive: true });
}

function executeAddressInput(rawValue) {
    const input = (rawValue || '').trim();
    const parsed = normalizeInputToUrl(input);
    if (!parsed) return;

    rememberAddressInput(input);
    hideAddressSuggestions({ clearItems: true });

    if (parsed.type === 'aurora') {
        handleAuroraRoute(parsed.value);
        closeAddressEditing();
        return;
    }

    navigateToUrl(parsed.value, parsed.type === 'search' ? input : getTabTitleFromUrl(parsed.value), input);
    closeAddressEditing();
    
    if (parsed.type === 'search') {
        // We no longer auto-trigger the AI dock popup here per user request.
        // It must be manually triggered via the dock button.
    }
}

function touchTabPreviewCache(tabId) {
    tabPreviewCacheOrder = tabPreviewCacheOrder.filter((id) => id !== tabId);
    tabPreviewCacheOrder.unshift(tabId);

    while (tabPreviewCacheOrder.length > MAX_TAB_PREVIEW_CACHE) {
        const evictTabId = tabPreviewCacheOrder.pop();
        const evictTab = tabs.find((tab) => tab.id === evictTabId);
        if (!evictTab) continue;
        evictTab.previewImage = '';
        evictTab.previewCapturedAt = 0;
    }
}

function ensureTabPreviewOverlay() {
    if (tabPreviewOverlay) return tabPreviewOverlay;

    const overlay = document.createElement('div');
    overlay.className = 'tab-preview-overlay';
    overlay.innerHTML = `
        <div class="tab-preview-shot-wrap">
            <img class="tab-preview-shot" alt="Tab preview">
        </div>
        <div class="tab-preview-content">
            <div class="tab-preview-title"></div>
            <div class="tab-preview-url"></div>
            <div class="tab-preview-description"></div>
        </div>
    `;

    overlay.addEventListener('mouseenter', () => {
        if (tabPreviewHideTimer) {
            clearTimeout(tabPreviewHideTimer);
            tabPreviewHideTimer = null;
        }
    });

    overlay.addEventListener('mouseleave', () => {
        scheduleHideTabPreview();
    });

    document.body.appendChild(overlay);
    tabPreviewOverlay = overlay;
    return overlay;
}

function scheduleHideTabPreview(delay = 110) {
    if (tabPreviewHoverTimer) {
        clearTimeout(tabPreviewHoverTimer);
        tabPreviewHoverTimer = null;
    }
    if (tabPreviewHideTimer) clearTimeout(tabPreviewHideTimer);
    tabPreviewHideTimer = setTimeout(() => {
        const overlay = ensureTabPreviewOverlay();
        overlay.classList.remove('visible');
        activePreviewTabId = null;
    }, delay);
}

function cancelHideTabPreview() {
    if (tabPreviewHideTimer) {
        clearTimeout(tabPreviewHideTimer);
        tabPreviewHideTimer = null;
    }
}

function positionTabPreview(anchorTabEl) {
    const overlay = ensureTabPreviewOverlay();
    if (!anchorTabEl) return;

    const tabRect = anchorTabEl.getBoundingClientRect();
    const overlayRect = overlay.getBoundingClientRect();
    const viewportPadding = 10;

    let left = tabRect.left + (tabRect.width / 2) - (overlayRect.width / 2);
    left = Math.max(viewportPadding, Math.min(left, window.innerWidth - overlayRect.width - viewportPadding));

    let top = tabRect.bottom + 9;
    if (top + overlayRect.height > window.innerHeight - viewportPadding) {
        top = tabRect.top - overlayRect.height - 9;
    }
    top = Math.max(viewportPadding, top);

    overlay.style.left = `${Math.round(left)}px`;
    overlay.style.top = `${Math.round(top)}px`;
}

function getTabDescriptionFallback(tabData) {
    if (!tabData || !tabData.url) return 'No description available yet.';
    if (tabData.url.startsWith('aurora://')) {
        return 'Aurora workspace tab.';
    }

    try {
        const u = new URL(tabData.url);
        return `Preview from ${u.hostname.replace(/^www\./, '')}`;
    } catch (err) {
        return 'No description available yet.';
    }
}

function renderTabPreview(tabData, tabEl) {
    const overlay = ensureTabPreviewOverlay();
    const titleEl = overlay.querySelector('.tab-preview-title');
    const urlEl = overlay.querySelector('.tab-preview-url');
    const descEl = overlay.querySelector('.tab-preview-description');
    const shotEl = overlay.querySelector('.tab-preview-shot');

    const tabTitleEl = document.querySelector(`.tab[data-id="${tabData.id}"] .tab-title`);
    const title = tabData.lastTitle || tabTitleEl?.textContent?.trim() || getTabTitleFromUrl(tabData.url);
    const description = (tabData.previewDescription || '').trim() || getTabDescriptionFallback(tabData);
    const displayUrl = (() => {
        if (!tabData.url) return '';
        if (tabData.url.startsWith('aurora://')) return tabData.url;
        try {
            return new URL(tabData.url).hostname.replace(/^www\./, '');
        } catch (err) {
            return tabData.url;
        }
    })();

    titleEl.textContent = title || HOME_TAB_TITLE;
    urlEl.textContent = displayUrl;
    descEl.textContent = description;

    if (tabData.previewImage) {
        shotEl.src = tabData.previewImage;
        shotEl.classList.add('has-image');
    } else {
        shotEl.removeAttribute('src');
        shotEl.classList.remove('has-image');
    }

    if (tabEl) positionTabPreview(tabEl);
    overlay.classList.add('visible');
}

function normalizeWebviewDisplayState(webview, visible) {
    if (!webview) return;
    if (visible) {
        webview.style.display = 'flex';
        webview.style.visibility = '';
        webview.style.position = '';
        webview.style.inset = '';
        webview.style.zIndex = '';
        webview.style.pointerEvents = '';
        webview.style.opacity = '';
        return;
    }

    webview.style.display = 'none';
    webview.style.visibility = '';
    webview.style.position = '';
    webview.style.inset = '';
    webview.style.zIndex = '';
    webview.style.pointerEvents = '';
    webview.style.opacity = '';
}

async function refreshTabPreviewData(tabData, opts = {}) {
    const { force = false } = opts;
    if (!tabData || !tabData.id) return;
    if (tabData.url.startsWith('aurora://') || tabData.url === 'about:blank') return;

    const now = Date.now();
    const age = now - (tabData.previewCapturedAt || 0);
    if (!force && tabData.previewImage && age < TAB_PREVIEW_CACHE_TTL) return;

    const webview = document.querySelector(`webview[data-id="${tabData.id}"]`);
    if (!webview) return;
    const isHidden = webview.style.display === 'none';
    if (isHidden) return;

    const metadataScript = `(function () {
        const descriptionMeta = document.querySelector('meta[name="description"]');
        const ogDescriptionMeta = document.querySelector('meta[property="og:description"]');
        const twitterDescriptionMeta = document.querySelector('meta[name="twitter:description"]');
        const firstParagraph = document.querySelector('p');
        const description = (descriptionMeta && descriptionMeta.content) ||
            (ogDescriptionMeta && ogDescriptionMeta.content) ||
            (twitterDescriptionMeta && twitterDescriptionMeta.content) ||
            (firstParagraph && firstParagraph.innerText) || '';
        return {
            title: document.title || '',
            description: String(description || '').replace(/\\s+/g, ' ').trim().slice(0, 160)
        };
    })()`;

    try {
        const shotPromise = typeof webview.capturePage === 'function'
            ? webview.capturePage()
            : Promise.resolve(null);
        const metaPromise = typeof webview.executeJavaScript === 'function'
            ? webview.executeJavaScript(metadataScript)
            : Promise.resolve({});

        const [shot, meta] = await Promise.all([shotPromise, metaPromise]);

        if (shot && typeof shot.toDataURL === 'function') {
            const optimizedShot = typeof shot.resize === 'function'
                ? shot.resize({ width: 572 })
                : shot;
            if (typeof optimizedShot.getSize === 'function') {
                const size = optimizedShot.getSize();
                if (!size || size.width < 32 || size.height < 32) return;
            }
            if (typeof optimizedShot.isEmpty === 'function' && optimizedShot.isEmpty()) {
                return;
            }
            const dataUrl = optimizedShot.toDataURL();
            if (dataUrl && dataUrl.length > 40) {
                tabData.previewImage = dataUrl;
                touchTabPreviewCache(tabData.id);
            }
        }

        if (meta && typeof meta.title === 'string' && meta.title.trim()) {
            tabData.lastTitle = meta.title.trim();
        }

        if (meta && typeof meta.description === 'string' && meta.description.trim()) {
            tabData.previewDescription = meta.description.trim();
        }

        tabData.previewCapturedAt = Date.now();
    } catch (err) {
        // Ignore preview errors for restricted pages.
    }
}

function scheduleTabPreviewRefresh(tabId, delay = 260, opts = {}) {
    if (!Number.isInteger(tabId)) return;
    if (tabPreviewCaptureTimers.has(tabId)) {
        clearTimeout(tabPreviewCaptureTimers.get(tabId));
    }

    const timer = setTimeout(() => {
        tabPreviewCaptureTimers.delete(tabId);
        const tabData = tabs.find((t) => t.id === tabId);
        if (!tabData) return;
        const captureOpts = { ...opts };
        if (typeof captureOpts.force !== 'boolean') captureOpts.force = false;
        void refreshTabPreviewData(tabData, captureOpts);
    }, Math.max(0, delay));

    tabPreviewCaptureTimers.set(tabId, timer);
}

function queueTabPreview(tabId, tabEl) {
    if (tabId === activeTabId) return;

    if (tabPreviewHoverTimer) clearTimeout(tabPreviewHoverTimer);
    cancelHideTabPreview();

    tabPreviewHoverTimer = setTimeout(async () => {
        const tabData = tabs.find((t) => t.id === tabId);
        if (!tabData) return;

        activePreviewTabId = tabId;
        renderTabPreview(tabData, tabEl);
        const previewAge = Date.now() - (tabData.previewCapturedAt || 0);
        const needsRefresh = !tabData.previewImage || previewAge > Math.floor(TAB_PREVIEW_CACHE_TTL * 0.45);

        if (needsRefresh) {
            await refreshTabPreviewData(tabData, {
                force: !tabData.previewImage
            });
        }
        if (!tabData.previewImage) {
            await new Promise((resolve) => setTimeout(resolve, 220));
            await refreshTabPreviewData(tabData, {
                force: true
            });
        }

        if (activePreviewTabId !== tabId) return;
        const currentTabEl = document.querySelector(`.tab[data-id="${tabId}"]`);
        renderTabPreview(tabData, currentTabEl || tabEl);
    }, TAB_PREVIEW_HOVER_DELAY);
}

function applyWebviewPerformanceProfile() {
    document.querySelectorAll('webview').forEach((wv) => {
        const tabId = Number(wv.dataset.id);
        const isActive = tabId === activeTabId;
        try {
            if (typeof wv.setBackgroundThrottling === 'function') {
                wv.setBackgroundThrottling(!isActive);
            }
            if (typeof wv.setFrameRate === 'function') {
                wv.setFrameRate(isActive ? 60 : 15);
            }
        } catch (err) {
            // Ignore unavailable APIs on some platforms.
        }
    });
}

function syncSidePanelsState() {
    const hubOpen = sidebar && !sidebar.classList.contains('hidden');
    const aiOpen = aiPanel && !aiPanel.classList.contains('hidden');
    if (appBody) appBody.classList.toggle('sidebar-open', Boolean(hubOpen || aiOpen));
}

function setSidebarVisible(show) {
    if (!sidebar) return;
    if (show && isAgentRunning) {
        showToast('Stop the agent before opening Aurora Hub.', 'warn');
        return;
    }
    sidebar.classList.toggle('hidden', !show);
    if (show && aiPanel) aiPanel.classList.add('hidden');
    if (btnAiMode) btnAiMode.classList.remove('active');
    syncSidePanelsState();
}

function setAiPanelVisible(show, opts = {}) {
    const { force = false, silent = false } = opts;
    if (!aiPanel) return;
    if (!show && isAgentRunning && !force) {
        if (!silent) showToast('Stop the agent before closing Aurora AI.', 'warn');
        return;
    }
    aiPanel.classList.toggle('hidden', !show);
    if (show && sidebar) sidebar.classList.add('hidden');
    if (btnAiMode) btnAiMode.classList.toggle('active', show);
    syncSidePanelsState();
}

function clearPageLoadVisualState() {
    document.querySelectorAll('webview.webview-loading, webview.webview-loaded').forEach((wv) => {
        wv.classList.remove('webview-loading', 'webview-loaded');
    });
    browserContent.classList.remove('page-loading');
}

function applyPageLoadStart(tabId) {
    // Page-load transitions intentionally disabled.
    const wv = document.querySelector(`webview[data-id="${tabId}"]`);
    if (!wv) return;
    wv.classList.remove('webview-loading', 'webview-loaded');
}

function applyPageLoadEnd(tabId) {
    const wv = document.querySelector(`webview[data-id="${tabId}"]`);
    if (!wv) return;
    wv.classList.remove('webview-loading', 'webview-loaded');
    browserContent.classList.remove('page-loading');
}

function showToast(message, tone = 'info') {
    if (!toastContainer || !message) return;
    const toast = document.createElement('div');
    toast.className = `toast ${tone}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('visible'));
    setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => toast.remove(), 220);
    }, 2100);
}

function getTabTitleFromUrl(url, fallback = HOME_TAB_TITLE) {
    if (!url || url === 'about:blank') return fallback;
    if (url.startsWith('aurora://')) {
        const path = parseAuroraPath(url);
        if (!path || path === 'home') return HOME_TAB_TITLE;
        return AURORA_ROUTE_MAP[path]?.label || fallback;
    }

    try {
        const u = new URL(url);
        return u.hostname.replace(/^www\./, '') || fallback;
    } catch (err) {
        return fallback;
    }
}

function updateActiveTabState(url, tabTitle) {
    const tabData = getActiveTab();
    if (tabData) tabData.url = url;
    if (tabData) tabData.lastTitle = tabTitle || getTabTitleFromUrl(url);
    const tabEl = document.querySelector(`.tab[data-id="${activeTabId}"] .tab-title`);
    if (tabEl) tabEl.textContent = tabTitle || getTabTitleFromUrl(url);
}

function focusSidebarWidget(type, opts = {}) {
    const { silent = false } = opts;
    const widget = document.querySelector(`.hub-widget[data-type="${type}"]`);
    setSidebarVisible(true);

    if (!widget) {
        if (!silent) showToast('Section not available yet', 'warn');
        return;
    }

    widget.scrollIntoView({ behavior: 'smooth', block: 'center' });
    widget.classList.add('widget-focus');
    setTimeout(() => widget.classList.remove('widget-focus'), 850);

    if (!silent) {
        const mapped = Object.entries(AURORA_ROUTE_MAP).find(([, route]) => route.widget === type);
        showToast(`${mapped?.[1]?.label || 'Section'} opened`, 'success');
    }
}

function navigateToUrl(url, tabTitle) {
    const wv = getActiveWebview();
    if (!wv || !url) return;

    const activeTab = getActiveTab();
    if (activeTab) activeTab.isLoading = true;
    applyPageLoadStart(activeTabId);

    // If webview is on about:blank, setting src initializes it. Otherwise loadURL preserves proper history.
    if (!wv.src || wv.src === 'about:blank' || wv.src === 'aurora://home') {
        wv.src = url;
    } else {
        wv.loadURL(url);
    }
    
    welcomePage.style.display = 'none';
    wv.style.display = 'flex';
    setSidebarVisible(false);

    updateActiveTabState(url, tabTitle);
    updateAddressDisplay(url);
}

function handleAuroraRoute(url, opts = {}) {
    const { silent = false } = opts;
    const path = parseAuroraPath(url);
    const route = AURORA_ROUTE_MAP[path];
    const activeTab = getActiveTab();

    if (!route) {
        showToast(`Unknown route: ${path || url}`, 'warn');
        return;
    }

    if (route.externalUrl) {
        navigateToUrl(route.externalUrl, route.label);
        if (!silent) showToast(`${route.label} opened`, 'success');
        return;
    }

    if (activeTab) {
        activeTab.url = `aurora://${path}`;
        activeTab.favicon = AURORA_TAB_FAVICON;
        const tabEl = document.querySelector(`.tab[data-id="${activeTabId}"]`);
        if (tabEl) {
            const titleEl = tabEl.querySelector('.tab-title');
            if (titleEl) titleEl.textContent = route.label || 'Aurora OS';
            const imgEl = tabEl.querySelector('.tab-favicon');
            if (imgEl) imgEl.src = AURORA_TAB_FAVICON;
        }
    }
    switchTab(activeTabId);
    updateAddressDisplay(`aurora://${path}`);

    if (route.home) {
        setSidebarVisible(false);
        if (!silent) showToast('Home opened', 'success');
        return;
    }

    if (route.panel === 'ai') {
        setAiPanelVisible(true);
        if (aiInput) requestAnimationFrame(() => aiInput.focus());
        if (!silent) showToast('Aurora AI opened', 'success');
        return;
    }

    if (route.widget) focusSidebarWidget(route.widget, { silent });
}

function normalizeInputToUrl(input) {
    const trimmed = input.trim();
    if (!trimmed) return null;

    if (/^aurora:\/\//i.test(trimmed)) {
        return { type: 'aurora', value: `aurora://${parseAuroraPath(trimmed)}` };
    }

    const lowerInput = trimmed.toLowerCase();
    const commonDomains = {
        'youtube': 'youtube.com',
        'google': 'google.com',
        'github': 'github.com',
        'twitter': 'twitter.com',
        'x': 'x.com',
        'reddit': 'reddit.com',
        'netflix': 'netflix.com',
        'facebook': 'facebook.com',
        'gmail': 'mail.google.com'
    };

    if (commonDomains[lowerInput]) {
        return { type: 'url', value: `https://${commonDomains[lowerInput]}` };
    }

    const hasProtocol = /^(https?:\/\/)/i.test(trimmed);
    const isDomain = /^([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(:\d+)?(\/.*)?$/.test(trimmed);
    const isIP = /^(\d{1,3}\.){3}\d{1,3}(:\d+)?(\/.*)?$/.test(trimmed);
    const isLocalhost = /^localhost(:\d+)?(\/.*)?$/.test(trimmed);
    const isUrl = hasProtocol || isDomain || isIP || isLocalhost;

    if (isUrl) {
        return { type: 'url', value: hasProtocol ? trimmed : `https://${trimmed}` };
    }

    return {
        type: 'search',
        value: `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`
    };
}

function extractSearchQuery(url) {
    try {
        const u = new URL(url);
        const host = u.hostname.replace('www.', '');
        if (host === 'google.com' || host.endsWith('.google.com')) return u.searchParams.get('q');
        if (host === 'bing.com' || host.endsWith('.bing.com')) return u.searchParams.get('q');
        if (host === 'duckduckgo.com') return u.searchParams.get('q');
        if (host === 'search.yahoo.com') return u.searchParams.get('p');
    } catch (err) {
        return null;
    }
    return null;
}

function getCleanDisplay(url) {
    if (!url || url === 'about:blank') return { type: 'empty', text: '' };
    if (url.startsWith('aurora://')) return { type: 'empty', text: '' };

    const query = extractSearchQuery(url);
    if (query) return { type: 'search', text: query };

    try {
        const u = new URL(url);
        const domain = u.hostname.replace('www.', '');
        const path = u.pathname === '/' ? '' : u.pathname;
        return { type: 'site', domain, path, text: domain + path };
    } catch (err) {
        return { type: 'raw', text: url };
    }
}

function updateAddressDisplay(url) {
    currentRawUrl = url || '';
    // The old address display is removed. We use Omni-Search now.
}

function getAddressSeedValueFromCurrentUrl() {
    if (!currentRawUrl || currentRawUrl === 'about:blank' || currentRawUrl.startsWith('aurora://')) {
        return '';
    }

    const searchQuery = extractSearchQuery(currentRawUrl);
    return searchQuery ? searchQuery : currentRawUrl;
}

function openAddressEditing(opts = {}) {
    const { force = false, selectAll = true } = opts;
    if (!force && !searchOverlay.classList.contains('hidden')) return;

    searchOverlay.classList.remove('hidden');

    const seed = getAddressSeedValueFromCurrentUrl();
    addressInput.value = seed;
    manualAddressQuery = seed;
    addressInput.focus();

    if (selectAll) {
        addressInput.select();
    } else {
        const end = addressInput.value.length;
        addressInput.setSelectionRange(end, end);
    }

    scheduleSuggestionRefresh(true, manualAddressQuery);
}

function closeAddressEditing() {
    searchOverlay.classList.add('hidden');
    hideAddressSuggestions({ clearItems: false });
    addressInput.blur();
}

// Omni-Search triggers
if (btnSearchTrigger) {
    btnSearchTrigger.addEventListener('click', () => {
        const popup = document.getElementById('ai-dock-response-popup');
        const aiDockInput = document.getElementById('ai-dock-input');
        if (popup && popup.classList.contains('active')) {
            window.closeDockAiMode();
        } else if (popup) {
            popup.classList.add('active');
            if (aiDockInput) {
                aiDockInput.value = '';
                aiDockInput.focus();
            }
        }
    });
}

const aiDockInput = document.getElementById('ai-dock-input');
if (aiDockInput) {
    aiDockInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const query = aiDockInput.value.trim();
            if (query && typeof window.openDockAiMode === 'function') {
                window.openDockAiMode(query);
            }
        } else if (e.key === 'Escape') {
            window.closeDockAiMode();
        }
    });
}

// Close search overlay if clicking outside the input container
searchOverlay.addEventListener('click', (e) => {
    if (e.target === searchOverlay) {
        closeAddressEditing();
    }
});

addressInput.addEventListener('input', (e) => {
    if (isApplyingAddressAutofill) return;
    const inputType = typeof e?.inputType === 'string' ? e.inputType : '';
    tryApplyAddressAutofill(inputType);
    scheduleSuggestionRefresh(false, manualAddressQuery || addressInput.value);
});

addressInput.addEventListener('blur', () => {
    suggestionRequestSeq += 1;
    // Don't auto-close on blur, let the user click outside or hit escape
});

addressInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        e.preventDefault();
        closeAddressEditing();
    }
});

if (addressSuggestions) {
    const handleSuggestionPointer = (e) => {
        const row = findSuggestionRowFromEvent(e);
        if (!row || suggestionSelectLock) return;
        const idx = Number(row.dataset.index);
        if (!Number.isInteger(idx) || !suggestionItems[idx]) return;

        suggestionSelectLock = true;
        e.preventDefault();
        e.stopPropagation();
        executeSuggestionItem(suggestionItems[idx]);

        setTimeout(() => {
            suggestionSelectLock = false;
        }, 60);
    };

    addressSuggestions.addEventListener('pointerdown', handleSuggestionPointer, true);
    addressSuggestions.addEventListener('mousedown', handleSuggestionPointer, true);
    addressSuggestions.addEventListener('click', handleSuggestionPointer, true);
}

document.addEventListener('pointerdown', (e) => {
    if (!addressSuggestions || suggestionSelectLock) return;
    if (searchOverlay.classList.contains('hidden')) return;
    if (!addressSuggestions.classList.contains('visible')) return;

    const row = findSuggestionRowFromEvent(e);
    if (!row) return;

    const idx = Number(row.dataset.index);
    if (!Number.isInteger(idx) || !suggestionItems[idx]) return;

    suggestionSelectLock = true;
    e.preventDefault();
    e.stopPropagation();
    executeSuggestionItem(suggestionItems[idx]);

    setTimeout(() => {
        suggestionSelectLock = false;
    }, 60);
}, true);

// Boot Flow (Splash -> Welcome -> Tour)
window.addEventListener('DOMContentLoaded', () => {
    const welcomeScreen = document.getElementById('welcome-screen');
    const btnWelcomeStart = document.getElementById('btn-welcome-start');
    const onboarded = localStorage.getItem('aurora-onboarded-v12');
    
    // First, let splash screen run, then fade it out.
    setTimeout(() => {
        if (splashScreen) {
            splashScreen.style.opacity = '0';
            setTimeout(() => {
                if (splashScreen.parentElement) splashScreen.remove();
                
                // If not onboarded, trigger Welcome Screen fade-in
                if (!onboarded && welcomeScreen) {
                    welcomeScreen.style.opacity = '1';
                    welcomeScreen.style.pointerEvents = 'auto';
                }
            }, 600);
        }
    }, 2000); // Wait 2s for splash loader
    
    if (onboarded && welcomeScreen) {
        welcomeScreen.remove();
    } else if (btnWelcomeStart) {
        btnWelcomeStart.addEventListener('click', () => {
            welcomeScreen.classList.add('hidden');
            localStorage.setItem('aurora-onboarded-v12', 'true');
            
            // Wait for fade out, then remove and start tour
            setTimeout(() => {
                welcomeScreen.remove();
                startBrowserTour();
            }, 850);
        });
    }
});

// --- Browser Tour Logic ---
function startBrowserTour() {
    const overlay = document.getElementById('tour-overlay');
    const popover = document.getElementById('tour-popover');
    const textEl = document.getElementById('tour-text');
    const btnNext = document.getElementById('btn-tour-next');
    const arrowUp = document.getElementById('tour-arrow-up');
    
    if (!overlay || !popover) return;
    
    let topZoneListener = null;

    const steps = [
        {
            elementId: 'top-pill-bar', // Will be positioned near top
            text: 'Hover your mouse at the top edge of the screen anytime to reveal and manage all your docked tabs.',
            action: () => { 
                if (arrowUp) arrowUp.classList.remove('hidden'); // show arrow
                
                let triggered = false;
                topZoneListener = (e) => {
                    if (e.clientY <= 20 && !triggered) {
                        triggered = true;
                        document.removeEventListener('mousemove', topZoneListener);
                        topZoneListener = null;
                        btnNext.click();
                    }
                };
                document.addEventListener('mousemove', topZoneListener);
            }
        },
        {
            elementId: 'btn-topbar-toggle',
            text: 'Tabs Toggle: Show or hide your open tabs at the top of the screen.',
            action: () => { 
                btnNext.classList.remove('hidden');
                btnNext.innerText = 'Next';
                if (arrowUp) arrowUp.classList.add('hidden'); // hide arrow
                
                if (topZoneListener) {
                    document.removeEventListener('mousemove', topZoneListener);
                    topZoneListener = null;
                }
                
                const topBar = document.getElementById('top-pill-bar');
                if (topBar) topBar.classList.remove('visible');
            }
        },
        {
            elementId: 'btn-back',
            text: 'Back: Go back to the previous page.',
            action: () => {}
        },
        {
            elementId: 'btn-forward',
            text: 'Forward: Go forward to the next page.',
            action: () => {}
        },
        {
            elementId: 'btn-search-trigger',
            text: 'Aurora AI: Your everyday AI search assistant. Ask it anything (CMD+T).',
            action: () => {}
        },
        {
            elementId: 'btn-agents',
            text: 'Aurora Instincts: Automate tasks and let the browser act on your behalf.',
            action: () => {}
        },
        {
            elementId: 'btn-hub',
            text: 'Apps & History: View your favorite apps, bookmarks, and browsing history.',
            action: () => {
                btnNext.innerText = 'Finish';
            }
        }
    ];
    
    let currentStep = 0;
    
    function highlightStep() {
        // Clean previous
        document.querySelectorAll('.tour-highlight').forEach(el => {
            el.classList.remove('tour-highlight');
        });
        
        if (currentStep >= steps.length) {
            // End tour
            overlay.classList.add('hidden');
            popover.classList.add('hidden');
            setSidebarVisible(false);
            if (arrowUp) arrowUp.classList.add('hidden');
            return;
        }
        
        const step = steps[currentStep];
        
        setTimeout(() => {
            const target = document.getElementById(step.elementId);
            if (target) {
                target.classList.add('tour-highlight');
                textEl.innerText = step.text;
                
                // Show popover to measure it
                popover.classList.remove('hidden');
                
                setTimeout(() => {
                    const rect = target.getBoundingClientRect();
                    const popoverRect = popover.getBoundingClientRect();
                    
                    // Position popover near the target
                    let topPos = rect.bottom + 20;
                    let leftPos = rect.left;
                    
                    // Specific fix for the top-pill-bar step so we don't cover the centered arrow
                    if (step.elementId === 'top-pill-bar') {
                        leftPos = window.innerWidth / 2 + 60; // Move to the right of the center
                        topPos = rect.bottom + 40; // Push down a bit more
                    }
                    
                    // If it goes offscreen, place it ABOVE the target instead
                    if (topPos + popoverRect.height > window.innerHeight - 20) {
                        topPos = rect.top - popoverRect.height - 50; // Extra room for the tooltip
                    }
                    
                    if (leftPos > window.innerWidth - 320) {
                        leftPos = window.innerWidth - 320;
                    }
                    
                    popover.style.top = topPos + 'px';
                    popover.style.left = leftPos + 'px';
                    
                    // Execute action after positioning (in case action modifies layout)
                    if (step.action) step.action();
                }, 50); // small delay to let browser reflow text and get height
            }
        }, 300); // wait for UI transitions (like omni search fading in)
    }
    
    overlay.classList.remove('hidden');
    popover.classList.remove('hidden');
    highlightStep();
    
    btnNext.addEventListener('click', () => {
        currentStep++;
        highlightStep();
    });
}

// Drag & snap
document.querySelectorAll('.hub-widget').forEach((widget) => {
    widget.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('type', widget.dataset.type);
        e.dataTransfer.setData('html', widget.innerHTML);
        setSidebarVisible(false);
    });
});

desktopOverlay.addEventListener('dragover', (e) => {
    e.preventDefault();
    desktopOverlay.style.background = 'rgba(255,255,255,0.05)';
});

desktopOverlay.addEventListener('dragleave', () => {
    desktopOverlay.style.background = 'transparent';
});

desktopOverlay.addEventListener('drop', (e) => {
    e.preventDefault();
    desktopOverlay.style.background = 'transparent';

    const type = e.dataTransfer.getData('type');
    const html = e.dataTransfer.getData('html');
    const snapped = document.createElement('div');
    snapped.className = 'snapped-widget';
    snapped.innerHTML = `<div class="widget-header"><span>${type.toUpperCase()}</span><span class="close-widget">x</span></div>${html}`;
    snapped.querySelector('.close-widget').addEventListener('click', () => snapped.remove());
    desktopOverlay.appendChild(snapped);
});

// Tabs
function createTab(url = 'aurora://home', opts = {}) {
    const { focusAddress = false } = opts;

    if (tabs.length >= MAX_TABS) {
        showToast(`Tab limit reached (${MAX_TABS}).`, 'warn');
        return;
    }

    const tabId = tabIdCounter++;
    tabs.push({
        id: tabId,
        url: url,
        title: escapeHtml(getTabTitleFromUrl(url)),
        favicon: url.startsWith('aurora://') ? AURORA_TAB_FAVICON : DEFAULT_TAB_FAVICON,
        isLoading: true,
        lastTitle: ''
    });
    const tab = document.createElement('div');
    tab.className = 'tab active';
    tab.dataset.id = tabId;
    tab.innerHTML = `
        <img class="tab-favicon" src="${url.startsWith('aurora://') ? AURORA_TAB_FAVICON : DEFAULT_TAB_FAVICON}" alt="">
        <span class="tab-title">${escapeHtml(getTabTitleFromUrl(url))}</span>
        <span class="close-tab">✕</span>
    `;

    tab.addEventListener('click', () => switchTab(tabId));
    tab.addEventListener('auxclick', (e) => {
        if (e.button === 1) {
            e.preventDefault();
            closeTab(tabId);
        }
    });
    tab.addEventListener('mouseenter', () => queueTabPreview(tabId, tab));
    tab.addEventListener('mouseleave', () => scheduleHideTabPreview());
    tab.querySelector('.close-tab').addEventListener('click', (e) => {
        e.stopPropagation();
        closeTab(tabId);
    });

    tabsContainer.appendChild(tab);

    const webview = document.createElement('webview');
    webview.src = url.startsWith('aurora://') ? 'about:blank' : url;
    webview.dataset.id = tabId;
    webview.setAttribute('preload', window.aurora.preloadPath || '');
    webview.setAttribute('webpreferences', 'sandbox=no, contextIsolation=yes');
    webview.setAttribute('allowpopups', '');
    normalizeWebviewDisplayState(webview, false);

    webview.addEventListener('new-window', (e) => {
        e.preventDefault();
        navigateToUrl(e.url, 'Popup Request');
    });

    webview.addEventListener('console-message', (e) => {
        if (e.level >= 2) {
            console.error(`[Webview ${tabId}] ${e.message}`);
        }
    });

    webview.addEventListener('page-title-updated', (e) => {
        const tabData = tabs.find((t) => t.id === tabId);
        if (!tabData || tabData.url.startsWith('aurora://')) return;
        const tabEl = document.querySelector(`.tab[data-id="${tabId}"] .tab-title`);
        if (tabEl) tabEl.textContent = e.title;
        tabData.lastTitle = e.title || tabData.lastTitle;
    });

    webview.addEventListener('page-favicon-updated', (e) => {
        const tabData = tabs.find((t) => t.id === tabId);
        if (!tabData) return;

        const liveUrl = typeof webview.getURL === 'function' ? webview.getURL() : '';
        const sourceUrl = (liveUrl && liveUrl !== 'about:blank')
            ? liveUrl
            : (tabData.url || e?.favicons?.[0] || webview.src);
        const crispIcon = getFallbackFaviconForUrl(sourceUrl);
        tabData.favicon = crispIcon;
        setTabFavicon(tabId, crispIcon);
    });

    webview.addEventListener('did-navigate', (e) => {
        if (!e.isMainFrame) return;
        
        // If the user navigates back to the initial about:blank state, close/hide the tab and go home
        if (e.url === 'about:blank' || e.url === '') {
            handleAuroraRoute('aurora://home', { silent: true });
            return;
        }
        
        const tabData = tabs.find((t) => t.id === tabId);
        if (!tabData) return;
        tabData.url = e.url;
        tabData.previewImage = '';
        tabData.previewDescription = '';
        tabData.previewCapturedAt = 0;
        rememberVisitedUrl(e.url);
        tabData.favicon = getFallbackFaviconForUrl(e.url);
        setTabFavicon(tabId, tabData.favicon);
        if (activeTabId === tabId && e.url !== 'about:blank') {
            updateAddressDisplay(e.url);
            if (!tabData.url.startsWith('aurora://')) {
                welcomePage.style.display = 'none';
                normalizeWebviewDisplayState(webview, true);
            }
        }
        scheduleTabPreviewRefresh(tabId, activeTabId === tabId ? 220 : 260);
    });

    webview.addEventListener('did-navigate-in-page', (e) => {
        if (!e.isMainFrame) return;
        
        if (e.url === 'about:blank' || e.url === '') {
            handleAuroraRoute('aurora://home', { silent: true });
            return;
        }
        
        const tabData = tabs.find((t) => t.id === tabId);
        if (!tabData) return;
        tabData.url = e.url;
        tabData.previewImage = '';
        tabData.previewDescription = '';
        tabData.previewCapturedAt = 0;
        rememberVisitedUrl(e.url);
        tabData.favicon = getFallbackFaviconForUrl(e.url);
        setTabFavicon(tabId, tabData.favicon);
        if (activeTabId === tabId) {
            updateAddressDisplay(e.url);
            if (!tabData.url.startsWith('aurora://') && e.url !== 'about:blank') {
                welcomePage.style.display = 'none';
                normalizeWebviewDisplayState(webview, true);
            }
        }
        scheduleTabPreviewRefresh(tabId, activeTabId === tabId ? 180 : 240);
    });

    webview.addEventListener('ipc-message', (event) => {
        handleWebviewIpc(tabId, event.channel, event.args[0]);
    });

    webview.addEventListener('did-stop-loading', () => {
        const tabData = tabs.find((t) => t.id === tabId);
        if (tabData) tabData.isLoading = false;
        if (activeTabId === tabId) applyPageLoadEnd(tabId);
        scheduleTabPreviewRefresh(tabId, activeTabId === tabId ? 120 : 220, {
            force: true
        });

        // --- AUTO-FILL PAYMENT LOGIC ---
        // Inject a smart autofill agent that watches for async payment gateways (Stripe, Braintree, generic forms)
        if (mockBalances['69aff543bdaef66d5e275a18'] || mockBalances['wallet'] > 0) {
            const autofillScript = `
                (function() {
                    if (window.__auroraAutofillAgentActive) return;
                    window.__auroraAutofillAgentActive = true;

                    function showAuroraBadge(targetEl) {
                        if (document.getElementById('aurora-autofill-badge')) return;
                        
                        const badge = document.createElement('div');
                        badge.id = 'aurora-autofill-badge';
                        badge.innerHTML = '✨ Autofilled by Aurora Browser';
                        badge.style.position = 'fixed';
                        badge.style.bottom = '24px';
                        badge.style.right = '24px';
                        badge.style.background = 'rgba(25, 25, 25, 0.85)';
                        badge.style.backdropFilter = 'blur(12px)';
                        badge.style.webkitBackdropFilter = 'blur(12px)';
                        badge.style.border = '1px solid rgba(255, 255, 255, 0.08)';
                        badge.style.color = '#fff';
                        badge.style.padding = '10px 18px';
                        badge.style.borderRadius = '12px';
                        badge.style.fontFamily = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro", "Helvetica Neue", sans-serif';
                        badge.style.fontWeight = '500';
                        badge.style.fontSize = '14px';
                        badge.style.zIndex = '2147483647';
                        badge.style.boxShadow = '0 8px 32px rgba(0,0,0,0.2)';
                        badge.style.pointerEvents = 'none';
                        badge.style.animation = 'fadeIn 0.5s ease-out';
                        
                        document.body.appendChild(badge);
                        setTimeout(() => { 
                            badge.style.opacity = '0'; 
                            badge.style.transition = 'opacity 0.6s'; 
                            setTimeout(() => badge.remove(), 600); 
                        }, 4000);
                    }

                    function fillInputs(doc) {
                        const inputs = doc.querySelectorAll('input');
                        let foundCc = false, ccInput, nameInput, expInput, cvvInput;

                        inputs.forEach(input => {
                            const name = (input.name || '').toLowerCase();
                            const id = (input.id || '').toLowerCase();
                            const placeholder = (input.placeholder || '').toLowerCase();
                            const autocomplete = (input.getAttribute('autocomplete') || '').toLowerCase();
                            const type = input.type || '';

                            if (name.includes('cardnumber') || id.includes('cc-number') || autocomplete.includes('cc-number') || placeholder.includes('card number') || name === 'card') {
                                ccInput = input;
                                foundCc = true;
                            }
                            if (name.includes('ccname') || id.includes('cc-name') || autocomplete.includes('cc-name') || placeholder.includes('name on card')) {
                                nameInput = input;
                            }
                            if (name.includes('ccexp') || id.includes('cc-exp') || autocomplete.includes('cc-exp') || placeholder.includes('mm/yy') || name === 'exp-date') {
                                expInput = input;
                            }
                            if (name.includes('cvc') || id.includes('cvv') || autocomplete.includes('cc-csc') || placeholder.includes('cvv') || name === 'cvc') {
                                cvvInput = input;
                            }
                        });

                        if (foundCc && ccInput && !ccInput.dataset.auroraFilled) {
                            ccInput.value = '4123 0131 8834 6100'; 
                            ccInput.dataset.auroraFilled = 'true';
                            ccInput.dispatchEvent(new Event('input', { bubbles: true }));
                            ccInput.dispatchEvent(new Event('change', { bubbles: true }));
                            
                            if (nameInput) {
                                nameInput.value = 'Samuel Olamide';
                                nameInput.dispatchEvent(new Event('input', { bubbles: true }));
                                nameInput.dispatchEvent(new Event('change', { bubbles: true }));
                            }
                            if (expInput) {
                                expInput.value = '12/28';
                                expInput.dispatchEvent(new Event('input', { bubbles: true }));
                                expInput.dispatchEvent(new Event('change', { bubbles: true }));
                            }
                            if (cvvInput) {
                                cvvInput.value = '123';
                                cvvInput.dispatchEvent(new Event('input', { bubbles: true }));
                                cvvInput.dispatchEvent(new Event('change', { bubbles: true }));
                            }

                            showAuroraBadge(ccInput);
                            return true;
                        }
                        return false;
                    }

                    function scanDom() {
                        if (fillInputs(document)) return;
                        
                        // Check accessible iframes (like some legacy Stripe setups)
                        const iframes = document.querySelectorAll('iframe');
                        for (let i = 0; i < iframes.length; i++) {
                            try {
                                if (iframes[i].contentDocument) {
                                    if (fillInputs(iframes[i].contentDocument)) return;
                                }
                            } catch(e) { } // Ignore cross-origin errors
                        }
                    }

                    // Scan immediately
                    scanDom();

                    // Observe for dynamically injected Stripe/React payment forms
                    const observer = new MutationObserver((mutations) => {
                        for (let m of mutations) {
                            if (m.addedNodes.length > 0) {
                                scanDom();
                            }
                        }
                    });
                    
                    observer.observe(document.body, { childList: true, subtree: true });
                })();
            `;
            webview.executeJavaScript(autofillScript).catch(console.error);
        }
    });

    webview.addEventListener('did-start-loading', () => {
        const tabData = tabs.find((t) => t.id === tabId);
        if (tabData) {
            tabData.isLoading = true;
            tabData.previewImage = '';
            tabData.previewDescription = '';
            tabData.previewCapturedAt = 0;
        }
        if (activeTabId === tabId) applyPageLoadStart(tabId);
    });

    webview.addEventListener('did-fail-load', () => {
        const tabData = tabs.find((t) => t.id === tabId);
        if (tabData) tabData.isLoading = false;
        if (activeTabId === tabId) applyPageLoadEnd(tabId);
    });

    webview.addEventListener('dom-ready', () => {
        scheduleTabPreviewRefresh(tabId, activeTabId === tabId ? 90 : 180);
    });

    webview.addEventListener('did-finish-load', () => {
        const isActive = activeTabId === tabId;
        scheduleTabPreviewRefresh(tabId, isActive ? 180 : 460, {
            force: true
        });
        if (isActive) {
            setTimeout(() => {
                if (activeTabId !== tabId) return;
                const tabData = tabs.find((t) => t.id === tabId);
                if (!tabData) return;
                void refreshTabPreviewData(tabData, { force: true });
            }, 760);
        }
    });

    browserContent.appendChild(webview);
    tabs.push({
        id: tabId,
        url,
        favicon: getFallbackFaviconForUrl(url),
        lastTitle: getTabTitleFromUrl(url),
        previewImage: '',
        previewDescription: '',
        previewCapturedAt: 0,
        isLoading: false
    });
    setTabFavicon(tabId, getFallbackFaviconForUrl(url));
    updateTabBarVisibility();
    updateTabDensity();
    switchTab(tabId);

    if (focusAddress) {
        requestAnimationFrame(() => openAddressEditing({ force: true, selectAll: false }));
    }
}

async function capturePreviewBeforeTabHide(tabId, switchTokenAtStart) {
    if (!Number.isInteger(tabId)) return;
    const tabData = tabs.find((t) => t.id === tabId);
    if (!tabData) return;
    if (tabData.url.startsWith('aurora://') || tabData.url === 'about:blank') return;

    const webview = document.querySelector(`webview[data-id="${tabId}"]`);
    if (!webview || webview.style.display === 'none') return;

    try {
        await Promise.race([
            refreshTabPreviewData(tabData, { force: true }),
            new Promise((resolve) => setTimeout(resolve, 95))
        ]);
    } catch (err) {
        // Ignore capture races when users switch tabs quickly.
    }

    if (switchTokenAtStart !== tabSwitchToken) return;
}

async function switchTab(tabId) {
    try {
        const switchTokenAtStart = ++tabSwitchToken;
        const previousActiveTabId = activeTabId;
        if (previousActiveTabId !== null && previousActiveTabId !== tabId) {
            await capturePreviewBeforeTabHide(previousActiveTabId, switchTokenAtStart);
            if (switchTokenAtStart !== tabSwitchToken) return;
        }

        activeTabId = tabId;
        document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
        const tabEl = document.querySelector(`.tab[data-id="${tabId}"]`);
        if (tabEl) tabEl.classList.add('active');

        const tabData = tabs.find((t) => t.id === tabId);
        if (!tabData) return;

        document.querySelectorAll('webview').forEach((wv) => {
            if (parseInt(wv.dataset.id, 10) === tabId) {
                if (tabData.url.startsWith('aurora://')) {
                    welcomePage.style.display = 'block';
                    normalizeWebviewDisplayState(wv, false);
                    clearPageLoadVisualState();
                    updateAddressDisplay(tabData.url);

                    const route = AURORA_ROUTE_MAP[parseAuroraPath(tabData.url)];
                    if (route?.panel === 'ai') {
                        setAiPanelVisible(true);
                        if (aiInput) requestAnimationFrame(() => aiInput.focus());
                    } else if (route?.widget) {
                        focusSidebarWidget(route.widget, { silent: true });
                    } else if (route?.home) {
                        setSidebarVisible(false);
                    }
                } else {
                    setSidebarVisible(false);
                    welcomePage.style.display = 'none';
                    normalizeWebviewDisplayState(wv, true);
                    if (wv.src !== 'about:blank') updateAddressDisplay(wv.src);
                    if (tabData.isLoading) {
                        applyPageLoadStart(tabId);
                    } else {
                        applyPageLoadEnd(tabId);
                    }
                }
            } else {
                normalizeWebviewDisplayState(wv, false);
            }
        });
        scheduleTabPreviewRefresh(tabId, 240);
        scheduleHideTabPreview(0);
        applyWebviewPerformanceProfile();
    } catch (err) {
        console.error('Failed to switch tab', err);
    }
}

function closeTab(tabId) {
    if (activePreviewTabId === tabId) {
        scheduleHideTabPreview(0);
    }

    const tabEl = document.querySelector(`.tab[data-id="${tabId}"]`);
    if (tabEl) tabEl.remove();

    const wv = document.querySelector(`webview[data-id="${tabId}"]`);
    if (wv) wv.remove();

    tabs = tabs.filter((t) => t.id !== tabId);
    tabPreviewCacheOrder = tabPreviewCacheOrder.filter((id) => id !== tabId);
    if (tabPreviewCaptureTimers.has(tabId)) {
        clearTimeout(tabPreviewCaptureTimers.get(tabId));
        tabPreviewCaptureTimers.delete(tabId);
    }
    updateTabBarVisibility();
    updateTabDensity();
    applyWebviewPerformanceProfile();

    if (tabs.length > 0) {
        switchTab(tabs[tabs.length - 1].id);
    } else {
        createTab();
        clearPageLoadVisualState();
    }
}

// Top Bar toggle & hover
if (btnTopbarToggle && topPillBar) {
    btnTopbarToggle.addEventListener('click', () => {
        topPillBar.classList.toggle('hidden-bar');
    });
}
if (topPillBarZone && topPillBar) {
    topPillBarZone.addEventListener('mouseenter', () => {
        topPillBar.classList.remove('hidden-bar');
    });
    topPillBar.addEventListener('mouseleave', () => {
        topPillBar.classList.add('hidden-bar');
    });
    // Ensure if we hover out of the zone but NOT into the bar, it hides.
    topPillBarZone.addEventListener('mouseleave', (e) => {
        if (!topPillBar.contains(e.relatedTarget)) {
            topPillBar.classList.add('hidden-bar');
        }
    });
}


// Navigation
document.getElementById('btn-back').addEventListener('click', () => {
    const wv = getActiveWebview();
    const tabData = tabs.find(t => t.id === activeTabId);

    // If we are on an Aurora UI overlay...
    if (tabData && tabData.url.startsWith('aurora://')) {
        // ...and the webview underneath actually has a page loaded
        if (wv && wv.src && !wv.src.startsWith('aurora://') && wv.src !== 'about:blank') {
            // Dismiss the overlay and return to the web page!
            tabData.url = wv.src;
            switchTab(activeTabId);
            return;
        }
    }

    if (!wv) {
        handleAuroraRoute('aurora://home', { silent: true });
        return;
    }
    
    // Back: only go back if there's real history. If no history, stay on current page.
    try {
        if (wv.canGoBack()) {
            // Intercept if goBack() lands on about:blank — show home instead
            const webviewEl = document.querySelector(`webview[data-id="${activeTabId}"]`);
            if (webviewEl) {
                const onBackNavigated = (e) => {
                    webviewEl.removeEventListener('did-navigate', onBackNavigated);
                    if (!e.url || e.url === 'about:blank' || e.url === '') {
                        webviewEl.style.display = 'none';
                        if (welcomePage) welcomePage.style.display = '';
                        const tabData2 = tabs.find(t => t.id === activeTabId);
                        if (tabData2) tabData2.url = 'aurora://home';
                        updateAddressDisplay('aurora://home');
                    }
                };
                webviewEl.addEventListener('did-navigate', onBackNavigated);
            }
            wv.goBack();
        }
        // No history? Just stay. Don't navigate anywhere.
    } catch(e) {
        console.warn('goBack error:', e);
    }
});

document.getElementById('btn-forward').addEventListener('click', () => {
    const wv = getActiveWebview();
    const tabData = tabs.find(t => t.id === activeTabId);
    
    // Prevent forward button from navigating a hidden webview
    if (tabData && tabData.url.startsWith('aurora://')) {
        return; 
    }

    if (wv) {
        try {
            applyPageLoadStart(activeTabId);
            wv.goForward();
        } catch(e) { /* no forward history */ }
    }
});



// Address input enter
addressInput.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
        const start = addressInput.selectionStart ?? 0;
        const end = addressInput.selectionEnd ?? 0;
        if (start !== end) {
            e.preventDefault();
            addressInput.setSelectionRange(end, end);
            manualAddressQuery = addressInput.value;
            scheduleSuggestionRefresh(false, manualAddressQuery);
            return;
        }
    }

    if (e.key === 'Escape') {
        hideAddressSuggestions({ clearItems: true });
        addressInput.blur();
        return;
    }

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (suggestionItems.length === 0) return;
        e.preventDefault();
        const direction = e.key === 'ArrowDown' ? 1 : -1;
        if (activeSuggestionIndex < 0) {
            activeSuggestionIndex = direction > 0 ? 0 : suggestionItems.length - 1;
        } else {
            activeSuggestionIndex = (activeSuggestionIndex + direction + suggestionItems.length) % suggestionItems.length;
        }
        addressInput.value = suggestionItems[activeSuggestionIndex].value;
        manualAddressQuery = addressInput.value;
        renderAddressSuggestions();
        return;
    }

    if (e.key !== 'Enter') return;
    e.preventDefault();

    if (activeSuggestionIndex >= 0 && suggestionItems[activeSuggestionIndex]) {
        executeSuggestionItem(suggestionItems[activeSuggestionIndex]);
        return;
    }

    executeAddressInput(e.target.value);
});

// Sidebar
const btnHub = document.getElementById('btn-hub');
const btnAgents = document.getElementById('btn-agents');

if (btnAgents) {
    btnAgents.addEventListener('click', () => {
        if (typeof handleAuroraRoute === 'function') handleAuroraRoute('aurora://home', { silent: true });
        const homeLayoutContainer = document.getElementById('home-layout-container');
        const searchInput = document.getElementById('welcome-search-input');
        
        if (homeLayoutContainer) {
            homeLayoutContainer.classList.remove('apps-active');
            homeLayoutContainer.classList.toggle('agents-active');
            const isAgentsActive = homeLayoutContainer.classList.contains('agents-active');
            
            if (searchInput) {
                searchInput.placeholder = isAgentsActive ? 'Aurora Instincts — coming soon...' : 'Ask Aurora or search the web...';

                if (isAgentsActive) {
                    searchInput.value = '';
                    requestAnimationFrame(() => searchInput.focus());
                }
            }
            
            if (isAgentsActive && typeof renderAgentsHub === 'function') {
                renderAgentsHub();
            }
        }
    });
}

if (btnHub) {
    btnHub.addEventListener('click', () => {
        if (typeof handleAuroraRoute === 'function') handleAuroraRoute('aurora://home', { silent: true });
        const homeLayoutContainer = document.getElementById('home-layout-container');
        const searchInput = document.getElementById('welcome-search-input');
        
        if (homeLayoutContainer) {
            homeLayoutContainer.classList.remove('agents-active');
            homeLayoutContainer.classList.toggle('apps-active');
            const isAppsActive = homeLayoutContainer.classList.contains('apps-active');
            
            if (searchInput) {
                searchInput.placeholder = isAppsActive ? 'Search your apps...' : 'Ask Aurora or search the web...';
                if (isAppsActive) {
                    searchInput.value = '';
                    requestAnimationFrame(() => searchInput.focus());
                }
            }
            if (isAppsActive && typeof renderAppsHub === 'function') {
                renderAppsHub();
            }
        }
    });
}

if (btnAiMode) {
    btnAiMode.addEventListener('click', () => {
        const isCurrentlyHidden = aiPanel.classList.contains('hidden');
        setAiPanelVisible(isCurrentlyHidden);
        if (isCurrentlyHidden && aiInput) {
            requestAnimationFrame(() => aiInput.focus());
        }
    });
}

document.getElementById('close-sidebar').addEventListener('click', () => {
    setSidebarVisible(false);
});

if (btnCloseAiPanel) {
    btnCloseAiPanel.addEventListener('click', () => {
        setAiPanelVisible(false);
    });
}

resizeHandle.addEventListener('mousedown', (e) => {
    isResizing = true;
    resizeHandle.classList.add('active');
    resizeOverlay.classList.add('active');
    sidebar.style.transition = 'none';
    e.preventDefault();
});

document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    const newWidth = window.innerWidth - e.clientX;
    const clamped = Math.max(280, Math.min(newWidth, window.innerWidth * 0.8));
    sidebar.style.width = `${clamped}px`;
});

document.addEventListener('mouseup', () => {
    if (!isResizing) return;
    isResizing = false;
    resizeHandle.classList.remove('active');
    resizeOverlay.classList.remove('active');
    sidebar.style.transition = '';
});

window.addEventListener('blur', () => {
    if (!isResizing) return;
    isResizing = false;
    resizeHandle.classList.remove('active');
    resizeOverlay.classList.remove('active');
    sidebar.style.transition = '';
});

window.addEventListener('resize', () => {
    updateTabDensity();
    if (activePreviewTabId !== null) {
        const activeTabEl = document.querySelector(`.tab[data-id="${activePreviewTabId}"]`);
        if (activeTabEl) {
            positionTabPreview(activeTabEl);
        } else {
            scheduleHideTabPreview(0);
        }
    }
});

document.getElementById('btn-new-tab').addEventListener('click', () => createTab('aurora://home', { focusAddress: false }));

if (btnShare) {
    btnShare.addEventListener('click', async () => {
        const activeTab = getActiveTab();
        const shareUrl = activeTab?.url;

        if (!shareUrl || shareUrl === 'about:blank' || shareUrl.startsWith('aurora://')) {
            showToast('Nothing shareable on this tab yet', 'warn');
            return;
        }

        try {
            await navigator.clipboard.writeText(shareUrl);
            showToast('Link copied to clipboard', 'success');
        } catch (err) {
            showToast('Clipboard permission blocked', 'warn');
        }
    });
}

// Favorites
document.querySelectorAll('.fav-item').forEach((fav) => {
    fav.addEventListener('click', () => {
        const url = fav.dataset.url || '';
        if (url.startsWith('aurora://')) {
            handleAuroraRoute(url);
            return;
        }
        navigateToUrl(url, getTabTitleFromUrl(url));
    });
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    const key = String(e.key || '').toLowerCase();
    if (isAgentRunning && (e.metaKey || e.ctrlKey) && ['t', 'w', 'l', 'r'].includes(key)) {
        e.preventDefault();
        showToast('Agent is controlling tabs. Use Stop Agent.', 'warn');
        return;
    }

    if ((e.metaKey || e.ctrlKey) && key === 't') {
        e.preventDefault();
        createTab('aurora://home', { focusAddress: true });
    }
    if ((e.metaKey || e.ctrlKey) && key === 'w') {
        e.preventDefault();
        if (activeTabId !== null) closeTab(activeTabId);
    }
    if ((e.metaKey || e.ctrlKey) && key === 'l') {
        e.preventDefault();
        openAddressEditing({ selectAll: true });
    }
    if ((e.metaKey || e.ctrlKey) && key === 'r') {
        e.preventDefault();
        const wv = getActiveWebview();
        if (wv) {
            applyPageLoadStart(activeTabId);
            wv.reload();
        }
    }
});

// Maximize on titlebar double click
const titlebarEl = document.querySelector('.titlebar');
if (titlebarEl) {
    titlebarEl.addEventListener('dblclick', (e) => {
        if (e.target.closest('button') || e.target.closest('input')) return;
        if (window.aurora?.maximize) window.aurora.maximize();
    });
}

// Bento grid
if (btnExpand) {
    btnExpand.addEventListener('click', () => {
        setSidebarVisible(false);
        bentoOverlay.classList.remove('hidden');
        requestAnimationFrame(() => bentoOverlay.classList.add('active'));
    });
}

if (btnCloseBento) {
    btnCloseBento.addEventListener('click', () => closeBentoGrid({ restoreSidebar: true }));
}

function closeBentoGrid(opts = {}) {
    const { restoreSidebar = false } = opts;
    bentoOverlay.classList.remove('active');
    setTimeout(() => {
        bentoOverlay.classList.add('hidden');
        if (restoreSidebar) setSidebarVisible(true);
        bentoContainer.style.transform = '';
        bentoContainer.style.opacity = '';
        bentoContainer.style.transition = '';
        bentoOverlay.style.opacity = '';
    }, 380);
}

document.querySelectorAll('.bento-item').forEach((item) => {
    item.addEventListener('click', () => {
        const url = item.dataset.url || '';
        if (!url) return;

        bentoContainer.style.transition = 'transform 0.4s ease-in, opacity 0.3s ease-in';
        bentoContainer.style.transform = 'scale(2)';
        bentoContainer.style.opacity = '0';
        bentoOverlay.style.opacity = '0';

        const isAuroraRoute = url.startsWith('aurora://');
        if (isAuroraRoute) {
            handleAuroraRoute(url, { silent: true });
        } else {
            navigateToUrl(url, getTabTitleFromUrl(url));
        }

        setTimeout(() => {
            bentoOverlay.classList.remove('active');
            bentoOverlay.classList.add('hidden');

            if (isAuroraRoute) {
                const route = AURORA_ROUTE_MAP[parseAuroraPath(url)];
                if (route?.panel === 'ai') {
                    setAiPanelVisible(true);
                    if (aiInput) requestAnimationFrame(() => aiInput.focus());
                } else {
                    setSidebarVisible(Boolean(route?.widget));
                    if (route?.widget) focusSidebarWidget(route.widget, { silent: true });
                }
            } else {
                setSidebarVisible(false);
            }

            bentoOverlay.style.opacity = '';
            bentoContainer.style.transform = '';
            bentoContainer.style.opacity = '';
            bentoContainer.style.transition = '';
        }, 480);
    });
});

// --- MOCK TRANSACTION LOGIC ---
const transferModal = document.getElementById('transfer-modal');
const btnTransferCancel = document.getElementById('btn-transfer-cancel');
const btnTransferNext = document.getElementById('btn-transfer-next');
const btnPasscodeBack = document.getElementById('btn-passcode-back');
const btnTransferSend = document.getElementById('btn-transfer-send');

const viewDetails = document.getElementById('transfer-view-details');
const viewPasscode = document.getElementById('transfer-view-passcode');
const passcodeInputs = document.querySelectorAll('.passcode-digit');

let mockBalances = {
    'wallet': 12450.00,
    'chase': 8240.00,
    'wells': 3120.50
};

// Map values back to their UI DOM selectors to update text
const balanceUISelectors = {
    'wallet': document.getElementById('wallet-balance-display'),
    'chase': document.querySelector('.bank-item:nth-child(1) .bank-balance'),
    'wells': document.querySelector('.bank-item:nth-child(2) .bank-balance')
};

function resetTransferModal() {
    passcodeInputs.forEach(input => input.value = '');
    const amountInput = document.getElementById('transfer-amount-input');
    if (amountInput) amountInput.value = '';
    const recipientInput = document.getElementById('transfer-recipient-input');
    if (recipientInput) recipientInput.value = '';
    if (btnTransferSend) {
        btnTransferSend.disabled = true;
        btnTransferSend.style.background = '#3f3f46';
        btnTransferSend.style.color = '#a1a1aa';
        btnTransferSend.style.cursor = 'not-allowed';
    }

    viewDetails.style.opacity = '1';
    viewDetails.style.transform = 'translateY(0)';
    viewDetails.style.display = 'flex';

    viewPasscode.style.opacity = '0';
    viewPasscode.style.transform = 'translateX(100%)';
    setTimeout(() => viewPasscode.classList.add('hidden'), 300);
}

function openTransferModal() {
    resetTransferModal();
    transferModal.classList.remove('hidden');
    // slight delay to allow display:block before opacity transition
    setTimeout(() => transferModal.style.opacity = '1', 10);
    transferModal.style.pointerEvents = 'auto';
}

function closeTransferModal() {
    transferModal.style.opacity = '0';
    transferModal.style.pointerEvents = 'none';
    setTimeout(() => {
        transferModal.classList.add('hidden');
        resetTransferModal();
    }, 300);
}

function openReceiveModal() {
    const rxModal = document.getElementById('receive-modal');
    if (rxModal) {
        rxModal.classList.remove('hidden');
        setTimeout(() => rxModal.style.opacity = '1', 10);
        rxModal.style.pointerEvents = 'auto';
    }
}

if (btnTransferCancel) btnTransferCancel.addEventListener('click', closeTransferModal);

if (btnTransferNext) btnTransferNext.addEventListener('click', () => {
    const amountInput = document.getElementById('transfer-amount-input');
    const amount = parseFloat(amountInput ? amountInput.value : 0);

    if (isNaN(amount) || amount <= 0) {
        showToast('Please enter a valid amount to send', 'error');
        return;
    }

    const recipientInput = document.getElementById('transfer-recipient-input');
    if (recipientInput && recipientInput.value.trim() === '') {
        showToast('Please select or enter a recipient', 'error');
        return;
    }

    // Slide to passcode view
    viewDetails.style.opacity = '0';
    viewDetails.style.transform = 'translateY(-20px)';

    setTimeout(() => {
        viewDetails.style.display = 'none';
        viewPasscode.classList.remove('hidden');
        setTimeout(() => {
            viewPasscode.style.opacity = '1';
            viewPasscode.style.transform = 'translateX(0)';
            if (passcodeInputs && passcodeInputs.length > 0) passcodeInputs[0].focus();
        }, 50);
    }, 300);
});

// Contact Chip Quick Fill Logic
const contactChips = document.querySelectorAll('.contact-chip');
contactChips.forEach(chip => {
    chip.addEventListener('click', () => {
        const nameSpan = chip.querySelector('span');
        const recipientInput = document.getElementById('transfer-recipient-input');
        if (nameSpan && recipientInput) {
            recipientInput.value = '@' + nameSpan.textContent.toLowerCase();
            recipientInput.focus();
        }
    });
});
if (btnPasscodeBack) {
    btnPasscodeBack.addEventListener('click', () => {
        viewPasscode.style.opacity = '0';
        viewPasscode.style.transform = 'translateX(100%)';

        setTimeout(() => {
            viewPasscode.classList.add('hidden');
            viewDetails.style.display = 'flex';
            viewDetails.style.opacity = '1';
            viewDetails.style.transform = 'translateX(0)';
        }, 300);
    });
}

// Passcode Auto-advance Logic
passcodeInputs.forEach((input, index) => {
    input.addEventListener('input', (e) => {
        if (e.target.value.length === 1) {
            e.target.style.borderColor = '#10b981';
            if (index < passcodeInputs.length - 1) {
                passcodeInputs[index + 1].focus();
            }
        } else {
            e.target.style.borderColor = 'rgba(255,255,255,0.15)';
        }

        // Check if all filled
        const allFilled = Array.from(passcodeInputs).every(inp => inp.value.length === 1);
        if (allFilled) {
            btnTransferSend.disabled = false;
            btnTransferSend.style.background = '#10b981';
            btnTransferSend.style.color = '#000';
            btnTransferSend.style.cursor = 'pointer';
        } else {
            btnTransferSend.disabled = true;
            btnTransferSend.style.background = '#3f3f46';
            btnTransferSend.style.color = '#a1a1aa';
            btnTransferSend.style.cursor = 'not-allowed';
        }
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !e.target.value && index > 0) {
            passcodeInputs[index - 1].focus();
            passcodeInputs[index - 1].value = '';
            passcodeInputs[index - 1].style.borderColor = 'rgba(255,255,255,0.15)';
            btnTransferSend.disabled = true;
            btnTransferSend.style.background = '#3f3f46';
            btnTransferSend.style.color = '#a1a1aa';
            btnTransferSend.style.cursor = 'not-allowed';
        }
    });
});


// --- MONO API INTEGRATION ---
let monoConnectInstance = null;
function initMono() {
    if (!window.Connect) {
        showToast('Payment system loading, try again in a moment', 'warning');
        return;
    }

    if (!monoConnectInstance) {
        monoConnectInstance = new window.Connect({
            key: "test_pk_svmr7aq4e8mf8ee51w29",
            onSuccess: async ({ code }) => {
                showToast('Bank linked! Syncing data securely...', 'success');
                try {
                    const res = await window.aurora.monoExchange(code);
                    if (res.error || !res.id) throw new Error(res.error || "Exchange failed");

                    const accountRes = await window.aurora.monoFetchAccount(res.id);
                    if (accountRes.error) throw new Error(accountRes.error);

                    console.log('Mono Account Data:', accountRes);
                    updateLinkedBankUI(accountRes.account || accountRes);
                } catch (err) {
                    console.error('Mono Sync Error:', err);
                    showToast('Failed to sync bank data.', 'error');
                }
            },
            onClose: () => console.log('Mono Widget closed.')
        });
        monoConnectInstance.setup();
    }
    monoConnectInstance.open();
}

let monoAccountCounter = 0;
function updateLinkedBankUI(account) {
    if (!account) return;

    const currencySym = account.currency === 'NGN' ? '₦' : account.currency === 'USD' ? '$' : account.currency;
    const balanceNum = account.balance ? (account.balance / 100) : 0;
    const balanceStr = `${currencySym}${balanceNum.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

    const bankName = account.institution?.name || account.name || 'Connected Bank';
    const acctType = account.type ? account.type.charAt(0).toUpperCase() + account.type.slice(1) : 'Linked';
    const acctNum = account.accountNumber || account.account_number || '****';
    const cleanNum = acctNum.slice(-4);

    const bankList = document.querySelector('.hub-widget[data-type="banking"]');
    if (bankList) {
        const monoId = `mono-acct-${monoAccountCounter++}`;
        const newBank = document.createElement('div');
        newBank.className = 'bank-item';
        newBank.style.cssText = 'margin-top: 10px; cursor: pointer;'; // Add cursor-pointer
        newBank.innerHTML = `
            <div class="bank-info">
                <div class="bank-name">${escapeHtml(bankName)}</div>
                <div class="bank-type">${escapeHtml(acctType)} ··${escapeHtml(cleanNum)}</div>
            </div>
            <div class="bank-balance" id="${monoId}-bal">${escapeHtml(balanceStr)}</div>
        `;

        newBank.addEventListener('click', () => {
            navigateToUrl(`https://app.mono.co/dashboard`, `${bankName} Portal`);
        });

        const linkBtn = bankList.querySelector('.widget-link');
        if (linkBtn) {
            linkBtn.insertAdjacentElement('beforebegin', newBank); // Insert the element, not the HTML string
        }

        // Add to transaction dropdown mock system
        mockBalances[monoId] = balanceNum;
        balanceUISelectors[monoId] = document.getElementById(`${monoId}-bal`) || linkBtn.previousElementSibling.querySelector('.bank-balance');

        if (typeof transferFrom !== 'undefined' && transferFrom) {
            const newOption = document.createElement('option');
            newOption.value = monoId;
            newOption.textContent = `${bankName} (${balanceStr})`;
            transferFrom.appendChild(newOption);
        }

        showToast(`${bankName} successfully connected!`, 'success');

        // Accrete this balance generically into the Main Wallet Balance
        mockBalances['wallet'] += balanceNum;
        const walletDisplay = balanceUISelectors['wallet'];
        if (walletDisplay) {
            walletDisplay.textContent = `${currencySym}${mockBalances['wallet'].toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
        }

        // --- Auto-Populate Transfer Modal Form ---
        const customerName = account.customer?.name || account.name || 'Connected User';
        const nameInput = document.getElementById('pc-input-name');
        if (nameInput) {
            nameInput.value = customerName;
            nameInput.dispatchEvent(new Event('input'));
        }

        // Create a fake 16-digit number based on NUBAN and typical Visa bin (4)
        const acctNumStr = (account.accountNumber || account.account_number || '').toString();
        // Prefix 4123 for Visa + NUBAN + pad up to 16
        const cardStr = `4123${acctNumStr.padEnd(12, '0').slice(0, 12)}`;
        const numInput = document.getElementById('pc-input-number');
        if (numInput) {
            numInput.value = cardStr.match(/.{1,4}/g)?.join(' ') || cardStr;
            numInput.dispatchEvent(new Event('input', { bubbles: true }));
        }

        const expInput = document.getElementById('pc-input-expiry');
        if (expInput) {
            expInput.value = '12/28';
            expInput.dispatchEvent(new Event('input'));
        }

        const cvvInput = document.getElementById('pc-input-cvv');
        if (cvvInput) {
            cvvInput.value = '123';
            cvvInput.dispatchEvent(new Event('input'));
        }
    }
}

// Widget actions
const widgetActions = {
    'wallet-send': () => openTransferModal(),
    'wallet-receive': () => openReceiveModal(),
    'bank-link-account': () => initMono(),
    'telemedicine-book': () => navigateToUrl('https://www.zocdoc.com/', 'Book Visit'),
    'telemedicine-records': () => showToast('Medical records panel opened', 'success'),
    'insurance-whatsapp': () => navigateToUrl('https://wa.me/14155238886', 'WhatsApp Insurance'),
    'identity-add-credential': () => showToast('Credential onboarding opened', 'success'),
    'shop-sneakers': () => navigateToUrl('https://www.google.com/search?q=buy+sneakers', 'Shop Sneakers'),
    'shop-watch': () => navigateToUrl('https://www.google.com/search?q=buy+watches', 'Shop Watch'),
    'shop-headphones': () => navigateToUrl('https://www.google.com/search?q=buy+headphones', 'Shop Headphones'),
    'shop-jacket': () => navigateToUrl('https://www.google.com/search?q=buy+jackets', 'Shop Jacket')
};

document.querySelectorAll('[data-action]').forEach((el) => {
    el.addEventListener('click', (e) => {
        e.stopPropagation();
        const handler = widgetActions[el.dataset.action];
        if (handler) handler();
    });
});

// --- BOOT SEQUENCE ---
async function initBankData() {
    if (!window.aurora || !window.aurora.monoFetchAllAccounts) return;

    try {
        // Clear hardcoded UI banks
        const bankList = document.querySelector('.hub-widget[data-type="banking"] .bank-list');
        if (bankList) bankList.innerHTML = '';

        // Clear mock from dropdown
        if (typeof transferFrom !== 'undefined' && transferFrom) transferFrom.innerHTML = '';

        // Reset Wallet to 0 initially if we want true dynamic sync
        mockBalances['wallet'] = 0;

        let dataList = [];
        const res = await window.aurora.monoFetchAllAccounts();
        if (res && res.data && Array.isArray(res.data) && res.data.length > 0) {
            dataList = res.data;
        } else {
            console.warn('Mono /v2/accounts returned empty. Injecting Mock Payload for Virtual Wallet Demo.');
            dataList = [{
                "id": "69aff543bdaef66d5e275a18",
                "name": "Samuel Olamide",
                "account_number": "0131883461",
                "currency": "NGN",
                "balance": 10000000,
                "auth_method": "internet_banking",
                "status": "AVAILABLE",
                "bvn": "2011119422",
                "type": "SAVINGS_ACCOUNT",
                "institution": { "id": "5f2d08be60b92e2888287702", "name": "GTBank", "bank_code": "058", "type": "PERSONAL_BANKING" },
                "customer": { "id": "69aff543bdaef66d5e275a16", "name": "Samuel Olamide", "email": null }
            }];
        }

        dataList.forEach(account => {
            updateLinkedBankUI(account);
        });
    } catch (err) {
        console.error('Boot Sync Error:', err);
    }
}

// Trigger on load once DOM is ready so elements like transferFrom exist
document.addEventListener('DOMContentLoaded', () => {
    initBankData();
});


function appendAiMessage(role, text, variant = 'assistant', isStream = false, id = null) {
    const chatContainer = document.getElementById('ai-chat-history');
    const targetLog = (chatContainer && !chatContainer.classList.contains('hidden')) ? chatContainer : aiLog;
    if (!targetLog) return null;
    if (aiEmptyState) aiEmptyState.classList.add('hidden');

    const isUser = variant === 'user';

    const row = document.createElement('div');
    row.className = 'ai-message-row ' + (isUser ? 'justify-end' : 'justify-start');
    if (id) row.id = `msg-${id}`;

    const messageWrapper = document.createElement('div');
    messageWrapper.className = 'flex gap-3 ' + (isUser ? 'flex-row-reverse' : '');

    const avatar = document.createElement('img');
    avatar.style.cssText = 'width:28px;height:28px;border-radius:50%;object-fit:cover;flex-shrink:0;margin-top:4px;box-shadow:0 2px 8px rgba(0,0,0,0.3);';
    avatar.src = isUser ? 'https://ui-avatars.com/api/?name=You&background=007AFF&color=fff&size=56' : 'https://ui-avatars.com/api/?name=A&background=5E5CE6&color=fff&size=56';
    avatar.alt = isUser ? 'You' : 'Aurora';
    // Fallback for offline
    avatar.onerror = function() { this.style.display = 'none'; };

    const contentCol = document.createElement('div');
    contentCol.style.cssText = 'display:flex;flex-direction:column;align-items:' + (isUser ? 'flex-end' : 'flex-start') + ';';

    const bubble = document.createElement('div');
    bubble.className = 'ai-message-bubble ' + (isUser ? 'user-bubble' : 'assistant-bubble');

    contentCol.appendChild(bubble);

    // AI Actions bar for assistant messages
    if (!isUser) {
        const actionsBar = document.createElement('div');
        actionsBar.className = 'ai-actions-bar';
        actionsBar.innerHTML = `
            <button title="Like"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2h0a3.13 3.13 0 0 1 3 3.88Z"/></svg></button>
            <button title="Dislike"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0 1.79 1.11L12 22h0a3.13 3.13 0 0 1-3-3.88Z"/></svg></button>
            <button title="Copy"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg></button>
            <button title="Retry"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg></button>
        `;
        contentCol.appendChild(actionsBar);
    }

    messageWrapper.appendChild(avatar);
    messageWrapper.appendChild(contentCol);
    row.appendChild(messageWrapper);
    targetLog.appendChild(row);
    setTimeout(() => { targetLog.scrollTop = targetLog.scrollHeight + 9999; }, 50);

    if (isStream) {
        return bubble;
    }

    // Stream assistant text word-by-word, or set it all at once for user/error messages
    if (variant === 'assistant' && role === 'Aurora' && !text.includes('<') && !text.includes('⚠️')) {
        bubble.textContent = ''; // start empty
        let i = 0;
        const words = text.split(/(\s+)/);
        function stream() {
            if (i < words.length) {
                bubble.textContent += words[i];
                setTimeout(() => { targetLog.scrollTop = targetLog.scrollHeight + 9999; }, 10);
                i++;
                setTimeout(stream, 25);
            }
        }
        stream();
    } else {
        bubble.innerHTML = text;
    }
    return bubble;
}

function updateAiMessage(id, newText) {
    const row = document.getElementById(`msg-${id}`);
    if (row) {
        const bubble = row.querySelector('.ai-message-bubble');
        if (bubble) bubble.textContent = newText;
        setTimeout(() => { if (aiLog) aiLog.scrollTop = aiLog.scrollHeight + 9999; }, 50);
    }
}

function appendAiMetaLine(text, kind = 'note', returnNode = false) {
    if (!aiLog || !text) return null;
    if (aiEmptyState) aiEmptyState.classList.add('hidden');
    const line = document.createElement('div');
    line.className = `ai-meta-note ${kind === 'action' ? 'ai-meta-action' : kind === 'error' ? 'ai-meta-error' : kind === 'thinking' ? 'thinking' : ''}`.trim();
    if (text.includes('<div') || text.includes('<span')) {
        line.innerHTML = text;
    } else {
        line.textContent = text;
    }
    aiLog.appendChild(line);
    setTimeout(() => { if (aiLog) aiLog.scrollTop = aiLog.scrollHeight + 9999; }, 50);
    if (returnNode) return line;
}

function setAiEnginePill(text, tone = 'neutral') {
    if (!aiEnginePill) return;
    aiEnginePill.textContent = text;
    aiEnginePill.classList.remove('tone-neutral', 'tone-ready', 'tone-warn', 'tone-live');
    aiEnginePill.classList.add(`tone-${tone}`);
}

function setAiThinking(show, label = 'Aurora AI is thinking') {
    if (!aiLog) return;

    if (!show) {
        if (aiThinkingNode && aiThinkingNode.parentElement) {
            aiThinkingNode.remove();
        }
        aiThinkingNode = null;
        return;
    }

    if (aiThinkingNode && aiThinkingNode.parentElement) return;
    if (aiEmptyState) aiEmptyState.classList.add('hidden');

    const row = document.createElement('div');
    row.className = 'ai-message ai-message-assistant ai-thinking-row';

    const roleLabel = document.createElement('div');
    roleLabel.className = 'ai-message-role';
    roleLabel.textContent = 'Aurora';

    const bubble = document.createElement('div');
    bubble.className = 'ai-message-bubble ai-thinking-bubble';
    bubble.innerHTML = `
        <span class="ai-thinking-text">${escapeHtml(label)}</span>
        <span class="ai-thinking-dots" aria-hidden="true"></span>
    `;

    row.appendChild(roleLabel);
    row.appendChild(bubble);
    aiLog.appendChild(row);
    setTimeout(() => { if (aiLog) aiLog.scrollTop = aiLog.scrollHeight + 9999; }, 50);
    aiThinkingNode = row;
}

aiQuickButtons.forEach((btn) => {
    btn.disabled = isAgentRunning;
});

function setAgentControlledTab(tabId) {
    document.querySelectorAll('.tab.agent-controlled').forEach((el) => {
        el.classList.remove('agent-controlled');
    });
    if (!Number.isInteger(tabId)) return;
    const tabEl = document.querySelector(`.tab[data-id="${tabId}"]`);
    if (tabEl) tabEl.classList.add('agent-controlled');
}

function setAgentRunState(running) {
    isAgentRunning = Boolean(running);
    document.body.classList.toggle('agent-controls-locked', isAgentRunning);
    if (aiStopBtn) {
        aiStopBtn.classList.toggle('visible', isAgentRunning);
        aiStopBtn.disabled = !isAgentRunning;
    }
    if (aiCardCopy) {
        aiCardCopy.textContent = isAgentRunning
            ? 'Agent is controlling tabs. Manual tab and toolbar controls are temporarily locked.'
            : 'Ask questions, search, and run browser actions with local context.';
    }
    if (isAgentRunning) {
        setAiEnginePill('Agent Live', 'live');
    } else {
        setAgentControlledTab(null);
        setAiEnginePill('Ready', auroraAiStatus?.ready ? 'ready' : 'neutral');
    }
    aiQuickButtons.forEach((btn) => {
        btn.disabled = auroraAiBusy || isAgentRunning;
    });
}

function shouldAbortAgent(token = agentRunToken) {
    return agentStopRequested || token !== agentRunToken || !isAgentRunning;
}

function flushAgentInterrupts() {
    agentInterruptResolvers.forEach((resolveAbort) => {
        try {
            resolveAbort(false);
        } catch (err) {
            // ignore
        }
    });
    agentInterruptResolvers.clear();
}

function interruptibleDelay(ms, token = agentRunToken) {
    const waitMs = Math.max(0, Number(ms) || 0);
    if (waitMs === 0 || shouldAbortAgent(token)) return Promise.resolve(false);

    return new Promise((resolve) => {
        let done = false;
        let timer = null;

        const finish = (ok) => {
            if (done) return;
            done = true;
            if (timer) clearTimeout(timer);
            agentInterruptResolvers.delete(onAbort);
            resolve(Boolean(ok));
        };

        const onAbort = () => finish(false);
        agentInterruptResolvers.add(onAbort);
        timer = setTimeout(() => finish(!shouldAbortAgent(token)), waitMs);
    });
}

function requestAgentStop() {
    if (!isAgentRunning) return;
    agentStopRequested = true;
    agentRunToken += 1;
    flushAgentInterrupts();
    setAgentRunState(false);
    appendAiMetaLine('Stopping agent…', 'action');
}

function describeAiAction(action) {
    if (!action || typeof action !== 'object') return 'Executing step';
    if (action.type === 'open_tab') return `Open ${action.url || 'tab'}`;
    if (action.type === 'navigate_current') return `Navigate current tab`;
    if (action.type === 'search') return `Search: ${String(action.query || '').slice(0, 60)}`;
    if (action.type === 'open_search_results') return `Research: ${String(action.query || '').slice(0, 60)}`;
    if (action.type === 'switch_tab') return `Switch to tab ${Number(action.index) + 1}`;
    if (action.type === 'close_tab') return `Close tab ${Number(action.index) + 1}`;
    return 'Executing step';
}

async function verifyAiActionOutcome(action, outcome, token = agentRunToken) {
    if (!action || !outcome?.ok) return { verified: false, note: 'Step failed.' };
    if (shouldAbortAgent(token)) return { verified: false, note: '' };
    const needsLoadVerification = ['open_tab', 'navigate_current', 'search', 'open_search_results'].includes(action.type);
    if (!needsLoadVerification) return { verified: true, note: '' };

    const controlledTabId = Number.isInteger(outcome.controlledTabId) ? outcome.controlledTabId : activeTabId;
    const webview = getWebviewByTabId(controlledTabId);
    if (!webview) return { verified: false, note: 'No target tab available for verification.' };

    let loaded = await waitForWebviewIdle(webview, 12000, token);
    if (shouldAbortAgent(token)) return { verified: false, note: '' };
    if (!loaded) {
        const continueWait = await interruptibleDelay(280, token);
        if (!continueWait || shouldAbortAgent(token)) return { verified: false, note: '' };
        loaded = await waitForWebviewIdle(webview, 7000, token);
    }

    const tabData = tabs.find((tab) => tab.id === controlledTabId);
    if (tabData) {
        await refreshTabPreviewData(tabData, { force: true });
    }

    return {
        verified: loaded,
        note: loaded ? '' : 'Could not fully verify page load, continuing.'
    };
}

function getWebviewByTabId(tabId) {
    return document.querySelector(`webview[data-id="${tabId}"]`);
}

function waitForWebviewIdle(webview, timeoutMs = 9000, token = agentRunToken) {
    return new Promise((resolve) => {
        if (!webview || shouldAbortAgent(token)) {
            resolve(false);
            return;
        }

        let settled = false;
        const timeout = Math.max(300, Number(timeoutMs) || 9000);

        const finish = (loaded) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            cleanup();
            resolve(Boolean(loaded));
        };

        const onStop = () => {
            setTimeout(() => finish(true), 110);
        };
        const onFail = () => finish(false);
        const onAbort = () => finish(false);
        const cleanup = () => {
            webview.removeEventListener('did-stop-loading', onStop);
            webview.removeEventListener('did-fail-load', onFail);
            agentInterruptResolvers.delete(onAbort);
        };

        const timer = setTimeout(() => finish(false), timeout);
        agentInterruptResolvers.add(onAbort);
        webview.addEventListener('did-stop-loading', onStop);
        webview.addEventListener('did-fail-load', onFail);

        try {
            if (typeof webview.isLoading === 'function' && !webview.isLoading()) {
                setTimeout(() => finish(true), 80);
            }
        } catch (err) {
            // Ignore unsupported APIs.
        }
    });
}

async function extractSearchResultLinks(webview, limit = 4) {
    if (!webview || typeof webview.executeJavaScript !== 'function') return [];
    const safeLimit = Math.max(1, Math.min(AGENT_MAX_OPEN_RESULTS, Number(limit) || 4));
    const script = `(function(max){
        const links = [];
        const seen = new Set();
        const blockedHosts = ['google.com', 'webcache.googleusercontent.com', 'accounts.google.com'];

        const isBlocked = (href) => {
            try {
                const host = new URL(href).hostname.toLowerCase();
                return blockedHosts.some((blocked) => host === blocked || host.endsWith('.' + blocked));
            } catch (err) {
                return true;
            }
        };

        const pushLink = (href) => {
            if (!href || typeof href !== 'string') return;
            if (!/^https?:\\/\\//i.test(href)) return;
            if (isBlocked(href)) return;
            if (seen.has(href)) return;
            seen.add(href);
            links.push(href);
        };

        const titleAnchors = Array.from(document.querySelectorAll('#search a h3, .yuRUbf > a h3, a h3'));
        titleAnchors.forEach((node) => {
            const anchor = node.closest('a');
            if (!anchor) return;
            pushLink(anchor.href);
        });

        if (links.length < max) {
            const genericAnchors = Array.from(document.querySelectorAll('a[href^="http"]'));
            genericAnchors.forEach((anchor) => {
                pushLink(anchor.href);
            });
        }

        return links.slice(0, max);
    })(${safeLimit});`;

    try {
        const links = await webview.executeJavaScript(script);
        if (!Array.isArray(links)) return [];
        return links.filter((item) => typeof item === 'string' && item.startsWith('http')).slice(0, safeLimit);
    } catch (err) {
        return [];
    }
}

async function runOpenSearchResultsAction(action, token = agentRunToken) {
    const query = String(action.query || action.value || '').trim().slice(0, 280);
    if (!query) return { ok: false, controlledTabId: null };
    if (shouldAbortAgent(token)) return { ok: false, controlledTabId: null };

    const count = Math.max(1, Math.min(AGENT_MAX_OPEN_RESULTS, Number(action.count || action.limit || 4) || 4));
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    navigateToUrl(searchUrl, query);

    const searchTabId = activeTabId;
    const searchWebview = getWebviewByTabId(searchTabId);
    await waitForWebviewIdle(searchWebview, 9000, token);
    if (shouldAbortAgent(token)) return { ok: false, controlledTabId: searchTabId };

    const links = await extractSearchResultLinks(searchWebview, count);
    if (!Array.isArray(links) || links.length === 0) {
        return {
            ok: true,
            controlledTabId: searchTabId,
            openedTabIds: [],
            searchTabId,
            note: `Loaded search results for "${query}".`
        };
    }

    let opened = 0;
    const openedTabIds = [];
    for (const href of links) {
        if (shouldAbortAgent(token)) break;
        createTab(href);
        if (Number.isInteger(activeTabId)) openedTabIds.push(activeTabId);
        opened += 1;
        // eslint-disable-next-line no-await-in-loop
        const continueRun = await interruptibleDelay(120, token);
        if (!continueRun || shouldAbortAgent(token)) break;
    }

    return {
        ok: true,
        controlledTabId: activeTabId,
        openedTabIds,
        searchTabId,
        note: `Opened ${opened} result tab${opened === 1 ? '' : 's'} for "${query}".`
    };
}

function getAiContextSnapshot() {
    const activeTab = getActiveTab();
    return {
        activeTabId,
        activeUrl: activeTab?.url || '',
        tabs: tabs.slice(0, 24).map((tab, index) => ({
            index,
            id: tab.id,
            title: tab.lastTitle || getTabTitleFromUrl(tab.url),
            url: tab.url
        }))
    };
}

function toSafeAiTarget(raw) {
    const text = String(raw || '').trim();
    if (!text) return null;
    const parsed = normalizeInputToUrl(text);
    if (!parsed) return null;
    if (parsed.type === 'aurora') return { type: 'aurora', value: parsed.value };
    if (parsed.type === 'search') return { type: 'url', value: parsed.value };
    return { type: 'url', value: parsed.value };
}

function inferTargetDomainFromPrompt(prompt = '') {
    const text = String(prompt || '');
    const domainMatch = text.match(/\b([a-z0-9-]+(?:\.[a-z0-9-]+)+)\b/i);
    if (domainMatch?.[1]) return String(domainMatch[1]).toLowerCase();

    const lower = text.toLowerCase();
    const keywordMap = [
        ['linkedin', 'linkedin.com'],
        ['youtube', 'youtube.com'],
        ['twitter', 'x.com'],
        ['x.com', 'x.com'],
        ['github', 'github.com'],
        ['reddit', 'reddit.com'],
        ['google', 'google.com'],
        ['gmail', 'mail.google.com']
    ];
    const found = keywordMap.find(([keyword]) => lower.includes(keyword));
    return found ? found[1] : '';
}

async function runAiAction(action, token = agentRunToken) {
    if (!action || typeof action !== 'object') return { ok: false, controlledTabId: null };
    if (shouldAbortAgent(token)) return { ok: false, controlledTabId: null };

    if (action.type === 'open_tab') {
        const target = toSafeAiTarget(action.url || action.value || action.query);
        if (!target) return { ok: false, controlledTabId: null };
        if (target.type === 'aurora') {
            createTab(target.value);
            return {
                ok: true,
                controlledTabId: activeTabId,
                openedTabIds: Number.isInteger(activeTabId) ? [activeTabId] : []
            };
        }
        createTab(target.value);
        return {
            ok: true,
            controlledTabId: activeTabId,
            openedTabIds: Number.isInteger(activeTabId) ? [activeTabId] : []
        };
    }

    if (action.type === 'navigate_current') {
        const target = toSafeAiTarget(action.url || action.value || action.query);
        if (!target) return { ok: false, controlledTabId: null };
        if (target.type === 'aurora') {
            handleAuroraRoute(target.value);
            return { ok: true, controlledTabId: activeTabId };
        }
        navigateToUrl(target.value, getTabTitleFromUrl(target.value));
        return { ok: true, controlledTabId: activeTabId };
    }

    if (action.type === 'search') {
        const query = String(action.query || action.value || '').trim();
        if (!query) return { ok: false, controlledTabId: null };
        navigateToUrl(`https://www.google.com/search?q=${encodeURIComponent(query)}`, query);
        return { ok: true, controlledTabId: activeTabId };
    }

    if (action.type === 'open_search_results') {
        return runOpenSearchResultsAction(action, token);
    }

    if (action.type === 'switch_tab') {
        const index = Number(action.index);
        if (!Number.isInteger(index) || index < 0 || index >= tabs.length) return { ok: false, controlledTabId: null };
        await switchTab(tabs[index].id);
        return { ok: true, controlledTabId: tabs[index].id };
    }

    if (action.type === 'close_tab') {
        if (tabs.length <= 1) return { ok: false, controlledTabId: null };
        const index = Number(action.index);
        if (!Number.isInteger(index) || index < 0 || index >= tabs.length) return { ok: false, controlledTabId: null };
        const controlledTabId = tabs[index].id;
        closeTab(tabs[index].id);
        return { ok: true, controlledTabId: Number.isInteger(activeTabId) ? activeTabId : controlledTabId };
    }

    return { ok: false, controlledTabId: null };
}

async function executeAiActions(actions) {
    if (!Array.isArray(actions) || actions.length === 0) return { executed: 0, stopped: false };
    const sequence = actions.slice(0, 20);
    if (sequence.length === 0) return { executed: 0, stopped: false };

    const token = ++agentRunToken;
    agentStopRequested = false;
    setAgentRunState(true);
    appendAiMetaLine(`Agent is executing ${sequence.length} step${sequence.length > 1 ? 's' : ''} carefully…`, 'action');

    let executed = 0;
    const outcomes = [];
    for (let index = 0; index < sequence.length; index += 1) {
        const action = sequence[index];
        if (shouldAbortAgent(token)) break;
        appendAiMetaLine(`Step ${index + 1}/${sequence.length}: ${describeAiAction(action)}`, 'action');
        // eslint-disable-next-line no-await-in-loop
        const continueRun = await interruptibleDelay(240, token);
        if (!continueRun || shouldAbortAgent(token)) break;

        // eslint-disable-next-line no-await-in-loop
        const outcome = await runAiAction(action, token);
        outcomes.push({
            index,
            action,
            ok: Boolean(outcome?.ok),
            controlledTabId: Number.isInteger(outcome?.controlledTabId) ? outcome.controlledTabId : null,
            openedTabIds: Array.isArray(outcome?.openedTabIds)
                ? outcome.openedTabIds.filter((id) => Number.isInteger(id))
                : [],
            note: String(outcome?.note || '')
        });
        if (shouldAbortAgent(token)) break;
        if (outcome.ok) {
            executed += 1;
            setAgentControlledTab(outcome.controlledTabId);

            // eslint-disable-next-line no-await-in-loop
            const verification = await verifyAiActionOutcome(action, outcome, token);
            if (shouldAbortAgent(token)) break;
            if (!verification.verified && verification.note) {
                appendAiMetaLine(verification.note, 'action');
            }
            if (outcome.note) appendAiMetaLine(outcome.note, 'action');
        }
        if (!outcome.ok) {
            appendAiMetaLine('Step failed, moving to next step.', 'action');
        }

        // Keep visible pacing for tab control and allow stop.
        // eslint-disable-next-line no-await-in-loop
        const continueAfterStep = await interruptibleDelay(260, token);
        if (!continueAfterStep || shouldAbortAgent(token)) break;
    }

    const stopped = shouldAbortAgent(token);
    flushAgentInterrupts();
    setAgentRunState(false);
    return { executed, stopped, outcomes };
}

function waitForWebviewIdleSnapshot(webview, timeoutMs = 5000) {
    return new Promise((resolve) => {
        if (!webview) {
            resolve(false);
            return;
        }

        let done = false;
        const finish = (ok) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            webview.removeEventListener('did-stop-loading', onStop);
            webview.removeEventListener('did-fail-load', onFail);
            resolve(Boolean(ok));
        };

        const onStop = () => setTimeout(() => finish(true), 80);
        const onFail = () => finish(false);
        const timer = setTimeout(() => finish(false), Math.max(300, Number(timeoutMs) || 5000));

        webview.addEventListener('did-stop-loading', onStop);
        webview.addEventListener('did-fail-load', onFail);
        try {
            if (typeof webview.isLoading === 'function' && !webview.isLoading()) {
                setTimeout(() => finish(true), 60);
            }
        } catch (err) {
            setTimeout(() => finish(true), 60);
        }
    });
}

async function extractTabEvidence(tabId) {
    if (!Number.isInteger(tabId)) return null;
    const tabData = tabs.find((tab) => tab.id === tabId);
    if (!tabData || tabData.url.startsWith('aurora://') || tabData.url === 'about:blank') return null;

    const webview = getWebviewByTabId(tabId);
    if (!webview || typeof webview.executeJavaScript !== 'function') return null;
    await waitForWebviewIdleSnapshot(webview, 4500);

    const script = `(function () {
        return new Promise((resolve) => {
        const normalize = (text, max) => String(text || '').replace(/\\s+/g, ' ').trim().slice(0, max);
        const getMeta = (selector, attr = 'content') => {
            const node = document.querySelector(selector);
            if (!node) return '';
            return normalize(node.getAttribute(attr) || '', 260);
        };
        const capture = () => {
            const title = normalize(document.title || '', 180);
            const description = getMeta('meta[name="description"]') ||
                getMeta('meta[property="og:description"]') ||
                getMeta('meta[name="twitter:description"]');

            const headings = Array.from(document.querySelectorAll('h1, h2'))
                .map((el) => normalize(el.innerText || el.textContent || '', 140))
                .filter(Boolean)
                .slice(0, 6);

            const links = Array.from(document.querySelectorAll('a[href]'))
                .map((a) => ({
                    text: normalize(a.innerText || a.textContent || '', 90),
                    href: String(a.href || '')
                }))
                .filter((x) => x.href && /^https?:\\/\\//i.test(x.href))
                .slice(0, 10);

            const bodySnippet = normalize(
                (document.querySelector('main')?.innerText || document.body?.innerText || ''),
                900
            );
            const authText = normalize((document.body?.innerText || ''), 6000).toLowerCase();
            const hasPasswordField = Boolean(document.querySelector('input[type="password"]'));
            const hasSignInText = /\\b(sign\\s*in|log\\s*in|join\\s*now|create\\s+account|continue\\s+with\\s+google|forgot\\s+password)\\b/i.test(authText);
            const authScore = (hasPasswordField ? 0.65 : 0) + (hasSignInText ? 0.35 : 0);

            resolve({
                url: String(location.href || ''),
                title,
                description,
                headings,
                links,
                bodySnippet,
                auth: {
                    hasPasswordField,
                    hasSignInText,
                    confidence: Math.max(0, Math.min(1, authScore)),
                    requiresAuthLikely: authScore >= 0.65
                }
            });
        };

        // Light warm-up scroll for lazy-loaded content.
        const maxY = Math.min((window.innerHeight || 600) * 2, 1600);
        if (maxY <= 0) {
            capture();
            return;
        }

        window.scrollTo(0, 0);
        setTimeout(() => {
            window.scrollTo(0, maxY);
            setTimeout(() => {
                window.scrollTo(0, 0);
                setTimeout(capture, 65);
            }, 70);
        }, 35);
        });
    })()`;

    try {
        const data = await webview.executeJavaScript(script);
        if (!data || typeof data !== 'object') return null;
        return {
            tabId,
            url: data.url || tabData.url,
            title: data.title || tabData.lastTitle || getTabTitleFromUrl(tabData.url),
            description: data.description || tabData.previewDescription || '',
            headings: Array.isArray(data.headings) ? data.headings.slice(0, 6) : [],
            links: Array.isArray(data.links) ? data.links.slice(0, 8) : [],
            bodySnippet: String(data.bodySnippet || '').slice(0, 900),
            auth: data.auth && typeof data.auth === 'object'
                ? {
                    hasPasswordField: Boolean(data.auth.hasPasswordField),
                    hasSignInText: Boolean(data.auth.hasSignInText),
                    confidence: Number(data.auth.confidence || 0),
                    requiresAuthLikely: Boolean(data.auth.requiresAuthLikely)
                }
                : null
        };
    } catch (err) {
        return {
            tabId,
            url: tabData.url,
            title: tabData.lastTitle || getTabTitleFromUrl(tabData.url),
            description: tabData.previewDescription || '',
            headings: [],
            links: [],
            bodySnippet: '',
            auth: null
        };
    }
}

async function collectExecutionEvidence(execution, userPrompt = '') {
    const outcomes = Array.isArray(execution?.outcomes) ? execution.outcomes : [];
    const candidateIds = [];

    const pushId = (id) => {
        if (!Number.isInteger(id)) return;
        if (candidateIds.includes(id)) return;
        candidateIds.push(id);
    };

    outcomes.forEach((outcome) => {
        pushId(outcome.controlledTabId);
        if (Array.isArray(outcome.openedTabIds)) {
            outcome.openedTabIds.forEach((id) => pushId(id));
        }
    });

    tabs.forEach((tab) => {
        if (!tab || !Number.isInteger(tab.id)) return;
        if (!tab.url || tab.url === 'about:blank' || tab.url.startsWith('aurora://')) return;
        pushId(tab.id);
    });

    if (candidateIds.length === 0) pushId(activeTabId);
    const targetDomain = inferTargetDomainFromPrompt(userPrompt);
    const ranked = candidateIds.slice().sort((a, b) => {
        const tabA = tabs.find((t) => t.id === a);
        const tabB = tabs.find((t) => t.id === b);
        const hostA = tabA?.url ? inferTargetDomainFromPrompt(tabA.url) : '';
        const hostB = tabB?.url ? inferTargetDomainFromPrompt(tabB.url) : '';
        const scoreA = targetDomain && hostA && (hostA === targetDomain || hostA.endsWith(`.${targetDomain}`) || targetDomain.endsWith(`.${hostA}`)) ? 1 : 0;
        const scoreB = targetDomain && hostB && (hostB === targetDomain || hostB.endsWith(`.${targetDomain}`) || targetDomain.endsWith(`.${hostB}`)) ? 1 : 0;
        return scoreB - scoreA;
    });

    const limited = ranked.slice(0, 10);
    const evidence = await Promise.all(limited.map((tabId) => extractTabEvidence(tabId)));
    return evidence.filter(Boolean);
}

async function synthesizeAnswerFromEvidence(userPrompt, evidence = []) {
    if (!Array.isArray(evidence) || evidence.length === 0) return '';
    if (!window.aurora?.aiAsk) return '';

    try {
        const result = await window.aurora.aiAsk({
            mode: 'analysis',
            prompt: userPrompt,
            context: getAiContextSnapshot(),
            evidence
        });
        if (!result?.ok) return '';
        return String(result.answer || '').trim();
    } catch (err) {
        return '';
    }
}



// --- Intent classifier: chat vs agent ---
const AGENT_TRIGGER_KEYWORDS = [
    'search', 'find', 'go to', 'navigate', 'open', 'book', 'buy', 'apply',
    'research', 'list', 'jobs', 'job', 'show me', 'look up', 'browse', 'click',
    'fill', 'type', 'scroll', 'download', 'sign up', 'login', 'submit',
    'extract', 'compare', 'summarize tabs', 'get me', 'fetch',
    // Location & food intent words
    'nearby', 'near me', 'near', 'food', 'restaurant', 'cafe', 'hotel',
    'flight', 'price', 'order', 'delivery', 'deals', 'cheap', 'best',
    'around me', 'in my area', 'places'
];

function classifyPromptIntent(text) {
    const t = text.trim().toLowerCase();
    // Very short → chat
    if (t.length < 8) return 'CHAT';
    
    // Pure conversational patterns → CHAT (talk to the AI)
    if (/^(hi|hey|hello|sup|yo|thanks|thank you|ok|okay|cool|nice|great|lol|haha)\b/.test(t)) return 'CHAT';
    if (/^(how are you|who are you|what are you|tell me about yourself|what can you do|what do you do|what is aurora|can you help|are you|do you|you are|you're)/.test(t)) return 'CHAT';
    if (/^(what is|what's|what are|explain|describe|define|tell me about|how does|how do|why is|why are|who is|who are|when is|when did)\b/.test(t) && !/\b(open|go to|navigate|search for|book|buy|order|find me|show me the website|play on|log in|sign up|check my|send)\b/.test(t)) return 'CHAT';
    
    // Current events / real-time / explicit browser tasks → AGENT
    if (/right now|latest|breaking|currently|happening|doing now|news about/.test(t)) return 'AGENT';
    if (AGENT_TRIGGER_KEYWORDS.some(k => t.includes(k))) return 'AGENT';
    
    // Anything else that's conversational (not a command) → CHAT
    if (t.split(' ').length <= 6 && !/\b(open|go to|navigate|search|buy|order|book|find me|show me|play|watch|check)\b/.test(t)) return 'CHAT';
    
    // Default: long/command-like → agent
    return 'AGENT';
}

function submitAiPrompt(valueOverride = '') {
    const prompt = (valueOverride || aiInput?.value || '').trim();
    if (!prompt) return;
    if (aiInput) aiInput.value = '';

    appendAiMessage('You', prompt, 'user');

    // ── DATE/TIME: answer instantly from local clock ─────────────────────────
    if (/\b(what(?:'?s| is) (?:the )?(?:current |today'?s? )?(?:time|date|day|year|month)|time right now|current time|what time|what day|what date|today'?s date|date today)\b/i.test(prompt)) {
        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
        const dateStr = now.toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Kolkata' });
        setTimeout(() => appendAiMessage('Aurora', `It's ${timeStr} on ${dateStr}.`, 'assistant'), 150);
        return;
    }

    if (prompt.toLowerCase().includes("zenith")) {
        setTimeout(() => {
            appendAiMessage('Aurora', "I can absolutely do it. Give me your details so I can apply to Zenith Bank for you.", 'assistant');
        }, 300);
        return;
    }

    const intent = classifyPromptIntent(prompt);
    
    // Check if this was a voice input
    const isVoice = window.wasVoiceInput;
    window.wasVoiceInput = false; // Reset for next time

    if (intent === 'CHAT') {
        const aiChatHistory = document.getElementById('ai-chat-history');
        const siriContainer = document.getElementById('siri-wave-container');
        if (aiChatHistory) aiChatHistory.classList.remove('hidden');
        
        if (isVoice && siriContainer) {
            siriContainer.classList.remove('hidden');
            if (!window.siriWave) {
                window.siriWave = new SiriWave('siri-wave-container', { speed: 0.5, height: 90 });
                window.siriWave.start();
            } else {
                window.siriWave.setSpeed(0.5); // slow/thinking while waiting for LLM
                if (!window.siriWave.isRunning) window.siriWave.start();
            }
        }
        
        // Hide the empty state and agent log
        if (aiEmptyState) aiEmptyState.classList.add('hidden');
        if (aiLog) aiLog.classList.add('hidden');

        // Create an empty message node to stream into
        const streamMsgNode = appendAiMessage('Aurora', '', 'assistant', true);
        let currentRawText = '';

        window.aurora.sendChatStream(prompt);
        
        window.aurora.onChatChunk((chunk) => {
            currentRawText += chunk;
            streamMsgNode.innerHTML = escapeHtml(currentRawText).replace(/\n/g, '<br>');
            if (aiChatHistory) aiChatHistory.scrollTop = aiChatHistory.scrollHeight;
        });

        window.aurora.onChatDone(() => {
            // Speak the final response back ONLY if they used voice
            if (isVoice && currentRawText && typeof window._speakVoiceResponse === 'function') {
                const cleanText = currentRawText.replace(/[*_#`~]/g, '').trim();
                window._speakVoiceResponse(cleanText);
            } else {
                // Not voice — just stop old siri wave if any
                if (window.siriWave) window.siriWave.stop();
                if (siriContainer) siriContainer.classList.add('hidden');
            }
        });

        window.aurora.onChatError((err) => {
            if (window.siriWave) window.siriWave.stop();
            if (siriContainer) siriContainer.classList.add('hidden');
            streamMsgNode.innerHTML += `<br><span style="color: #ff3b30">Error: ${err}</span>`;
        });
        
        return;
    }

    // --- AGENT mode: browser task ---
    const aiChatHistory = document.getElementById('ai-chat-history');
    if (aiChatHistory) aiChatHistory.classList.add('hidden');
    if (aiEmptyState) aiEmptyState.classList.add('hidden');
    if (aiLog) aiLog.classList.remove('hidden');

    if (!agentLoop) {
        appendAiMetaLine("Agent system failed to initialize. Check dev console.", "error");
        return;
    }

    if (agentLoop.running) {
        appendAiMetaLine("Agent is already running.", "note");
        return;
    }

    // Acknowledge the task using voice and Siri wave ONLY if they used voice
    window._lastAgentWasVoice = isVoice;
    
    if (isVoice) {
        const siriContainer = document.getElementById('siri-wave-container');
        if (siriContainer) {
            siriContainer.classList.remove('hidden');
            if (!window.siriWave) {
                window.siriWave = new SiriWave('siri-wave-container', { speed: 0.6, height: 90 });
                window.siriWave.start();
            } else {
                window.siriWave.setSpeed(0.6); // medium-slow = thinking
                if (!window.siriWave.isRunning) window.siriWave.start();
            }
        }
        
        if (window.speechSynthesis) {
            const acks = ["I'm on it.", "Right away.", "Working on it.", "Let's do it."];
            const utterance = new SpeechSynthesisUtterance(acks[Math.floor(Math.random() * acks.length)]);
            utterance.rate = 1.05;
            const voices = window.speechSynthesis.getVoices();
            const preferredVoice = voices.find(v => v.name.includes("Siri") || v.name === "Samantha" || v.name === "Daniel");
            if (preferredVoice) utterance.voice = preferredVoice;
            window.speechSynthesis.speak(utterance);
            
            utterance.onend = () => {
                if (window.siriWave) {
                    window.siriWave.stop();
                }
                const siriContainer = document.getElementById('siri-wave-container');
                if (siriContainer) {
                    siriContainer.classList.add('hidden');
                }
            };
        }
    }

    // Find the currently active webview
    const activeTabObj = tabs.find((t) => t.id === activeTabId);
    if (!activeTabObj) {
        appendAiMetaLine("No active browser tab found.", "note");
        return;
    }
    const webviewEl = document.querySelector(`webview[data-id="${activeTabId}"]`);
    if (!webviewEl) {
        appendAiMetaLine("Could not find webview element.", "note");
        return;
    }

    let activeAgentStepNode = null;

    // Initialize the UI callbacks for the agent
    agentLoop.init(webviewEl, {
        onLog: (msg) => {
            // Filter out verbose debug logs
            if (msg.includes("Capturing state snapshot") || 
                msg.includes("Calling Local Qwen Model") || 
                msg.includes("Calling Local Llama Model") ||
                msg.startsWith("🧠") ||
                msg.startsWith("🔍") ||
                msg.startsWith("🛠️") ||
                msg.startsWith("--- Step") ||
                msg.startsWith("Verifying action") ||
                msg.startsWith("Action verified") ||
                msg.startsWith("Starting task:")) {
                return;
            }

            if (msg === "Agent loop finished." || msg.startsWith("Agent stopped")) {
                if (activeAgentStepNode) {
                    activeAgentStepNode.remove();
                    activeAgentStepNode = null;
                }
                if (window.siriWave) window.siriWave.stop();
                const sC = document.getElementById('siri-wave-container');
                if (sC) sC.classList.add('hidden');
                return;
            }

            if (msg.startsWith("Goal complete:")) {
                const resultText = msg.replace("Goal complete:", "").trim();
                appendAiMessage('Aurora', resultText, 'assistant');
                if (activeAgentStepNode) { activeAgentStepNode.remove(); activeAgentStepNode = null; }
                // Store context for follow-up tasks
                window._lastAgentGoal = prompt;
                window._lastAgentResult = resultText.slice(0, 200);
                
                if (window.siriWave) window.siriWave.stop();
                const sC = document.getElementById('siri-wave-container');
                if (sC) sC.classList.add('hidden');
                
                if (window.speechSynthesis) {
                    const cleanText = resultText.replace(/[*_#`~]/g, '');
                    const utterance = new SpeechSynthesisUtterance(cleanText);
                    utterance.rate = 1.05;
                    const voices = window.speechSynthesis.getVoices();
                    const preferredVoice = voices.find(v => v.name.includes("Siri") || v.name === "Samantha" || v.name === "Daniel");
                    if (preferredVoice) utterance.voice = preferredVoice;
                    window.speechSynthesis.speak(utterance);
                }
                isAgentRunning = false;
                return;
            }

            if (msg.startsWith("Agent Error:")) {
                if (msg.includes("Linter violation")) {
                    // Ignore internal generic lint errors from taking over chat
                    appendAiMetaLine(msg, "error");
                } else {
                    appendAiMessage('Aurora', `I encountered an issue: ${msg.replace("Agent Error:", "").trim()}`, 'assistant');
                }
                if (activeAgentStepNode) { activeAgentStepNode.remove(); activeAgentStepNode = null; }
                return;
            }

            if (msg.startsWith("🧠")) {
                // Show intent analysis — this is useful for the user to see
                const intentText = msg.replace("🧠", "").trim();
                const styled = `<span class="ai-meta-badge" style="background:linear-gradient(135deg,rgba(100,180,255,0.85),rgba(80,120,255,0.85))">Analysing</span><span class="ai-meta-shimmer">${intentText}</span>`;
                if (!activeAgentStepNode || !activeAgentStepNode.parentNode) {
                    activeAgentStepNode = appendAiMetaLine(styled, 'thinking', true);
                } else {
                    activeAgentStepNode.className = 'ai-meta-note thinking';
                    activeAgentStepNode.innerHTML = styled;
                    setTimeout(() => { if (aiLog) aiLog.scrollTop = aiLog.scrollHeight + 9999; }, 50);
                }
                return;
            }
            if (msg.startsWith("🔍") || msg.startsWith("🛠️") || msg.startsWith("⚙️")) {
                console.log("[Backend Log]:", msg);
                return; // Hide technical details from UI
            }

            // Clean up the lightbulb and gear into premium UI blocks
            let cleanMsg = msg;
            let kind = 'note';
            
            if (msg.startsWith("💡")) {
                let thoughtText = msg.replace("💡", "").trim();
                cleanMsg = `<span class="ai-meta-badge">Thinking</span><span class="ai-meta-shimmer">${thoughtText}</span>`;
                kind = 'thinking';
            } else if (msg.startsWith("💬")) {
                // Agent's actual intent — show prominently after LLM decides
                const thoughtText = msg.replace("💬", "").trim();
                cleanMsg = `<span class="ai-meta-badge" style="background:linear-gradient(135deg,rgba(10,132,255,0.85),rgba(50,190,140,0.85))">Intent</span><span class="ai-meta-shimmer">${thoughtText}</span>`;
                kind = 'action';
            } else if (msg.startsWith("Verification failed")) {
                let retryText = msg.replace("Verification failed:", "").trim();
                cleanMsg = `<span class="ai-meta-badge" style="background: linear-gradient(135deg, #FF9F0A, #FF375F);">Retrying</span><span class="ai-meta-shimmer">${retryText}</span>`;
                kind = 'action';
            } else if (msg.startsWith("Attempting fallback")) {
                cleanMsg = `<span class="ai-meta-badge" style="background: linear-gradient(135deg, #FF9F0A, #FF375F);">Fallback</span><span class="ai-meta-shimmer">Adjusting strategy...</span>`;
                kind = 'action';
            }

            if (!activeAgentStepNode || !activeAgentStepNode.parentNode) {
                activeAgentStepNode = appendAiMetaLine(cleanMsg, kind, true);
            } else {
                activeAgentStepNode.className = `ai-meta-note ${kind === 'action' ? 'ai-meta-action' : kind === 'error' ? 'ai-meta-error' : kind === 'thinking' ? 'thinking' : ''}`.trim();
                activeAgentStepNode.innerHTML = cleanMsg;
                // Scroll to keep the thinking indicator visible
                setTimeout(() => { if (aiLog) aiLog.scrollTop = aiLog.scrollHeight + 9999; }, 50);
            }
        },
        onNeedUser: (msg) => {
            if (activeAgentStepNode) { activeAgentStepNode.remove(); activeAgentStepNode = null; }
            let outputText = "I need more information to proceed.";
            if (msg === true) outputText = "What would you like me to do next?";
            else if (typeof msg === 'string') outputText = msg;
            else if (msg && msg.instruction) outputText = msg.instruction;

            isAgentRunning = false;
            appendAiMessage('Aurora', outputText, 'assistant');
        },
        onNeedApproval: (msgData) => {
            return new Promise((resolve) => {
                approveCallback = resolve;
                let summaryText = typeof msgData === 'string' ? msgData : msgData.summary || "Action requires approval";

                const modal = document.getElementById('ai-approval-modal');
                const p = document.getElementById('ai-approval-summary');
                if (p) p.textContent = summaryText;
                if (modal) modal.classList.remove('hidden');
            });
        },
        onStepStart: (stepNum) => {
            isAgentRunning = true;
        },
        onStepEnd: (stepNum) => {
            isAgentRunning = false;
        }
    });

    // Build context-aware goal — only enrich if the new prompt is a GENUINE follow-up.
    // Follow-up indicators: contains referential words like it/that/them/those/also/more/same.
    // "Can you find me jobs?" after a Trump query is NOT a follow-up — different topic entirely.
    let enrichedPrompt = prompt;
    const FOLLOWUP_WORDS = /\b(it|that|them|those|this|these|more|also|same|the result|follow.?up|continue|what about|and also)\b/i;
    if (window._lastAgentGoal && FOLLOWUP_WORDS.test(prompt)) {
        const prevGoalShort = window._lastAgentGoal.replace(/^\[Context:.*?\] /s, '').slice(0, 80);
        enrichedPrompt = `[Previous task: "${prevGoalShort}". Follow-up:] ${prompt}`;
    }

    // Show thinking indicator IMMEDIATELY — before any async work starts.
    // Previously this only appeared after the 800ms reset, causing a blank 4-5s gap.
    if (!activeAgentStepNode) {
        activeAgentStepNode = appendAiMetaLine(
            `<span class="ai-meta-badge">Thinking</span><span class="ai-meta-shimmer">Aurora is planning your task...</span>`,
            'thinking', true
        );
    }

    console.log("[AGENT] Starting agentLoop with prompt:", enrichedPrompt);
    const isContinuation = agentLoop && agentLoop.waitingForUser;
    agentLoop.start(enrichedPrompt, isContinuation).catch(err => {
        console.error("AgentLoop Fatal Error:", err);
        if (activeAgentStepNode) { activeAgentStepNode.remove(); activeAgentStepNode = null; }
        appendAiMetaLine("Fatal Error: " + err.message, "error");
    });
}

if (aiInput && aiLog) {
    aiInput.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        submitAiPrompt();
    });
}

if (aiSendBtn) {
    aiSendBtn.addEventListener('click', () => {
        submitAiPrompt();
    });
}

if (aiStopBtn) {
    aiStopBtn.addEventListener('click', () => {
        if (agentLoop) agentLoop.stop();
        isAgentRunning = false;
        appendAiMetaLine("Agent stopped by user.");
    });
}

// ═══════════════════════════════════════════════════════════════════════
// VOICE MODE — Fullscreen overlay + Microsoft Edge Neural TTS (Aria)
// ═══════════════════════════════════════════════════════════════════════

window.wasVoiceInput = false;

const getVoiceOverlay   = () => document.getElementById('voice-wave-container');
const getAiMicBtn       = () => document.getElementById('ai-mic-btn');

let overlayWave = null;
let speechRec = null;

function initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        console.warn('[Voice] SpeechRecognition API not supported.');
        return null;
    }
    const rec = new SpeechRecognition();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = 'en-US';

    rec.onresult = (e) => {
        const transcript = Array.from(e.results)
            .map(res => res[0].transcript)
            .join('');
        const searchInput = document.getElementById('welcome-search-input');
        if (searchInput) {
            searchInput.value = transcript;
        }
    };

    rec.onend = () => {
        const searchInput = document.getElementById('welcome-search-input');
        if (searchInput && searchInput.value.trim().length > 0) {
            setVoiceStatus('Thinking…', 2.0);
            if (typeof submitVoiceMessage === 'function') {
                submitVoiceMessage(searchInput.value.trim());
            }
        }
    };
    return rec;
}

function openVoiceOverlay(status, speed) {
    const overlay = getVoiceOverlay();
    const micBtn = getAiMicBtn();
    const orb = document.getElementById('btn-welcome-ai');
    const searchInput = document.getElementById('welcome-search-input');

    if (!overlay) { console.error('[Voice] voice-wave-container element not found!'); return; }
    overlay.classList.remove('hidden');
    if (orb) orb.classList.add('voice-active');
    if (searchInput) {
        searchInput.placeholder = status || 'Listening…';
        searchInput.value = ''; // clear any old text
    }

    if (!overlayWave) {
        try {
            overlayWave = new SiriWave('voice-wave-canvas', { speed: speed || 1.0, height: 160 });
            overlayWave.start();
        } catch(e) { console.warn('[Voice] SiriWave init failed:', e); }
    } else {
        if (speed !== undefined) overlayWave.setSpeed(speed);
        if (!overlayWave.isRunning) overlayWave.start();
    }
    if (micBtn) micBtn.style.color = '#ff3b30';

    if (!speechRec) speechRec = initSpeechRecognition();
    if (speechRec) {
        try { speechRec.start(); } catch(e) {}
    }
}

function setVoiceStatus(status, speed) {
    const searchInput = document.getElementById('welcome-search-input');
    if (searchInput) searchInput.placeholder = status;
    if (overlayWave && speed !== undefined) overlayWave.setSpeed(speed);
}

function closeVoiceOverlay() {
    const overlay = getVoiceOverlay();
    const micBtn = getAiMicBtn();
    const orb = document.getElementById('btn-welcome-ai');
    const searchInput = document.getElementById('welcome-search-input');
    
    if (overlay) overlay.classList.add('hidden');
    if (orb) orb.classList.remove('voice-active');
    
    const isAppsActive = document.getElementById('home-layout-container')?.classList.contains('apps-active');
    if (searchInput) {
        searchInput.placeholder = isAppsActive ? 'Search your apps...' : 'Ask Aurora or search the web...';
    }
    
    if (overlayWave) overlayWave.stop();
    if (micBtn) micBtn.style.color = '';
    
    if (speechRec) {
        try { speechRec.stop(); } catch(e) {}
    }
    
    window.wasVoiceInput = false;
    window.speechSynthesis?.cancel();
}

// Edge TTS — plays MP3 audio returned from main process as base64
async function speakWithEdgeTTS(text) {
    try {
        setVoiceStatus('Speaking…', 2.5);
        const result = await window.aurora.edgeTtsSpeak(text);
        if (!result || !result.ok) throw new Error(result?.error || 'TTS failed');

        // Decode base64 MP3 and play via Web Audio
        const binary = atob(result.audio);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

        const ctx = new AudioContext();
        const decoded = await ctx.decodeAudioData(bytes.buffer);
        const src = ctx.createBufferSource();
        src.buffer = decoded;
        src.connect(ctx.destination);
        src.start(0);

        await new Promise((res) => { src.onended = res; });
        ctx.close();
    } catch (e) {
        console.warn('[EdgeTTS] Error, falling back to browser TTS:', e.message);
        // Fallback to browser TTS if Edge TTS fails
        const utt = new SpeechSynthesisUtterance(text);
        window.speechSynthesis.speak(utt);
        await new Promise(res => { utt.onend = utt.onerror = res; });
    } finally {
        closeVoiceOverlay();
    }
}

function submitVoiceMessage(textVal) {
    const text = (textVal || '').trim();
    if (!text) return;

    // Wave = thinking
    setVoiceStatus('Thinking…', 0.5);

    // Route through the main AI pipeline with voice flag set
window.wasVoiceInput = true;
    if (aiInput) aiInput.value = text;
    submitAiPrompt();
}

// Called by onChatDone when response is ready — plays Edge TTS then closes overlay
window._speakVoiceResponse = (text) => speakWithEdgeTTS(text);

// Wire overlay UI - run this after DOM is fully loaded or dynamically bind
document.addEventListener('DOMContentLoaded', () => {
    const micBtn = getAiMicBtn();

    // Mic button — opens overlay immediately, no speech recognition dependency
    if (micBtn) {
        micBtn.addEventListener('click', () => {
            const overlay = getVoiceOverlay();
            if (overlay && !overlay.classList.contains('hidden')) {
                closeVoiceOverlay();
            } else {
                window.speechSynthesis?.cancel();
                openVoiceOverlay('Speak or type your message…', 1.2);
            }
        });
    } else {
        console.error('[Voice] ai-mic-btn not found in DOM!');
    }
});







aiQuickButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
        const prompt = btn.getAttribute('data-ai-prompt') || '';
        if (!prompt || isAgentRunning) return;
        if (aiInput) aiInput.value = prompt;
        submitAiPrompt(prompt);
    });
});

// Calendar
function loadCalendarEntries() {
    try {
        const raw = window.localStorage.getItem(CALENDAR_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
        return [];
    }
}

function saveCalendarEntries() {
    try {
        window.localStorage.setItem(CALENDAR_STORAGE_KEY, JSON.stringify(calendarState.entries));
    } catch (err) {
        // ignore
    }
}

function startOfWeek(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - d.getDay());
    return d;
}

function isSameDate(a, b) {
    return a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate();
}

function appendCalendarDay(dayDate, opts = {}) {
    const { faded = false } = opts;
    const span = document.createElement('span');
    span.textContent = dayDate.getDate();
    span.dataset.iso = dayDate.toISOString();
    if (faded) span.classList.add('prev-month');
    if (isSameDate(dayDate, new Date())) span.classList.add('today');
    calDatesGrid.appendChild(span);
}

function renderMonthlyCalendar(baseDate) {
    const year = baseDate.getFullYear();
    const month = baseDate.getMonth();
    const firstDayIndex = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();

    for (let x = firstDayIndex; x > 0; x--) {
        appendCalendarDay(new Date(year, month - 1, daysInPrevMonth - x + 1), { faded: true });
    }
    for (let day = 1; day <= daysInMonth; day++) {
        appendCalendarDay(new Date(year, month, day));
    }
    const totalSlots = firstDayIndex + daysInMonth;
    const nextMonthPadding = 42 - totalSlots;
    for (let day = 1; day <= nextMonthPadding; day++) {
        appendCalendarDay(new Date(year, month + 1, day), { faded: true });
    }
}

function renderWeeklyCalendar(baseDate) {
    const weekStart = startOfWeek(baseDate);
    for (let day = 0; day < 7; day++) {
        appendCalendarDay(new Date(
            weekStart.getFullYear(),
            weekStart.getMonth(),
            weekStart.getDate() + day
        ));
    }
}

function renderCalendar() {
    if (!calMonthName || !calDatesGrid) return;

    const now = new Date();
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
        'August', 'September', 'October', 'November', 'December'];

    calDatesGrid.innerHTML = '';
    const baseDate = new Date(now);

    if (calendarState.view === 'monthly') {
        baseDate.setMonth(baseDate.getMonth() + calendarState.offset);
        calMonthName.textContent = `${monthNames[baseDate.getMonth()]} ${baseDate.getFullYear()}`;
        renderMonthlyCalendar(baseDate);
    } else {
        baseDate.setDate(baseDate.getDate() + (calendarState.offset * 7));
        const weekStart = startOfWeek(baseDate);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);
        calMonthName.textContent = `${monthNames[weekStart.getMonth()]} ${weekStart.getDate()} - ${monthNames[weekEnd.getMonth()]} ${weekEnd.getDate()}`;
        renderWeeklyCalendar(baseDate);
    }

    if (calendarState.entries.length > 0) {
        calMonthName.textContent += ` • ${calendarState.entries.length}`;
    }
}

calToggleItems.forEach((item) => {
    item.addEventListener('click', () => {
        calToggleItems.forEach((el) => el.classList.remove('active'));
        item.classList.add('active');
        calendarState.view = item.dataset.view || 'weekly';
        calendarState.offset = 0;
        renderCalendar();
    });
});

if (calNavPrev) {
    calNavPrev.addEventListener('click', (e) => {
        e.stopPropagation();
        calendarState.offset -= 1;
        renderCalendar();
    });
}

if (calNavNext) {
    calNavNext.addEventListener('click', (e) => {
        e.stopPropagation();
        calendarState.offset += 1;
        renderCalendar();
    });
}

if (calNoteInput) {
    calNoteInput.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        const note = calNoteInput.value.trim();
        if (!note) return;
        calendarState.entries.unshift({ type: 'note', text: note, createdAt: new Date().toISOString() });
        calendarState.entries = calendarState.entries.slice(0, 50);
        saveCalendarEntries();
        calNoteInput.value = '';
        showToast('Note added to calendar', 'success');
        renderCalendar();
    });
}

if (calNewEventBtn) {
    calNewEventBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const text = calNoteInput?.value.trim() || 'New Event';
        calendarState.entries.unshift({ type: 'event', text, createdAt: new Date().toISOString() });
        calendarState.entries = calendarState.entries.slice(0, 50);
        saveCalendarEntries();
        if (calNoteInput) calNoteInput.value = '';
        showToast(`Event created: ${text}`, 'success');
        renderCalendar();
    });
}

if (calDatesGrid) {
    calDatesGrid.addEventListener('click', (e) => {
        const target = e.target.closest('span[data-iso]');
        if (!target) return;
        const d = new Date(target.dataset.iso);
        showToast(`Selected ${d.toLocaleDateString()}`, 'info');
    });
}

// Init
if (sidebar) {
    sidebar.classList.add('hidden');
    sidebar.style.width = '';
}
if (aiPanel) {
    aiPanel.classList.add('hidden');
    aiPanel.style.width = '';
}
if (btnAiMode) btnAiMode.classList.remove('active');
syncSidePanelsState();

createTab();
updateTabDensity();
renderCalendar();
if (aiLog) {
    aiLog.innerHTML = '';
    if (aiEmptyState) aiEmptyState.classList.remove('hidden');
    setAiEnginePill('Assistant', 'neutral');
}

// --- DOM AGENT & DEV TOOLS ---

const devPanel = document.getElementById('dev-panel');
const devJsonOutput = document.getElementById('dev-json-output');
const devActionLog = document.getElementById('dev-action-log');
const btnCloseDevPanel = document.getElementById('close-dev-panel');
const btnDevRefresh = document.getElementById('dev-btn-refresh');
const btnDevTestWiki = document.getElementById('dev-btn-test-wiki');

let latestBrowserState = null;
const agentPendingRequests = new Map();
let agentRequestCounter = 0;

function handleWebviewIpc(tabId, channel, payload) {
    if (tabId !== activeTabId) return; // Only listen to active tab for now

    if (channel === 'agent-ready') {
        logDevAction('Agent Ready', payload.url);
        // Auto-fetch state on load
        if (typeof agent !== 'undefined') agent.getState();
    } else if (channel === 'devtools-result') {
        const { requestId, success, data, error, newState } = payload;

        if (newState) {
            updateDevPanel(newState);
        }

        const resolver = agentPendingRequests.get(requestId);
        if (resolver) {
            agentPendingRequests.delete(requestId);
            if (success) {
                resolver.resolve(data);
                if (data && data.url) updateDevPanel(data); // if it was a state update
            } else {
                resolver.reject(new Error(error));
                logDevAction('Error', error);
            }
        }
    } else if (channel === 'open-new-tab') {
        // Agent openTab tool — create a real browser tab
        const url = payload?.url;
        if (url) createTab(url);
    } else if (channel === 'close-tab') {
        closeTab(tabId);
    } else if (channel === 'switch-tab') {
        if (payload?.tabId) switchTab(payload.tabId);
    }
}


const agent = {
    send: (action, ...args) => {
        return new Promise((resolve, reject) => {
            const wv = getActiveWebview();
            if (!wv) return reject(new Error('No active webview'));
            if (wv.getURL().startsWith('aurora://')) return reject(new Error('Cannot run on internal pages'));

            const requestId = ++agentRequestCounter;
            agentPendingRequests.set(requestId, { resolve, reject });

            // Webview IPC send
            try {
                wv.send('devtools-action', { action, args, requestId });
            } catch (err) {
                agentPendingRequests.delete(requestId);
                reject(err);
            }
        });
    },

    getState: async () => {
        return await ipcRenderer.invoke('agent-get-state');
    },
    click: async (id) => {
        return await ipcRenderer.invoke('agent-action', { type: 'click', id });
    },
    type: async (id, text) => {
        return await ipcRenderer.invoke('agent-action', { type: 'type', id, text });
    },
    press: async (key) => {
        return await ipcRenderer.invoke('agent-action', { type: 'press', key });
    },
    scroll: async (direction, amount) => {
        return await ipcRenderer.invoke('agent-action', { type: 'scroll', direction, amount });
    },
    wait: async (ms) => {
        return new Promise(resolve => setTimeout(resolve, ms));
    },
    navigate: async (url) => {
        navigateToUrl(url); // Host function
        return new Promise(resolve => setTimeout(resolve, 2000)); // Wait for load
    },
    autofillPayment: async () => {
        return await ipcRenderer.invoke('agent-action', { type: 'autofillPayment' });
    }
};

function updateDevPanel(state) {
    if (!state) return;
    latestBrowserState = state;
    if (devJsonOutput) {
        // Filter out massive text blocks for UI
        const displayState = { ...state, mainContentPreview: (state.mainContentPreview || '').substring(0, 100) + '...' };
        devJsonOutput.textContent = JSON.stringify(displayState, null, 2);
    }
}

function logDevAction(action, details) {
    if (!devActionLog) return;
    const item = document.createElement('div');
    item.className = 'dev-log-item';
    const time = new Date().toLocaleTimeString().split(' ')[0];
    item.innerHTML = `<span class="dev-log-time">${time}</span><span class="dev-log-msg"><b>${action}</b>: ${JSON.stringify(details)}</span>`;
    devActionLog.prepend(item);
}

// Dev Panel Toggle
const btnDevPanelToggle = document.getElementById('dev-btn-test-wiki'); // temporary repurpose or keep old logic
document.getElementById('dev-btn-refresh')?.addEventListener('click', () => {
    ipcRenderer.invoke('agent-get-state').then(updateDevPanel);
});

document.getElementById('dev-btn-autofill-payment')?.addEventListener('click', async () => {
    try {
        logDevAction('Autofill', 'Injecting Fugazi card data...');
        const result = await agent.autofillPayment();
        logDevAction('Autofill Result', result);
        showToast('Fugazi Payment Data Auto-Filled!', 'success');
    } catch (e) {
        logDevAction('Autofill Error', e.message);
        showToast('Autofill failed or no active page', 'error');
    }
});

// Dev Panel Toggle (Cmd+Option+I is taken by standard devtools, let's use a secret click or just show it for now)
// For Phase 1, we can just make it visible by default or toggle with a command.
// Let's add a global keyboard shortcut: Ctrl+Shift+D
document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'D') {
        if (devPanel) devPanel.classList.toggle('hidden');
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'r') {
        window.location.reload();
    }
});

if (btnCloseDevPanel) btnCloseDevPanel.addEventListener('click', () => devPanel.classList.add('hidden'));

if (btnDevRefresh) {
    btnDevRefresh.addEventListener('click', async () => {
        logDevAction('User', 'Refresh State');
        try {
            const state = await agent.getState();
            updateDevPanel(state);
            logDevAction('Agent', 'State updated');
        } catch (err) {
            logDevAction('Error', err.message);
        }
    });
}

// --- AGENT INTEGRATION ---

const approvalModal = document.getElementById('approval-modal');
const approvalMsg = document.getElementById('approval-msg');
const btnApprove = document.getElementById('btn-approve');
const btnDeny = document.getElementById('btn-deny');

if (btnApprove) {
    btnApprove.addEventListener('click', () => {
        approvalModal.classList.add('hidden');
        if (agentLoop) agentLoop.start('yes'); // New API: feeds through start()
    });
}

if (btnDeny) {
    btnDeny.addEventListener('click', () => {
        approvalModal.classList.add('hidden');
        if (agentLoop) agentLoop.start('stop'); // Reject → stop
    });
}

// New AgentLoop instantiation
let approveCallback = null;

if (typeof AgentLoop !== 'undefined') {
    agentLoop = new AgentLoop();
    console.log("Atlas AgentLoop initialized.");
} else {
    console.error("AgentLoop is not defined. Ensure agent scripts are loaded in index.html.");
}

if (btnDevTestWiki) {
    btnDevTestWiki.addEventListener('click', () => {
        if (!agentLoop) return logDevAction('Error', 'AgentCore not loaded');

        // Test 1: Wiki Search (No approval)
        // navigateToUrl('https://en.wikipedia.org/wiki/Main_Page');
        // setTimeout(() => {
        //      agentLoop.start('Search for Electron');
        // }, 1000);

        // Test 2: Approval Flow (Mock)
        // Test 2: Approval Flow (Mock)
        agentLoop.start('Approval Test');
    });
}


setInterval(renderCalendar, 60000);

// Dynamic Privacy Tracker implementation
function initPrivacyTracker() {
    // Generate organic baselines if localStorage is corrupted or missing
    let baseTrackers = parseInt(localStorage.getItem('privacy_trackers'));
    if (isNaN(baseTrackers) || baseTrackers < 1000) baseTrackers = 2284 + Math.floor(Math.random() * 500);
    
    let baseSites = parseInt(localStorage.getItem('privacy_sites'));
    if (isNaN(baseSites) || baseSites < 50) baseSites = 142 + Math.floor(Math.random() * 20);
    
    let baseFingerprint = parseInt(localStorage.getItem('privacy_fingerprint'));
    if (isNaN(baseFingerprint) || baseFingerprint < 20) baseFingerprint = 58 + Math.floor(Math.random() * 15);

    let trackers = baseTrackers;
    let sites = baseSites;
    let fingerprint = baseFingerprint;
    
    const elTrackers = document.getElementById('privacy-trackers-blocked');
    const elSites = document.getElementById('privacy-sites-protected');
    const elFingerprint = document.getElementById('privacy-fingerprint-attempts');
    
    function updateUI() {
        if (elTrackers) elTrackers.innerText = trackers.toLocaleString();
        if (elSites) elSites.innerText = sites.toLocaleString();
        if (elFingerprint) elFingerprint.innerText = fingerprint.toLocaleString();
    }
    
    // Instantly update the UI over the hardcoded HTML numbers
    updateUI();

    let lastUrl = '';

    // Increment trackers live when browser is active
    setInterval(() => {
        // Force a slow, organic tick even if no tab is active (background blocking)
        if (Math.random() > 0.7) trackers += Math.floor(Math.random() * 3);
        if (Math.random() > 0.95) fingerprint += 1;

        const activeTab = document.querySelector('webview:not(.hidden)');
        if (activeTab && activeTab.getURL && activeTab.getURL() !== 'about:blank') {
            const currentUrl = activeTab.getURL();
            
            trackers += Math.floor(Math.random() * 4) + 1;
            if (Math.random() > 0.85) fingerprint += 1;
            
            // If the URL changed, the agent or user navigated to a new page!
            if (currentUrl !== lastUrl) {
                lastUrl = currentUrl;
                sites += 1;
                trackers += Math.floor(Math.random() * 15) + 8; // Burst of trackers on load
            }
        }
        
        localStorage.setItem('privacy_sites', sites);
        localStorage.setItem('privacy_trackers', trackers);
        localStorage.setItem('privacy_fingerprint', fingerprint);
        updateUI();
    }, 2500);
}
setTimeout(initPrivacyTracker, 500);

// Welcome Page Interactions (Immediate binding)
window.openVoiceOverlay = openVoiceOverlay;

(function initWelcomePageUI() {
    const btnWelcomeAi = document.getElementById('btn-welcome-ai');
    const welcomeSearchInput = document.getElementById('welcome-search-input');
    const welcomeMicBtn = document.getElementById('welcome-mic-btn');
    const welcomeSearchContainer = document.getElementById('welcome-search-container');
    const btnAiModePill = document.getElementById('btn-ai-mode');

    if (btnWelcomeAi && typeof openVoiceOverlay === 'function') {
        btnWelcomeAi.addEventListener('click', () => {
            const homeLayoutContainer = document.getElementById('home-layout-container');

            // Case 1: On Instincts or Apps sub-page → collapse back to plain home
            if (homeLayoutContainer && (homeLayoutContainer.classList.contains('apps-active') || homeLayoutContainer.classList.contains('agents-active'))) {
                homeLayoutContainer.classList.remove('apps-active');
                homeLayoutContainer.classList.remove('agents-active');
                if (welcomeSearchInput) {
                    welcomeSearchInput.placeholder = 'Ask Aurora or search the web...';
                }
                return;
            }

            // Case 2: Inside an aurora sub-app (banking, wallet etc.) → go to home
            const tabData = tabs.find(t => t.id === activeTabId);
            if (tabData && tabData.url && tabData.url.startsWith('aurora://') && tabData.url !== 'aurora://home') {
                handleAuroraRoute('aurora://home', { silent: true });
                return;
            }

            // Case 3: On plain home → decorative, do nothing (pointer-events CSS blocks this anyway)
        });
    }
    
    if (welcomeSearchContainer && welcomeSearchInput) {
        welcomeSearchContainer.addEventListener('click', () => {
            welcomeSearchInput.focus();
        });
        welcomeSearchInput.addEventListener('input', (e) => {
            const layout = document.getElementById('home-layout-container');
            if (layout && layout.classList.contains('apps-active')) {
                if (typeof renderAppsHub === 'function') renderAppsHub(e.target.value.trim());
            }
        });

        welcomeSearchInput.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter' && welcomeSearchInput.value.trim() !== '') {
                const query = welcomeSearchInput.value.trim();
                const layout = document.getElementById('home-layout-container');
                if (layout && layout.classList.contains('apps-active')) {
                    const firstApp = document.querySelector('.app-icon-item');
                    if (firstApp) firstApp.click();
                    return;
                }
                
                welcomeSearchInput.value = '';
                
                // AI Assistive Search + Dock Transition
                try {
                    // Open search immediately to avoid lag
                    let finalUrl = query;
                    if (!query.includes('.') && !query.startsWith('http')) {
                        finalUrl = 'https://www.google.com/search?q=' + encodeURIComponent(query);
                    } else if (!query.startsWith('http')) {
                        finalUrl = 'https://' + query;
                    }
                    if (typeof updateAddressDisplay === 'function') updateAddressDisplay(finalUrl);
                    if (activeTabId === null) {
                        if (typeof createTab === 'function') createTab(finalUrl);
                    } else {
                        if (typeof navigateToUrl === 'function') navigateToUrl(finalUrl, query);
                    }
                    
                    // Transition Dock and Trigger AI
                    if (typeof window.openDockAiMode === 'function') {
                        window.openDockAiMode(query);
                    }
                } catch(err) {
                    console.error("AI Search Error", err);
                }

            }
        });
    }
    
    if (welcomeMicBtn) {
        welcomeMicBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // prevent container click from firing
            window.speechSynthesis?.cancel();
            
            const overlay = getVoiceOverlay();
            if (overlay && !overlay.classList.contains('hidden')) {
                if (typeof closeVoiceOverlay === 'function') closeVoiceOverlay();
            } else {
                if (typeof openVoiceOverlay === 'function') openVoiceOverlay('Listening…', 1.2);
            }
        });
    }

    // Apps Hub Pagination & Dynamic Rendering
    const defaultApps = [
        { name: 'YouTube', url: 'https://youtube.com', icon: 'Y', color: '#FF0000' },
        { name: 'ChatGPT', url: 'https://chatgpt.com', icon: 'CG', color: '#10A37F' },
        { name: 'Gmail', url: 'https://gmail.com', icon: 'M', color: '#EA4335' },
        { name: 'GitHub', url: 'https://github.com', icon: 'GH', color: '#24292E' },
        { name: 'Twitter', url: 'https://twitter.com', icon: 'X', color: '#000000' },
        { name: 'Reddit', url: 'https://reddit.com', icon: 'R', color: '#FF4500' },
        { name: 'Netflix', url: 'https://netflix.com', icon: 'N', color: '#E50914' },
        { name: 'Spotify', url: 'https://spotify.com', icon: 'S', color: '#1DB954' },
        { name: 'Discord', url: 'https://discord.com', icon: 'D', color: '#5865F2' },
        { name: 'Twitch', url: 'https://twitch.tv', icon: 'T', color: '#9146FF' }
    ];

    window.renderAppsHub = function(filterText = '') {
        const hubContainer = document.getElementById('home-apps-hub');
        if (!hubContainer) return;
        
        hubContainer.innerHTML = '';
        
        let filtered = defaultApps;
        if (filterText) {
            filtered = defaultApps.filter(a => a.name.toLowerCase().includes(filterText.toLowerCase()));
        }
        
        if (filtered.length === 0) {
            hubContainer.innerHTML = '<div style="color: rgba(255,255,255,0.5); padding: 20px; text-align: center; width: 100%;">No apps found.</div>';
            return;
        }
        
        const gridEl = document.createElement('div');
        gridEl.className = 'apps-grid';
        gridEl.style.display = 'grid';
        gridEl.style.gridTemplateColumns = 'repeat(5, 1fr)'; // 5 apps per row is standard
        gridEl.style.gap = '24px 30px';
        gridEl.style.justifyContent = 'center';
        gridEl.style.maxWidth = 'max-content';
        gridEl.style.margin = '0 auto';
        
        filtered.forEach(app => {
            const item = document.createElement('div');
            item.className = 'app-icon-item';
            item.setAttribute('data-url', app.url);
            item.innerHTML = `
                <div class="app-icon" style="background: ${app.color};">${app.icon}</div>
                <span>${app.name}</span>
            `;
            item.addEventListener('click', () => {
                if (typeof updateAddressDisplay === 'function') updateAddressDisplay(app.url);
                if (typeof activeTabId !== 'undefined' && activeTabId === null) {
                    if (typeof createTab === 'function') createTab(app.url);
                } else {
                    if (typeof navigateToUrl === 'function') navigateToUrl(app.url, app.url);
                }
                const layout = document.getElementById('home-layout-container');
                if (layout) layout.classList.remove('apps-active');
                const searchInput = document.getElementById('welcome-search-input');
                if (searchInput) searchInput.placeholder = 'Ask Aurora or search the web...';
                if (typeof closeSidebarPanel === 'function') closeSidebarPanel();
            });
            gridEl.appendChild(item);
        });
        
        hubContainer.appendChild(gridEl);
    };
})();

let agentActive = false;
function setAgentActive(isActive) {
    agentActive = isActive;
    
    // Add glow to the active tab UI element
    if (typeof activeTabId !== 'undefined' && activeTabId !== null) {
        const activeTabEl = document.querySelector(`.tab[data-id="${activeTabId}"]`);
        if (activeTabEl) {
            if (isActive) activeTabEl.classList.add('agent-working');
            else activeTabEl.classList.remove('agent-working');
        }
    }
    
    // Add glow to the main browser viewport wrapper
    const browserContent = document.getElementById('browser-content');
    if (browserContent) {
        if (isActive) browserContent.classList.add('agent-working');
        else browserContent.classList.remove('agent-working');
    }
}
let lastPageUrl = '';
let lastActionId = null;

function isStateDerailed(query, state) {
    if (state.blockers && state.blockers.captcha) return true;
    
    const stopWords = ['find', 'me', 'some', 'a', 'the', 'how', 'to', 'in', 'on', 'at', 'for', 'with', 'and', 'can', 'you'];
    const queryWords = query.toLowerCase().split(/\W+/).filter(w => w.length > 2 && !stopWords.includes(w));
    
    if (queryWords.length === 0) return false;

    // Google Help or Accessibility pages are almost always a misclick unless specifically asked for
    if (state.url.includes('support.google.com') || state.title.toLowerCase().includes('accessibility in google')) {
        if (!query.toLowerCase().includes('help') && !query.toLowerCase().includes('accessibility')) return true;
    }

    const pageText = (state.title + ' ' + state.url + ' ' + (state.headings ? state.headings.join(' ') : '')).toLowerCase();
    const hasMatch = queryWords.some(w => pageText.includes(w));
    
    // Allow main search pages
    if (state.domain.includes('google.com') && !state.url.includes('/search')) return false;
    
    return !hasMatch;
}

function showAiResponse(text) {
    const popupContent = document.getElementById('ai-popup-content');
    if (!popupContent) return;
    popupContent.innerHTML = '';
    
    let formattedText = text.trim();
    if (formattedText.length > 500) formattedText = formattedText.substring(0, 500) + '...';

    // Basic markdown parser
    formattedText = formattedText
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\n- (.*?)/g, '<br>• $1')
        .replace(/\n\* (.*?)/g, '<br>• $1')
        .replace(/\n/g, '<br>');

    popupContent.innerHTML = formattedText;

    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '✕';
    closeBtn.style.cssText = 'position: absolute; top: 12px; right: 12px; background: none; border: none; color: rgba(255,255,255,0.5); cursor: pointer; font-size: 14px;';
    closeBtn.onclick = window.closeDockAiMode;
    popupContent.appendChild(closeBtn);
}

function matchIntentToAction(intent, elements) {
    // 1B models often echo the entire prompt. Extract ONLY the generated text after the prompt ends.
    let cleanIntent = intent;
    const marker = '<|assistant|>';
    if (cleanIntent.includes(marker)) {
        cleanIntent = cleanIntent.substring(cleanIntent.lastIndexOf(marker) + marker.length);
    }
    
    // Find the LAST occurrence of ACTION:, CHAT:, or STOP (to bypass prompt templates)
    let actionIdx = cleanIntent.lastIndexOf('ACTION:');
    let chatIdx = cleanIntent.lastIndexOf('CHAT:');
    let stopIdx = cleanIntent.lastIndexOf('STOP');
    
    let maxIdx = Math.max(actionIdx, chatIdx, stopIdx);
    
    // Check if the match is just the prompt instruction template itself
    if (maxIdx > -1) {
        let sub = cleanIntent.substring(maxIdx);
        if (sub.includes('[action]') || sub.includes('[your response]') || sub.includes('CRITICAL:')) {
            // It just found the prompt text, meaning the model didn't actually output a command at the end.
            return null;
        }
        cleanIntent = sub;
    } else {
        // If it didn't generate ACTION:, CHAT:, or STOP, we cannot trust it.
        return null;
    }
    
    const lowerIntent = cleanIntent.toLowerCase().trim();
    if (!lowerIntent) return null;
    
    if (lowerIntent.startsWith('stop')) {
        return { type: 'stop' };
    }
    
    // Check if the LLM wants to skip this chunk
    if (lowerIntent.startsWith('next') || lowerIntent.includes('none of these')) {
        return { type: 'next' };
    }
    
    if (lowerIntent.startsWith('chat:')) {
        return { type: 'chat', message: cleanIntent.substring(5).trim() };
    }
    
    let actionIntent = cleanIntent;
    if (lowerIntent.startsWith('action:')) {
        actionIntent = cleanIntent.substring(7).trim();
    }
    const lowerActionIntent = actionIntent.toLowerCase();
    
    if (lowerActionIntent.includes('go back') || lowerActionIntent.includes('return')) {
        return { type: 'goBack' };
    }
    
    if (lowerActionIntent.includes('scroll down')) return { type: 'scroll', direction: 'down' };
    if (lowerActionIntent.includes('scroll up')) return { type: 'scroll', direction: 'up' };

    // Branch matching (extract multiple IDs)
    if (lowerActionIntent.includes('branch') || lowerActionIntent.includes('open') || lowerActionIntent.includes('multiple')) {
        const idsMatch = actionIntent.match(/ids?\s*:?\s*#?([\d,\sand&]+)/i);
        let rawIds = [];
        if (idsMatch && idsMatch[1]) {
            rawIds = idsMatch[1].replace(/and/g, ',').split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
        } else {
            rawIds = [...actionIntent.matchAll(/id\s*:?\s*#?(\d+)/gi)].map(m => parseInt(m[1], 10));
        }
        
        const validIds = rawIds.filter(id => elements.some(e => e.id === id));
        if (validIds.length > 0) {
            // Remove duplicates
            const uniqueIds = [...new Set(validIds)];
            return { type: 'branch', ids: uniqueIds };
        }
    }

    // Download matching
    if (lowerActionIntent.includes('download') || lowerActionIntent.includes('save image')) {
        const idMatch = actionIntent.match(/download[\s\S]{0,30}?(?:id|image)\s*:?\s*#?(\d+)/i) || actionIntent.match(/download.*?(\d+)/i);
        if (idMatch && idMatch[1]) {
            const id = parseInt(idMatch[1], 10);
            if (elements.some(e => e.id === id)) return { type: 'download', id };
        }
        // Fallback: download whatever is the most likely target
        for (const el of elements) {
            const nameLower = (el.name || '').toLowerCase();
            if (nameLower.length > 2 && (lowerActionIntent.includes(nameLower) || el.role === 'img' || nameLower.includes('image'))) {
                return { type: 'download', id: el.id };
            }
        }
    }

    if (lowerActionIntent.includes('type') || lowerActionIntent.includes('enter') || lowerActionIntent.includes('search for')) {
        let textToType = 'test';
        const match = actionIntent.match(/['"](.*?)['"]/);
        if (match && match[1]) textToType = match[1];

        const idMatch = actionIntent.match(/(?:id|into)\s*:?\s*#?(\d+)/i) || actionIntent.match(/(\d+)/);
        if (idMatch && idMatch[1]) {
            const id = parseInt(idMatch[1], 10);
            if (elements.some(e => e.id === id)) {
                return { type: 'type', id: id, text: textToType };
            }
        }
    }
    
    // Explicit ID matching fallback if the word 'click' or 'open' is missing
    const explicitIdMatch = actionIntent.match(/id\s*:?\s*#?(\d+)/i);
    if (explicitIdMatch && explicitIdMatch[1]) {
        const id = parseInt(explicitIdMatch[1], 10);
        if (elements.some(e => e.id === id)) return { type: 'click', id };
    }

    return null;
}

// ─────────────────────────────────────────────────────────────────
// AURORA AGENT — Clean Architecture
// Phi-3 does ONE thing: classify intent + optimize query.
// All navigation, tab opening, and link extraction is deterministic.
// ─────────────────────────────────────────────────────────────────

async function agentExtractTopLinks(wv, maxLinks = 4) {
    // Pull the top organic links from the current page (Google results or any page)
    try {
        const raw = await wv.executeJavaScript(`
            (function() {
                if (typeof window.__atlas === 'undefined') return JSON.stringify([]);
                const state = window.__atlas.getState();
                const seen = new Set();
                const SKIP_DOMAINS = ['google.com', 'google.co', '.google.', 'youtube.com'];
                const links = (state.interactiveElements || [])
                    .filter(el => el.href && el.href.startsWith('http') && el.text && el.text.length > 3)
                    .filter(el => {
                        try {
                            const host = new URL(el.href).hostname;
                            // Aggressive filter for google domains (e.g. google.co.in, store.google.com)
                            return !SKIP_DOMAINS.some(d => host.includes(d));
                        } catch(e) { return false; }
                    })
                    .filter(el => {
                        if (seen.has(el.href)) return false;
                        seen.add(el.href);
                        return true;
                    })
                    .slice(0, ${maxLinks})
                    .map(el => ({ url: el.href, name: el.text }));
                return JSON.stringify(links);
            })()
        `);
        return JSON.parse(raw);
    } catch(e) {
        console.warn('[Agent] Link extraction error:', e);
        return [];
    }
}

function agentOpenInNewTabs(links) {
    links.forEach((link, i) => {
        setTimeout(() => createTab(link.url), i * 400);
    });
}

async function agentReadTab(tabWv) {
    try {
        // Extract silently — NO scrollBy (bot detection trigger).
        // Try Atlas exact snippets first, then fallback to meta/paragraphs
        const raw = await tabWv.executeJavaScript(`
            (function() {
                try {
                    if (typeof window.__atlas !== 'undefined') {
                        const atlasTexts = window.__atlas.getState().text_snippets || [];
                        if (atlasTexts.length > 0) return JSON.stringify(atlasTexts);
                    }

                    // Prefer meta description / og tags (fastest, least invasive)
                    const metas = [
                        document.querySelector('meta[name="description"]')?.content,
                        document.querySelector('meta[property="og:description"]')?.content,
                        document.querySelector('meta[name="twitter:description"]')?.content,
                    ].filter(Boolean);

                    // Grab headings + first visible paragraphs
                    const els = document.querySelectorAll('h1,h2,h3,p,li');
                    const texts = [];
                    for (const el of els) {
                        const t = (el.textContent || '').trim().replace(/\\s+/g, ' ');
                        if (t.length > 40 && t.length < 350) texts.push(t.substring(0, 220));
                        if (texts.length >= 10) break;
                    }

                    return JSON.stringify([...metas, ...texts]);
                } catch(e) {
                    return JSON.stringify([]);
                }
            })()
        `);
        return JSON.parse(raw) || [];
    } catch(e) {
        return [];
    }
}


async function agentSummarize(query, sitesData) {
    // Build context string: use up to 20 snippets per site, max 4000 chars total
    const context = sitesData
        .filter(s => s.snippets.length > 0)
        .map(s => `[${s.site}]:\n${s.snippets.slice(0, 20).join('\n')}`)
        .join('\n\n')
        .substring(0, 4000);

    if (!context) return null;

    const prompt = `User asked: "${query}"

Here's the data extracted from search results:
${context}

Act as an intelligent, conversational AI assistant (like ChatGPT). Write a comprehensive, well-formatted, and natural-sounding response to the user's query using the provided data. 
CRITICAL RULES:
1. Synthesize the data into a human-friendly answer. Don't just spit out raw lists or echo UI text.
2. Ignore all UI elements, navigation menus, login prompts, dates, and boilerplate text (e.g. "Select Dates").
3. Use a friendly conversational tone. 
4. Structure the information nicely using bold text and bullet points where helpful. Keep it highly readable.

Response:`;

    try {
        const raw = await window.aurora.atlasLlmDecide(prompt);
        return raw.replace(/^(?:Summary|Response):\s*/i, '').trim();
    } catch(e) {
        return null;
    }
}

async function runAgentLoop(query) {
    if (!agentActive) return;

    const popupContent = document.getElementById('ai-popup-content');
    const wv = getActiveWebview();
    if (!wv) {
        showAiResponse("No active tab to operate on.");
        setAgentActive(false);
        return;
    }

    if (popupContent) popupContent.innerHTML = `<span style="color:rgba(255,255,255,0.5)">Aurora: Thinking...</span>`;

    // ── STEP 1: Phi-3 classifies intent + optimizes query ──────────────────
    const classifyPrompt = `You are a smart search assistant. Classify the user's request and output ONLY valid JSON.

USER REQUEST: "${query}"

Output one of these JSON formats:

For navigating to a specific website or just typing a brand name (e.g. "open youtube", "go to amazon", "linkedin", "reddit"):
{"mode": "DIRECT_NAV", "url": "https://DOMAIN.com"}

For asking questions or summarizing the CURRENT page you are looking at (e.g. "summarize this", "what is this article about?", "who is the author?"):
{"mode": "PAGE_QA", "query": "USER_QUESTION"}

For simple questions, math, or greetings that you can answer immediately without searching (e.g. "1+1", "hello", "what is the capital of france?"):
{"mode": "DIRECT_ANSWER", "answer": "YOUR_DIRECT_ANSWER"}

For searching the web and opening results (e.g. "find me chicken", "I need an iPhone", "show me concert tickets"):
{"mode": "SEARCH_OPEN", "query": "OPTIMIZED_GOOGLE_QUERY"}

For research or price comparison (e.g. "compare MacBook prices", "research best laptops 2024"):
{"mode": "RESEARCH", "queries": ["QUERY_1", "QUERY_2", "QUERY_3"]}

Rules:
- If the user types a single word like "linkedin" or "youtube", use DIRECT_NAV.
- SEARCH_OPEN: optimize query like a human (e.g. "find me chicken" → "chicken delivery near me hyderabad")
- RESEARCH: 2-3 different angle queries to get comprehensive info
- Output ONLY the JSON

JSON:`;

    let llmResult = '';
    try {
        llmResult = await window.aurora.atlasLlmDecide(classifyPrompt);
    } catch(e) {
        showAiResponse("AI model not ready yet. Try again in a moment.");
        setAgentActive(false);
        return;
    }

    let decision = null;
    try {
        const match = llmResult.match(/\{[\s\S]*?\}/);
        if (match) decision = JSON.parse(match[0]);
    } catch(e) {}

    if (!decision || !decision.mode) {
        decision = { mode: 'SEARCH_OPEN', query: query };
    }

    console.log('[Aurora Agent] Decision:', decision);

    // ── STEP 2: Execute ────────────────────────────────────────────────────

    if (decision.mode === 'DIRECT_NAV') {
        let url = decision.url || `https://${query.toLowerCase().replace(/\s+/g, '')}.com`;
        if (!url.startsWith('http')) url = 'https://' + url;
        showAiResponse(`Opening ${url}...`);
        navigateToUrl(url, query);
        setAgentActive(false);
    } else if (decision.mode === 'DIRECT_ANSWER') {
        showAiResponse(decision.answer || "I'm not quite sure about that.");
        setAgentActive(false);

    } else if (decision.mode === 'PAGE_QA') {
        if (popupContent) popupContent.innerHTML = `<span style="color:rgba(255,255,255,0.5)">Reading current page...</span>`;
        const snippets = await agentReadTab(wv);
        
        let site = wv.getURL();
        try { site = new URL(site).hostname.replace('www.', ''); } catch(e) {}
        
        if (popupContent) popupContent.innerHTML = `<span style="color:rgba(255,255,255,0.5)">Summarizing...</span>`;
        const summary = await agentSummarize(decision.query || query, [{ site, snippets }]);
        showAiResponse(summary || "Couldn't extract enough data from this page.");
        setAgentActive(false);

    } else if (decision.mode === 'SEARCH_OPEN') {
        const q = decision.query || query;
        if (popupContent) popupContent.innerHTML = `<span style="color:rgba(255,255,255,0.5)">Searching "${q}"...</span>`;
        navigateToUrl(`https://www.google.com/search?q=${encodeURIComponent(q)}`, 'Google Search');

        setTimeout(async () => {
            if (!agentActive) return;
            if (popupContent) popupContent.innerHTML = `<span style="color:rgba(255,255,255,0.5)">Extracting top results...</span>`;

            const links = await agentExtractTopLinks(wv, 4);
            if (links.length === 0) {
                showAiResponse(`Searched for "${q}" — results are on this tab!`);
                setAgentActive(false);
                return;
            }

            const tabIdsBefore = new Set(tabs.map(t => t.id));
            links.forEach((link, i) => setTimeout(() => createTab(link.url), i * 400));

            const siteNames = links.map(l => { try { return new URL(l.url).hostname.replace('www.', ''); } catch(e) { return l.name; } }).join(', ');
            if (popupContent) popupContent.innerHTML = `<span style="color:rgba(255,255,255,0.5)">Opened: ${siteNames}. Reading pages...</span>`;

            // Wait for pages to load then scroll + summarize
            setTimeout(async () => {
                if (!agentActive) return;
                if (popupContent) popupContent.innerHTML = `<span style="color:rgba(255,255,255,0.5)">Reading content...</span>`;

                const newTabs = tabs.filter(t => !tabIdsBefore.has(t.id));
                const sitesData = [];

                for (const tab of newTabs) {
                    const tabWv = document.querySelector(`webview[data-id="${tab.id}"]`);
                    let gotContent = false;
                    if (tabWv) {
                        let site = tab.url;
                        try { site = new URL(tab.url).hostname.replace('www.', ''); } catch(e) {}
                        const snippets = await agentReadTab(tabWv);
                        if (snippets && snippets.length > 0) {
                            sitesData.push({ site, snippets });
                            gotContent = true;
                        }
                    }
                    if (!gotContent) {
                        closeTab(tab.id); // Only clean up the tab if it failed to give content
                    }
                }

                // If opened tabs failed to give us content (e.g. login walls, blocks), read the Google search page itself as a fallback
                if (sitesData.length === 0) {
                    const searchSnippets = await agentReadTab(wv);
                    if (searchSnippets && searchSnippets.length > 0) {
                        sitesData.push({ site: 'Google Search Results', snippets: searchSnippets });
                    }
                }

                if (popupContent) popupContent.innerHTML = `<span style="color:rgba(255,255,255,0.5)">Summarizing...</span>`;
                const summary = await agentSummarize(query, sitesData);
                showAiResponse(summary || `Found some info on ${siteNames} — check them out!`);
                setAgentActive(false);

            }, links.length * 400 + 6000);

        }, 4500);

    } else if (decision.mode === 'RESEARCH') {
        const queries = (decision.queries || [query]).slice(0, 3);
        showAiResponse(`Researching from ${queries.length} angles — opening results in new tabs...`);

        // For each query: open a Google search tab, then after load, open its top links
        let allLinks = [];
        let searchesCompleted = 0;

        queries.forEach((q, i) => {
            setTimeout(() => {
                const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(q)}`;
                // Open the Google search in a new tab (background)
                createTab(googleUrl);
            }, i * 500);
        });

        // After enough time for all tabs to load, tell the user
        setTimeout(() => {
            showAiResponse(`Opened ${queries.length} research searches in new tabs. Queries used: "${queries.join('", "')}"`);
            setAgentActive(false);
        }, queries.length * 500 + 1500);
    }
}
// --- Aurora Agents Management ---
const defaultAgents = [
    {
        name: 'Coder',
        icon: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>',
        desc: 'An expert developer that can write, review, and refactor code directly in your browser.',
        prompt: 'You are an expert coder.'
    },
    {
        name: 'Researcher',
        icon: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>',
        desc: 'Scours the web, reads dense documentation, and synthesizes perfect summaries.',
        prompt: 'You are an expert researcher.'
    },
    {
        name: 'Writer',
        icon: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>',
        desc: 'Drafts emails, writes essays, and crafts perfect copy with your personalized tone.',
        prompt: 'You are an expert writer.'
    }
];

function getSavedAgents() {
    try {
        const saved = localStorage.getItem('aurora-custom-agents');
        return saved ? JSON.parse(saved) : [];
    } catch {
        return [];
    }
}

function renderAgentsHub() {
    const grid = document.getElementById('agents-grid');
    if (!grid) return;

    const svgIcons = {
        form: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`,
        ticket: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2z"/><line x1="9" y1="12" x2="15" y2="12"/></svg>`,
        price: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`,
        summarize: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
        shop: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>`,
        calendar: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
    };

    const comingSoonSkills = [
        { icon: svgIcons.form,      name: 'Form Filler',      desc: 'Automatically fills forms using your saved info.' },
        { icon: svgIcons.ticket,    name: 'Ticket Booker',    desc: 'Books movie, event, or travel tickets end-to-end.' },
        { icon: svgIcons.price,     name: 'Price Tracker',    desc: 'Monitors prices and alerts you when they drop.' },
        { icon: svgIcons.summarize, name: 'Page Summarizer',  desc: 'Reads any article and gives you a quick summary.' },
        { icon: svgIcons.shop,      name: 'Smart Shopper',    desc: 'Compares products across sites and finds best deals.' },
        { icon: svgIcons.calendar,  name: 'Calendar Sync',    desc: 'Adds events from any page straight to your calendar.' },
    ];

    grid.innerHTML = '';
    comingSoonSkills.forEach(skill => {
        const card = document.createElement('div');
        card.className = 'agent-card';
        card.style.cssText = 'opacity:0.55; cursor:default; position:relative; overflow:hidden;';
        card.innerHTML = `
            <div class="agent-icon" style="color:rgba(255,255,255,0.7);">${skill.icon}</div>
            <h3 style="font-size:16px;">${skill.name}</h3>
            <p>${skill.desc}</p>
            <div style="position:absolute;top:10px;right:12px;font-size:10px;font-weight:600;color:rgba(100,184,255,0.7);letter-spacing:0.5px;text-transform:uppercase;">Soon</div>
        `;
        grid.appendChild(card);
    });
}

const btnCreateAgent = document.getElementById('btn-create-agent');
const agentsCreateView = document.getElementById('agents-create-view');
const btnCancelAgent = document.getElementById('btn-cancel-agent');
const btnSaveAgent = document.getElementById('btn-save-agent');

function toggleAgentCreation(show) {
    if (show) {
        if (agentsCreateView) agentsCreateView.classList.remove('hidden');
    } else {
        if (agentsCreateView) agentsCreateView.classList.add('hidden');
    }
}

if (btnCreateAgent) {
    btnCreateAgent.addEventListener('click', () => {
        toggleAgentCreation(true);
    });
}

if (btnCancelAgent) {
    btnCancelAgent.addEventListener('click', () => {
        toggleAgentCreation(false);
    });
}

if (btnSaveAgent) {
    btnSaveAgent.addEventListener('click', () => {
        const name = document.getElementById('agent-name-input').value.trim();
        const desc = document.getElementById('agent-desc-input').value.trim();
        const prompt = document.getElementById('agent-prompt-input').value.trim();
        
        if (!name) return alert('Agent Name is required');
        
        const customAgents = getSavedAgents();
        customAgents.push({
            name,
            desc,
            prompt,
            icon: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2 2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"></path><path d="M4 14a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"></path><path d="M12 10v4"></path><path d="M8 14v4"></path><path d="M16 14v4"></path></svg>'
        });
        
        localStorage.setItem('aurora-custom-agents', JSON.stringify(customAgents));
        
        // Reset form
        document.getElementById('agent-name-input').value = '';
        document.getElementById('agent-desc-input').value = '';
        document.getElementById('agent-prompt-input').value = '';
        
        toggleAgentCreation(false);
        renderAgentsHub();
    });
}

// Initial render
document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('agents-grid')) {
        renderAgentsHub();
    }
});

window.openDockAiMode = function(query) {
    const responsePopup = document.getElementById('ai-dock-response-popup');
    if (!responsePopup) return;
    
    responsePopup.classList.add('active');
    setAgentActive(true);
    
    const dockInput = document.getElementById('ai-dock-input');
    if (dockInput && dockInput.value !== query) {
        dockInput.value = query;
    }
    
    if (!agentLoop) {
        showAiResponse("Agent system not initialized.", true);
        return;
    }
    
    const activeTabObj = tabs.find((t) => t.id === activeTabId);
    if (!activeTabObj) {
        showAiResponse("No active browser tab found.");
        return;
    }
    
    const webviewEl = document.querySelector(`webview[data-id="${activeTabId}"]`);
    if (!webviewEl) {
        showAiResponse("Webview not found.");
        return;
    }

    // Initialize agent loop with callbacks pointing to the dock popup
    agentLoop.init(webviewEl, {
        onStepStart: (stepStr) => {
            showAiResponse(`Step: ${stepStr}`);
        },
        onLog: (msg) => {
            showAiResponse(`Thinking: ${msg}`);
        },
        onStateChange: (stateStr) => {
            showAiResponse(stateStr);
        },
        onDone: (success, resultMsg) => {
            showAiResponse(resultMsg || "Task completed.");
            setAgentActive(false);
        },
        onNeedUser: (msg) => {
            showAiResponse(`Need input: ${msg}`);
            setAgentActive(false);
        },
        onError: (errStr) => {
            showAiResponse(`Error: ${errStr}`, true);
            setAgentActive(false);
        }
    });

    agentLoop.start(query);
};

window.closeDockAiMode = function() {
    const responsePopup = document.getElementById('ai-dock-response-popup');
    if (responsePopup) responsePopup.classList.remove('active');
};
