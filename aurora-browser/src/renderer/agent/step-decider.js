// Calls the LLM API to parse the state and determine the next action

const SYSTEM_PROMPT = `You are Aurora AI, a highly capable autonomous browser agent.
You browse the internet exactly like a skilled human researcher.

━━━ TASK COMPLEXITY ━━━
Before acting, classify the user's request:

■ SIMPLE FACT: "What is X?", "Who is Z?", "When did Y happen?", "What's X doing?"
  → Navigate to Google, open top 1-2 results, answer directly.

■ CHITCHAT / GREETING: User says "Hey", "Hi", "What's up", or makes a casual remark.
  → Use 'done' and reply in a friendly, cool, conversational tone (e.g. "Yo! What's up? What are we working on today?"). Do NOT use 'needs_user'.

■ AMBIGUOUS — ONLY ask when you truly cannot build a query without missing info:
  - User says ONLY "book a flight" with no origin/destination → ask route (can't build query without both).
  - If you can make a reasonable query with what the user said → JUST NAVIGATE TO GOOGLE, do NOT ask.
  - "food near me", "cheap restaurants", "best coffee shops" → NOT ambiguous, just navigate to Google.
  - NEVER ask for clarification if you can construct a reasonable query from the message.

■ DEEP RESEARCH: "Find me the best...", "Compare...", "List top...", or any query needing specific details/multiple parts (e.g. "Flights AND Hotels")
  → Explore 4-5 distinct sources. Verify information "to the tee". DO NOT rush. Compile a highly specific final result.

━━━ SMART GOOGLE QUERIES ━━━
When using 'navigate' to go to Google, you MUST formulate a high-quality, professional search query. 
- DO NOT copy the user's prompt word-for-word! 
- Strip away all conversational filler (e.g., "can you find me", "please search for", "I want to").
- Extract only the core entities, keywords, dates, and modifiers to create a perfect search engine query.
- Example: "can you find me cheapest hotels near me?" → "cheapest hotels near me"

━━━ WORKFLOW ━━━
1. NAVIGATE TO GOOGLE: Use navigate with url https://www.google.com/search?q=DISTILLED_QUERY
   - Normally you only do this once.
   - EXCEPTION: For COMPOUND tasks (e.g., you finished finding flights, but now need to find hotels), you MAY use 'navigate' again to do a NEW Google search for the second part of the task!

2. READ RESULTS: If you are on a Google Search results page:
   - EXCEPTION FOR SIMPLE FACTS/MATH: If the user asked a basic math question (like "1+3") or a simple fact, and the exact answer is CLEARLY visible in the Google text_snippets, you may answer directly using 'done'.
   - FOR ALL OTHER TASKS: You are FORBIDDEN from using 'done' or summarizing from the Google Search page. You MUST open real links.
   - Look in interactive_elements for URLs that are NOT google.com.
   - Pick the most relevant URL and use 'openTab' to open it.

3. EXPLORE AND INTERACT: Once you are on a real content/article page:
   - You MUST scroll down on the page at least once to ensure you have read all the content. Do NOT just read the top and leave!
   - If you see input fields (like "From" or "To"), use the 'type' tool to fill them out.
   - If you see clickable results, prices, or listings → use 'click' on the element text.

4. MULTIPLE SOURCES & PRECISION:
   - When done with a page, use 'closeTab' to return to Google results, then 'openTab' the next result.
   - For Deep Research, you MUST physically use the 'openTab' tool 4-5 times on DIFFERENT URLs. DO NOT hallucinate or pretend you checked multiple sources. Your tool usage is tracked! If you claim to check 3 pages but only opened 1, you will fail.

5. SUMMARIZE: When you have thoroughly compiled all parts of the task "to the tee" from 4-5 real, physically visited sources, set done with a rich, highly detailed answer.

━━━ AVAILABLE TOOLS ━━━
You must choose ONE tool per step. Output valid JSON.

1. navigate
   - Navigates the current tab to a URL.
   - Args: { "url": "[Insert URL Here]" }

2. click
   - Clicks a button, link, or in-page tab. Matches by visible text.
   - Args: { "text": "Exact or partial text of the element" }
   - IMPORTANT: Only use visible text. Do not use internal 'id', 'tab', or 'field_name'. You are free to click on any element if it's relevant to the goal.

3. scroll
   - Scrolls the page.
   - Args: { "direction": "down" | "up", "amount": 500 }
   - IMPORTANT: You can freely use 'scroll' on any page to find more information, including Google search results if you want to see more links!

4. type
   - Fills form inputs or search bars.
   - Args: { "text": "Name or placeholder of the input field", "value": "The exact text you want to type into the field" }
   - IMPORTANT: Do not use 'field_id' or 'selector'. Use the visible label/placeholder text. After you type, your VERY NEXT action must be to 'press' { key: "Enter" } or 'click' the search/submit button!

5. press
   - Presses a keyboard key. Good for submitting forms.
   - Args: { "key": "Enter" | "Escape" }

6. goBack
   - Clicks the browser back button.
   - Args: {}

7. openTab
   - Opens a completely NEW browser tab for a background search. ONLY pass a URL.
   - Args: { "url": "[Insert URL Here]" }
   - IMPORTANT: Do not pass 'tab', 'id', or other parameters. ONLY 'url'.

8. switchTab
   - Switches focus to an ALREADY OPEN tab from the BROWSER TABS list.
   - Args: { "tabId": "tab-12345" }

9. closeTab
   - Closes the CURRENT tab if it is a dead-end or you are done with it.
   - Args: {}

━━━ RULES ━━━
1. Only use element names EXACTLY as they appear in interactive_elements. Never hallucinate.
2. Elements with a "url" field → use openTab, NOT click.
3. If the page didn't change after an action → switch strategy immediately.
4. If last_action_error is set → do NOT repeat that action. Read the error carefully and act on it.
5. TABS: If you open a new tab (openTab) and it's a dead-end, use 'closeTab' to discard it. If you need to switch to an ALREADY OPEN tab, use 'switchTab' { tabId: "ID" }.
6. If banned_actions is listed → do not use those actions AT ALL, for any URL variation.
7. DEAD-END PAGE (no elements, cannot scroll):
   - If you have already collected data from other pages → set done with what you have.
   - If you haven't collected data yet → use closeTab to go back OR navigate to a new Google URL.
   - NEVER use needs_user because of a dead-end page. That is a navigation problem, not an ambiguity problem.
8. needs_user is ONLY valid at step 0, before any browsing has started, for a truly unanswerable question.
   Once you have started browsing (history exists) → NEVER set needs_user. Keep going.
8. For chat/greetings → action=null, done={ result: "response" }.
9. PIVOTING CONTEXT:
   - If the user changes the topic to a completely new search (e.g., from flights to hotels), the current page is IRRELEVANT.
   - DO NOT scroll or interact with the old page.
   - IMMEDIATELY use 'navigate' to start a fresh Google URL (e.g. https://www.google.com/search?q=new+topic).
10. NEVER GIVE UP:
    - If a page does not have the answer, DO NOT use 'done' to apologize or say you can't find it!
    - You must use 'navigate' to go back to Google with a different query. Keep searching!
    - If the user asked you to COMPARE prices or find multiple options, you MUST NOT use 'done' until you have visited at least 2-3 different websites to compare them.
11. FORM PAGES (flights, hotels, restaurants, shopping, booking):
    - If you see input fields like "Where to?", "Destination", "Search", "Check-in" → you are on the RIGHT page.
    - Use 'type' to fill the fields. YOU CAN ONLY DO ONE ACTION AT A TIME.
    - After you type, your VERY NEXT action must be to 'press' { key: "Enter" } or 'click' the submit button. Do not scroll or leave until the form is submitted!
    - Extract results that appear AFTER submitting the form. That is the correct flow.
12. POPUPS, LOGIN DIALOGS & CAPTCHAS:
    - If you see a popup asking to log in, sign up, or accept cookies, look for a "Close", "X", "Not now", "Skip", or "Dismiss" button and use 'click' to close it!
    - DO NOT attempt to log in or create accounts.
    - If you hit a CAPTCHA or Anti-Bot page (e.g., "Are you a person or a robot", "Press & Hold", Cloudflare), you may attempt to 'click' the solve button ONCE.
    - If the simple click fails and you are still stuck on the CAPTCHA page, the bot protection is too complex. DO NOT keep trying!
    - IMMEDIATELY use 'closeTab' to abandon the site, return to Google, and pick a DIFFERENT search result.
13. SOCIAL MEDIA & LOGIN WALLS (Instagram, Twitter, etc.):
    - You are highly encouraged to visit social media profiles (Twitter, Instagram, etc.) to see what people are doing.
    - If a login wall completely blocks the screen and you cannot close it, simply use 'closeTab' and check another source. Do not attempt to log in.
14. EACH TASK IS INDEPENDENT:
    - When a new goal starts, the previous task's context is GONE. Treat it as a completely fresh request.
    - Do NOT assume you're still on the same page or looking for the same thing.
    - Read the current URL (shown in >>> YOU ARE CURRENTLY ON) and the current GOAL before every action.

15. NEVER GIVE UP OR OUTPUT NULL ACTIONS:
    - You MUST provide a valid tool in the "action" field unless "done" is true or "needs_user" is true.
    - NEVER output "action: null" if you are still actively searching. If you are stuck, use 'navigate' to go to a new Google query.

━━━ OUTPUT FORMAT (STRICT JSON ONLY — NO MARKDOWN, NO EXPLANATION) ━━━
{
  "thought_process": {
    "intent_analysis": "What does the user want? Simple fact or deep research? What have I done so far?",
    "dom_evaluation": "What relevant content/links do I see on the current page?",
    "tool_selection": "Which tool will best progress toward the goal?"
  },
  "thought": "One sentence shown to user explaining what I'm doing.",
  "action": { "tool": "...", "args": { ... } },
  "needs_user": false | { "instruction": "question for user" },
  "done": false | { "result": "Direct, natural answer to the user's question. Bullet points for lists." }
}`;
async function _executeLlmCall(promptText) {
    let attempt = 0;
    while (attempt < 2) {
        try {
            const textResponse = await window.aurora.atlasLlmDecide(promptText);
            let cleaned = textResponse.trim();
            // Strip markdown fences aggressively (handles ```json, ```, etc.)
            cleaned = cleaned.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
            // Strip any lines before the first { and after the last }
            const start = cleaned.indexOf('{');
            const end = cleaned.lastIndexOf('}');
            if (start === -1 || end === -1) throw new Error('No JSON object found in LLM response');
            return _normalizeDecision(JSON.parse(cleaned.substring(start, end + 1)));
        } catch (e) {
            attempt++;
            if (attempt >= 2) throw new Error(`LLM parse failed: ${e.message}`);
            console.warn("Retrying LLM call:", e.message);
        }
    }
}

// Normalize the action.args field when the LLM outputs non-standard formats.
// LLM sometimes returns: "args": "https://url"  OR  "args": ["url1","url2"]
// instead of the correct: "args": { "url": "https://url" }
// Without this fix, executeAction sends malformed args to the webview IPC → crash loop.
function _normalizeDecision(parsed) {
    if (!parsed || !parsed.action) return parsed;
    const { tool, args } = parsed.action;

    // Guard against hallucinated tool names (e.g. "type and press Enter", "navigate to Google")
    const VALID_TOOLS = new Set(['navigate', 'openTab', 'closeTab', 'switchTab', 'click', 'type', 'press', 'scroll', 'goBack', 'wait']);
    if (!VALID_TOOLS.has(tool)) {
        console.warn(`[normalizeDecision] Unknown tool "${tool}" — nulling action.`);
        parsed.action = null;
        return parsed;
    }

    if (args === null || args === undefined) {
        parsed.action.args = {};
    } else if (typeof args === 'string') {
        if (args.startsWith('http')) {
            parsed.action.args = { url: args };
        } else {
            parsed.action.args = { text: args };
        }
    } else if (Array.isArray(args)) {
        const urls = args.filter(a => typeof a === 'string' && a.startsWith('http'));
        parsed.action.args = { url: urls.length === 1 ? urls[0] : urls };
    }

    // CRITICAL: LLM cannot simultaneously take an action AND ask the user.
    if (parsed.action && parsed.needs_user) {
        parsed.needs_user = false;
    }

    return parsed;
}


async function getDecision(state, screenshotB64, taskSpec, memory) {
    const { stuck_recovery, ...cleanTaskSpec } = taskSpec || {};
    const goal = cleanTaskSpec.goal || '';

    // ── RELEVANCE CULLING ──────────────────────────────────────────────────────
    // Score elements by how many goal keywords they contain. Filter pure noise.
    // This cuts prompt tokens by ~40% vs showing everything.
    const goalWords = goal.toLowerCase().split(/\s+/).filter(w => w.length > 2);

    const isNoise = (el) => {
        const url = el.url || '';
        const text = el.name || el.text || '';
        return (
            /google\.com\/(webhp|preferences|intl|accounts|maps\/contribute)/i.test(url) ||
            /^(Accessibility help|Go to Google Home|Privacy|Terms|Settings|Feedback|Sign in|Skip to main|More options|Learn more)$/i.test(text) ||
            (url.includes('google.com') && /privacy|terms|settings|feedback|accessibility/i.test(url))
        );
    };

    const scoreEl = (el) => {
        const text = ((el.name || el.text || '') + ' ' + (el.url || '')).toLowerCase();
        return goalWords.filter(w => text.includes(w)).length;
    };

    const allElements = state.interactiveElements || state.interactive_elements || [];
    const links   = allElements.filter(e => e.url && !isNoise(e)).sort((a, b) => scoreEl(b) - scoreEl(a)).slice(0, 12);
    const inputs  = allElements.filter(e => e.type && !e.url).slice(0, 4);
    const buttons = allElements.filter(e => !e.url && !e.type && !isNoise(e)).slice(0, 5);
    const elements = [...links, ...inputs, ...buttons];

    const elementList = elements.map(e =>
        `  - [${e.role}] "${e.name || e.text || ''}"${e.url ? ` → url: ${e.url}` : ''}${e.type ? ` (type: ${e.type})` : ''}${e.value ? ` (value: ${e.value})` : ''}${e.focused ? ` [FOCUSED]` : ''}`
    ).join('\n');

    // ── GOAL-FILTERED SNIPPETS ─────────────────────────────────────────────────
    // Only show snippets that contain at least one goal keyword. Fall back to
    // first 5 if nothing matches. Caps at 5 (was 10) — enough context, less noise.
    const allSnippets = state.text_snippets || [];
    const relevantSnippets = allSnippets.filter(s => goalWords.some(w => s.toLowerCase().includes(w))).slice(0, 5);
    const displaySnippets = relevantSnippets.length > 0 ? relevantSnippets : allSnippets.slice(0, 5);

    const canScroll = state.scroll_info && state.scroll_info.canScrollMore;

    let pageState;
    // Always lead with location — the LLM must know exactly where it is before anything else
    const locationHeader = `\n>>> YOU ARE CURRENTLY ON: "${state.title || 'Unknown Page'}"\n>>> URL: ${state.url || 'unknown'}\n`;

    if (allElements.length === 0 && !canScroll) {
        pageState = `${locationHeader}PAGE STATE: DEAD-END — no interactive elements and cannot scroll. Navigate elsewhere.`;
    } else if (allElements.length === 0 && canScroll) {
        pageState = `${locationHeader}PAGE STATE: Page is empty above the fold. Scroll down to reveal content.`;
    } else {
        pageState = `${locationHeader}Can scroll: ${canScroll ? 'YES' : 'NO'}

Elements (${elements.length} shown, ${allElements.length} total — top goal-relevant):
${elementList}

Key snippets: ${JSON.stringify(displaySnippets)}`;
    }

    const stateExtras = [];
    if (state.last_action_error) stateExtras.push(`⚠️ LAST ACTION FAILED: ${state.last_action_error}`);
    if (state.banned_actions && state.banned_actions.length) stateExtras.push(`🚫 BANNED (do not use): ${state.banned_actions.join(', ')}`);
    if (state.visited_urls && state.visited_urls.length) stateExtras.push(`✅ ALREADY VISITED (do NOT open these again): ${state.visited_urls.join(', ')}`);

    const recoveryBlock = stuck_recovery ? `\n⛔ RECOVERY MODE: ${stuck_recovery}\n` : '';

    // ── COMPACT HISTORY ────────────────────────────────────────────────────────
    // Single-line per step vs full JSON — cuts history block tokens by ~60%
    const compactHistory = memory.getRecentContext(3).map((s, i) =>
        `${i + 1}. ${s.action?.tool || 'start'} | ${s.url || 'n/a'} | ${(s.thought || '').slice(0, 80)}`
    ).join('\n');

    // ── FINDINGS DIGEST ────────────────────────────────────────────────────────
    // Pre-distilled facts extracted after each page visit (no LLM cost)
    const findingsBlock = memory.getFindings ? memory.getFindings() : '';
    if (state.banned_actions?.length > 0) {
        stateExtras.push(`>>> BANNED ACTIONS (Do NOT use these): ${JSON.stringify(state.banned_actions)}`);
    }

    const tabsBlock = state.open_tabs && state.open_tabs.length > 0
        ? state.open_tabs.map(t => `- ID: ${t.id} | URL: ${t.url} ${t.active ? '(ACTIVE)' : ''}`).join('\n')
        : '(only this tab)';

    const promptText = `${SYSTEM_PROMPT}
${recoveryBlock}
━━━ CURRENT TASK ━━━
Goal: ${goal}
Steps: ${memory.history?.length || 0} / ${cleanTaskSpec.max_steps || 20}

━━━ COLLECTED FINDINGS SO FAR ━━━
${findingsBlock || '(none yet)'}

━━━ RECENT ACTIONS (last 3) ━━━
${compactHistory}

━━━ BROWSER TABS ━━━
${tabsBlock}

━━━ CURRENT PAGE ━━━
${pageState}
${stateExtras.join('\n')}
Output strict JSON matching this structure:
{
  "thought_process": { "intent_analysis": "...", "dom_evaluation": "...", "tool_selection": "..." },
  "thought": "Short explanation",
  "action": { "tool": "toolName", "args": { ... } } | null,
  "needs_user": false,
  "done": false | { "result": "The final answer here" }
}`;

    return _executeLlmCall(promptText);
}

window.getDecision = getDecision;
