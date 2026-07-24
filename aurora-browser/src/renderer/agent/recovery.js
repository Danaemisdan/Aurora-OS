function getRecoveryAction(state, fallbacks, verifierResult) {
    if (verifierResult.success) return null; // No recovery needed

    // Quick modal auto-recovery
    if (state.blockers && state.blockers.modal) {
        // Find a generic close button
        const closeBtn = state.interactive_elements.find(e =>
            e.name.toLowerCase().includes('close') ||
            e.name === 'X' ||
            e.stableId.toLowerCase().includes('close')
        );
        if (closeBtn) {
            return { tool: 'click', args: { stableId: closeBtn.stableId } };
        }
    }

    if (fallbacks && fallbacks.length > 0) {
        return fallbacks[0]; // Just take the first fallback for now (could be smarter)
    }

    return null;
}

window.getRecoveryAction = getRecoveryAction;
