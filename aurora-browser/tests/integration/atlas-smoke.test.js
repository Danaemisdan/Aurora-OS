const fs = require('fs');
const path = require('path');

// Setup a mock browser window environment
global.window = {};

// Load agent files into the global window context
const loadScript = (filename) => {
    const code = fs.readFileSync(path.join(__dirname, '../../src/renderer/agent', filename), 'utf-8');
    eval(code);
};

loadScript('memory.js');
loadScript('policy-linter.js');
loadScript('verifier.js');
loadScript('recovery.js');

function runTests() {
    let passed = 0;
    let failed = 0;

    function assert(condition, message) {
        if (condition) {
            console.log(`✅ ${message}`);
            passed++;
        } else {
            console.error(`❌ ${message}`);
            failed++;
        }
    }

    try {
        console.log("--- Testing Memory ---");
        const mem = new window.Memory("Test goal");
        assert(mem.taskSpec.goal === "Test goal", "Memory initializes taskSpec");
        mem.addStep({}, { action: { tool: 'click' } }, true);
        assert(mem.getRecentContext(1)[0].verified === true, "Memory tracks verified step");

        console.log("--- Testing Policy Linter ---");
        let threw = false;
        try {
            window.lintDecision({ action: [{ tool: 'click' }, { tool: 'navigate' }] }, mem.taskSpec);
        } catch (e) { threw = true; }
        assert(threw, "Linter catches multiple actions array");

        const buyDecision = { action: { tool: 'click', args: { stableId: 'btn-buy-now' } } };
        const lintedBuy = window.lintDecision(buyDecision, mem.taskSpec);
        assert(lintedBuy.needs_approval !== undefined, "Linter forces approval for 'buy' button");

        console.log("--- Testing Verifier ---");
        const state = { url: "https://example.com", domain: "example.com", interactive_elements: [{ stableId: "target-btn", name: "target-btn" }], text_snippets: ["Hello world"] };
        const v1 = window.verifyState(state, { check: 'url_contains', args: { text: 'example' } });
        assert(v1.success, "Verifier logic: url_contains");

        const v2 = window.verifyState(state, { check: 'element_present', args: { stableId: 'wrong' } });
        assert(!v2.success, "Verifier logic: element_present fails when missing");

        const v3 = window.verifyState(state, { check: 'element_present', args: { stableId: 'target-btn' } });
        assert(v3.success, "Verifier logic: element_present succeeds on match");

        console.log("--- Testing Recovery ---");
        const blockState = { blockers: { modal: true }, interactive_elements: [{ name: "Close Dialog", stableId: "close-1" }] };
        const rec = window.getRecoveryAction(blockState, [], { success: false });
        assert(rec && rec.tool === 'click' && rec.args.stableId === 'close-1', "Recovery handles modal close auto-fallback");

    } catch (e) {
        console.error("Test execution failed:", e);
    }

    console.log(`\nResults: ${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
}

runTests();
