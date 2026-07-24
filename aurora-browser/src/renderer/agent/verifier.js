// Validates outcomes based on the snapshot

function verifyState(state, condition) {
    if (!condition) return { success: true };
    const { check } = condition;
    // Support both 'args' object and flat properties (LLM sometimes outputs both)
    const args = condition.args || condition;

    try {
        if (check === 'url_changed') {
            const expectedUrl = args.expected_url || args.url || '';
            if (expectedUrl) {
                const domain = expectedUrl.replace('https://', '').replace('http://', '').split('/')[0];
                return { success: state.url.includes(domain), reason: `URL is ${state.url}` };
            }
            return { success: state.url !== 'about:blank', reason: `URL is still about:blank` };
        }
        if (check === 'url_contains') {
            const expected = args.url || args.text || args.expected_url || '';
            return { success: state.url.toLowerCase().includes(expected.toLowerCase()), reason: `URL does not contain ${expected}` };
        }
        if (check === 'text_present' || check === 'element_present') {
            const expected = (args.text || args.expected_text || args.name || args.value || '').toLowerCase();
            if (!expected) return { success: true };
            const foundInSnippets = (state.text_snippets || []).some(t => t.toLowerCase().includes(expected));
            const foundInElements = (state.interactive_elements || []).some(e => (e.name || '').toLowerCase().includes(expected));
            const foundInHeadings = (state.headings || []).some(h => h.toLowerCase().includes(expected));
            return { success: foundInSnippets || foundInElements || foundInHeadings, reason: `"${expected}" not found on page` };
        }
        if (check === 'domain_is') {
            const expectedDomain = args.domain || args.url || '';
            return { success: state.domain.includes(expectedDomain), reason: `Domain is ${state.domain}` };
        }
        // Unknown check — assume success so it doesn't block the loop
        return { success: true, reason: 'Unknown check type, assumed success' };
    } catch (e) {
        // Never block the loop on verifier errors
        return { success: true, reason: `Verify skipped: ${e.message}` };
    }
}

window.verifyState = verifyState;
