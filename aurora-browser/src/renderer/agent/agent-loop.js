// AgentLoop has dependencies loaded globally via script tags

class AgentLoop {
    constructor() {
        this.running = false;
        this.steps = 0;
        this.memory = null;
        this.taskSpec = null;
        this.webviewEl = null;
        this.onLog = (msg) => console.log(msg);
        this.onNeedUser = (msg) => console.log("Needs user: ", msg);
        this.onNeedApproval = async (msg) => { console.log("Needs approval: ", msg); return false; };

        // ── Persistent session state (survives continuations) ─────────────────
        // These are on the instance so a fresh start() call for a follow-up task
        // still knows what URLs have been visited in this browser session.
        this._visitedUrls = new Set();
        this._bannedActions = new Set();
        this._scrollCounts = new Map();
        this._dedupHits = new Map();
        this._ignoredBanHits = new Map();
    }

    init(webviewEl, uiCallbacks) {
        this.webviewEl = webviewEl;
        if (uiCallbacks.onLog) this.onLog = uiCallbacks.onLog;
        if (uiCallbacks.onNeedUser) this.onNeedUser = uiCallbacks.onNeedUser;
        if (uiCallbacks.onNeedApproval) this.onNeedApproval = uiCallbacks.onNeedApproval;
        if (uiCallbacks.onStepStart) this.onStepStart = uiCallbacks.onStepStart;
        if (uiCallbacks.onStepEnd) this.onStepEnd = uiCallbacks.onStepEnd;
    }

    async waitForWebviewReady() {
        return new Promise(resolve => {
            if (!this.webviewEl) return resolve();

            const checkLoad = () => {
                if (!this.webviewEl.isLoading()) {
                    resolve();
                } else {
                    const timeout = setTimeout(() => {
                        this.webviewEl.removeEventListener('did-finish-load', handler);
                        resolve();
                    }, 12000);
                    const handler = () => { clearTimeout(timeout); resolve(); };
                    this.webviewEl.addEventListener('did-finish-load', handler, { once: true });
                }
            };

            // Ensure the webview is attached and dom-ready has fired
            if (typeof this.webviewEl.executeJavaScript !== 'function') {
                const timeout = setTimeout(() => {
                    this.webviewEl.removeEventListener('dom-ready', readyHandler);
                    checkLoad();
                }, 3000);
                const readyHandler = () => {
                    clearTimeout(timeout);
                    checkLoad();
                };
                this.webviewEl.addEventListener('dom-ready', readyHandler, { once: true });
            } else {
                checkLoad();
            }
        });
    }

    async getState() {
        // Retry up to 3 times with increasing delays
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                this.webviewEl = window.getActiveWebview();
                await this.waitForWebviewReady();
                const state = await getWebviewState(this.webviewEl);
                if (!state) throw new Error("Null state returned from webview.");
                return state;
            } catch (e) {
                if (attempt === 3) throw e;
                this.onLog(`⚠️ State fetch failed (attempt ${attempt}/3): ${e.message}. Retrying...`);
                await new Promise(r => setTimeout(r, 1500 * attempt));
            }
        }
    }

    async buildSummaryFromMemory() {
        const goal = (this.taskSpec?.goal || 'the user\'s request')
            .replace(/^\[Context:.*?\] /s, '')  // strip enriched context prefix
            .trim();
        const visited = (this.memory.history || []).filter(h => h.url && h.url !== 'about:blank' && !h.url.includes('google.com'));
        const findings = this.memory.findings || [];

        // ── BUILD RICHEST POSSIBLE DATA BLOCK ────────────────────────────
        // Prefer findings accumulator (pre-distilled, deduped), fall back to raw snippets
        let dataBlock = '';
        if (findings.length > 0) {
            dataBlock = findings.map(f =>
                `[${f.title || f.url}]\n${f.facts.join('\n')}`
            ).join('\n\n');
        } else if (visited.length > 0) {
            // Flatten and deduplicate all snippets across all visited pages
            const allSnips = [...new Set(
                visited.flatMap(h => (h.text_snippets || []).slice(0, 15))
            )].slice(0, 30);
            const allHeadings = [...new Set(
                visited.flatMap(h => h.headings || [])
            )].slice(0, 20);
            dataBlock = `Headings: ${allHeadings.join(', ')}\n\nContent:\n${allSnips.join('\n')}`;
        }

        if (!dataBlock.trim()) return null;

        const prompt = `User asked: "${goal}"

Data collected from visited pages:
${dataBlock}

Write a helpful, natural, and richly detailed answer directly addressing the user's request.
RULES:
- Talk about what you found naturally. Do NOT force a rigid format with tags like "Name:", "Price/Cost:", "Rating:".
- Only include information that is explicitly present in the data.
- NEVER say "I couldn't find any information on X". If you didn't find info for a specific item, simply skip it entirely and DO NOT mention it in your answer! Always be positive and only report what you DID find.
- Use bullet points (•) if you are listing items (e.g., hotels, flights, jobs).
- Do NOT say "Based on the provided data" or "Here is a comprehensive list". Just give the answer directly.
- End with one short, relevant follow-up question.

Answer:`;

        try {
            const response = await window.aurora.atlasLlmDecide(prompt);
            const cleaned = (response || '').trim()
                .replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
            if (cleaned && !cleaned.startsWith('{')) return cleaned;
        } catch (e) {}

        // Fallback: format findings as structured list without LLM
        if (findings.length > 0) {
            const list = findings.map(f => {
                const facts = f.facts.slice(0, 6).map(s => `  • ${s}`).join('\n');
                return `**${f.title || f.url}**\n${facts}`;
            }).join('\n\n');
            return `Here's what I found:\n\n${list}`;
        }

        // Last resort: bullet from raw snippets
        const lines = visited.slice(0, 5).map(h =>
            `• ${h.title || h.url}: ${(h.text_snippets || []).slice(0, 3).join(' • ')}`
        );
        return `Here's what I found:\n\n${lines.join('\n\n')}`;
    }

    async start(userGoal, isContinuation = false) {
        if (this.running) { this.onLog('Agent is already running.'); return; }

        this.running = true;
        
        if (isContinuation && this.memory) {
            this.onLog(`Resuming task with user input: ${userGoal}`);
            this.taskSpec.goal += `\n\nUSER FOLLOW-UP/CLARIFICATION: ${userGoal}`;
            this.waitingForUser = false;
            this.steps = 0; // Reset steps to give full budget for the follow-up task
        } else {
            this.steps = 0;
            this.memory = new Memory(userGoal);
            this.taskSpec = this.memory.taskSpec;
            this.onLog(`Starting task: ${userGoal}`);

            // Clear stale localStorage findings from previous task
            if (this.memory.clearStorage) this.memory.clearStorage();

            // ── RESET: Clear leftover page from previous session ──────────────
            // Without this, the LLM sees the old page and immediately says 'done'
            try {
                if (this.webviewEl) {
                    await executeAction({ tool: 'navigate', args: { url: 'about:blank' } }, this.webviewEl);
                    await new Promise(r => setTimeout(r, 800));
                    await this.waitForWebviewReady();
                }
            } catch (_) {}
        }

        // Per-run state (fresh each start() call but instance-level maps persist)
        let lastActionError = null;

        // On a fresh (non-continuation) task, wipe the session state.
        // On a continuation, keep visited/banned history so loops can't restart.
        if (!isContinuation) {
            this._visitedUrls.clear();
            this._bannedActions.clear();
            this._scrollCounts.clear();
            this._dedupHits.clear();
            this._ignoredBanHits.clear();
        }

        // Aliases for readability inside the loop
        const bannedActions  = this._bannedActions;
        const visitedUrls    = this._visitedUrls;
        const scrollCounts   = this._scrollCounts;
        const dedupHits      = this._dedupHits;
        const ignoredBanHits = this._ignoredBanHits;
        const actionKey = (action) => action ? `${action.tool}:${action.args?.text || action.args?.url || ''}` : 'null:';

        try {
            while (this.running && this.steps < this.taskSpec.max_steps) {
                if (this.onStepStart) this.onStepStart(this.steps);
                this.onLog(`--- Step ${this.steps + 1} / ${this.taskSpec.max_steps} ---`);

                // ── SENSE ──────────────────────────────────────────────────────
                let state;
                try {
                    state = await this.getState();
                } catch (e) {
                    this.onLog(`❌ Could not read page state: ${e.message}`);
                    this.running = false;
                    break;
                }

                // Inject per-step context
                if (lastActionError) { state.last_action_error = lastActionError; lastActionError = null; }
                if (bannedActions.size > 0) state.banned_actions = Array.from(bannedActions);
                if (visitedUrls.size > 0) state.visited_urls = Array.from(visitedUrls).slice(-10); // last 10
                if (window.getBrowserTabs) state.open_tabs = window.getBrowserTabs();

                // Track current URL as visited
                if (state.url && state.url !== 'about:blank') visitedUrls.add(state.url);

                // Removed aggressive early done block to allow the agent to fully decide when it's finished.

                // Removed aggressive early done for single page to force multi-source deep research.

                // When a page is "empty above fold" (JS-heavy, not yet rendered)
                // the LLM tends to open the same page in a new tab. Intercept it:
                // force a scroll-down so content reveals itself naturally.
                const isContentPage = state.url && !state.url.includes('google.') && state.url !== 'about:blank' && !state.url.startsWith('chrome');
                const isEmpty = (!state.interactiveElements || state.interactiveElements.length === 0) &&
                               (!state.interactive_elements || state.interactive_elements.length === 0) &&
                               (state.scroll_info?.canScrollMore === true);
                if (isEmpty && isContentPage && !lastActionError) {
                    this.onLog(`↡ Page empty above fold. Forcing scroll to reveal content.`);
                    await executeAction({ tool: 'scroll', args: { direction: 'down', amount: 800 } }, this.webviewEl);
                    await new Promise(r => setTimeout(r, 600));
                    await this.waitForWebviewReady();
                    // Don't count this as an agent step — just continue the loop with new state
                    continue;
                }

                // Removed flawed "Topic mismatch" auto-pivot logic. The LLM will naturally identify irrelevant pages and navigate away.
                // ── LOOP DETECTION & RECOVERY ─────────────────────────────────
                const history = this.memory.history || [];
                let isStuck = false;
                let stuckKey = '';
                let repeatCount = 0;

                if (history.length >= 1) {
                    const lastKey = actionKey(history[history.length - 1]?.action);
                    if (lastKey !== 'null:') {
                        for (let i = history.length - 1; i >= 0; i--) {
                            if (actionKey(history[i]?.action) === lastKey) {
                                repeatCount++;
                            } else {
                                break;
                            }
                        }
                        if (repeatCount >= 2) {
                            isStuck = true;
                            stuckKey = lastKey;
                        }
                    }
                }

                if (isStuck) {
                    if (repeatCount >= 3) {
                        this.onLog(`🛑 Agent is stubbornly stuck on ${stuckKey}. Force-banning this action.`);
                        bannedActions.add(stuckKey);
                        lastActionError = `SYSTEM OVERRIDE: You are banned from using ${stuckKey}. You used it 3 times and it failed to progress the goal. Use a different tool NOW.`;
                    } else if (this.taskSpec.stuck_recovery !== stuckKey) {
                        this.onLog(`🔄 Appears stuck repeating: ${stuckKey}. Forcing recovery prompt.`);
                        this.taskSpec.stuck_recovery = stuckKey;
                    }
                } else {
                    this.taskSpec.stuck_recovery = null;
                }

                const taskForLLM = isStuck
                    ? { ...this.taskSpec, stuck_recovery: `You have repeated "${stuckKey}" multiple times with no result. This action is now BANNED. You MUST choose a completely different tool or target (e.g. if you were scrolling, you MUST click or type now; if you were clicking, you MUST scroll or goBack).` }
                    : this.taskSpec;

                // ── THINK ──────────────────────────────────────────────────────
                this.onLog(`💡 Aurora is thinking...`);
                let decision;
                try {
                    decision = lintDecision(await getDecision(state, null, taskForLLM, this.memory), this.taskSpec);
                } catch (e) {
                    this.onLog(`❌ LLM error: ${e.message}`);
                    this.running = false;
                    break;
                }
                if (!this.running) break;

                // ── HARD OVERRIDE: ban repeated stuck action ───────────────────
                const decidedKey = actionKey(decision.action);
                if (bannedActions.has(decidedKey)) {
                    const ignoreHits = (ignoredBanHits.get(decidedKey) || 0) + 1;
                    ignoredBanHits.set(decidedKey, ignoreHits);
                    this.onLog(`⚠️ LLM ignored ban on "${decidedKey}" (attempt ${ignoreHits}).`);

                    if (ignoreHits >= 2) {
                        // Model cannot break this loop on its own. Force a recovery action.
                        this.onLog(`🚨 Force-recovery: LLM repeated banned action ${ignoreHits} times. Bypassing LLM.`);
                        const isOnContentPage = state?.url &&
                            !state.url.includes('google.com') &&
                            state.url !== 'about:blank';

                        if (isOnContentPage) {
                            // The agent is hopelessly stuck on a content page (probably trying to finish early).
                            // Force it to close the tab and return to Google to find more sources.
                            this.onLog(`🔙 Force-recovery: Stuck on content page. Forcing tab close to return to search.`);
                            await executeAction({ tool: 'closeTab', args: {} }, this.webviewEl);
                            await new Promise(r => setTimeout(r, 600));
                            if (window.getActiveWebview) {
                                this.webviewEl = window.getActiveWebview();
                            }
                            await this.waitForWebviewReady();
                            bannedActions.clear();
                            ignoredBanHits.clear();
                            lastActionError = null;
                            this.memory.addStep(state, { action: { tool: 'closeTab', args: {} } }, true);
                            this.steps++;
                        } else {
                            // On Google or blank
                            if (state?.url && state.url.includes('google.')) {
                                // Stuck on Google? Force it into the first organic search result
                                const firstLink = (state.interactiveElements || state.interactive_elements || []).find(e => e.url && !e.url.includes('google.'));
                                if (firstLink) {
                                    this.onLog(`🔥 Force-recovery: Opening first search result: ${firstLink.url}`);
                                    decision.action = { tool: 'openTab', args: { url: firstLink.url } };
                                    await executeAction(decision.action, this.webviewEl);
                                    await new Promise(r => setTimeout(r, 400));
                                    await this.waitForWebviewReady();
                                    bannedActions.clear();
                                    ignoredBanHits.clear();
                                    lastActionError = null;
                                    this.memory.addStep(state, decision, true);
                                    this.steps++;
                                } else {
                                    this.onLog(`🔥 Force-recovery: No links found, navigating to a fresh search.`);
                                    const recoveryUrl = `https://www.google.com/search?q=${encodeURIComponent(this.taskSpec.goal)}`;
                                    await executeAction({ tool: 'navigate', args: { url: recoveryUrl } }, this.webviewEl);
                                    await new Promise(r => setTimeout(r, 400));
                                    await this.waitForWebviewReady();
                                    bannedActions.clear();
                                    ignoredBanHits.clear();
                                    lastActionError = null;
                                    this.memory.addStep(state, { action: { tool: 'navigate', args: { url: recoveryUrl } } }, false);
                                    this.steps++;
                                }
                            } else {
                                const recoveryUrl = `https://www.google.com/search?q=${encodeURIComponent(this.taskSpec.goal)}`;
                                await executeAction({ tool: 'navigate', args: { url: recoveryUrl } }, this.webviewEl);
                                await new Promise(r => setTimeout(r, 400));
                                await this.waitForWebviewReady();
                                bannedActions.clear();
                                ignoredBanHits.clear();
                                lastActionError = null;
                                this.memory.addStep(state, { action: { tool: 'navigate', args: { url: recoveryUrl } } }, false);
                                this.steps++;
                            }
                        }
                    } else {
                        lastActionError = `BANNED: "${decidedKey}" is permanently blocked. Choose something ENTIRELY different — scroll down, read results, or navigate to a new URL.`;
                    }
                    continue;
                }

                // ── LOG THOUGHT ────────────────────────────────────────────────
                if (decision.thought_process) {
                    this.onLog(`🧠 ${decision.thought_process.intent_analysis}`);
                    this.onLog(`🔍 ${decision.thought_process.dom_evaluation}`);
                }
                if (decision.thought) this.onLog(`💬 ${decision.thought}`);

                // ── HANDLE NEEDS_USER ──────────────────────────────────────────
                if (decision.needs_user) {
                    const hasHistory = (this.memory.history || []).length > 0;
                    // Also block needs_user when on a relevant content page (not blank/Google)
                    const pageIsRelevant = state?.url &&
                        state.url !== 'about:blank' &&
                        !state.url.startsWith('chrome') &&
                        (state.interactiveElements || state.interactive_elements || []).length > 0;

                    if (hasHistory || pageIsRelevant) {
                        // Mid-task OR already on a relevant page — NEVER stop to ask the user.
                        const richPages = (this.memory.history || []).filter(h =>
                            h.url && !h.url.includes('google.com') && (h.text_snippets || []).length >= 2
                        );
                        if (richPages.length >= 1) {
                            // Have usable data — wrap up now
                            this.onLog('✅ Compiling results from collected data...');
                            this.running = false;
                            const summary = await this.buildSummaryFromMemory();
                            this.onLog(`Goal complete: ${summary}`);
                            break;
                        } else {
                            // No data yet — force recovery, keep going
                            this.onLog('⚠️ Agent tried to ask for input. Forcing recovery from page context.');
                            lastActionError = 'RULE VIOLATION: Do NOT ask the user for input. The goal and page context are clear. Read the current page, use the context provided, and proceed toward the goal immediately.';
                            this.memory.addStep(state, decision, false);
                            this.steps++;
                            continue;
                        }
                    }
                    // Step 0, blank page, genuinely unanswerable — valid clarification
                    this.onNeedUser(decision.needs_user);
                    this.waitingForUser = true;
                    this.running = false;
                    break;
                }

                // ── HANDLE DONE ────────────────────────────────────────────────
                // ── HANDLE DONE ────────────────────────────────────────────────
                if (decision.done) {
                    // Calculate how many unique non-Google websites the agent has actually visited
                    const uniqueDomains = new Set();
                    (this.memory.history || []).forEach(h => {
                        if (h.url && h.url !== 'about:blank' && !h.url.includes('google.') && !h.url.includes('localhost')) {
                            try {
                                let host = new URL(h.url).hostname.replace(/^www\./, '');
                                uniqueDomains.add(host);
                            } catch (e) {
                                // Ignore invalid URLs
                            }
                        }
                    });

                    // Check if task is likely complex research needing multiple sources
                    const isResearch = /flight|hotel|compare|find|list|best|top|recipe|news|price/i.test(this.taskSpec.goal);

                    // If it's a research task, but it visited fewer than 2 sites, it's hallucinating or being lazy
                    if (isResearch && uniqueDomains.size < 2) {
                        this.onLog(`⚠️ LLM tried to finish research after ${uniqueDomains.size} sources. Forcing multiple sources.`);
                        lastActionError = `RULE VIOLATION: You are attempting to summarize research after visiting only ${uniqueDomains.size} sources! Do NOT hallucinate data from Google. You MUST physically click links, open tabs, scroll through them, and cross-reference at least 2 to 3 DIFFERENT websites before you are allowed to use 'done'. Use 'navigate' or 'openTab' to continue searching.`;
                        this.memory.addStep(state, decision, false);
                        this.steps++;
                        continue;
                    }
                    
                    // If it visited exactly 1 site for a non-research task, still block it to be safe
                    if (!isResearch && uniqueDomains.size === 1) {
                        this.onLog(`⚠️ LLM tried to finish after only 1 source. Forcing multiple sources.`);
                        lastActionError = `RULE VIOLATION: You are attempting to summarize after visiting only 1 source! You MUST return to Google and open a DIFFERENT source to verify the information before you use 'done'.`;
                        this.memory.addStep(state, decision, false);
                        this.steps++;
                        continue;
                    }

                    let result = decision.done;
                    this.running = false; // release lock before async summary
                    if (typeof result === 'boolean' && result === true) {
                        result = await this.buildSummaryFromMemory() || 'Task complete.';
                    } else if (typeof result === 'object') {
                        result = result.result || JSON.stringify(result);
                    }
                    this.onLog(`Goal complete: ${result}`);
                    break;
                }

                // ── HANDLE NULL ACTION ─────────────────────────────────────────
                if (!decision.action) {
                    const hasData = (this.memory.history || []).some(h => h.url && !h.url.includes('google.com') && (h.text_snippets || []).length >= 2);
                    if (hasData) {
                        this.running = false;
                        const summary = await this.buildSummaryFromMemory();
                        this.onLog(`Goal complete: ${summary || 'Done.'}`);
                        break;
                    } else {
                        this.onLog(`⚠️ LLM output action: null. Forcing retry.`);
                        lastActionError = `RULE VIOLATION: You output action: null, but you have NOT collected enough data to answer the user! You MUST provide a valid tool action (like 'navigate' to try a new search query, or 'openTab' to read a result).`;
                        this.memory.addStep(state, decision, false);
                        this.steps++;
                        continue;
                    }
                }

                // ── AUTO-UPGRADE CLICK → OPENTAB ──────────────────────────────
                if (decision.action.tool === 'click' && decision.action.args?.text) {
                    const clickText = decision.action.args.text;
                    const elements = state.interactiveElements || state.interactive_elements || [];

                    // Exact or prefix match with URL
                    const exactMatch = elements.find(e =>
                        e.url && (
                            e.name === clickText ||
                            (e.name && clickText && e.name.includes(clickText.slice(0, 30)))
                        )
                    );
                    if (exactMatch?.url) {
                        this.onLog(`🔄 Auto-upgrading click → openTab: ${exactMatch.url}`);
                        decision.action = { tool: 'openTab', args: { url: exactMatch.url } };
                    } else {
                        // On Google pages: heading elements are spans, not <a> tags.
                        // Find the nearest non-Google URL by fuzzy text match.
                        const isOnGoogle = state.url?.includes('google.com');
                        if (isOnGoogle) {
                            const words = clickText.toLowerCase().split(/\s+/).filter(w => w.length > 3);
                            const fuzzyMatch = elements.find(e =>
                                e.url && words.some(w => (e.name || e.url).toLowerCase().includes(w))
                            );
                            if (fuzzyMatch?.url) {
                                this.onLog(`🔄 Google-page fuzzy click → openTab: ${fuzzyMatch.url}`);
                                decision.action = { tool: 'openTab', args: { url: fuzzyMatch.url } };
                            } else {
                                // Can't resolve — force ban it immediately so it doesn't infinite loop
                                const errKey = actionKey(decision.action);
                                bannedActions.add(errKey);
                                lastActionError = `BANNED: On Google search pages, do NOT use 'click' for "${clickText}" because it has no URL. You must scroll, or use 'openTab' with a visible URL.`;
                                this.onLog(`⚠️ Fuzzy click failed for "${clickText}". Banning action.`);
                                this.memory.addStep(state, decision, false);
                                this.steps++;
                                continue;
                            }
                        }
                    }
                }

                // ── HANDLE ARRAY openTab (LLM passes multiple URLs) ──────────
                if (decision.action.tool === 'openTab' && Array.isArray(decision.action.args?.url)) {
                    const urls = decision.action.args.url.filter(u => typeof u === 'string' && u.startsWith('http'));
                    if (urls.length === 0) { 
                        bannedActions.add(actionKey(decision.action));
                        lastActionError = 'BANNED: openTab received no valid URLs. Do not pass an empty array or invalid URLs.'; 
                        this.memory.addStep(state, decision, false);
                        this.steps++;
                        continue; 
                    }
                    this.onLog(`📑 Opening ${urls.length} tabs in sequence.`);
                    const normalize = (u) => { try { const p = new URL(u); return p.hostname + p.pathname.replace(/\/$/, ''); } catch { return u; } };
                    for (const url of urls) {
                        if (Array.from(visitedUrls).some(v => normalize(v) === normalize(url))) {
                            this.onLog(`⏭ Skipping already-visited: ${url}`); continue;
                        }
                        this.onLog(`⚙️ openTab: ${url}`);
                        await executeAction({ tool: 'openTab', args: { url } }, this.webviewEl);
                        visitedUrls.add(url);
                        await new Promise(r => setTimeout(r, 800));
                    }
                    this.memory.addStep(state, decision, true);
                    this.steps++;
                    if (this.onStepEnd) this.onStepEnd(this.steps);
                    continue;
                }

                // ── HARD INTERCEPT: Block Google → Google navigation ──────────
                // If already on Google and LLM tries to navigate/openTab to another
                // Google URL, that's a panic loop. Force it to click an organic result.
                if ((decision.action.tool === 'navigate' || decision.action.tool === 'openTab') &&
                    decision.action.args?.url?.includes('google.')) {
                    const currentUrl = state.url || '';
                    if (currentUrl.includes('google.')) {
                        const elements = state.interactiveElements || state.interactive_elements || [];
                        const firstOrganic = elements.find(e =>
                            e.url && !e.url.includes('google.') && e.url.startsWith('http')
                        );
                        if (firstOrganic) {
                            this.onLog(`🔄 Intercepted Google→Google loop. Force-opening organic: ${firstOrganic.url}`);
                            decision.action = { tool: 'openTab', args: { url: firstOrganic.url } };
                            lastActionError = null;
                        } else {
                            this.onLog(`🔄 On Google but no organic links yet — scrolling to reveal results.`);
                            await executeAction({ tool: 'scroll', args: { direction: 'down', amount: 800 } }, this.webviewEl);
                            await new Promise(r => setTimeout(r, 600));
                            await this.waitForWebviewReady();
                            lastActionError = `You are already on Google Search. Do NOT navigate to Google again. Scroll down and use openTab on one of the organic search result URLs you see in interactive_elements.`;
                            this.memory.addStep(state, decision, false);
                            this.steps++;
                            continue;
                        }
                    }
                }

                // ── DEDUP: Block re-opening visited URLs ──────────────────────
                if ((decision.action.tool === 'openTab' || decision.action.tool === 'navigate') && decision.action.args?.url) {
                    const targetUrl = decision.action.args.url;
                    const normalize = (u) => { try { const p = new URL(u); return p.hostname + p.pathname.replace(/\/$/, ''); } catch { return u; } };
                    const normKey = normalize(targetUrl);
                    const alreadyVisited = Array.from(visitedUrls).some(v => normalize(v) === normKey);
                    if (alreadyVisited) {
                        const hits = (dedupHits.get(normKey) || 0) + 1;
                        dedupHits.set(normKey, hits);
                        this.onLog(`🚫 Blocking duplicate URL (attempt ${hits}): ${targetUrl}`);

                        // Check if the current page already has relevant form inputs
                        const currentInputs = (state.interactiveElements || state.interactive_elements || [])
                            .filter(e => e.type); // inputs and textareas
                        const hasForms = currentInputs.length > 0;

                        if (hits >= 2) {
                            // Normalized ban — blocks ALL URLs with same hostname+path, regardless of query params
                            bannedActions.add(`${decision.action.tool}:${normKey}`);
                            if (hasForms) {
                                const inputNames = currentInputs.slice(0, 3).map(e => `"${e.name || e.placeholder || e.type}"`).join(', ');
                                lastActionError = `BANNED: You keep opening the same page. You are ALREADY on it. The page has form inputs: ${inputNames}. Use 'type' to fill them with the goal parameters, then press Enter or click the search/submit button. DO NOT open another tab.`;
                            } else {
                                lastActionError = `BANNED: You have tried to open ${normKey} ${hits} times. It is permanently blocked. Navigate back to Google and choose a DIFFERENT result URL.`;
                            }
                        } else {
                            if (hasForms) {
                                lastActionError = `You are already on this page. It has form input fields — use 'type' to fill the relevant fields (e.g. destination, dates) and then 'press' Enter or 'click' the search button.`;
                            } else {
                                lastActionError = `ERROR: You already visited ${normKey}. Do NOT open it again. Choose a different URL from the search results.`;
                            }
                        }
                        this.memory.addStep(state, decision, false);
                        this.steps++;
                        continue;
                    }
                    // Pre-register URL immediately to close race window
                    visitedUrls.add(targetUrl);
                }

                // ── VALIDATE TYPE FIELD EXISTS ON PAGE ────────────────────────
                if (decision.action.tool === 'type' && decision.action.args?.text) {
                    const targetField = decision.action.args.text;
                    const elements = state.interactiveElements || state.interactive_elements || [];
                    const availableInputs = elements.filter(e => e.type);

                    // On Google search pages, there are no booking form inputs — never type here
                    if (state.url?.includes('google.')) {
                        lastActionError = `RULE: On Google search pages, do NOT use 'type'. Instead use 'openTab' with a URL from the interactive_elements list to navigate to an actual website.`;
                        this.memory.addStep(state, decision, false);
                        this.steps++;
                        continue;
                    }

                    const match = availableInputs.find(e =>
                        e.name === targetField ||
                        (e.name && targetField && (
                            e.name.toLowerCase().includes(targetField.toLowerCase().slice(0, 15)) ||
                            targetField.toLowerCase().includes(e.name.toLowerCase().slice(0, 10))
                        ))
                    );

                    if (!match) {
                        // Check if the target matches a BUTTON or LINK on the page
                        // LLM often says 'type "Apply for job"' when it should say 'click "Apply for job"'
                        const asClickable = elements.find(e =>
                            !e.type && (
                                e.name === targetField ||
                                (e.name && e.name.toLowerCase().includes(targetField.toLowerCase().slice(0, 20)))
                            )
                        );
                        if (asClickable) {
                            this.onLog(`🔄 Auto-upgrading type → click: "${targetField}" is a button/link, not an input.`);
                            decision.action = { tool: 'click', args: { text: targetField } };
                            // fall through to click handling below
                        } else {
                            const available = availableInputs.slice(0, 5).map(e => `"${e.name || e.type}"`).join(', ');
                            lastActionError = `ERROR: Input field "${targetField}" does not exist on this page. Available inputs: ${available || 'none'}. Use the EXACT field name from interactive_elements, or scroll down to find the form, or navigate to a different URL.`;
                            this.memory.addStep(state, decision, false);
                            this.steps++;
                            continue;
                        }
                    }
                }

                // ── VALIDATE SCROLL ACTIONS ───────────────────────────────────
                if (decision.action.tool === 'scroll') {


                    const currentUrl = state.url || 'unknown';
                    const count = scrollCounts.get(currentUrl) || 0;
                    if (count >= 5) {
                        this.onLog(`🚫 Scroll limit reached for ${currentUrl}. Moving on.`);
                        lastActionError = `You have scrolled this page 5 times. Stop scrolling. Extract what you have and open a different URL.`;
                        this.memory.addStep(state, decision, false);
                        this.steps++;
                        continue;
                    }
                    scrollCounts.set(currentUrl, count + 1);
                }

                // ── ACT ────────────────────────────────────────────────────────
                this.onLog(`⚙️ ${decision.action.tool}: ${JSON.stringify(decision.action.args)}`);
                const result = await executeAction(decision.action, this.webviewEl);
                if (result && typeof result === 'string' && result.startsWith('Error:')) {
                    this.onLog(`⚠️ Action failed: ${result}`);
                    lastActionError = result;
                }

                if (!this.running) break;

                // Brief pause for page to react, then wait for load
                await new Promise(r => setTimeout(r, 400));
                if (window.getActiveWebview) {
                    this.webviewEl = window.getActiveWebview();
                }
                await this.waitForWebviewReady();

                this.memory.addStep(state, decision, true);
                this.steps++;
                if (this.onStepEnd) this.onStepEnd(this.steps);

                // ── STREAMING FINDINGS ACCUMULATOR ────────────────────────────
                // After each page visit, distill key facts into memory.findings.
                // No LLM cost — just structured extraction. Used by buildSummaryFromMemory
                // and shown as a compact digest in subsequent LLM prompts.
                try {
                    const postState = await this.getState();
                    if (postState?.url && !postState.url.includes('google.') && postState.url !== 'about:blank') {
                        const facts = (postState.text_snippets || []).slice(0, 6);
                        if (facts.length > 0) this.memory.addFinding(postState.url, postState.title, facts);
                    }
                } catch (_) { /* silent — non-critical */ }
            }

            // ── MAX STEPS: compile summary ─────────────────────────────────────
            if (this.running && this.steps >= this.taskSpec.max_steps) {
                this.onLog('Step limit reached. Compiling results...');
                this.running = false; // release lock before async call
                const summary = await this.buildSummaryFromMemory();
                this.onLog(`Goal complete: ${summary || 'I reached the step limit but couldn\'t extract a clear result. Try a more specific query.'}`);
            }

        } catch (e) {
            this.onLog(`Agent Error: ${e.message}`);
        } finally {
            this.running = false;
            this.onLog("Agent loop finished.");
        }
    }

    stop() {
        this.running = false;
        this.onLog("Agent stopped by user.");
    }
}

window.AgentLoop = AgentLoop;
