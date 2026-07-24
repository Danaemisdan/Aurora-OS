// Generates stable IDs, extracts concise DOM snapshots, and injects visual labels

function clearAtlasLabels() {
    document.querySelectorAll('.atlas-ui-label').forEach(el => el.remove());
}

function drawAtlasLabel(element, id) {
    // Disabled: User requested removing red debug markers
    element.setAttribute('data-atlas-id', id);
}

function isInteractive(element) {
    const interactiveTags = ['a', 'button', 'input', 'select', 'textarea', 'details'];
    if (interactiveTags.includes(element.tagName.toLowerCase())) return true;
    if (element.hasAttribute('role') && ['button', 'link', 'checkbox', 'menuitem', 'tab', 'combobox', 'searchbox', 'textbox', 'switch'].includes(element.getAttribute('role'))) return true;
    if (element.hasAttribute('onclick') || element.hasAttribute('tabindex')) return true;
    return false;
}

function isVisible(element) {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return (
        rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.top < (window.innerHeight || document.documentElement.clientHeight) &&
        rect.left < (window.innerWidth || document.documentElement.clientWidth) &&
        style.visibility !== 'hidden' &&
        style.display !== 'none' &&
        style.opacity !== '0'
    );
}

function getAriaName(element) {
    return element.getAttribute('aria-label') || element.getAttribute('placeholder') || element.getAttribute('name') || element.getAttribute('alt') || element.title || element.innerText?.trim() || element.value || '';
}

function getStateSnapshot() {
    clearAtlasLabels();
    let currentId = 0;

    // ── PASS 1: Visible interactive elements (inputs, buttons, etc.) ────────────
    const interactiveElements = [];
    const seenUrls = new Set();
    const selectors = 'a, button, input, select, textarea, details, [role="button"], [role="link"], [role="checkbox"], [role="menuitem"], [role="tab"], [tabindex], [onclick]';
    const elements = document.querySelectorAll(selectors);

    for (const el of elements) {
        if (isVisible(el)) {
            const elData = {
                role: el.getAttribute('role') || el.tagName.toLowerCase(),
                name: getAriaName(el).substring(0, 150).replace(/\n/g, ' ').trim()
            };
            if (el.tagName.toLowerCase() === 'a' && el.href) {
                elData.url = el.href.length > 400 ? el.href.substring(0, 400) + '...' : el.href;
                seenUrls.add(el.href);
            }
            if (el.getAttribute('type')) elData.type = el.getAttribute('type');
            if (el.value) elData.value = String(el.value).substring(0, 100);
            if (document.activeElement === el) elData.focused = true;

            // Include if it has a name, value, OR is an input/select/textarea (so it never misses forms)
            const isFormElement = ['input', 'select', 'textarea'].includes(el.tagName.toLowerCase());
            if (elData.name || elData.value || isFormElement) {
                elData.id = currentId;
                drawAtlasLabel(el, currentId);
                currentId++;
                interactiveElements.push(elData);
            }

            if (interactiveElements.length >= 250) break; // Increased to 250 so main content isn't cut off by huge headers
        }
    }

    // ── PASS 2: ALL links from the entire DOM (includes below-fold results) ────
    const GOOGLE_JUNK = /\/(webhp|preferences|intl|accounts|maps\/contribute|policies|privacy|terms|support|about|feedback)/;
    const NOISE_TEXT = /^(Sign in|Privacy|Terms|Settings|Feedback|More|Images|Videos|News|Maps|Shopping|Help|Google)$/i;

    let pass2Count = 0;
    for (const el of document.querySelectorAll('a[href]')) {
        try {
            const href = el.href;
            if (!href || !href.startsWith('http')) continue;
            if (seenUrls.has(href)) continue;

            // Skip Google's own navigation/utility links (keep organic results)
            const isGoogleInternal = href.includes('google.') &&
                (GOOGLE_JUNK.test(new URL(href).pathname) || href.includes('/search?') || href.includes('/url?'));
            if (isGoogleInternal) continue;

            const rawText = (el.innerText || el.textContent || '').trim();
            const name = (el.getAttribute('aria-label') || rawText).substring(0, 120).replace(/\n/g, ' ').trim();
            if (!name || NOISE_TEXT.test(name) || name.length < 3) continue;

            seenUrls.add(href);
            el.setAttribute('data-atlas-id', currentId);
            interactiveElements.push({
                id: currentId,
                role: 'a',
                name,
                url: href.length > 150 ? href.substring(0, 150) + '...' : href,
                off_screen: !isVisible(el)
            });
            currentId++;

            pass2Count++;
            // Limit off-screen Google links to just the top 15 organic results to save massive prompt tokens!
            if (pass2Count >= 15) break; 
        } catch (_) {}
    }

    const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
        .filter(isVisible)
        .map(h => h.innerText.trim().substring(0, 80))
        .filter(t => t.length > 5)
        .slice(0, 8);

    const scroll_info = {
        scrollY: Math.round(window.scrollY),
        maxScrollY: Math.round(document.documentElement.scrollHeight - window.innerHeight),
        canScrollMore: window.scrollY + window.innerHeight < document.documentElement.scrollHeight - 50
    };

    const blockers = {
        modal: !!document.querySelector('[role="dialog"], [aria-modal="true"]'),
        cookie: !!(document.body && document.body.innerText && document.body.innerText.match(/cookie|consent/i)) && !!document.querySelector('.cookie-banner, #cookie-consent, [id*="cookie"]'),
        login: !!document.querySelector('input[type="password"]'),
        captcha: !!document.querySelector('iframe[src*="captcha"], #captcha, div[class*="captcha"]')
    };

    // ── TEXT SNIPPETS: fast extraction without layout thrashing ───────────────
    const textSnippets = [];
    const textElements = document.querySelectorAll('h1, h2, h3, p, li, td, th, span, article');
    for (const el of textElements) {
        if (el.closest('nav, footer, aside, script, style, noscript')) continue;
        const text = (el.textContent || '').trim().replace(/\s+/g, ' ');
        if (text.length > 30) {
            textSnippets.push(text.substring(0, 200));
            if (textSnippets.length >= 20) break; // Keep tokens low for speed
        }
    }

    return {
        url: window.location.href,
        domain: window.location.hostname,
        title: document.title,
        headings,
        scroll_info,
        blockers,
        interactive_elements: interactiveElements,
        text_snippets: textSnippets
    };
}

module.exports = { getStateSnapshot, clearAtlasLabels };
