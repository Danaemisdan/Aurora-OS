const fs = require('fs');
const code = fs.readFileSync('src/renderer/renderer.js', 'utf8');
const lines = code.split('\n');
lines.forEach((line, i) => {
    if (line.includes('.addEventListener(')) {
        if (!line.includes('if (') && !line.includes('?.') && /^[ \t]*[a-zA-Z0-9_]+\.addEventListener/.test(line)) {
            console.log((i+1) + ': ' + line.trim());
        } else if (line.includes('document.querySelector') || line.includes('document.getElementById')) {
            console.log((i+1) + ': ' + line.trim());
        }
    }
});
