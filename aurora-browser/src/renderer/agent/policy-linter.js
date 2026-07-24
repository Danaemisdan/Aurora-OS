// Enforces hard limits on Agent decisions

const COMMIT_WORDS = ['buy', 'purchase', 'pay', 'submit', 'confirm', 'finalize', 'place order', 'checkout'];

function lintDecision(decision, taskSpec) {
    if (!decision) throw new Error("Null decision from LLM");

    // 1. One action per step
    if (decision.action && Array.isArray(decision.action)) {
        throw new Error("Linter violation: Multiple actions found instead of one.");
    }

    // 2. Commit gate: flag destructive/purchase actions for approval
    if (decision.action && decision.action.tool === 'click') {
        const clickText = (decision.action.args?.text || '').toLowerCase();
        const isCommit = COMMIT_WORDS.some(w => clickText.includes(w));
        if (isCommit && !decision.needs_approval) {
            decision.needs_approval = {
                summary: `Confirm action: "${decision.action.args?.text}"`,
                details: { action: decision.action }
            };
        }
    }

    // Note: done without evidence is allowed — the model often can't provide structured evidence

    return decision;
}

window.lintDecision = lintDecision;
