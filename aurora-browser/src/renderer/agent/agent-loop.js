// Aurora OS - Refactored AgentLoop using decoupled Operator OS Architecture
class AgentLoop {
  constructor() {
    this.running = false;
    this.webviewEl = null;
    this.lastNavigatedUrl = ''; // tracks URL after navigate for reliable pre-checks
    this.pendingGoal = '';      // stores original goal while waiting for clarifying answer
    this.onLog = (msg) => console.log(msg);
    this.onNeedUser = (msg) => console.log("Needs user: ", msg);
  }

  init(webviewEl, uiCallbacks) {
    this.webviewEl = webviewEl;
    if (uiCallbacks.onLog) this.onLog = uiCallbacks.onLog;
    if (uiCallbacks.onNeedUser) this.onNeedUser = uiCallbacks.onNeedUser;
    if (uiCallbacks.onStepStart) this.onStepStart = uiCallbacks.onStepStart;
    if (uiCallbacks.onStepEnd) this.onStepEnd = uiCallbacks.onStepEnd;
  }

  async waitForWebviewReady() {
    return new Promise(resolve => {
      if (!this.webviewEl) return resolve();
      const checkLoad = () => {
        if (!this.webviewEl.isLoading()) {
          resolve();
        } else {
          const handler = () => { clearTimeout(timeout); resolve(); };
          const timeout = setTimeout(() => {
            this.webviewEl.removeEventListener('did-finish-load', handler);
            resolve();
          }, 12000);
          this.webviewEl.addEventListener('did-finish-load', handler, { once: true });
        }
      };
      if (typeof this.webviewEl.executeJavaScript !== 'function') {
        const handler = () => { clearTimeout(timeout); checkLoad(); };
        const timeout = setTimeout(() => {
          this.webviewEl.removeEventListener('dom-ready', handler);
          checkLoad();
        }, 3000);
        this.webviewEl.addEventListener('dom-ready', handler, { once: true });
      } else {
        checkLoad();
      }
    });
  }

  // Scrape real content from the webview. Returns { products: [{title, price, store, url}], text: string }
  async scrapePageContent(userGoal) {
    try {
      const wv = this.webviewEl || window.getActiveWebview();
      if (!wv || typeof wv.executeJavaScript !== 'function') return null;

      const raw = await wv.executeJavaScript(`
        (function() {
          var url = location.href;
          var isGoogle = url.includes('google.com/search') || url.includes('google.com/travel');
          var products = [];
          var textLines = [];

          if (isGoogle) {
            // Weather widget (stable IDs)
            var wob = document.querySelector('#wob_tm');
            if (wob) {
              var loc = (document.querySelector('#wob_loc')||{}).textContent||'';
              var desc = (document.querySelector('#wob_dc')||{}).textContent||'';
              textLines.push('Weather in ' + loc + ': ' + wob.textContent + '\\u00B0C, ' + desc);
            }

            // Product/hotel card detection: find by currency price symbol
            var priceEls = [];
            var walker = document.createTreeWalker(document.body, 4);
            var node;
            while ((node = walker.nextNode())) {
              var txt = node.textContent.trim();
              if (/[\\u20B9\\$\\u00A3\\u20AC][\\d,]/.test(txt) && txt.length < 25) {
                priceEls.push(node.parentElement);
              }
            }

            var seen = new Set();
            priceEls.slice(0, 18).forEach(function(priceEl) {
              var card = priceEl;
              var foundTitle = null;
              var foundHref = '';
              var foundStore = '';

              for (var i = 0; i < 8; i++) {
                card = card && card.parentElement;
                if (!card) break;

                // Try structured selectors first
                var titleEl = card.querySelector('h3,h4,[class*="title"],[class*="name"],[class*="hotel"],[class*="property"],[class*="listing"]');

                // Fallback: scan all leaf text nodes in this ancestor (excluding price subtree)
                if (!titleEl) {
                  var allEls = card.querySelectorAll('div,span,a,p');
                  for (var j = 0; j < allEls.length && !titleEl; j++) {
                    var el = allEls[j];
                    if (el === priceEl || el.contains(priceEl)) continue;
                    var et = el.textContent.trim();
                    // Good title: 5-90 chars, not a number/price, not rating text
                    if (et.length > 5 && et.length < 90 && el.children.length === 0 &&
                        !/^[\\d.,\\s%\\u20B9\\$\\u00A3\\u20AC]+$/.test(et) &&
                        !/^\\d+\\.\\d+ out of/.test(et) && !/^\\d+ star/.test(et)) {
                      titleEl = el;
                    }
                  }
                }

                if (titleEl) {
                  var title = titleEl.textContent.trim();
                  var price = priceEl.textContent.trim();
                  var key = title + '|' + price;
                  if (!seen.has(key) && products.length < 6) {
                    seen.add(key);
                    // Get store/rating
                    var storeEl = card.querySelector('[class*="merchant"],[class*="store"],[class*="seller"],[class*="rating"],[class*="star"]');
                    foundStore = storeEl ? storeEl.textContent.trim().substring(0, 40) : '';
                    // Get link
                    var linkEl = titleEl.closest('a[href]') || card.querySelector('a[href]') || card.closest('a[href]');
                    foundHref = linkEl ? linkEl.href : '';
                    products.push({
                      title: title.substring(0, 70),
                      price: price,
                      store: foundStore,
                      url: foundHref
                    });
                  }
                  break;
                }
              }
            });

            // Text fallback if no product cards found
            if (products.length === 0) {
              var w2 = document.createTreeWalker(document.body, 4);
              var n2, cnt = 0;
              while ((n2 = w2.nextNode()) && cnt < 5) {
                var t = n2.textContent.trim();
                if (t.length > 60 && t.length < 300 && !/^[\\s\\d\\W]+$/.test(t)) {
                  var el2 = n2.parentElement;
                  var rect = el2 && el2.getBoundingClientRect ? el2.getBoundingClientRect() : null;
                  if (rect && rect.top > 50 && rect.height > 0) { textLines.push(t); cnt++; }
                }
              }
            }
          } else {
            // Product detail / info page
            var h1 = document.querySelector('h1');
            textLines.push(h1 ? h1.textContent.trim() : document.title);
            var els = document.querySelectorAll('h2,h3,p,[class*="price"],[class*="rating"],[class*="review"]');
            for (var k = 0; k < els.length && textLines.length < 10; k++) {
              var t2 = els[k].textContent.trim();
              if (t2 && t2.length > 5 && t2.length < 300) textLines.push(t2);
            }
          }

          return JSON.stringify({products: products, text: textLines.join('\\n'), url: url});
        })()
      `);
      return raw ? JSON.parse(raw) : null;
    } catch(e) {
      return null;
    }
  }

  async getState() {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        this.webviewEl = window.getActiveWebview();
        await this.waitForWebviewReady();
        const state = await getWebviewState(this.webviewEl);
        if (!state) throw new Error("Null state returned");
        return state;
      } catch (e) {
        if (attempt === 3) throw e;
        this.onLog(`⚠️ State fetch failed (attempt ${attempt}/3). Retrying...`);
        await new Promise(r => setTimeout(r, 1500));
      }
    }
  }

  async start(userGoal) {
    if (this.running) return;
    this.running = true;

    // If we were waiting for a clarifying answer, merge cleanly for a good search query
    let effectiveGoal = userGoal;
    if (this.pendingGoal) {
      // Combine: "shoes" + "50k and casual" → "shoes 50k casual"
      effectiveGoal = `${this.pendingGoal} ${userGoal}`.replace(/\s+/g, ' ').trim();
      this.pendingGoal = '';
    }
    this.onLog(`Starting task: ${effectiveGoal}`);

    try {
      // 1. INTENT CLASSIFICATION
      const classification = window.IntentClassifier.classify(userGoal);
      this.onLog(`\uD83C\uDFAF Intent classified as: ${classification.intent}`);
      if (classification.intent === 'chat') {
        this.onNeedUser(`Hi! I can search the web for you. Try: "find me shoes under \u20B92000", "what's the weather?", or "iPhone 17 pro price".`);
        this.running = false;
        return;
      }

      // 2. PLAN
      let state = await this.getState();
      const plan = await window.PlannerAI.decomposeGoal(effectiveGoal, state);
      
      if (plan.questions && plan.questions.length > 0) {
        this.pendingGoal = effectiveGoal; // remember context for follow-up answer
        this.onNeedUser(plan.questions[0]);
        this.running = false;
        return;
      }

      // FIX: Model may hallucinate incorrect search terms (e.g. iPhone 17 → iPhone 13).
      // Build search terms from the user's goal but strip action prefixes like 'find me'
      const cleanGoal = effectiveGoal
        .replace(/^(find me(?: an?| the)?|search for|look for|buy me|get me|show me|tell me about|what is|what are)\s+/i, '')
        .replace(/^(an?|the)\s+/i, '')
        .trim();
      const userSearchTerms = encodeURIComponent(cleanGoal || effectiveGoal.trim());

      // SHOPPING SHORTCUT: for product/price queries, add tbm=shop to get actual store listings
      // instead of AI Overview text. Much better results for buy/find-product intents.
      const SHOPPING_WORDS = /\b(buy|shoe|shoes|sneaker|boot|sandal|phone|iphone|android|laptop|headphone|watch|clothes|shirt|dress|bag|camera|tv|console|game|product|brand|nike|adidas|apple|samsung|oneplus|under|below|budget|cheap|affordable|best price|deal|discount|\u20B9|rs\.?)\b/i;
      const isShoppingQuery = SHOPPING_WORDS.test(effectiveGoal);

      for (let i = 0; i < plan.steps.length; i++) {
        if (plan.steps[i].toLowerCase().includes('google.com/search?q=')) {
          // For shopping queries, navigate directly to Shopping tab results
          const searchBase = isShoppingQuery
            ? `google.com/search?tbm=shop&q=${userSearchTerms}`
            : `google.com/search?q=${userSearchTerms}`;
          plan.steps[i] = plan.steps[i].replace(
            /google\.com\/search\?(?:tbm=shop&)?q=[^\s'"&]*/,
            searchBase
          );
        }
      }

      this.onLog(`📝 Plan created: ${plan.steps.length} steps`);
      plan.steps.forEach((s, i) => this.onLog(`  Step ${i+1}: ${s}`));

      // 3. EXECUTE PLAN
      for (let i = 0; i < plan.steps.length; i++) {
        if (!this.running) break;
        const currentStep = plan.steps[i];
        if (this.onStepStart) this.onStepStart(i);
        this.onLog(`\n--- Step ${i + 1}/${plan.steps.length}: ${currentStep} ---`);

        let stepSuccess = false;
        let actionAttempts = 0;
        let lastActionStr = "Started step";
        let observerHint = "";
        let repeatedActionCount = 0;

        // Wait for any in-progress navigation to settle before evaluating this step
        await this.waitForWebviewReady();

        // Pre-check: if we're already on a results/destination page, skip redundant steps
        {
          const preState = await this.getState();
          // Use tracked URL as fallback if getState() returns empty (happens right after navigate)
          const preUrl = (preState.url || this.lastNavigatedUrl || '').toLowerCase();
          const stepL = currentStep.toLowerCase();
          const onSearchResults = preUrl.includes('search?q=') || preUrl.includes('/search');

          // Skip any step that just wants to interact with a search bar we've already used
          const isSearchBarStep = stepL.includes('search bar') || stepL.includes('search button') ||
                                   stepL.includes('press enter') || stepL.includes('click search') ||
                                   (stepL.startsWith('search for') && onSearchResults) ||
                                   (stepL.includes('type') && stepL.includes('search') && onSearchResults);

          if (onSearchResults && isSearchBarStep) {
            this.onLog(`⏭️ Already on results page — skipping redundant step.`);
            if (this.onStepEnd) this.onStepEnd(i);
            continue;
          }

          // "Read/report results" shortcut: scrape products and navigate to best one
          const isReadStep = stepL.includes('read') || stepL.includes('report') ||
                             stepL.includes('extract') || stepL.includes('summarize');
          if (onSearchResults && isReadStep) {
            this.onLog(`📄 Finding best results...`);
            const scraped = await this.scrapePageContent(userGoal);

            if (scraped && scraped.products && scraped.products.length > 0) {
              // Step 1: Filter junk titles (map labels, nav links, very short text)
              const JUNK = /^(view|see all|see more|more options|load more|next|previous|map|image|photo|scroll|close|open|expand|all hotels|hotels in|hotels near|book|check)/i;
              const seenTitles = new Set();
              const unique = scraped.products.filter(p => {
                if (!p.title || p.title.length < 8) return false;
                if (JUNK.test(p.title.trim())) return false;
                const key = p.title.toLowerCase().trim();
                if (seenTitles.has(key)) return false;
                seenTitles.add(key);
                return true;
              });

              if (unique.length === 0) {
                // Fall through to text
                const fallbackState = await this.getState();
                const snippets = (fallbackState.text_snippets || []).slice(0, 4).join('\n');
                this.onNeedUser(snippets || `I've opened the results for you: ${preUrl}`);
                this.running = false;
                return;
              }

              // Step 2: Parse prices and rank (lowest price first as default)
              unique.forEach(p => {
                p._numPrice = parseFloat((p.price || '').replace(/[^0-9.]/g, '')) || 999999;
              });
              unique.sort((a, b) => a._numPrice - b._numPrice);

              const top = unique[0];
              const allList = unique.slice(0, 5).map((p, i) =>
                `${i === 0 ? '⭐' : `${i + 1}.`} ${p.title} — ${p.price}`
              ).join('\n');

              // Step 3: Navigate to Google Maps search (avoids ERR_NAME_NOT_RESOLVED
              // from direct hotel URLs that may not exist/load)
              const mapsQuery = encodeURIComponent(top.title + ' ' + (preUrl.includes('near+me') ? 'near me' : ''));
              const mapsUrl = `https://www.google.com/maps/search/${mapsQuery}`;
              this.onLog(`🗺️ Opening "${top.title}" on Google Maps...`);
              await executeAction({ tool: 'navigate', args: { url: mapsUrl } }, this.webviewEl);
              await new Promise(r => setTimeout(r, 2500));
              await this.waitForWebviewReady();

              const msg = `Here are the options I found:\n\n${allList}\n\nI chose ⭐ ${top.title} (${top.price}) — it's the most affordable option from the list. I've opened it on Google Maps above so you can see photos, reviews, directions and book. Want a different one? Just say which!`;
              this.onNeedUser(msg);
            } else if (scraped && scraped.text && scraped.text.length > 20) {
              this.onNeedUser(`Here's what I found:\n\n${scraped.text.substring(0, 1200)}`);
            } else {
              const fallbackState = await this.getState();
              const snippets = (fallbackState.text_snippets || []).slice(0, 4).join('\n');
              this.onNeedUser(snippets || `I've opened the results for you: ${preUrl}`);
            }
            this.running = false;
            return;
          }
        }

        // SEARCH SHORTCUT: bypass the search-bar-typing loop entirely.
        // Catches all common planner outputs for web searches.
        {
          const stepL = currentStep.toLowerCase();
          // Pattern 1: "search for X" or "search X"
          const searchForMatch = stepL.match(/^search (?:for |the web for |google for |on google for )?['"]?(.+?)['"]?\s*$/);
          // Pattern 2: "type 'X' into the search bar"
          const typeIntoMatch = currentStep.match(/type ['"](.+?)['"] into (?:the )?(?:google )?search/i);

          const query = (searchForMatch && searchForMatch[1]) || (typeIntoMatch && typeIntoMatch[1]);
          if (query) {
            const cleanQuery = query.trim().replace(/^(search|for)\s+/i, '').replace(/['"]+$/, '').trim();
            const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(cleanQuery)}`;
            this.onLog(`🔎 Search shortcut: navigating to Google for "${cleanQuery}"`);
            await executeAction({ tool: 'navigate', args: { url: searchUrl } }, this.webviewEl);
            await new Promise(r => setTimeout(r, 2000));
            await this.waitForWebviewReady();
            if (this.onStepEnd) this.onStepEnd(i);
            stepSuccess = true;
            continue;
          }

          // Pattern 4: any step about focusing/clicking a search bar — skip
          if (/(?:focus|click).{0,20}search bar/i.test(currentStep) ||
              /^click (?:on )?the search/i.test(currentStep)) {
            this.onLog(`⏭️ Skipping search-bar interaction step.`);
            if (this.onStepEnd) this.onStepEnd(i);
            stepSuccess = true;
            continue;
          }
        }

        while (!stepSuccess && actionAttempts < 5 && this.running) {
          state = await this.getState();
          
          // Execution Engine picks concrete action
          this.onLog(`💡 Deciding action...`);
          const action = await window.ExecutionEngine.determineAction(currentStep, state, observerHint, lastActionStr);
          
          if (!action) {
            this.onLog(`⚠️ Execution engine returned no action. Continuing...`);
            actionAttempts++;
            continue;
          }

          // Execute action
          const actionStr = `${action.tool} ${action.args ? JSON.stringify(action.args) : ''}`;
          if (actionStr === lastActionStr) {
              repeatedActionCount++;
              if (repeatedActionCount >= 3) {
                  this.onLog(`⚠️ Stuck in loop. Same action repeated 3 times. Skipping step...`);
                  break;
              }
          } else {
              repeatedActionCount = 0;
          }
          
          this.onLog(`⚙️ Action: ${action.tool} ${JSON.stringify(action.args)}`);
          
          if (action.tool === 'done') {
             this.onLog(`🤖 Aurora: ${action.args.message || 'Task completed.'}`);
             this.running = false;
             return;
          }

          let actionResult = "Action executed";
          try {
              actionResult = await executeAction(action, this.webviewEl);
              // Track navigated URL immediately so pre-checks can rely on it
              if (action.tool === 'navigate' && action.args?.url) {
                  this.lastNavigatedUrl = action.args.url;
              }
          } catch(e) {
              actionResult = `ERROR: ${e.message}`;
              this.onLog(`⚠️ ${actionResult}`);
          }
          lastActionStr = `${action.tool} ${action.args ? JSON.stringify(action.args) : ''} -> Result: ${actionResult}`;
          
          // AUTO-ENTER: After any 'type' action, automatically press Enter.
          if (action.tool === 'type') {
              await new Promise(r => setTimeout(r, 400));
              const urlBefore = state.url || '';
              await executeAction({ tool: 'press', args: { key: 'Enter' } }, this.webviewEl);
              await new Promise(r => setTimeout(r, 1500));
              await this.waitForWebviewReady();
              state = await this.getState();
              const urlAfter = state.url || '';
              if (urlAfter !== urlBefore && !urlAfter.includes('about:blank')) {
                  this.onLog(`✅ URL changed after Enter — step complete.`);
                  stepSuccess = true;
                  actionAttempts++;
                  continue;
              }
          } else {
              // For all other actions (navigate, click, etc.): wait and refresh state
              await new Promise(r => setTimeout(r, 800));
              await this.waitForWebviewReady();
              state = await this.getState(); // now state reflects post-action URL
          }

          // Observer evaluates result
          this.onLog(`👀 Observing results...`);
          const observation = await window.ObserverAI.observePageState(state, currentStep, lastActionStr);
          this.onLog(`📊 Observation: ${observation.what_changed}`);
          
          if (observation.blockers.length > 0) {
            this.onLog(`🛑 Blocker detected: ${observation.blockers.join(', ')}`);
            break;
          }

          // Navigate success: always mark step done (fixed: was checking pre-action URL)
          if (action.tool === 'navigate' && observation.action_succeeded) {
              observation.goal_achieved = true;
          }

          // If we're on a search results page, step is done
          const stepLower = currentStep.toLowerCase();
          const urlLower = (state.url || '').toLowerCase(); // now post-action URL
          if ((stepLower.includes('search') || stepLower.includes('type') || stepLower.includes('navigate')) && 
              (urlLower.includes('search?q=') || urlLower.includes('results') || urlLower.includes('/search'))) {
              observation.goal_achieved = true;
          }

          // "Read results" step: if on a results page, mark done immediately
          if ((stepLower.includes('read') || stepLower.includes('report') || stepLower.includes('extract')) &&
              (urlLower.includes('search?q=') || urlLower.includes('/search'))) {
              observation.goal_achieved = true;
          }

          if (observation.goal_achieved) {
            this.onLog(`✅ Step achieved!`);
            stepSuccess = true;
          } else if (!observation.action_succeeded) {
            this.onLog(`⚠️ Action failed to advance state. Next hint: ${observation.next_hint}`);
            observerHint = observation.next_hint;
          } else {
            // Action succeeded but goal not yet achieved
            observerHint = observation.next_hint;
          }
          
          actionAttempts++;
        }
        
        if (this.onStepEnd) this.onStepEnd(i);
      }

      this.onLog(`✅ Task complete.`);

      // Final answer: extract real structured content from the webview DOM
      try {
        const finalState = await this.getState();
        const finalUrl = (finalState.url || '');
        if (finalUrl && !finalUrl.includes('about:blank') && !finalUrl.includes('newtab')) {
          const scraped = await this.scrapePageContent(userGoal);
          if (scraped && scraped.products && scraped.products.length > 0) {
            const JUNK = /^(view|see all|see more|more options|load more|map|image|photo|scroll|close|expand|book|check)/i;
            const seenT = new Set();
            const unique = scraped.products.filter(p => {
              if (!p.title || p.title.length < 8) return false;
              if (JUNK.test(p.title.trim())) return false;
              const k = p.title.toLowerCase().trim();
              if (seenT.has(k)) return false;
              seenT.add(k); return true;
            });
            if (unique.length > 0) {
              unique.forEach(p => { p._numPrice = parseFloat((p.price || '').replace(/[^0-9.]/g, '')) || 999999; });
              unique.sort((a, b) => a._numPrice - b._numPrice);
              const list = unique.slice(0, 5).map((p, i) =>
                `${i === 0 ? '⭐' : `${i + 1}.`} ${p.title} — ${p.price}`).join('\n');
              this.onNeedUser(`Here are the best results I found:\n\n${list}\n\nI've picked ⭐ ${unique[0].title} as the top choice (best price). Want me to open a different one?`);
            } else {
              const snippets = (finalState.text_snippets || []).slice(0, 4).join('\n');
              if (snippets) this.onNeedUser(`Here's what I found:\n\n${snippets}`);
              else this.onNeedUser(`I've opened the results for you: ${finalUrl}`);
            }
          } else if (scraped && scraped.text && scraped.text.length > 20) {
            this.onNeedUser(`Here's what I found:\n\n${scraped.text.substring(0, 1200)}`);
          } else {
            const snippets = (finalState.text_snippets || []).slice(0, 4).join('\n');
            if (snippets) this.onNeedUser(`Here's what I found:\n\n${snippets}`);
            else this.onNeedUser(`I've opened the results for you: ${finalUrl}`);
          }
        }
      } catch (e) { /* silent */ }
    } catch (e) {
      this.onLog(`❌ Agent Error: ${e.message}`);
      this.onNeedUser(`Sorry, something went wrong: ${e.message}`);
    } finally {
      this.running = false;
      // NOTE: Do NOT call onLog here — it would overwrite the result shown to the user
    }
  }

  stop() {
    this.running = false;
    this.onLog("Agent stopped by user.");
  }
}

window.AgentLoop = AgentLoop;
