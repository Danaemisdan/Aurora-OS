// Entry point for the webview preload script
const { ipcRenderer, contextBridge } = require('electron');
const { getStateSnapshot, clearAtlasLabels } = require('./state-snapshot.js');
const tools = require('./webview-tools.js');

// Expose to the host window so the renderer can easily call `executeJavaScript('window.__atlas.getState()')`
try {
    contextBridge.exposeInMainWorld('__atlas', {
        getState: getStateSnapshot,
        clearAtlasLabels: clearAtlasLabels,
        navigate: tools.webviewNavigate,
        click: tools.webviewClick,
        type: tools.webviewType,
        press: tools.webviewPress,
        scroll: tools.webviewScroll,
        goBack: tools.webviewGoBack,
        openTab: tools.webviewOpenTab,
        autofillPayment: tools.webviewAutofillPayment,
        download: tools.webviewDownloadImage
    });
} catch (e) {
    // Fallback if contextIsolation is somehow disabled
    window.__atlas = {
        getState: getStateSnapshot,
        clearAtlasLabels: clearAtlasLabels,
        navigate: tools.webviewNavigate,
        click: tools.webviewClick,
        type: tools.webviewType,
        press: tools.webviewPress,
        scroll: tools.webviewScroll,
        goBack: tools.webviewGoBack,
        openTab: tools.webviewOpenTab,
        autofillPayment: tools.webviewAutofillPayment,
        download: tools.webviewDownloadImage
    };
}

// POP-UP DOM OBSERVER
let popupTimeout = null;
const observer = new MutationObserver((mutations) => {
    let popupDetected = false;
    for (const m of mutations) {
        for (const node of m.addedNodes) {
            if (node.nodeType === 1) { // Element
                const tag = node.tagName.toLowerCase();
                const role = node.getAttribute('role');
                const cls = node.className || '';
                if (tag === 'dialog' || role === 'dialog' || role === 'alertdialog' || 
                    (typeof cls === 'string' && (cls.includes('modal') || cls.includes('popup') || cls.includes('overlay')))) {
                    popupDetected = true;
                    break;
                }
            }
        }
        if (popupDetected) break;
    }
    
    if (popupDetected) {
        clearTimeout(popupTimeout);
        popupTimeout = setTimeout(() => {
            ipcRenderer.sendToHost('atlas-dom-changed', { type: 'popup_opened' });
        }, 500);
    }
});

window.addEventListener('DOMContentLoaded', () => {
    observer.observe(document.body, { childList: true, subtree: true });
});

// Also listen to IPC messages just in case mapping needs it directly
ipcRenderer.on('atlas-action', (event, action, args, reqId) => {
    try {
        let result;
        if (action === 'getState') result = getStateSnapshot();
        else if (action === 'navigate') result = tools.webviewNavigate(args.url);
        else if (action === 'click') {
            // If LLM passes a url instead of an ID, treat as navigate
            if (!args.id && !args.text && args.url) result = tools.webviewNavigate(args.url);
            else result = tools.webviewClick(args.id || args.text);
        }
        else if (action === 'type') {
            const target = args.id || args.field_name || args.field || args.text;
            const textToType = args.value || (args.text !== target ? args.text : null);
            if (!target || !textToType) throw new Error("type tool requires both a target ID and a value to type.");
            result = tools.webviewType(target, textToType, args.clearFirst);
        }
        else if (action === 'press') result = tools.webviewPress(args.key);
        else if (action === 'scroll') result = tools.webviewScroll(args.direction, args.amount);
        else if (action === 'goBack') result = tools.webviewGoBack();
        else if (action === 'openTab') {
            // Handled here (not in webview-tools) since ipcRenderer is already imported
            const url = (args?.url || '').startsWith('http') ? args.url : 'https://' + (args?.url || '');
            ipcRenderer.sendToHost('open-new-tab', { url });
            result = `Opening new tab: ${url}`;
        }
        else if (action === 'closeTab') {
            ipcRenderer.sendToHost('close-tab');
            result = `Closing current tab.`;
        }
        else if (action === 'switchTab') {
            ipcRenderer.sendToHost('switch-tab', { tabId: args.tabId });
            result = `Switching to tab ${args.tabId}`;
        }
        else if (action === 'autofillPayment') result = tools.webviewAutofillPayment();

        ipcRenderer.sendToHost('atlas-action-reply', { reqId, success: true, result });
    } catch (e) {
        ipcRenderer.sendToHost('atlas-action-reply', { reqId, success: false, error: e.message });
    }
});
