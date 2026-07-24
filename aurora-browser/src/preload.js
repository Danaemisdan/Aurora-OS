const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');

contextBridge.exposeInMainWorld('aurora', {
    preloadPath: `file://${path.join(__dirname, 'renderer', 'webview', 'dom-preload.js')}`,
    navigate: (url) => ipcRenderer.invoke('navigate', url),
    getVersion: () => ipcRenderer.invoke('get-app-version'),
    minimize: () => ipcRenderer.invoke('window-minimize'),
    maximize: () => ipcRenderer.invoke('window-maximize'),
    close: () => ipcRenderer.invoke('window-close'),
    aiAsk: (prompt) => ipcRenderer.invoke('aurora-ai-ask', prompt),
    atlasLlmDecide: (prompt) => ipcRenderer.invoke('atlas-llm-decide', prompt),
    captureWebview: (id) => ipcRenderer.invoke('capture-webview', id),
    sendChatStream: (prompt) => {
        // Clear all previous listeners before each new chat to prevent accumulation
        ipcRenderer.removeAllListeners('aurora-chat-chunk');
        ipcRenderer.removeAllListeners('aurora-chat-done');
        ipcRenderer.removeAllListeners('aurora-chat-error');
        ipcRenderer.send('aurora-chat-stream', prompt);
    },
    onChatChunk: (callback) => ipcRenderer.on('aurora-chat-chunk', (e, chunk) => callback(chunk)),
    onChatDone: (callback) => ipcRenderer.on('aurora-chat-done', () => callback()),
    onChatError: (callback) => ipcRenderer.on('aurora-chat-error', (e, err) => callback(err)),
    monoExchange: (code) => ipcRenderer.invoke('mono-exchange-code', code),
    monoFetchAccount: (accountId) => ipcRenderer.invoke('mono-fetch-account', accountId),
    monoFetchAllAccounts: () => ipcRenderer.invoke('mono-fetch-all-accounts'),
    edgeTtsSpeak: (text) => ipcRenderer.invoke('edge-tts-speak', text),
    platform: process.platform,
});
