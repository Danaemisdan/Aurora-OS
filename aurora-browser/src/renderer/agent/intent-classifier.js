// Aurora OS - Intent Classifier
class IntentClassifier {
  static classify(message) {
    if (!message || typeof message !== 'string') {
      return { intent: 'chat', confidence: 0.5 };
    }

    const lower = message.toLowerCase().trim();

    // 1. Pure single-word greetings ONLY → chat (not "no" context since user might be answering agent)
    const stripped = lower.replace(/[^a-z\s]/g,'').trim();
    const PURE_GREETINGS = new Set(['hey','hi','hello','yo','sup','howdy','thanks','thank','ty','bye','goodbye']);
    if (PURE_GREETINGS.has(stripped)) {
      return { intent: 'chat', confidence: 0.97 };
    }

    // 2. Research overrides
    const RESEARCH_STARTERS = [
      'research ', 'deep dive ', 'investigate ', 'find out everything',
      'give me a full report', 'analyse ', 'analyze ', 'summarise ', 'summarize ',
      'compile info', 'write a report on', 'compare', 'find me the best'
    ];
    for (const starter of RESEARCH_STARTERS) {
      if (lower.startsWith(starter) || lower.includes(starter)) {
        return { intent: 'research', confidence: 0.92 };
      }
    }

    // 3. Task phrases (action verbs at start)
    const TASK_VERBS = [
      'open', 'go to', 'navigate', 'search', 'find', 'click', 'type', 'press', 
      'scroll', 'download', 'upload', 'save', 'send', 'compose', 'email', 'create', 
      'buy', 'order', 'book', 'play', 'watch', 'listen', 'show me', 'display', 'check',
      'apply', 'fill', 'submit', 'share', 'copy', 'read', 'schedule', 'look up',
      'get me', 'tell me about', 'find me', 'show', 'give me', 'what is', 'what are',
      'who is', 'where is', 'how much', 'how many', 'price of', 'cost of', 'best',
      'latest', 'cheapest', 'most expensive', 'near me', 'nearby'
    ];
    
    // Redirect prefixes
    const REDIRECT_PREFIXES = ['can you ', 'could you ', 'please ', 'help me ', 'i want to ', 'let\'s ', 'i need '];
    let checkStr = lower;
    for (const prefix of REDIRECT_PREFIXES) {
      if (lower.startsWith(prefix)) {
        checkStr = lower.slice(prefix.length).trim();
        break;
      }
    }
    checkStr = checkStr.replace(/\?$/, '').trim();

    for (const str of [lower, checkStr]) {
      for (const verb of TASK_VERBS) {
        if (str === verb || str.startsWith(verb + ' ') || str.startsWith(verb + ',')) {
          return { intent: 'task', confidence: 0.92 };
        }
      }
    }

    // 4. Wh-questions → always needs web browsing (not chat)
    const WH_PATTERNS = [
      /^what (is|are|was|were|did|does|do|happened|'s)/,
      /^who (is|are|was|were|did|'s)/,
      /^where (is|are|was|were|can|do|did)/,
      /^when (is|are|was|were|did|does|will)/,
      /^how (is|are|was|were|does|do|did|much|many|can)/,
      /^why (is|are|was|were|does|do|did)/,
      /^which (is|are|was|were)/,
    ];
    for (const pattern of WH_PATTERNS) {
      if (pattern.test(lower)) {
        return { intent: 'task', confidence: 0.88 };
      }
    }

    // 5. Contains action verb anywhere + reasonable length
    const hasAction = TASK_VERBS.some(v => lower.includes(v));
    const wordCount = lower.trim().split(/\s+/).length;
    if (wordCount >= 2 && hasAction) return { intent: 'task', confidence: 0.82 };

    // 6. Anything with 4+ words → very likely a search query, not chat
    if (wordCount >= 4) return { intent: 'task', confidence: 0.75 };

    // 7. Looks like a product/topic (2+ words, not a greeting) → search it
    if (wordCount >= 2) return { intent: 'task', confidence: 0.70 };

    // 8. Single non-greeting word that looks like a product/place/topic → search
    if (wordCount === 1 && !PURE_GREETINGS.has(stripped) && stripped.length > 2) {
      return { intent: 'task', confidence: 0.65 };
    }

    return { intent: 'chat', confidence: 0.85 };
  }
}

window.IntentClassifier = IntentClassifier;
