const { ipcRenderer } = require('electron');

// --- CONSTANTS & CONFIG ---
const STABLE_ID_ATTR = 'data-aurora-id';
let lastState = null;
let generatedIdCounter = 0;
const nodeMap = new Map(); // Map<InternalID, Element>

// --- CORE UTILS ---

function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    // Exclude off-screen accessibility links (e.g. left: -9999px)
    if (rect.left < -1000 || rect.top < -1000) return false;
    return rect.width > 0 && rect.height > 0 && rect.width * rect.height > 10;
}

function isInViewport(el) {
    const rect = el.getBoundingClientRect();
    return (
        rect.top >= -500 &&
        rect.left >= -200 &&
        rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) + 800 &&
        rect.right <= (window.innerWidth || document.documentElement.clientWidth) + 200
    );
}

// Robust ID Generation (Phase 9)
// Uses tag + semantic hint + counter for uniqueness
function generateStableId(el) {
    if (el.hasAttribute(STABLE_ID_ATTR)) {
        return el.getAttribute(STABLE_ID_ATTR);
    }

    // Create a semantic prefix
    let prefix = el.tagName.toLowerCase();
    if (el.id) prefix += `#${el.id}`;
    else if (el.name) prefix += `[name="${el.name}"]`;
    else if (el.className && typeof el.className === 'string') {
        const firstClass = el.className.split(' ')[0];
        if (firstClass) prefix += `.${firstClass}`;
    }

    const id = `aurora-${prefix}-${++generatedIdCounter}`.replace(/[^a-zA-Z0-9\-_]/g, '_');
    el.setAttribute(STABLE_ID_ATTR, id);
    nodeMap.set(id, el);
    return id;
}

function getElementByAuroraId(id) {
    return nodeMap.get(id) || document.querySelector(`[${STABLE_ID_ATTR}="${id}"]`);
}

// --- BLOCKER DETECTION (Phase 9 Hardening) ---

function detectBlockers() {
    const potentialBlockers = [];
    // Expanded keywords and roles
    const keywords = ['cookie', 'accept', 'consent', 'agree', 'gdpr', 'modal', 'popup', 'overlay', 'sign in', 'log in', 'subscribe', 'updates'];
    const blockerRoles = ['dialog', 'alertdialog', 'banner'];

    // 1. Check by Role (ARIA)
    document.querySelectorAll('[role="dialog"], [role="alertdialog"]').forEach(el => {
        if (!isVisible(el)) return;
        potentialBlockers.push(createBlockerInfo(el, 'modal-role'));
    });

    // 2. Check by Z-Index + Keywords (Heuristic)
    const allDivs = document.querySelectorAll('div, section, aside, header, footer, dialog');
    allDivs.forEach(el => {
        if (!isVisible(el)) return;

        // Skip if already tagged as blocker via role
        if (el.getAttribute('role') === 'dialog') return;

        const style = window.getComputedStyle(el);
        const position = style.position;
        const zIndex = parseInt(style.zIndex, 10);

        if ((position === 'fixed' || position === 'absolute') && !isNaN(zIndex) && zIndex > 50) {
            const text = el.innerText.toLowerCase().slice(0, 500);
            if (keywords.some(kw => text.includes(kw))) {
                // Additional check: covers significant screen area?
                const rect = el.getBoundingClientRect();
                const screenArea = window.innerWidth * window.innerHeight;
                const elArea = rect.width * rect.height;
                // If it covers > 10% of screen OR is centered
                if (elArea > screenArea * 0.1 || (Math.abs(rect.left + rect.width / 2 - window.innerWidth / 2) < 200)) {
                    potentialBlockers.push(createBlockerInfo(el, 'modal-heuristic'));
                }
            }
        }
    });

    // Deduplicate logic could go here
    return potentialBlockers;
}

function createBlockerInfo(el, reason) {
    return {
        id: generateStableId(el),
        role: el.getAttribute('role') || 'generic',
        reason: reason,
        text: el.innerText.substring(0, 100).replace(/\s+/g, ' ').trim(),
        rect: el.getBoundingClientRect()
    };
}

// --- STATE CAPTURE ---

function getInteractiveElements() {
    const selector = 'a, button, input, select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="menuitem"], [role="tab"], [onclick], [tabindex="0"]';
    const elements = document.querySelectorAll(selector);
    const results = [];

    elements.forEach(el => {
        if (!isVisible(el)) return;
        if (!isInViewport(el)) return; // Massive token optimization: only send what's on screen

        const rect = el.getBoundingClientRect();

        // Gather input specific attributes
        let inputType = el.type || null;
        let placeholder = el.placeholder || null;
        let value = el.value || null;
        let checked = el.checked || null;

        const text = (el.innerText || el.value || el.getAttribute('aria-label') || '').substring(0, 100).replace(/\s+/g, ' ').trim();
        
        // Skip purely structural links that have no readable text or utility
        if (!text && !inputType && el.tagName === 'A') return;

        results.push({
            id: generateStableId(el),
            tagName: el.tagName.toLowerCase(),
            type: inputType,
            role: el.getAttribute('role') || null,
            text: text,
            placeholder: placeholder,
            value: value,
            href: el.getAttribute('href') ? el.getAttribute('href').substring(0, 60) : null,
            bbox: { x: Math.round(rect.x), y: Math.round(rect.y) }
        });
    });

    return results;
}

function getPageState() {
    const interactive = getInteractiveElements();
    const blockers = detectBlockers();

    const state = {
        url: window.location.href,
        domain: window.location.hostname,
        title: document.title,
        readyState: document.readyState, // Page Readiness
        scroll: {
            x: window.scrollX,
            y: window.scrollY,
            maxHeight: document.documentElement.scrollHeight
        },
        viewPort: {
            width: window.innerWidth,
            height: window.innerHeight
        },
        interactiveElements: interactive,
        blockers: blockers,
        mainContentPreview: document.body.innerText.substring(0, 5000).replace(/\s+/g, ' ').trim()
    };

    lastState = state;
    return state;
}

// --- ACTIONS (Deterministic) ---

const actions = {
    click: (id) => {
        const el = getElementByAuroraId(id);
        if (!el) throw new Error(`Element not found: ${id}`);
        if (!isVisible(el)) throw new Error(`Element not visible: ${id}`);

        el.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'center' });
        el.focus();
        el.click(); // Dispatch basic click
        return { success: true, message: `Clicked ${id}` };
    },

    type: (id, text, clearFirst = true) => {
        const el = getElementByAuroraId(id);
        if (!el) throw new Error(`Element not found: ${id}`);

        el.scrollIntoView({ behavior: 'auto', block: 'center' });
        el.focus();

        if (clearFirst) {
            el.value = '';
            el.dispatchEvent(new Event('input', { bubbles: true }));
        }

        // Native setter hack for React/Vue
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
        if (nativeInputValueSetter && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
            nativeInputValueSetter.call(el, text);
        } else {
            el.value = text;
        }

        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));

        return { success: true, message: `Typed into ${id}` };
    },

    press: (key) => {
        // Dispatch Keyboard Events
        const active = document.activeElement || document.body;

        ['keydown', 'keypress', 'keyup'].forEach(type => {
            active.dispatchEvent(new KeyboardEvent(type, {
                key: key,
                code: key, // Approximation
                bubbles: true,
                cancelable: true
            }));
        });

        return { success: true, message: `Pressed ${key}` };
    },

    scroll: (direction, amount) => {
        const output = { x: 0, y: 0 };
        if (direction === 'up' || direction === 'top') {
            window.scrollBy(0, -Math.abs(amount || 300));
        } else if (direction === 'down' || direction === 'bottom') {
            window.scrollBy(0, Math.abs(amount || 300));
        }
        output.x = window.scrollX;
        output.y = window.scrollY;
        return { success: true, newScroll: output };
    },

    wait: (ms) => {
        return new Promise(resolve => setTimeout(() => resolve({ success: true, waited: ms }), ms));
    }
};

// --- IPC HANDLERS ---

ipcRenderer.on('devtools-action', async (event, payload) => {
    try {
        const { action, args, requestId } = payload;

        if (action === 'getState') {
            const state = getPageState();
            ipcRenderer.sendToHost('devtools-result', { requestId, success: true, data: state });
            return;
        }

        if (actions[action]) {
            const result = await actions[action](...args);
            const newState = getPageState();
            ipcRenderer.sendToHost('devtools-result', { requestId, success: true, data: result, newState });
        } else {
            throw new Error(`Unknown action: ${action}`);
        }
    } catch (err) {
        ipcRenderer.sendToHost('devtools-result', {
            requestId: payload.requestId,
            success: false,
            error: err.message,
            stack: err.stack
        });
    }
});

window.addEventListener('DOMContentLoaded', () => {
    ipcRenderer.sendToHost('agent-ready', { url: window.location.href });
});

console.log('[Aurora DOM Agent] Loaded (Phase 9 Hardened).');
