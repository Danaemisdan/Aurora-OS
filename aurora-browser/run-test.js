const { app, BrowserWindow } = require('electron');
const path = require('path');

app.whenReady().then(() => {
  const win = new BrowserWindow({
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    show: false
  });
  
  win.loadURL('data:text/html,<html><body><button id="b1"></button><div class="modal" style="display:block; opacity: 1;">Popup</div><p id="p1">Hello</p></body></html>').then(() => {
    win.webContents.executeJavaScript(`
      const { getStateSnapshot } = require('${path.join(__dirname, 'src/renderer/webview/state-snapshot.js')}');
      try {
        const s = getStateSnapshot();
        console.log("SUCCESS:", Object.keys(s));
      } catch(e) {
        console.error("ERROR CAUGHT IN EXEC:", e.stack);
      }
    `);
  });
});
