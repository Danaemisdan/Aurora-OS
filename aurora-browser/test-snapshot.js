const jsdom = require("jsdom");
const { JSDOM } = jsdom;
const dom = new JSDOM(`<!DOCTYPE html><html><body><button id="b1"></button><p id="p1">Hello</p></body></html>`);
global.window = dom.window;
global.document = dom.window.document;
global.Node = dom.window.Node;

const { getStateSnapshot } = require('./src/renderer/webview/state-snapshot.js');
try {
    const s = getStateSnapshot();
    console.log("Success!", s.elements.length);
} catch(e) {
    console.error("Error:", e);
}
