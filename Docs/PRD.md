Good.

You’re not asking for random patches anymore.

You want a **real specification** for building:

> **Aurora AI = ChatGPT Atlas-level autonomous browser agent**
> With:
>
> * Eyes (vision)
> * Hands (scroll, click, drag, type, shortcuts)
> * Brain (see → think → act → verify loop)
> * Memory (knowledge system)
> * Internet research
> * Task persistence
> * Safety + approval gates
> * Local-first AI

Below is a **serious PRD** written so Gemini 3 (or any strong model) can implement it strictly.

No fluff. No vibes. Pure architecture.

---

# 🔷 PRODUCT REQUIREMENTS DOCUMENT

# Project: Aurora AI – Atlas-Class Autonomous Browser Agent

---

# 1. Vision

Aurora AI is a fully autonomous browser operator embedded inside Aurora OS.

It behaves like a skilled human:

* It sees the page.
* It thinks about the goal.
* It performs one action.
* It verifies.
* It adapts.
* It repeats.

It must:

* Operate any website.
* Execute complex multi-step workflows.
* Use page DOM and visual context.
* Perform research across tabs.
* Store knowledge.
* Ask for approval on sensitive actions.
* Stop only when goal is achieved, max steps reached, or user interrupts.

This is not a chatbot.

This is a **persistent autonomous operator**.

---

# 2. Core Architectural Principle

Aurora AI must operate under a strict control loop:

```
SEE → THINK → ACT → VERIFY → (loop)
```

This loop is the foundation of everything.

It must never:

* Plan 20 steps blindly
* Execute multiple actions without verification
* Act without fresh state

Every iteration must use updated browser state.

---

# 3. System Architecture Overview

Aurora AI consists of five major subsystems:

---

## 3.1 EYES (Perception System)

Aurora must be able to perceive:

### A. DOM Snapshot

* URL
* Page title
* Visible text
* Clickable elements
* Inputs and their values
* Buttons
* Links
* Scroll position
* Visible bounding boxes
* ARIA roles

This must be extracted via preload script inside `<webview>`.

The output must be:

* Deterministic
* Lightweight
* Structured JSON
* No circular references

---

### B. Visual Snapshot (Optional but supported)

* Compressed screenshot
* Bounding box overlays
* For fallback when DOM is unreliable

Vision is secondary to DOM.
DOM-first. Vision fallback.

---

### C. Blocker Detection

Aurora must detect:

* Modals
* Cookie banners
* Popups
* Login walls
* Captchas

These are classified as:

* Obstacle state

If obstacle detected:
→ recovery strategy must trigger.

---

# 3.2 HANDS (Action Execution System)

Aurora must support the following primitive actions:

### Navigation

* navigate(url)
* back()
* forward()
* reload()

### Interaction

* click(selector or stableId)
* doubleClick()
* rightClick()
* hover()
* scroll(direction or amount)
* scrollTo(selector)
* drag(source, target)
* drop()
* type(selector, text)
* clearInput()
* press(key)
* selectDropdown()
* focus(selector)

### Tab Control

* openTab(url)
* closeTab()
* switchTab(index)
* listTabs()

### System Actions

* wait(ms)
* pauseUntil(condition)
* screenshot()

All actions must:

* Be atomic
* Be verified
* Be reversible if possible

---

# 3.3 BRAIN (Decision Engine)

The brain must:

Input:

* TaskSpec (goal)
* Current state snapshot
* Memory
* Step history

Output:
Strict JSON:

```
{
  "thought": "...",
  "action": { ... },
  "verify": { ... },
  "fallbacks": [ ... ],
  "done": false
}
```

Constraints:

* One action per step.
* Must justify action in thought.
* Must define verification condition.
* Must define fallback if verify fails.
* Must set done=true only when success criteria met.

---

# 3.4 MEMORY (Knowledge System)

Aurora requires three layers of memory:

---

## A. Short-Term Memory

* Current task steps
* State transitions
* Recent decisions
* Max 20 steps

Used to avoid repetition.

---

## B. Session Knowledge

* Extracted data during task
* Research results
* Structured findings

Example:

```
{
  "companies_found": [...],
  "forms_completed": [...],
  "links_visited": [...]
}
```

---

## C. Long-Term Knowledge (Persistent)

* User preferences
* Past successes
* Credentials (never stored plaintext)
* Reusable workflows

Must use:

* Vector store or structured JSON DB
* Semantic retrieval for recall

---

# 3.5 INTERNET RESEARCH ENGINE

Aurora must be capable of:

* Opening search engines
* Querying
* Opening multiple results
* Comparing data
* Extracting structured information
* Building summaries

Must include:

Research Skill:

* Search
* Multi-tab gather
* Extract
* Compare
* Synthesize

---

# 4. Control Loop Specification

Aurora’s main loop:

```
while (!done && steps < maxSteps && !userStopped) {

  state = getFreshState()

  decision = brain.decide(taskSpec, state, memory)

  validate(decision)

  if decision.done:
      break

  execute(decision.action)

  newState = getFreshState()

  if verify(decision.verify, newState):
      update memory
  else:
      try fallbacks
      if still fails:
          increment staleCounter

  if staleCounter >= 3:
      stop with error
}
```

Hard limits:

* maxSteps = 20
* staleThreshold = 3

---

# 5. Skill System

Aurora must recognize task type and route accordingly:

### Skills:

* NAVIGATION
* SEARCH
* LISTING
* EXTRACTION
* FORM_FILL
* PAGINATION
* AUTH_HANDOFF
* APPLY / SUBMIT
* MULTI_TAB_COMPARE
* SCROLL_DISCOVERY

SkillRouter:
Maps intent → skill strategy.

---

# 6. Intent Parsing

Aurora must classify input as:

* Conversational
* Browser-required
* Hybrid

Browser must never activate for pure chat.

---

# 7. Safety and Governance

Aurora must implement:

### Commit Gate

If action involves:

* Payment
* Submit
* Delete
* Confirm
* Purchase

→ Pause and ask for explicit approval.

---

### Auth Handoff

If login detected:
→ Pause
→ Wait for user
→ Resume on "continue"

---

### Captcha Detection

Never attempt to bypass.
Always pause.

---

# 8. Error Handling

Aurora must detect:

* Page not loading
* No interactive elements
* Repeated state
* Infinite scroll loops

And stop gracefully.

---

# 9. Performance Requirements

Target:

* < 500ms state extraction
* < 2s decision latency (local model)
* < 50ms action dispatch

State must be lightweight.

No full DOM dump.

---

# 10. Atlas-Level Behaviors Required

Aurora must:

* Operate across multiple tabs.
* Compare information.
* Extract structured data.
* Apply to forms.
* Handle scroll discovery.
* Detect infinite lists.
* Handle lazy loading.
* Adapt to dynamic DOM changes.
* Retry intelligently.

---

# 11. Success Criteria

Aurora is considered Atlas-class when:

* It completes multi-step tasks autonomously.
* It does not default to global search unnecessarily.
* It verifies each action.
* It handles modals and blockers.
* It stops when stuck.
* It asks for approval correctly.
* It uses memory to avoid repetition.

---

# 12. Out of Scope (For MVP)

* Voice control
* Emotional AI
* Human-like conversation style
* Vision-first navigation

These come later.

---

# 13. Implementation Order

Phase 1:
Stable DOM + State extraction

Phase 2:
Strict see-think-act-verify loop

Phase 3:
SkillRouter + Listing + Pagination

Phase 4:
Memory system

Phase 5:
Research engine

Phase 6:
Safety gates + Handoff

Phase 7:
Multi-tab intelligence

---

# Final Definition

Aurora AI must not behave like:

> “Let me google that.”

It must behave like:

> “I am inside the browser. I see. I think. I act.”

It is not a chatbot with a browser.

It is a browser operator with a brain.

---

If you want next, I can give you:

* The exact JSON schema to enforce
* The strict system prompt
* The module file structure
* The minimal code skeleton
* Or the local LLM configuration guide

Now we build it correctly.
