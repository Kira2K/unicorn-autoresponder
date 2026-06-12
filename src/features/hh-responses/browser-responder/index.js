(function () {
  console.log("start");
  
  // Настройки хранилищ и ключи для local/session storage
    const STORAGE_PREFIX = 'hh_ar_v2_';
    const KEYS = {
        settings: STORAGE_PREFIX + 'cfg_data',
        isRunning: STORAGE_PREFIX + 'is_active',
        returnUrl: STORAGE_PREFIX + 'list_url',
        history: STORAGE_PREFIX + 'processed_ids',
        needF5: STORAGE_PREFIX + 'reload_flag',
        trapLock: STORAGE_PREFIX + 'ar_trap_lock',
        instanceLock: STORAGE_PREFIX + 'instance_lock',
        lastAttempt: STORAGE_PREFIX + 'last_attempt_id',
        successfulResponses: STORAGE_PREFIX + 'successful_responses',
        successfulResponseIds: STORAGE_PREFIX + 'successful_response_ids',
        state: STORAGE_PREFIX + 'state',
        logs: STORAGE_PREFIX + 'logs',
        manualList: STORAGE_PREFIX + 'manual_list',
        stopReason: STORAGE_PREFIX + 'stop_reason',
        parserErrors: STORAGE_PREFIX + 'parser_errors',
        recentUrls: STORAGE_PREFIX + 'recent_urls',
        modalRetry: STORAGE_PREFIX + 'modal_retry',
        manualReturnState: STORAGE_PREFIX + 'manual_return_state'
    };

    // Важные селекторы, используемые в скрипте
    const SELECTORS = {
        applyBtn: '[data-qa="vacancy-serp__vacancy_response"], button[data-qa="vacancy-serp__vacancy_response"]',
        topApply: '[data-qa="vacancy-response-link-top"], a[data-qa="vacancy-response-link-top"]',
        top2DTimeApply: '[data-qa="vacancy-response-link-top-again"], button[data-qa="vacancy-response-link-top-again"]',
        modalAddCover: '[data-qa="add-cover-letter"]',
        modalTextarea: 'textarea[data-qa="vacancy-response-popup-form-letter-input"], textarea[name="coverLetter"], textarea[name="text"]',
        modalSubmit: '[data-qa="vacancy-response-submit-popup"], button[data-qa="vacancy-response-letter-submit"], button[data-qa="vacancy-response-submit-popup"]',
        directApplyAdvertising: '[data-wavacancy-response-link-advertising]',
        nativeWrapper: '[data-qa="textarea-native-wrapper"]',
        relocationBtn: '[data-qa="relocation-warning-confirm"]',
        dailyResponseLimitWarning: '[data-qa-popup-error-code="negotiations-limit-exceeded"]',
        vacancyResponseTopic: '[data-qa="vacancy-response-link-view-topic"]',
        vacancyCompanyName: '[data-qa="vacancy-company-name"]',
        vacancyCompanyLink: 'a[data-qa="vacancy-company-name"], [data-qa="vacancy-company-link"]',
        vacancyLink: 'a[data-qa="serp-item__title"], a[data-qa="vacancy-serp__vacancy-title"], a[href*="/vacancy/"]',
        vacancyCard: 'div[data-qa="vacancy-serp__vacancy"], div[data-qa="serp-item"], .vacancy-serp-item',
        login: '[data-qa="login"]',
        signup: '[data-qa="signup"]',
        anonymousProfileLink: '[data-qa="mainmenu_profile-link"][href*="/account/login"]',
        loginFormEmail: '[data-qa="applicant-login-input-email"]',
        loginFormPhone: '[data-qa="account-login-input"]'
    };


    // Параметры по умолчанию
    const DEFAULTS = {
        coverText: 'Добрый день! Заинтересовала ваша вакансия. Опыт релевантен, подробности в резюме. Буду рада обратной связи!',
        useCover: true,
        delayMin: 50,
        delayMax: 100,
        limit: 180,
        skipHidden: true,
        viewMin: 500,
        viewMax: 800,
        scrollStepMs: 100,
        actionDelayMin: 50,
        actionDelayMax: 150,
        waitForModalMs: 7000,
        instanceLockTtl: 25000,
        continueOnNoModal: true,
        blockedCompanies: []
    };
    const MAX_RESUME_ATTEMPTS_PER_VACANCY = 10;
    const MANUAL_RETURN_MAX_ATTEMPTS = 8;
    const STUCK_VACANCY_TIMEOUT_MS = 90 * 1000;
    const STUCK_VACANCY_TIMEOUT_CODE = 'STUCK_ON_VACANCY_TIMEOUT';

    // Безопасные и предсказуемые значения конфигурации
    const toNum = (v, fallback) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : fallback;
    };
    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
    const toSafeHhUrl = (rawUrl) => {
        if (!rawUrl) return '';
        try {
            const u = new URL(String(rawUrl), location.href);
            if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
            if (!/(^|\.)hh\.ru$/i.test(u.hostname)) return '';
            return u.href;
        } catch (e) {
            return '';
        }
    };
    const normalizeConfig = (raw = {}) => {
        const merged = { ...DEFAULTS, ...(raw || {}) };
        const normalized = {
            ...merged,
            coverText: String(merged.coverText ?? DEFAULTS.coverText).slice(0, 5000),
            useCover: merged.useCover === false ? false : true,
            skipHidden: merged.skipHidden === false ? false : true,
            blockedCompanies: Array.isArray(merged.blockedCompanies)
                ? merged.blockedCompanies
                    .filter(company => company && company.id && company.name)
                    .map(company => ({
                        id: String(company.id).trim(),
                        name: String(company.name).trim()
                    }))
                    .filter(company => company.id && company.name)
                    .slice(0, 500)
                : []
        };

        normalized.delayMin = clamp(Math.round(toNum(merged.delayMin, DEFAULTS.delayMin)), 300, 4000);
        normalized.delayMax = clamp(Math.round(toNum(merged.delayMax, DEFAULTS.delayMax)), 300, 8000);
        if (normalized.delayMin > normalized.delayMax) [normalized.delayMin, normalized.delayMax] = [normalized.delayMax, normalized.delayMin];

        normalized.viewMin = clamp(Math.round(toNum(merged.viewMin, DEFAULTS.viewMin)), 1000, 8000);
        normalized.viewMax = clamp(Math.round(toNum(merged.viewMax, DEFAULTS.viewMax)), 1000, 20000);
        if (normalized.viewMin > normalized.viewMax) [normalized.viewMin, normalized.viewMax] = [normalized.viewMax, normalized.viewMin];

        normalized.actionDelayMin = clamp(Math.round(toNum(merged.actionDelayMin, DEFAULTS.actionDelayMin)), 50, 1000);
        normalized.actionDelayMax = clamp(Math.round(toNum(merged.actionDelayMax, DEFAULTS.actionDelayMax)), 50, 2000);
        if (normalized.actionDelayMin > normalized.actionDelayMax) [normalized.actionDelayMin, normalized.actionDelayMax] = [normalized.actionDelayMax, normalized.actionDelayMin];

        normalized.scrollStepMs = clamp(Math.round(toNum(merged.scrollStepMs, DEFAULTS.scrollStepMs)), 80, 1500);
        normalized.waitForModalMs = clamp(Math.round(toNum(merged.waitForModalMs, DEFAULTS.waitForModalMs)), 1000, 3000);
        normalized.instanceLockTtl = clamp(Math.round(toNum(merged.instanceLockTtl, DEFAULTS.instanceLockTtl)), 5000, 140000);
        normalized.limit = clamp(Math.round(toNum(merged.limit, DEFAULTS.limit)), 1, 500);

        return normalized;
    };

    // Небольшой менеджер состояния — работа с local/session storage
    const StateManager = {
        loadConfig: () => {
            try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEYS.settings) || '{}') }; }
            catch { return { ...DEFAULTS }; }
        },
        saveConfig: (s) => localStorage.setItem(KEYS.settings, JSON.stringify(s)),
        getProcessedIDs: () => {
            try { return new Set(JSON.parse(sessionStorage.getItem(KEYS.history) || '[]')); }
            catch { return new Set(); }
        },
        addProcessedID: (id) => {
            const s = StateManager.getProcessedIDs();
            s.add(id);
            sessionStorage.setItem(KEYS.history, JSON.stringify([...s]));
        },
        clearProcessedIDs: () => sessionStorage.removeItem(KEYS.history),
        amIRunning: () => sessionStorage.getItem(KEYS.isRunning) === '1',
        setRunning: (state) => state ? sessionStorage.setItem(KEYS.isRunning, '1') : sessionStorage.removeItem(KEYS.isRunning),
        clearStopReason: () => sessionStorage.removeItem(KEYS.stopReason),
        setStopReason: (reason, details = '', overwrite = false) => {
            try {
                if (!overwrite && sessionStorage.getItem(KEYS.stopReason)) return;
                sessionStorage.setItem(KEYS.stopReason, JSON.stringify({
                    reason: String(reason || 'unknown'),
                    details: String(details || '').slice(0, 500),
                    ts: Date.now(),
                    url: location.href,
                    recentUrls: StateManager.getRecentUrls()
                }));
            } catch (e) {
                sessionStorage.setItem(KEYS.stopReason, String(reason || 'unknown'));
            }
        },
        getStopReason: () => {
            const raw = sessionStorage.getItem(KEYS.stopReason);
            if (!raw) return null;
            try { return JSON.parse(raw); }
            catch { return { reason: raw, details: '', ts: Date.now(), url: location.href }; }
        },
        clearParserErrors: () => sessionStorage.removeItem(KEYS.parserErrors),
        clearRecentUrls: () => sessionStorage.removeItem(KEYS.recentUrls),
        getRecentUrls: () => {
            try {
                const parsed = JSON.parse(sessionStorage.getItem(KEYS.recentUrls) || '[]');
                return Array.isArray(parsed) ? parsed : [];
            } catch { return []; }
        },
        rememberUrl: (url = location.href, reason = 'location') => {
            try {
                const safeUrl = toSafeHhUrl(url) || String(url || '').slice(0, 2000);
                if (!safeUrl) return;

                const urls = StateManager.getRecentUrls();
                const last = urls[urls.length - 1];
                const entry = {
                    url: safeUrl,
                    title: document.title || '',
                    reason: String(reason || 'location').slice(0, 80),
                    ts: Date.now()
                };

                if (last && last.url === entry.url) {
                    urls[urls.length - 1] = { ...last, ...entry };
                } else {
                    urls.push(entry);
                }

                if (urls.length > 2) urls.splice(0, urls.length - 2);
                sessionStorage.setItem(KEYS.recentUrls, JSON.stringify(urls));
            } catch (e) {
                console.warn('save recent url error', e);
            }
        },
        getParserErrors: () => {
            try {
                const parsed = JSON.parse(sessionStorage.getItem(KEYS.parserErrors) || '[]');
                return Array.isArray(parsed) ? parsed : [];
            } catch { return []; }
        },
        addParserError: (code, details = '') => {
            try {
                const errors = StateManager.getParserErrors();
                errors.push({
                    code: String(code || 'UNKNOWN_PARSER_ERROR'),
                    details: String(details || '').slice(0, 500),
                    ts: Date.now(),
                    url: location.href,
                    recentUrls: StateManager.getRecentUrls()
                });
                if (errors.length > 100) errors.splice(0, errors.length - 100);
                sessionStorage.setItem(KEYS.parserErrors, JSON.stringify(errors));
            } catch (e) {
                console.warn('save parser error error', e);
            }
        },
        setReturnUrl: (url) => sessionStorage.setItem(KEYS.returnUrl, url || location.href),
        getReturnUrl: () => sessionStorage.getItem(KEYS.returnUrl),
        setF5Needed: () => sessionStorage.setItem(KEYS.needF5, '1'),
        isF5Needed: () => sessionStorage.getItem(KEYS.needF5) === '1',
        clearF5Flag: () => sessionStorage.removeItem(KEYS.needF5),
        // "Ловушка" — пометка, что мы уже обрабатываем возврат с тестовой страницы
        setTrapLock: () => {
            sessionStorage.setItem(KEYS.trapLock, '1');
            // авто-очистка через 15 сек, если что-то пошло не так
            setTimeout(() => {
                if (sessionStorage.getItem(KEYS.trapLock) === '1') {
                    sessionStorage.removeItem(KEYS.trapLock);
                    log('Очистил ar_trap_lock по таймауту.');
                }
            }, 15000);
        },
        clearTrapLock: () => sessionStorage.removeItem(KEYS.trapLock),
        hasTrapLock: () => sessionStorage.getItem(KEYS.trapLock) === '1',
        clearManualReturnState: () => sessionStorage.removeItem(KEYS.manualReturnState),
        getManualReturnState: () => {
            try {
                const parsed = JSON.parse(sessionStorage.getItem(KEYS.manualReturnState) || '{}');
                return parsed && typeof parsed === 'object' ? parsed : {};
            } catch {
                return {};
            }
        },
        setManualReturnState: (state) => {
            sessionStorage.setItem(KEYS.manualReturnState, JSON.stringify(state || {}));
        },
        // Запоминаем последнюю попытку отклика — пригодится при редиректах
        setLastAttemptID: (id) => {
            if (id) sessionStorage.setItem(KEYS.lastAttempt, id);
        },
        getLastAttemptID: () => sessionStorage.getItem(KEYS.lastAttempt),
        clearLastAttemptID: () => sessionStorage.removeItem(KEYS.lastAttempt),
        getSuccessfulResponses: () => {
            const count = Number(sessionStorage.getItem(KEYS.successfulResponses) || '0');
            return Number.isFinite(count) ? count : 0;
        },
        hasReachedResponseLimit: () => StateManager.getSuccessfulResponses() >= config.limit,
        stopForResponseLimit: (details = '') => {
            StateManager.setStopReason(
                'limit_reached',
                `Достигнут лимит ${config.limit}${details ? `; ${details}` : ''}`
            );
            StateManager.setRunning(false);
            StateManager.releaseInstanceLock(TAB_ID);
            setStatus('done');
            log(`Достигнут общий лимит откликов ${config.limit}. Останавливаю работу.`);
        },
        incrementSuccessfulResponses: () => {
            const nextCount = StateManager.getSuccessfulResponses() + 1;
            sessionStorage.setItem(KEYS.successfulResponses, String(nextCount));
            return nextCount;
        },
        getSuccessfulResponseIDs: () => {
            try { return new Set(JSON.parse(sessionStorage.getItem(KEYS.successfulResponseIds) || '[]')); }
            catch { return new Set(); }
        },
        addSuccessfulResponseID: (id) => {
            const successfulIds = StateManager.getSuccessfulResponseIDs();
            const responseKey = `${id || 'unknown'}:${Date.now()}:${successfulIds.size + 1}`;

            successfulIds.add(responseKey);
            sessionStorage.setItem(KEYS.successfulResponseIds, JSON.stringify([...successfulIds]));
            return StateManager.incrementSuccessfulResponses();
        },
        // Простая кросс-вкладочная блокировка (instance lock)
        acquireInstanceLock: (tabId) => {
            try {
                const now = Date.now();
                const raw = localStorage.getItem(KEYS.instanceLock);
                if (raw) {
                    const obj = JSON.parse(raw);
                    if (now - obj.ts < config.instanceLockTtl && obj.tabId !== tabId) {
                        return false;
                    }
                }
                localStorage.setItem(KEYS.instanceLock, JSON.stringify({ tabId, ts: now }));
                return true;
            } catch (e) { return true; }
        },
        releaseInstanceLock: (tabId) => {
            try {
                const raw = localStorage.getItem(KEYS.instanceLock);
                if (!raw) return;
                const obj = JSON.parse(raw);
                if (obj.tabId === tabId) localStorage.removeItem(KEYS.instanceLock);
            } catch (e) { /* ignore */ }
        },
        // Обновляем timestamp блокировки, чтобы другие вкладки видели, что мы живы
        touchInstanceLock: (tabId) => {
            try {
                const raw = localStorage.getItem(KEYS.instanceLock);
                if (!raw) return;
                const obj = JSON.parse(raw);
                if (obj.tabId === tabId) localStorage.setItem(KEYS.instanceLock, JSON.stringify({ tabId, ts: Date.now() }));
            } catch (e) { /* ignore */ }
        },

        // --- manual list (vacancies that require manual answering) ---
        getManualList: () => {
            try { return JSON.parse(localStorage.getItem(KEYS.manualList) || '[]'); }
            catch { return []; }
        },
        addManualEntry: (entry) => {
            try {
                const safeUrl = toSafeHhUrl(entry?.url);
                if (!safeUrl) return false;
                const safeReturnUrl = toSafeHhUrl(entry?.returnUrl);
                const normalizedEntry = {
                    vid: String(entry?.vid || ('u_' + fnv1a32(safeUrl).toString(36))).slice(0, 120),
                    url: safeUrl,
                    returnUrl: safeReturnUrl || '',
                    ts: Number.isFinite(Number(entry?.ts)) ? Number(entry.ts) : Date.now(),
                    title: String(entry?.title || '').slice(0, 300),
                    reason: String(entry?.reason || '').slice(0, 300)
                };
                const list = StateManager.getManualList();
                const exists = list.find(e => e.vid === normalizedEntry.vid || e.url === normalizedEntry.url);
                if (!exists) {
                    list.unshift(normalizedEntry);
                    // ограничим длину списка, чтобы не раздувался
                    if (list.length > 500) list.length = 500;
                    localStorage.setItem(KEYS.manualList, JSON.stringify(list));
                }
                return true;
            } catch (e) {
                console.warn('addManualEntry error', e);
                return false;
            }
        },
        removeManualEntry: (vid) => {
            try {
                const list = StateManager.getManualList().filter(e => e.vid !== vid);
                localStorage.setItem(KEYS.manualList, JSON.stringify(list));
            } catch (e) { console.warn('removeManualEntry error', e); }
        },
        clearManualList: () => localStorage.removeItem(KEYS.manualList)
    };

    let config = normalizeConfig(StateManager.loadConfig());
    let isLoopActive = false;
    let stopSignal = false;
    let activeVacancyWatch = null;
    const TAB_ID = Math.random().toString(36).slice(2, 9);

    // При авто-возобновлении сразу проверяем lock
    if (StateManager.amIRunning()) {
        const hasInstance = StateManager.acquireInstanceLock(TAB_ID);
        if (!hasInstance) {
            console.warn('[HH-AR] Обнаружен активный процесс в другой вкладке.');
        }
    }

    // Утилиты
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const randomDelay = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
    const actionPause = async () => await wait(randomDelay(config.actionDelayMin, config.actionDelayMax));
    const vacancyPause = async () => await wait(randomDelay(config.delayMin, config.delayMax));

    // Лог в панели + консоль
    const log = (msg, isError = false) => {
        const timestamp = new Date().toLocaleTimeString();
        try {
            const list = JSON.parse(sessionStorage.getItem(KEYS.logs) || '[]');
            list.push({
                ts: Date.now(),
                time: timestamp,
                message: String(msg),
                isError: Boolean(isError),
                url: location.href
            });
            if (list.length > 300) list.splice(0, list.length - 300);
            sessionStorage.setItem(KEYS.logs, JSON.stringify(list));
        } catch (e) {
            console.warn('save log error', e);
        }
        const entry = document.createElement('div');
        entry.textContent = `[${timestamp}] ${msg}`;
        entry.dataset.error = isError ? '1' : '0';
        if (isError) entry.style.color = '#ff4d4f';
        const logBox = document.getElementById('ar-log-box');
        if (logBox) {
            const errorsOnly = document.getElementById('ar-log-errors-only');
            entry.style.display = (errorsOnly && errorsOnly.checked && !isError) ? 'none' : 'block';
            logBox.appendChild(entry);
            logBox.scrollTop = logBox.scrollHeight;
        }
        console.log(`[HH-AR] ${msg}`);
    };

    StateManager.rememberUrl(location.href, 'script-load');

    const statusColors = {
        idle: { bg: '#e5e7eb', fg: '#111827', text: 'Ожидание' },
        running: { bg: '#dcfce7', fg: '#166534', text: 'В работе' },
        stopped: { bg: '#fee2e2', fg: '#991b1b', text: 'Остановлено' },
        error: { bg: '#fef3c7', fg: '#92400e', text: 'Ошибка/внимание' },
        done: { bg: '#e0f2fe', fg: '#075985', text: 'Завершено' }
    };

    function setStatus(statusKey, customText) {
        const st = statusColors[statusKey] || statusColors.idle;
        const el = document.getElementById('ar-status-text');
        if (!el) return;
        el.textContent = customText || st.text;
        el.style.background = st.bg;
        el.style.color = st.fg;
        el.style.border = `1px solid ${st.fg}22`;
        el.style.padding = '2px 8px';
        el.style.borderRadius = '10px';
    }

    // Корректная вставка текста в textarea (учитывает React/Magritte)
    function fillTextarea(el, value) {
        try {
            const descriptor = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
            if (descriptor && descriptor.set) {
                 descriptor.set.call(el, value);
            } else {
                 el.value = value;
            }
            el.dispatchEvent(new Event('input', { bubbles: true }));
            // Обновляем визуальный wrapper, если он есть
            const wrapper = el.closest(SELECTORS.nativeWrapper) || el.parentElement;
            const clone = wrapper?.querySelector('pre');
            if (clone) clone.textContent = value || '\u200B';
        } catch (e) { console.warn('fillTextarea error', e); }
    }

    // Ждём появления элемента — MutationObserver помогает при динамическом DOM
    async function waitForElement(selector, timeout = config.waitForModalMs) {
        const el = document.querySelector(selector);
        if (el) return el;
        return new Promise((resolve) => {
            const observer = new MutationObserver(() => {
                const found = document.querySelector(selector);
                if (found) {
                    observer.disconnect();
                    resolve(found);
                }
            });
            observer.observe(document.documentElement || document, { childList: true, subtree: true });
            setTimeout(() => {
                observer.disconnect();
                resolve(null);
            }, timeout);
        });
    }

    function isElementVisible(element) {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);

        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    }

    function queryVisible(selector) {
        return Array.from(document.querySelectorAll(selector)).find(isElementVisible) || null;
    }

    async function waitForVisibleElement(selector, timeout = config.waitForModalMs) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            const el = queryVisible(selector);
            if (el) return el;
            await wait(200);
        }

        return queryVisible(selector);
    }

    async function waitForElementGone(selector, timeout = 5000) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            if (!queryVisible(selector)) return true;
            await wait(300);
        }

        return !queryVisible(selector);
    }

    async function submitFollowUpResponseModals(maxSteps = 3) {
        let submittedSteps = 0;

        for (let step = 1; step <= maxSteps; step += 1) {
            await wait(700);
            await actionPause();

            if (stopSignal) return submittedSteps;
            if (isManualResponsePage() || isAuthRequiredPage()) return submittedSteps;
            if (document.querySelector(SELECTORS.dailyResponseLimitWarning)) return submittedSteps;
            if (isResumeVisibilityRequiredResponse()) return submittedSteps;

            const followUpSubmit = queryVisible(SELECTORS.modalSubmit);
            const followUpTextarea = queryVisible(SELECTORS.modalTextarea);
            const submitText = (followUpSubmit?.innerText || followUpSubmit?.textContent || '').trim().toLowerCase();
            const isFollowUpSubmit =
                Boolean(followUpTextarea) ||
                submitText.includes('отправить');

            if (!followUpSubmit || !isFollowUpSubmit) {
                return submittedSteps;
            }

            if (config.useCover && followUpTextarea) {
                fillTextarea(followUpTextarea, config.coverText);
                await actionPause();
                if (stopSignal) return submittedSteps;
            }

            log(`Отправляю дополнительный шаг формы отклика: ${step}.`);
            try {
                followUpSubmit.click();
            } catch(e) {
                try {
                    followUpSubmit.dispatchEvent(new MouseEvent('click', {bubbles:true}));
                } catch(_) {}
            }
            submittedSteps += 1;
        }

        return submittedSteps;
    }

    // Человеческий скролл: вниз до 50% страницы, пауза, и возврат вверх
    async function humanScrollToCompanySectionAndReturn(viewTime) {
        try {
            await actionPause();

            const stepMs = Math.max(100, config.scrollStepMs || DEFAULTS.scrollStepMs);
            const docHeight = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
            const winH = window.innerHeight || document.documentElement.clientHeight;
            const maxY = Math.max(0, docHeight - winH);

            const needle = 'подходящие вакансии в этой компании';
            let sectionEl = null;
            const candidates = Array.from(document.querySelectorAll('h1,h2,h3,h4,div,section'));
            for (const el of candidates) {
                try {
                    if (!el.innerText) continue;
                    if (el.innerText.trim().toLowerCase().includes(needle)) {
                        sectionEl = el;
                        break;
                    }
                } catch (e) { continue; }
            }

            let targetY = null;
            if (sectionEl) {
                const rect = sectionEl.getBoundingClientRect();
                targetY = Math.max(0, Math.round(rect.top + window.pageYOffset - 100));
                if (targetY > maxY) targetY = maxY;
                log('Найдена секция "Подходящие вакансии..." — скроллю до неё.');
            } else {
                targetY = Math.round(maxY * 0.5);
                log('Секция не найдена — скроллю до 50% страницы (фоллбек).');
            }

            const totalSteps = Math.max(6, Math.floor((viewTime / stepMs) / 2));
            const startY = window.pageYOffset || 0;

            for (let i = 1; i <= totalSteps; i++) {
                if (stopSignal) return;
                const frac = i / totalSteps;
                const y = Math.round(startY + (targetY - startY) * frac);
                window.scrollTo({ top: y, behavior: 'auto' });
                await wait(stepMs + randomDelay(-Math.floor(stepMs/3), Math.floor(stepMs/3)));
                await actionPause();
            }

            await wait(randomDelay(800, 1200));
            await actionPause();

            const upSteps = Math.max(4, Math.floor(totalSteps / 2));
            for (let i = upSteps; i >= 0; i--) {
                if (stopSignal) return;
                const frac = i / upSteps;
                const y = Math.round(startY + (targetY - startY) * frac);
                window.scrollTo({ top: y, behavior: 'auto' });
                await wait(stepMs + randomDelay(-Math.floor(stepMs/4), Math.floor(stepMs/4)));
                await actionPause();
            }

            window.scrollTo({ top: 0, behavior: 'auto' });
            await wait(200 + randomDelay(0, 400));
            await actionPause();
        } catch (e) {
            console.warn('humanScrollToCompanySectionAndReturn error', e);
        }
    }

    function getCurrentVacancyWatchState() {
        if (!location.pathname.startsWith('/vacancy/')) return null;

        const vid = getStableVacancyId(document);
        const url = toSafeHhUrl(location.href) || location.href;

        return { vid, url };
    }

    function touchVacancyProgress(reason) {
        const current = getCurrentVacancyWatchState();

        if (!current) {
            activeVacancyWatch = null;
            return;
        }

        const now = Date.now();

        if (!activeVacancyWatch || activeVacancyWatch.vid !== current.vid || activeVacancyWatch.url !== current.url) {
            activeVacancyWatch = {
                ...current,
                startedAt: now,
                lastProgressAt: now,
                lastProgressReason: reason || 'vacancy-progress',
                handled: false
            };
            return;
        }

        activeVacancyWatch.lastProgressAt = now;
        activeVacancyWatch.lastProgressReason = reason || 'vacancy-progress';
    }

    function returnToSearchFromStuckVacancy(returnUrl) {
        if (returnUrl && returnUrl.includes('/search/vacancy')) {
            StateManager.rememberUrl(returnUrl, 'return-to-list-stuck-vacancy');
            window.location.href = returnUrl;
            return true;
        }

        StateManager.rememberUrl(location.href, 'history-back-stuck-vacancy');
        try {
            history.back();
            return true;
        } catch (e) {
            try {
                window.location.href = '/search/vacancy';
                return true;
            } catch (fallbackError) {
                console.warn('return to search from stuck vacancy error', fallbackError);
                return false;
            }
        }
    }

    function handleStuckVacancyTimeout() {
        const current = getCurrentVacancyWatchState();
        if (!current) {
            activeVacancyWatch = null;
            return false;
        }

        const now = Date.now();

        if (!activeVacancyWatch || activeVacancyWatch.vid !== current.vid || activeVacancyWatch.url !== current.url) {
            activeVacancyWatch = {
                ...current,
                startedAt: now,
                lastProgressAt: now,
                lastProgressReason: 'watch-vacancy-entered',
                handled: false
            };
            return false;
        }

        if (
            activeVacancyWatch.handled ||
            now - activeVacancyWatch.lastProgressAt < STUCK_VACANCY_TIMEOUT_MS
        ) {
            return false;
        }

        activeVacancyWatch.handled = true;
        const seconds = Math.round((now - activeVacancyWatch.lastProgressAt) / 1000);
        const reason = `stuck_on_vacancy_timeout: same vacancy had no progress for ${seconds}s; last progress ${activeVacancyWatch.lastProgressReason || 'n/a'}`;
        const returnUrl = StateManager.getReturnUrl();

        log(`Вакансия зависла больше ${Math.round(STUCK_VACANCY_TIMEOUT_MS / 1000)} сек. Сохраняю в ручной список и возвращаюсь к поиску. ${reason}`, true);
        let savedManualEntry = false;

        try {
            saveCurrentManualResponse(current.vid, returnUrl, reason);
            savedManualEntry = true;
        } catch (e) {
            console.warn('save stuck vacancy manual entry error', e);
            StateManager.addParserError(
                STUCK_VACANCY_TIMEOUT_CODE,
                `${reason}; manual save failed: ${e?.message || e}`
            );
        }

        const returnAttempted = returnToSearchFromStuckVacancy(returnUrl);
        if (!returnAttempted) {
            StateManager.addParserError(
                STUCK_VACANCY_TIMEOUT_CODE,
                `${reason}; return to search failed`
            );
        }
        if (savedManualEntry && returnAttempted) {
            log('Stuck vacancy was saved as manual fallback without parser failure.');
        }
        setStatus('running', 'Возврат после stuck timeout...');
        return true;
    }

    // Watchdog: если попали на страницу с вопросами — пытаемся безопасно вернуться и помечаем вакансию
    function watchTheURL() {
        setInterval(async () => {
            if (!StateManager.amIRunning()) return;
            StateManager.rememberUrl(location.href, 'watch');

            // Обновляем timestamp instance lock только во время активной работы
            StateManager.touchInstanceLock(TAB_ID);

            // Если оказались на странице вопросов/теста
            if (isManualResponsePage()) {
                activeVacancyWatch = null;
                try {
                    const responsePageResult = await handleNoSubmitResponsePage(
                        getManualResponseVacancyId(),
                        'Watchdog found a response page without an automated submit path. Saving for manual processing.'
                    );
                    if (!responsePageResult) {
                        handleManualResponsePage('Попали на вопросы/тест. Инициирую возврат.');
                    }
                } catch (e) {
                    const message = e?.message || String(e);
                    log(`Ошибка watchdog на странице ручного отклика: ${message}`, true);
                    StateManager.addParserError('MANUAL_RETURN_WATCHDOG_ERROR', message);
                }
            }
            else if (location.pathname.startsWith('/vacancy/')) {
                handleStuckVacancyTimeout();
            }
            // Если вернулись на список вакансий — снимаем ловушку и при необходимости обновляем страницу
            else if (document.querySelector(SELECTORS.applyBtn) || location.href.includes('/search/vacancy')) {
                 activeVacancyWatch = null;
                 StateManager.clearTrapLock();
                 StateManager.clearManualReturnState();

                 if (StateManager.isF5Needed()) {
                     log('Возврат выполнен. Перезагружаю страницу, чтобы обновить список вакансий...');
                     StateManager.clearF5Flag();
                     StateManager.rememberUrl(location.href, 'reload-list');
                     window.location.reload();
                 }
            }
        }, 1000);
    }

    // Попытки извлечь ID вакансии из URL в разных форматах
    function getVacancyIDFromHref(href) {
        if (!href) return null;
        const m1 = href.match(/\/vacancy\/(\d+)/);
        if (m1) return String(m1[1]);
        const m2 = href.match(/[?&]vacancyId=(\d+)/);
        if (m2) return String(m2[1]);
        const m3 = href.match(/vacancyId%3D(\d+)/);
        if (m3) return String(m3[1]);
        return null;
    }

    function getVacancyCard(node) {
        if (!node || !node.closest) return null;
        return node.closest(SELECTORS.vacancyCard)
            || node.closest('article')
            || node.closest('li');
    }

    function createVacancyLinkFallback(vid) {
        const href = `https://hh.ru/vacancy/${vid}`;
        return {
            href,
            getAttribute: (name) => name === 'href' ? href : null,
            scrollIntoView: () => {}
        };
    }

    function findVacancyLinkNear(node) {
        if (!node) return null;

        const directHref = node.href || (node.getAttribute && node.getAttribute('href')) || '';
        if (getVacancyIDFromHref(directHref) && /\/vacancy\//.test(directHref)) {
            return node;
        }

        let current = node;
        for (let depth = 0; current && current !== document.body && depth < 10; depth++) {
            if (current.querySelector) {
                const link = current.querySelector(SELECTORS.vacancyLink);
                const href = link?.href || (link?.getAttribute && link.getAttribute('href')) || '';
                if (getVacancyIDFromHref(href)) {
                    return link;
                }
            }
            current = current.parentElement;
        }

        const vid = getVacancyIDFromHref(directHref);
        return vid ? createVacancyLinkFallback(vid) : null;
    }

    // Простой стабильный хеш (FNV-1a 32) — запасной вариант
    function fnv1a32(str) {
        let h = 0x811c9dc5;
        for (let i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i);
            h = Math.imul(h, 0x01000193);
            h >>>= 0;
        }
        return h >>> 0;
    }

    // Получение уникального ID вакансии для отслеживания — сначала по ссылке, затем по хешу
    function getVacancyID(node) {
        try {
            const card = getVacancyCard(node);
            const link = findVacancyLinkNear(node);
            const href = (link && link.href) || node.href || (node.getAttribute && node.getAttribute('href')) || '';
            const id = getVacancyIDFromHref(href);
            if (id) return 'v_' + id;
            let text = '';
            if (card && card.innerText) text = card.innerText.slice(0, 300);
            if (!text && href) text = href;
            if (!text) text = (document.title || '') + '|' + (card ? card.dataset?.id || '' : '');
            const h = fnv1a32(text);
            return 'h_' + h.toString(36);
        } catch (e) {
            return 'h_' + (Date.now()).toString(36);
        }
    }

    // Единый способ получить стабильный ID вакансии на странице
    function getStableVacancyId(btn) {
        const direct = getVacancyIDFromHref(location.href);
        if (direct) return 'v_' + direct;
        const last = StateManager.getLastAttemptID();
        if (last) return last;
        return getVacancyID(btn || document);
    }

    function isManualResponsePage() {
        return location.href.includes('/applicant/vacancy_response');
    }

    function detectManualResponsePageKind() {
        if (!isManualResponsePage()) return '';

        const text = getNormalizedPageText();
        const formSelectors = [
            'form[action*="/applicant/vacancy_response"]',
            'form[id^="cover-letter-"]',
            'textarea',
            'input[type="radio"]',
            'input[type="checkbox"]',
            '[data-qa*="vacancy-response"]',
            '[data-qa*="question"]'
        ];
        const hasQuestionForm = formSelectors.some(selector => Boolean(queryVisible(selector) || document.querySelector(selector)));
        const manualTexts = [
            'ответьте на вопрос',
            'ответьте на вопросы',
            'вопросы работодателя',
            'тестовое задание',
            'сопроводительное письмо',
            'выберите резюме',
            'каким резюме откликнуться',
            'откликнуться на вакансию'
        ];

        if (isAlreadyRespondedPage() && !hasAdditionalResumeApplyButton()) return 'already_responded';
        if (isResumeVisibilityRequiredResponse()) return 'resume_visibility';
        if (isDirectApplyAdvertisingModal()) return 'direct_apply_advertising';
        if (document.querySelector(SELECTORS.dailyResponseLimitWarning)) return 'daily_limit';
        if (isAuthRequiredPage()) return 'auth_required';
        if (hasQuestionForm || manualTexts.some(item => text.includes(item))) return 'manual_response';

        return 'unknown_response_page';
    }

    function getNoModalDiagnostics(vid, pageKind) {
        const checks = {
            submit: Boolean(queryVisible(SELECTORS.modalSubmit) || document.querySelector(SELECTORS.modalSubmit)),
            textarea: Boolean(queryVisible(SELECTORS.modalTextarea) || document.querySelector(SELECTORS.modalTextarea)),
            questionForm: Boolean(
                document.querySelector('form[action*="/applicant/vacancy_response"]') ||
                document.querySelector('form[id^="cover-letter-"]') ||
                document.querySelector('[data-qa*="question"]') ||
                document.querySelector('input[type="radio"]') ||
                document.querySelector('input[type="checkbox"]')
            ),
            alreadyResponded: isAlreadyRespondedPage(),
            additionalResumeApply: hasAdditionalResumeApplyButton(),
            resumeVisibility: isResumeVisibilityRequiredResponse(),
            dailyLimit: Boolean(document.querySelector(SELECTORS.dailyResponseLimitWarning)),
            authRequired: isAuthRequiredPage(),
            manualResponsePage: isManualResponsePage()
        };

        return [
            `vid=${vid || getManualResponseVacancyId() || 'unknown'}`,
            `kind=${pageKind || detectManualResponsePageKind() || 'n/a'}`,
            `url=${location.href}`,
            `title=${document.title || ''}`,
            `checks=${JSON.stringify(checks)}`
        ].join('; ');
    }

    function isDirectApplyAdvertisingModal() {
        return Boolean(queryVisible(SELECTORS.directApplyAdvertising));
    }

    function isVacancySearchPage() {
        return location.pathname.startsWith('/search/vacancy') || location.href.includes('/search/vacancy');
    }

    function isAuthRequiredPage() {
        const url = location.href;
        const path = location.pathname;
        const text = getNormalizedPageText();

        return (
            path.startsWith('/account/login') ||
            /\/account\/login/i.test(url) ||
            document.querySelector(SELECTORS.login) ||
            document.querySelector(SELECTORS.signup) ||
            document.querySelector(SELECTORS.anonymousProfileLink) ||
            document.querySelector(SELECTORS.loginFormEmail) ||
            document.querySelector(SELECTORS.loginFormPhone) ||
            (
                text.includes('войдите') &&
                (text.includes('отклик') || text.includes('резюм'))
            )
        );
    }

    function markAuthRequired(reason) {
        const details = reason || 'HH requested login while processing vacancy';

        log(details, true);
        StateManager.addParserError('AUTH_REQUIRED', details);
        StateManager.setStopReason('auth_required', details, true);
        StateManager.setRunning(false);
        StateManager.releaseInstanceLock(TAB_ID);
        setStatus('error', 'Требуется вход');
    }

    function getNormalizedPageText() {
        return (document.body?.innerText || '')
            .toLowerCase()
            .replace(/\u00a0/g, ' ')
            .replace(/ё/g, 'е')
            .replace(/[«»"']/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function cleanCompanyNameText(text) {
        return String(text || '')
            .replace(/\u00a0/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function getVacancyCompanyName() {
        const selectors = [
            SELECTORS.vacancyCompanyName,
            SELECTORS.vacancyCompanyLink,
            '[data-qa="vacancy-company-name"] span',
            '.vacancy-company-name',
            '.vacancy-company-redesigned'
        ];

        for (const selector of selectors) {
            const elements = Array.from(document.querySelectorAll(selector));

            for (const element of elements) {
                const text = cleanCompanyNameText(element.innerText || element.textContent || '');

                if (text) {
                    return text;
                }
            }
        }

        return '';
    }

    function findBlockedCompanyMatch(companyName) {
        const matcher = window.HHCompanyStopList;

        if (!matcher || typeof matcher.findBlockedCompanyMatch !== 'function') {
            return undefined;
        }

        return matcher.findBlockedCompanyMatch(companyName, config.blockedCompanies);
    }

    async function skipBlockedCompanyVacancy(vid, companyName, match) {
        const blockedCompany = match?.blockedCompany || {};
        const details = `Компания "${companyName}" совпала со stop-list: ${blockedCompany.name || 'n/a'} (${blockedCompany.id || 'n/a'}), reason ${match?.reason || 'n/a'}`;

        log(`Пропускаю вакансию: ${details}`);
        markVacancyProcessedAndReturn(
            vid,
            StateManager.getReturnUrl(),
            `Компания в stop-list. ${details}`
        );
        await wait(800);
        return 'COMPANY_STOP_LIST_SKIPPED';
    }

    function isAlreadyRespondedPage() {
        if (document.querySelector(SELECTORS.vacancyResponseTopic)) return true;

        const pageText = getNormalizedPageText();
        const successTexts = [
            'резюме доставлено',
            'отклик отправлен',
            'отклик был отправлен',
            'вы откликнулись',
            'сопроводительное письмо отправлено'
        ];

        return successTexts.some(text => pageText.includes(text));
    }

    function hasAdditionalResumeApplyButton() {
        return Boolean(queryVisible(SELECTORS.top2DTimeApply));
    }

    function isResumeVisibilityRequiredResponse() {
        const text = getNormalizedPageText();

        return (
            text.includes('видимост') &&
            text.includes('резюм') &&
            (
                text.includes('headhunter') ||
                text.includes('компаниям') ||
                text.includes('клиентам') ||
                text.includes('откликнуться')
            )
        );
    }

    function markVacancyProcessedAndReturn(vid, returnUrl, reason) {
        if (vid) {
            StateManager.addProcessedID(vid);
        }

        StateManager.clearLastAttemptID();
        log(reason);

        const backUrl = returnUrl || StateManager.getReturnUrl();
        if (backUrl && backUrl.includes('/search/vacancy')) {
            StateManager.rememberUrl(backUrl, 'return-to-list-processed-skip');
            window.location.href = backUrl;
        } else {
            StateManager.rememberUrl(location.href, 'history-back-processed-skip');
            try { history.back(); } catch (e) { window.location.href = '/search/vacancy'; }
        }
    }

    function saveCurrentManualResponse(vid, returnUrl, reason) {
        const manualUrl = toSafeHhUrl(location.href) || location.href;
        const safeReturnUrl = toSafeHhUrl(returnUrl || StateManager.getReturnUrl()) || '';
        const entry = {
            vid: vid || ('u_' + fnv1a32(manualUrl).toString(36)),
            url: manualUrl,
            returnUrl: safeReturnUrl,
            ts: Date.now(),
            title: document.title || '',
            reason: reason || ''
        };

        const saved = StateManager.addManualEntry(entry);
        const existsInManualList = StateManager
            .getManualList()
            .some(item => item.vid === entry.vid || item.url === entry.url);

        if (!saved || !existsInManualList) {
            throw new Error(`manual entry was not saved: ${entry.vid}`);
        }

        if (entry.vid) {
            StateManager.addProcessedID(entry.vid);
            StateManager.clearLastAttemptID();
        }

        StateManager.setF5Needed();
        log(`Сохранена вакансия для ручного отклика: ${entry.vid}`);

        return entry;
    }

    async function saveDirectApplyAdvertisingToManual(vid, returnUrl) {
        const backUrl = returnUrl || StateManager.getReturnUrl();
        log('direct-apply advertising modal saved to manual', true);

        try {
            saveCurrentManualResponse(vid, backUrl, 'direct-apply advertising modal');
        } catch (e) {
            console.warn('save direct-apply advertising manual entry error', e);
        }

        if (backUrl && backUrl.includes('/search/vacancy')) {
            StateManager.rememberUrl(backUrl, 'return-to-list-direct-apply-advertising');
            window.location.href = backUrl;
        } else {
            StateManager.rememberUrl(location.href, 'history-back-direct-apply-advertising');
            try { history.back(); } catch (e) { window.location.href = '/search/vacancy'; }
        }

        await wait(800);
        return 'REDIRECT';
    }

    function getManualResponseVacancyId() {
        try {
            if (document.referrer) {
                const referrerId = getVacancyIDFromHref(document.referrer);
                if (referrerId) return 'v_' + referrerId;
            }
        } catch (e) { /* ignore */ }

        const last = StateManager.getLastAttemptID();
        if (last) return last;

        const currentId = getVacancyIDFromHref(location.href);
        if (currentId) return 'v_' + currentId;

        return null;
    }

    function returnToSearchFromManualPage(backUrl, source) {
        if (backUrl && backUrl.includes('/search/vacancy')) {
            StateManager.rememberUrl(backUrl, source || 'return-to-list-from-manual');
            window.location.href = backUrl;
            return;
        }

        try {
            StateManager.rememberUrl(location.href, 'history-go--2-from-manual');
            history.go(-2);
        } catch (e) {
            StateManager.rememberUrl(location.href, 'history-back-from-manual');
            history.back();
        }
    }

    function handleManualResponsePage(reason, forceSaveBroken) {
        if (!isManualResponsePage()) return false;
        if (StateManager.hasTrapLock()) {
            const lockedBackUrl = StateManager.getReturnUrl();
            log('Страница ручного отклика уже обрабатывается. Повторяю возврат к списку.', true);
            returnToSearchFromManualPage(lockedBackUrl, 'return-to-list-manual-trap-repeat');
            return true;
        }

        StateManager.setTrapLock();
        log(reason || 'Попали на вопросы/тест. Сохраняю вакансию для ручного отклика.', true);

        const vid = getManualResponseVacancyId();
        const backUrl = StateManager.getReturnUrl();

        try { saveCurrentManualResponse(vid, backUrl, reason || 'manual response page'); }
        catch (e) { console.warn('save manual entry error', e); }

        if (vid) {
            log(`Пометил вакансию ${vid} как обработанную (чтобы избежать зацикливания).`);
        } else {
            log('Не удалось определить ID вакансии на странице с вопросами.', true);
        }

        returnToSearchFromManualPage(backUrl, 'return-to-list-manual-response');

        setTimeout(() => {
            if (isManualResponsePage()) {
                if (backUrl) {
                    log('Двухшаговый возврат не сработал. Перехожу по сохранённому URL.', true);
                    StateManager.rememberUrl(backUrl, 'fallback-return-url');
                    window.location.href = backUrl;
                } else {
                    log('Двухшаговый возврат не сработал и returnUrl недоступен. Делаю history.back().', true);
                    StateManager.rememberUrl(location.href, 'fallback-history-back');
                    history.back();
                }
            }
        }, 1200);

        return true;
    }

    async function handleNoSubmitResponsePage(vid, reason) {
        if (!isManualResponsePage()) return '';

        const pageKind = detectManualResponsePageKind();

        if (pageKind === 'direct_apply_advertising') {
            return await saveDirectApplyAdvertisingToManual(vid, StateManager.getReturnUrl());
        }
        if (pageKind === 'auth_required') {
            markAuthRequired('HH запросил вход вместо формы отклика.');
            return 'AUTH_REQUIRED';
        }
        if (pageKind === 'daily_limit') {
            log('HH показал дневной лимит откликов. Завершаю работу штатно.');
            return 'DAILY_RESPONSE_LIMIT';
        }
        if (pageKind === 'already_responded') {
            markVacancyProcessedAndReturn(
                vid,
                StateManager.getReturnUrl(),
                'Страница отклика уже подтверждает существующий отклик. Помечаю обработанной и иду дальше.'
            );
            await wait(800);
            return 'OK';
        }
        if (pageKind === 'resume_visibility') {
            markVacancyProcessedAndReturn(
                vid,
                StateManager.getReturnUrl(),
                'HH не разрешил отклик из-за видимости резюме. Помечаю вакансию обработанной и иду дальше.'
            );
            await wait(800);
            return 'SKIPPED_RESUME_VISIBILITY';
        }
        if (pageKind === 'manual_response' || pageKind === 'unknown_response_page') {
            return await saveNoSubmitVacancyToManual(
                vid,
                reason || 'Response page has no expected submit button.',
                pageKind
            );
        }

        return '';
    }

    // Открываем вакансию с списка: запоминаем lastAttempt и переходим по ссылке
    async function saveNoSubmitVacancyToManual(vid, reason, pageKind) {
        const backUrl = StateManager.getReturnUrl();
        const details = getNoModalDiagnostics(vid, pageKind || detectManualResponsePageKind() || 'no_submit_fallback');
        const manualReason = `${reason || 'No submit modal after response click.'} ${details}`;
        const returnAttempt = registerManualReturnAttempt(vid);

        log(`No submit modal after response click. Saving vacancy to manual list. ${details}`, true);

        try {
            saveCurrentManualResponse(vid || getManualResponseVacancyId(), backUrl, manualReason);
        } catch (e) {
            console.warn('save no-submit manual fallback entry error', e);
            StateManager.addParserError('ERROR_NO_MODAL', details);
            return 'ERROR_NO_MODAL';
        }

        if (returnAttempt.count > MANUAL_RETURN_MAX_ATTEMPTS) {
            return stopManualResponseReturnLoop(
                vid || getManualResponseVacancyId(),
                returnAttempt.count,
                details
            );
        }

        returnToSearchFromManualPage(backUrl, 'return-to-list-no-submit-manual-fallback');
        await wait(800);
        return 'REDIRECT';
    }

    function getManualReturnKey(vid) {
        return [
            vid || getManualResponseVacancyId() || 'unknown',
            toSafeHhUrl(location.href) || location.href
        ].join('|');
    }

    function registerManualReturnAttempt(vid) {
        const key = getManualReturnKey(vid);
        const previous = StateManager.getManualReturnState();
        const count = previous.key === key ? Number(previous.count || 0) + 1 : 1;
        const state = {
            key,
            count,
            firstAt: previous.key === key ? previous.firstAt : Date.now(),
            lastAt: Date.now()
        };

        StateManager.setManualReturnState(state);
        return state;
    }

    function stopManualResponseReturnLoop(vid, attempts, details) {
        const manualCount = StateManager.getManualList().length;
        const reason = [
            `Manual response page stayed open after ${attempts} return attempts.`,
            `Saved vacancy ${vid || getManualResponseVacancyId() || 'unknown'} for manual response.`,
            `Manual list count: ${manualCount}.`,
            details || ''
        ].filter(Boolean).join(' ');

        log(`Stopping cleanly after repeated manual response return loop. ${reason}`, true);
        StateManager.setStopReason('manual_targets_only', reason, true);
        StateManager.setRunning(false);
        StateManager.releaseInstanceLock(TAB_ID);
        StateManager.clearTrapLock();
        StateManager.clearManualReturnState();
        setStatus('done', 'Manual response saved; return loop stopped');

        return 'MANUAL_RETURN_STOPPED';
    }

    async function processVacancyOnListing(vacancyLinkEl, applyBtnOnList) {
        const hrefRaw = vacancyLinkEl?.href || vacancyLinkEl.getAttribute('href');
        const href = toSafeHhUrl(hrefRaw);
        const vid = getVacancyID(vacancyLinkEl || applyBtnOnList);

        await actionPause();
        StateManager.setReturnUrl();

        try {
            vacancyLinkEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
        } catch (e) { /* ignore */ }
        await actionPause();

        if (href) {
            log(`Открываю страницу вакансии ${vid} для чтения...`);
            await actionPause();
            StateManager.setLastAttemptID(vid); // запомним, на какую вакансию кликаем
            StateManager.rememberUrl(href, 'open-vacancy');
            window.location.href = href;
            return 'NAVIGATED';
        } else {
            log('Не удалось получить href вакансии — пропускаю.', true);
            return 'ERROR_NO_HREF';
        }
    }

    // Обработка вакансии: работает и на странице вакансии, и для кнопки на листинге
    async function processVacancy(btn, isSecond = false, resumeAttempt = 1) {
        log("начало")
        if (stopSignal) return 'STOPPED';
        if (isAuthRequiredPage()) {
            markAuthRequired('HH показал форму входа перед обработкой вакансии.');
            return 'AUTH_REQUIRED';
        }

        if (location.pathname.startsWith('/vacancy/')) {
            const vid = getStableVacancyId(btn);
            touchVacancyProgress('process-vacancy-start');
            StateManager.setReturnUrl(document.referrer || '/search/vacancy');

            if (resumeAttempt > MAX_RESUME_ATTEMPTS_PER_VACANCY) {
                markVacancyProcessedAndReturn(
                    vid,
                    StateManager.getReturnUrl(),
                    `Достигнут лимит ${MAX_RESUME_ATTEMPTS_PER_VACANCY} откликов разными резюме на одну вакансию. Помечаю обработанной.`
                );
                await wait(800);
                return 'OK';
            }

            if (isAlreadyRespondedPage() && !hasAdditionalResumeApplyButton()) {
                markVacancyProcessedAndReturn(
                    vid,
                    StateManager.getReturnUrl(),
                    'Вакансия уже имеет отклик и кнопки отклика другим резюме нет. Помечаю обработанной и иду дальше.'
                );
                await wait(800);
                return 'OK';
            }

            if (isAlreadyRespondedPage() && hasAdditionalResumeApplyButton()) {
                log('Вакансия уже имеет отклик, но доступна кнопка "Отклик другим резюме". Продолжаю по следующему резюме.');
            }

            const viewTime = randomDelay(config.viewMin, config.viewMax);
            log(`Читаю ~${Math.round(viewTime/1000)} сек (имитирую просмотр страницы).`);
            touchVacancyProgress('reading-vacancy');
            await humanScrollToCompanySectionAndReturn(viewTime);
            touchVacancyProgress('finished-reading-vacancy');

            //await actionPause();
            if (stopSignal) return 'STOPPED';

            const companyName = getVacancyCompanyName();
            touchVacancyProgress('company-check');
            if (companyName) {
                const blockedCompanyMatch = findBlockedCompanyMatch(companyName);

                if (blockedCompanyMatch) {
                    return await skipBlockedCompanyVacancy(vid, companyName, blockedCompanyMatch);
                }
            } else if (config.blockedCompanies.length) {
                log('Не удалось определить компанию вакансии для проверки stop-list. Продолжаю без блокировки.', true);
            }

            let applyBtn = queryVisible(SELECTORS.topApply) || await waitForVisibleElement(SELECTORS.applyBtn, config.waitForModalMs);
            let apply2DTime = queryVisible(SELECTORS.top2DTimeApply) || await waitForVisibleElement(SELECTORS.top2DTimeApply, config.waitForModalMs);
            touchVacancyProgress('apply-button-check');
            log(apply2DTime);
            console.log(apply2DTime);
            //alert(apply2DTime.toString())

            if ((!applyBtn && !apply2DTime) || (isSecond && !apply2DTime)) {
                // Если нас уже редиректнуло на страницу с вопросами — помечаем вакансию и уходим
                if (isManualResponsePage()) {
                    handleManualResponsePage('Открылась страница вопросов вместо вакансии. Сохраняю для ручного отклика.');
                    return 'REDIRECT';
                }
                // Если кнопки нет — помечаем вакансию обработанной и возвращаемся к списку
                StateManager.addProcessedID(vid);
                StateManager.clearLastAttemptID();
               // StateManager.setF5Needed();
                log('Кнопка "Откликнуться" не найдена — помечаю вакансию как обработанную и возвращаюсь.', true);

                const backUrl = StateManager.getReturnUrl();
                if (backUrl && backUrl.includes('/search/vacancy')) {
                    try {
                        StateManager.rememberUrl(backUrl, 'return-to-list-no-apply');
                        window.location.href = backUrl;
                    } catch (e) {
                        StateManager.rememberUrl(location.href, 'history-back-no-apply');
                        try { history.back(); } catch (err) { /* ignore */ }
                    }
                } else {
                    StateManager.rememberUrl(location.href, 'history-back-no-apply');
                    try { history.back(); } catch (e) { /* ignore */ }
                }
                if(isSecond && !apply2DTime) return 'OK'
                return 'NO_APPLY_RETURNED';
            }

            // Пометим, что сейчас пытаемся откликнуться на эту вакансию
            StateManager.setLastAttemptID(vid);
            touchVacancyProgress('apply-attempt-start');

            window.scrollTo({ top: 0, behavior: 'auto' });
            await actionPause();
            if (stopSignal) return 'STOPPED';

            const topBtn = queryVisible(SELECTORS.topApply) || queryVisible(SELECTORS.top2DTimeApply);
            if (topBtn) {
                topBtn.scrollIntoView({ block: 'center', behavior: 'auto' });
                await actionPause();
                if (stopSignal) return 'STOPPED';
                touchVacancyProgress('click-apply-button');
                topBtn.click();
            } else {
                applyBtn.scrollIntoView({ block: 'center', behavior: 'auto' });
                await actionPause();
                if (stopSignal) return 'STOPPED';
                touchVacancyProgress('click-apply-button');
                applyBtn.click();
            }

            await actionPause();
            touchVacancyProgress('after-apply-click');
            if (stopSignal) return 'STOPPED';
            if (isAuthRequiredPage()) {
                markAuthRequired('HH запросил вход после клика по кнопке отклика.');
                return 'AUTH_REQUIRED';
            }
            if (document.querySelector(SELECTORS.dailyResponseLimitWarning)) {
                log('HH показал дневной лимит откликов. Завершаю работу штатно.');
                return 'DAILY_RESPONSE_LIMIT';
            }
            if (isDirectApplyAdvertisingModal()) {
                return await saveDirectApplyAdvertisingToManual(vid, StateManager.getReturnUrl());
            }
            if (isResumeVisibilityRequiredResponse()) {
                markVacancyProcessedAndReturn(
                    vid,
                    StateManager.getReturnUrl(),
                    'HH не разрешил отклик из-за видимости резюме. Помечаю вакансию обработанной и иду дальше.'
                );
                await wait(800);
                return 'SKIPPED_RESUME_VISIBILITY';
            }

            let submitButton = await waitForElement(SELECTORS.modalSubmit, config.waitForModalMs);
            touchVacancyProgress('submit-button-check');
            if (!submitButton) {
                const relocationBtn = document.querySelector(SELECTORS.relocationBtn);
                if (relocationBtn) {
                    await actionPause();
                    if (stopSignal) return 'STOPPED';
                    relocationBtn.click();
                    await actionPause();
                    if (stopSignal) return 'STOPPED';
                    if (isResumeVisibilityRequiredResponse()) {
                        markVacancyProcessedAndReturn(
                            vid,
                            StateManager.getReturnUrl(),
                            'HH не разрешил отклик из-за видимости резюме. Помечаю вакансию обработанной и иду дальше.'
                        );
                        await wait(800);
                        return 'SKIPPED_RESUME_VISIBILITY';
                    }
                    if (isDirectApplyAdvertisingModal()) {
                        return await saveDirectApplyAdvertisingToManual(vid, StateManager.getReturnUrl());
                    }
                    submitButton = await waitForElement(SELECTORS.modalSubmit, config.waitForModalMs);
                }
            }

            if (!submitButton) {
                if (isDirectApplyAdvertisingModal()) {
                    return await saveDirectApplyAdvertisingToManual(vid, StateManager.getReturnUrl());
                }
                if (isAuthRequiredPage()) {
                    markAuthRequired('HH запросил вход вместо формы отклика.');
                    return 'AUTH_REQUIRED';
                }
                if (document.querySelector(SELECTORS.dailyResponseLimitWarning)) {
                    log('HH показал дневной лимит откликов. Завершаю работу штатно.');
                    return 'DAILY_RESPONSE_LIMIT';
                }
                if (isAlreadyRespondedPage() && !hasAdditionalResumeApplyButton()) {
                    markVacancyProcessedAndReturn(
                        vid,
                        StateManager.getReturnUrl(),
                        'Вакансия уже имеет отклик и кнопки отклика другим резюме нет. Помечаю обработанной и иду дальше.'
                    );
                    await wait(800);
                    return 'OK';
                }
                if (isResumeVisibilityRequiredResponse()) {
                    markVacancyProcessedAndReturn(
                        vid,
                        StateManager.getReturnUrl(),
                        'HH не разрешил отклик из-за видимости резюме. Помечаю вакансию обработанной и иду дальше.'
                    );
                    await wait(800);
                    return 'SKIPPED_RESUME_VISIBILITY';
                }
                if (isManualResponsePage()) {
                    const classifiedResult = await handleNoSubmitResponsePage(
                        vid,
                        'После клика открылась страница отклика без ожидаемой кнопки. Сохраняю для ручной обработки.'
                    );
                    if (classifiedResult) return classifiedResult;
                }

                const modalRetryId = sessionStorage.getItem(KEYS.modalRetry);
                if (modalRetryId !== vid) {
                    sessionStorage.setItem(KEYS.modalRetry, vid);
                    StateManager.rememberUrl(location.href, 'retry-no-modal');
                    window.location.reload();
                    return 'RETRYING_NO_MODAL';
                }
                sessionStorage.removeItem(KEYS.modalRetry);
                if (isManualResponsePage()) {
                    const classifiedResult = await handleNoSubmitResponsePage(
                        vid,
                        'External response page has no expected submit button after retry.'
                    );
                    if (classifiedResult) return classifiedResult;
                }
                if (location.pathname.startsWith('/vacancy/')) {
                    return await saveNoSubmitVacancyToManual(
                        vid,
                        'Vacancy page has no response modal after retry.',
                        'not_response_page_after_retry'
                    );
                }
                StateManager.addParserError('ERROR_NO_MODAL', getNoModalDiagnostics(vid, 'not_response_page_after_retry'));
                return 'ERROR_NO_MODAL';
            }

            if (config.useCover) {
                await actionPause();
                if (stopSignal) return 'STOPPED';
                const addCoverBtn = document.querySelector(SELECTORS.modalAddCover);
                if (addCoverBtn) {
                    addCoverBtn.click();
                    await actionPause();
                    if (stopSignal) return 'STOPPED';
                    const area = await waitForElement(SELECTORS.modalTextarea, 2000);
                    if (area) {
                        fillTextarea(area, config.coverText);
                        await actionPause();
                        if (stopSignal) return 'STOPPED';
                    }
                } else {
                    const area = document.querySelector(SELECTORS.modalTextarea);
                    if (area) {
                        fillTextarea(area, config.coverText);
                        await actionPause();
                        if (stopSignal) return 'STOPPED';
                    }
                }
                await wait(randomDelay(300, 800));
            }

            submitButton = submitButton || await waitForElement(SELECTORS.modalSubmit, 2000);

            // Дополнительные фоллбеки для новой верстки
            if (!submitButton) {
                submitButton = document.querySelector('button[data-qa="vacancy-response-letter-submit"], button[data-qa="vacancy-response-submit-popup"]');
            }
            if (!submitButton) {
                // пробуем найти саму форму и её submit внутри или вызвать form.submit()
                const form = document.querySelector('form[action="/applicant/vacancy_response/edit_ajax"], form[id^="cover-letter-"]');
                if (form) {
                    const btn = form.querySelector('button[type="submit"], input[type="submit"]');
                    if (btn) submitButton = btn;
                    else {
                        try { form.submit(); log('Отправил форму через form.submit() (fallback).'); }
                        catch (e) { console.warn('form.submit fallback failed', e); }
                    }
                }
            }

            // --- START: более надёжный возврат после отправки ---
            const returnUrl = StateManager.getReturnUrl() || '/search/vacancy';
            const wasAlreadyRespondedBeforeSubmit = isAlreadyRespondedPage();
            await actionPause();
            if (stopSignal) return 'STOPPED';
            touchVacancyProgress('click-submit-button');
            try { submitButton.click(); } catch(e) { try { submitButton.dispatchEvent(new MouseEvent('click', {bubbles:true})); } catch(_){} }
            await actionPause();
            const followUpSubmitSteps = await submitFollowUpResponseModals();
            touchVacancyProgress('after-submit-click');
            if (followUpSubmitSteps) {
                log(`Дополнительных шагов формы отклика отправлено: ${followUpSubmitSteps}.`);
            }
            if (document.querySelector(SELECTORS.dailyResponseLimitWarning)) {
                log('HH показал дневной лимит откликов. Завершаю работу штатно.');
                return 'DAILY_RESPONSE_LIMIT';
            }
            if (isAuthRequiredPage()) {
                markAuthRequired('HH запросил вход после отправки формы отклика.');
                return 'AUTH_REQUIRED';
            }
            if (isResumeVisibilityRequiredResponse()) {
                markVacancyProcessedAndReturn(
                    vid,
                    returnUrl,
                    'HH не разрешил отклик из-за видимости резюме. Помечаю вакансию обработанной и иду дальше.'
                );
                await wait(800);
                return 'SKIPPED_RESUME_VISIBILITY';
            }

            // Подождать подтверждение отправки — ищем кнопку "Чат" или текст "Резюме доставлено"
            async function waitForSubmitConfirmation(timeout = 5000) {
                const start = Date.now();
                while (Date.now() - start < timeout) {
                    if (stopSignal) return false;
                    if (isAuthRequiredPage()) return 'AUTH_REQUIRED';
                    if (isManualResponsePage()) return 'MANUAL_RESPONSE_REQUIRED';
                    if (isVacancySearchPage()) return true;
                    if (wasAlreadyRespondedBeforeSubmit) {
                        if (!queryVisible(SELECTORS.modalSubmit)) return true;
                    } else if (document.querySelector(SELECTORS.vacancyResponseTopic)) {
                        return true;
                    }
                    if (document.querySelector(SELECTORS.dailyResponseLimitWarning)) return 'DAILY_RESPONSE_LIMIT';
                    if (isResumeVisibilityRequiredResponse()) return 'RESUME_VISIBILITY_REQUIRED';
                    if (!wasAlreadyRespondedBeforeSubmit && isAlreadyRespondedPage()) return true;
                    if (!wasAlreadyRespondedBeforeSubmit) {
                        try {
                            const pageText = getNormalizedPageText();
                            const successTexts = [
                                'резюме доставлено',
                                'отклик отправлен',
                                'отклик был отправлен',
                                'вы откликнулись',
                                'сопроводительное письмо отправлено'
                            ];

                            if (successTexts.some(text => pageText.includes(text))) return true;
                        } catch (e) { /* ignore */ }
                    }
                    await wait(300);
                }
                return false;
            }

            const repeatedResumeSubmitClosed =
                wasAlreadyRespondedBeforeSubmit &&
                await waitForElementGone(SELECTORS.modalSubmit, 5000);
            const confirmationResult = repeatedResumeSubmitClosed
                ? true
                : await waitForSubmitConfirmation(5000);

            if (confirmationResult === 'DAILY_RESPONSE_LIMIT') {
                log('HH показал дневной лимит откликов. Завершаю работу штатно.');
                return 'DAILY_RESPONSE_LIMIT';
            }

            if (confirmationResult === 'AUTH_REQUIRED') {
                markAuthRequired('HH запросил вход во время ожидания подтверждения отклика.');
                return 'AUTH_REQUIRED';
            }

            if (confirmationResult === 'RESUME_VISIBILITY_REQUIRED') {
                markVacancyProcessedAndReturn(
                    vid,
                    returnUrl,
                    'HH не разрешил отклик из-за видимости резюме. Помечаю вакансию обработанной и иду дальше.'
                );
                await wait(800);
                return 'SKIPPED_RESUME_VISIBILITY';
            }

            if (confirmationResult === 'MANUAL_RESPONSE_REQUIRED') {
                log('После отправки открылась страница доп. вопросов. Сохраняю для ручного отклика.', true);
                handleManualResponsePage('После отправки открылась страница доп. вопросов. Сохраняю для ручного отклика.');
                await wait(1000);
                return 'REDIRECT';
            }

            if (confirmationResult === true) {
                const successfulResponses = StateManager.addSuccessfulResponseID(vid);
                log(`Отклик подтверждён. Всего подтверждено: ${successfulResponses}`);
                if (StateManager.hasReachedResponseLimit()) {
                    StateManager.addProcessedID(vid);
                    StateManager.clearLastAttemptID();
                    return 'OK';
                }
                let apply2DTime = queryVisible(SELECTORS.top2DTimeApply) || await waitForVisibleElement(SELECTORS.top2DTimeApply, config.waitForModalMs);
                log(apply2DTime);
                if(apply2DTime) return processVacancy(btn, true, resumeAttempt + 1)
                StateManager.addProcessedID(vid);
                StateManager.clearLastAttemptID();
                log('Перехожу к списку вакансий.');
                ////////////////////////////////
                if (returnUrl && returnUrl.includes('/search/vacancy')) {
                    StateManager.rememberUrl(returnUrl, 'return-to-list-confirmed');
                    window.location.href = returnUrl;
                } else {
                    StateManager.rememberUrl('/search/vacancy', 'history-back-confirmed');
                    try { history.back(); } catch (e) { window.location.href = '/search/vacancy'; }
                }
                await wait(800);
                return 'OK';
            } else {
                if (isAuthRequiredPage()) {
                    markAuthRequired('HH запросил вход вместо подтверждения отклика.');
                    return 'AUTH_REQUIRED';
                }
                if (document.querySelector(SELECTORS.dailyResponseLimitWarning)) {
                    log('HH показал дневной лимит откликов. Завершаю работу штатно.');
                    return 'DAILY_RESPONSE_LIMIT';
                }
                if (isVacancySearchPage()) {
                    const successfulResponses = StateManager.addSuccessfulResponseID(vid);
                    StateManager.addProcessedID(vid);
                    StateManager.clearLastAttemptID();
                    log(`HH вернул на список вакансий после submit. Считаю отклик подтверждённым. Всего подтверждено: ${successfulResponses}`);
                    await wait(800);
                    return 'OK';
                }
                if (isAlreadyRespondedPage() && !hasAdditionalResumeApplyButton()) {
                    markVacancyProcessedAndReturn(
                        vid,
                        returnUrl,
                        'Подтверждение не найдено сразу, но HH показывает, что отклик уже есть и других резюме нет. Помечаю обработанной.'
                    );
                    await wait(800);
                    return 'OK';
                }
                if (isResumeVisibilityRequiredResponse()) {
                    markVacancyProcessedAndReturn(
                        vid,
                        returnUrl,
                        'HH не разрешил отклик из-за видимости резюме. Помечаю вакансию обработанной и иду дальше.'
                    );
                    await wait(800);
                    return 'SKIPPED_RESUME_VISIBILITY';
                }
                if (isManualResponsePage()) {
                    log('Подтверждение не найдено, но открылась страница доп. вопросов. Сохраняю для ручного отклика.', true);
                    handleManualResponsePage('Подтверждение не найдено, но открылась страница доп. вопросов. Сохраняю для ручного отклика.');
                    await wait(1000);
                    return 'REDIRECT';
                }

                // fallback: если HH не дал понятного подтверждения, не валим весь сценарий.
                // Сохраняем вакансию в ручной список и возвращаемся к поиску.
                log('Подтверждение не найдено — сохраняю вакансию для ручной проверки и возвращаюсь к списку.', true);
                try {
                    saveCurrentManualResponse(vid, returnUrl);
                } catch (e) {
                    console.warn('save manual fallback entry error', e);
                }

                try {
                    StateManager.rememberUrl(location.href, 'history-back-no-confirm');
                    history.back();
                    // если через 1s всё ещё на странице ответов — редирект на сохранённый список
                    setTimeout(() => {
                        if (location.href.includes('/applicant/vacancy_response') || location.pathname.startsWith('/vacancy')) {
                            StateManager.rememberUrl(returnUrl, 'fallback-return-no-confirm');
                            window.location.href = returnUrl;
                        }
                    }, 2000);
                } catch (e) {
                    StateManager.rememberUrl(returnUrl, 'fallback-return-no-confirm');
                    window.location.href = returnUrl;
                }
                await wait(1000);
                return 'REDIRECT';
            }
            // --- END ---
        }

        if (btn) {
            const vacLink = findVacancyLinkNear(btn);
            if (!vacLink) {
                log('Не найден селектор ссылки вакансии. Проверьте структуру карточки.', true);
                return 'ERROR_NO_LINK';
            }
            return await processVacancyOnListing(vacLink, btn);
        }

        return 'ERROR_UNKNOWN';
    }

    // Основной цикл обработчика
    async function startLoop() {
        if (isLoopActive) return;
        const wasAlreadyRunning = StateManager.amIRunning();

        // Жёстко занимаем instance lock: не запускаемся, если работает другая вкладка
        if (!StateManager.acquireInstanceLock(TAB_ID)) {
            log('Запуск отменён: в другой вкладке уже запущен процесс (instance lock).', true);
            StateManager.setStopReason('instance_lock_busy', 'Другая вкладка уже держит lock', true);
            StateManager.setRunning(false);
            setStatus('error', 'Занято другой вкладкой');
            return;
        }

        isLoopActive = true;
        stopSignal = false;
        if (!wasAlreadyRunning) {
            StateManager.clearStopReason();
            StateManager.clearParserErrors();
            StateManager.clearRecentUrls();
            StateManager.rememberUrl(location.href, 'start-loop');
        } else {
            StateManager.rememberUrl(location.href, 'resume-loop');
        }
        StateManager.setRunning(true);
        setStatus('running');

        if (isAuthRequiredPage()) {
            markAuthRequired('HH показал форму входа при старте автооткликов.');
            isLoopActive = false;
            return;
        }

        if (isManualResponsePage()) {
            const responsePageResult = await handleNoSubmitResponsePage(
                getManualResponseVacancyId(),
                'Стартовали сразу на странице отклика без ожидаемой кнопки. Сохраняю для ручной обработки.'
            );
            if (!responsePageResult) {
                handleManualResponsePage('Стартовали сразу на странице вопросов. Сохраняю вакансию для ручного отклика.');
            }
            isLoopActive = false;
            if (responsePageResult === 'MANUAL_RETURN_STOPPED') {
                return;
            }
            setStatus('running', 'Ожидание возврата...');
            return;
        }

        // Если уже на странице вакансии — обрабатываем её напрямую
        if (location.pathname.startsWith('/vacancy/')) {
            log('На странице вакансии — продолжаю обработку тут.');
            const res = await processVacancy();
            if (res === 'OK') {
                log('Отклик отправлен. Завершаю цикл для корректного возврата.');
                isLoopActive = false;
                setStatus('running', 'Возврат к списку...');
                return;
            } else if (res === 'REDIRECT') {
                log('Произошёл редирект/вопрос при обработке. Ожидаю возврат через watchdog.', true);
                isLoopActive = false;
                setStatus('running', 'Ожидание возврата...');
                return;
            } else if (res === 'MANUAL_RETURN_STOPPED') {
                isLoopActive = false;
                return;
            } else if (res === 'SKIPPED_RESUME_VISIBILITY') {
                log('Вакансия пропущена из-за требования изменить видимость резюме. Возвращаюсь к списку.');
                isLoopActive = false;
                setStatus('running', 'Возврат к списку...');
                return;
            } else if (res === 'COMPANY_STOP_LIST_SKIPPED') {
                log('Вакансия пропущена по stop-list компании. Возвращаюсь к списку.');
                isLoopActive = false;
                setStatus('running', 'Возврат к списку...');
                return;
            } else if (res === 'STOPPED') {
                log('Остановлено пользователем во время обработки вакансии.');
                isLoopActive = false;
                StateManager.setStopReason('user_stop', 'Остановлено во время обработки вакансии');
                StateManager.setRunning(false);
                StateManager.releaseInstanceLock(TAB_ID);
                setStatus('stopped');
                return;
            } else if (res === 'DAILY_RESPONSE_LIMIT') {
                log('Достигнут дневной лимит откликов HH. Завершаю работу штатно.');
                isLoopActive = false;
                StateManager.setStopReason('hh_response_daily_limit_exceeded', 'HH daily response limit warning');
                StateManager.setRunning(false);
                StateManager.releaseInstanceLock(TAB_ID);
                setStatus('done');
                return;
            } else if (res === 'AUTH_REQUIRED') {
                isLoopActive = false;
                return;
            } else if (res === 'NO_APPLY_RETURNED' || res === 'ERROR_NO_MODAL' || res === 'NO_CONFIRM') {
                log(`Обработка завершилась с кодом ${res}. Завершаю цикл.`, true);
                isLoopActive = false;
                StateManager.addParserError(res, 'Ошибка при обработке открытой страницы вакансии');
                StateManager.setStopReason('vacancy_processing_error', res);
                StateManager.setRunning(false);
                StateManager.releaseInstanceLock(TAB_ID);
                setStatus('error');
                return;
            }
        }

        const allBtns = Array.from(document.querySelectorAll(SELECTORS.applyBtn));
        const processed = StateManager.getProcessedIDs();

        const targets = allBtns.filter(b => {
            if (config.skipHidden && b.offsetParent === null) return false;
            return !processed.has(getVacancyID(b));
        });

        log(`Найдено вакансий: ${allBtns.length}. Новых к обработке: ${targets.length}.`);
        let count = 0;

        for (const btn of targets) {
            if (stopSignal || StateManager.hasReachedResponseLimit()) break;
            if (!document.body.contains(btn)) {
                log('Кнопка исчезла из DOM — перезапускаю поиск.', true);
                break;
            }

            await vacancyPause();

            const result = await processVacancy(btn);

            if (result === 'OK') {
                count++;
                log(`Отклик #${count} отправлен.`);
                await actionPause();
            } else if (result === 'STOPPED') {
                log('Обработка остановлена пользователем.');
                isLoopActive = false;
                StateManager.setStopReason('user_stop', 'Остановлено во время обработки списка');
                StateManager.setRunning(false);
                StateManager.releaseInstanceLock(TAB_ID);
                setStatus('stopped');
                return;
            } else if (result === 'NAVIGATED') {
                // Перешли на страницу вакансии — завершаем цикл, оставляя флаг running для авто-старта на новой странице
                log('Переход на страницу вакансии — завершаю цикл для корректной навигации.');
                isLoopActive = false;
                return;
            } else if (result === 'REDIRECT') {
                log('Редирект/внешний тест. Выход из цикла, ожидаю возврат через watchdog.', true);
                isLoopActive = false;
                setStatus('running', 'Ожидание возврата...');
                return;
            } else if (result === 'MANUAL_RETURN_STOPPED') {
                isLoopActive = false;
                return;
            } else if (result === 'SKIPPED_RESUME_VISIBILITY') {
                log('Вакансия пропущена из-за требования изменить видимость резюме. Выход из цикла, ожидаю возврат через watchdog.');
                isLoopActive = false;
                setStatus('running', 'Возврат к списку...');
                return;
            } else if (result === 'COMPANY_STOP_LIST_SKIPPED') {
                log('Вакансия пропущена по stop-list компании.');
                await actionPause();
            } else if (result === 'AUTH_REQUIRED') {
                isLoopActive = false;
                return;
            } else if (result === 'RETRYING_NO_MODAL') {
                log('Не нашёл форму отклика, перезагружаю вакансию и повторю один раз.', true);
                isLoopActive = false;
                setStatus('running', 'Повтор после reload...');
                return;
            } else {
                log(`Ошибка при обработке: ${result}`, true);
                StateManager.addParserError(result, 'Ошибка при обработке вакансии из списка');
            }
        }

        if (!location.href.includes('/applicant/vacancy_response')) {
             isLoopActive = false;
             const parserErrors = StateManager.getParserErrors();
             const manualList = StateManager.getManualList();
             const totalSuccessfulResponses = StateManager.getSuccessfulResponses();
             const parserErrorDetails = parserErrors.length
                 ? `; parser errors: ${parserErrors.map(item => item.code).join(', ')}`
                 : '';
             if (stopSignal) {
                 StateManager.setStopReason('user_stop', `Получен stopSignal${parserErrorDetails}`);
             } else if (isAuthRequiredPage()) {
                 markAuthRequired(`HH показал форму входа после цикла обработки${parserErrorDetails}`);
                 return;
             } else if (!totalSuccessfulResponses && !manualList.length && parserErrors.length) {
                 StateManager.setStopReason('parser_errors_only', `Цикл завершился без откликов${parserErrorDetails}`);
             } else if (StateManager.hasReachedResponseLimit()) {
                 StateManager.setStopReason('limit_reached', `Достигнут лимит ${config.limit}${parserErrorDetails}`);
             } else if (!targets.length && manualList.length) {
                 StateManager.setStopReason(
                     'manual_targets_only',
                     `Все доступные цели ушли в ручной список. Всего кнопок: ${allBtns.length}, новых: ${targets.length}, ручных: ${StateManager.getManualList().length}${parserErrorDetails}`
                 );
             } else if (!targets.length) {
                 StateManager.setStopReason('no_new_targets', `Всего кнопок: ${allBtns.length}, новых: ${targets.length}${parserErrorDetails}`);
             } else {
                 StateManager.setStopReason('targets_processed', `Обработано в текущем цикле: ${count}, доступных целей: ${targets.length}${parserErrorDetails}`);
             }
             StateManager.setRunning(false);
             StateManager.releaseInstanceLock(TAB_ID);
             setStatus('done');
             log(`Работа завершена. Отправлено всего: ${count}`);
        }
    }

    // UI — панель с настройками и логом
    function setupUI() {
        if (document.getElementById('ar-main-panel')) return;

        const toggleBtn = document.createElement('div');
        toggleBtn.id = 'ar-toggle-btn';
        toggleBtn.textContent = '🤖';
        toggleBtn.title = 'Открыть панель HH AutoResponder';
        toggleBtn.style.cssText = `
            position: fixed; top: 50%; right: 20px; transform: translateY(-50%);
            width: 48px; height: 48px;
            background: #222; color: #fff; border-radius: 50%; display: flex;
            align-items: center; justify-content: center; font-size: 24px; cursor: pointer;
            z-index: 99999; box-shadow: 0 6px 16px rgba(0,0,0,0.35); border: 2px solid #fff;
            user-select: none; transition: all 0.2s;
        `;
        toggleBtn.onmouseenter = () => { toggleBtn.style.transform = 'translateY(-50%) scale(1.05)'; toggleBtn.style.boxShadow = '0 10px 24px rgba(0,0,0,0.4)'; };
        toggleBtn.onmouseleave = () => { toggleBtn.style.transform = 'translateY(-50%)'; toggleBtn.style.boxShadow = '0 6px 16px rgba(0,0,0,0.35)'; };
        document.body.appendChild(toggleBtn);

        const panel = document.createElement('div');
        panel.id = 'ar-main-panel';
        panel.style.position = 'fixed';
        panel.style.bottom = '20px';
        panel.style.right = '20px';
        panel.style.width = '420px';
        panel.style.background = '#fff';
        panel.style.border = '1px solid #e0e0e0';
        panel.style.boxShadow = '0 4px 20px rgba(0,0,0,0.2)';
        panel.style.borderRadius = '12px';
        panel.style.zIndex = '99999';
        panel.style.fontFamily = 'sans-serif';
        panel.style.fontSize = '13px';
        panel.style.color = '#333';
        panel.style.overflow = 'hidden';
        panel.style.display = 'block';

        panel.innerHTML = `
            <div style="padding: 12px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center; background: #f9f9f9;">
                <b>🤖 HH AutoResponder</b>
                <div style="display:flex; gap: 8px; align-items: center;">
                    <span id="ar-status-text" style="font-weight: bold; color: #666; font-size: 11px;">Ожидание</span>
                    <button id="ar-minimize-btn" style="background:none; border:none; cursor:pointer; font-size: 16px; color:#888;">—</button>
                </div>
            </div>
            <div style="padding: 12px;">
                <label style="display:block; margin-bottom: 8px; cursor: pointer;">
                    <input type="checkbox" id="ar-use-cover-check"> Сопроводительное письмо
                </label>
                <textarea id="ar-cover-text" rows="4" style="width: 100%; box-sizing: border-box; border: 1px solid #ddd; padding: 8px; border-radius: 6px; resize: vertical; margin-bottom: 12px; font-family: inherit;"></textarea>

                <div style="display: flex; gap: 10px; margin-bottom: 12px;">
                    <div style="flex: 1;">
                        <div style="font-size: 10px; color: #888; margin-bottom: 2px;">Пауза перед открытием вакансии (мс)</div>
                        <div style="display:flex; align-items:center; gap: 4px;">
                            <input type="number" id="ar-min-delay" style="width: 100%; padding: 4px; border:1px solid #ddd; border-radius: 4px;" placeholder="Min">
                            <span style="color:#888">-</span>
                            <input type="number" id="ar-max-delay" style="width: 100%; padding: 4px; border:1px solid #ddd; border-radius: 4px;" placeholder="Max">
                        </div>
                    </div>
                    <div style="width: 60px;">
                        <div style="font-size: 10px; color:#888; margin-bottom:2px;">Лимит</div>
                        <input type="number" id="ar-limit-input" style="width: 100%; padding: 4px; border:1px solid #ddd; border-radius: 4px;">
                    </div>
                </div>

                <div style="display:flex; gap:8px; margin-bottom:8px;">
                    <div style="flex:1;">
                        <div style="font-size:10px; color:#888; margin-bottom:2px;">Время чтения вакансии (мс)</div>
                        <div style="display:flex; gap:4px;">
                            <input type="number" id="ar-view-min" style="width:100%; padding:4px; border:1px solid #ddd; border-radius:4px;" placeholder="Min">
                            <input type="number" id="ar-view-max" style="width:100%; padding:4px; border:1px solid #ddd; border-radius:4px;" placeholder="Max">
                        </div>
                    </div>
                </div>

                <div style="display:flex; gap:8px; margin-bottom:12px;">
                    <div style="flex:1;">
                        <div style="font-size:10px; color:#888; margin-bottom:2px;">Задержки действий (мс)</div>
                        <div style="display:flex; gap:4px;">
                            <input type="number" id="ar-action-min" style="width:100%; padding:4px; border:1px solid #ddd; border-radius:4px;" placeholder="Min">
                            <input type="number" id="ar-action-max" style="width:100%; padding:4px; border:1px solid #ddd; border-radius:4px;" placeholder="Max">
                        </div>
                    </div>
                </div>

                <div style="display: flex; gap: 8px; margin-bottom:8px;">
                    <button id="ar-start-btn" style="flex: 1; padding: 8px; background: #22c55e; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; transition: opacity 0.2s;">START1</button>
                    <button id="ar-stop-btn" style="flex: 1; padding: 8px; background: #ef4444; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; transition: opacity 0.2s;">STOP</button>
                </div>

                <div style="display:flex; gap:8px; margin-bottom:10px;">
                    <button id="ar-health-btn" style="flex:1; padding:6px; border-radius:6px; border:1px solid #ddd; cursor:pointer;">Healthcheck</button>
                    <button id="ar-reset-history" style="flex:1; padding:6px; border-radius:6px; border:1px solid #ddd; cursor:pointer;">Reset history</button>
                </div>

            </div>
            <div style="padding: 12px; border-top: 1px solid #eee;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                    <div style="display:flex; align-items:center; gap:8px;">
                        <b>Сохранённые для ручного отклика</b>
                        <span id="ar-manual-count" style="background:#eef2ff; color:#1e3a8a; padding:2px 8px; border-radius:10px; font-size:11px;">0</span>
                    </div>
                    <div style="display:flex; gap:6px;">
                        <button id="ar-export-manual" style="padding:6px; border-radius:6px; border:1px solid #ddd; cursor:pointer;">Export</button>
                        <button id="ar-clear-manual" style="padding:6px; border-radius:6px; border:1px solid #ddd; cursor:pointer;">Clear</button>
                    </div>
                </div>
                <div id="ar-manual-list" style="max-height:120px; overflow:auto; font-size:12px; border:1px solid #f0f0f0; padding:6px; border-radius:6px; background:#fafafa"></div>
            </div>
            <div style="padding: 8px 12px; border-top:1px solid #eee; display:flex; justify-content:space-between; align-items:center; background:#fafafa;">
                <label style="font-size:12px; color:#555;"><input type="checkbox" id="ar-log-errors-only" style="margin-right:6px;">Только ошибки</label>
                <button id="ar-clear-log" style="padding:6px 10px; border-radius:6px; border:1px solid #ddd; cursor:pointer;">Clear log</button>
            </div>
            <div id="ar-log-box" style="height: 140px; overflow-y: auto; background: #1e1e1e; color: #00ff00; font-family: monospace; font-size: 11px; padding: 8px; border-top: 1px solid #333;"></div>
        `;

        document.body.appendChild(panel);

        const el = (id) => document.getElementById(id);

        el('ar-cover-text').value = config.coverText;
        el('ar-use-cover-check').checked = config.useCover;
        el('ar-min-delay').value = config.delayMin;
        el('ar-max-delay').value = config.delayMax;
        el('ar-limit-input').value = config.limit;
        el('ar-view-min').value = config.viewMin;
        el('ar-view-max').value = config.viewMax;
        el('ar-action-min').value = config.actionDelayMin;
        el('ar-action-max').value = config.actionDelayMax;
        setStatus(StateManager.amIRunning() ? 'running' : 'idle');

        const saveSettings = () => {
            config.coverText = el('ar-cover-text').value;
            config.useCover = el('ar-use-cover-check').checked;
            config.delayMin = +el('ar-min-delay').value || DEFAULTS.delayMin;
            config.delayMax = +el('ar-max-delay').value || DEFAULTS.delayMax;
            config.limit = +el('ar-limit-input').value || DEFAULTS.limit;
            config.viewMin = +el('ar-view-min').value || DEFAULTS.viewMin;
            config.viewMax = +el('ar-view-max').value || DEFAULTS.viewMax;
            config.actionDelayMin = +el('ar-action-min').value || DEFAULTS.actionDelayMin;
            config.actionDelayMax = +el('ar-action-max').value || DEFAULTS.actionDelayMax;

            config = normalizeConfig(config);
            el('ar-min-delay').value = config.delayMin;
            el('ar-max-delay').value = config.delayMax;
            el('ar-limit-input').value = config.limit;
            el('ar-view-min').value = config.viewMin;
            el('ar-view-max').value = config.viewMax;
            el('ar-action-min').value = config.actionDelayMin;
            el('ar-action-max').value = config.actionDelayMax;

            StateManager.saveConfig(config);
            log('Настройки сохранены.');
        };

        ['ar-cover-text', 'ar-use-cover-check', 'ar-min-delay', 'ar-max-delay', 'ar-limit-input', 'ar-view-min', 'ar-view-max', 'ar-action-min', 'ar-action-max'].forEach(id => el(id).addEventListener('change', saveSettings));

        const applyLogFilter = () => {
            const box = el('ar-log-box');
            const chk = el('ar-log-errors-only');
            if (!box || !chk) return;
            Array.from(box.children).forEach(child => {
                child.style.display = (chk.checked && child.dataset.error !== '1') ? 'none' : 'block';
            });
        };

        const errChk = el('ar-log-errors-only');
        if (errChk) errChk.onchange = applyLogFilter;
        const clearLogBtn = el('ar-clear-log');
        if (clearLogBtn) clearLogBtn.onclick = () => {
            const box = el('ar-log-box');
            if (box) box.innerHTML = '';
        };

        el('ar-start-btn').onclick = startLoop;
        el('ar-stop-btn').onclick = () => {
            stopSignal = true;
            isLoopActive = false;
            StateManager.setStopReason('user_stop', 'Нажата кнопка STOP');
            StateManager.setRunning(false);
            setStatus('stopped');
            StateManager.releaseInstanceLock(TAB_ID);
            log('Остановлено пользователем.');
        };

        el('ar-reset-history').onclick = () => {
            StateManager.clearProcessedIDs();
            log('История откликов сброшена.');
        };

        el('ar-health-btn').onclick = () => {
            runHealthCheck();
        };

        el('ar-clear-manual').onclick = () => {
            if (confirm('Очистить сохранённый список вакансий для ручного отклика?')) {
                StateManager.clearManualList();
                renderManualList();
                log('Список для ручного отклика очищен.');
            }
        };

        // Export: интерактивный HTML, фильтры и сортировки
        el('ar-export-manual').onclick = () => {
            const list = StateManager.getManualList();
            if (!list || !list.length) { alert('Список пуст'); return; }

            // dedupe by url (avoid duplicate identical links)
            const seen = new Set();
            const uniq = [];
            let duplicates = 0;
            for (const it of list) {
                const key = String(it.url || it.vid || '').trim();
                if (!key) continue;
                if (seen.has(key)) { duplicates++; continue; }
                seen.add(key);
                uniq.push(it);
            }

            const rowsJson = JSON.stringify(uniq).replace(/<\/script/gi, '<\\/script');

            const content = `<!doctype html><html><head><meta charset="utf-8"><title>HH Manual List</title><meta name="viewport" content="width=device-width,initial-scale=1">
                <style>
                    :root { color-scheme: light; }
                    body{font-family:Arial,Helvetica,sans-serif;padding:18px;color:#0f172a;background:#f8fafc;}
                    h2{margin:0 0 8px;font-size:20px;display:flex;align-items:center;gap:8px;}
                    h2 span.badge{background:#e0f2fe;color:#075985;padding:2px 8px;border-radius:10px;font-size:12px;}
                    .meta{color:#475569;font-size:13px;margin:6px 0 12px;}
                    .controls{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:12px;}
                    button{cursor:pointer;border-radius:6px;border:1px solid #cbd5e1;background:#fff;padding:8px 12px;font-size:13px;}
                    button.primary{background:#0ea5e9;color:#fff;border-color:#0ea5e9;}
                    button.danger{background:#ef4444;color:#fff;border-color:#ef4444;}
                    input,select{padding:7px 10px;border:1px solid #cbd5e1;border-radius:6px;font-size:13px;}
                    table{border-collapse:collapse;width:100%;margin-top:8px;font-size:13px;}
                    th,td{padding:9px;border:1px solid #e2e8f0;}
                    th{background:#f1f5f9;color:#0f172a;position:sticky;top:0;z-index:2;}
                    tr:nth-child(even){background:#f8fafc;}
                    a{color:#0b6ef6;text-decoration:none;word-break:break-all;}
                    .age.fresh{color:#16a34a;font-weight:600;}
                    .age.recent{color:#0ea5e9;font-weight:600;}
                    .age.stale{color:#f59e0b;font-weight:600;}
                    .age.old{color:#ef4444;font-weight:600;}
                    .tag{display:inline-block;background:#e2e8f0;color:#475569;padding:2px 6px;border-radius:6px;font-size:11px;}
                    .processed td{opacity:0.55;text-decoration:line-through;}
                    @media(max-width:720px){table, thead, tbody, th, td, tr{display:block;} th{position:static;} td{border:none;border-bottom:1px solid #e2e8f0;}}
                </style>
                </head><body>
                <h2>Saved vacancies <span class="badge" id="badge-count">${uniq.length}</span></h2>
                <div class="meta">Export date: ${new Date().toLocaleString()} • Duplicates removed: ${duplicates}</div>
                <div class="controls">
                    <input id="filter" type="text" placeholder="Фильтр по VID/тексту/URL" style="flex:1; min-width:200px;">
                    <select id="sort">
                        <option value="ts_desc">Новые → старые</option>
                        <option value="ts_asc">Старые → новые</option>
                        <option value="title_asc">Название A→Z</option>
                        <option value="title_desc">Название Z→A</option>
                    </select>
                    <select id="view-mode">
                        <option value="new">Новые</option>
                        <option value="opened">Открытые</option>
                    </select>
                    <button id="open-selected">Open selected</button>
                    <button id="clear-processed" class="danger">Удалить помеченные</button>
                </div>
                <table>
                    <thead>
                        <tr>
                            <th style="width:40px;"><input type="checkbox" id="check-all"></th>
                            <th>Saved</th>
                            <th>VID</th>
                            <th>Title</th>
                            <th>Link</th>
                            <th>Return URL</th>
                            <th>Age</th>
                        </tr>
                    </thead>
                    <tbody id="rows"></tbody>
                </table>

                <script>
                    const data = ${rowsJson};
                    let sortKey = 'ts_desc';
                    let filterText = '';
                    let viewMode = 'new';
                    const processed = JSON.parse(localStorage.getItem('hh_ar_manual_processed') || '{}');
                    const selected = new Set();

                    const qs = (id) => document.getElementById(id);
                    const escMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
                    const escHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (ch) => escMap[ch] || ch);
                    const keyOf = (item, idx) => {
                        const composite = [item?.url, item?.returnUrl, item?.title, item?.ts].filter(Boolean).join('|');
                        return String(item?.vid || composite || idx);
                    };
                    const encodeKey = (key) => encodeURIComponent(String(key || ''));
                    const decodeKey = (key) => {
                        try { return decodeURIComponent(String(key || '')); }
                        catch (e) { return ''; }
                    };
                    const safeHttpUrl = (raw) => {
                        if (!raw) return '';
                        try {
                            const u = new URL(String(raw));
                            if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
                            return u.href;
                        } catch (e) {
                            return '';
                        }
                    };

                    function humanAgo(ts) {
                        const d = Date.now() - ts;
                        const sec = Math.floor(d/1000);
                        if (sec < 60) return sec + 's';
                        const min = Math.floor(sec/60);
                        if (min < 60) return min + 'm';
                        const hr = Math.floor(min/60);
                        if (hr < 24) return hr + 'h';
                        const day = Math.floor(hr/24);
                        return day + 'd';
                    }

                    function ageClass(ts) {
                        const days = (Date.now() - ts)/(1000*60*60*24);
                        if (days < 1) return 'fresh';
                        if (days < 3) return 'recent';
                        if (days < 7) return 'stale';
                        return 'old';
                    }

                    function applySort(arr) {
                        const sorted = [...arr];
                        sorted.sort((a,b)=>{
                            if (sortKey === 'ts_desc') return (b.ts||0)-(a.ts||0);
                            if (sortKey === 'ts_asc') return (a.ts||0)-(b.ts||0);
                            const ta = (a.title||'').toLowerCase();
                            const tb = (b.title||'').toLowerCase();
                            if (sortKey === 'title_asc') return ta.localeCompare(tb);
                            if (sortKey === 'title_desc') return tb.localeCompare(ta);
                            return 0;
                        });
                        return sorted;
                    }

                    function render() {
                        const tbody = qs('rows');
                        if (!tbody) return;
                        const ft = filterText.trim().toLowerCase();
                        const filtered = data.filter((i, idx)=>{
                            const pKey = keyOf(i, idx);
                            if (viewMode === 'opened') {
                                if (!processed[pKey]) return false;
                            } else {
                                if (processed[pKey]) return false;
                            }
                            if (!ft) return true;
                            return [i.vid, i.title, i.url].some(v => (v||'').toLowerCase().includes(ft));
                        });
                        const sorted = applySort(filtered);
                        let html = '';
                        sorted.forEach((i, idx)=>{
                            const ts = i.ts || Date.now();
                            const ago = humanAgo(ts);
                            const aClass = ageClass(ts);
                            const key = keyOf(i, idx);
                            const keyEnc = encodeKey(key);
                            const checked = selected.has(key) ? 'checked' : '';
                            const rowClass = processed[key] ? ' class="processed"' : '';
                            const url = safeHttpUrl(i.url);
                            const returnUrl = safeHttpUrl(i.returnUrl);
                            const link = url ? '<a data-open="1" href="' + escHtml(url) + '" target="_blank" rel="noopener noreferrer">Open</a>' : '<span class="tag">n/a</span>';
                            const ret = returnUrl ? '<a data-back="1" href="' + escHtml(returnUrl) + '" target="_blank" rel="noopener noreferrer">Back</a>' : '<span class="tag">n/a</span>';
                            const title = (i.title && i.title.trim()) ? i.title : (i.url || '');
                            html += '<tr' + rowClass + ' data-key="' + keyEnc + '">'
                                 + '<td style="text-align:center;"><input type="checkbox" class="row-check" data-key="' + keyEnc + '" ' + checked + '></td>'
                                 + '<td>' + escHtml(new Date(ts).toLocaleString()) + '</td>'
                                 + '<td>' + escHtml(i.vid || '') + '</td>'
                                 + '<td>' + escHtml(title) + '</td>'
                                 + '<td>' + link + '</td>'
                                 + '<td>' + ret + '</td>'
                                 + '<td><span class="age ' + aClass + '">' + ago + '</span></td>'
                                 + '</tr>';
                        });
                        tbody.innerHTML = html;
                        const badge = qs('badge-count');
                        if (badge) badge.textContent = filtered.length;
                    }

                    function saveProcessed() {
                        localStorage.setItem('hh_ar_manual_processed', JSON.stringify(processed));
                    }

                    qs('filter').addEventListener('input', (e)=>{ filterText = e.target.value; render(); });
                    qs('sort').addEventListener('change', (e)=>{ sortKey = e.target.value; render(); });
                    qs('view-mode').addEventListener('change', (e)=>{
                        viewMode = e.target.value;
                        selected.clear();
                        render();
                    });

                    qs('check-all').addEventListener('change', (e)=>{
                        const state = e.target.checked;
                        document.querySelectorAll('.row-check').forEach(ch => {
                            ch.checked = state;
                            const key = decodeKey(ch.dataset.key);
                            if (!key) return;
                            if (state) selected.add(key);
                            else selected.delete(key);
                        });
                    });

                    qs('rows').addEventListener('change', (e)=>{
                        if (!e.target.classList.contains('row-check')) return;
                        const key = decodeKey(e.target.dataset.key);
                        if (!key) return;
                        if (e.target.checked) selected.add(key);
                        else selected.delete(key);
                    });

                    qs('open-selected').addEventListener('click', ()=>{
                        document.querySelectorAll('.row-check:checked').forEach(ch=>{
                            const key = decodeKey(ch.dataset.key);
                            const row = data.find((i, idx) => keyOf(i, idx) === key);
                            const url = safeHttpUrl(row?.url);
                            if (url) window.open(url, '_blank', 'noopener,noreferrer');
                            if (key) processed[key] = true;
                        });
                        saveProcessed();
                        selected.clear();
                        render();
                    });

                    qs('rows').addEventListener('click', (e)=>{
                        if (e.target.tagName !== 'A') return;
                        if (e.target.dataset.open !== '1') return;
                        const row = e.target.closest('tr');
                        const key = decodeKey(row?.getAttribute('data-key'));
                        if (!key) return;
                        processed[key] = true;
                        saveProcessed();
                        render();
                    });

                    qs('clear-processed').addEventListener('click', ()=>{
                        if (!confirm('Удалить все помеченные как обработанные?')) return;
                        const keys = Object.keys(processed);
                        keys.forEach(k => delete processed[k]);
                        saveProcessed();
                        selected.clear();
                        render();
                    });

                    // init
                    render();
                </script>
                </body></html>`;

            const blob = new Blob([content], { type: 'text/html;charset=utf-8' });
            const urlBlob = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = urlBlob; a.download = 'hh_manual_list.html';
            document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(urlBlob);
            log('HTML экспорт выполнен.');
        };

        const toggleVisibility = (isOpen) => {
            panel.style.display = isOpen ? 'block' : 'none';
            toggleBtn.style.display = isOpen ? 'none' : 'flex';
        };
        el('ar-minimize-btn').onclick = () => toggleVisibility(false);
        toggleBtn.onclick = () => toggleVisibility(true);

        // render manual list in UI
        function renderManualList() {
            const container = document.getElementById('ar-manual-list');
            if (!container) return;
            container.innerHTML = '';
            const list = StateManager.getManualList();
            const cntEl = document.getElementById('ar-manual-count');
            if (cntEl) cntEl.textContent = list?.length || 0;
            if (!list || !list.length) {
                const empty = document.createElement('div');
                empty.style.color = '#666';
                empty.textContent = 'Пусто';
                container.appendChild(empty);
                return;
            }
            list.forEach(item => {
                const safeUrl = toSafeHhUrl(item?.url);
                const row = document.createElement('div');
                row.style.display = 'flex';
                row.style.justifyContent = 'space-between';
                row.style.alignItems = 'center';
                row.style.padding = '6px 4px';
                row.style.borderBottom = '1px solid #eee';

                const left = document.createElement('div');
                left.style.flex = '1';
                left.style.marginRight = '8px';
                const time = new Date(Number(item?.ts) || Date.now()).toLocaleString();
                const head = document.createElement('div');
                head.style.fontSize = '11px';
                head.style.color = '#333';
                head.style.marginBottom = '2px';
                head.textContent = `${item?.vid || 'n/a'} • ${time}`;

                const linkWrap = document.createElement('div');
                linkWrap.style.fontSize = '11px';
                linkWrap.style.wordBreak = 'break-all';
                if (safeUrl) {
                    linkWrap.style.color = '#0077cc';
                    const link = document.createElement('a');
                    link.href = safeUrl;
                    link.target = '_blank';
                    link.rel = 'noopener noreferrer';
                    link.textContent = 'Открыть страницу с вопросами';
                    linkWrap.appendChild(link);
                } else {
                    linkWrap.style.color = '#b91c1c';
                    linkWrap.textContent = 'Некорректная ссылка';
                }
                left.appendChild(head);
                left.appendChild(linkWrap);

                const actions = document.createElement('div');
                actions.style.display = 'flex';
                actions.style.gap = '6px';

                const openBtn = document.createElement('button');
                openBtn.textContent = 'Open';
                openBtn.style.padding = '4px 6px';
                openBtn.style.borderRadius = '6px';
                openBtn.style.border = '1px solid #ddd';
                openBtn.style.cursor = 'pointer';
                openBtn.disabled = !safeUrl;
                openBtn.onclick = () => {
                    if (safeUrl) window.open(safeUrl, '_blank', 'noopener,noreferrer');
                };

                const removeBtn = document.createElement('button');
                removeBtn.textContent = 'Remove';
                removeBtn.style.padding = '4px 6px';
                removeBtn.style.borderRadius = '6px';
                removeBtn.style.border = '1px solid #ddd';
                removeBtn.style.cursor = 'pointer';
                removeBtn.onclick = () => { StateManager.removeManualEntry(item.vid); renderManualList(); };

                actions.appendChild(openBtn);
                actions.appendChild(removeBtn);

                row.appendChild(left);
                row.appendChild(actions);
                container.appendChild(row);
            });
        }

        // initial render
        applyLogFilter();
        renderManualList();

        // expose render function for other parts of script
        window._hh_ar_renderManualList = renderManualList;
    }

    // Пробегает по ключевым селекторам и пишет результат в лог
    function runHealthCheck() {
        const checks = [
            { name: 'Кнопка отклика (list)', sel: SELECTORS.applyBtn },
            { name: 'Верхняя кнопка отклика (vacancy page)', sel: SELECTORS.topApply },
            { name: 'Ссылка вакансии (card)', sel: SELECTORS.vacancyLink },
            { name: 'modal submit', sel: SELECTORS.modalSubmit },
            { name: 'modal textarea', sel: SELECTORS.modalTextarea }
        ];
        log('Запускаю HealthCheck...');
        checks.forEach(c => {
            const found = document.querySelector(c.sel);
            log(`${c.name}: ${found ? 'OK' : 'НЕ НАЙДЕНО'} (${c.sel})`, !found);
        });
        const raw = localStorage.getItem(KEYS.instanceLock);
        if (raw) {
            try {
                const obj = JSON.parse(raw);
                log(`Instance lock: tabId=${obj.tabId} ts=${new Date(obj.ts).toLocaleTimeString()}`);
            } catch (e) { log('Instance lock: ошибка чтения', true); }
        } else {
            log('Instance lock: отсутствует');
        }
    }

    // Инициализация
    watchTheURL();

    const domReadyObserver = new MutationObserver((mutations, obs) => {
        if (document.body) {
            setupUI();
            // Авто-возобновление, если скрипт был в работе перед перезагрузкой
            if (StateManager.amIRunning()) {
                log('Обнаружена незавершенная работа. Авто-возобновление через 1.5 сек...');
                setStatus('running', 'Авто-запуск...');
                setTimeout(() => {
                    const startButton = document.getElementById('ar-start-btn');
                    if (startButton) startButton.click();
                }, 1500);
            }
            // Сбрасываем ловушку при открытии новых страниц
            StateManager.clearTrapLock();
            obs.disconnect();
        }
    });
    domReadyObserver.observe(document.documentElement, { childList: true, subtree: true });

    // Очищаем instance lock при закрытии вкладки
    window.addEventListener('beforeunload', () => {
        StateManager.releaseInstanceLock(TAB_ID);
    });
    window.addEventListener('unload', () => {
        StateManager.releaseInstanceLock(TAB_ID);
    });})();
