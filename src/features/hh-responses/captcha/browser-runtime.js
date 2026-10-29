(function (root) {
    function visibleChallenge(document) {
        return [...document.querySelectorAll('input, img, canvas, [data-qa*="captcha"]')].some(element => {
            const rect = element.getBoundingClientRect();
            if (!rect.width || !rect.height) return false;
            const style = document.defaultView?.getComputedStyle(element);
            if (style?.visibility === 'hidden' || style?.display === 'none') return false;
            return /captcha|капч/i.test([
                element.name, element.id, element.getAttribute('data-qa'),
                element.getAttribute('src'), element.getAttribute('placeholder'),
                element.getAttribute('aria-label')
            ].join(' '));
        });
    }

    function createCaptchaRuntime(options = {}) {
        const now = options.now || Date.now;
        const sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
        const visible = options.visible || (() => visibleChallenge(options.document || root.document));
        const isStopped = options.isStopped || (() => false);
        const timeoutMs = options.timeoutMs ?? 300000;
        let pausedAt, pausedMs = 0, pending, failed = false;
        return {
            visible,
            paused: () => pausedAt !== undefined,
            now: () => now() - pausedMs - (pausedAt === undefined ? 0 : now() - pausedAt),
            wait: async () => {
                if (pending) return pending;
                if (failed || !visible() || isStopped()) return;
                pausedAt = now();
                pending = (async () => {
                    try {
                        while (visible() && !isStopped()) {
                            if (now() - pausedAt >= timeoutMs) {
                                failed = true;
                                options.onTimeout?.();
                                break;
                            }
                            await sleep(200);
                        }
                    } finally {
                        pausedMs += now() - pausedAt;
                        pausedAt = undefined;
                    }
                })();
                try { await pending; } finally { pending = undefined; }
            }
        };
    }
    const api = { createCaptchaRuntime, visibleChallenge };
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.HHCaptchaRuntime = api;
})(typeof window === 'object' ? window : globalThis);
