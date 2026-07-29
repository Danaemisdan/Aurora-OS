// Aurora OS - Intent Classifier
class IntentClassifier {
  static classify(message) {
    if (!message || typeof message !== 'string') {
      return { intent: 'chat', confidence: 0.5 };
    }

    const lower = message.toLowerCase().trim();

    // 1. Pure greetings → chat
    const stripped = lower.replace(/[^a-z\s]/g,'').trim();
    const PURE_GREETINGS = new Set(['hey','hi','hello','yo','sup','howdy','thanks','thank','ty','bye','goodbye']);
    if (PURE_GREETINGS.has(stripped)) {
      return { intent: 'chat', confidence: 0.97 };
    }

    // 2. Explicit navigation/browser actions → task (highest priority, before direct_answer)
    const BROWSER_VERBS = [
      'open', 'go to', 'navigate', 'search', 'find', 'click', 'type', 'press',
      'scroll', 'download', 'upload', 'save', 'send', 'compose', 'email', 'create',
      'buy', 'order', 'book', 'play', 'watch', 'listen', 'show me', 'display', 'check',
      'apply', 'fill', 'submit', 'share', 'copy', 'read', 'schedule', 'look up',
      'get me', 'find me', 'show', 'give me',
      'price of', 'cost of', 'best', 'cheapest', 'most expensive', 'near me', 'nearby'
    ];
    const REDIRECT_PREFIXES = ['can you ', 'could you ', 'please ', 'help me ', 'i want to ', "let's ", 'i need '];
    let checkStr = lower;
    for (const prefix of REDIRECT_PREFIXES) {
      if (lower.startsWith(prefix)) { checkStr = lower.slice(prefix.length).trim(); break; }
    }
    checkStr = checkStr.replace(/\?$/, '').trim();
    for (const str of [lower, checkStr]) {
      for (const verb of BROWSER_VERBS) {
        if (str === verb || str.startsWith(verb + ' ') || str.startsWith(verb + ',')) {
          return { intent: 'task', confidence: 0.93 };
        }
      }
    }

    // 3. Research overrides
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

    // 4. DIRECT ANSWER — AI knows this without browsing
    // Math expressions: 1+0, 5*3, sqrt(16), what is 2^10
    if (/^[\d\s\.\+\-\*\/\^\(\)%]+$/.test(lower.trim())) {
      return { intent: 'direct_answer', confidence: 0.99 };
    }
    if (/\b\d+\s*[\+\-\*\/\^]\s*\d+/.test(lower)) {
      return { intent: 'direct_answer', confidence: 0.98 };
    }
    // Math/conversion phrases
    if (/\b(calculate|compute|solve|simplify|convert|how many|how much is)\b.{0,30}\b(\d+|km|miles|kg|lb|celsius|fahrenheit|usd|inr|eur)\b/i.test(lower)) {
      return { intent: 'direct_answer', confidence: 0.95 };
    }

    // Static general knowledge — never changes
    const DIRECT_ANSWER_PATTERNS = [
      /^what is \d/,                                            // what is 1+0, what is 42
      /^what('s)? \d/,                                         // what's 5*3
      /\bspell(ing)?\b/,                                       // how do you spell X
      /\bsynonym\b|\bantonym\b|\bdefinition of\b|\bmean(ing)? of\b/, // definitions
      /\bcapital (city )?of\b/,                               // capital of France
      /\bfounded (in|by)\b|\bfounded\b.*\bwhen\b/,
      /\binvented by\b|\bwho invented\b/,
      /\bformula (for|of)\b/,                                  // formula for area
      /\bperiodic table\b|\belement symbol\b/,
      /\bprime number\b|\bfibonacci\b|\bfactorial\b/,
      /\bsquare root\b|\bcube root\b/,
      /\b(roman numerals?|binary|hexadecimal)\b.*\bof\b/,
      /^(translate|say) .+ in \w+$/i,                         // translate hello in french
    ];
    for (const pattern of DIRECT_ANSWER_PATTERNS) {
      if (pattern.test(lower)) {
        return { intent: 'direct_answer', confidence: 0.93 };
      }
    }

    // 5. CURRENT / TIME-SENSITIVE info → always task (web search needed)
    const CURRENT_INFO_KEYWORDS = [
      'weather', 'forecast', 'temperature', 'rain', 'today', 'tomorrow', 'tonight',
      'news', 'latest', 'current', 'right now', 'live', 'trending', 'breaking',
      'stock', 'price', 'crypto', 'bitcoin', 'ethereum', 'market', 'rate', 'exchange rate',
      'score', 'result', 'match', 'game', 'election', 'vote',
      'who won', 'what happened', 'recently', 'just announced', 'update',
      'how many cases', 'covid', 'inflation', 'gdp'
    ];
    for (const kw of CURRENT_INFO_KEYWORDS) {
      if (lower.includes(kw)) {
        return { intent: 'task', confidence: 0.91 };
      }
    }

    // 6. Wh-questions about facts (not time-sensitive) → check if direct or task
    const WH_DIRECT = [
      /^what (is|are|was|were) (the |a |an )?(meaning|definition|formula|symbol|capital|inventor|founder|author|creator|language)/,
      /^who (is|was|are|were) (the )?(inventor|founder|author|president|prime minister|ceo|creator|writer|director|actor|actress)/,
      /^when (was|did|is) .+(born|founded|invented|created|established|published|released|written)/,
      /^where (is|are|was|were) .+(located|situated|found|born)/,
      /^how (do|does|did|can|to) (you |i |we )?/,
    ];
    for (const pattern of WH_DIRECT) {
      if (pattern.test(lower)) {
        return { intent: 'direct_answer', confidence: 0.85 };
      }
    }

    // Generic wh-questions → task (search)
    const WH_SEARCH = [
      /^what (is|are|was|were|did|does|do|happened|'s)/,
      /^who (is|are|was|were|did|'s)/,
      /^where (is|are|was|were|can|do|did)/,
      /^when (is|are|was|were|did|does|will)/,
      /^how (is|are|was|were|does|do|did|much|many|can)/,
      /^why (is|are|was|were|does|do|did)/,
      /^which (is|are|was|were)/,
    ];
    for (const pattern of WH_SEARCH) {
      if (pattern.test(lower)) {
        return { intent: 'task', confidence: 0.85 };
      }
    }

    // 7. Has action verb anywhere → task
    const hasAction = BROWSER_VERBS.some(v => lower.includes(v));
    const wordCount = lower.trim().split(/\s+/).length;
    if (wordCount >= 2 && hasAction) return { intent: 'task', confidence: 0.82 };

    // 8. 4+ words → likely a search
    if (wordCount >= 4) return { intent: 'task', confidence: 0.75 };

    // 9. 2-3 words → search
    if (wordCount >= 2) return { intent: 'task', confidence: 0.70 };

    // 10. Single unknown word → search
    if (wordCount === 1 && !PURE_GREETINGS.has(stripped) && stripped.length > 2) {
      return { intent: 'task', confidence: 0.65 };
    }

    return { intent: 'chat', confidence: 0.85 };
  }
}

window.IntentClassifier = IntentClassifier;
