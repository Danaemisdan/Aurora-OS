// Aurora OS - Planner AI
class PlannerAI {
  static async decomposeGoal(goal, state) {
    const pageInfo = state.url 
      ? `Current page: ${state.url}\nPage title: ${state.title || ''}` 
      : `Current page: New tab (no page loaded)`;
    let domTreeContext = state.markdown_tree || '';
    if (domTreeContext.length > 1500) {
        domTreeContext = domTreeContext.substring(0, 1500) + '\n... (truncated)';
    }
    const domTree = domTreeContext ? `\nDOM Hierarchy (Markdown):\n${domTreeContext}\n` : '';
    const prompt = `You are a browser task planning agent. Break the goal into 2-5 specific sequential steps.
Output ONLY a raw JSON object. Start with { immediately.

STEP RULES:
- Steps must be physical browser actions (navigate, click, extract).
- Do not use abstract steps. Describe the physical action required based on the current page state.
- CRITICAL: If the goal requires searching the web for information or products, generate EXACTLY 2 steps:
  Step 1: navigate to 'https://www.google.com/search?q=YOUR_QUERY_HERE'
  Step 2: read and report the search results to the user
  NEVER add steps like "click search bar", "click Search button", "press Enter", or "type into search bar".
  Just 2 steps. Navigate then report.
  Example — goal "find cheap shoes": steps = ["navigate to 'https://www.google.com/search?q=cheap+shoes'", "read and report the search results"]
  Example — goal "what is the weather": steps = ["navigate to 'https://www.google.com/search?q=weather+today'", "read and report the search results"]
  Example — goal "how do I use blender": steps = ["navigate to 'https://www.google.com/search?q=how+to+use+blender'", "read and report the search results"]
  CRITICAL: For ANY "how to", "what is", "how do I", "why does", "where is" question — ALWAYS use google.com/search. NEVER navigate directly to a website like blender.org.
- CRITICAL: If the user wants to open a famous website (e.g. youtube, netflix, facebook), you MUST include the '.com' in the URL (e.g. 'https://www.youtube.com'). Do not just say 'navigate to youtube'.
- If the user's goal is VAGUE or INCOMPLETE (e.g. "find me shoes" without budget/type, "book a flight" without dates), ask clarifying questions BEFORE searching. Do NOT search immediately.
- If you see relevant buttons or inputs in the DOM Hierarchy, mention them in your steps.

CLARIFYING QUESTIONS:
- Ask if: shopping goal has no budget/category/brand, booking has no dates/location, or query is genuinely ambiguous.
- Do NOT ask if: goal already has enough detail to search.

Output format — steps MUST be plain strings:
{"questions":["(optional clarifying questions)"],"steps":["step 1","step 2"]}

${pageInfo}${domTree}
Goal: "${goal}"

Output ONLY JSON:`;

    let attempt = 0;
    while (attempt < 2) {
      try {
        const textResponse = await window.aurora.atlasLlmDecide(prompt);
        let response = textResponse.trim().replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
        // Force append closing braces if truncated
        if (!response.endsWith('}')) {
            if (!response.endsWith(']')) response += ']';
            response += '}';
        }
        
        const match = response.match(/\{[\s\S]*\}/);
        if (match) {
          try {
            return this.parseSteps(JSON.parse(match[0]), goal);
          } catch (e) {
            // Let the outer catch handle it
            throw e;
          }
        }
        throw new Error('No JSON object found');
      } catch (e) {
        attempt++;
        if (attempt >= 2) return { steps: [goal], questions: [], current: 0 };
      }
    }
  }

  static parseSteps(obj, goal) {
    let steps = Array.isArray(obj.steps) ? obj.steps.filter(s => typeof s === 'string') : [];
    if (steps.length === 0) steps = [goal];

    let questions = Array.isArray(obj.questions) ? obj.questions.filter(q => typeof q === 'string') : [];
    
    // Fallback logic for missing questions
    if (questions.length === 0) {
      if (/\\bbook\\s+(a|me|the)?\\s*(flight|ticket|seat)\\b/i.test(goal) && !/\\bfrom\\b.+\\bto\\b/i.test(goal))
        questions.push('Where are you flying from and to, and on what date?');
      if (/\\bbook\\s+(a|me|the)?\\s*(hotel|room|stay)\\b/i.test(goal) && !/\\b(city|in|at)\\b/i.test(goal))
        questions.push('Which city and what dates?');
    }

    return { steps, questions, current: 0 };
  }
}

window.PlannerAI = PlannerAI;
