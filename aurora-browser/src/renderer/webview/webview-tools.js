// Tools to act on the webview DOM

const INTERACTIVE_TAGS = ['a', 'button', 'input', 'select', 'textarea', 'details', '[role="button"]', '[role="link"]', '[role="textbox"]', '[role="tab"]'];

function findElementById(id) {
    if (id === null || id === undefined) return null;
    return document.querySelector(`[data-atlas-id="${id}"]`);
}

function webviewNavigate(url) {
    if (!url || typeof url !== 'string') return 'Navigation failed: URL is missing or invalid';
    if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('aurora://')) {
        url = 'https://' + url;
    }
    window.location.href = url;
    return "navigating...";
}

function webviewClick(id) {
    const el = findElementById(id);
    if (!el) throw new Error(`Could not find clickable element with ID: "${id}"`);

    // Force links to open in the same window so the agent doesn't lose track
    const closestAnchor = el.closest ? el.closest('a') : (el.tagName === 'A' ? el : null);
    if (closestAnchor && closestAnchor.hasAttribute('target')) {
        closestAnchor.removeAttribute('target');
    }

    el.focus();
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));

    return `clicked element ID ${id}`;
}

function webviewType(id, valueToType, clearFirst = true) {
    const el = findElementById(id);
    if (!el) throw new Error(`Could not find input with ID: "${id}"`);

    el.focus();
    if (clearFirst) {
        el.value = '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // Use native value setter to work with React-controlled inputs
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set ||
                         Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    if (nativeSetter) {
        nativeSetter.call(el, valueToType);
    } else {
        el.value = valueToType;
    }

    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    
    // Auto-submit if it's a search input
    if (el.tagName === 'INPUT' && (el.type === 'search' || el.id.includes('search') || el.name.includes('q'))) {
        if (el.form) el.form.requestSubmit();
        else el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
    }
    
    return `typed "${valueToType}" into element ID ${id}`;
}

function webviewPress(key) {
    // If an element is active, dispatch keydown to it
    const active = document.activeElement || document.body;
    active.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    active.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
    if (key === 'Enter') {
        if (active.tagName === 'INPUT' && active.form) {
            active.form.requestSubmit();
        } else {
            active.click();
        }
    }
    return "pressed " + key;
}

function webviewScroll(direction, amount) {
    let y = 0; let x = 0;
    if (direction === 'down') y = amount;
    if (direction === 'up') y = -amount;
    if (direction === 'right') x = amount;
    if (direction === 'left') x = -amount;
    window.scrollBy(x, y);
    return "scrolled";
}

function webviewAutofillPayment() {
    // Fugaazi Card Specs
    const fugaziData = {
        name: "Aurora Tester",
        number: "4242424242424242",
        expiry: "12/28",
        cvc: "123",
        zip: "90210"
    };

    let filled = 0;

    // Helper to simulate React/Vue input properly
    const setNativeValue = (element, value) => {
        const valueSetter = Object.getOwnPropertyDescriptor(element, 'value').set;
        const prototype = Object.getPrototypeOf(element);
        const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value').set;

        if (valueSetter && valueSetter !== prototypeValueSetter) {
            prototypeValueSetter.call(element, value);
        } else {
            valueSetter.call(element, value);
        }
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
    };

    // Very heuristic-heavy field finder based on common checkout structures (Amazon, Shopify, Stripe)
    const inputs = document.querySelectorAll('input');

    inputs.forEach(input => {
        const name = (input.name || '').toLowerCase();
        const id = (input.id || '').toLowerCase();
        const placeholder = (input.placeholder || '').toLowerCase();
        const combined = `${name} ${id} ${placeholder}`;

        // 1. Credit Card Number
        if (combined.includes('cardnumber') || combined.includes('card-number') || combined.includes('card_number') || combined.includes('addcreditcardnumber')) {
            setNativeValue(input, fugaziData.number);
            filled++;
        }
        // 2. Name on Card
        else if (combined.includes('nameoncard') || combined.includes('card-name') || combined.includes('ccname')) {
            setNativeValue(input, fugaziData.name);
            filled++;
        }
        // 3. Expiry
        else if (combined.includes('expiry') || combined.includes('exp-date') || combined.includes('expiration')) {
            setNativeValue(input, fugaziData.expiry);
            filled++;
        }
        // 4. CVC
        else if (combined.includes('cvc') || combined.includes('cvv') || combined.includes('securitycode')) {
            setNativeValue(input, fugaziData.cvc);
            filled++;
        }
        // 5. Postal/Zip matching for cards
        else if (input.autocomplete === 'cc-csc' || combined.includes('zip') || combined.includes('postal')) {
            // Basic generic zip fill, careful not to overwrite shipping if already filled
            if (!input.value) {
                setNativeValue(input, fugaziData.zip);
                filled++;
            }
        }
    });

    return `Autofilled ${filled} payment fields with Fugazi data`;
}

function webviewGoBack() {
    window.history.back();
    return "going back...";
}

function webviewOpenTab(url) {
    if (!url || typeof url !== 'string') return 'openTab failed: missing url';
    if (!url.startsWith('http://') && !url.startsWith('https://')) url = 'https://' + url;
    // Send request to renderer to open a new tab
    const { ipcRenderer } = require('electron');
    ipcRenderer.sendToHost('open-new-tab', { url });
    return `Opening new tab: ${url}`;
}

function webviewDownloadImage(id) {
    const el = findElementById(id);
    if (!el) throw new Error(`Could not find element with ID: "${id}"`);
    
    // Find nearest img tag
    const img = el.tagName === 'IMG' ? el : el.querySelector('img') || el.closest('img');
    
    if (!img || !img.src) {
        throw new Error("No image source found in the selected element.");
    }
    
    // Create an invisible link to trigger download
    const a = document.createElement('a');
    a.href = img.src;
    a.download = 'aurora-download.jpg';
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    return `Downloaded image from ${img.src}`;
}

module.exports = {
    webviewNavigate, webviewClick, webviewType, webviewPress, webviewScroll,
    webviewAutofillPayment, webviewGoBack, webviewOpenTab, webviewDownloadImage
};
