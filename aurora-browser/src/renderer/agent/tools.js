// Bridges the Agent JSON actions to the actual webview tools mechanism via IPC

async function getWebviewState(webviewEl) {
    return new Promise((resolve, reject) => {
        const reqId = Date.now().toString() + Math.random();

        const timeout = setTimeout(() => {
            webviewEl.removeEventListener('ipc-message', handler);
            reject(new Error("Timeout getting webview state"));
        }, 15000); // 15s — webview can be slow on first call or after navigation

        const handler = (event) => {
            if (event.channel === 'atlas-action-reply' && event.args[0].reqId === reqId) {
                clearTimeout(timeout);
                webviewEl.removeEventListener('ipc-message', handler);
                if (event.args[0].success) resolve(event.args[0].result);
                else reject(new Error(event.args[0].error));
            }
        };
        webviewEl.addEventListener('ipc-message', handler);
        webviewEl.send('atlas-action', 'getState', {}, reqId);
    });
}

async function executeAction(action, webviewEl) {
    if (!action) return null;

    if (action.tool === 'extract_vision') {
        const { ipcRenderer } = require('electron');
        const visionResults = await ipcRenderer.invoke('atlas-vision-ocr');
        // Return a stringified summary of the vision results
        if (!visionResults || visionResults.length === 0) return "No text found on screen via Vision OCR.";
        return "Vision OCR detected text:\n" + visionResults.map(r => `- "${r.text}" at x:${Math.round(r.bounds.x)}, y:${Math.round(r.bounds.y)}`).join('\n');
    }

    return new Promise((resolve) => {
        if (action.tool === 'navigate') {
            try {
                let url = action.args.url;
                if (!url.startsWith('http://') && !url.startsWith('https://')) url = 'https://' + url;
                console.log("NAVIGATING TO:", url);
                webviewEl.src = url;
                resolve("navigating...");
            } catch(e) {
                console.error("NAVIGATION ERROR:", e);
                resolve("Error: " + e.message);
            }
            return;
        }

        const reqId = Date.now().toString() + Math.random();

        const timeout = setTimeout(() => {
            webviewEl.removeEventListener('ipc-message', handler);
            resolve("Error: Action execution timed out");
        }, 10000); // 10s for actions — navigation can take a few seconds

        const handler = (event) => {
            if (event.channel === 'atlas-action-reply' && event.args[0].reqId === reqId) {
                clearTimeout(timeout);
                webviewEl.removeEventListener('ipc-message', handler);
                if (event.args[0].success) resolve(event.args[0].result);
                else resolve("Error: " + event.args[0].error);
            }
        };
        webviewEl.addEventListener('ipc-message', handler);
        webviewEl.send('atlas-action', action.tool, action.args || {}, reqId);
    });
}

window.executeAction = executeAction;
window.getWebviewState = getWebviewState;
