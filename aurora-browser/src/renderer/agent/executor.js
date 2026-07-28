// Aurora OS - Execution Engine
class ExecutionEngine {
  static async determineAction(stepInstruction, state, observerHint, lastAction) {
    const url = state.url || '';
    // Only use interactive elements to stay well within Phi-3 Mini's 4096-token context
    const interactiveOnly = (state.interactiveElements || state.interactive_elements || [])
        .slice(0, 20)
        .map(e => `[${e.id || '?'}] ${e.type || e.role || 'el'}: "${(e.name || e.text || '').substring(0, 50)}"`)
        .join('\n');
    let elementContext = interactiveOnly || state.markdown_tree || '(none)';
    if (elementContext.length > 1500) {
        elementContext = elementContext.substring(0, 1500) + '\n... (truncated)';
    }
    const popupWarning = state.hasPopup ? "\\nWARNING: A modal or popup is currently active! You may need to interact with it or dismiss it." : "";

    let prompt = `You are the Execution Engine. Your ONLY job is to pick the exact tool to execute the current step based on the page state.
You are the HANDS. Do not plan.

Current Step: "${stepInstruction}"
Last Action: "${lastAction || 'None'}"
Observer Hint: "${observerHint || 'None'}"

Current Page URL: ${url}${popupWarning}
DOM Hierarchy (Markdown):
${elementContext}

AVAILABLE TOOLS:
1. navigate - args: { "url": "https://..." }
2. click - args: { "id": "BTN_001, LNK_001, or INP_001" }
3. type - args: { "id": "INP_001", "value": "text to type" }
4. press - args: { "key": "Enter" }
5. scroll - args: { "direction": "down", "amount": 500 }
6. openTab - args: { "url": "https://..." }
7. closeTab - args: {}
8. extract_vision - args: {} (uses native OCR to read unlabelled text from the screen)
9. done - args: { "message": "final answer or summary to show the user" }

RULES:
- Map the Current Step to the exact tool.
- If a popup is active, prioritize interacting with or dismissing it.
- CRITICAL: When using tools that require an ID (like click or type), output ONLY the exact ID from the DOM Hierarchy (e.g., LNK_001, INP_002). Do NOT hallucinate IDs.
- If the step requires extracting data or reporting findings, use the done tool.
- Output ONLY valid JSON.
- CRITICAL: If the Observer Hint tells you to press a key (like Enter), you MUST output the 'press' tool with args { "key": "Enter" }.
- CRITICAL: Do NOT repeat the Last Action if it succeeded. If your Last Action was 'type', your VERY NEXT action must be 'press' { "key": "Enter" } or 'click', NOT 'type' again!
- CRITICAL: If the Last Action says "Result: ERROR", you MUST NOT repeat the same action! You MUST pick a DIFFERENT tool or a DIFFERENT ID that actually exists in the DOM Hierarchy!
- CRITICAL: NEVER hallucinate or make up IDs (e.g. do not invent IDs like 'search' or 'search-input'). You MUST ONLY pick an exact ID that appears in the 'DOM Hierarchy (Markdown)' section above. If the ID is not there, you MUST NOT use it.
- CRITICAL: When using the 'type' tool, the "value" field MUST be the EXACT search query from the Current Step. NEVER type the element's label/placeholder (like 'Search') as the value.

Output Format:
Answer ONLY with this single-line JSON without line breaks:
{"action": {"tool": "click", "args": {"id": "BTN_001"}}}`;

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
          const action = JSON.parse(response.substring(start, end + 1)).action;
          if (action && action.tool === 'navigate') {
              if (action.args && action.args.url) {
                  const urlRegex = /(https?:\/\/[^\s']+)/i;
                  const stepUrlMatch = stepInstruction.match(urlRegex);
                  if (stepUrlMatch && stepUrlMatch[1] && !action.args.url.includes(stepUrlMatch[1])) {
                      console.log("OVERRIDING URL FROM", action.args.url, "TO", stepUrlMatch[1]);
                      action.args.url = stepUrlMatch[1];
                  }
              }
          }
          
          if (action && (action.tool === 'click' || action.tool === 'type') && action.args && action.args.id) {
              const id = action.args.id;
              if (!/^[A-Z]{3}_\d{3}$/.test(id)) {
                  throw new Error(`CRITICAL MISTAKE: You hallucinated the ID '${id}'. You MUST use an EXACT ID from the Webpage Context, like INP_001 or BTN_002.`);
              }
              if (!elementContext.includes(`[${id}]`)) {
                  throw new Error(`CRITICAL MISTAKE: The ID '${id}' is NOT in the Webpage Context. You MUST choose a valid ID from the list provided.`);
              }
          }
          // GUARDRAIL: If the action is 'type', override the value with the real query
          // from the step instruction. Prevents the model from typing placeholder text like 'Search'.
          if (action && action.tool === 'type' && action.args) {
              // Try quoted text first: 'query' or "query"
              const quotedMatch = stepInstruction.match(/['“‘”’"]([^'"\u201c\u2018\u201d\u2019]{2,})['“‘\u201d\u2019"]/);
              if (quotedMatch && quotedMatch[1]) {
                  action.args.value = quotedMatch[1];
              } else {
                  // Fall back: extract query after 'search for', 'type', 'for', etc.
                  const unquotedMatch = stepInstruction.match(/(?:search for|type|query|find|look up)\s+(.+?)(?:\s+(?:in|into|on|using|to|and)\s|$)/i);
                  if (unquotedMatch && unquotedMatch[1] && unquotedMatch[1].length > 2) {
                      action.args.value = unquotedMatch[1].trim();
                  }
                  // Final safety: if value is a single word like 'search' or 'type', it's probably wrong
                  const badValues = new Set(['search', 'type', 'query', 'find', 'input', 'text', 'enter']);
                  if (badValues.has((action.args.value || '').toLowerCase().trim())) {
                      // Try the whole step as query minus the verb prefix
                      const fallback = stepInstruction.replace(/^(search for|type|find|look up|search)\s+/i, '').replace(/['".]+$/,'').trim();
                      if (fallback.length > 2) action.args.value = fallback;
                  }
              }
          }
          console.log("EXECUTION ENGINE RETURNING:", action);
          return action;
        }
        throw new Error('No JSON object found');
      } catch (e) {
        console.error("EXECUTION ENGINE CAUGHT ERROR:", e.message);
        attempt++;
        if (attempt >= 2) return { tool: 'scroll', args: { direction: 'down', amount: 300 } };
        // If we caught a validation error, we update the prompt to include the error message for the retry
        prompt += `\n\nLAST ATTEMPT ERROR: ${e.message}`;
      }
    }
  }
}

window.ExecutionEngine = ExecutionEngine;
