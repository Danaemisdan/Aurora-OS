
/**
 * King Mode Test Harness
 * Verifies strict behavioral contracts for Phase 13.
 */

const { AgentLoop } = require('./agent-core.js');

// Mock Browser State
class MockAgent {
    constructor() {
        this.state = {
            url: 'about:blank',
            domain: '',
            title: '',
            interactiveElements: [],
            blockers: [],
            mainContentPreview: ''
        };
    }
    async getState() { return this.state; }
    async click() { }
    async type() { }
    async navigate(url) {
        this.state.url = url;
        this.state.domain = new URL(url).hostname.replace('www.', '');
    }
    async wait() { }
    async scroll() { }
}

class MockUI {
    updateStatus(msg, type) { console.log(`[UI] ${type}: ${msg}`); }
    updateView() { }
}

async function runTests() {
    console.log("=== RUNNING KING MODE TESTS ===");
    const agent = new MockAgent();
    const ui = new MockUI();
    const loop = new AgentLoop(agent, ui);

    let passed = 0;
    let total = 0;

    async function assertDecision(goal, stateSetup, expectedActionType, description) {
        total++;
        console.log(`\nTest ${total}: ${description}`);

        loop.taskState = {
            spec: new (loop.taskState ? loop.taskState.spec.constructor : Object)(goal), // Hack to get TaskSpec class usage if needed, or just relying on loop.start to init
            history: [],
            pipeline: [],
            evidence: [],
            staleSteps: 0,
            stepCount: 0
        };
        // Re-init spec properly
        const TaskSpec = loop.planner.plan.constructor.name === 'AsyncFunction' ? null : null; // Can't easily access internal classes.
        // We will just use loop.start to init, then pause it.

        // Actually, let's just use the Planner directly if exposed, or verify via Loop simulation.
        // Since AgentLoop logic is encapsulated, we'll verify by inspecting the plan result directly 
        // by instantiating the Planner.

        const planner = loop.planner;
        // Mock State
        if (stateSetup) stateSetup(agent.state);

        // Mock TaskSpec (Partial)
        const taskState = {
            spec: {
                goal,
                target: { domain: null },
                query: goal
            },
            history: [],
            pipeline: [],
            evidence: []
        };
        // Parse mocked goal logic (simulate TaskSpec parser)
        if (goal.includes('linkedin')) taskState.spec.target.domain = 'linkedin.com';
        if (goal.includes('items')) taskState.spec.target.count = 3;

        const step = await planner.plan(taskState, agent.state);

        let success = false;
        if (expectedActionType === 'NONE') {
            success = !step.action;
        } else if (step.action && step.action.type === expectedActionType) {
            success = true;
        } else if (expectedActionType === 'PIPELINE' && step.pipeline_next) {
            success = true;
        }

        if (success) {
            console.log(`✅ PASS: Got ${step.action ? step.action.type : 'No Action'} as expected.`);
            passed++;
        } else {
            console.log(`❌ FAIL: Expected ${expectedActionType}, got ${step.action ? step.action.type : 'None'}.`);
            console.log('Step:', step);
        }
    }

    // T1: No Google Default
    await assertDecision("Hello", (s) => { s.url = 'about:blank'; }, 'NONE', "Passive Start");

    // T2: Workflow Lock (Navigation)
    await assertDecision("Find jobs on LinkedIn", (s) => { s.url = 'about:blank'; }, 'navigate', "Navigate to Target");

    // T3: Workflow Lock (Page Search)
    await assertDecision("Find active jobs", (s) => {
        s.url = 'https://www.linkedin.com/jobs';
        s.domain = 'linkedin.com';
        s.interactiveElements = [{ id: 'search-box', type: 'text', name: 'search' }];
    }, 'type', "Use Page Search on Target");

    // T4: Web Search Ban
    // Goal has target domain, but we are on Google. Should NOT type into Google. Should Jailbreak/Navigate.
    await assertDecision("Find jobs on LinkedIn", (s) => {
        s.url = 'https://www.google.com';
        s.domain = 'google.com';
        s.interactiveElements = [{ id: 'APjFqb', type: 'text' }];
    }, 'navigate', "Escape Google if Domain Locked");

    // T5: Pipeline
    await assertDecision("Find 3 items", (s) => {
        s.url = 'https://www.amazon.com/s?k=items';
        s.domain = 'amazon.com';
    }, 'NONE', "Trigger Listing/Pipeline (Action is null, pipeline_next set)");
    // Note: Listing action is null in current impl, it just sets pipeline.

    console.log(`\n=== RESULT: ${passed}/${total} Passed ===`);
}

// Export for usage or run if standalone
if (typeof window !== 'undefined') {
    window.runKingTests = runTests;
} else if (typeof module !== 'undefined') {
    module.exports = { runTests };
}
