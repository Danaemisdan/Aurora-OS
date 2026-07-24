(() => {
    const bus = window.AuroraBus;
    const state = {
        currentTaskId: null,
        lastGoal: '',
        conversationHistory: [],
        lastInputAt: 0,
        userProfileData: {},
        chatSeq: 0
    };

    const STOP_WORDS = ['stop', 'cancel', 'abort', 'nevermind', 'never mind'];
    const APPROVE_WORDS = ['yes', 'approve', 'confirm', 'proceed'];
    const CONTINUE_WORDS = ['continue', 'resume', 'go on', 'next'];

    function normalize(text) {
        return String(text || '').trim();
    }

    function isCommand(text, list) {
        const t = text.toLowerCase();
        return list.some((w) => t === w || t.startsWith(w + ' '));
    }

    function looksLikeFollowUp(text) {
        const short = text.split(/\s+/).filter(Boolean).length <= 6;
        const followWords = /\b(next|second|third|that one|this one|do it|go ahead|continue|resume|same thing)\b/i;
        return short || followWords.test(text);
    }

    function isSmallTalk(text) {
        const t = String(text || '').trim().toLowerCase();
        if (!t) return false;
        return /(hello|hi|hey|how are you|what's up|whats up|good morning|good night|can you hear me|hear me|are you there|test|testing)\b/.test(t);
    }

    function isAmbiguousWindow(text) {
        const t = String(text || '').trim().toLowerCase();
        if (!t) return false;
        if (!/\b(open|close)\b/.test(t)) return false;
        if (!/\bwindow\b/.test(t)) return false;
        const browserHints = /\b(tab|browser|website|site|page|app)\b/;
        return !browserHints.test(t);
    }

    function heuristicIntent(text) {
        const t = text.toLowerCase();
        const urlLike = /\bhttps?:\/\//i.test(t) || /\b[a-z0-9-]+\.[a-z]{2,}(\/|\b)/i.test(t);
        const verbs = /\b(open|go to|navigate|search|find|research|look up|book|buy|order|apply|checkout|compare|show me)\b/i;
        if (urlLike || verbs.test(t)) return 'BROWSER';
        return 'CHAT';
    }

    function needsBrowserClarification(text) {
        const t = text.trim().toLowerCase();
        if (!t) return true;
        const explicit = /^(open|go|go to|navigate|search|find|look up|research)$/i;
        const vague = /^(do it|do that|go there|open it|that one|this one)$/i;
        const urlLike = /\bhttps?:\/\//i.test(t) || /\b[a-z0-9-]+\.[a-z]{2,}(\/|\b)/i.test(t);
        if (urlLike) return false;
        if (explicit.test(t) || vague.test(t)) return true;
        return false;
    }

    async function classifyIntent(text) {
        const fallback = heuristicIntent(text);
        if (fallback === 'BROWSER') return 'BROWSER';
        if (!window.aurora?.aiAsk) return fallback;
        try {
            const res = await window.aurora.aiAsk({ prompt: text, mode: 'classify' });
            if (res?.intent === 'BROWSER' || res?.intent === 'CHAT') return res.intent;
        } catch { /* ignore */ }
        return fallback;
    }

    function newTaskId() {
        return `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    }

    function interrupt(reason = 'interrupt') {
        if (window.agentLoop?.running) {
            try { window.agentLoop.stop(); } catch { /* ignore */ }
        }
        bus?.emit('TTS.STOP', {});
        bus?.emit('AGENT.STOP', { reason });
    }

    function sanitizeChatText(text) {
        const t = String(text || '').trim();
        if (!t) return '';
        if (/(assistant:|user:|conversation|context:|> EOF|EOF by)/i.test(t)) return '';
        return t;
    }

    async function runChat(text, source) {
        const chatId = ++state.chatSeq;
        bus?.emit('CHAT.START', { text, source });
        let answer = '';
        if (window.aurora?.aiAsk) {
            try {
                const res = await window.aurora.aiAsk({
                    prompt: text,
                    mode: 'chat',
                    context: {
                        conversationHistory: state.conversationHistory.slice(-12),
                        userProfileData: state.userProfileData
                    }
                });
                answer = sanitizeChatText(String(res?.answer || '').trim());
            } catch { /* ignore */ }
        }
        if (!answer) answer = 'Okay. How can I help?';
        if (chatId === state.chatSeq && !window.agentLoop?.running) {
            bus?.emit('CHAT.ANSWER', { text: answer, source });
        }
    }

    async function runBrowserTask(text, source) {
        state.chatSeq += 1; // invalidate pending chat responses

        if (window.aurora?.aiStatus) {
            try {
                const status = await window.aurora.aiStatus();
                if (!status?.ready) {
                    bus?.emit('CHAT.ANSWER', {
                        text: status?.warning ||
                            (status?.modelExists
                                ? 'Local model found, but llama-cli is missing. Install llama.cpp and add llama-cli to PATH.'
                                : 'Local model not ready. Install the model and llama-cli first.'),
                        source
                    });
                    return;
                }
            } catch { /* ignore */ }
        }

        const taskId = newTaskId();
        state.currentTaskId = taskId;
        state.lastGoal = text;
        bus?.setTask(taskId);
        bus?.emit('AGENT.START', { text, source });

        if (!window.agentLoop) {
            bus?.emit('AGENT.ERROR', { reason: 'Agent loop not ready. Reload the app or wait a second.' });
            return;
        }

        window.agentLoop.start(text);
    }

    async function handle(rawText, opts = {}) {
        const text = normalize(rawText);
        if (!text) return;

        const source = opts.source || 'text';
        const now = Date.now();
        state.lastInputAt = now;
        state.conversationHistory.push({ role: 'user', content: text, timestamp: now });
        bus?.emit('INPUT.RECEIVED', { text, source });

        // Control commands
        if (isCommand(text, STOP_WORDS)) {
            interrupt('user_stop');
            return;
        }
        if (isCommand(text, APPROVE_WORDS)) {
            if (window.agentLoop) window.agentLoop.start('yes');
            return;
        }
        if (isCommand(text, CONTINUE_WORDS)) {
            if (window.agentLoop) window.agentLoop.start('continue');
            return;
        }

        // Interrupt active agent for new tasks (unless user is approving/continuing)
        if (window.agentLoop && (window.agentLoop.running || window.agentLoop.paused || window.agentLoop.needsApproval)) {
            interrupt('new_input');
        }

        // Ambiguous "window" command — clarify before any follow-up handling
        if (isAmbiguousWindow(text)) {
            bus?.emit('CHAT.ANSWER', {
                text: 'Do you mean a browser window or a physical window? I can only open browser windows.',
                source
            });
            return;
        }

        // If it's a short follow-up and we have a prior task, force browser mode
        if (state.lastGoal && looksLikeFollowUp(text) && !isSmallTalk(text)) {
            await runBrowserTask(`Follow-up to: ${state.lastGoal}. Instruction: ${text}`, source);
            return;
        }

        const intent = await classifyIntent(text);
        if (intent === 'CHAT' || isSmallTalk(text)) {
            await runChat(text, source);
            return;
        }

        if (needsBrowserClarification(text) && !state.lastGoal) {
            const clarify = 'Where should I go or what should I search?';
            bus?.emit('CHAT.ANSWER', { text: clarify, source });
            return;
        }

        let finalText = text;
        if (looksLikeFollowUp(text) && state.lastGoal) {
            finalText = `Follow-up to: ${state.lastGoal}. Instruction: ${text}`;
        }

        await runBrowserTask(finalText, source);
    }

    if (bus) {
        bus.on('CHAT.ANSWER', (evt) => {
            if (!evt?.text) return;
            state.conversationHistory.push({ role: 'assistant', content: evt.text, timestamp: Date.now() });
        });
    }

    window.inputController = { handle, interrupt, state };
})();
