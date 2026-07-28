// Aurora OS - Observer AI
class ObserverAI {
  static async observePageState(state, goalContext, lastAction) {
    const url = state.url || '';
    const title = state.title || '';
    
    // Only pass highly relevant interactive elements
    const interactiveEls = (state.interactiveElements || state.interactive_elements || [])
      .filter(e => e.type || !e.url || (e.url && !e.url.includes('google.com/search')))
      .slice(0, 15)
      .map(e => `  [${e.role || e.type || 'element'}] "${e.name || e.text || ''}" ${e.url ? '→ ' + e.url : ''}`)
      .join('\n');

    const visibleText = (state.text_snippets || []).slice(0, 5).join(' | ');

    const popupWarning = state.hasPopup ? "\\n[!] A Modal/Popup is currently open and active." : "";
    // Only use interactive elements to stay well within Phi-3 Mini's 4096-token context
    const interactiveOnly = (state.interactiveElements || state.interactive_elements || [])
        .slice(0, 20)
        .map(e => `[${e.id || '?'}] ${e.type || e.role || 'el'}: "${(e.name || e.text || '').substring(0, 50)}"`)
        .join('\n');
    let elementContext = interactiveOnly || state.markdown_tree || '(none)';
    if (elementContext.length > 1500) {
        elementContext = elementContext.substring(0, 1500) + '\n... (truncated)';
    }

    const prompt = `You are an Observer AI. Describe the current page state objectively after an action.

User's goal: ${goalContext || 'Unknown'}
Last action: ${lastAction || 'None'}

Current page:
- URL: ${url}
- Title: ${title}${popupWarning}
- DOM Hierarchy (Markdown):
${elementContext}

IMPORTANT REASONING RULES:
- If the last action had NO effect, the action failed.
- Identify blockers (e.g. CAPTCHAs, hard login walls).
- Provide a specific next hint to make progress toward the goal.
- If a popup is active, the next hint should likely address it.
- CRITICAL: Do NOT set "goal_achieved" to true just because an action succeeded. "goal_achieved" must ONLY be true if the ENTIRE User's goal for this step is 100% complete. If there is still more to do for this step (e.g. you clicked the search bar, but still need to type and press Enter), "goal_achieved" must be FALSE!
- CRITICAL: If the goal of the current step is ALREADY met by the current page state (e.g., the step is to search, and you are ALREADY on the search results page), you MUST set "goal_achieved" to true immediately.
- CRITICAL: Only suggest physical interactions with elements INSIDE the DOM Hierarchy (like typing into a search input on the page). Do NOT suggest typing into the browser's "address bar" or using browser-level controls.

Answer ONLY with this single-line JSON without line breaks:
{"state": "machine_readable_state_name", "what_changed": "one sentence description", "action_succeeded": true_or_false, "goal_achieved": true_or_false, "blockers": [], "confidence": 0.9, "next_hint": "one specific sentence"}`;

    let attempt = 0;
    while (attempt < 2) {
      try {
        const textResponse = await window.aurora.atlasLlmDecide(prompt);
        let response = textResponse.trim().replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
        const match = response.match(/\{[\s\S]*?\}/);
        if (match) {
          let start = response.indexOf('{');
          let end = start;
          let braceCount = 0;
          for (let i = start; i < response.length; i++) {
              if (response[i] === '{') braceCount++;
              else if (response[i] === '}') {
                  braceCount--;
                  if (braceCount === 0) {
                      end = i;
                      break;
                  }
              }
          }
          const data = JSON.parse(response.substring(start, end + 1));
          return this.parseObservation(data, lastAction);
        }
        throw new Error('No JSON object found');
      } catch (e) {
        attempt++;
        if (attempt >= 2) return this.fallbackObservation(lastAction);
      }
    }
  }

  static parseObservation(obj, lastAction) {
    return {
      state: obj.state || 'unknown',
      what_changed: obj.what_changed || 'Unknown',
      action_succeeded: obj.action_succeeded !== false,
      goal_achieved: obj.goal_achieved === true,
      blockers: Array.isArray(obj.blockers) ? obj.blockers.filter(b => typeof b === 'string') : [],
      confidence: typeof obj.confidence === 'number' ? obj.confidence : 0.7,
      next_hint: obj.next_hint || ''
    };
  }

  static fallbackObservation(lastAction) {
    return {
      state: 'unknown',
      what_changed: `Action "${lastAction || 'unknown'}" taken.`,
      action_succeeded: true,
      goal_achieved: false,
      blockers: [],
      confidence: 0.5,
      next_hint: 'Proceed with next step'
    };
  }
}

window.ObserverAI = ObserverAI;
