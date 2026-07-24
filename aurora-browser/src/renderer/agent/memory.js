const MEMORY_STORAGE_KEY = 'aurora-agent-findings';
const MEMORY_TTL_MS = 30 * 60 * 1000; // 30 minutes

class Memory {
    constructor(userGoal, options = {}) {
        this.taskSpec = {
            goal: userGoal,
            success_criteria: "Observable state confirming the goal is achieved",
            scope: options.scope || "page",
            max_steps: options.max_steps || 20,
            allow_domains: options.allow_domains || []
        };
        this.history = [];
        this.findings = this._loadFindings(userGoal);
    }

    // ── localStorage persistence ─────────────────────────────────────────────
    // Restore findings from a previous run of the same goal. Uses first 40 chars
    // of the goal as a fuzzy key. Expires after 30 min to avoid stale pollution.
    _loadFindings(goal) {
        try {
            const raw = localStorage.getItem(MEMORY_STORAGE_KEY);
            if (!raw) return [];
            const stored = JSON.parse(raw);
            if (!stored || !stored.ts || (Date.now() - stored.ts) > MEMORY_TTL_MS) return [];
            const goalKey = goal.toLowerCase().slice(0, 40);
            const storedKey = (stored.goal || '').toLowerCase().slice(0, 40);
            if (goalKey !== storedKey) return [];
            return stored.findings || [];
        } catch (_) {
            return [];
        }
    }

    _saveFindings() {
        try {
            localStorage.setItem(MEMORY_STORAGE_KEY, JSON.stringify({
                goal: this.taskSpec.goal,
                findings: this.findings.slice(-15), // keep last 15 pages
                ts: Date.now()
            }));
        } catch (_) { /* storage full — non-fatal */ }
    }

    addStep(state, decision, verified) {
        this.history.push({
            url: state?.url,
            title: state?.title,
            headings: state?.headings,
            text_snippets: state?.text_snippets,
            action: decision?.action,
            thought: decision?.thought,
            verified
        });
    }

    // Call after visiting each content page to accumulate distilled facts
    addFinding(url, title, facts) {
        if (!url || url === 'about:blank') return;
        // Avoid duplicate findings for the same page
        if (this.findings.some(f => f.url === url)) return;
        this.findings.push({
            url,
            title: title || url,
            facts: facts.filter(Boolean).map(f => f.slice(0, 120)) // cap each fact at 120 chars
        });
        this._saveFindings();
    }

    // Compact digest of all findings for the LLM prompt
    getFindings() {
        if (!this.findings.length) return '';
        return this.findings.map(f =>
            `• [${f.title}]: ${f.facts.join(' | ')}`
        ).join('\n');
    }

    getRecentContext(k = 3) {
        return this.history.slice(-k).map(step => ({
            url: step.url,
            title: step.title,
            action: step.action,
            thought: step.thought
        }));
    }

    // Flat text summary of everything seen so far - for final summarization
    getContentSummary() {
        // Prefer structured findings; fall back to raw snippets
        if (this.findings.length > 0) {
            return this.findings.map(f =>
                `[${f.title || f.url}]: ${f.facts.join(' | ')}`
            ).join('\n');
        }
        return this.history
            .filter(s => s.text_snippets?.length)
            .map(s => `[${s.title || s.url}]: ${s.text_snippets.join(' | ')}`)
            .join('\n');
    }

    // Wipe localStorage findings (call on explicit new task)
    clearStorage() {
        try { localStorage.removeItem(MEMORY_STORAGE_KEY); } catch (_) {}
    }
}

window.Memory = Memory;
