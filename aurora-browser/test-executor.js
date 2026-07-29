const stepInstruction = "navigate to 'https://www.google.com'";
const action = {
  tool: "navigate",
  args: { url: "https://www.tripadvisor.com/" }
};

try {
  if (action && action.tool === 'navigate') {
      if (!stepInstruction.toLowerCase().includes('navigate') && !stepInstruction.toLowerCase().includes('go to')) {
          throw new Error(`CRITICAL MISTAKE: You used the 'navigate' tool, but the current step does NOT ask you to navigate. You MUST use 'type' or 'click' instead.`);
      }
      if (action.args && action.args.url) {
          const urlRegex = /(https?:\/\/[^\s']+)/i;
          const stepUrlMatch = stepInstruction.match(urlRegex);
          if (stepUrlMatch && stepUrlMatch[1] && !action.args.url.includes(stepUrlMatch[1])) {
              action.args.url = stepUrlMatch[1];
          }
      }
  }
  console.log("Success:", action);
} catch (e) {
  console.log("Error:", e);
}
