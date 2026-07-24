(() => {
    const listeners = new Map();
    const sessionId = `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    let currentTaskId = null;

    function on(type, handler) {
        if (!type || typeof handler !== 'function') return () => {};
        const set = listeners.get(type) || new Set();
        set.add(handler);
        listeners.set(type, set);
        return () => off(type, handler);
    }

    function off(type, handler) {
        const set = listeners.get(type);
        if (!set) return;
        set.delete(handler);
        if (set.size === 0) listeners.delete(type);
    }

    function emit(type, payload = {}) {
        const envelope = {
            type,
            sessionId,
            taskId: currentTaskId,
            timestamp: Date.now(),
            ...payload
        };
        const set = listeners.get(type);
        if (set) {
            set.forEach((fn) => {
                try { fn(envelope); } catch { /* ignore */ }
            });
        }
        const wildcard = listeners.get('*');
        if (wildcard) {
            wildcard.forEach((fn) => {
                try { fn(envelope); } catch { /* ignore */ }
            });
        }
        return envelope;
    }

    function setTask(taskId) {
        currentTaskId = taskId || null;
    }

    function getContext() {
        return { sessionId, taskId: currentTaskId };
    }

    window.AuroraBus = { on, off, emit, setTask, getContext };
})();
