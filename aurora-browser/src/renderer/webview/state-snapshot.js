// Deterministic UI Indexer (ported from Operator OS)
// Generates stable IDs (BTN_001, INP_002), extracts DOM snapshot, and injects visual labels

function clearAtlasLabels() {
  const container = document.getElementById('op-mapper-container');
  if (container) container.remove();
}

function isVisible(node, rect) {
  if (rect.width < 5 || rect.height < 5) return false;
  if (node.getAttribute('aria-hidden') === 'true') return false;
  
  if (rect.bottom <= 0 || rect.right <= 0 || rect.top >= window.innerHeight || rect.left >= window.innerWidth) return false;
  
  const style = window.getComputedStyle(node);
  const isMediaForVis = ['img', 'video', 'svg', 'canvas', 'picture', 'iframe', 'object', 'embed'].includes(node.tagName.toLowerCase()) || (style.backgroundImage && style.backgroundImage.includes('url('));
  if (rect.width > window.innerWidth * 0.95 && rect.height > window.innerHeight * 0.95 && !isMediaForVis) return false;
  
  if (style.visibility === 'hidden' || parseFloat(style.opacity) < 0.1 || style.display === 'none') return false;
  
  let visibleRect = { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
  let parent = node;
  while (parent && parent !== document.body && parent !== document.documentElement) {
     const parentStyle = window.getComputedStyle(parent);
     if (parseFloat(parentStyle.opacity) < 0.1 || parentStyle.display === 'none') return false;
     
     if (parentStyle.overflow === 'hidden' || parentStyle.overflowY === 'hidden' || parentStyle.overflowX === 'hidden') {
        const parentRect = parent.getBoundingClientRect();
        visibleRect.top = Math.max(visibleRect.top, parentRect.top);
        visibleRect.bottom = Math.min(visibleRect.bottom, parentRect.bottom);
        visibleRect.left = Math.max(visibleRect.left, parentRect.left);
        visibleRect.right = Math.min(visibleRect.right, parentRect.right);
        if (visibleRect.bottom - visibleRect.top < 5 || visibleRect.right - visibleRect.left < 5) return false;
     }
     parent = parent.parentElement;
  }
  return true;
}

function getStateSnapshot() {
  try {
    // Remove any leftover overlay from previous runs
    const oldOverlay = document.getElementById('op-mapper-container');
    if (oldOverlay) oldOverlay.remove();

    const allNodes = document.querySelectorAll('body *');
    let candidates = [];
    
    allNodes.forEach(node => {
      if (node.classList && (node.classList.contains('op-bounding-box') || node.classList.contains('op-text-label'))) return;
      if (node.id === 'op-mapper-container') return;

      const rect = node.getBoundingClientRect();
      if (!isVisible(node, rect)) return;
      
      const style = window.getComputedStyle(node);
      const tag = node.tagName.toLowerCase();
      const role = node.getAttribute('role') || '';
      
      const isClickableTag = ['button', 'a', 'input', 'select', 'textarea'].includes(tag);
      const hasClickableRole = ['button', 'link', 'menuitem', 'tab', 'checkbox', 'switch'].includes(role);
      const hasClickAttr = node.hasAttribute('onclick') || node.hasAttribute('jsaction') || node.hasAttribute('data-action');
      
      let isPointer = false;
      if (style.cursor === 'pointer') {
         const parentStyle = node.parentElement ? window.getComputedStyle(node.parentElement) : null;
         if (!parentStyle || parentStyle.cursor !== 'pointer') isPointer = true;
      }
      
      const isMedia = ['img', 'video', 'svg', 'canvas', 'picture', 'iframe', 'object', 'embed'].includes(tag) || (style.backgroundImage && style.backgroundImage.includes('url('));
      const isTextTag = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', 'span', 'strong', 'em', 'label'].includes(tag);
      
      let hasDirectText = false;
      for (let child of node.childNodes) {
         if (child.nodeType === Node.TEXT_NODE && child.textContent.trim().length > 0) {
            hasDirectText = true; break;
         }
      }
      
      let isTextLeaf = false;
      if (!isClickableTag && !isMedia && !hasClickableRole && !hasClickAttr && !isPointer) {
        if (hasDirectText && tag !== 'body' && tag !== 'html') {
           if (rect.height < window.innerHeight * 0.5) isTextLeaf = true;
        }
      }
      
      if (!(isClickableTag || hasClickableRole || hasClickAttr || isPointer || isMedia || isTextTag || isTextLeaf)) return;
      
      let prefix = 'ELM';
      if (isClickableTag || hasClickableRole) {
        const inputT = node.getAttribute('type') || '';
        const isButtonInput = ['submit','button','reset','image'].includes(inputT.toLowerCase());
        if (tag === 'a' || role === 'link') prefix = 'LNK';
        else if (isButtonInput || tag === 'button') prefix = 'BTN';
        else if (['input','select','textarea'].includes(tag)) prefix = 'INP';
        else prefix = 'BTN';
      } else if (hasClickAttr) {
        prefix = (isTextTag || hasDirectText) ? 'LNK' : 'BTN';
      } else if (isPointer) {
        prefix = (isTextTag || hasDirectText) ? 'LNK' : 'BTN';
      } else if (isMedia) {
        prefix = tag === 'iframe' ? 'FRM' : (['video', 'canvas', 'object', 'embed'].includes(tag) ? 'VID' : 'IMG');
      } else if (isTextTag || isTextLeaf) {
        prefix = 'TXT';
      } else {
        return;
      }
      
      candidates.push({ node, rect, prefix });
    });

    // Pruning text inside buttons
    let filtered = [];
    for (let i = 0; i < candidates.length; i++) {
      let child = candidates[i];
      let shouldDiscard = false;
      
      let ancestor = child.node.parentElement;
      while (ancestor && ancestor !== document.body && ancestor !== document.documentElement) {
        let parentCandidate = candidates.find(c => c.node === ancestor);
        if (parentCandidate && (parentCandidate.prefix === 'BTN' || parentCandidate.prefix === 'LNK')) {
          if (child.prefix === 'TXT') {
             shouldDiscard = true;
             break;
          }
        }
        ancestor = ancestor.parentElement;
      }
      if (!shouldDiscard) filtered.push(child);
    }

    // Aggressive Pruning: Only keep meaningful elements to keep prompt extremely small
    const filteredPass2 = [];
    for (let i = 0; i < filtered.length; i++) {
      const el = filtered[i];
      const n = el.node;
      
      const ariaLbl = (n.getAttribute('aria-label') || n.getAttribute('aria-labelledby') || '').trim();
      const titleLbl = (n.getAttribute('title') || n.getAttribute('data-tooltip') || '').trim();
      const innerTxt = (n.innerText || '').trim();
      const altTxt = (n.alt || '').trim();
      const valTxt = (n.value || n.placeholder || '').trim();
      
      const combinedText = ariaLbl || titleLbl || innerTxt || altTxt || valTxt;
      
      // If the element has absolutely no text/label, discard it unless it's a specific input field
      if (combinedText.length === 0 && el.prefix !== 'INP') {
          continue;
      }

      // Ignore generic ELM wrappers unless they have a lot of text (e.g. paragraphs)
      if (el.prefix === 'ELM' && combinedText.length < 20) {
          continue;
      }
      
      // Filter out elements that are completely off-screen or invisible
      if (el.rect.width === 0 || el.rect.height === 0) continue;

      // Deduplicate nested interactive elements
      if (el.prefix === 'BTN' || el.prefix === 'LNK') {
        const hasInteractiveChild = filtered.some((other, j) => {
          if (j === i) return false;
          if (other.prefix !== 'BTN' && other.prefix !== 'LNK' && other.prefix !== 'INP') return false;
          return el.node !== other.node && el.node.contains(other.node);
        });
        if (hasInteractiveChild) continue;
      }
      
      filteredPass2.push(el);
    }
    
    const elements = [];
    let counters = { BTN: 0, INP: 0, LNK: 0, IMG: 0, VID: 0, TXT: 0, ELM: 0 };
    
    filteredPass2.forEach(c => {
    try {
      counters[c.prefix]++;
      const id = `${c.prefix}_${String(counters[c.prefix]).padStart(3, '0')}`;
      const node = c.node;
      const rect = c.rect;
      
      try { node.setAttribute('data-op-id', id); } catch(_) {}
      
      // Label Extraction (no visual overlays — debug labels removed)
      const ariaLbl = String(node.getAttribute('aria-label') || node.getAttribute('aria-labelledby') || '');
      const titleLbl = String(node.getAttribute('title') || node.getAttribute('data-tooltip') || '');
      const innerTxt = String(node.innerText || '').trim().replace(/\n/g,' ').replace(/\s+/g,' ').substring(0, 80);
      let text = String(ariaLbl || titleLbl || innerTxt || node.getAttribute('placeholder') || node.alt || '').trim();
      
      let parent = node.parentElement;
      let parentContext = '';
      let depth = 0;
      while(parent && parent.tagName !== 'BODY' && depth < 3) {
        if (parent.id) parentContext += `#${parent.id} `;
        if (parent.className && typeof parent.className === 'string') parentContext += `.${parent.className.split(' ')[0]} `;
        parent = parent.parentElement;
        depth++;
      }

      let semanticIntent = '';
      let tLower = text.toLowerCase();
      const pContextLower = parentContext.toLowerCase();
      
      // SEMANTIC PROXIMITY INDEXING: If button/link has no text, look for nearby text node
      if (!text && (c.prefix === 'BTN' || c.prefix === 'LNK' || c.prefix === 'IMG')) {
        let closestText = '';
        let minDistance = 150; // max distance 150px
        filteredPass2.forEach(sibling => {
           if (sibling.node !== node && (sibling.prefix === 'TXT' || sibling.prefix === 'LNK' || sibling.prefix === 'BTN')) {
              let sText = '';
              try { sText = String(sibling.node.innerText || sibling.node.getAttribute('aria-label') || '').trim(); } catch(e) {}
              if (sText) {
                 const dx = (rect.left + rect.width/2) - (sibling.rect.left + sibling.rect.width/2);
                 const dy = (rect.top + rect.height/2) - (sibling.rect.top + sibling.rect.height/2);
                 const dist = Math.sqrt(dx*dx + dy*dy);
                 if (dist < minDistance) {
                    minDistance = dist;
                    closestText = sText.substring(0, 40);
                 }
              }
           }
        });
        if (closestText) {
           text = `[Adjacent to: ${closestText}]`;
           tLower = text.toLowerCase();
        }
      }
      
      if (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA') {
        const type = String(node.getAttribute('type') || '').toLowerCase();
        if (type === 'search' || tLower.includes('search') || pContextLower.includes('search')) {
          semanticIntent = `Input field to search or query the site for '${text || 'keywords'}'`;
        } else if (type === 'email' || tLower.includes('email')) {
          semanticIntent = `Email input field for authentication or contact`;
        } else if (type === 'password') {
          semanticIntent = `Password input field for authentication`;
        } else {
          semanticIntent = `Text input field for entering '${text || 'data'}'`;
        }
      } else if (node.tagName === 'BUTTON' || c.prefix === 'BTN') {
        if (tLower.includes('search') || tLower.includes('find')) {
          semanticIntent = `Button to submit search query`;
        } else if (tLower.includes('sign in') || tLower.includes('log in') || tLower.includes('login')) {
          semanticIntent = `Button to authenticate and log into user account`;
        } else if (tLower.includes('add to cart') || tLower.includes('buy')) {
          semanticIntent = `Button to add item to shopping cart or purchase`;
        } else if (tLower.includes('close') || tLower.includes('dismiss') || tLower.includes('cancel')) {
          semanticIntent = `Button to close modal or dismiss dialog`;
        } else {
          semanticIntent = `Button to trigger action: ${text || 'submit'}`;
        }
      } else if (c.prefix === 'LNK') {
        if (tLower.includes('sign in') || tLower.includes('log in')) {
          semanticIntent = `Navigation link to authentication/login page`;
        } else {
          semanticIntent = `Navigation link leading to ${text || 'another page'}`;
        }
      } else if (c.prefix === 'IMG') {
        semanticIntent = `Visual image depicting ${text || 'content'}`;
      } else {
        semanticIntent = `Content element displaying ${text || 'information'}`;
      }

      let safeHref = '';
      try { safeHref = typeof node.href === 'string' ? node.href : (node.getAttribute('href') || ''); } catch(e) {}
      
      let safeValue = '';
      try { safeValue = String(node.value || ''); } catch(e) {}

      elements.push({
        id: id,
        type: c.prefix,
        tag: String(node.tagName).toLowerCase(),
        text: text,
        href: safeHref,
        value: safeValue,
        semanticIntent: semanticIntent,
        parentContext: parentContext.trim()
      });
    } catch (loopErr) {
      console.warn("Error processing element:", loopErr);
    }
    });


    // No overlay rendering — debug labels disabled

    const elementsByParent = {};
    elements.forEach(e => {
       const p = e.parentContext || 'General';
       if (!elementsByParent[p]) elementsByParent[p] = [];
       elementsByParent[p].push(e);
    });
    
    let markdown_tree = '';
    for (const [parent, els] of Object.entries(elementsByParent)) {
       markdown_tree += `\n### Area: ${parent}\n`;
       els.forEach(e => {
          markdown_tree += `- [${e.id}] ${e.text || e.semanticIntent} ${e.href ? '(Link: '+e.href+')' : ''}\n`;
       });
    }

    // Detect popups/modals
    const popups = Array.from(document.querySelectorAll('dialog, [role="dialog"], [role="alertdialog"], .modal, .popup, .overlay')).filter(m => {
       const st = window.getComputedStyle(m);
       return st.display !== 'none' && st.visibility !== 'hidden' && parseFloat(st.opacity) > 0.1;
    });
    const hasPopup = popups.length > 0;

    return {
      url: window.location.href,
      title: document.title,
      hasPopup: hasPopup,
      markdown_tree: markdown_tree.trim(),
      elements: elements,
      interactiveElements: elements.filter(e => ['BTN', 'LNK', 'INP'].includes(e.type))
    };
  } catch (err) {
    console.error("Aurora Indexer Error:", err);
    return {
      url: window.location.href,
      title: document.title,
      hasPopup: false,
      markdown_tree: '(Error indexing DOM)',
      elements: [],
      interactiveElements: []
    };
  }
}

module.exports = { getStateSnapshot, clearAtlasLabels };
