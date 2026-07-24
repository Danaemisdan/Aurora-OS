const fs = require('fs');
let code = fs.readFileSync('/Users/sanjeevn/Downloads/Aurora OS/aurora-browser/src/main.js', 'utf8');

const replacement = `
        const { app } = require('electron');
        const fs = require('fs');
        
        let modelPath = null;
        const possiblePaths = [];
        
        if (app.isPackaged) {
            // Priority 1: Inside the App Bundle Resources (Because we package it via extraResources now!)
            possiblePaths.push(path.join(process.resourcesPath, 'Add-Ons', 'Aurora AI', 'stealth-engine-3b.gguf'));
            
            // Priority 2: Right next to the Aurora OS.app (e.g. inside Shipping folder)
            const exeDir = path.dirname(app.getPath('exe'));
            const appBundleDir = path.join(exeDir, '..', '..', '..');
            possiblePaths.push(path.join(appBundleDir, 'stealth-engine-3b.gguf'));
            
            // Priority 3: User's Documents folder
            possiblePaths.push(path.join(app.getPath('home'), 'Documents', 'Aurora OS', 'stealth-engine-3b.gguf'));
        } else {
            // Local dev paths
            possiblePaths.push(path.join(__dirname, '..', 'Add-Ons', 'Aurora AI', 'stealth-engine-3b.gguf'));
            possiblePaths.push(path.join(__dirname, '..', '..', 'Shipping', 'stealth-engine-3b.gguf'));
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
`;

code = code.replace(/const { app } = require\('electron'\);[\s\S]*?throw new Error\('Local AI model not found\. Checked: ' \+ possiblePaths\.join\(', '\)\);/, replacement.trim());
fs.writeFileSync('/Users/sanjeevn/Downloads/Aurora OS/aurora-browser/src/main.js', code);
