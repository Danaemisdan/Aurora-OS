const electron = require('electron');
console.log('ELECTRON EXPORTS:', electron);
const { app, BrowserWindow, ipcMain, nativeImage, webContents } = electron;
const path = require('path');
const fs = require('fs');
const { Worker } = require('worker_threads');
const { spawn, exec } = require('child_process');
const { autoUpdater } = require('electron-updater');

// Enforce app name
app.setName('Aurora OS');

// --- PERFORMANCE & EVASION FLAGS ---
// Use Chromium defaults for maximum site rendering compatibility.
app.commandLine.appendSwitch('enable-smooth-scrolling');
// V8 Optimization
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=4096');
// Anti-bot evasion: Prevent sites from detecting Electron/Puppeteer
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');


let mainWindow;





function createWindow() {
    const iconPath = path.join(__dirname, '..', 'build', 'icon.png');
    mainWindow = new BrowserWindow({
        icon: iconPath,
        width: 1400,
        height: 900,
        minWidth: 900,
        minHeight: 600,
        frame: false, // Custom titlebar
        titleBarStyle: 'hidden',
        vibrancy: 'fullscreen-ui', // Stronger native blur
        visualEffectState: 'active',
        transparent: true, // CRITICAL: Enables actual transparency
        backgroundColor: '#00000000',
        trafficLightPosition: { x: 12, y: 12 },
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false,
            preload: path.join(__dirname, 'preload.js'),
            webviewTag: true, // Enable webview for browser tabs
            backgroundThrottling: true, // Lower background resource usage
            spellcheck: false, // Reduce overhead
        },
        title: 'Aurora OS',
    });

    mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
        console.log(`[Renderer Console] ${message}`);
    });

    mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

    // Set App Name for Menu
    app.name = 'Aurora Browser';

    // Suppress CSP warnings in the console
    process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true';

    // Only open DevTools in dev mode - set NODE_ENV=development to enable
    if (process.env.NODE_ENV === 'development') {
        mainWindow.webContents.openDevTools();
    }
}

app.whenReady().then(() => {
    // Make the browser appear as a normal human Chrome user, preventing bot detection.
    const chromeUA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
    app.userAgentFallback = chromeUA;

    // Also apply to the default session so all webviews inherit it
    const { session } = require('electron');
    session.defaultSession.setUserAgent(chromeUA);

    // Initialize auto-updater.
    autoUpdater.checkForUpdatesAndNotify();

    // Set dock icon (macOS)
    const iconPath = path.join(__dirname, '..', 'build', 'icon.png');
    if (process.platform === 'darwin') {
        const dockIcon = nativeImage.createFromPath(iconPath);
        if (!dockIcon.isEmpty()) {
            app.dock.setIcon(dockIcon.resize({ width: 512, height: 512, quality: 'best' }));
        }
    }

    createWindow();


    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// IPC handlers for browser controls
ipcMain.handle('navigate', (event, url) => {
    return { success: true, url };
});

ipcMain.handle('get-app-version', () => {
    return app.getVersion();
});




// Window Controls
ipcMain.handle('window-minimize', () => {
    mainWindow.minimize();
});

ipcMain.handle('window-maximize', () => {
    if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
    } else {
        mainWindow.maximize();
    }
});

ipcMain.handle('window-close', () => {
    mainWindow.close();
});

// Local AI LLM integration via Ollama
ipcMain.handle('aurora-ai-ask', async (event, payload) => {
    try {
        const fetch = (await import('node-fetch')).default || global.fetch;
        if (!fetch) throw new Error("Fetch not available");

        const prompt = typeof payload === 'string' ? payload : payload?.prompt || '';

        const response = await fetch('http://127.0.0.1:11434/api/generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'llama3.2', // default model for latest chat
                prompt: `You are Aurora AI, a helpful, simple local AI assistant.\nUser: ${prompt}\nAurora:`,
                stream: false
            })
        });

        if (!response.ok) {
            return "Error: Could not connect to local AI. Please ensure Ollama is running (`ollama serve`).";
        }

        const data = await response.json();
        const textResponse = data.response || "No response generated.";

        // Return object structure if caller expected it
        if (typeof payload === 'object') {
            return { ok: true, answer: textResponse };
        }
        return textResponse;
    } catch (err) {
        return "Error: Could not connect to local AI. Please ensure Ollama is installed and running.";
    }
});

let getLlama = null;
let llamaModel = null;
let llamaContext = null;
let LlamaChatSession = null;
let LlamaJsonSchemaGrammar = null;
let llamaServerInitialising = false;

async function initLlama() {
    if (llamaContext) return;
    if (llamaServerInitialising) {
        while (llamaServerInitialising) await new Promise(r => setTimeout(r, 200));
        return;
    }
    llamaServerInitialising = true;
    try {
        if (!getLlama) {
            const llamaNode = await import("node-llama-cpp");
            getLlama = llamaNode.getLlama;
            LlamaChatSession = llamaNode.LlamaChatSession;
            LlamaJsonSchemaGrammar = llamaNode.LlamaJsonSchemaGrammar;
        }
        const llama = await getLlama();
        
        const { app } = require('electron');
        const fs = require('fs');
        
        let modelPath = null;
        const possiblePaths = [];
        
        if (app.isPackaged) {
            // Priority 1: Inside the App Bundle Resources
            possiblePaths.push(path.join(process.resourcesPath, 'Add-Ons', 'Aurora AI', 'stealth-engine-3b.gguf'));
            
            // Priority 2: Right next to the exe
            const exeDir = path.dirname(app.getPath('exe'));
            const appBundleDir = path.join(exeDir, '..', '..', '..');
            possiblePaths.push(path.join(appBundleDir, 'stealth-engine-3b.gguf'));
            
            // Priority 3: User's Documents folder (cross-platform)
            possiblePaths.push(path.join(app.getPath('documents'), 'Aurora OS', 'stealth-engine-3b.gguf'));
            possiblePaths.push(path.join(app.getPath('home'), 'Documents', 'Aurora OS', 'stealth-engine-3b.gguf'));
        } else {
            // Local dev paths
            possiblePaths.push(path.join(__dirname, '..', 'Add-Ons', 'Aurora AI', 'stealth-engine-3b.gguf'));
            possiblePaths.push(path.join(__dirname, '..', '..', 'Shipping', 'stealth-engine-3b.gguf'));
        }

        // Cross-platform dev model search: ~/Models/llm/ (works on Mac, Windows, Linux)
        const homeModelsDir = path.join(app.getPath('home'), 'Models', 'llm');
        const modelNames = [
            'phi-3-mini-4k-instruct-q4.gguf',
            'phi-3-mini-4k-instruct-q4_K_M.gguf',
            'stealth-engine-3b.gguf',
        ];
        for (const name of modelNames) {
            possiblePaths.push(path.join(homeModelsDir, name));
        }
        // Windows-specific common locations
        if (process.platform === 'win32') {
            for (const name of modelNames) {
                possiblePaths.push(path.join('C:\\', 'Models', 'llm', name));
                possiblePaths.push(path.join(app.getPath('home'), 'AppData', 'Local', 'Aurora OS', 'models', name));
            }
        }

        for (const p of possiblePaths) {
            if (fs.existsSync(p)) {
                modelPath = p;
                console.log('[Llama] Found model at:', p);
                break;
            }
        }

        if (!modelPath) {
            throw new Error('Local AI model not found. Checked: ' + possiblePaths.join(', '));
        }

        // node-llama-cpp auto-selects the right GPU backend per platform:
        //   macOS  → Metal (Apple Silicon)
        //   Windows → CUDA (Nvidia) or Vulkan (AMD/Intel)
        //   Linux  → CUDA or Vulkan
        // If no GPU is available it gracefully falls back to CPU.
        llamaModel = await llama.loadModel({
            modelPath,
            gpuLayers: "max"
        });
        // sequences:1 gives the FULL 4096 tokens to each call
        llamaContext = await llamaModel.createContext({ contextSize: 4096, sequences: 1 });
        console.log('[Llama] Phi-3 Mini warmed and ready.');
    } catch (err) {
        console.error("Llama init failed:", err);
    } finally {
        llamaServerInitialising = false;
    }
}

let globalLlamaSequence = null;
let globalLlamaSession = null;
let llamaCallCount = 0;

ipcMain.handle('atlas-llm-decide', async (event, promptText) => {
    let sequence = null;
    let session = null;
    try {
        llamaCallCount++;
        // Reinitialize model every 8 calls to flush KV cache state
        if (llamaCallCount % 8 === 0 || !llamaContext) {
            if (llamaContext) {
                try { await llamaContext.dispose(); } catch (e) {}
                llamaContext = null;
            }
            if (llamaModel) {
                try { await llamaModel.dispose(); } catch (e) {}
                llamaModel = null;
            }
            await initLlama();
            llamaCallCount = 1; // reset after reinit
        }
        if (!llamaContext) throw new Error("Failed to initialize Llama context");

        // Allocate a fresh sequence for this call — guarantees empty KV cache.
        sequence = llamaContext.getSequence();

        session = new LlamaChatSession({
            contextSequence: sequence,
            systemPrompt: "You are Aurora, an autonomous AI browser agent. You reason step by step, act like a human browsing the web, and always output valid JSON when asked. You never refuse a task. You are concise, direct, and never repeat the prompt back."
        });
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 90000);
        
        let promptToSend = promptText;
        // Hard-cap the prompt to 3000 chars (~750 tokens) to stay within 4096-token context
        const MAX_PROMPT_CHARS = 3000;
        if (promptToSend.length > MAX_PROMPT_CHARS) {
            promptToSend = promptToSend.substring(0, 2000) + '\n...[context trimmed]...\n' + promptToSend.substring(promptToSend.length - 1000);
        }

        let result;
        try {
            result = await session.prompt(promptToSend, {
                temperature: 0.2,
                maxTokens: 1024,
                customStopTriggers: ['<|end|>', '<|endoftext|>', '<|assistant|>', '```', '}\n\n'],
                signal: controller.signal
            });
        } finally {
            clearTimeout(timeoutId);
        }

        console.log("[Llama Output]:", result);
        return typeof result === 'string' ? result : (result?.text || JSON.stringify(result));
    } catch (err) {
        console.error("LLM Generation Error:", err);
        return "Sorry, I took too long to think and timed out! Please try asking again.";
    } finally {
        // ALWAYS dispose sequence and session to free the context slot for the next call.
        // sequence is allocated AFTER any reinit, so it's always from the live context.
        try { if (session) session.dispose(); } catch (e) {}
        try { if (sequence) sequence.dispose(); } catch (e) {}
    }
});

// Per-conversation chat history — kept in memory so Aurora remembers context
const chatHistories = new Map();

ipcMain.on('aurora-chat-stream', async (event, promptText) => {
    let sequence = null;
    try {
        if (!llamaContext) {
            await initLlama();
        }
        if (!llamaContext) throw new Error("Failed to initialize Llama context");

        sequence = llamaContext.getSequence();

        // System prompt that gives Aurora a real identity
        const AURORA_SYSTEM = `You are Aurora, a smart, friendly AI assistant built into the Aurora Browser OS. 
You help users with questions, tasks, and have real conversations. 
Be direct, concise, and genuinely helpful. Never start your response with "Aurora:" or "Aurora AI:" — just answer naturally.
Keep answers short unless the user asks for detail.`;

        const session = new LlamaChatSession({
            contextSequence: sequence,
            systemPrompt: AURORA_SYSTEM,
        });

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 600000);

        let outputBuffer = '';
        let prefixStripped = false;

        await session.prompt(promptText, {
            temperature: 0.75,
            maxTokens: 300,
            signal: controller.signal,
            onTextChunk: (chunk) => {
                outputBuffer += chunk;

                // Strip any hallucinated "Aurora:" or "Aurora AI:" prefix the model might generate
                if (!prefixStripped) {
                    const stripped = outputBuffer.replace(/^(Aurora\s*AI?\s*:\s*)/i, '');
                    if (stripped !== outputBuffer || outputBuffer.length > 20) {
                        prefixStripped = true;
                        // Send what we have after stripping the prefix
                        if (stripped.length > 0) {
                            event.sender.send('aurora-chat-chunk', stripped);
                            outputBuffer = '';
                        }
                    }
                    // Not yet enough buffered to decide — keep buffering
                    return;
                }

                event.sender.send('aurora-chat-chunk', chunk);
            }
        });

        // Flush any remaining buffered text (e.g. if prefix was never found)
        if (outputBuffer.length > 0) {
            const final = outputBuffer.replace(/^(Aurora\s*AI?\s*:\s*)/i, '');
            if (final) event.sender.send('aurora-chat-chunk', final);
        }

        clearTimeout(timeoutId);
        event.sender.send('aurora-chat-done');
    } catch (err) {
        console.error("LLM Chat Error:", err);
        event.sender.send('aurora-chat-error', err.message);
    } finally {
        if (sequence) {
            sequence.dispose();
        }
    }
});

// Capture webview screen for Vision APIs
ipcMain.handle('capture-webview', async (event, webContentsId) => {
    try {
        const wc = webContents.fromId(webContentsId);
        if (!wc) return null;
        const image = await wc.capturePage();

        // Resize to a reasonable width (e.g. 1024) to save API payload size, maintain aspect ratio
        const size = image.getSize();
        if (size.width > 1024) {
            const aspect = size.height / size.width;
            const resized = image.resize({ width: 1024, height: Math.round(1024 * aspect) });
            return resized.toDataURL();
        }

        return image.toDataURL();
    } catch (e) {
        console.error("Failed to capture webview", e);
        return null; // Handle gently
    }
});

// ── Vision OCR (Native Screen Reading) ──────────────────────────────────
ipcMain.handle('atlas-vision-ocr', async (event) => {
    return new Promise((resolve) => {
        const scriptPath = path.join(__dirname, 'main', 'vision-ocr.swift');
        exec(`swift "${scriptPath}"`, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout) => {
            if (error) {
                console.error("Vision OCR Error:", error);
                return resolve([]);
            }
            try {
                // Find the first '[' and last ']' to safely parse the JSON array
                const start = stdout.indexOf('[');
                const end = stdout.lastIndexOf(']');
                if (start !== -1 && end !== -1) {
                    const jsonStr = stdout.substring(start, end + 1);
                    resolve(JSON.parse(jsonStr));
                } else {
                    resolve([]);
                }
            } catch(e) {
                console.error("Vision OCR Parse Error:", e);
                resolve([]);
            }
        });
    });
});

// ── Edge TTS (Microsoft Neural Voices) ────────────────────────────────────
// Uses msedge-tts to generate audio, sends it to renderer as base64
ipcMain.handle('edge-tts-speak', async (event, text) => {
    try {
        const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
        const tts = new MsEdgeTTS();
        // Best neural voice for natural English conversation
        await tts.setMetadata('en-US-AriaNeural', OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

        // Collect audio chunks
        const chunks = [];
        const result = await tts.toStream(text);
        const readable = result.audioStream;

        await new Promise((resolve, reject) => {
            readable.on('data', (chunk) => chunks.push(chunk));
            readable.on('end', resolve);
            readable.on('error', reject);
        });

        const buffer = Buffer.concat(chunks);
        return { ok: true, audio: buffer.toString('base64'), format: 'mp3' };
    } catch (err) {
        console.error('[EdgeTTS] Error:', err.message);
        return { ok: false, error: err.message };
    }
});

// Mono API Integration - Securely handles secret key on the backend
const MONO_SECRET_KEY = process.env.MONO_SECRET_KEY || 'test_sk_l4uox0clqkdoqrib9v9v';

ipcMain.handle('mono-exchange-code', async (event, code) => {
    try {
        const response = await fetch('https://api.withmono.com/account/auth', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'mono-sec-key': MONO_SECRET_KEY
            },
            body: JSON.stringify({ code })
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        return await response.json(); // { id: "account_id" }
    } catch (error) {
        console.error("Mono exchange code error:", error);
        return { error: error.message };
    }
});

ipcMain.handle('mono-fetch-account', async (event, accountId) => {
    try {
        const response = await fetch(`https://api.withmono.com/accounts/${accountId}`, {
            method: 'GET',
            headers: {
                'mono-sec-key': MONO_SECRET_KEY
            }
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        return await response.json();
    } catch (error) {
        console.error("Mono fetch account error:", error);
        return { error: error.message };
    }
});

ipcMain.handle('mono-fetch-all-accounts', async (event) => {
    try {
        let response, retries = 3;
        while (retries > 0) {
            response = await fetch(`https://api.withmono.com/v2/accounts`, {
                method: 'GET',
                headers: {
                    'mono-sec-key': MONO_SECRET_KEY,
                    'Accept': 'application/json'
                }
            });
            if (response.ok) return await response.json();
            if (response.status < 500) break; // Don't retry 4xx errors
            retries--;
            if (retries > 0) await new Promise(r => setTimeout(r, 1000));
        }
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    } catch (error) {
        console.warn("Mono fetch accounts issue:", error.message);
        return { error: error.message };
    }
});
