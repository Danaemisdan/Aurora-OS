/**
 * run-atlas-bench.js
 * 
 * Simulates a benchmark run of the Atlas Agent Loop by overriding the webview
 * interactions and executing the prompt logic locally against mock state.
 */

const fs = require('fs');
const path = require('path');

// Mock browser window environment
global.window = {
    aurora: {
        captureWebview: async () => "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=" // 1x1 png
    },
    localStorage: {
        getItem: () => process.env.GEMINI_API_KEY || 'MOCK_KEY'
    }
};

const loadScript = (filename) => {
    const code = fs.readFileSync(path.join(__dirname, '../src/renderer/agent', filename), 'utf-8');
    eval(code);
};

loadScript('memory.js');
loadScript('policy-linter.js');
loadScript('step-decider.js');
loadScript('verifier.js');
loadScript('recovery.js');
loadScript('tools.js');
loadScript('agent-loop.js');

// Override LLM call for mock benchmark
window.getDecision = async (state, screenshotB64, taskSpec, memory) => {
    // Artificial latency
    await new Promise(r => setTimeout(r, 1500));
    return {
        say: "Benchmarking step",
        action: { tool: 'click', args: { stableId: 'mock-btn' } },
        verify: { check: 'element_present', args: { stableId: 'mock-next-view' } }
    };
};

// Override webview interactions
window.getWebviewState = async () => {
    return {
        url: "https://benchmark.local",
        domain: "benchmark.local",
        interactive_elements: [],
        text_snippets: [],
        blockers: {}
    };
};
window.executeAction = async () => "success";

async function runBenchmark() {
    console.log("Starting Atlas Benchmark...");
    const agent = new window.AgentLoop();
    let stepsRun = 0;

    agent.init({}, {
        onLog: (m) => console.log(`[LOG] ${m}`),
        onNeedUser: (m) => console.log(`[USER] ${m}`),
        onNeedApproval: async (m) => true,
        onStepEnd: () => stepsRun++
    });

    const start = Date.now();

    // Override max steps for quick bench
    const startPromise = agent.start("Benchmark test");
    agent.memory.taskSpec.max_steps = 3;

    await startPromise;

    const duration = Date.now() - start;
    console.log(`\n--- Benchmark Results ---`);
    console.log(`Expected steps run: 3`);
    console.log(`Total time: ${duration}ms`);
    console.log(`Average step time: ${(duration / 3).toFixed(2)}ms`);
}

runBenchmark();
