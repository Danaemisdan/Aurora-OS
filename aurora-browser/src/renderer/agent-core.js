/**
 * Aurora Agent Core
 * The strict SEE → THINK → ACT → VERIFY loop.
 * 
 * Design rules (non-negotiable):
 *  1. get_state() on EVERY iteration before deciding
 *  2. decide_next() returns exactly ONE action + ONE verify
 *  3. verify() runs after EVERY action — no exceptions
 *  4. web_search is forbidden when scope is page/site
 *  5. All stop conditions explicit — no random early exits
 */

// ─────────────────────────────────────────────────────────────────────────────
// INTENT CLASSIFIER
// ─────────────────────────────────────────────────────────────────────────────

class IntentClassifier {
    static BROWSER_KEYWORDS = [
        'search', 'find', 'go to', 'navigate', 'open', 'book', 'buy', 'apply',
        'research', 'list', 'top', 'jobs', 'show', 'get', 'look', 'browse'
    ];

    static classify(text) {
        const t = text.trim().toLowerCase();
        if (t === 'continue' || t === 'resume') return 'RESUME_HANDOFF';
        if (t === 'approve' || t === 'yes' || t === 'confirmed') return 'APPROVE_COMMIT';
        if (t === 'stop' || t === 'cancel') return 'STOP';
        if (IntentClassifier.BROWSER_KEYWORDS.some(k => t.includes(k))) return 'BROWSER_REQUIRED';
        return 'BROWSER_REQUIRED';
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// TASK SPEC  (goal + target + constraints)
// ─────────────────────────────────────────────────────────────────────────────

class TaskSpec {
    constructor(goal) {
        this.rawGoal = goal;
        this.goal = goal.toLowerCase();

        // Infer target domain
        this.targetDomain = null;
        for (const [kw, domain] of [
            ['linkedin', 'linkedin.com'],
            ['wellfound', 'wellfound.com'],
            ['amazon', 'amazon.com'],
            ['twitter', 'twitter.com'],
            ['wikipedia', 'wikipedia.org'],
            ['github', 'github.com'],
            ['google', 'google.com'],
        ]) {
            if (this.goal.includes(kw)) { this.targetDomain = domain; break; }
        }

        // Scope: page | site | web
        this.scope = this.targetDomain ? 'site' : 'web';

        // Extract search query (strip site names / task words)
        this.searchQuery = goal
            .replace(/find|search|look for|navigate|go to|on|in|at|linkedin|amazon|wellfound|jobs|apply/gi, '')
            .replace(/\s+/g, ' ')
            .trim() || goal;

        // Count target e.g. "find 5 jobs"
        const m = this.goal.match(/\b(\d+)\s+(?:jobs|results|items|posts)\b/);
        this.targetCount = m ? parseInt(m[1]) : null;

        // Workflow type
        this.workflow = null;
        if (this.goal.includes('job') || this.goal.includes('apply') || this.goal.includes('hiring')) this.workflow = 'jobs';
        else if (this.goal.includes('buy') || this.goal.includes('shop')) this.workflow = 'shopping';
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE CAPABILITIES  (derived from current state)
// ─────────────────────────────────────────────────────────────────────────────

class PageCaps {
    constructor(state) {
        try {
            this.domain = new URL(state.url).hostname.replace('www.', '');
        } catch {
            this.domain = '';
        }
        this.url = state.url;
        this.isSearchEngine = ['google.com', 'bing.com', 'duckduckgo.com'].includes(this.domain);
        this.isBlank = state.url === 'about:blank' || state.url === '';

        // Detect search inputs
        this.searchEl = state.interactiveElements.find(el =>
            (el.type === 'text' || el.type === 'search' || el.tagName === 'input') &&
            (
                el.name?.toLowerCase().includes('search') ||
                el.id?.toLowerCase().includes('search') ||
                el.placeholder?.toLowerCase().includes('search') ||
                el.role === 'searchbox' ||
                el['aria-label']?.toLowerCase().includes('search')
            )
        ) || null;

        // Nav links — useful for finding "Jobs", "Explore" etc.
        this.navLinks = state.interactiveElements.filter(el =>
            el.tagName === 'a' && el.inViewport
        );
    }

    get hasSearchBox() { return !!this.searchEl; }
    get searchBoxId() { return this.searchEl?.id || null; }
}

// ─────────────────────────────────────────────────────────────────────────────
// VERIFIER
// ─────────────────────────────────────────────────────────────────────────────

class Verifier {
    /** Returns {ok: bool, reason: string} */
    static check(condition, state) {
        if (!condition) return { ok: true, reason: 'no_condition' };

        const { type, args = {} } = condition;
        const text = (args.text || '').toLowerCase();
        const content = (state.mainContentPreview || '').toLowerCase();

        switch (type) {
            case 'url_contains':
                const ok1 = state.url.toLowerCase().includes(text);
                return { ok: ok1, reason: ok1 ? 'url_match' : `url_missing:${text}` };

            case 'text_appears':
                const ok2 = content.includes(text);
                return { ok: ok2, reason: ok2 ? 'text_found' : `text_missing:${text}` };

            case 'element_present':
                const el = state.interactiveElements.find(e =>
                    e.id === args.id || e.name === args.name || (e.text || '').toLowerCase().includes(text)
                );
                return { ok: !!el, reason: el ? 'element_found' : `element_missing:${text}` };

            case 'results_present':
                const minLen = args.minLength || 300;
                const ok4 = content.length > minLen;
                return { ok: ok4, reason: ok4 ? 'results_ok' : 'results_empty' };

            case 'no_blocker':
                const blocked = state.blockers && state.blockers.length > 0;
                return { ok: !blocked, reason: blocked ? 'blocker_present' : 'clear' };

            case 'page_changed':
                const changed = state.url !== args.previousUrl;
                return { ok: changed, reason: changed ? 'navigated' : 'url_unchanged' };

            default:
                return { ok: true, reason: 'unknown_type' };
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP DECIDER  (THINK)
// Priority order (strict):
//   0. CLEAR_BLOCKER     — modals, cookies, popups
//   1. HANDOFF           — login / captcha (handled in loop, not here)
//   2. NAVIGATE_TO_TARGET — wrong domain
//   3. JAILBREAK         — stuck on search engine but scope != web
//   4. PAGE_SEARCH       — search input on current page
//   5. SITE_SEARCH       — navigate to target site first
//   6. WEB_SEARCH        — only if scope=web
//   7. PIPELINE step     — listing / shortlist / execute
//   8. EXTRACT           — read / summarize current page
// ─────────────────────────────────────────────────────────────────────────────

class StepDecider {
    static decide(spec, caps, state, memory) {
        // 0. Blocker?
        if (state.blockers && state.blockers.length > 0) {
            return { skill: 'CLEAR_BLOCKER', blocker: state.blockers[0] };
        }

        // 1. Wrong domain — need to navigate
        if (spec.targetDomain && !caps.domain.includes(spec.targetDomain) && !caps.isBlank) {
            if (caps.isSearchEngine) return { skill: 'JAILBREAK' };
            return { skill: 'NAVIGATE_TO_TARGET' };
        }
        if (spec.targetDomain && caps.isBlank) {
            return { skill: 'NAVIGATE_TO_TARGET' };
        }

        // 2. Got to the right domain — now search
        if (!memory.hasSearched) {
            if (caps.hasSearchBox) return { skill: 'PAGE_SEARCH' };
            if (spec.scope === 'site' && spec.targetDomain) return { skill: 'NAVIGATE_TO_TARGET' };
            if (spec.scope === 'web') return { skill: 'WEB_SEARCH' };
        }

        // 3. Pipeline steps
        if (memory.pipeline && memory.pipeline.length > 0) {
            return { skill: memory.pipeline[0] };
        }

        // 4. After searching: listing
        if (memory.hasSearched && !memory.hasExtracted) {
            return { skill: 'EXTRACT_LIST' };
        }

        // 5. After listing: shortlist + execute
        if (memory.evidence.length > 0 && !memory.hasExecuted) {
            return { skill: 'EXECUTE_ITEM' };
        }

        return { skill: 'READ_PAGE' };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// ACTION BUILDER  (converts skill → {action, verify, fallbacks, say})
// ─────────────────────────────────────────────────────────────────────────────

class ActionBuilder {
    static build(decision, spec, caps, state, memory) {
        const { skill } = decision;

        switch (skill) {

            case 'CLEAR_BLOCKER': {
                const b = decision.blocker;
                // Try clicking a close/accept button inside the blocker
                const closeBtn = state.interactiveElements.find(el =>
                    ['close', 'accept', 'agree', 'ok', 'got it', 'dismiss'].some(k => (el.text || '').toLowerCase().includes(k))
                );
                if (closeBtn) {
                    return {
                        say: `Clearing blocker: "${b.text.substring(0, 40)}"`,
                        action: { type: 'click', id: closeBtn.id },
                        verify: { type: 'no_blocker', args: {} },
                        fallbacks: [
                            { action: { type: 'press', key: 'Escape' }, verify: { type: 'no_blocker', args: {} } }
                        ]
                    };
                }
                return {
                    say: 'Pressing Escape to dismiss blocker',
                    action: { type: 'press', key: 'Escape' },
                    verify: { type: 'no_blocker', args: {} },
                    fallbacks: []
                };
            }

            case 'NAVIGATE_TO_TARGET': {
                const path = spec.workflow === 'jobs' ? '/jobs' : '';
                const url = `https://www.${spec.targetDomain}${path}`;
                return {
                    say: `Navigating to ${spec.targetDomain}`,
                    action: { type: 'navigate', url },
                    verify: { type: 'url_contains', args: { text: spec.targetDomain } },
                    fallbacks: [
                        { action: { type: 'wait', ms: 3000 }, verify: { type: 'url_contains', args: { text: spec.targetDomain } } }
                    ]
                };
            }

            case 'JAILBREAK': {
                const url = `https://www.${spec.targetDomain}`;
                return {
                    say: `Escaping search engine → ${spec.targetDomain}`,
                    action: { type: 'navigate', url },
                    verify: { type: 'url_contains', args: { text: spec.targetDomain } },
                    fallbacks: []
                };
            }

            case 'PAGE_SEARCH': {
                return {
                    say: `Searching for "${spec.searchQuery}"`,
                    action: { type: 'type', id: caps.searchBoxId, text: spec.searchQuery, submit: true },
                    verify: { type: 'results_present', args: { minLength: 200 } },
                    fallbacks: [
                        { action: { type: 'wait', ms: 2000 }, verify: { type: 'results_present', args: { minLength: 200 } } }
                    ],
                    setsMemory: { hasSearched: true }
                };
            }

            case 'WEB_SEARCH': {
                // Policy: only allowed if scope === 'web'
                if (spec.scope !== 'web') {
                    return {
                        say: 'Guardrail: web_search blocked (scope is not web)',
                        action: null,
                        verify: null,
                        stop_reason: 'policy_violation'
                    };
                }
                const googleSearchEl = state.interactiveElements.find(e =>
                    e.type === 'search' || e.id?.includes('APjFqb') || e.name === 'q'
                );
                if (!googleSearchEl) {
                    return {
                        say: 'Navigating to Google',
                        action: { type: 'navigate', url: 'https://www.google.com' },
                        verify: { type: 'url_contains', args: { text: 'google.com' } },
                        fallbacks: []
                    };
                }
                return {
                    say: `Web searching "${spec.searchQuery}"`,
                    action: { type: 'type', id: googleSearchEl.id, text: spec.searchQuery, submit: true },
                    verify: { type: 'results_present', args: { minLength: 200 } },
                    fallbacks: [],
                    setsMemory: { hasSearched: true }
                };
            }

            case 'EXTRACT_LIST': {
                // Extract visible list items from page content and elements
                const items = ActionBuilder._extractItems(state);
                return {
                    say: `Extracting list (found ${items.length} items)`,
                    action: null, // pure extraction, no browser action
                    verify: null,
                    evidence: items,
                    setsMemory: { hasExtracted: true, pipeline: items.length > 0 ? ['EXECUTE_ITEM'] : [] }
                };
            }

            case 'EXECUTE_ITEM': {
                const item = memory.evidence[memory.executedCount || 0];
                if (!item || !item.link) {
                    return { say: 'No more items to execute', action: null, stop_reason: 'goal_achieved' };
                }
                return {
                    say: `Opening: "${item.title}"`,
                    action: { type: 'navigate', url: item.link },
                    verify: { type: 'page_changed', args: { previousUrl: state.url } },
                    fallbacks: [],
                    setsMemory: { hasExecuted: true, executedCount: (memory.executedCount || 0) + 1 }
                };
            }

            case 'READ_PAGE': {
                return {
                    say: 'Reading page content',
                    action: null,
                    verify: null,
                    stop_reason: 'goal_achieved'
                };
            }

            default:
                return {
                    say: `Unknown skill: ${skill}`,
                    action: null,
                    verify: null,
                    stop_reason: 'error'
                };
        }
    }

    static _extractItems(state) {
        // Heuristic: find repeated link-like elements with text as "items"
        const items = [];
        const links = state.interactiveElements.filter(el => el.tagName === 'a' && el.href && el.text?.length > 10);
        for (const el of links.slice(0, 20)) {
            items.push({ title: el.text.substring(0, 100), link: el.href });
        }
        return items;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// FLIGHT RECORDER
// ─────────────────────────────────────────────────────────────────────────────

class FlightRecorder {
    constructor() { this.log = []; }
    record(entry) {
        const ts = new Date().toISOString();
        this.log.push({ ts, ...entry });
        console.log(`[Aurora][${entry.event}]`, entry);
    }
    dump() { return JSON.stringify(this.log, null, 2); }
}

// ─────────────────────────────────────────────────────────────────────────────
// AGENT LOOP  (the engine)
// ─────────────────────────────────────────────────────────────────────────────

class AgentLoop {
    constructor(agent, ui) {
        this.agent = agent;
        this.ui = ui;
        this.fr = new FlightRecorder();

        this.running = false;
        this.paused = false;
        this.needsApproval = false;
        this.pendingAction = null;

        this.MAX_STEPS = 25;
        this.STEP_DELAY = 600; // ms between steps
    }

    // ── Public API ──────────────────────────────────────────────────────────

    async start(userMessage) {
        const msg = (userMessage || '').trim();

        // Handle continuation after handoff / approval
        if (this.paused) {
            const intent = IntentClassifier.classify(msg);
            if (intent === 'RESUME_HANDOFF') {
                this.paused = false;
                this.ui.setStatus('Resuming…', 'info');
                this._loop();
            } else {
                this.ui.setStatus('Paused. Say "continue" to resume.', 'warning');
            }
            return;
        }
        if (this.needsApproval) {
            const intent = IntentClassifier.classify(msg);
            if (intent === 'APPROVE_COMMIT') {
                this.needsApproval = false;
                this.ui.setStatus('Approved. Continuing…', 'info');
                if (this.pendingAction) await this._execute(this.pendingAction);
                this.pendingAction = null;
                this._loop();
            } else {
                this.running = false;
                this.needsApproval = false;
                this.pendingAction = null;
                this.ui.setStatus('Action rejected. Stopped.', 'error');
            }
            return;
        }
        if (this.running) { this.ui.setStatus('Already running. Say "stop" to cancel.', 'warning'); return; }

        // Classify intent
        const intent = IntentClassifier.classify(msg);
        this.fr.record({ event: 'intent', intent, msg });

        if (intent === 'STOP') { this.stop(); return; }

        // Start the task
        this.spec = new TaskSpec(msg);
        this.memory = {
            hasSearched: false,
            hasExtracted: false,
            hasExecuted: false,
            executedCount: 0,
            evidence: [],
            pipeline: [],
            steps: 0,
        };

        this.running = true;
        this.ui.setStatus(`▶ Task started`, 'info');
        this.fr.record({ event: 'task_start', goal: msg });

        this._loop();
    }

    stop() {
        this.running = false;
        this.ui.setStatus('Stopped.', 'idle');
        this.fr.record({ event: 'stopped' });
    }

    // ── Core Loop ───────────────────────────────────────────────────────────

    async _loop() {
        while (this.running && !this.paused && !this.needsApproval) {

            // ── SEE ──────────────────────────────────────────────────────────
            let state;
            try {
                state = await this.agent.getState();
            } catch (e) {
                this.ui.setStatus(`State error: ${e.message}`, 'error');
                this.running = false;
                return;
            }

            this.ui.updateView(state);
            this.fr.record({ event: 'see', url: state.url, blockers: state.blockers?.length || 0, elements: state.interactiveElements?.length || 0 });

            // Hard stop conditions BEFORE deciding
            if (this._checkHandoff(state)) return;
            if (this.memory.steps >= this.MAX_STEPS) {
                this.ui.setStatus(`⛔ Max steps (${this.MAX_STEPS}) reached.`, 'warning');
                this.fr.record({ event: 'stop', reason: 'max_steps' });
                this.running = false;
                return;
            }
            this.memory.steps++;

            // ── THINK ────────────────────────────────────────────────────────
            const caps = new PageCaps(state);
            const decision = StepDecider.decide(this.spec, caps, state, this.memory);
            const step = ActionBuilder.build(decision, this.spec, caps, state, this.memory);

            this.ui.setStatus(`🧠 ${step.say}`, 'thinking');
            this.fr.record({ event: 'think', skill: decision.skill, say: step.say });

            // Apply setsMemory immediately (even before act)
            if (step.setsMemory) Object.assign(this.memory, step.setsMemory);
            if (step.evidence) this.memory.evidence.push(...step.evidence);
            if (step.stop_reason) {
                const isSuccess = step.stop_reason === 'goal_achieved';
                this.ui.setStatus(isSuccess ? '✅ Goal achieved!' : `⛔ ${step.stop_reason}`, isSuccess ? 'success' : 'error');
                this.fr.record({ event: 'stop', reason: step.stop_reason });
                this.running = false;
                return;
            }
            if (!step.action) {
                // No browser action this step — just loop again (thinking step)
                await this._delay(this.STEP_DELAY);
                continue;
            }

            // Commit gate check
            if (this._isCommitAction(step.action, state)) {
                this.needsApproval = true;
                this.pendingAction = step.action;
                this.ui.setStatus(`🔐 Approval required. Say "yes" to confirm.`, 'warning');
                this.fr.record({ event: 'commit_gate', action: step.action });
                return;
            }

            // ── ACT ──────────────────────────────────────────────────────────
            this.ui.setStatus(`⚡ ${step.say}`, 'acting');
            this.fr.record({ event: 'act', action: step.action });
            let actErr = null;
            try {
                await this._execute(step.action);
            } catch (e) {
                actErr = e.message;
                this.fr.record({ event: 'act_error', msg: actErr });
            }

            // Brief wait for page to settle
            await this._delay(800);

            // ── SEE AGAIN ────────────────────────────────────────────────────
            const state2 = await this.agent.getState();
            this.ui.updateView(state2);

            // ── VERIFY ───────────────────────────────────────────────────────
            if (step.verify) {
                const result = Verifier.check(step.verify, state2);
                this.fr.record({ event: 'verify', ok: result.ok, reason: result.reason });

                if (!result.ok) {
                    this.ui.setStatus(`⚠ Verify failed: ${result.reason}. Trying fallback…`, 'warning');

                    // Try each fallback in sequence
                    let recovered = false;
                    for (const fb of (step.fallbacks || [])) {
                        this.fr.record({ event: 'fallback', action: fb.action });
                        try {
                            if (fb.action) await this._execute(fb.action);
                        } catch { }
                        await this._delay(800);
                        const state3 = await this.agent.getState();
                        const r2 = fb.verify ? Verifier.check(fb.verify, state3) : { ok: true };
                        if (r2.ok) { recovered = true; break; }
                    }

                    if (!recovered) {
                        // Count stale steps — stop if too many
                        this.memory.staleSteps = (this.memory.staleSteps || 0) + 1;
                        this.fr.record({ event: 'stale', count: this.memory.staleSteps });
                        if (this.memory.staleSteps >= 3) {
                            this.ui.setStatus(`⛔ Stuck after 3 failed verifications. Stopping.`, 'error');
                            this.running = false;
                            return;
                        }
                    } else {
                        this.memory.staleSteps = 0;
                    }
                } else {
                    // Verification passed → reset stale counter
                    this.memory.staleSteps = 0;
                    this.ui.setStatus(`✓ ${step.say}`, 'success');
                }
            }

            // ── PIPELINE advancement ─────────────────────────────────────────
            if (this.memory.pipeline?.length > 0 && this.memory.pipeline[0] === decision.skill) {
                this.memory.pipeline.shift();
            }

            await this._delay(this.STEP_DELAY);
        }
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    _checkHandoff(state) {
        const isAuthWall =
            state.url.includes('/login') ||
            state.url.includes('/signin') ||
            state.url.includes('/auth') ||
            state.url.includes('captcha') ||
            state.blockers?.some(b => b.reason === 'captcha' || (b.text || '').toLowerCase().includes('sign in'));

        if (isAuthWall) {
            this.paused = true;
            this.ui.setStatus('🔑 Handoff: Login / captcha detected. Please complete and say "continue".', 'warning');
            this.fr.record({ event: 'handoff', url: state.url });
            return true;
        }
        return false;
    }

    _isCommitAction(action, state) {
        if (action.type !== 'click') return false;
        const el = state.interactiveElements.find(e => e.id === action.id);
        if (!el) return false;
        const t = (el.text || '').toLowerCase();
        return ['submit', 'send', 'apply now', 'confirm', 'pay', 'buy', 'delete', 'save changes'].some(k => t.includes(k));
    }

    async _execute(action) {
        if (!action) return;
        switch (action.type) {
            case 'navigate': await this.agent.navigate(action.url); break;
            case 'click': await this.agent.click(action.id); break;
            case 'type': await this.agent.type(action.id, action.text, action.submit); break;
            case 'press': if (this.agent.press) await this.agent.press(action.key); break;
            case 'scroll': await this.agent.scroll(action.direction, action.amount); break;
            case 'wait': await this._delay(action.ms || 1000); break;
        }
    }

    _delay(ms) { return new Promise(r => setTimeout(r, ms)); }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT
// ─────────────────────────────────────────────────────────────────────────────

if (typeof module !== 'undefined') module.exports = { AgentLoop, TaskSpec, PageCaps, StepDecider, ActionBuilder, Verifier };
else window.AgentLoop = AgentLoop;
