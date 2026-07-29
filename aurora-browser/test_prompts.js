async function runTest() {
    const { getLlama, LlamaChatSession, LlamaJsonSchemaGrammar } = await import('node-llama-cpp');
    const llama = await getLlama();
    const model = await llama.loadModel({ modelPath: '/Users/sanjeevn/Models/llm/phi-3-mini-4k-instruct-q4.gguf' });
    const context = await model.createContext({ contextSize: 4096 });
    const sequence = context.getSequence();

    console.log("=== TESTING PLANNER ===");
    const plannerPrompt = `Goal: "find me bottle"\nCurrent page: New tab (no page loaded)`;
    const plannerSystem = `You are Aurora's Planning AI. Break the user's goal into 2-5 specific sequential steps.
Output ONLY valid JSON.
STEP RULES:
- Steps must map to physical browser actions (navigate, search, click link, extract data).
- Do NOT output abstract steps like "report findings". Instead, output "click on the most relevant search result link".
- Steps must include actual site names, exact queries, and filter values from the goal.
- Never split: "click Submit" is not a step — the executor handles UI details.
CLARIFYING QUESTIONS — ask when the goal is a CATEGORY, not a specific thing.
DO NOT ask when the goal is already specific enough to search for.`;

    const plannerFormat = {
      type: "object",
      properties: {
        steps: { type: "array", items: { type: "string" } },
        questions: { type: "array", items: { type: "string" } }
      },
      required: ["steps", "questions"]
    };

    const plannerSession = new LlamaChatSession({ contextSequence: sequence, systemPrompt: plannerSystem });
    const plannerGrammar = new LlamaJsonSchemaGrammar(llama, plannerFormat);
    
    let plannerResult = await plannerSession.prompt(plannerPrompt, {
        temperature: 0.1,
        responseFormat: plannerGrammar
    });
    
    console.log("Planner Output:\n", plannerResult);

    console.log("\n=== TESTING EXECUTOR ===");
    // Simulate the state after the search results are loaded
    const executorPrompt = `Current Step: "click on the most relevant search result link"
Last Action: "type {\\"id\\":\\"INP_001\\",\\"value\\":\\"find me bottle\\"}"
Observer Hint: "Press Enter to submit the search query"

Current Page URL: https://www.google.com/search?q=find+me+bottle
Interactive Elements available:
  - [INP_001] (input) "find me bottle" - search query
  - [LNK_027] (link) "Home Centre Favola Glass Bottle" - product result url: https://amazon.in/home-centre...
  - [LNK_031] (link) "Milton Comet Stainless Steel" - product result url: https://amazon.in/milton...`;

    const executorSystem = `You are the Execution Engine. Your ONLY job is to pick the exact tool to execute the current step based on the page state.
You are the HANDS. Do not plan.

AVAILABLE TOOLS:
1. navigate - args: { "url": "https://..." }
2. click - args: { "id": "BTN_001 or LNK_001" }
3. type - args: { "id": "INP_001", "value": "text to type" }
4. press - args: { "key": "Enter" }
5. scroll - args: { "direction": "down", "amount": 500 }
6. openTab - args: { "url": "https://..." }
7. closeTab - args: {}
8. done - args: { "message": "final answer or summary to show the user" }

RULES:
- If the step says "navigate to X", use the navigate or openTab tool.
- If the step says "search for X" and there is a search input, use the type tool on its exact ID (e.g. INP_003).
- To click something, output ONLY its ID (e.g., {"tool": "click", "args": {"id": "BTN_005"}}).
- If your Last Action was "type", your NEXT action is usually press Enter or click Search.
- If the step is to extract data, report findings, or you have achieved the user's goal, use the done tool.
- Output ONLY valid JSON.`;

    const executorFormat = {
      type: "object",
      properties: {
        action: {
          type: "object",
          properties: {
            tool: { type: "string", enum: ["navigate", "click", "type", "press", "scroll", "openTab", "closeTab", "done"] },
            args: { type: "object", additionalProperties: true }
          },
          required: ["tool", "args"]
        }
      },
      required: ["action"]
    };

    const executorSession = new LlamaChatSession({ contextSequence: sequence, systemPrompt: executorSystem });
    const executorGrammar = new LlamaJsonSchemaGrammar(llama, executorFormat);

    let executorResult = await executorSession.prompt(executorPrompt, {
        temperature: 0.1,
        responseFormat: executorGrammar
    });

    console.log("Executor Output:\n", executorResult);
    
    process.exit(0);
}

runTest().catch(console.error);
