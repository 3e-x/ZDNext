// ==UserScript==
// @name         RUMI - Zendesk
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  RUMI button functionality for Zendesk workflows
// @author       QWJiYXM=
// @match        *://*.zendesk.com/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    // Core variables needed for RUMI
    let username = '';
    let observerDisconnected = false;
    let fieldVisibilityState = 'all'; // 'all' or 'minimal'
    let globalButton = null;
    // Hala functionality now handles automatic group assignment instead of toast

    // Performance optimization variables
    let domCache = new Map();
    let debounceTimers = new Map();

    // RUMI Enhancement variables for automated ticket status management
    let rumiEnhancement = {
        isMonitoring: false,
        selectedViews: new Set(),
        processedTickets: new Set(),
        baselineTickets: new Map(), // view_id -> Set of ticket IDs
        ticketStatusHistory: new Map(), // ticket_id -> {status, lastProcessed, attempts}
        automationLogs: [], // Store automation logs for dashboard display
        processedHistory: [],
        pendingTickets: [],
        solvedTickets: [],
        rtaTickets: [],
        // Separate tracking for automatic vs manual processing
        automaticTickets: {
            pending: [],
            solved: [],
            rta: []
        },
        manualTickets: {
            pending: [],
            solved: [],
            rta: []
        },
        lastCheckTime: null,
        checkInterval: null,
        consecutiveErrors: 0,
        apiCallCount: 0,
        lastApiReset: Date.now(),
        isDryRun: true, // Legacy - keep for compatibility
        dryRunModes: {
            automatic: true,
            manual: true
        },
        activeTab: 'automatic', // Track active main tab
        currentLogLevel: 2, // 0=ERROR, 1=WARN, 2=INFO, 3=DEBUG
        // Monitoring session tracking
        monitoringStats: {
            sessionStartTime: null,
            sessionStopTime: null,
            totalRunningTime: 0, // milliseconds
            sessionHistory: [], // Array of {start, stop, duration} objects
            currentSessionStart: null
        },
        operationModes: {
            pending: true,
            solved: true,
            rta: true
        },
        enabledPendingPhrases: null, // Will be initialized to all enabled
        enabledSolvedPhrases: null, // Will be initialized to all enabled
        config: {
            CHECK_INTERVAL: 10000,       // 10 seconds like notify extension
            MIN_INTERVAL: 10000,         // Minimum 10 seconds
            MAX_INTERVAL: 60000,         // Maximum 60 seconds
            MAX_RETRIES: 1,              // Minimal retries like notify extension
            RATE_LIMIT: 600,             // Back to higher limit since we'll be more efficient
            CIRCUIT_BREAKER_THRESHOLD: 5 // More tolerant of 429 errors
        },
        pendingTriggerPhrases: [
            // ===============================================================
            // ESCALATION PHRASES (English)
            // ===============================================================
            "We have directed this matter to the most appropriate support team, who will be reaching out to you as soon as possible. In the meantime, if you feel more information could be helpful, please reply to this message.",
            "We have escalated this matter to a specialized support team, who will be reaching out to you as soon as possible.",
            "We have escalated this to a specialized support team who will be reaching out to you as soon as possible.",
            "We have escalated this to a specialised support team who will be reaching out to you as soon as possible.",
            "I would like to reassure you that we are treating this with the utmost seriousness. A member of our team will be in touch with you shortly.",
            "EMEA Urgent Triage Team zzzDUT",
            "https://blissnxt.uberinternal.com",
            "https://uber.lighthouse-cloud.com",
            "1st call attempt",
            "2nd call attempt",
            "3rd call attempt",
            "We've forwarded this issue to a specialized support team who will contact you as soon as possible",

            // ===============================================================
            // MORE INFO NEEDED PHRASES (English)
            // ===============================================================
            "In order to be able to take the right action, we want you to provide us with more information about what happened",
            "In the meantime, if you feel additional information could be helpful, please reply to this message. We'll be sure to follow-up",
            "In the meantime, this contact thread will say \"Waiting for your reply,\" but there is nothing else needed from you right now",
            "Any additional information would be beneficial to our investigation.",
            "We’ll keep an eye out for your reply",

            // ===============================================================
            // WAITING FOR REPLY PHRASES (English)
            // ===============================================================
            "Will be waiting for your reply",
            "Awaiting your reply.",
            "Waiting for your reply.",
            "Waiting for your kind response.",

            // ===============================================================
            // INTERNAL NOTES/ACTIONS (English)
            // ===============================================================
            "more info",
            "- More info needed",
            "-More info needed",
            "- Asking for more info.",
            "-Asking for more info.",
            "- More Info needed - FP Blocked -Set Reported by / Reported against",
            "-More info needed -FB Blocked Updated safety reported by to RIDER",
            "MORE INFO NEEDED",
            "MORE INFO",

            // ===============================================================
            // ESCALATION PHRASES (Arabic)
            // ===============================================================
            "لقد قمنا بتصعيد هذا الأمر إلى الفريق المختص، والذي سيقوم بالتواصل معك في أقرب وقت ممكن.",
            "لقد قمنا بتصعيد هذه المشكلة إلى فريق دعم مُتخصِّص وسيتواصل معك في أسرع وقت ممكن",

            // ===============================================================
            // MORE INFO NEEDED PHRASES (Arabic)
            // ===============================================================
            "لمساعدتنا في اتخاذ الإجراء اللازم، يُرجى توضيح مزيد من التفاصيل عن ما حدث معك أثناء الرحلة.",
            "علمًا بأن أي تفاصيل إضافية ستساعدنا في مراجعتنا للرحلة وأخذ الإجراء الداخلي المناسب",
            "إذا كنتِ تعتقدين أن المزيد من المعلومات قد يفيدكِ، يُرجى الرد على هذه الرسالة.",
            "إذا كنت تعتقد أن أي معلومات إضافية قد تكون مفيدة، يُرجى الرد على هذه الرسالة.",

            // ===============================================================
            // WAITING FOR REPLY PHRASES (Arabic)
            // ===============================================================
            "في انتظار ردك.",
            "في انتظار ردكِ",
            "ننتظر ردك",
            "ننتظر ردكِ",
            "في انتظار الرد"
        ],

        solvedTriggerPhrases: [
            "Rest assured, we take these kinds of allegations very seriously and we will be taking the appropriate actions with the partner driver involved. As of this message, we have also made some changes in the application to reduce the chance of you being paired with this partner driver in the future. If you are ever matched again, please cancel the trip and reach out to us through the application.",
            "Thanks for your understanding",
            "وقد اتخذنا بالفعل الإجراء المناسب داخلياً بشأن حساب السائق",
"نود إعلامكِ أننا قد تلقينا رسالتكِ، وسوف يقوم أحد أعضاء الفريق المختص لدينا بالتواصل معكِ من خلال رسالة أخرى بخصوص استفساركِ في أقرب وقت ممكن",
"نود إعلامك أننا قد تلقينا رسالتك، وسوف يقوم أحد أعضاء الفريق المختص لدينا بالتواصل معك من خلال رسالة أخرى بخصوص استفسارك في أقرب وقت ممكن",
"فإننا نأخذ مثل هذه الادِّعاءات على محمل الجد، وسنتَّخذ الإجراءات الداخلية الملائمة بحق السائق المتورط في الأمر",
"قد أجرينا أيضاً بعض التغييرات في التطبيق للتقليل من فرص",
"وسوف نقوم بمتابعة التحقيق واتخاذ الإجراءات اللازمة داخليًا",
"لقد انتهزنا الفرصة لمراجعة مشكلتك، ويمكننا ملاحظة أنك قد تواصلت معنا بشأنها من قبل. ومن ثمَّ، سنغلق تذكرة الدعم الحالية لتسهيل التواصل وتجنُّب أي التباس",
"وسنتابع الأمر مع الشريك السائق المعني ، لمحاولة ضمان عدم تكرار التجربة التي وصفتها",
"نحن نأخذ هذه الأنواع من الادعاءات على محمل الجد وسوف نتخذ الإجراءات المناسبة مع الشريك السائق المعني",
"إذا تمت مطابقتكِ مرة أخرى، يرجى إلغاء الرحلة والتواصل معنا من خلال التطبيق",
"سنتابع الأمر مع السائق من أجل اتخاذ الإجراءات المناسبة داخلياً",
"لنمنح الركاب تجربة خالية من المتاعب حتى يتمكنوا من إجراء مشوار في أقرب وقت ممكن",
"يمكننا الردّ على أي استفسارات حول هذا الأمر في أي وقت",


"We will be following up with ‍Partner-driver, to try to ensure the experience you describe can’t happen again.",
"We will be following up with the driver and taking the appropriate actions",
"Rest assured that we have taken the necessary internal actions.",
"already taken the appropriate action internally",
"already taken the appropriate actions internally",
"We have already taken all the appropriate actions internally.",
"to try to ensure the experience you describe can’t happen again.",
"It looks like you’ve already raised a similar concern for this trip that our Support team has resolved.",
"-PB",
"- PB",
"-Pushback",
"-Push back",
"- Pushback",
"- Push back",
"LERT@uber.com",
"NRN"
        ]
    };

    // ============================================================================
    // RUMI ENHANCEMENT - PERSISTENT STORAGE
    // ============================================================================

    const RUMIStorage = {
        STORAGE_KEYS: {
            PROCESSED_TICKETS: 'rumi_processed_tickets',
            AUTOMATION_LOGS: 'rumi_automation_logs',
            TICKET_HISTORY: 'rumi_ticket_history',
            MONITORING_STATE: 'rumi_monitoring_state',
            SETTINGS: 'rumi_settings'
        },

        // Save processed tickets to localStorage
        saveProcessedTickets() {
            try {
                const data = {
                    processedHistory: rumiEnhancement.processedHistory,
                    pendingTickets: rumiEnhancement.pendingTickets,
                    solvedTickets: rumiEnhancement.solvedTickets,
                    rtaTickets: rumiEnhancement.rtaTickets,
                    automaticTickets: rumiEnhancement.automaticTickets,
                    manualTickets: rumiEnhancement.manualTickets,
                    processedTickets: Array.from(rumiEnhancement.processedTickets),
                    lastSaved: new Date().toISOString()
                };
                localStorage.setItem(this.STORAGE_KEYS.PROCESSED_TICKETS, JSON.stringify(data));
                RUMILogger.debug('Saved processed tickets to storage');
            } catch (error) {
                RUMILogger.error('Failed to save processed tickets', null, error);
            }
        },

        // Load processed tickets from localStorage
        loadProcessedTickets() {
            try {
                const data = localStorage.getItem(this.STORAGE_KEYS.PROCESSED_TICKETS);
                if (!data) return false;

                const parsed = JSON.parse(data);

                // Restore processed ticket data
                rumiEnhancement.processedHistory = parsed.processedHistory || [];
                rumiEnhancement.pendingTickets = parsed.pendingTickets || [];
                rumiEnhancement.solvedTickets = parsed.solvedTickets || [];
                rumiEnhancement.rtaTickets = parsed.rtaTickets || [];
                rumiEnhancement.automaticTickets = parsed.automaticTickets || {pending: [], solved: [], rta: []};
                rumiEnhancement.manualTickets = parsed.manualTickets || {pending: [], solved: [], rta: []};
                rumiEnhancement.processedTickets = new Set(parsed.processedTickets || []);

                const ticketCount = rumiEnhancement.processedHistory.length;
                RUMILogger.info(`Restored ${ticketCount} processed tickets from storage`);
                return true;
            } catch (error) {
                RUMILogger.error('Failed to load processed tickets', null, error);
                return false;
            }
        },

        // Save automation logs to localStorage
        saveAutomationLogs() {
            try {
                const data = {
                    logs: rumiEnhancement.automationLogs.slice(0, 200), // Keep last 200 logs
                    lastSaved: new Date().toISOString()
                };
                localStorage.setItem(this.STORAGE_KEYS.AUTOMATION_LOGS, JSON.stringify(data));
            } catch (error) {
                RUMILogger.error('Failed to save automation logs', null, error);
            }
        },

        // Load automation logs from localStorage
        loadAutomationLogs() {
            try {
                const data = localStorage.getItem(this.STORAGE_KEYS.AUTOMATION_LOGS);
                if (!data) return false;

                const parsed = JSON.parse(data);
                rumiEnhancement.automationLogs = parsed.logs || [];

                RUMILogger.debug(`Restored ${rumiEnhancement.automationLogs.length} log entries from storage`);
                return true;
            } catch (error) {
                RUMILogger.error('Failed to load automation logs', null, error);
                return false;
            }
        },

        // Save ticket status history
        saveTicketHistory() {
            try {
                const historyArray = Array.from(rumiEnhancement.ticketStatusHistory.entries());
                const data = {
                    history: historyArray,
                    lastSaved: new Date().toISOString()
                };
                localStorage.setItem(this.STORAGE_KEYS.TICKET_HISTORY, JSON.stringify(data));
            } catch (error) {
                RUMILogger.error('Failed to save ticket history', null, error);
            }
        },

        // Load ticket status history
        loadTicketHistory() {
            try {
                const data = localStorage.getItem(this.STORAGE_KEYS.TICKET_HISTORY);
                if (!data) return false;

                const parsed = JSON.parse(data);
                rumiEnhancement.ticketStatusHistory = new Map(parsed.history || []);

                RUMILogger.debug(`Restored ${rumiEnhancement.ticketStatusHistory.size} ticket status entries from storage`);
                return true;
            } catch (error) {
                RUMILogger.error('Failed to load ticket history', null, error);
                return false;
            }
        },

        // Save monitoring state and settings
        saveMonitoringState() {
            try {
                const data = {
                    selectedViews: Array.from(rumiEnhancement.selectedViews),
                    isDryRun: rumiEnhancement.isDryRun,
                    dryRunModes: rumiEnhancement.dryRunModes,
                    activeTab: rumiEnhancement.activeTab,
                    currentLogLevel: rumiEnhancement.currentLogLevel,
                    operationModes: rumiEnhancement.operationModes,
                    enabledPendingPhrases: rumiEnhancement.enabledPendingPhrases,
                    enabledSolvedPhrases: rumiEnhancement.enabledSolvedPhrases,
                    checkInterval: rumiEnhancement.config.CHECK_INTERVAL,
                    monitoringStats: rumiEnhancement.monitoringStats,
                    lastSaved: new Date().toISOString()
                };
                localStorage.setItem(this.STORAGE_KEYS.MONITORING_STATE, JSON.stringify(data));
            } catch (error) {
                RUMILogger.error('Failed to save monitoring state', null, error);
            }
        },

        // Load monitoring state and settings
        loadMonitoringState() {
            try {
                const data = localStorage.getItem(this.STORAGE_KEYS.MONITORING_STATE);
                if (!data) return false;

                const parsed = JSON.parse(data);

                // Restore state
                rumiEnhancement.selectedViews = new Set(parsed.selectedViews || []);
                rumiEnhancement.isDryRun = parsed.isDryRun !== undefined ? parsed.isDryRun : true;
                rumiEnhancement.dryRunModes = {
                    automatic: parsed.dryRunModes?.automatic !== undefined ? parsed.dryRunModes.automatic : true,
                    manual: parsed.dryRunModes?.manual !== undefined ? parsed.dryRunModes.manual : true
                };
                rumiEnhancement.activeTab = parsed.activeTab || 'automatic';
                rumiEnhancement.currentLogLevel = parsed.currentLogLevel || 2;
                rumiEnhancement.operationModes = { ...rumiEnhancement.operationModes, ...parsed.operationModes };

                // Restore phrase enable/disable arrays
                if (parsed.enabledPendingPhrases) {
                    rumiEnhancement.enabledPendingPhrases = parsed.enabledPendingPhrases;
                }
                if (parsed.enabledSolvedPhrases) {
                    rumiEnhancement.enabledSolvedPhrases = parsed.enabledSolvedPhrases;
                }

                if (parsed.checkInterval) {
                    rumiEnhancement.config.CHECK_INTERVAL = parsed.checkInterval;
                }

                // Restore monitoring statistics
                if (parsed.monitoringStats) {
                    rumiEnhancement.monitoringStats = {
                        ...rumiEnhancement.monitoringStats,
                        ...parsed.monitoringStats
                    };
                }

                RUMILogger.debug('Restored monitoring state from storage');
                return true;
            } catch (error) {
                RUMILogger.error('Failed to load monitoring state', null, error);
                return false;
            }
        },

        // Save all data
        saveAll() {
            this.saveProcessedTickets();
            this.saveAutomationLogs();
            this.saveTicketHistory();
            this.saveMonitoringState();
        },

        // Load all data
        loadAll() {
            this.loadProcessedTickets();
            this.loadAutomationLogs();
            this.loadTicketHistory();
            this.loadMonitoringState();
        },

        // Clear old data (older than specified days)
        clearOldData(daysToKeep = 7) {
            try {
                const cutoffDate = new Date();
                cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

                // Clean processed tickets
                rumiEnhancement.processedHistory = rumiEnhancement.processedHistory.filter(ticket =>
                    new Date(ticket.timestamp) > cutoffDate
                );
                rumiEnhancement.pendingTickets = rumiEnhancement.pendingTickets.filter(ticket =>
                    new Date(ticket.timestamp) > cutoffDate
                );
                rumiEnhancement.solvedTickets = rumiEnhancement.solvedTickets.filter(ticket =>
                    new Date(ticket.timestamp) > cutoffDate
                );
                rumiEnhancement.rtaTickets = rumiEnhancement.rtaTickets.filter(ticket =>
                    new Date(ticket.timestamp) > cutoffDate
                );

                // Clean logs
                rumiEnhancement.automationLogs = rumiEnhancement.automationLogs.filter(log =>
                    new Date(log.timestamp) > cutoffDate
                );

                // Clean ticket history
                for (const [ticketId, history] of rumiEnhancement.ticketStatusHistory.entries()) {
                    if (new Date(history.lastProcessed) <= cutoffDate) {
                        rumiEnhancement.ticketStatusHistory.delete(ticketId);
                    }
                }

                this.saveAll();
                RUMILogger.info(`Cleaned data older than ${daysToKeep} days`);
            } catch (error) {
                RUMILogger.error('Failed to clean old data', null, error);
            }
        },

        // Clear all stored data
        clearAll() {
            try {
                Object.values(this.STORAGE_KEYS).forEach(key => {
                    localStorage.removeItem(key);
                });
                RUMILogger.info('Cleared all stored data');
            } catch (error) {
                RUMILogger.error('Failed to clear stored data', null, error);
            }
        },

        // Remove duplicates from processed tickets
        deduplicateProcessedTickets() {
            try {
                // Deduplicate pending tickets
                const uniquePending = [];
                const seenPendingIds = new Set();
                for (const ticket of rumiEnhancement.pendingTickets) {
                    if (!seenPendingIds.has(ticket.id)) {
                        seenPendingIds.add(ticket.id);
                        uniquePending.push(ticket);
                    }
                }

                // Deduplicate solved tickets
                const uniqueSolved = [];
                const seenSolvedIds = new Set();
                for (const ticket of rumiEnhancement.solvedTickets) {
                    if (!seenSolvedIds.has(ticket.id)) {
                        seenSolvedIds.add(ticket.id);
                        uniqueSolved.push(ticket);
                    }
                }

                // Deduplicate RTA tickets
                const uniqueRta = [];
                const seenRtaIds = new Set();
                for (const ticket of rumiEnhancement.rtaTickets) {
                    if (!seenRtaIds.has(ticket.id)) {
                        seenRtaIds.add(ticket.id);
                        uniqueRta.push(ticket);
                    }
                }

                const beforeCounts = {
                    pending: rumiEnhancement.pendingTickets.length,
                    solved: rumiEnhancement.solvedTickets.length,
                    rta: rumiEnhancement.rtaTickets.length
                };

                // Replace with deduplicated arrays
                rumiEnhancement.pendingTickets = uniquePending;
                rumiEnhancement.solvedTickets = uniqueSolved;
                rumiEnhancement.rtaTickets = uniqueRta;

                const afterCounts = {
                    pending: uniquePending.length,
                    solved: uniqueSolved.length,
                    rta: uniqueRta.length
                };

                // Save the cleaned data
                this.saveProcessedTickets();

                RUMILogger.info(`Removed duplicates: Pending ${beforeCounts.pending}→${afterCounts.pending}, Solved ${beforeCounts.solved}→${afterCounts.solved}, RTA ${beforeCounts.rta}→${afterCounts.rta}`);

                return {
                    before: beforeCounts,
                    after: afterCounts
                };
            } catch (error) {
                RUMILogger.error('Failed to deduplicate processed tickets', null, error);
                return null;
            }
        }
    };

    // Configuration object for timing and cache management
    const config = {
        timing: {
            cacheMaxAge: 5000
        }
    };

    // Function to load field visibility state from localStorage
    function loadFieldVisibilityState() {
        const savedState = localStorage.getItem('zendesk_field_visibility_state');
        if (savedState && (savedState === 'all' || savedState === 'minimal')) {
            fieldVisibilityState = savedState;
            console.log(`🔐 Field visibility state loaded from storage: ${fieldVisibilityState}`);
        } else {
            fieldVisibilityState = 'all'; // Default state
            console.log(`🔐 Using default field visibility state: ${fieldVisibilityState}`);
        }
    }

    // Function to save field visibility state to localStorage
    function saveFieldVisibilityState() {
        localStorage.setItem('zendesk_field_visibility_state', fieldVisibilityState);
        console.log(`💾 Field visibility state saved: ${fieldVisibilityState}`);
    }

    // Function to apply the current field visibility state to forms
    function applyFieldVisibilityState() {
        const allForms = DOMCache.get('div[data-test-id="ticket-fields"][data-tracking-id="ticket-fields"]', true, 2000);

        if (allForms.length === 0) {
            return;
        }

        console.log(`🔄 Applying field visibility state: ${fieldVisibilityState}`);

        requestAnimationFrame(() => {
            allForms.forEach(form => {
                if (!form || !form.children || !form.isConnected) return;

                const fields = Array.from(form.children).filter(field =>
                    field.nodeType === Node.ELEMENT_NODE && field.isConnected
                );

                // Batch DOM operations
                const fieldsToHide = [];
                const fieldsToShow = [];

                fields.forEach(field => {
                    try {
                        if (fieldVisibilityState === 'all') {
                            // Show all fields
                            fieldsToShow.push(field);
                        } else if (isTargetField(field)) {
                            // This is a target field for minimal state, show it
                            fieldsToShow.push(field);
                        } else {
                            // This is not a target field for minimal state, hide it
                            fieldsToHide.push(field);
                        }
                    } catch (e) {
                        // Silent error handling
                    }
                });

                // Apply changes in batches to minimize reflows
                fieldsToHide.forEach(field => field.classList.add('hidden-form-field'));
                fieldsToShow.forEach(field => field.classList.remove('hidden-form-field'));
            });

            // Update button state to reflect current state
            updateToggleButtonState();
        });
    }

    // Enhanced DOM cache system
    const DOMCache = {
        _staticCache: new Map(),
        _volatileCache: new Map(),

        get(selector, isStatic = false, maxAge = null) {
            const cache = isStatic ? this._staticCache : this._volatileCache;
            const defaultMaxAge = isStatic ? config.timing.cacheMaxAge : 1000;
            const actualMaxAge = maxAge || defaultMaxAge;

            const now = Date.now();
            const cached = cache.get(selector);

            if (cached && (now - cached.timestamp) < actualMaxAge) {
                return cached.elements;
            }

            const elements = document.querySelectorAll(selector);
            cache.set(selector, { elements, timestamp: now });

            this._cleanup(cache, actualMaxAge);
            return elements;
        },

        clear() {
            this._staticCache.clear();
            this._volatileCache.clear();
        },

        _cleanup(cache, maxAge) {
            if (cache.size > 50) {
                const now = Date.now();
                for (const [key, value] of cache.entries()) {
                    if ((now - value.timestamp) > maxAge * 2) {
                        cache.delete(key);
                    }
                }
            }
        }
    };

    // CSS injection for RUMI button and text input
    function injectCSS() {
        if (document.getElementById('rumi-styles')) return;

        const style = document.createElement('style');
        style.id = 'rumi-styles';
        style.textContent = `
            /* RUMI button icon styles */
            .rumi-icon svg {
                width: 16px !important;
                height: 16px !important;
                display: block !important;
            }

            /* Duplicate button icon styles */
            .duplicate-icon svg {
                width: 16px !important;
                height: 16px !important;
                display: block !important;
            }

            .sc-ymabb7-1.fTDEYw {
                display: inline-flex !important;
                align-items: center !important;
            }

            /* Text input styles */
            .rumi-text-input {
                position: fixed;
                width: 30px;
                height: 20px;
                font-size: 12px;
                border: 1px solid #ccc;
                border-radius: 3px;
                padding: 2px;
                z-index: 1000;
                background: white;
            }

            /* Field visibility styles */
            .hidden-form-field {
                display: none !important;
            }
            .form-toggle-icon {
                width: 26px;
                height: 26px;
            }

            /* Views toggle functionality styles */
            .hidden-view-item {
                display: none !important;
                visibility: hidden !important;
                opacity: 0 !important;
                height: 0 !important;
                overflow: hidden !important;
                margin: 0 !important;
                padding: 0 !important;
            }

            /* Views toggle button protection */
            .views-toggle-btn,
            #views-toggle-button,
            #views-toggle-wrapper {
                pointer-events: auto !important;
                visibility: visible !important;
                opacity: 1 !important;
                display: inline-block !important;
                position: relative !important;
                z-index: 100 !important;
            }

            #views-header-left-container {
                pointer-events: auto !important;
                visibility: visible !important;
                display: flex !important;
            }

            /* Navigation button container styling */
            .custom-nav-section {
                display: flex !important;
                justify-content: center !important;
                align-items: center !important;
                width: 100% !important;
            }

            .nav-list-item {
                display: flex !important;
                justify-content: center !important;
                align-items: center !important;
                width: 100% !important;
            }

            /* Center the button content */
            .form-toggle-icon {
                display: flex !important;
                justify-content: center !important;
                align-items: center !important;
                width: 100% !important;
                text-align: center !important;
            }

            /* Navigation separator styling */
            .nav-separator {
                height: 2px;
                background-color: rgba(47, 57, 65, 0.24);
                margin: 12px 16px;
                width: calc(100% - 32px);
                border-radius: 1px;
            }

            /* Toast notification styling for export notifications */

            /* RUMI Enhancement Control Panel Styles - Professional Admin Interface */
            .rumi-enhancement-overlay {
                position: fixed !important;
                top: 0 !important;
                left: 0 !important;
                width: 100% !important;
                height: 100% !important;
                background: rgba(0,0,0,0.5) !important;
                z-index: 2147483647 !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
            }

            .rumi-enhancement-overlay.rumi-hidden {
                display: none !important;
            }

            .rumi-enhancement-panel {
                background: #F5F5F5 !important;
                color: #333333 !important;
                padding: 0 !important;
                border-radius: 2px !important;
                box-shadow: 0 1px 3px rgba(0,0,0,0.1) !important;
                max-width: 900px !important;
                max-height: 90vh !important;
                overflow-y: auto !important;
                width: 95% !important;
                font-family: Arial, Helvetica, sans-serif !important;
                border: 1px solid #E0E0E0 !important;
            }

            .rumi-enhancement-panel h2 {
                color: #333333 !important;
                font-size: 14px !important;
                margin: 0 !important;
                font-weight: bold !important;
                text-shadow: none !important;
            }

            .rumi-enhancement-panel h3 {
                color: #333333 !important;
                font-size: 14px !important;
                margin: 0 0 12px 0 !important;
                font-weight: bold !important;
                text-shadow: none !important;
            }

            .rumi-enhancement-panel h4 {
                color: #666666 !important;
                font-size: 13px !important;
                margin: 0 0 8px 0 !important;
                font-weight: bold !important;
            }

            .rumi-enhancement-button {
                padding: 6px 12px !important;
                border: 1px solid #CCCCCC !important;
                border-radius: 2px !important;
                background: white !important;
                color: #333333 !important;
                cursor: pointer !important;
                margin-right: 8px !important;
                margin-bottom: 4px !important;
                font-size: 13px !important;
                font-family: Arial, Helvetica, sans-serif !important;
                transition: none !important;
                box-shadow: none !important;
            }

            .rumi-enhancement-button-primary {
                background: #0066CC !important;
                color: white !important;
                border-color: #0066CC !important;
                box-shadow: none !important;
            }

            .rumi-enhancement-button-danger {
                background: #DC3545 !important;
                color: white !important;
                border-color: #DC3545 !important;
                box-shadow: none !important;
            }

            .rumi-enhancement-button:hover {
                background: #F0F0F0 !important;
                transform: none !important;
                box-shadow: none !important;
            }

            .rumi-enhancement-button-primary:hover {
                background: #0052A3 !important;
            }

            .rumi-enhancement-button-danger:hover {
                background: #C82333 !important;
            }

            .rumi-enhancement-status-active {
                color: #28A745 !important;
                font-weight: bold !important;
                text-shadow: none !important;
                font-size: 13px !important;
            }

            .rumi-enhancement-status-inactive {
                color: #DC3545 !important;
                font-weight: bold !important;
                text-shadow: none !important;
                font-size: 13px !important;
            }

            .rumi-enhancement-section {
                margin-bottom: 16px !important;
                border-bottom: none !important;
                padding: 16px !important;
                background: white !important;
                border-radius: 2px !important;
                border: 1px solid #E0E0E0 !important;
                box-shadow: 0 1px 3px rgba(0,0,0,0.1) !important;
            }

            .rumi-enhancement-section:last-child {
                margin-bottom: 0 !important;
            }

            .rumi-processed-ticket-item {
                margin-bottom: 8px !important;
                padding: 8px 12px !important;
                background: #FAFAFA !important;
                border-left: 3px solid #0066CC !important;
                font-size: 13px !important;
                border-radius: 0 !important;
                box-shadow: none !important;
                border: 1px solid #E0E0E0 !important;
                border-left: 3px solid #0066CC !important;
            }

            .rumi-enhancement-panel input[type="text"],
            .rumi-enhancement-panel input[type="range"] {
                background: white !important;
                border: 1px solid #CCCCCC !important;
                color: #333333 !important;
                border-radius: 2px !important;
                padding: 6px 8px !important;
                font-family: Arial, Helvetica, sans-serif !important;
                font-size: 13px !important;
            }

            .rumi-enhancement-panel input[type="checkbox"] {
                accent-color: #0066CC !important;
                transform: none !important;
            }

            .rumi-enhancement-panel label {
                color: #666666 !important;
                font-size: 13px !important;
            }

            .rumi-enhancement-panel details {
                border: 1px solid #E0E0E0 !important;
                border-radius: 2px !important;
                padding: 12px !important;
                background: white !important;
            }

            .rumi-enhancement-panel summary {
                color: #333333 !important;
                font-weight: bold !important;
                cursor: pointer !important;
                padding: 8px !important;
                border-radius: 0 !important;
                transition: none !important;
                font-size: 13px !important;
            }

            .rumi-enhancement-panel summary:hover {
                background: #F0F0F0 !important;
            }

            /* RUMI Enhancement View Selection Styles - Table Format */
            .rumi-view-grid {
                display: block !important;
                max-height: 400px !important;
                overflow-y: auto !important;
                border: 1px solid #E0E0E0 !important;
                border-radius: 2px !important;
                padding: 0 !important;
                background: white !important;
            }

            .rumi-view-group {
                margin-bottom: 0 !important;
            }

            .rumi-view-group-header {
                color: #666666 !important;
                font-size: 11px !important;
                font-weight: bold !important;
                margin: 0 !important;
                padding: 8px 12px !important;
                background: #F0F0F0 !important;
                border-radius: 0 !important;
                border-left: none !important;
                text-shadow: none !important;
                text-transform: uppercase !important;
                letter-spacing: 0.5px !important;
                border-bottom: 1px solid #E0E0E0 !important;
            }

            .rumi-view-item {
                display: flex !important;
                align-items: center !important;
                padding: 8px 12px !important;
                border: none !important;
                border-radius: 0 !important;
                background: white !important;
                cursor: pointer !important;
                transition: none !important;
                font-size: 13px !important;
                margin-bottom: 0 !important;
                border-bottom: 1px solid #F0F0F0 !important;
            }

            .rumi-view-item:nth-child(even) {
                background: #FAFAFA !important;
            }

            .rumi-view-item:hover {
                border-color: transparent !important;
                background: #E8F4FD !important;
                box-shadow: none !important;
                transform: none !important;
            }

            .rumi-view-item.selected {
                border-color: transparent !important;
                background: #D1ECF1 !important;
                box-shadow: none !important;
            }

            .rumi-view-checkbox {
                margin-right: 12px !important;
                accent-color: #0066CC !important;
                transform: none !important;
            }

            /* Tab Styles */
            .rumi-tabs {
                border: 1px solid #E0E0E0 !important;
                border-radius: 4px !important;
                background: white !important;
            }

            .rumi-tab-headers {
                display: flex !important;
                border-bottom: 1px solid #E0E0E0 !important;
                background: #F8F9FA !important;
                border-radius: 4px 4px 0 0 !important;
            }

            .rumi-tab-header {
                flex: 1 !important;
                padding: 10px 16px !important;
                border: none !important;
                background: transparent !important;
                cursor: pointer !important;
                font-size: 13px !important;
                font-weight: 500 !important;
                color: #666 !important;
                border-bottom: 2px solid transparent !important;
                transition: all 0.2s ease !important;
            }

            .rumi-tab-header:hover {
                background: #E9ECEF !important;
                color: #333 !important;
            }

            .rumi-tab-header.active {
                background: white !important;
                color: #0066CC !important;
                border-bottom-color: #0066CC !important;
                margin-bottom: -1px !important;
            }

            .rumi-tab-content {
                position: relative !important;
            }

            .rumi-tab-panel {
                display: none !important;
                padding: 16px !important;
            }

            .rumi-tab-panel.active {
                display: block !important;
            }

            /* Result Card Styles */
            .rumi-result-card:hover {
                transform: translateY(-2px) !important;
                box-shadow: 0 4px 12px rgba(0,0,0,0.15) !important;
                border-color: #0066CC !important;
            }

            .rumi-result-card.selected {
                border-color: #0066CC !important;
                box-shadow: 0 2px 8px rgba(0,102,204,0.2) !important;
            }

            .rumi-view-info {
                flex: 1 !important;
                display: flex !important;
                justify-content: space-between !important;
                align-items: center !important;
            }

            .rumi-view-title {
                font-weight: normal !important;
                color: #333333 !important;
                margin-bottom: 0 !important;
                font-size: 13px !important;
            }


            .rumi-view-selection-header {
                display: flex !important;
                justify-content: space-between !important;
                align-items: center !important;
                margin-bottom: 12px !important;
            }

            .rumi-view-selection-actions {
                display: flex !important;
                gap: 8px !important;
            }

            /* Top Bar Styles */
            .rumi-enhancement-top-bar {
                background: white !important;
                border-bottom: 1px solid #E0E0E0 !important;
                padding: 12px 16px !important;
                display: flex !important;
                justify-content: space-between !important;
                align-items: center !important;
                height: 40px !important;
                box-sizing: border-box !important;
            }

            /* Main Tab Navigation */
            .rumi-main-tabs {
                display: flex !important;
                background: #f8f9fa !important;
                border-bottom: 1px solid #E0E0E0 !important;
                margin: 0 !important;
                padding: 0 !important;
            }

            .rumi-main-tab {
                flex: 1 !important;
                background: transparent !important;
                border: none !important;
                padding: 12px 16px !important;
                cursor: pointer !important;
                font-size: 13px !important;
                font-weight: 500 !important;
                color: #666666 !important;
                border-bottom: 3px solid transparent !important;
                transition: all 0.2s ease !important;
            }

            .rumi-main-tab:hover {
                background: #e9ecef !important;
                color: #333333 !important;
            }

            .rumi-main-tab.active {
                color: #0066CC !important;
                background: white !important;
                border-bottom-color: #0066CC !important;
            }

            /* Main Tab Content */
            .rumi-main-tab-content {
                position: relative !important;
            }

            .rumi-main-tab-panel {
                display: none !important;
            }

            .rumi-main-tab-panel.active {
                display: block !important;
            }

            /* Metrics Row */
            .rumi-metrics-row {
                display: flex !important;
                gap: 16px !important;
                margin-bottom: 16px !important;
            }

            .rumi-metric-box {
                flex: 1 !important;
                background: white !important;
                border: 1px solid #E0E0E0 !important;
                border-radius: 2px !important;
                padding: 12px !important;
                text-align: center !important;
                box-shadow: 0 1px 3px rgba(0,0,0,0.1) !important;
            }

            .rumi-metric-value {
                font-size: 18px !important;
                font-weight: bold !important;
                color: #333333 !important;
                display: block !important;
                margin-bottom: 4px !important;
            }

            .rumi-metric-label {
                font-size: 11px !important;
                color: #666666 !important;
                text-transform: uppercase !important;
                letter-spacing: 0.5px !important;
            }

            /* Control Panel Horizontal Layout */
            .rumi-control-panel {
                display: flex !important;
                align-items: center !important;
                gap: 16px !important;
                margin-bottom: 16px !important;
            }

            .rumi-status-indicator {
                display: flex !important;
                align-items: center !important;
                gap: 6px !important;
            }

            .rumi-status-dot {
                width: 8px !important;
                height: 8px !important;
                border-radius: 50% !important;
                display: inline-block !important;
            }

            .rumi-status-dot.active {
                background: #28A745 !important;
            }

            .rumi-status-dot.inactive {
                background: #DC3545 !important;
            }

            /* CSV Export Button Styles */
            .rumi-view-actions {
                opacity: 1 !important;
            }

            .rumi-csv-download-btn {
                min-width: 28px !important;
                height: 24px !important;
                padding: 4px !important;
                margin-right: 0 !important;
                margin-bottom: 0 !important;
                font-size: 14px !important;
                line-height: 1 !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
            }

            .rumi-csv-download-btn svg {
                width: 16px !important;
                height: 16px !important;
                display: block !important;
            }

            /* Manual Export Views Styles - Simplified */
            .rumi-manual-export-simple {
                display: flex;
                flex-direction: column;
                gap: 6px;
            }

            .rumi-export-simple-item {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 6px 12px;
                background: #F8F9FA;
                border: 1px solid #E0E0E0;
                border-radius: 3px;
            }

            .rumi-export-view-name {
                font-size: 12px;
                color: #495057;
                flex: 1;
            }

            .rumi-manual-export-btn {
                min-width: 28px !important;
                height: 24px !important;
                padding: 4px !important;
                margin-left: 8px !important;
                font-size: 14px !important;
                line-height: 1 !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
            }

            .rumi-manual-export-btn svg {
                width: 16px !important;
                height: 16px !important;
                display: block !important;
            }

            /* Log Entry Styles */
            .rumi-log-entry {
                display: flex !important;
                align-items: flex-start !important;
                gap: 8px !important;
                padding: 4px 0 !important;
                border-bottom: 1px solid #F0F0F0 !important;
                font-size: 11px !important;
                line-height: 1.3 !important;
            }

            .rumi-log-entry:last-child {
                border-bottom: none !important;
            }

            .rumi-log-time {
                color: #666 !important;
                min-width: 60px !important;
                font-size: 10px !important;
            }

            .rumi-log-level {
                min-width: 40px !important;
                font-weight: bold !important;
                font-size: 10px !important;
                text-align: center !important;
                padding: 1px 4px !important;
                border-radius: 2px !important;
            }

            .rumi-log-error .rumi-log-level {
                background: #ffebee !important;
                color: #c62828 !important;
            }

            .rumi-log-warn .rumi-log-level {
                background: #fff8e1 !important;
                color: #f57f17 !important;
            }

            .rumi-log-info .rumi-log-level {
                background: #e3f2fd !important;
                color: #1565c0 !important;
            }

            .rumi-log-debug .rumi-log-level {
                background: #f3e5f5 !important;
                color: #7b1fa2 !important;
            }

            .rumi-log-ticket {
                background: #e8f5e8 !important;
                color: #2e7d32 !important;
                padding: 1px 4px !important;
                border-radius: 2px !important;
                font-size: 10px !important;
                font-weight: bold !important;
                min-width: 70px !important;
                text-align: center !important;
            }

            .rumi-log-message {
                flex: 1 !important;
                color: #333 !important;
                word-wrap: break-word !important;
            }

        `;
        document.head.appendChild(style);
    }

    // SVG icons for the hide/show button
    const eyeOpenSVG = `<svg viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>`;
    const eyeClosedSVG = `<svg viewBox="0 0 24 24"><path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/></svg>`;

    // Uber logo SVG (from the provided image)
    const uberLogoSVG = `<svg viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg"><circle cx="256" cy="256" r="256" fill="currentColor"/><path d="M256 176c44.112 0 80 35.888 80 80s-35.888 80-80 80-80-35.888-80-80 35.888-80 80-80zm0-48c-70.692 0-128 57.308-128 128s57.308 128 128 128 128-57.308 128-128-57.308-128-128-128z" fill="white"/><rect x="176" y="272" width="160" height="16" fill="white"/></svg>`;

    // Duplicate/Copy icon SVG
    const duplicateIconSVG = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" fill="currentColor"/></svg>`;

    // Download icon SVG
    const downloadIconSVG = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" fill="currentColor"/></svg>`;

    // Debounce function
    function debounce(func, delay, key) {
        if (debounceTimers.has(key)) {
            clearTimeout(debounceTimers.get(key));
        }

        const timerId = setTimeout(() => {
            debounceTimers.delete(key);
            func();
        }, delay);

        debounceTimers.set(key, timerId);
    }

    // ============================================================================
    // RUMI ENHANCEMENT - LOGGING SYSTEM
    // ============================================================================

    const RUMILogger = {
        log(level, category, message, ticketId = null, data = null) {
            if (level > rumiEnhancement.currentLogLevel) return;

            const timestamp = new Date();
            const levelNames = ['ERROR', 'WARN', 'INFO', 'DEBUG'];
            const levelName = levelNames[level];

            // Create clear, human-readable log entry
            const logEntry = {
                id: Date.now() + Math.random(), // Unique ID for each log entry
                timestamp: timestamp,
                level: levelName,
                category: category,
                message: message,
                ticketId: ticketId,
                data: data,
                timeString: timestamp.toLocaleTimeString()
            };

            // Add to automation logs (limit to last 500 entries)
            rumiEnhancement.automationLogs.unshift(logEntry);
            if (rumiEnhancement.automationLogs.length > 500) {
                rumiEnhancement.automationLogs = rumiEnhancement.automationLogs.slice(0, 500);
            }

            // Auto-save logs periodically (every 10 logs)
            if (rumiEnhancement.automationLogs.length % 10 === 0) {
                RUMIStorage.saveAutomationLogs();
            }

            // Update dashboard if it's open
            this.updateLogDisplay();

            // Only log errors and warnings to console, not regular automation activity
            if (level <= 1) { // ERROR and WARN only
                const styles = {
                    ERROR: 'color: #ff4444; font-weight: bold;',
                    WARN: 'color: #ffaa00; font-weight: bold;'
                };

                console.log(
                    `%c[RUMI-${levelName}] ${message}${ticketId ? ` (Ticket: ${ticketId})` : ''}`,
                    styles[levelName],
                    data || ''
                );
            }
        },

        updateLogDisplay() {
            const logContainer = document.getElementById('rumi-log-container');
            if (!logContainer) return;

            // Check if user has scrolled up before updating
            const wasAtBottom = this.isScrolledToBottom(logContainer);

            // Apply current filter
            const filter = document.getElementById('rumi-log-filter')?.value || 'all';
            let displayLogs = rumiEnhancement.automationLogs.slice(0, 100); // Show last 100 logs

            // Filter logs based on level
            if (filter !== 'all') {
                const levelHierarchy = { 'debug': 3, 'info': 2, 'warn': 1, 'error': 0 };
                const minLevel = levelHierarchy[filter];
                displayLogs = displayLogs.filter(log => levelHierarchy[log.level.toLowerCase()] <= minLevel);
            }

            // Clear and rebuild log display
            logContainer.innerHTML = '';

            if (displayLogs.length === 0) {
                logContainer.innerHTML = '<div style="text-align: center; color: #666; padding: 20px;">No logs yet</div>';
                return;
            }

            displayLogs.forEach(log => {
                const logElement = document.createElement('div');
                logElement.className = `rumi-log-entry rumi-log-${log.level.toLowerCase()}`;

                let ticketInfo = log.ticketId ? `<span class="rumi-log-ticket">Ticket #${log.ticketId}</span>` : '';

                logElement.innerHTML = `
                    <div class="rumi-log-time">${log.timeString}</div>
                    <div class="rumi-log-level">${log.level}</div>
                    ${ticketInfo}
                    <div class="rumi-log-message">${log.message}</div>
                `;

                logContainer.appendChild(logElement);
            });

            // Auto-scroll to bottom only if user was already at bottom
            if (wasAtBottom) {
                this.scrollToBottom(logContainer);
            }
        },

        // Check if container is scrolled to bottom (with small tolerance)
        isScrolledToBottom(container) {
            const threshold = 5; // pixels tolerance
            return container.scrollTop + container.clientHeight >= container.scrollHeight - threshold;
        },

        // Scroll container to bottom
        scrollToBottom(container) {
            container.scrollTop = container.scrollHeight;
        },

        // Setup scroll detection for smart autoscroll
        setupLogScrollDetection() {
            const logContainer = document.getElementById('rumi-log-container');
            if (!logContainer) return;

            // Remove existing listener if any
            logContainer.removeEventListener('scroll', this.handleLogScroll);

            // Add scroll listener
            this.handleLogScroll = () => {
                // Store scroll state for future updates
                logContainer.setAttribute('data-user-scrolled', !this.isScrolledToBottom(logContainer));
            };

            logContainer.addEventListener('scroll', this.handleLogScroll);
        },

        // Helper methods with clearer, more descriptive messages
        error(category, message, ticketId = null, data = null) {
            this.log(0, category, message, ticketId, data);
        },

        warn(category, message, ticketId = null, data = null) {
            this.log(1, category, message, ticketId, data);
        },

        info(category, message, ticketId = null, data = null) {
            this.log(2, category, message, ticketId, data);
        },

        debug(category, message, ticketId = null, data = null) {
            this.log(3, category, message, ticketId, data);
        },

        // Specific automation action logging methods
        ticketProcessed(action, ticketId, details) {
            this.info('PROCESS', `${action} - ${details}`, ticketId);
        },

        ticketSkipped(reason, ticketId) {
            this.debug('PROCESS', `Skipped: ${reason}`, ticketId);
        },

        monitoringStatus(message) {
            this.info('MONITOR', `Monitoring: ${message}`);
        },

        apiActivity(message, count = null) {
            const fullMessage = count ? `${message} (${count} calls)` : message;
            this.debug('API', fullMessage);
        }
    };

    // ============================================================================
    // RUMI ENHANCEMENT - API MANAGEMENT
    // ============================================================================

    const RUMIAPIManager = {
        async makeRequest(endpoint, options = {}) {
            const startTime = Date.now();

            // Simple circuit breaker check
            if (rumiEnhancement.consecutiveErrors >= rumiEnhancement.config.CIRCUIT_BREAKER_THRESHOLD) {
                RUMILogger.warn('API', `Circuit breaker activated - too many consecutive errors`);
                throw new Error('Circuit breaker activated - too many consecutive errors');
            }

            const defaultOptions = {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest'
                },
                credentials: 'same-origin'
            };

            const finalOptions = { ...defaultOptions, ...options };

            RUMILogger.debug('API', `Making ${finalOptions.method} request to ${endpoint}`);

            try {
                const response = await fetch(endpoint, finalOptions);
                const responseTime = Date.now() - startTime;

                if (response.status === 429) {
                    // Like notify extension - just throw the error, let higher level handle it
                    throw new Error(`HTTP 429: Rate limited`);
                }

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                const data = await response.json();

                // Reset consecutive errors on success
                rumiEnhancement.consecutiveErrors = 0;
                rumiEnhancement.apiCallCount++;

                RUMILogger.debug('API', `Request successful (${responseTime}ms) - Total API calls: ${rumiEnhancement.apiCallCount}`, { endpoint, status: response.status });

                return data;
            } catch (error) {
                const responseTime = Date.now() - startTime;

                // Only count system errors as consecutive failures, not data errors
                if (!error.message.includes('429') && !error.message.includes('400')) {
                    rumiEnhancement.consecutiveErrors++;
                }

                RUMILogger.error('API', `Request failed: ${error.message}`, {
                    endpoint,
                    consecutiveErrors: rumiEnhancement.consecutiveErrors,
                    responseTime,
                    options: finalOptions
                });

                throw error;
            }
        },

        async makeRequestWithRetry(endpoint, options = {}, maxRetries = rumiEnhancement.config.MAX_RETRIES) {
            // Like notify extension - minimal retries, just fail fast
            try {
                return await this.makeRequest(endpoint, options);
            } catch (error) {
                // Only retry once for non-429 errors
                if (!error.message.includes('429') && maxRetries > 0) {
                    RUMILogger.warn('API', `Request failed, retrying once: ${error.message}`);
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    return await this.makeRequest(endpoint, options);
                }
                throw error;
            }
        },

        checkRateLimit() {
            const now = Date.now();
            const timeWindow = 60000; // 1 minute

            // Only reset consecutive errors when rate limit window resets, but keep API call count cumulative for session tracking
            if (now - rumiEnhancement.lastApiReset > timeWindow) {
                rumiEnhancement.lastApiReset = now;
                // Reset consecutive errors when rate limit window resets
                if (rumiEnhancement.consecutiveErrors > 0) {
                    RUMILogger.info('API', 'Rate limit window reset - clearing consecutive errors');
                    rumiEnhancement.consecutiveErrors = 0;
                }
            }

            // Very conservative approach - use only 50% of our already reduced limit
            // For rate limiting purposes, we'll track recent calls separately if needed
            const effectiveLimit = Math.floor(rumiEnhancement.config.RATE_LIMIT * 0.5);

            // For now, be less restrictive since we're tracking cumulative calls
            // In a real scenario, we'd track calls per minute separately
            return true; // Allow calls but monitor via the cumulative counter
        },

        async waitForRateLimit() {
            // If we're close to rate limit, wait
            if (!this.checkRateLimit()) {
                const waitTime = 60000 - (Date.now() - rumiEnhancement.lastApiReset);
                RUMILogger.warn('API', `Rate limit approached, waiting ${Math.ceil(waitTime / 1000)}s`);
                await new Promise(resolve => setTimeout(resolve, Math.max(waitTime, 5000)));
            }
        },

        async validateConnectivity() {
            try {
                await this.makeRequest('/api/v2/users/me.json');
                RUMILogger.info('VALIDATION', 'API connectivity validated');
                return true;
            } catch (error) {
                RUMILogger.error('VALIDATION', 'API connectivity failed', error);
                return false;
            }
        }
    };

    // ============================================================================
    // RUMI ENHANCEMENT - ZENDESK API
    // ============================================================================

    const RUMIZendeskAPI = {
        async getViews() {
            try {
                const data = await RUMIAPIManager.makeRequestWithRetry('/api/v2/views.json');
                RUMILogger.info('ZENDESK', `Retrieved ${data.views.length} views`);

                // Debug: log a sample view to understand the structure
                if (data.views.length > 0) {
                    RUMILogger.debug('ZENDESK', 'Sample view structure:', data.views[0]);
                }

                return data.views;
            } catch (error) {
                RUMILogger.error('ZENDESK', 'Failed to retrieve views', error);
                throw error;
            }
        },

        async getViewTickets(viewId, options = {}) {
            try {
                const {
                    per_page = 100,
                    page = 1,
                    sort_by = 'created_at',
                    sort_order = 'desc',
                    include = 'via_id'
                } = options;

                const endpoint = `/api/v2/views/${viewId}/execute.json?per_page=${per_page}&page=${page}&sort_by=${sort_by}&sort_order=${sort_order}&group_by=+&include=${include}`;
                const data = await RUMIAPIManager.makeRequestWithRetry(endpoint);

                RUMILogger.debug('ZENDESK', `Retrieved ${data.rows?.length || 0} tickets from view ${viewId}`);
                return data.rows || [];
            } catch (error) {
                RUMILogger.error('ZENDESK', `Failed to retrieve tickets for view ${viewId}`, error);
                throw error;
            }
        },

        async exportViewAsCSV(viewId, viewName = null) {
            try {
                RUMILogger.info('ZENDESK', `Starting CSV export for view ${viewId} (${viewName})`);

                const endpoint = `/api/v2/views/${viewId}/export`;
                const data = await RUMIAPIManager.makeRequestWithRetry(endpoint);

                RUMILogger.info('ZENDESK', `CSV export response for view ${viewId}:`, {
                    status: data.export?.status,
                    viewName: viewName
                });

                return {
                    status: data.export?.status || 'unknown',
                    message: data.export?.message || null,
                    viewId: viewId,
                    viewName: viewName
                };
            } catch (error) {
                RUMILogger.error('ZENDESK', `Failed to export CSV for view ${viewId}`, error);
                throw error;
            }
        },

        async getViewTicketsForDirectCSV(viewId, viewName = null) {
            try {
                RUMILogger.info('ZENDESK', `Fetching all tickets for direct CSV export: view ${viewId} (${viewName})`);

                // Get first page to determine total count
                const firstPageData = await RUMIAPIManager.makeRequestWithRetry(
                    `/api/v2/views/${viewId}/execute.json?per_page=100&page=1&sort_by=created_at&sort_order=desc&group_by=+&include=via_id`
                );

                let allTickets = firstPageData.rows || [];
                const totalCount = firstPageData.count || 0;
                const totalPages = Math.ceil(totalCount / 100);

                RUMILogger.info('ZENDESK', `View ${viewId} has ${totalCount} tickets across ${totalPages} pages`);

                // If there are more pages, fetch them concurrently
                if (totalPages > 1) {
                    const pagePromises = [];
                    for (let page = 2; page <= Math.min(totalPages, 10); page++) { // Limit to 10 pages (1000 tickets) for performance
                        pagePromises.push(
                            RUMIAPIManager.makeRequestWithRetry(
                                `/api/v2/views/${viewId}/execute.json?per_page=100&page=${page}&sort_by=created_at&sort_order=desc&group_by=+&include=via_id`
                            )
                        );
                    }

                    const additionalPages = await Promise.all(pagePromises);
                    additionalPages.forEach(pageData => {
                        if (pageData.rows) {
                            allTickets = allTickets.concat(pageData.rows);
                        }
                    });
                }

                RUMILogger.info('ZENDESK', `Fetched ${allTickets.length} tickets for direct CSV export`);

                return {
                    tickets: allTickets,
                    users: firstPageData.users || [],
                    count: totalCount,
                    viewId: viewId,
                    viewName: viewName
                };
            } catch (error) {
                RUMILogger.error('ZENDESK', `Failed to fetch tickets for direct CSV export: view ${viewId}`, error);
                throw error;
            }
        },



        async getTicketComments(ticketId) {
            try {
                const endpoint = `/api/v2/tickets/${ticketId}/comments.json?sort_order=desc`;
                const data = await RUMIAPIManager.makeRequestWithRetry(endpoint);
                RUMILogger.debug('ZENDESK', `Retrieved ${data.comments.length} comments for ticket ${ticketId}`);
                return data.comments;
            } catch (error) {
                RUMILogger.error('ZENDESK', `Failed to retrieve comments for ticket ${ticketId}`, error);
                throw error;
            }
        },

        async getUserDetails(userId) {
            try {
                const endpoint = `/api/v2/users/${userId}.json`;
                const data = await RUMIAPIManager.makeRequestWithRetry(endpoint);
                RUMILogger.debug('ZENDESK', `Retrieved user details for user ${userId}`, {
                    id: data.user.id,
                    role: data.user.role,
                    name: data.user.name
                });
                return data.user;
            } catch (error) {
                RUMILogger.error('ZENDESK', `Failed to retrieve user details for user ${userId}`, error);
                throw error;
            }
        },

        async updateTicketStatus(ticketId, status = 'pending', viewName = null) {
            // When setting to pending, also assign to user 34980896869267
            const updates = { status };
            if (status === 'pending') {
                updates.assignee_id = 34980896869267;
                RUMILogger.info('ZENDESK', `Setting ticket ${ticketId} to pending and assigning to user 34980896869267`);
            }
            return this.updateTicket(ticketId, updates, viewName);
        },

        async updateTicketWithAssignee(ticketId, status, assigneeId, viewName = null) {
            const updates = { status, assignee_id: assigneeId };
            RUMILogger.info('ZENDESK', `Setting ticket ${ticketId} to ${status} and assigning to user ${assigneeId}`);
            return this.updateTicket(ticketId, updates, viewName);
        },

        async updateTicket(ticketId, updates, viewName = null) {
            // Special handling for SSOC Egypt views
            const isEgyptView = viewName && (
                viewName.includes('SSOC - Egypt Open') ||
                viewName.includes('SSOC - Egypt Urgent')
            );

            // Prepare the ticket updates
            let ticketUpdates = { ...updates };
            let dryRunDescription = Object.entries(updates).map(([key, value]) => `${key}: ${value}`).join(', ');

            // For Egypt SSOC views, when setting to pending, also set priority to normal if needed
            if (isEgyptView && updates.status === 'pending') {
                if (!rumiEnhancement.isDryRun) {
                    // Get current ticket to check priority
                    try {
                        const currentTicket = await RUMIAPIManager.makeRequestWithRetry(`/api/v2/tickets/${ticketId}.json`);
                        const currentPriority = currentTicket?.ticket?.priority;

                        if (currentPriority && ['low', 'high', 'urgent'].includes(currentPriority)) {
                            ticketUpdates.priority = 'normal';
                            RUMILogger.info('ZENDESK', `Egypt view rule: Will change priority from ${currentPriority} to normal for ticket ${ticketId}`);
                        }
                    } catch (priorityCheckError) {
                        RUMILogger.warn('ZENDESK', `Could not check current priority for ticket ${ticketId}, proceeding with status update only`, priorityCheckError);
                    }
                }

                // Update dry run description to show priority change
                if (ticketUpdates.priority) {
                    dryRunDescription += ', priority: normal (Egypt view rule)';
                } else {
                    dryRunDescription += ' (Egypt view rule: would check priority)';
                }
            }

            if (rumiEnhancement.isDryRun) {
                RUMILogger.info('DRY-RUN', `Would update ticket ${ticketId} to ${dryRunDescription}`);
                return { ticket: { id: ticketId, ...ticketUpdates } };
            }

            try {
                // Get CSRF token
                const csrfToken = this.getCSRFToken();
                if (!csrfToken) {
                    throw new Error('CSRF token not found - authentication may be required');
                }

                const endpoint = `/api/v2/tickets/${ticketId}.json`;
                const payload = {
                    ticket: ticketUpdates
                };

                const headers = {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': csrfToken,
                    'X-Requested-With': 'XMLHttpRequest'
                };

                const data = await RUMIAPIManager.makeRequestWithRetry(endpoint, {
                    method: 'PUT',
                    headers: headers,
                    body: JSON.stringify(payload)
                });

                const updatesList = Object.entries(ticketUpdates).map(([key, value]) => `${key}: ${value}`).join(', ');
                RUMILogger.info('ZENDESK', `Updated ticket ${ticketId} - ${updatesList}`);
                return data;
            } catch (error) {
                RUMILogger.error('ZENDESK', `Failed to update ticket ${ticketId}`, error);
                throw error;
            }
        },

        getCSRFToken() {
            // Try multiple methods to get CSRF token
            const methods = [
                () => document.querySelector('meta[name="csrf-token"]')?.getAttribute('content'),
                () => document.querySelector('meta[name="_csrf"]')?.getAttribute('content'),
                () => window.csrfToken,
                () => {
                    const scripts = document.querySelectorAll('script');
                    for (const script of scripts) {
                        const match = script.textContent.match(/csrf[_-]?token["']?\s*[:=]\s*["']([^"']+)["']/i);
                        if (match) return match[1];
                    }
                    return null;
                }
            ];

            for (const method of methods) {
                try {
                    const token = method();
                    if (token) {
                        RUMILogger.debug('ZENDESK', 'CSRF token found');
                        return token;
                    }
                } catch (e) {
                    // Continue to next method
                }
            }

            RUMILogger.warn('ZENDESK', 'CSRF token not found');
            return null;
        }
    };

    // ============================================================================
    // RUMI ENHANCEMENT - CSV UTILITIES
    // ============================================================================

    const RUMICSVUtils = {
        generateTicketIDsCSV(viewData) {
            const { tickets } = viewData;

            RUMILogger.info('CSV', `Extracting ticket IDs from ${tickets.length} tickets`);

            // Extract ticket IDs only
            const ticketIds = tickets.map(ticketRow => {
                const ticket = ticketRow.ticket || ticketRow;
                return ticket.id;
            }).filter(id => id); // Remove any undefined/null IDs

            // Create comma-separated string
            const csvContent = ticketIds.join(',');

            RUMILogger.info('CSV', `Generated CSV with ${ticketIds.length} ticket IDs: ${csvContent}`);

            return csvContent;
        },

        async copyToClipboard(text) {
            try {
                await navigator.clipboard.writeText(text);
                RUMILogger.info('CSV', `Successfully copied to clipboard: ${text}`);
                return true;
            } catch (error) {
                RUMILogger.error('CSV', 'Failed to copy to clipboard', error);
                return false;
            }
        }
    };

    // ============================================================================
    // RUMI ENHANCEMENT - COMMENT ANALYSIS
    // ============================================================================
    //
    // Enhanced to handle end-user reply chains with author restrictions:
    // 1. REQUIRED CONDITION: At least one comment must be from author ID 35067366305043
    //    AND contain either "Incident type" or "Customer words"
    //    - If no qualifying comment from this author exists, ticket stays as open (no pending)
    // 2. If latest comment is from agent/admin: Check for trigger phrases directly
    // 3. If latest comment is from end-user:
    //    - Traverse backwards through comments to find the last agent comment
    //    - If that agent comment contains trigger phrases, mark ticket for pending
    //    - This handles cases where customer replies to agent messages containing trigger phrases
    // 4. AUTHOR RESTRICTION: Only comments from author ID 34980896869267 can trigger pending status
    // 5. EXCLUSION: Trigger phrases found in comments from author 35067366305043 are ignored
    // 6. CAREEM EXCLUSION: Comments containing both trigger phrases AND "Careem Actions Required on Rider" are excluded
    // 7. Fallback to original behavior if user role cannot be determined
    //
    const RUMICommentAnalyzer = {
        async analyzeLatestComment(comments) {
            if (!comments || comments.length === 0) {
                RUMILogger.debug('COMMENT', 'No comments to analyze');
                return { matches: false, phrase: null };
            }

            // Ensure phrase arrays are initialized
            if (!rumiEnhancement.enabledPendingPhrases) {
                rumiEnhancement.enabledPendingPhrases = new Array(rumiEnhancement.pendingTriggerPhrases.length).fill(true);
                RUMILogger.debug('COMMENT', 'Initialized enabledPendingPhrases array');
            }

            // NEW REQUIREMENT: Check if any comment is from author 35067366305043 AND contains "Incident type" or "Customer words"
            // This is a required condition for setting tickets to pending
            const hasRequiredAuthor = this.hasCommentFromRequiredAuthor(comments, 35067366305043);
            if (!hasRequiredAuthor) {
                RUMILogger.debug('COMMENT', 'No qualifying comment found from required author 35067366305043 (must contain "Incident type" or "Customer words") - ticket will stay as open');
                return { matches: false, phrase: null, reason: 'Missing qualifying comment from author 35067366305043' };
            }

            RUMILogger.debug('COMMENT', 'Found qualifying comment from required author 35067366305043 with required phrases - proceeding with trigger phrase analysis');

            // Get latest comment (first in desc order)
            const latestComment = comments[0];
            const commentBody = latestComment.body || '';
            const htmlBody = latestComment.html_body || '';

            RUMILogger.debug('COMMENT', `Analyzing latest comment from ticket`, {
                commentId: latestComment.id,
                author: latestComment.author_id,
                created: latestComment.created_at,
                bodyLength: commentBody.length,
                htmlBodyLength: htmlBody.length
            });

            try {
                // Get the author details to check their role
                const authorDetails = await RUMIZendeskAPI.getUserDetails(latestComment.author_id);
                const authorRole = authorDetails.role;

                RUMILogger.debug('COMMENT', `Latest comment author role: ${authorRole}`, {
                    userId: latestComment.author_id,
                    userName: authorDetails.name,
                    role: authorRole
                });

                // If latest comment is from an agent, check for trigger phrases directly
                if (authorRole === 'agent' || authorRole === 'admin') {
                    return this.checkTriggerPhrases(commentBody, htmlBody, latestComment);
                }

                // If latest comment is from end-user, traverse backwards to find the last agent comment
                if (authorRole === 'end-user') {
                    RUMILogger.info('Analyzing ticket for pending trigger phrases', latestComment.ticket_id);

                    // Start from index 1 (skip the latest end-user comment)
                    for (let i = 1; i < comments.length; i++) {
                        const comment = comments[i];

                        try {
                            // Get this comment author's role
                            const commentAuthor = await RUMIZendeskAPI.getUserDetails(comment.author_id);
                            const commentAuthorRole = commentAuthor.role;

                            RUMILogger.debug('COMMENT', `Checking comment ${i + 1} from ${commentAuthorRole}`, {
                                commentId: comment.id,
                                authorId: comment.author_id,
                                authorName: commentAuthor.name,
                                role: commentAuthorRole
                            });

                            // If we find an agent comment, check it for trigger phrases
                            if (commentAuthorRole === 'agent' || commentAuthorRole === 'admin') {
                                RUMILogger.debug('Found agent comment, checking for trigger phrases', latestComment.ticket_id);
                                const result = this.checkTriggerPhrases(comment.body || '', comment.html_body || '', comment);

                                if (result.matches) {
                                    RUMILogger.ticketProcessed('SET TO PENDING', latestComment.ticket_id, `Found trigger phrase: "${result.phrase.substring(0, 50)}..."`);
                                    return {
                                        matches: true,
                                        phrase: result.phrase,
                                        comment: comment,
                                        triggerReason: 'end-user-reply-chain',
                                        latestComment: latestComment
                                    };
                                } else {
                                    RUMILogger.debug('COMMENT', `Agent comment does not contain trigger phrases - no action needed`);
                                    return { matches: false, phrase: null, comment: latestComment };
                                }
                            }

                            // If it's another end-user comment, continue searching backwards
                            if (commentAuthorRole === 'end-user') {
                                RUMILogger.debug('COMMENT', `Comment ${i + 1} is also from end-user, continuing search`);
                                continue;
                            }

                        } catch (userError) {
                            RUMILogger.warn('COMMENT', `Failed to get user details for comment author ${comment.author_id}`, userError);
                            // Continue to next comment if we can't get user details
                            continue;
                        }
                    }

                    // If we've gone through all comments and only found end-user comments
                    RUMILogger.debug('COMMENT', 'No agent comments found in history - no action needed');
                    return { matches: false, phrase: null, comment: latestComment };
                }

                // For any other roles, check trigger phrases directly
                RUMILogger.debug('COMMENT', `Comment author has role "${authorRole}", checking trigger phrases directly`);
                return this.checkTriggerPhrases(commentBody, htmlBody, latestComment);

            } catch (error) {
                RUMILogger.error('COMMENT', `Failed to get user details for latest comment author ${latestComment.author_id}`, error);
                // Fallback to original behavior if we can't get user details
                RUMILogger.warn('COMMENT', 'Falling back to original trigger phrase checking behavior');
                return this.checkTriggerPhrases(commentBody, htmlBody, latestComment);
            }
        },

        checkTriggerPhrases(commentBody, htmlBody, comment) {
            if (!commentBody && !htmlBody) {
                return { matches: false, phrase: null, comment };
            }

            // Enhanced debugging: Log the actual comment body structure
            RUMILogger.debug('COMMENT', 'Checking comment bodies:', {
                bodyLength: commentBody ? commentBody.length : 0,
                htmlBodyLength: htmlBody ? htmlBody.length : 0,
                bodyPreview: commentBody ? commentBody.substring(0, 200) + '...' : '[no plain body]',
                htmlBodyPreview: htmlBody ? htmlBody.substring(0, 300) + '...' : '[no html body]',
                authorId: comment.author_id
            });

            // Debug: Log current phrase settings
            RUMILogger.debug('COMMENT', `Checking ${rumiEnhancement.pendingTriggerPhrases.length} phrases. Enabled array length: ${rumiEnhancement.enabledPendingPhrases?.length || 'undefined'}`);
            if (rumiEnhancement.enabledPendingPhrases) {
                const enabledCount = rumiEnhancement.enabledPendingPhrases.filter(enabled => enabled).length;
                const disabledCount = rumiEnhancement.enabledPendingPhrases.length - enabledCount;
                RUMILogger.debug('COMMENT', `Phrase status: ${enabledCount} enabled, ${disabledCount} disabled`);
            }

            // Check for trigger phrases (case-insensitive exact match)
            for (let phraseIndex = 0; phraseIndex < rumiEnhancement.pendingTriggerPhrases.length; phraseIndex++) {
                const phrase = rumiEnhancement.pendingTriggerPhrases[phraseIndex];
                const isEnabled = !rumiEnhancement.enabledPendingPhrases || rumiEnhancement.enabledPendingPhrases[phraseIndex] !== false;

                RUMILogger.debug('COMMENT', `Phrase ${phraseIndex + 1}: ${isEnabled ? 'ENABLED' : 'DISABLED'} - "${phrase.substring(0, 50)}..."`);

                // Skip disabled phrases
                if (rumiEnhancement.enabledPendingPhrases && !rumiEnhancement.enabledPendingPhrases[phraseIndex]) {
                    RUMILogger.debug('COMMENT', `Skipping disabled phrase ${phraseIndex + 1}`);
                    continue;
                }
                let foundMatch = false;
                let matchType = '';
                let matchDetails = '';

                // Method 1: Check in plain text content (existing behavior)
                if (commentBody && commentBody.toLowerCase().includes(phrase.toLowerCase())) {
                    foundMatch = true;
                    matchType = 'text';
                    matchDetails = 'Direct text match in plain body';
                }

                // Method 1b: Check in HTML body content
                if (!foundMatch && htmlBody && htmlBody.toLowerCase().includes(phrase.toLowerCase())) {
                    foundMatch = true;
                    matchType = 'html-text';
                    matchDetails = 'Direct text match in HTML body';
                }

                // For URL phrases, try multiple HTML matching strategies
                if (!foundMatch && phrase.startsWith('http')) {
                    const escapedPhrase = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

                    // Method 2: Check for URLs embedded in HTML hyperlinks in HTML body
                    // Pattern: href="URL" or href='URL'
                    if (htmlBody) {
                        const hrefPattern = new RegExp(`href=['"]([^'"]*${escapedPhrase}[^'"]*?)['"]`, 'i');
                        const hrefMatch = htmlBody.match(hrefPattern);

                        if (hrefMatch) {
                            foundMatch = true;
                            matchType = 'href';
                            matchDetails = `Found in href: ${hrefMatch[1]}`;
                        }
                    }

                    // Method 3: Check for URLs with @ prefix (like @https://...)
                    if (!foundMatch) {
                        const atPrefixPattern = new RegExp(`@${escapedPhrase}`, 'i');
                        if ((commentBody && commentBody.match(atPrefixPattern)) || (htmlBody && htmlBody.match(atPrefixPattern))) {
                            foundMatch = true;
                            matchType = '@prefix';
                            matchDetails = 'Found with @ prefix';
                        }
                    }

                    // Method 4: Check for URLs in any HTML attribute
                    if (!foundMatch && htmlBody) {
                        const attrPattern = new RegExp(`\\w+=['"]([^'"]*${escapedPhrase}[^'"]*?)['"]`, 'i');
                        const attrMatch = htmlBody.match(attrPattern);

                        if (attrMatch) {
                            foundMatch = true;
                            matchType = 'attribute';
                            matchDetails = `Found in attribute: ${attrMatch[1]}`;
                        }
                    }

                    // Method 5: Check for URL in data attributes or other non-standard attributes
                    if (!foundMatch && htmlBody) {
                        const dataAttrPattern = new RegExp(`data-[\\w-]+=['"]([^'"]*${escapedPhrase}[^'"]*?)['"]`, 'i');
                        const dataAttrMatch = htmlBody.match(dataAttrPattern);

                        if (dataAttrMatch) {
                            foundMatch = true;
                            matchType = 'data-attribute';
                            matchDetails = `Found in data attribute: ${dataAttrMatch[1]}`;
                        }
                    }

                    // Method 6: Partial domain matching for cases where full URL might be truncated
                    if (!foundMatch) {
                        // Extract domain from phrase for partial matching
                        const urlMatch = phrase.match(/https?:\/\/([^\/]+)/);
                        if (urlMatch) {
                            const domain = urlMatch[1];
                            const domainPattern = new RegExp(domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
                            if ((commentBody && commentBody.match(domainPattern)) || (htmlBody && htmlBody.match(domainPattern))) {
                                foundMatch = true;
                                matchType = 'domain';
                                matchDetails = `Found domain match: ${domain}`;
                            }
                        }
                    }

                    // Debug logging for URL phrases
                    if (phrase === 'https://uber.lighthouse-cloud.com') {
                        RUMILogger.info('COMMENT', `Detailed URL matching for lighthouse-cloud.com:`, {
                            foundMatch,
                            matchType,
                            matchDetails,
                            commentBodySnippet: commentBody ? commentBody.substring(0, 300) : '[no plain body]',
                            htmlBodySnippet: htmlBody ? htmlBody.substring(0, 500) : '[no html body]'
                        });
                    }
                }

                if (foundMatch) {
                    // NEW REQUIREMENT: Check if comment contains "Careem Actions Required on Rider" - if so, exclude from pending
                    const careemExclusionPhrase = "Careem Actions Required on Rider";
                    const containsCareemExclusion = (commentBody && commentBody.toLowerCase().includes(careemExclusionPhrase.toLowerCase())) ||
                                                  (htmlBody && htmlBody.toLowerCase().includes(careemExclusionPhrase.toLowerCase()));

                    if (containsCareemExclusion) {
                        RUMILogger.info('COMMENT', `Found matching phrase (${matchType}) but comment also contains "${careemExclusionPhrase}" - excluding from pending`, {
                            phrase: phrase.substring(0, 50) + '...',
                            commentId: comment.id,
                            authorId: comment.author_id,
                            matchType: matchType,
                            matchDetails: matchDetails,
                            exclusionReason: 'Contains Careem Actions Required on Rider'
                        });
                        continue; // Continue checking other phrases
                    }

                    // NEW REQUIREMENT: Ensure trigger phrases are NOT found in comments from author 35067366305043
                    if (comment.author_id == 35067366305043) {
                        RUMILogger.info('COMMENT', `Found matching phrase (${matchType}) but it's from author 35067366305043 (trigger phrases should not be in their comments) - skipping`, {
                            phrase: phrase.substring(0, 50) + '...',
                            commentId: comment.id,
                            authorId: comment.author_id,
                            matchType: matchType,
                            matchDetails: matchDetails
                        });
                        continue; // Continue checking other phrases
                    }

                    // Check if the comment is from the required author (34980896869267)
                    if (comment.author_id != 34980896869267) {
                        RUMILogger.info('COMMENT', `Found matching phrase (${matchType}) but author ${comment.author_id} is not the required author (34980896869267) - skipping`, {
                            phrase: phrase.substring(0, 50) + '...',
                            commentId: comment.id,
                            authorId: comment.author_id,
                            matchType: matchType,
                            matchDetails: matchDetails
                        });
                        continue; // Continue checking other phrases
                    }

                    RUMILogger.info('COMMENT', `Found matching phrase (${matchType}) from required author: "${phrase.substring(0, 50)}..."`, {
                        authorId: comment.author_id,
                        commentId: comment.id,
                        matchType: matchType,
                        matchDetails: matchDetails
                    });
                    return { matches: true, phrase, comment };
                }
            }

            RUMILogger.debug('COMMENT', 'No matching phrases found from required author');
            return { matches: false, phrase: null, comment };
        },

        // Helper function to check if any comment in the ticket is from the required author (35067366305043)
        // AND contains either "Incident type" or "Customer words"
        // This is used as an additional condition for pending tickets
        hasCommentFromRequiredAuthor(comments, requiredAuthorId = 35067366305043) {
            if (!comments || comments.length === 0) {
                return false;
            }

            const requiredPhrases = ["Incident type", "Customer words"];

            for (const comment of comments) {
                if (comment.author_id == requiredAuthorId) {
                    const commentBody = comment.body || '';
                    const htmlBody = comment.html_body || '';

                    // Check if the comment contains either "Incident type" or "Customer words"
                    let containsRequiredPhrase = false;
                    let matchedPhrase = '';

                    for (const phrase of requiredPhrases) {
                        if ((commentBody && commentBody.toLowerCase().includes(phrase.toLowerCase())) ||
                            (htmlBody && htmlBody.toLowerCase().includes(phrase.toLowerCase()))) {
                            containsRequiredPhrase = true;
                            matchedPhrase = phrase;
                            break;
                        }
                    }

                    if (containsRequiredPhrase) {
                        RUMILogger.debug('COMMENT', `Found qualifying comment from required author ${requiredAuthorId} containing "${matchedPhrase}"`, {
                            commentId: comment.id,
                            authorId: comment.author_id,
                            created: comment.created_at,
                            matchedPhrase: matchedPhrase
                        });
                        return true;
                    } else {
                        RUMILogger.debug('COMMENT', `Found comment from required author ${requiredAuthorId} but it doesn't contain required phrases ("Incident type" or "Customer words")`, {
                            commentId: comment.id,
                            authorId: comment.author_id,
                            created: comment.created_at,
                            bodyPreview: commentBody.substring(0, 100) + '...'
                        });
                    }
                }
            }

            RUMILogger.debug('COMMENT', `No qualifying comments found from required author ${requiredAuthorId} with required phrases`);
            return false;
        }
    };

    // ============================================================================
    // RUMI ENHANCEMENT - SOLVED TICKET ANALYSIS
    // ============================================================================
    //
    // Handles specific logic for tickets with the solved message pattern:
    // 1. If latest comment is from 34980896869267 with solved message: Set to solved, assign to 41942034052755
    // 2. If latest comment is from 34980896869267 and is private (public: false), check previous comment from same author for solved trigger: Set to solved, assign to 41942034052755
    // 3. If latest comment is from end-user and previous agent comment (from 34980896869267) contains solved message: Set to pending, assign to 34980896869267
    //
    const RUMISolvedAnalyzer = {

        async analyzeSolvedPattern(comments) {
            if (!comments || comments.length === 0) {
                RUMILogger.debug('SOLVED', 'No comments to analyze for solved pattern');
                return { matches: false, action: null };
            }

            // Get latest comment (first in desc order)
            const latestComment = comments[0];
            const commentBody = latestComment.body || '';
            const htmlBody = latestComment.html_body || '';

            RUMILogger.debug('SOLVED', `Analyzing latest comment for solved pattern`, {
                commentId: latestComment.id,
                author: latestComment.author_id,
                created: latestComment.created_at
            });

            try {
                // Get the author details to check their role
                const authorDetails = await RUMIZendeskAPI.getUserDetails(latestComment.author_id);
                const authorRole = authorDetails.role;

                RUMILogger.debug('SOLVED', `Latest comment author role: ${authorRole}`, {
                    userId: latestComment.author_id,
                    userName: authorDetails.name,
                    role: authorRole
                });

                // Case 1: Latest comment is from 34980896869267 with solved message
                if (latestComment.author_id == 34980896869267) {
                    const matchedPhrase = this.containsSolvedMessage(commentBody) || this.containsSolvedMessage(htmlBody);
                    if (matchedPhrase) {
                        RUMILogger.info('SOLVED', `Found solved message from user 34980896869267 - ticket should be set to solved and assigned to 41942034052755`);
                        return {
                            matches: true,
                            action: 'set_solved',
                            assignee: 41942034052755,
                            status: 'solved',
                            reason: 'Agent posted solved message',
                            phrase: matchedPhrase
                        };
                    }

                    // New Case: Latest comment is from 34980896869267 and is private (public: false)
                    // Check if the previous comment from same author has a solved trigger
                    if (latestComment.public === false) {
                        RUMILogger.debug('SOLVED', 'Latest comment from 34980896869267 is private, checking previous comment from same author for solved trigger');

                        // Look for the previous comment from the same author (34980896869267)
                        for (let i = 1; i < comments.length; i++) {
                            const comment = comments[i];

                            if (comment.author_id == 34980896869267) {
                                const prevCommentBody = comment.body || '';
                                const prevHtmlBody = comment.html_body || '';

                                const matchedPhrase = this.containsSolvedMessage(prevCommentBody) || this.containsSolvedMessage(prevHtmlBody);
                                if (matchedPhrase) {
                                    RUMILogger.info('SOLVED', `Found solved message in previous comment from 34980896869267 after private comment - ticket should be set to solved and assigned to 41942034052755`);
                                    return {
                                        matches: true,
                                        action: 'set_solved_after_private',
                                        assignee: 41942034052755,
                                        status: 'solved',
                                        reason: 'Agent posted private comment after solved message',
                                        phrase: matchedPhrase,
                                        privateCommentId: latestComment.id,
                                        solvedCommentId: comment.id
                                    };
                                }

                                // Found previous comment from same author but no solved trigger, stop searching
                                RUMILogger.debug('SOLVED', `Found previous comment from 34980896869267 without solved message, stopping search`);
                                break;
                            }
                        }
                    }
                }

                // Case 2: Latest comment is from end-user, check previous agent comments
                if (authorRole === 'end-user') {
                    RUMILogger.info('SOLVED', 'Latest comment is from end-user, checking previous agent comments for solved message');

                    // Start from index 1 (skip the latest end-user comment)
                    for (let i = 1; i < comments.length; i++) {
                        const comment = comments[i];

                        try {
                            // Get this comment author's role
                            const commentAuthor = await RUMIZendeskAPI.getUserDetails(comment.author_id);
                            const commentAuthorRole = commentAuthor.role;

                            RUMILogger.debug('SOLVED', `Checking comment ${i + 1} from ${commentAuthorRole}`, {
                                commentId: comment.id,
                                authorId: comment.author_id,
                                authorName: commentAuthor.name,
                                role: commentAuthorRole
                            });

                            // If it's from user 34980896869267 (agent), check for solved message
                            if (comment.author_id == 34980896869267 && (commentAuthorRole === 'agent' || commentAuthorRole === 'admin')) {
                                const prevCommentBody = comment.body || '';
                                const prevHtmlBody = comment.html_body || '';

                                const matchedPhrase = this.containsSolvedMessage(prevCommentBody) || this.containsSolvedMessage(prevHtmlBody);
                                if (matchedPhrase) {
                                    RUMILogger.info('SOLVED', `Found solved message in previous agent comment - ticket should be set to pending and assigned to 34980896869267 due to end-user reply`);
                                    return {
                                        matches: true,
                                        action: 'set_pending_after_solved',
                                        assignee: 34980896869267,
                                        status: 'pending',
                                        reason: 'End-user replied to solved message',
                                        agentCommentId: comment.id,
                                        phrase: matchedPhrase
                                    };
                                }

                                // Found an agent comment without solved message, stop searching
                                RUMILogger.debug('SOLVED', `Found agent comment without solved message, stopping search`);
                                break;
                            }

                            // If it's another end-user comment, continue searching backwards
                            if (commentAuthorRole === 'end-user') {
                                RUMILogger.debug('SOLVED', `Comment ${i + 1} is also from end-user, continuing search`);
                                continue;
                            }

                            // If it's from a different agent, stop searching
                            if (commentAuthorRole === 'agent' || commentAuthorRole === 'admin') {
                                RUMILogger.debug('SOLVED', `Found comment from different agent (${comment.author_id}), stopping search`);
                                break;
                            }
                        } catch (userError) {
                            RUMILogger.warn('SOLVED', `Failed to get user details for comment author ${comment.author_id}`, userError);
                            continue;
                        }
                    }
                }

                RUMILogger.debug('SOLVED', 'No solved message pattern found');
                return { matches: false, action: null };

            } catch (error) {
                RUMILogger.error('SOLVED', `Failed to analyze solved pattern for latest comment author ${latestComment.author_id}`, error);
                return { matches: false, action: null };
            }
        },

        containsSolvedMessage(text) {
            if (!text) return false;

            // Ensure solved phrase array is initialized
            if (!rumiEnhancement.enabledSolvedPhrases) {
                rumiEnhancement.enabledSolvedPhrases = new Array(rumiEnhancement.solvedTriggerPhrases.length).fill(true);
                RUMILogger.debug('SOLVED', 'Initialized enabledSolvedPhrases array');
            }

            // Check if the text contains any of the solved trigger phrases (case-insensitive)
            const textLower = text.toLowerCase();
            for (let phraseIndex = 0; phraseIndex < rumiEnhancement.solvedTriggerPhrases.length; phraseIndex++) {
                const phrase = rumiEnhancement.solvedTriggerPhrases[phraseIndex];

                // Skip disabled phrases
                if (rumiEnhancement.enabledSolvedPhrases && !rumiEnhancement.enabledSolvedPhrases[phraseIndex]) {
                    RUMILogger.debug('SOLVED', `Skipping disabled solved phrase ${phraseIndex + 1}: "${phrase.substring(0, 50)}..."`);
                    continue;
                }

                if (textLower.includes(phrase.toLowerCase())) {
                    return phrase; // Return the matched phrase instead of just true
                }
            }
            return false;
        }
    };

    // ============================================================================
    // RUMI ENHANCEMENT - TICKET PROCESSING & MONITORING
    // ============================================================================

    const RUMITicketProcessor = {
        // Helper function to check if ticket should be reprocessed based on status changes
        shouldReprocessTicket(ticketId, currentStatus) {
            const history = rumiEnhancement.ticketStatusHistory.get(ticketId);

            if (!history) {
                // First time seeing this ticket
                return true;
            }

            if (history.status !== currentStatus) {
                // Status changed since last processing - allow reprocessing
                RUMILogger.debug('PROCESS', `Ticket ${ticketId} status changed: ${history.status} → ${currentStatus}`);
                return true;
            }

            // Same status, check if it was recently processed (avoid spam)
            const timeSinceLastProcess = Date.now() - history.lastProcessed;
            const minWaitTime = 5 * 60 * 1000; // 5 minutes minimum between same-status processing

            if (timeSinceLastProcess < minWaitTime) {
                RUMILogger.debug('PROCESS', `Ticket ${ticketId} processed too recently for same status (${Math.round(timeSinceLastProcess/1000)}s ago)`);
                return false;
            }

            return true;
        },

        // Update ticket status history
        updateTicketHistory(ticketId, currentStatus, processed = false) {
            rumiEnhancement.ticketStatusHistory.set(ticketId, {
                status: currentStatus,
                lastProcessed: Date.now(),
                processed: processed
            });
        },

        async processTicket(ticketId, viewName) {
            // Handle both ticket object and ticket ID
            if (typeof ticketId === 'object' && ticketId.id) {
                ticketId = ticketId.id;
            }

            if (!ticketId) {
                RUMILogger.error('PROCESS', `Invalid ticket ID provided: ${ticketId}`);
                return { processed: false, reason: 'Invalid ticket ID' };
            }

            RUMILogger.info('Starting ticket analysis', ticketId);

            try {
                // First check for HALA provider tag (highest priority)
                const halaCheck = await checkTicketForHalaTag(ticketId);
                if (halaCheck.hasHalaTag) {
                    // Check if RTA operations are enabled
                    if (!rumiEnhancement.operationModes.rta) {
                        RUMILogger.info('PROCESS', `RTA operations disabled - skipping HALA ticket ${ticketId}`);
                        return { processed: false, reason: 'RTA operations disabled' };
                    }
                    RUMILogger.info('Found HALA provider tag', ticketId);

                    // Check if we should reprocess this HALA ticket
                    const currentStatus = halaCheck.ticketData.status;
                    if (!this.shouldReprocessTicket(ticketId, currentStatus)) {
                        this.updateTicketHistory(ticketId, currentStatus, false);
                        return { processed: false, reason: 'HALA ticket recently processed or no status change' };
                    }

                    try {
                        await assignHalaTicketToGroup(ticketId);

                        // Update ticket status history to record successful HALA processing
                        this.updateTicketHistory(ticketId, 'rta', true);

                        // Determine if this is automatic (monitoring) or manual (testing) processing
                        const isAutomatic = rumiEnhancement.isMonitoring && viewName !== 'Manual Testing';

                        const ticketData = {
                            id: ticketId,
                            action: 'RTA Assignment',
                            status: 'rta',
                            assignee: '34980896869267',
                            reason: 'HALA provider tag detected',
                            viewName: viewName,
                            timestamp: new Date().toISOString(),
                            previousStatus: halaCheck.ticketData.status,
                            processType: isAutomatic ? 'automatic' : 'manual'
                        };

                        rumiEnhancement.processedHistory.push(ticketData);

                        // Check for duplicates in RTA tickets
                        const existingRtaIndex = rumiEnhancement.rtaTickets.findIndex(t => t.id === ticketId);
                        if (existingRtaIndex !== -1) {
                            rumiEnhancement.rtaTickets[existingRtaIndex] = ticketData;
                        } else {
                            rumiEnhancement.rtaTickets.push(ticketData);
                        }

                        // Add to categorized arrays based on process type
                        const categoryArray = isAutomatic ? rumiEnhancement.automaticTickets.rta : rumiEnhancement.manualTickets.rta;
                        const categoryIndex = categoryArray.findIndex(t => t.id === ticketId);
                        if (categoryIndex !== -1) {
                            categoryArray[categoryIndex] = ticketData;
                        } else {
                            categoryArray.push(ticketData);
                        }

                        rumiEnhancement.processedTickets.add(ticketId);

                // Auto-save processed tickets
                RUMIStorage.saveProcessedTickets();
                RUMIStorage.saveTicketHistory();

                updateProcessedTicketsDisplay();

                        return {
                            processed: true,
                            reason: 'HALA provider tag - assigned to RTA group',
                            action: 'RTA Assignment'
                        };
                    } catch (assignError) {
                        RUMILogger.error('PROCESS', `Failed to assign HALA ticket ${ticketId} to RTA group`, assignError);
                        return {
                            processed: false,
                            reason: 'HALA assignment failed',
                            error: assignError.message
                        };
                    }
                }

                // Get ticket comments for regular processing
                const comments = await RUMIZendeskAPI.getTicketComments(ticketId);

                // First check for solved message patterns (higher priority)
                const solvedAnalysis = await RUMISolvedAnalyzer.analyzeSolvedPattern(comments);

                if (solvedAnalysis.matches) {
                    // Check if solved operations are enabled
                    if (!rumiEnhancement.operationModes.solved) {
                        RUMILogger.info('PROCESS', `Solved operations disabled - skipping ticket ${ticketId}`);
                        return { processed: false, reason: 'Solved operations disabled' };
                    }

                    RUMILogger.ticketProcessed('SOLVED PATTERN', ticketId, `Action: ${solvedAnalysis.action}`);

                    // Get current ticket status before updating
                    let currentStatus = 'unknown';
                    try {
                        const ticketDetails = await RUMIAPIManager.makeRequest(`/api/v2/tickets/${ticketId}.json`);
                        currentStatus = ticketDetails.ticket?.status || 'unknown';
                        RUMILogger.debug('PROCESS', `Current ticket status: ${currentStatus}`);

                        // Check if we should reprocess this ticket based on status history
                        if (!this.shouldReprocessTicket(ticketId, currentStatus)) {
                            this.updateTicketHistory(ticketId, currentStatus, false);
                            return { processed: false, reason: 'Recently processed or no status change' };
                        }
                    } catch (error) {
                        RUMILogger.warn('PROCESS', `Could not fetch ticket status for ${ticketId}, proceeding anyway`, error);
                    }

                    // Handle the solved pattern action
                    const result = await RUMIZendeskAPI.updateTicketWithAssignee(
                        ticketId,
                        solvedAnalysis.status,
                        solvedAnalysis.assignee,
                        viewName
                    );

                    // Track processed ticket
                    rumiEnhancement.processedTickets.add(ticketId);

                    // Update ticket status history to record successful processing
                    this.updateTicketHistory(ticketId, solvedAnalysis.status, true);

                    const ticketData = {
                        id: ticketId,
                        action: solvedAnalysis.action,
                        status: solvedAnalysis.status,
                        assignee: solvedAnalysis.assignee,
                        reason: solvedAnalysis.reason,
                        viewName: viewName,
                        timestamp: new Date().toISOString(),
                        previousStatus: currentStatus
                    };

                    rumiEnhancement.processedHistory.push(ticketData);

                    // Determine if this is automatic (monitoring) or manual (testing) processing
                    const isAutomatic = rumiEnhancement.isMonitoring && viewName !== 'Manual Testing';
                    ticketData.processType = isAutomatic ? 'automatic' : 'manual';

                    // Add to appropriate category with deduplication
                    if (solvedAnalysis.status === 'solved') {
                        // Add to legacy array for backward compatibility
                        const existingIndex = rumiEnhancement.solvedTickets.findIndex(t => t.id === ticketId);
                        if (existingIndex !== -1) {
                            rumiEnhancement.solvedTickets[existingIndex] = ticketData;
                        } else {
                            rumiEnhancement.solvedTickets.push(ticketData);
                        }

                        // Add to new categorized arrays
                        const categoryArray = isAutomatic ? rumiEnhancement.automaticTickets.solved : rumiEnhancement.manualTickets.solved;
                        const categoryIndex = categoryArray.findIndex(t => t.id === ticketId);
                        if (categoryIndex !== -1) {
                            categoryArray[categoryIndex] = ticketData;
                        } else {
                            categoryArray.push(ticketData);
                        }
                    } else if (solvedAnalysis.assignee === '34980896869267') {
                        // RTA (Hala taxi rides) - assigned to specific user
                        const existingIndex = rumiEnhancement.rtaTickets.findIndex(t => t.id === ticketId);
                        if (existingIndex !== -1) {
                            rumiEnhancement.rtaTickets[existingIndex] = ticketData;
                        } else {
                            rumiEnhancement.rtaTickets.push(ticketData);
                        }

                        // Add to new categorized arrays
                        const categoryArray = isAutomatic ? rumiEnhancement.automaticTickets.rta : rumiEnhancement.manualTickets.rta;
                        const categoryIndex = categoryArray.findIndex(t => t.id === ticketId);
                        if (categoryIndex !== -1) {
                            categoryArray[categoryIndex] = ticketData;
                        } else {
                            categoryArray.push(ticketData);
                        }
                    } else {
                        const existingIndex = rumiEnhancement.pendingTickets.findIndex(t => t.id === ticketId);
                        if (existingIndex !== -1) {
                            rumiEnhancement.pendingTickets[existingIndex] = ticketData;
                        } else {
                            rumiEnhancement.pendingTickets.push(ticketData);
                        }

                        // Add to new categorized arrays
                        const categoryArray = isAutomatic ? rumiEnhancement.automaticTickets.pending : rumiEnhancement.manualTickets.pending;
                        const categoryIndex = categoryArray.findIndex(t => t.id === ticketId);
                        if (categoryIndex !== -1) {
                            categoryArray[categoryIndex] = ticketData;
                        } else {
                            categoryArray.push(ticketData);
                        }
                    }

                    // Auto-save processed tickets
                    RUMIStorage.saveProcessedTickets();
                    RUMIStorage.saveTicketHistory();

                    RUMILogger.ticketProcessed('COMPLETED', ticketId, `${solvedAnalysis.action} - Status: ${solvedAnalysis.status}`);
                    return { processed: true, action: solvedAnalysis.action, result };
                }

                // Fall back to regular pending analysis
                const analysis = await RUMICommentAnalyzer.analyzeLatestComment(comments);

                if (!analysis.matches) {
                    RUMILogger.ticketSkipped('No trigger phrases found', ticketId);
                    return { processed: false, reason: 'No matching comment or solved pattern' };
                }

                // Check if pending operations are enabled
                RUMILogger.debug('PROCESS', `Operation modes check - Pending: ${rumiEnhancement.operationModes.pending}, Solved: ${rumiEnhancement.operationModes.solved}, RTA: ${rumiEnhancement.operationModes.rta}`);
                if (!rumiEnhancement.operationModes.pending) {
                    RUMILogger.info('PROCESS', `Pending operations disabled - skipping ticket ${ticketId}`);
                    return { processed: false, reason: 'Pending operations disabled' };
                }

                // Get current ticket status before updating
                RUMILogger.debug('PROCESS', `Ticket ${ticketId} matches criteria - getting current status`);

                let currentStatus = 'unknown';
                try {
                    const ticketDetails = await RUMIAPIManager.makeRequest(`/api/v2/tickets/${ticketId}.json`);
                    currentStatus = ticketDetails.ticket?.status || 'unknown';
                    RUMILogger.debug('PROCESS', `Current ticket status: ${currentStatus}`);

                    // Check if we should reprocess this ticket based on status history
                    if (!this.shouldReprocessTicket(ticketId, currentStatus)) {
                        this.updateTicketHistory(ticketId, currentStatus, false);
                        return { processed: false, reason: 'Recently processed or no status change' };
                    }

                    // Skip if already pending (but still update history)
                    if (currentStatus === 'pending') {
                        RUMILogger.ticketSkipped('Already pending status', ticketId);
                        this.updateTicketHistory(ticketId, currentStatus, false);
                        return { processed: false, reason: 'Already pending' };
                    }
                } catch (error) {
                    RUMILogger.warn('PROCESS', `Could not fetch ticket status for ${ticketId}, proceeding anyway`, error);
                }

                // Update ticket status (pass viewName for Egypt SSOC special handling)
                const result = await RUMIZendeskAPI.updateTicketStatus(ticketId, 'pending', viewName);

                // Track processed ticket
                rumiEnhancement.processedTickets.add(ticketId);

                // Update ticket status history to record successful processing
                this.updateTicketHistory(ticketId, 'pending', true);

                // Determine if this is automatic (monitoring) or manual (testing) processing
                const isAutomatic = rumiEnhancement.isMonitoring && viewName !== 'Manual Testing';

                const ticketData = {
                    id: ticketId,
                    timestamp: new Date().toISOString(),
                    viewName,
                    phrase: analysis.phrase, // Store full phrase without truncation
                    previousStatus: currentStatus,
                    triggerReason: analysis.triggerReason || 'direct-match',
                    triggerCommentId: analysis.comment?.id,
                    latestCommentId: analysis.latestComment?.id,
                    status: 'pending',
                    processType: isAutomatic ? 'automatic' : 'manual'
                };

                // Check for duplicates before adding to prevent multiple entries for same ticket (legacy)
                const existingPendingIndex = rumiEnhancement.pendingTickets.findIndex(t => t.id === ticketId);
                if (existingPendingIndex !== -1) {
                    // Update existing entry instead of adding duplicate
                    rumiEnhancement.pendingTickets[existingPendingIndex] = ticketData;
                    RUMILogger.debug('Updated existing pending ticket entry', ticketId);
                } else {
                    rumiEnhancement.pendingTickets.push(ticketData);
                }

                // Add to new categorized arrays
                const categoryArray = isAutomatic ? rumiEnhancement.automaticTickets.pending : rumiEnhancement.manualTickets.pending;
                const categoryIndex = categoryArray.findIndex(t => t.id === ticketId);
                if (categoryIndex !== -1) {
                    categoryArray[categoryIndex] = ticketData;
                } else {
                    categoryArray.push(ticketData);
                }

                rumiEnhancement.processedHistory.push(ticketData);

                // Auto-save processed tickets
                RUMIStorage.saveProcessedTickets();
                RUMIStorage.saveTicketHistory();

                // Update the UI to show the new processed ticket
                updateProcessedTicketsDisplay();

                RUMILogger.ticketProcessed('SET TO PENDING', ticketId, `${currentStatus} → pending | Phrase: "${analysis.phrase.substring(0, 50)}..."`);

                // Update UI if panel is open
                updateRUMIEnhancementUI();

                return { processed: true, result };

            } catch (error) {
                RUMILogger.error('PROCESS', `Failed to process ticket ${ticketId}`, error);
                throw error;
            }
        }
    };

    const RUMIViewMonitor = {
        async establishBaseline() {
            RUMILogger.info('MONITOR', 'Establishing baseline for selected views');

            for (const viewId of rumiEnhancement.selectedViews) {
                try {
                    const tickets = await RUMIZendeskAPI.getViewTickets(viewId);
                    const ticketIds = new Set(tickets.map(t => t.id));
                    rumiEnhancement.baselineTickets.set(viewId, ticketIds);

                    RUMILogger.info('MONITOR', `Baseline established for view ${viewId}: ${ticketIds.size} tickets`);
                } catch (error) {
                    RUMILogger.error('MONITOR', `Failed to establish baseline for view ${viewId}`, error);
                    throw error;
                }
            }
        },

        async checkViews() {
            if (!rumiEnhancement.isMonitoring || rumiEnhancement.selectedViews.size === 0) {
                RUMILogger.debug('MONITOR', `Skipping check - monitoring: ${rumiEnhancement.isMonitoring}, views: ${rumiEnhancement.selectedViews.size}`);
                return;
            }

            // Only log every 10th check to reduce noise
            const checkCount = (this._checkCounter || 0) + 1;
            this._checkCounter = checkCount;

            if (checkCount % 10 === 1) {
                RUMILogger.debug('MONITOR', `Checking ${rumiEnhancement.selectedViews.size} views (check #${checkCount})`);
            }

            rumiEnhancement.lastCheckTime = new Date();

            // Update UI immediately after setting the check time to show real-time updates
            updateRUMIEnhancementUI();

            // Check circuit breaker before starting - but be more tolerant of 429s
            if (rumiEnhancement.consecutiveErrors >= rumiEnhancement.config.CIRCUIT_BREAKER_THRESHOLD) {
                RUMILogger.warn('MONITOR', 'Circuit breaker activated - pausing monitoring for 2 minutes');

                setTimeout(async () => {
                    if (rumiEnhancement.isMonitoring) {
                        RUMILogger.info('MONITOR', 'Attempting to resume monitoring after circuit breaker pause');
                        rumiEnhancement.consecutiveErrors = 0;
                        // Removed auto-increase of check interval - user controls this manually
                        RUMILogger.info('MONITOR', 'Resuming monitoring with current interval setting');
                    }
                }, 120000);
                return;
            }

            // BATCH APPROACH: Like notify extension - make all requests simultaneously
            const viewIds = Array.from(rumiEnhancement.selectedViews);
            const requests = viewIds.map(viewId => this.checkSingleViewBatch(viewId));

            try {
                const results = await Promise.allSettled(requests);
                let hasErrors = false;
                let rateLimitCount = 0;

                results.forEach((result, index) => {
                    const viewId = viewIds[index];

                    if (result.status === 'rejected') {
                        hasErrors = true;
                        const error = result.reason;

                        if (error.message.includes('429')) {
                            rateLimitCount++;
                            RUMILogger.warn('MONITOR', `Rate limit hit for view ${viewId}`);
                        } else {
                            RUMILogger.error('MONITOR', `Error checking view ${viewId}`, error);
                        }
                    }
                });

                // Handle rate limits like notify extension - track but continue
                if (rateLimitCount > 0) {
                    RUMILogger.warn('MONITOR', `Rate limits hit on ${rateLimitCount}/${viewIds.length} views - continuing monitoring`);
                    // Don't count 429s as consecutive errors
                    if (rateLimitCount < viewIds.length) {
                        rumiEnhancement.consecutiveErrors = 0; // Some succeeded
                    }
                } else if (!hasErrors) {
                    // Reset consecutive errors only if no errors at all
                    rumiEnhancement.consecutiveErrors = 0;
                } else {
                    // Only count non-429 errors
                    rumiEnhancement.consecutiveErrors++;
                }

            } catch (error) {
                RUMILogger.error('MONITOR', 'Batch check failed', error);
                rumiEnhancement.consecutiveErrors++;
            }

            // Final UI update at end of monitoring cycle (mainly for API counters and error counts)
            updateRUMIEnhancementUI();
        },

        async checkSingleView(viewId) {
            const tickets = await RUMIZendeskAPI.getViewTickets(viewId);
            const currentTicketIds = new Set(tickets.map(t => t.id));
            const baselineIds = rumiEnhancement.baselineTickets.get(viewId) || new Set();

            // Find new tickets (not in baseline)
            const newTickets = tickets.filter(ticket => !baselineIds.has(ticket.id));

            if (newTickets.length > 0) {
                RUMILogger.info('MONITOR', `Found ${newTickets.length} new tickets in view ${viewId}`);

                const viewName = await this.getViewName(viewId);

                // Process each new ticket
                for (const ticket of newTickets) {
                    if (!rumiEnhancement.processedTickets.has(ticket.id)) {
                        try {
                            await RUMITicketProcessor.processTicket(ticket, viewName);

                            // Small delay between ticket processing
                            await new Promise(resolve => setTimeout(resolve, 500));
                        } catch (error) {
                            RUMILogger.error('MONITOR', `Failed to process new ticket ${ticket.id}`, error);
                        }
                    }
                }
            }
        },

        // Batch version with minimal retry like notify extension
        async checkSingleViewBatch(viewId) {
            RUMILogger.debug('MONITOR', `Starting batch check for view ${viewId}`);
            try {
                // Simple request without aggressive retries - use direct makeRequest
                const response = await RUMIAPIManager.makeRequest(
                    `/api/v2/views/${viewId}/execute.json?per_page=100&sort_by=created_at&sort_order=desc`
                );

                // Handle different response structures
                let ticketData = [];
                if (response.rows && Array.isArray(response.rows)) {
                    ticketData = response.rows;
                } else if (response.tickets && Array.isArray(response.tickets)) {
                    ticketData = response.tickets;
                }

                RUMILogger.debug('MONITOR', `Retrieved ${ticketData.length} tickets from view ${viewId}`);

                const baselineIds = rumiEnhancement.baselineTickets.get(viewId) || new Set();

                // Find new tickets (not in baseline) - be very careful with ID extraction
                const newTickets = [];
                for (const ticket of ticketData) {
                    let ticketId = null;

                    // Try different ways to extract ticket ID
                    if (ticket.id) {
                        ticketId = ticket.id;
                    } else if (ticket.ticket && ticket.ticket.id) {
                        ticketId = ticket.ticket.id;
                    }

                    // Only process if we have a valid ticket ID and it's not in baseline
                    if (ticketId && !baselineIds.has(ticketId)) {
                        newTickets.push({
                            id: ticketId,
                            originalData: ticket
                        });
                    }
                }

                if (newTickets.length > 0) {
                    RUMILogger.monitoringStatus(`Found ${newTickets.length} new tickets: ${newTickets.map(t => t.id).join(', ')}`);

                    const viewName = await this.getViewName(viewId);

                    // Process each new ticket
                    // Removed the processedTickets.has() check since status history handles this better
                    for (const ticket of newTickets) {
                        try {
                            await RUMITicketProcessor.processTicket(ticket.id, viewName);
                            // Update UI immediately after each ticket is processed for real-time display
                            updateProcessedTicketsDisplay();
                            // Small delay between ticket processing
                            await new Promise(resolve => setTimeout(resolve, 500));
                        } catch (error) {
                            RUMILogger.error('MONITOR', `Failed to process ticket ${ticket.id}`, error);
                        }
                    }

                    // Update baseline with current tickets to avoid reprocessing the same "new" tickets
                    // This reduces noise while still allowing reprocessing when tickets change status
                    const currentTicketIds = new Set(ticketData.map(ticket => {
                        // Extract ticket ID safely from different response structures
                        if (ticket.id) return ticket.id;
                        if (ticket.ticket && ticket.ticket.id) return ticket.ticket.id;
                        return null;
                    }).filter(id => id !== null));

                    rumiEnhancement.baselineTickets.set(viewId, currentTicketIds);
                    RUMILogger.debug('MONITOR', `Updated baseline for view ${viewId}: ${currentTicketIds.size} tickets`);
                }

                return { success: true, newTickets: newTickets.length };
            } catch (error) {
                RUMILogger.error('MONITOR', `Batch check failed for view ${viewId}`, error);
                throw error;
            }
        },

        async getViewName(viewId) {
            // Cache view names to avoid repeated API calls
            if (!this._viewNameCache) {
                this._viewNameCache = new Map();
            }

            if (this._viewNameCache.has(viewId)) {
                return this._viewNameCache.get(viewId);
            }

            try {
                const views = await RUMIZendeskAPI.getViews();
                const view = views.find(v => v.id == viewId);
                const name = view ? view.title : `View ${viewId}`;
                this._viewNameCache.set(viewId, name);
                return name;
            } catch (error) {
                RUMILogger.warn('MONITOR', `Failed to get view name for ${viewId}`, error);
                return `View ${viewId}`;
            }
        },

        async startMonitoring() {
            if (rumiEnhancement.isMonitoring) {
                RUMILogger.warn('MONITOR', 'Monitoring already active');
                return false;
            }

            if (rumiEnhancement.selectedViews.size === 0) {
                RUMILogger.error('MONITOR', 'No views selected for monitoring');
                return false;
            }

            // Reset circuit breaker and errors when starting fresh
            rumiEnhancement.consecutiveErrors = 0;
            RUMILogger.info('MONITOR', 'Reset circuit breaker for fresh start');

            try {
                // Validate connectivity
                if (!(await RUMIAPIManager.validateConnectivity())) {
                    throw new Error('API connectivity validation failed');
                }

                // Establish baseline
                await this.establishBaseline();

                // Record session start time
                const now = new Date();
                rumiEnhancement.monitoringStats.currentSessionStart = now;
                rumiEnhancement.monitoringStats.sessionStartTime = now;

                // Start monitoring interval
                rumiEnhancement.isMonitoring = true;
                rumiEnhancement.checkInterval = setInterval(() => {
                    this.checkViews().catch(error => {
                        RUMILogger.error('MONITOR', 'Error in monitoring cycle', error);
                    });
                }, rumiEnhancement.config.CHECK_INTERVAL);

                // Save monitoring stats and log start
                RUMIStorage.saveMonitoringState();
                RUMILogger.monitoringStatus(`Started monitoring ${rumiEnhancement.selectedViews.size} views at ${now.toLocaleTimeString()}`);
                updateRUMIEnhancementUI();

                return true;
            } catch (error) {
                RUMILogger.error('MONITOR', 'Failed to start monitoring', error);
                rumiEnhancement.isMonitoring = false;
                throw error;
            }
        },

        async stopMonitoring() {
            if (!rumiEnhancement.isMonitoring) {
                RUMILogger.warn('Monitoring not active');
                return;
            }

            if (rumiEnhancement.checkInterval) {
                clearInterval(rumiEnhancement.checkInterval);
                rumiEnhancement.checkInterval = null;
            }

            // Record session stop time and duration
            const now = new Date();
            rumiEnhancement.monitoringStats.sessionStopTime = now;

            if (rumiEnhancement.monitoringStats.currentSessionStart) {
                const sessionDuration = now - rumiEnhancement.monitoringStats.currentSessionStart;
                rumiEnhancement.monitoringStats.totalRunningTime += sessionDuration;

                // Add to session history
                rumiEnhancement.monitoringStats.sessionHistory.push({
                    start: rumiEnhancement.monitoringStats.currentSessionStart,
                    stop: now,
                    duration: sessionDuration
                });

                // Keep only last 10 sessions in history
                if (rumiEnhancement.monitoringStats.sessionHistory.length > 10) {
                    rumiEnhancement.monitoringStats.sessionHistory = rumiEnhancement.monitoringStats.sessionHistory.slice(-10);
                }
            }

            rumiEnhancement.monitoringStats.currentSessionStart = null;
            rumiEnhancement.isMonitoring = false;

            // Save monitoring stats and log stop
            RUMIStorage.saveMonitoringState();
            RUMILogger.monitoringStatus(`Stopped monitoring at ${now.toLocaleTimeString()}`);
            updateRUMIEnhancementUI();
        }
    };

    // Field sets for the two visibility states
    const minimalFields = [
        'Tags',
        'Priority',
        'Reason (Quality/GO/Billing)*',
        'Reason (Quality/GO/Billing)',
        'SSOC Reason',
        'Action Taken - Consumer',
        'SSOC incident source'
    ];

    // Check if a field should be visible in the current state
    function isTargetField(field) {
        const label = field.querySelector('label');
        if (!label) return false;

        if (fieldVisibilityState === 'all') {
            // In 'all' state, no fields are considered target fields (all visible)
            return false;
        } else {
            // In 'minimal' state, only show the specified fields
            return minimalFields.some(targetText =>
                label.textContent.trim() === targetText
            );
        }
    }



    // Username management
    function promptForUsername() {
        return new Promise((resolve) => {
            const storedUsername = localStorage.getItem('zendesk_agent_username');
            if (storedUsername && storedUsername.trim()) {
                username = storedUsername.trim();
                console.log(`🔐 Agent name loaded from storage: ${username}`);
                resolve(username);
                return;
            }

            // Try to extract username from current Zendesk session
            const navButton = document.querySelector('button[data-test-id="header-profile-menu-button"]');
            if (navButton) {
                const nameElement = navButton.querySelector('span[data-garden-id="typography.ellipsis"]');
                if (nameElement && nameElement.textContent.trim()) {
                    const name = nameElement.textContent.trim();
                    username = name;
                    localStorage.setItem('zendesk_agent_username', username);
                    console.log(`🔐 Agent name extracted and stored: ${username}`);
                    resolve(username);
                    return;
                }
            }

            // Set default username if automatic extraction fails (no prompt needed)
            username = 'Agent';
            console.log(`🔐 Using default agent name: ${username}`);
            resolve(username);
        });
    }

    // Fast single-attempt dropdown setter
    async function setDropdownFieldValueInstant(field, valueText) {
        try {
            console.log(`⚡ Setting "${valueText}"`);
            if (!field || !valueText) {
                console.warn('❌ Invalid field or valueText:', { field: !!field, valueText });
                return false;
            }

            const input = field.querySelector('input[data-test-id="ticket-field-input"]') ||
                field.querySelector('[role="combobox"] input') ||
                field.querySelector('input');
            if (!input) {
                console.warn('No input found in dropdown field for:', valueText);
                return false;
            }

            // Quick check if already set
            const displayValue = field.querySelector('[title]')?.getAttribute('title') ||
                field.querySelector('.StyledEllipsis-sc-1u4umy-0')?.textContent.trim() ||
                field.querySelector('[data-garden-id="typography.ellipsis"]')?.textContent.trim();

            if (displayValue === valueText) {
                console.log(`✅ "${valueText}" already set`);
                return true;
            }

            // Single attempt: Try manual dropdown interaction only (most reliable)
            const success = await tryManualDropdownSet(field, valueText, 0);
            console.log(`${success ? '✅' : '❌'} "${valueText}" ${success ? 'SUCCESS' : 'FAILED'}`);
            return success;
        } catch (e) {
            console.warn('Dropdown set failed:', e);
            return false;
        }
    }

    // Fast manual dropdown interaction - single attempt
    async function tryManualDropdownSet(field, valueText, retries) {
        try {
            const trigger = field.querySelector('[role="combobox"]') ||
                field.querySelector('input[data-test-id="ticket-field-input"]') ||
                field.querySelector('input');

            if (!trigger) return false;

            // Skip if already processing
            if (trigger.dataset.isProcessing === 'true') {
                return false;
            }

            trigger.dataset.isProcessing = 'true';

            try {
                // Open dropdown
                trigger.focus();
                trigger.click();

                // Quick wait for options
                await new Promise(resolve => setTimeout(resolve, 100));

                // Find and click option
                const options = document.querySelectorAll('[role="option"], [data-test-id="ticket-field-option"]');
                const targetOption = Array.from(options).find(option =>
                    option.textContent.trim() === valueText && option.isConnected
                );

                if (targetOption) {
                    targetOption.click();
                    await new Promise(resolve => setTimeout(resolve, 50));
                    return true;
                } else {
                    trigger.blur();
                    return false;
                }
            } finally {
                trigger.dataset.isProcessing = 'false';
            }
        } catch (e) {
            return false;
        }
    }

    // Set SSOC Reason to "Escalated to Uber"
    async function setSSOCReasonToEscalated(container) {
        const fields = container.children;
        let fieldFound = false;

        for (const field of Array.from(fields)) {
            const label = field.querySelector('label');
            if (label && label.textContent.trim() === 'SSOC Reason') {
                if (fieldFound) {
                    console.log('⚠️ Skipping duplicate SSOC Reason field');
                    continue;
                }
                fieldFound = true;

                // Check if field is already set to the target value
                const currentValue = field.querySelector('[title]')?.getAttribute('title') ||
                    field.querySelector('.StyledEllipsis-sc-1u4umy-0')?.textContent.trim() ||
                    field.querySelector('[data-garden-id="typography.ellipsis"]')?.textContent.trim();

                if (currentValue === 'Escalated to Uber') {
                    console.log(`✅ SSOC Reason already set to target value: "${currentValue}", skipping`);
                    return true;
                }

                try {
                    console.log('📝 Setting SSOC Reason to "Escalated to Uber"...');
                    const success = await setDropdownFieldValueInstant(field, 'Escalated to Uber');
                    console.log(`✅ SSOC Reason result: ${success ? 'SUCCESS' : 'FAILED'}`);
                    return success;
                } catch (error) {
                    console.error('❌ Error setting SSOC Reason:', error);
                    return false;
                }
            }
        }

        console.log('⚠️ SSOC Reason field not found');
        return true;
    }

    // Set Action Taken - Consumer to "Resolved - Escalated to Uber"
    async function setActionTakenConsumer(container) {
        const fields = container.children;
        let fieldFound = false;

        for (const field of Array.from(fields)) {
            const label = field.querySelector('label');
            if (label && label.textContent.trim() === 'Action Taken - Consumer') {
                if (fieldFound) {
                    console.log('⚠️ Skipping duplicate Action Taken - Consumer field');
                    continue;
                }
                fieldFound = true;

                // Check if field is already set to the target value
                const currentValue = field.querySelector('[title]')?.getAttribute('title') ||
                    field.querySelector('.StyledEllipsis-sc-1u4umy-0')?.textContent.trim() ||
                    field.querySelector('[data-garden-id="typography.ellipsis"]')?.textContent.trim();

                if (currentValue === 'Resolved - Escalated to Uber') {
                    console.log(`✅ Action Taken - Consumer already set to target value: "${currentValue}", skipping`);
                    return true;
                }

                try {
                    console.log('📝 Setting Action Taken - Consumer to "Resolved - Escalated to Uber"...');
                    const success = await setDropdownFieldValueInstant(field, 'Resolved - Escalated to Uber');
                    console.log(`✅ Action Taken - Consumer result: ${success ? 'SUCCESS' : 'FAILED'}`);
                    return success;
                } catch (error) {
                    console.error('❌ Error setting Action Taken - Consumer:', error);
                    return false;
                }
            }
        }

        console.log('⚠️ Action Taken - Consumer field not found');
        return true;
    }

    // Set Reason to "Operations related - Invalid tickets/calls (Already resolved / duplicates)"
    async function setReasonToDuplicate(container) {
        const fields = container.children;
        const promises = [];
        let fieldFound = false;

        Array.from(fields).forEach(field => {
            const label = field.querySelector('label');
            if (label && (label.textContent.trim() === 'Reason (Quality/GO/Billing)*' || label.textContent.trim() === 'Reason (Quality/GO/Billing)')) {
                // Prevent processing multiple identical fields
                if (fieldFound) {
                    console.log('⚠️ Skipping duplicate Reason field');
                    return;
                }
                fieldFound = true;

                const currentValue = field.querySelector('[title]')?.getAttribute('title') ||
                    field.querySelector('.StyledEllipsis-sc-1u4umy-0')?.textContent.trim() ||
                    field.querySelector('[data-garden-id="typography.ellipsis"]')?.textContent.trim();

                if (currentValue === 'Operations related - Invalid tickets/calls (Already resolved / duplicates)') {
                    console.log('💡 Reason field already set to Operations related - Invalid tickets/calls (Already resolved / duplicates)');
                    return;
                }

                const promise = setDropdownFieldValueInstant(field, 'Operations related - Invalid tickets/calls (Already resolved / duplicates)');
                promises.push(promise);
            }
        });

        // Wait for all attempts to complete
        const results = await Promise.allSettled(promises);
        const successCount = results.filter(result => result.status === 'fulfilled' && result.value === true).length;

        console.log(`✅ Reason field update completed. ${successCount}/${promises.length} successful.`);
        return promises.length === 0 || successCount > 0;
    }

    // Set Action Taken - Consumer to "Resolved - Escalated to Uber"
    async function setActionTakenConsumerDuplicate(container) {
        const fields = container.children;
        let fieldFound = false;

        for (const field of Array.from(fields)) {
            const label = field.querySelector('label');
            if (label && label.textContent.trim() === 'Action Taken - Consumer') {
                if (fieldFound) {
                    console.log('⚠️ Skipping duplicate Action Taken - Consumer field');
                    continue;
                }
                fieldFound = true;

                // Check if field is already set to the target value
                const currentValue = field.querySelector('[title]')?.getAttribute('title') ||
                    field.querySelector('.StyledEllipsis-sc-1u4umy-0')?.textContent.trim() ||
                    field.querySelector('[data-garden-id="typography.ellipsis"]')?.textContent.trim();

                if (currentValue === 'Resolved - Escalated to Uber') {
                    console.log(`✅ Action Taken - Consumer already set to target value: "${currentValue}", skipping`);
                    return true;
                }

                try {
                    console.log('📝 Setting Action Taken - Consumer to "Resolved - Escalated to Uber"...');
                    const success = await setDropdownFieldValueInstant(field, 'Resolved - Escalated to Uber');
                    console.log(`✅ Action Taken - Consumer result: ${success ? 'SUCCESS' : 'FAILED'}`);
                    return success;
                } catch (error) {
                    console.error('❌ Error setting Action Taken - Consumer:', error);
                    return false;
                }
            }
        }

        console.log('⚠️ Action Taken - Consumer field not found');
        return true;
    }

    // Set SSOC Reason to "Escalated to Uber"
    async function setSSOCReasonToDuplicate(container) {
        const fields = container.children;
        let fieldFound = false;

        for (const field of Array.from(fields)) {
            const label = field.querySelector('label');
            if (label && label.textContent.trim() === 'SSOC Reason') {
                if (fieldFound) {
                    console.log('⚠️ Skipping duplicate SSOC Reason field');
                    continue;
                }
                fieldFound = true;

                // Check if field is already set to the target value
                const currentValue = field.querySelector('[title]')?.getAttribute('title') ||
                    field.querySelector('.StyledEllipsis-sc-1u4umy-0')?.textContent.trim() ||
                    field.querySelector('[data-garden-id="typography.ellipsis"]')?.textContent.trim();

                if (currentValue === 'Escalated to Uber') {
                    console.log(`✅ SSOC Reason already set to target value: "${currentValue}", skipping`);
                    return true;
                }

                try {
                    console.log('📝 Setting SSOC Reason to "Escalated to Uber"...');
                    const success = await setDropdownFieldValueInstant(field, 'Escalated to Uber');
                    console.log(`✅ SSOC Reason result: ${success ? 'SUCCESS' : 'FAILED'}`);
                    return success;
                } catch (error) {
                    console.error('❌ Error setting SSOC Reason:', error);
                    return false;
                }
            }
        }

        console.log('⚠️ SSOC Reason field not found');
        return true;
    }

    // Enhanced dropdown setter with better debugging for SSOC incident source
    async function setSSOCIncidentSourceWithDebug(field, targetValue) {
        try {
            console.log(`⚡ Setting SSOC incident source to "${targetValue}"`);

            const trigger = field.querySelector('[role="combobox"]') ||
                field.querySelector('input[data-test-id="ticket-field-input"]') ||
                field.querySelector('input');

            if (!trigger) {
                console.warn('❌ No trigger found in SSOC incident source field');
                return false;
            }

            // Skip if already processing
            if (trigger.dataset.isProcessing === 'true') {
                console.log('⚠️ Field already being processed, skipping');
                return false;
            }

            trigger.dataset.isProcessing = 'true';

            try {
                // Open dropdown
                console.log('🔓 Opening SSOC incident source dropdown...');
                trigger.focus();
                trigger.click();

                // Wait longer for options to load
                await new Promise(resolve => setTimeout(resolve, 200));

                // Find all available options and log them
                const options = document.querySelectorAll('[role="option"], [data-test-id="ticket-field-option"]');
                console.log(`🔍 Found ${options.length} dropdown options:`);

                const optionTexts = Array.from(options).map(opt => opt.textContent.trim()).filter(text => text);
                console.log('📋 Available options:', optionTexts);

                // Try to find exact match first
                let targetOption = Array.from(options).find(option =>
                    option.textContent.trim() === targetValue && option.isConnected
                );

                // If exact match not found, try variations for Customer Email
                if (!targetOption && targetValue === 'Customer Email') {
                    console.log('🔍 Exact match not found for "Customer Email", trying variations...');

                    const variations = [
                        'Customer Email',
                        'Email',
                        'Customer email',
                        'customer email',
                        'Email - Customer'
                    ];

                    for (const variation of variations) {
                        targetOption = Array.from(options).find(option =>
                            option.textContent.trim() === variation && option.isConnected
                        );
                        if (targetOption) {
                            console.log(`✅ Found match with variation: "${variation}"`);
                            break;
                        }
                    }

                    // Try partial match as last resort
                    if (!targetOption) {
                        targetOption = Array.from(options).find(option =>
                            option.textContent.trim().toLowerCase().includes('email') && option.isConnected
                        );
                        if (targetOption) {
                            console.log(`✅ Found partial match: "${targetOption.textContent.trim()}"`);
                        }
                    }
                }

                if (targetOption) {
                    console.log(`🎯 Clicking option: "${targetOption.textContent.trim()}"`);
                    targetOption.click();
                    await new Promise(resolve => setTimeout(resolve, 100));

                    // Verify the selection
                    const displayValue = field.querySelector('[title]')?.getAttribute('title') ||
                        field.querySelector('.StyledEllipsis-sc-1u4umy-0')?.textContent.trim() ||
                        field.querySelector('[data-garden-id="typography.ellipsis"]')?.textContent.trim();

                    console.log(`📄 Final display value: "${displayValue}"`);
                    trigger.dataset.isProcessing = 'false';

                    const success = displayValue && (displayValue === targetValue || displayValue === targetOption.textContent.trim());
                    console.log(`${success ? '✅' : '❌'} SSOC incident source set ${success ? 'successfully' : 'failed'}`);
                    return success;
                } else {
                    console.warn(`❌ Option "${targetValue}" not found in dropdown`);
                    trigger.blur();
                    trigger.dataset.isProcessing = 'false';
                    return false;
                }
            } finally {
                trigger.dataset.isProcessing = 'false';
            }
        } catch (e) {
            console.error('❌ Error in setSSOCIncidentSourceWithDebug:', e);
            return false;
        }
    }

    // Helper function to check if ticket has exclude_detection tag
    function hasExcludeDetectionTag() {
        const tagElements = document.querySelectorAll('.garden-tag-item, [data-test-id="ticket-system-field-tags-item-selected"] .garden-tag-item');
        const tagTexts = Array.from(tagElements).map(element => element.textContent.trim().toLowerCase());
        return tagTexts.includes('exclude_detection');
    }

    // Set SSOC incident source based on subject
    async function setSSOCIncidentSource(container) {
        // Try multiple selectors to find the subject field
        const subjectSelectors = [
            'input[data-test-id="omni-header-subject"]',
            'input[placeholder="Subject"]',
            'input[aria-label="Subject"]',
            'input[id*="subject"]'
        ];

        let subjectField = null;
        for (const selector of subjectSelectors) {
            subjectField = document.querySelector(selector);
            if (subjectField) break;
        }

        if (!subjectField) {
            console.log('⚠️ Subject field not found - skipping SSOC incident source update');
            return true;
        }

        const subjectText = subjectField.value.trim();
        if (!subjectText) {
            console.log('⚠️ Subject field is empty - skipping SSOC incident source update');
            return true;
        }

        // Check for exclude_detection tag first - this overrides all other rules
        const hasExcludeTag = hasExcludeDetectionTag();
        let targetValue, ruleMatched;

        if (hasExcludeTag) {
            // Exception rule: exclude_detection tag always means Customer Email
            targetValue = 'Customer Email';
            ruleMatched = 'exclude_detection tag';
            console.log('🏷️ Found exclude_detection tag - forcing Customer Email');
        } else {
            // Normal rules apply
            targetValue = 'Voice Care'; // Default value
            ruleMatched = 'Default';

            const subjectLower = subjectText.toLowerCase();

            // Check for "dispute" or "contact us" -> Customer Email
            if (subjectLower.includes('dispute')) {
                targetValue = 'Customer Email';
                ruleMatched = 'Dispute';
            } else if (subjectLower.includes('contact us')) {
                targetValue = 'Customer Email';
                ruleMatched = 'Contact Us';
            }
        }

        console.log(`📋 Subject matched rule "${ruleMatched}": ${subjectText}`);
        console.log(`🎯 Target SSOC incident source: ${targetValue}`);

        // Find the SSOC incident source field in the current container
        const fields = container.children;
        let ssocIncidentSourceField = null;

        for (const field of Array.from(fields)) {
            const label = field.querySelector('label');
            if (label && label.textContent.trim() === 'SSOC incident source') {
                ssocIncidentSourceField = field;
                break;
            }
        }

        if (!ssocIncidentSourceField) {
            console.log('⚠️ SSOC incident source field not found in current form');
            return true;
        }

        // Check if already set to the target value or any other non-empty value
        const currentValue = ssocIncidentSourceField.querySelector('[title]')?.getAttribute('title') ||
            ssocIncidentSourceField.querySelector('.StyledEllipsis-sc-1u4umy-0')?.textContent.trim() ||
            ssocIncidentSourceField.querySelector('[data-garden-id="typography.ellipsis"]')?.textContent.trim();

        if (currentValue === targetValue) {
            console.log(`💡 SSOC incident source already set to "${targetValue}"`);
            return true;
        }

        // Check if field is already filled with a different value
        if (currentValue && currentValue !== 'Select an option...' && currentValue !== '-') {
            console.log(`✅ SSOC incident source already set to: "${currentValue}", skipping automatic update`);
            return true;
        }

        // Set the field to the target value using enhanced debug function
        try {
            console.log(`📝 Setting SSOC incident source to "${targetValue}"...`);
            const success = await setSSOCIncidentSourceWithDebug(ssocIncidentSourceField, targetValue);
            console.log(`✅ SSOC incident source final result: ${success ? 'SUCCESS' : 'FAILED'}`);
            return success;
        } catch (error) {
            console.error('❌ Error setting SSOC incident source:', error);
            return false;
        }
    }

    // Process RUMI autofill for a single form
    async function processRumiAutofill(form) {
        if (!form || !form.isConnected || observerDisconnected) return;

        console.log('🔄 Starting RUMI autofill process...');

        try {
            // Set SSOC Reason to "Escalated to Uber"
            console.log('📝 Step 1: Setting SSOC Reason...');
            const ssocReasonSuccess = await setSSOCReasonToEscalated(form);
            console.log(`✅ SSOC Reason result: ${ssocReasonSuccess ? 'SUCCESS' : 'FAILED'}`);

            // Minimal delay between operations
            await new Promise(resolve => setTimeout(resolve, 50));

            // Set Action Taken - Consumer to "Resolved - Escalated to Uber"
            console.log('📝 Step 2: Setting Action Taken - Consumer...');
            const actionTakenSuccess = await setActionTakenConsumer(form);
            console.log(`✅ Action Taken - Consumer result: ${actionTakenSuccess ? 'SUCCESS' : 'FAILED'}`);

            // Minimal delay between operations
            await new Promise(resolve => setTimeout(resolve, 50));

            // Set SSOC incident source based on subject
            console.log('📝 Step 3: Setting SSOC incident source...');
            const incidentSourceSuccess = await setSSOCIncidentSource(form);
            console.log(`✅ SSOC incident source result: ${incidentSourceSuccess ? 'SUCCESS' : 'FAILED'}`);

            console.log('🎉 RUMI autofill process completed');
            return true;
        } catch (error) {
            console.error('❌ Error during RUMI autofill process:', error);
            return false;
        }
    }

    // Process duplicate ticket autofill for a single form
    async function processDuplicateAutofill(form) {
        if (!form || !form.isConnected || observerDisconnected) return;

        console.log('🔄 Starting duplicate ticket autofill process...');

        try {
            // Set Reason to "Operations related - Invalid tickets/calls (Already resolved / duplicates)"
            console.log('📝 Step 1: Setting Reason...');
            const reasonSuccess = await setReasonToDuplicate(form);
            console.log(`✅ Reason result: ${reasonSuccess ? 'SUCCESS' : 'FAILED'}`);

            // Minimal delay between operations
            await new Promise(resolve => setTimeout(resolve, 50));

            // Set Action Taken - Consumer to "Resolved - Escalated to Uber"
            console.log('📝 Step 2: Setting Action Taken - Consumer...');
            const actionTakenSuccess = await setActionTakenConsumerDuplicate(form);
            console.log(`✅ Action Taken - Consumer result: ${actionTakenSuccess ? 'SUCCESS' : 'FAILED'}`);

            // Minimal delay between operations
            await new Promise(resolve => setTimeout(resolve, 50));

            // Set SSOC Reason to "Escalated to Uber"
            console.log('📝 Step 3: Setting SSOC Reason...');
            const ssocReasonSuccess = await setSSOCReasonToDuplicate(form);
            console.log(`✅ SSOC Reason result: ${ssocReasonSuccess ? 'SUCCESS' : 'FAILED'}`);

            // Minimal delay between operations
            await new Promise(resolve => setTimeout(resolve, 50));

            // Set SSOC incident source based on subject
            console.log('📝 Step 4: Setting SSOC incident source...');
            const incidentSourceSuccess = await setSSOCIncidentSource(form);
            console.log(`✅ SSOC incident source result: ${incidentSourceSuccess ? 'SUCCESS' : 'FAILED'}`);

            console.log('🎉 Duplicate ticket autofill process completed');
            return true;
        } catch (error) {
            console.error('❌ Error during duplicate ticket autofill process:', error);
            return false;
        }
    }

    // Main duplicate ticket handler
    async function handleDuplicateTicket() {
        console.log('🚀 Starting duplicate ticket operations');

        // First, perform autofill operations
        const allForms = DOMCache.get('div[data-test-id="ticket-fields"][data-tracking-id="ticket-fields"]', true, 2000);
        console.log(`📋 Found ${allForms.length} forms to process for duplicate ticket autofill`);

        if (allForms.length > 0) {
            // Process forms one at a time with small delays
            for (let i = 0; i < allForms.length; i++) {
                try {
                    await processDuplicateAutofill(allForms[i]);
                    // Small delay between forms
                    if (i < allForms.length - 1) {
                        await new Promise(resolve => setTimeout(resolve, 100));
                    }
                } catch (e) {
                    console.warn('Error processing duplicate ticket autofill for form:', e);
                }
            }

            // Wait a bit more for the UI to update after autofill
            await new Promise(resolve => setTimeout(resolve, 200));
        } else {
            console.log('⚠️ No forms found for duplicate ticket autofill');
        }

        // Generate duplicate template text
        const templateText = 'This ticket is duplicated, Refer to ticket #';

        // Copy to clipboard
        navigator.clipboard.writeText(templateText)
            .then(() => {
                console.log('✅ Duplicate template copied to clipboard!');

                // After successful clipboard copy, click the "take it" button
                setTimeout(() => {
                    clickTakeItButton();
                }, 300); // Small delay to ensure clipboard operation completes
            })
            .catch(err => {
                console.error('Failed to copy text:', err);
                console.error('❌ Error copying to clipboard');

                // Even if clipboard fails, still try to click "take it" button
                setTimeout(() => {
                    clickTakeItButton();
                }, 300);
            });
    }

    // Extract current Reason field value
    function getCurrentReasonValue() {
        const allForms = document.querySelectorAll('div[data-test-id="ticket-fields"][data-tracking-id="ticket-fields"]');

        for (const form of allForms) {
            const fields = Array.from(form.children);
            for (const field of fields) {
                const label = field.querySelector('label');
                if (label && (label.textContent.trim() === 'Reason (Quality/GO/Billing)*' || label.textContent.trim() === 'Reason (Quality/GO/Billing)')) {
                    const currentValue = field.querySelector('[title]')?.getAttribute('title') ||
                        field.querySelector('.StyledEllipsis-sc-1u4umy-0')?.textContent.trim() ||
                        field.querySelector('[data-garden-id="typography.ellipsis"]')?.textContent.trim();
                    return currentValue || '';
                }
            }
        }
        return '';
    }

    // Extract current SSOC incident source value
    function getCurrentSSOCIncidentSource() {
        const allForms = document.querySelectorAll('div[data-test-id="ticket-fields"][data-tracking-id="ticket-fields"]');

        for (const form of allForms) {
            const fields = Array.from(form.children);
            for (const field of fields) {
                const label = field.querySelector('label');
                if (label && label.textContent.trim() === 'SSOC incident source') {
                    const currentValue = field.querySelector('[title]')?.getAttribute('title') ||
                        field.querySelector('.StyledEllipsis-sc-1u4umy-0')?.textContent.trim() ||
                        field.querySelector('[data-garden-id="typography.ellipsis"]')?.textContent.trim();
                    return currentValue || '';
                }
            }
        }
        return '';
    }

    // Parse incident type from Reason field using the pattern: Customer - RUMI Safety - [Incident Type]
    function parseIncidentTypeFromReason(reasonValue) {
        if (!reasonValue) return '';

        console.log(`🔍 Parsing incident type from reason: "${reasonValue}"`);

        // Check if the reason contains the pattern "Customer - RUMI Safety"
        const pattern = /Customer\s*-\s*RUMI\s*Safety\s*-\s*(.+)/i;
        const match = reasonValue.match(pattern);

        if (match && match[1]) {
            const incidentType = match[1].trim();
            console.log(`✅ Found incident type: "${incidentType}"`);
            return incidentType;
        }

        console.log('⚠️ No incident type pattern found in reason');
        return '';
    }

    // Determine phone source based on SSOC incident source
    function determinePhoneSource(ssocIncidentSource) {
        if (!ssocIncidentSource) return 'Yes'; // Default to Yes if no value

        console.log(`🔍 Determining phone source from SSOC incident source: "${ssocIncidentSource}"`);

        // Check if it's any form of email (Customer Email, Email, etc.)
        const isEmail = ssocIncidentSource.toLowerCase().includes('email');

        const result = isEmail ? 'No' : 'Yes';
        console.log(`✅ Phone source determined: "${result}" (based on email: ${isEmail})`);
        return result;
    }

    // Detect language based on first word (Arabic vs English)
    function detectLanguage(text) {
        if (!text || !text.trim()) return 'English'; // Default to English if no text

        const firstWord = text.trim().split(/\s+/)[0];
        console.log(`🔍 Detecting language for first word: "${firstWord}"`);

        // Check if first word contains Arabic characters
        const arabicRegex = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
        const hasArabic = arabicRegex.test(firstWord);

        const language = hasArabic ? 'Arabic' : 'English';
        console.log(`✅ Language detected: ${language}`);
        return language;
    }

    // Create and show tiny text input next to RUMI button
    function createTextInput(rumiButton) {
        // Remove any existing input
        const existingInput = document.querySelector('.rumi-text-input');
        if (existingInput) {
            existingInput.remove();
        }

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'rumi-text-input';
        input.style.cssText = `
            position: absolute;
            width: 30px;
            height: 20px;
            font-size: 12px;
            border: 1px solid #ccc;
            border-radius: 3px;
            padding: 2px;
            margin-left: 35px;
            z-index: 1000;
            background: white;
        `;
        input.placeholder = '';
        input.title = 'Paste customer text here';

        // Position relative to RUMI button
        const rumiButtonRect = rumiButton.getBoundingClientRect();
        input.style.position = 'fixed';
        input.style.left = (rumiButtonRect.right + 5) + 'px';
        input.style.top = (rumiButtonRect.top + (rumiButtonRect.height - 20) / 2) + 'px';

        document.body.appendChild(input);

        // Focus and select all text for easy pasting
        setTimeout(() => {
            input.focus();
            input.select();
        }, 50);

        return input;
    }

    // Remove text input
    function removeTextInput() {
        const input = document.querySelector('.rumi-text-input');
        if (input) {
            input.remove();
        }
    }

    // Generate dynamic template text based on current field values and customer input
    function generateDynamicTemplateText(customerWords = '', customerLanguage = '') {
        console.log('🔄 Generating dynamic template text...');

        // Get current field values
        const reasonValue = getCurrentReasonValue();
        const ssocIncidentSource = getCurrentSSOCIncidentSource();
        const hasExcludeTag = hasExcludeDetectionTag();
        const currentTicketId = getCurrentTicketId();

        console.log(`📋 Current Reason: "${reasonValue}"`);
        console.log(`📋 Current SSOC incident source: "${ssocIncidentSource}"`);
        console.log(`🏷️ Has exclude_detection tag: ${hasExcludeTag}`);

        // Parse incident type from reason
        const incidentType = parseIncidentTypeFromReason(reasonValue);

        // Determine phone source - special handling for exclude_detection tag
        let phoneSource;
        if (hasExcludeTag) {
            phoneSource = 'No'; // exclude_detection tag always means No
            console.log('🏷️ exclude_detection tag detected - setting phone source to No');
        } else {
            phoneSource = determinePhoneSource(ssocIncidentSource);
        }

        // Build the template text
        const incidentTypeLine = incidentType ? `Incident Type: ${incidentType}\u00A0` : 'Incident Type:\u00A0';
        const phoneSourceLine = `Is the Source of incident CareemInboundPhone :- ${phoneSource}\u00A0`;
        const customerLanguageLine = customerLanguage ? `Customer Language: ${customerLanguage}\u00A0` : 'Customer Language:\u00A0';
        const customerWordsLine = customerWords ? `Customer Words: ${customerWords}\u00A0` : 'Customer Words:\u00A0';

        // Special description format for exclude_detection tag
        let descriptionLine;
        if (hasExcludeTag) {
            descriptionLine = `Description:\u00A0 (Social media ticket #${currentTicketId})`;
            console.log('🏷️ Using Social media description format for exclude_detection tag');
        } else {
            // Check if it's voice care for normal tickets
            const isVoiceCare = ssocIncidentSource && !ssocIncidentSource.toLowerCase().includes('email');
            if (isVoiceCare && currentTicketId) {
                descriptionLine = `Description:\u00A0 (Voice care ticket #${currentTicketId})`;
                console.log('📞 Using Voice care description format');
            } else {
                descriptionLine = 'Description:\u00A0 ';
            }
        }

        const templateText = `${incidentTypeLine}
${descriptionLine}
${phoneSourceLine}
${customerLanguageLine}
${customerWordsLine}`;

        console.log('✅ Generated template text:');
        console.log(templateText);

        return templateText;
    }

    // Function to check if ticket is already assigned to current user
    function isTicketAlreadyAssigned() {
        console.log('🔍 Checking if ticket is already assigned to current user...');

        // Try to find the assignee field or current assignee display
        const assigneeSelectors = [
            '[data-test-id="assignee-field-current-assignee"]',
            '[data-test-id="assignee-field"] [title]',
            '.assignee-field [title]',
            '[aria-label*="assignee"] [title]',
            '[aria-label*="Assignee"] [title]'
        ];

        let currentAssignee = null;

        for (const selector of assigneeSelectors) {
            const element = document.querySelector(selector);
            if (element) {
                currentAssignee = element.getAttribute('title') || element.textContent.trim();
                if (currentAssignee) {
                    console.log(`📋 Found current assignee: "${currentAssignee}"`);
                    break;
                }
            }
        }

        if (!currentAssignee) {
            console.log('⚠️ Could not determine current assignee');
            return false; // If we can't determine, proceed with assignment
        }

        // Check if current assignee matches the stored username
        if (username && currentAssignee.toLowerCase().includes(username.toLowerCase())) {
            console.log('✅ Ticket is already assigned to current user');
            return true;
        }

        console.log(`📝 Ticket is assigned to "${currentAssignee}", not to current user "${username}"`);
        return false;
    }

    // Function to get current ticket ID from URL
    function getCurrentTicketId() {
        // Extract ticket ID from URL pattern like /agent/tickets/12345
        const match = window.location.pathname.match(/\/agent\/tickets\/(\d+)/);
        return match ? match[1] : null;
    }

    // Track which tickets have been checked to avoid repeated checks
    const checkedTicketsForHala = new Set();

    // Clean up old checked tickets periodically (keep only last 100)
    function cleanupHalaCheckedTickets() {
        if (checkedTicketsForHala.size > 100) {
            const ticketsArray = Array.from(checkedTicketsForHala);
            // Keep only the last 50 tickets
            checkedTicketsForHala.clear();
            ticketsArray.slice(-50).forEach(ticketId => checkedTicketsForHala.add(ticketId));
            console.log('🧹 Cleaned up old HALA checked tickets');
        }
    }

    // Function to check if a ticket has HALA provider tag (integrated into ticket processing)
    async function checkTicketForHalaTag(ticketId) {
        try {
            // Get ticket details to check tags
            const ticketResponse = await RUMIAPIManager.makeRequestWithRetry(`/api/v2/tickets/${ticketId}.json`);
            const ticket = ticketResponse.ticket;

            if (!ticket || !ticket.tags) {
                return { hasHalaTag: false, reason: 'No ticket data or tags found' };
            }

            // Check if ticket has the HALA provider tag
            const hasHalaTag = ticket.tags.includes('ghc_provider_hala-rides');

            if (hasHalaTag) {
                RUMILogger.info('HALA', `Found ghc_provider_hala-rides tag for ticket ${ticketId}`);
                return {
                    hasHalaTag: true,
                    ticketData: ticket,
                    action: 'RTA Assignment'
                };
            }

            return { hasHalaTag: false, reason: 'HALA tag not found' };
        } catch (error) {
            RUMILogger.error('HALA', `Failed to check HALA tag for ticket ${ticketId}`, error);
            return { hasHalaTag: false, reason: 'Error checking ticket', error: error.message };
        }
    }

    // Legacy function kept for compatibility but not called continuously anymore
    async function checkForHalaProviderTag() {
        console.log('🔍 Checking for ghc_provider_hala-rides tag...');

        // Get current ticket ID to track if assignment was already done
        const currentTicketId = getCurrentTicketId();
        if (!currentTicketId) {
            console.log('⚠️ Could not determine ticket ID - skipping HALA provider check');
            return;
        }

        // Check if we've already checked this ticket
        if (checkedTicketsForHala.has(currentTicketId)) {
            console.log(`✅ Ticket ${currentTicketId} already checked for HALA tag - skipping`);
            return;
        }

        // Mark this ticket as checked to prevent future checks
        checkedTicketsForHala.add(currentTicketId);

        // Periodically clean up old checked tickets
        cleanupHalaCheckedTickets();

        // Look for individual tag elements instead of input field
        const tagElements = document.querySelectorAll('.garden-tag-item, [data-test-id="ticket-system-field-tags-item-selected"] .garden-tag-item');

        if (tagElements.length === 0) {
            console.log('⚠️ No tag elements found - skipping HALA provider check');
            return;
        }

        console.log(`📋 Found ${tagElements.length} tag elements`);

        // Extract all tag text values
        const tagTexts = Array.from(tagElements).map(element => element.textContent.trim());
        console.log(`📋 Current tags: ${tagTexts.join(', ')}`);

        // Check if any tag matches "ghc_provider_hala-rides"
        const hasHalaProviderTag = tagTexts.some(tagText =>
            tagText.toLowerCase() === 'ghc_provider_hala-rides'
        );

        if (hasHalaProviderTag) {
            console.log(`🎯 Found ghc_provider_hala-rides tag for ticket ${currentTicketId} - checking conditions for group assignment`);

            try {
                // Get ticket comments to check latest comment author
                const comments = await RUMIZendeskAPI.getTicketComments(currentTicketId);

                if (!comments || comments.length === 0) {
                    console.log('⚠️ No comments found for ticket - skipping HALA assignment');
                    return;
                }

                // Get the latest comment (first one since we sort by desc)
                const latestComment = comments[0];

                // Get the author details to check their role
                const authorDetails = await RUMIZendeskAPI.getUserDetails(latestComment.author_id);
                const authorRole = authorDetails.role;

                console.log(`📋 Latest comment author role: ${authorRole} (User: ${authorDetails.name})`);

                // Check if the author role is end-user
                if (authorRole !== 'end-user') {
                    console.log(`⚠️ Latest comment is from ${authorRole}, not end-user - skipping HALA assignment`);
                    return;
                }

                // Check if the latest comment is from end-user (which we already confirmed above)
                console.log(`✅ Latest comment is from end-user - proceeding with HALA ticket assignment`);

                // Assign the ticket to RTA JV group
                await assignHalaTicketToGroup(currentTicketId);

                console.log(`✅ Successfully processed HALA ticket ${currentTicketId}`);

            } catch (error) {
                console.error(`❌ Error processing HALA ticket ${currentTicketId}:`, error);
            }
        } else {
            console.log('⚠️ ghc_provider_hala-rides tag not found in tags');
        }
    }

    // Function to assign HALA ticket to RTA JV group
    async function assignHalaTicketToGroup(ticketId) {
        try {
            console.log(`🎯 Assigning HALA ticket ${ticketId} to RTA JV group (360003368353)`);

            // Use the existing updateTicket function to assign to group
            const result = await RUMIZendeskAPI.updateTicket(ticketId, {
                group_id: 360003368353  // RTA JV group ID
            });

            console.log(`✅ Successfully assigned HALA ticket ${ticketId} to RTA JV group`);
            return result;
        } catch (error) {
            console.error(`❌ Failed to assign HALA ticket ${ticketId} to group:`, error);
            throw error;
        }
    }

    // Function to show simple export toast notification
    function showExportToast(message = 'Exported') {
        // Remove any existing export toast
        const existingToast = document.querySelector('.export-toast');
        if (existingToast) {
            existingToast.remove();
        }

        // Create toast element
        const toast = document.createElement('div');
        toast.className = 'export-toast';
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background-color: #333333;
            color: white;
            padding: 12px 20px;
            border-radius: 4px;
            font-size: 14px;
            z-index: 10000;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
            animation: exportToastSlide 0.3s ease-out;
        `;

        // Add CSS animation if not already added
        if (!document.getElementById('export-toast-styles')) {
            const style = document.createElement('style');
            style.id = 'export-toast-styles';
            style.textContent = `
                @keyframes exportToastSlide {
                    from {
                        opacity: 0;
                        transform: translateX(100%);
                    }
                    to {
                        opacity: 1;
                        transform: translateX(0);
                    }
                }
            `;
            document.head.appendChild(style);
        }

        // Add toast to body
        document.body.appendChild(toast);

        // Auto-remove toast after 2 seconds
        setTimeout(() => {
            if (toast && toast.parentElement) {
                toast.style.animation = 'exportToastSlide 0.3s ease-out reverse';
                setTimeout(() => toast.remove(), 300);
            }
        }, 2000);
    }

    // Function to find and click the "take it" button
    function clickTakeItButton() {
        // First check if ticket is already assigned to current user
        if (isTicketAlreadyAssigned()) {
            console.log('✅ Ticket already assigned to current user, skipping assignment');
            return;
        }

        console.log('🎯 Looking for "take it" button...');

        // Try multiple selectors to find the "take it" button
        const selectors = [
            'button[data-test-id="assignee-field-take-it-button"]',
            'button:contains("take it")',
            '.bCIuZx',
            'button[class*="bCIuZx"]'
        ];

        let takeItButton = null;

        // Try each selector
        for (const selector of selectors) {
            if (selector.includes(':contains')) {
                // Handle :contains pseudo-selector manually
                const buttons = document.querySelectorAll('button');
                takeItButton = Array.from(buttons).find(btn =>
                    btn.textContent.trim().toLowerCase() === 'take it'
                );
            } else {
                takeItButton = document.querySelector(selector);
            }

            if (takeItButton) {
                console.log(`✅ Found "take it" button using selector: ${selector}`);
                break;
            }
        }

        if (takeItButton) {
            try {
                console.log('🖱️ Clicking "take it" button...');

                // Check if button is visible and enabled
                if (takeItButton.offsetParent !== null && !takeItButton.disabled) {
                    takeItButton.click();
                    console.log('✅ "take it" button clicked successfully');
                } else {
                    console.log('⚠️ "take it" button found but not clickable (hidden or disabled)');
                }
            } catch (error) {
                console.error('❌ Error clicking "take it" button:', error);
            }
        } else {
            console.log('⚠️ "take it" button not found on the page');
        }
    }

    // Main RUMI click handler
    function copyRumi(buttonElement) {
        console.log('🚀 RUMI clicked');

        // Check if text input already exists
        const existingInput = document.querySelector('.rumi-text-input');
        if (existingInput) {
            // If text input exists, remove it (toggle off)
            console.log('📤 Removing existing text input');
            removeTextInput();
            return;
        }

        console.log('📥 Showing text input');
        // Create and show the text input
        const textInput = createTextInput(buttonElement);

        // Wait specifically for Ctrl+V paste action

        // Handle keyboard events: Ctrl+V, Enter, and Escape
        textInput.addEventListener('keydown', async (event) => {
            // Handle Ctrl+V paste
            if ((event.ctrlKey || event.metaKey) && event.key === 'v') {
                // Small delay to ensure paste is processed
                setTimeout(async () => {
                    const pastedText = textInput.value.trim();
                    console.log(`📝 Text pasted with Ctrl+V: "${pastedText}"`);

                    // Remove the text input
                    removeTextInput();

                    if (pastedText) {
                        // Detect language based on first word
                        const customerLanguage = detectLanguage(pastedText);
                        console.log(`🌍 Customer language: ${customerLanguage}`);

                        // Start the autofill and template generation process
                        await performRumiOperations(pastedText, customerLanguage);
                    } else {
                        // If no text was pasted, continue with empty values
                        await performRumiOperations('', '');
                    }
                }, 10);
            }
            // Handle Enter key
            else if (event.key === 'Enter') {
                const enteredText = textInput.value.trim();
                console.log(`↵ Enter pressed with text: "${enteredText}"`);
                removeTextInput();
                const customerLanguage = detectLanguage(enteredText);
                await performRumiOperations(enteredText, customerLanguage);
            }
            // Handle Escape key
            else if (event.key === 'Escape') {
                // Cancel operation
                console.log('❌ RUMI operation cancelled');
                removeTextInput();
            }
        });

        // Note: Text input will wait indefinitely until Ctrl+V is pressed
        // No auto-timeout behavior
    }

    // Perform the actual autofill and template generation operations
    async function performRumiOperations(customerWords, customerLanguage) {
        console.log('🚀 Starting RUMI autofill and template generation');
        console.log(`📝 Customer Words: "${customerWords}"`);
        console.log(`🌍 Customer Language: "${customerLanguage}"`);

        // First, perform autofill operations
        const allForms = DOMCache.get('div[data-test-id="ticket-fields"][data-tracking-id="ticket-fields"]', true, 2000);
        console.log(`📋 Found ${allForms.length} forms to process for RUMI autofill`);

        if (allForms.length > 0) {
            // Process forms one at a time with small delays
            for (let i = 0; i < allForms.length; i++) {
                try {
                    await processRumiAutofill(allForms[i]);
                    // Small delay between forms
                    if (i < allForms.length - 1) {
                        await new Promise(resolve => setTimeout(resolve, 100));
                    }
                } catch (e) {
                    console.warn('Error processing RUMI autofill for form:', e);
                }
            }

            // Wait a bit more for the UI to update after autofill
            await new Promise(resolve => setTimeout(resolve, 200));
        } else {
            console.log('⚠️ No forms found for RUMI autofill');
        }

        // Now generate dynamic template text based on current field values and customer input
        const templateText = generateDynamicTemplateText(customerWords, customerLanguage);

        // Copy to clipboard
        navigator.clipboard.writeText(templateText)
            .then(() => {
                console.log('✅ RUMI template copied to clipboard!');

                // After successful clipboard copy, click the "take it" button
                setTimeout(() => {
                    clickTakeItButton();
                }, 300); // Small delay to ensure clipboard operation completes
            })
            .catch(err => {
                console.error('Failed to copy text:', err);
                console.error('❌ Error copying to clipboard');

                // Even if clipboard fails, still try to click "take it" button
                setTimeout(() => {
                    clickTakeItButton();
                }, 300);
            });
    }

    // Create RUMI button
    function createRumiButton() {
        const wrapper = document.createElement('div');
        wrapper.className = 'sc-ymabb7-1 fTDEYw';

        const button = document.createElement('button');
        button.setAttribute('aria-pressed', 'false');
        button.setAttribute('aria-label', 'RUMI');
        button.setAttribute('data-test-id', 'rumi-button');
        button.setAttribute('data-active', 'false');
        button.setAttribute('title', 'RUMI');
        button.setAttribute('tabindex', '0');
        button.className = 'StyledButton-sc-qe3ace-0 StyledIconButton-sc-1t0ughp-0 eUFUgT iQoDao sc-k83b6s-0 ihwxVG';
        button.setAttribute('data-garden-id', 'buttons.icon_button');
        button.setAttribute('data-garden-version', '9.7.0');
        button.setAttribute('type', 'button');

        // Create the Uber logo SVG
        const iconDiv = document.createElement('div');
        iconDiv.className = 'rumi-icon';
        iconDiv.innerHTML = uberLogoSVG;

        // Configure the SVG
        const svg = iconDiv.querySelector('svg');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('focusable', 'false');
        svg.setAttribute('data-garden-id', 'buttons.icon');
        svg.setAttribute('data-garden-version', '9.7.0');
        svg.setAttribute('class', 'StyledBaseIcon-sc-1moykgb-0 StyledIcon-sc-19meqgg-0 eWlVPJ cxMMcO');

        button.appendChild(iconDiv);

        // Add slight visual difference
        button.style.opacity = '0.85';

        // Add click handler
        button.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            copyRumi(button);
        });

        wrapper.appendChild(button);
        return wrapper;
    }

    // Create Duplicate button
    function createDuplicateButton() {
        const wrapper = document.createElement('div');
        wrapper.className = 'sc-ymabb7-1 fTDEYw';

        const button = document.createElement('button');
        button.setAttribute('aria-pressed', 'false');
        button.setAttribute('aria-label', 'Duplicate Ticket');
        button.setAttribute('data-test-id', 'duplicate-button');
        button.setAttribute('data-active', 'false');
        button.setAttribute('title', 'Mark as Duplicate Ticket');
        button.setAttribute('tabindex', '0');
        button.className = 'StyledButton-sc-qe3ace-0 StyledIconButton-sc-1t0ughp-0 eUFUgT iQoDao sc-k83b6s-0 ihwxVG';
        button.setAttribute('data-garden-id', 'buttons.icon_button');
        button.setAttribute('data-garden-version', '9.7.0');
        button.setAttribute('type', 'button');

        // Create the duplicate icon SVG
        const iconDiv = document.createElement('div');
        iconDiv.className = 'duplicate-icon';
        iconDiv.innerHTML = duplicateIconSVG;

        // Configure the SVG
        const svg = iconDiv.querySelector('svg');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('focusable', 'false');
        svg.setAttribute('data-garden-id', 'buttons.icon');
        svg.setAttribute('data-garden-version', '9.7.0');
        svg.setAttribute('class', 'StyledBaseIcon-sc-1moykgb-0 StyledIcon-sc-19meqgg-0 eWlVPJ cxMMcO');
        svg.style.width = '16px';
        svg.style.height = '16px';

        button.appendChild(iconDiv);

        // Add slight visual difference
        button.style.opacity = '0.85';

        // Add click handler
        button.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            handleDuplicateTicket();
        });

        wrapper.appendChild(button);
        return wrapper;
    }

    // Toggle field visibility between 'all' and 'minimal'
    function toggleAllFields() {
        debounce(() => {
            const allForms = DOMCache.get('div[data-test-id="ticket-fields"][data-tracking-id="ticket-fields"]', true, 2000);

            if (allForms.length === 0) {
                return;
            }

            // Toggle between 'all' and 'minimal' states
            fieldVisibilityState = (fieldVisibilityState === 'all') ? 'minimal' : 'all';

            // Save the new state to localStorage
            saveFieldVisibilityState();

            // Use requestAnimationFrame for better performance
            requestAnimationFrame(() => {
                allForms.forEach(form => {
                    if (!form || !form.children || !form.isConnected) return;

                    const fields = Array.from(form.children).filter(field =>
                        field.nodeType === Node.ELEMENT_NODE && field.isConnected
                    );

                    // Batch DOM operations
                    const fieldsToHide = [];
                    const fieldsToShow = [];

                    fields.forEach(field => {
                        try {
                            if (fieldVisibilityState === 'all') {
                                // Show all fields
                                fieldsToShow.push(field);
                            } else if (isTargetField(field)) {
                                // This is a target field for minimal state, show it
                                fieldsToShow.push(field);
                            } else {
                                // This is not a target field for minimal state, hide it
                                fieldsToHide.push(field);
                            }
                        } catch (e) {
                            // Silent error handling
                        }
                    });

                    // Apply changes in batches to minimize reflows
                    fieldsToHide.forEach(field => field.classList.add('hidden-form-field'));
                    fieldsToShow.forEach(field => field.classList.remove('hidden-form-field'));
                });

                // Update button state
                updateToggleButtonState();
            });
        }, 100, 'toggleAllFields');
    }

    // Update the toggle button appearance based on current state
    function updateToggleButtonState() {
        if (!globalButton) return;

        const button = globalButton.querySelector('button');
        if (!button) return;

        const iconSvg = button.querySelector('svg');
        if (iconSvg) {
            let newSvg, title, text;

            if (fieldVisibilityState === 'all') {
                newSvg = eyeOpenSVG;
                title = 'Showing All Fields - Click for Minimal View';
                text = 'All Fields';
            } else {
                newSvg = eyeClosedSVG;
                title = 'Showing Minimal Fields - Click for All Fields';
                text = 'Minimal';
            }

            iconSvg.outerHTML = newSvg;
            const newIcon = button.querySelector('svg');
            if (newIcon) {
                newIcon.setAttribute('width', '26');
                newIcon.setAttribute('height', '26');
                newIcon.setAttribute('data-garden-id', 'chrome.nav_item_icon');
                newIcon.setAttribute('data-garden-version', '9.5.2');
                newIcon.classList.add('StyledBaseIcon-sc-1moykgb-0', 'StyledNavItemIcon-sc-7w9rpt-0', 'eWlVPJ', 'YOjtB');
            }

            button.setAttribute('title', title);

            const textSpan = button.querySelector('span');
            if (textSpan) {
                textSpan.textContent = text;
            }
        }
    }

    // Create the hide/show toggle button
    function createToggleButton() {
        const listItem = document.createElement('li');
        listItem.className = 'nav-list-item';

        const button = document.createElement('button');
        button.className = 'form-toggle-icon StyledBaseNavItem-sc-zvo43f-0 StyledNavButton-sc-f5ux3-0 gvFgbC dXnFqH';
        button.setAttribute('tabindex', '0');
        button.setAttribute('data-garden-id', 'chrome.nav_button');
        button.setAttribute('data-garden-version', '9.5.2');

        const iconWrapper = document.createElement('div');
        iconWrapper.style.display = 'flex';
        iconWrapper.style.alignItems = 'center';

        const icon = document.createElement('div');
        icon.innerHTML = eyeOpenSVG; // Start with 'all fields' state
        icon.firstChild.setAttribute('width', '26');
        icon.firstChild.setAttribute('height', '26');
        icon.firstChild.setAttribute('data-garden-id', 'chrome.nav_item_icon');
        icon.firstChild.setAttribute('data-garden-version', '9.5.2');
        icon.firstChild.classList.add('StyledBaseIcon-sc-1moykgb-0', 'StyledNavItemIcon-sc-7w9rpt-0', 'eWlVPJ', 'YOjtB');

        const text = document.createElement('span');
        text.textContent = 'All Fields';
        text.className = 'StyledNavItemText-sc-13m84xl-0 iOGbGR';
        text.setAttribute('data-garden-id', 'chrome.nav_item_text');
        text.setAttribute('data-garden-version', '9.5.2');

        iconWrapper.appendChild(icon);
        iconWrapper.appendChild(text);
        button.appendChild(iconWrapper);
        listItem.appendChild(button);

        return listItem;
    }

    // Create separator for navigation
    function createSeparator() {
        const separator = document.createElement('li');
        separator.className = 'nav-separator';
        return separator;
    }

    // Try to add the hide/show button to the navigation
    function tryAddToggleButton() {
        const navLists = document.querySelectorAll('ul[data-garden-id="chrome.nav_list"]');
        const navList = navLists[navLists.length - 1];

        if (navList && !globalButton) {
            const separator = createSeparator();
            navList.appendChild(separator);

            const customSection = document.createElement('div');
            customSection.className = 'custom-nav-section';

            globalButton = createToggleButton();
            const button = globalButton.querySelector('button');
            button.addEventListener('click', toggleAllFields);
            customSection.appendChild(globalButton);

            navList.appendChild(customSection);
        }
    }

    // Insert RUMI and Duplicate buttons into toolbar
    function insertRumiButton() {
        // Find toolbar and add RUMI button
        const toolbars = document.querySelectorAll('[data-test-id="ticket-editor-app-icon-view"]');

        toolbars.forEach(toolbar => {
            // Check if RUMI button already exists
            const existingRumi = toolbar.querySelector('[data-test-id="rumi-button"]');
            const existingDuplicate = toolbar.querySelector('[data-test-id="duplicate-button"]');

            // Find the original "Add link" button to insert after it
            const originalLinkButton = toolbar.querySelector('[data-test-id="ticket-composer-toolbar-link-button"]');
            if (!originalLinkButton) return;

            const originalWrapper = originalLinkButton.parentElement;
            if (!originalWrapper) return;

            let insertAfter = originalWrapper;

            // Create and insert RUMI button if it doesn't exist
            if (!existingRumi) {
                const rumiButton = createRumiButton();
                originalWrapper.parentNode.insertBefore(rumiButton, insertAfter.nextSibling);
                insertAfter = rumiButton; // Update reference for next insertion
            } else {
                insertAfter = existingRumi; // Use existing RUMI button as reference
            }

            // Create and insert Duplicate button if it doesn't exist
            if (!existingDuplicate) {
                const duplicateButton = createDuplicateButton();
                originalWrapper.parentNode.insertBefore(duplicateButton, insertAfter.nextSibling);
            }
        });
    }

    // ============================================================================
    // RUMI ENHANCEMENT - UI MANAGEMENT
    // ============================================================================

    function createRUMIEnhancementOverlayButton() {
        // Find Zendesk icon element - try multiple selectors for different Zendesk layouts
        const selectors = [
            'div[title="Zendesk"][data-test-id="zendesk_icon"]',
            'div[data-test-id="zendesk_icon"]',
            'div[title="Zendesk"]',
            '.StyledBrandmarkNavItem-sc-8kynd4-0',
            'div[data-garden-id="chrome.brandmark_nav_list_item"]'
        ];

        let zendeskIcon = null;
        for (const selector of selectors) {
            zendeskIcon = document.querySelector(selector);
            if (zendeskIcon) {
                RUMILogger.debug('UI', `Found Zendesk icon with selector: ${selector}`);
                break;
            }
        }

        if (!zendeskIcon) {
            RUMILogger.warn('UI', 'Zendesk icon element not found with any selector');
            return false;
        }

        // Check if already enhanced
        if (zendeskIcon.dataset.rumiEnhanced === 'true') {
            return true; // Already enhanced successfully
        }

        // Mark as enhanced to prevent duplicate handlers
        zendeskIcon.dataset.rumiEnhanced = 'true';

        // Store original title and update with RUMI info
        const originalTitle = zendeskIcon.getAttribute('title') || 'Zendesk';
        zendeskIcon.setAttribute('title', `${originalTitle} - Right-click for RUMI Enhancement`);

        // Add visual indicator (small robot emoji in corner) - made invisible
        const indicator = document.createElement('div');
        indicator.innerHTML = '🤖';
        indicator.style.cssText = `
            position: absolute !important;
            top: -3px !important;
            right: -3px !important;
            font-size: 8px !important;
            z-index: 10000 !important;
            pointer-events: none !important;
            opacity: 0 !important;
            display: none !important;
        `;

        zendeskIcon.style.position = 'relative';
        zendeskIcon.appendChild(indicator);

        // Add right-click handler for RUMI Enhancement
        zendeskIcon.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleRUMIEnhancementPanel();
        });

        // Add subtle hover effect
        zendeskIcon.addEventListener('mouseenter', () => {
            indicator.style.opacity = '1';
        });

        zendeskIcon.addEventListener('mouseleave', () => {
            indicator.style.opacity = '0.8';
        });

        RUMILogger.info('UI', 'Zendesk icon enhanced for RUMI - right-click to access');
        return true; // Successfully enhanced
    }

    function toggleRUMIEnhancementPanel() {
        const existingPanel = document.getElementById('rumi-enhancement-panel');
        if (existingPanel) {
            // Toggle visibility using CSS class to override !important styles
            const isHidden = existingPanel.classList.contains('rumi-hidden');

            if (isHidden) {
                existingPanel.classList.remove('rumi-hidden');
            } else {
                existingPanel.classList.add('rumi-hidden');
            }
            return;
        }

        safeCreateRUMIEnhancementPanel();
    }

    async function createRUMIEnhancementPanel() {
        const overlay = document.createElement('div');
        overlay.className = 'rumi-enhancement-overlay';
        overlay.id = 'rumi-enhancement-panel';

        const panel = document.createElement('div');
        panel.className = 'rumi-enhancement-panel';

        // Define the specific SSOC views with exact IDs you provided
        const ssocViews = [
            { id: '360002226448', title: 'SSOC - Open - Urgent', group: 'URGENT/OPEN' },
            { id: '325978088', title: 'SSOC - GCC & EM Open', group: 'URGENT/OPEN' },
            { id: '360069695114', title: 'SSOC - Egypt Urgent', group: 'URGENT/OPEN' },
            { id: '360000843468', title: 'SSOC - Egypt Open', group: 'URGENT/OPEN' },
            { id: '360003923428', title: 'SSOC - Pending - Urgent', group: 'PENDING' },
            { id: '360000842448', title: 'SSOC - GCC & EM Pending', group: 'PENDING' },
            { id: '360002386547', title: 'SSOC - Egypt Pending', group: 'PENDING' }
        ];

        // Use the hardcoded views instead of API calls
        let viewsHTML = '';
        let loadedViews = ssocViews;

        // Group views by category
        const groups = {
            'URGENT/OPEN': ssocViews.filter(view => view.group === 'URGENT/OPEN'),
            'PENDING': ssocViews.filter(view => view.group === 'PENDING')
        };

        Object.entries(groups).forEach(([groupName, groupViews]) => {
            if (groupViews.length > 0) {
                viewsHTML += `
                    <div class="rumi-view-group">
                        <div class="rumi-view-group-header">${groupName} VIEWS</div>
                        ${groupViews.map(view => {
                            const isSelected = rumiEnhancement.selectedViews.has(view.id.toString());
                            return `
                                <div class="rumi-view-item ${isSelected ? 'selected' : ''}" data-view-id="${view.id}">
                                    <input type="checkbox" class="rumi-view-checkbox" ${isSelected ? 'checked' : ''} />
                                    <div class="rumi-view-info">
                                        <div class="rumi-view-title">${view.title}</div>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                `;
            }
        });

        RUMILogger.info('UI', `Using hardcoded SSOC views: ${ssocViews.length} views total`);

        panel.innerHTML = `
            <!-- Top Bar -->
            <div class="rumi-enhancement-top-bar">
                <h2>RUMI Automation System</h2>
                <button id="rumi-close-panel" class="rumi-enhancement-button">CLOSE</button>
            </div>

            <!-- Main Tab Navigation -->
            <div class="rumi-main-tabs">
                <button class="rumi-main-tab ${rumiEnhancement.activeTab === 'automatic' ? 'active' : ''}" data-maintab="automatic">Automatic Process</button>
                <button class="rumi-main-tab ${rumiEnhancement.activeTab === 'manual' ? 'active' : ''}" data-maintab="manual">Manual Process</button>
                <button class="rumi-main-tab ${rumiEnhancement.activeTab === 'data' ? 'active' : ''}" data-maintab="data">Data & Statistics</button>
            </div>

            <!-- Tab Content Areas -->
            <div class="rumi-main-tab-content" style="padding: 16px; background: #F5F5F5;">

                <!-- AUTOMATIC PROCESS TAB -->
                <div class="rumi-main-tab-panel ${rumiEnhancement.activeTab === 'automatic' ? 'active' : ''}" id="rumi-automatic-tab">
                    <!-- Automatic Metrics Row -->
                    <div class="rumi-metrics-row">
                        <div class="rumi-metric-box">
                            <span class="rumi-metric-value" id="metric-auto-solved">${rumiEnhancement.automaticTickets.solved.length}</span>
                            <div class="rumi-metric-label">Solved</div>
                        </div>
                        <div class="rumi-metric-box">
                            <span class="rumi-metric-value" id="metric-auto-pending">${rumiEnhancement.automaticTickets.pending.length}</span>
                            <div class="rumi-metric-label">Pending</div>
                        </div>
                        <div class="rumi-metric-box">
                            <span class="rumi-metric-value" id="metric-auto-rta">${rumiEnhancement.automaticTickets.rta.length}</span>
                            <div class="rumi-metric-label">RTA</div>
                        </div>
                    </div>

                    <!-- START MONITORING Button -->
                    <div class="rumi-enhancement-section">
                        <div class="rumi-control-panel">
                            <button id="rumi-start-stop" class="rumi-enhancement-button rumi-enhancement-button-primary">
                                ${rumiEnhancement.isMonitoring ? 'STOP MONITORING' : 'START MONITORING'}
                            </button>
                        </div>
                        <div style="margin-top: 12px;">
                            <label style="display: flex; align-items: center; gap: 8px;">
                                <input type="checkbox" id="rumi-automatic-dry-run" ${rumiEnhancement.dryRunModes.automatic ? 'checked' : ''}>
                                Dry Run Mode (Analysis only, no actual ticket updates)
                            </label>
                        </div>
                    </div>

                    <!-- Monitoring Status and Last Checked -->
                    <div class="rumi-enhancement-section">
                        <h3>Monitoring Status</h3>
                        <div class="rumi-status-indicator">
                            <span class="rumi-status-dot ${rumiEnhancement.isMonitoring ? 'active' : 'inactive'}"></span>
                            <span id="rumi-status-indicator" class="${rumiEnhancement.isMonitoring ? 'rumi-enhancement-status-active' : 'rumi-enhancement-status-inactive'}">
                                ${rumiEnhancement.isMonitoring ? 'MONITORING' : 'STOPPED'}
                            </span>
                        </div>
                        <div id="rumi-last-check" style="font-size: 11px; color: #666666; margin-top: 8px;">
                            ${rumiEnhancement.lastCheckTime ? `Last check: ${rumiEnhancement.lastCheckTime.toLocaleTimeString()}` : 'Never checked'}
                        </div>
                    </div>

                    <!-- SSOC View Selection -->
                    <div class="rumi-enhancement-section">
                        <div class="rumi-view-selection-header">
                            <h3>SSOC View Selection</h3>
                            <div class="rumi-view-selection-actions">
                                <button id="rumi-select-all" class="rumi-enhancement-button">SELECT ALL</button>
                                <button id="rumi-clear-all" class="rumi-enhancement-button">CLEAR ALL</button>
                            </div>
                        </div>
                        <div id="rumi-view-grid" class="rumi-view-grid">
                            ${viewsHTML}
                        </div>
                        <div style="margin-top: 12px; font-size: 11px; color: #666666; text-align: center;">
                            Selected: <span id="rumi-selected-count" style="color: #0066CC; font-weight: bold;">0</span> views
                        </div>
                    </div>

                    <!-- Configuration -->
                    <div class="rumi-enhancement-section">
                        <h3>Configuration</h3>
                        <div style="margin-bottom: 12px;">
                            <label style="display: block; margin-bottom: 6px;">Operation Modes:</label>
                            <div style="display: flex; flex-direction: column; gap: 4px; padding: 8px; border: 1px solid #E0E0E0; border-radius: 2px; background: white;">
                                <label style="display: flex; align-items: center; gap: 8px; font-size: 13px;">
                                    <input type="checkbox" id="rumi-operation-solved" ${rumiEnhancement.operationModes.solved ? 'checked' : ''}>
                                    Solved Operations
                                </label>
                                <label style="display: flex; align-items: center; gap: 8px; font-size: 13px;">
                                    <input type="checkbox" id="rumi-operation-pending" ${rumiEnhancement.operationModes.pending ? 'checked' : ''}>
                                    Pending Operations
                                </label>
                                <label style="display: flex; align-items: center; gap: 8px; font-size: 13px;">
                                    <input type="checkbox" id="rumi-operation-rta" ${rumiEnhancement.operationModes.rta ? 'checked' : ''}>
                                    RTA Operations
                                </label>
                            </div>
                        </div>
                        <div style="margin-bottom: 12px;">
                            <label style="display: block; margin-bottom: 6px;">Check Interval:</label>
                            <div style="display: flex; align-items: center; gap: 12px;">
                                <input type="range" id="rumi-interval-slider" min="10" max="60" value="${rumiEnhancement.config.CHECK_INTERVAL / 1000}" style="flex: 1; margin: 0; width: 100%;">
                                <span id="rumi-interval-display" style="min-width: 40px; color: #333333; font-weight: bold; font-size: 13px;">${rumiEnhancement.config.CHECK_INTERVAL / 1000}s</span>
                            </div>
                        </div>
                    </div>

                    <!-- Processed Tickets -->
                    <div class="rumi-enhancement-section">
                        <h3>Processed Tickets</h3>
                        <div class="rumi-tabs">
                            <div class="rumi-tab-headers">
                                <button class="rumi-tab-header active" data-tab="auto-solved">Solved</button>
                                <button class="rumi-tab-header" data-tab="auto-pending">Pending</button>
                                <button class="rumi-tab-header" data-tab="auto-rta">RTA</button>
                            </div>
                            <div class="rumi-tab-content">
                                <div class="rumi-tab-panel active" id="rumi-auto-solved-tab">
                                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                                        <span style="font-size: 12px; color: #666;">Automatic Solved Tickets (${rumiEnhancement.automaticTickets.solved.length})</span>
                                        <button id="copy-auto-solved-ids" class="rumi-enhancement-button" style="font-size: 11px; padding: 4px 8px;">COPY IDs</button>
                                    </div>
                                    <div id="rumi-auto-solved-tickets" style="max-height: 400px; overflow-y: auto; border: 1px solid #E0E0E0; padding: 12px; background: white; border-radius: 2px; font-size: 13px;">
                                        ${rumiEnhancement.automaticTickets.solved.length === 0 ? '<div style="text-align: center; color: #666666; padding: 20px;">No automatic solved tickets yet</div>' : ''}
                                    </div>
                                </div>
                                <div class="rumi-tab-panel" id="rumi-auto-pending-tab">
                                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                                        <span style="font-size: 12px; color: #666;">Automatic Pending Tickets (${rumiEnhancement.automaticTickets.pending.length})</span>
                                        <button id="copy-auto-pending-ids" class="rumi-enhancement-button" style="font-size: 11px; padding: 4px 8px;">COPY IDs</button>
                                    </div>
                                    <div id="rumi-auto-pending-tickets" style="max-height: 400px; overflow-y: auto; border: 1px solid #E0E0E0; padding: 12px; background: white; border-radius: 2px; font-size: 13px;">
                                        ${rumiEnhancement.automaticTickets.pending.length === 0 ? '<div style="text-align: center; color: #666666; padding: 20px;">No automatic pending tickets yet</div>' : ''}
                                    </div>
                                </div>
                                <div class="rumi-tab-panel" id="rumi-auto-rta-tab">
                                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                                        <span style="font-size: 12px; color: #666;">Automatic RTA Tickets (${rumiEnhancement.automaticTickets.rta.length})</span>
                                        <button id="copy-auto-rta-ids" class="rumi-enhancement-button" style="font-size: 11px; padding: 4px 8px;">COPY IDs</button>
                                    </div>
                                    <div id="rumi-auto-rta-tickets" style="max-height: 400px; overflow-y: auto; border: 1px solid #E0E0E0; padding: 12px; background: white; border-radius: 2px; font-size: 13px;">
                                        ${rumiEnhancement.automaticTickets.rta.length === 0 ? '<div style="text-align: center; color: #666666; padding: 20px;">No automatic RTA tickets yet</div>' : ''}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- MANUAL PROCESS TAB -->
                <div class="rumi-main-tab-panel ${rumiEnhancement.activeTab === 'manual' ? 'active' : ''}" id="rumi-manual-tab">
                    <!-- Manual Metrics Row -->
                    <div class="rumi-metrics-row">
                        <div class="rumi-metric-box">
                            <span class="rumi-metric-value" id="metric-manual-solved">${rumiEnhancement.manualTickets.solved.length}</span>
                            <div class="rumi-metric-label">Solved</div>
                        </div>
                        <div class="rumi-metric-box">
                            <span class="rumi-metric-value" id="metric-manual-pending">${rumiEnhancement.manualTickets.pending.length}</span>
                            <div class="rumi-metric-label">Pending</div>
                        </div>
                        <div class="rumi-metric-box">
                            <span class="rumi-metric-value" id="metric-manual-rta">${rumiEnhancement.manualTickets.rta.length}</span>
                            <div class="rumi-metric-label">RTA</div>
                        </div>
                    </div>

                    <!-- Export Ticket IDs by View -->
                    <div class="rumi-enhancement-section">
                        <h3>Export Ticket IDs by View</h3>
                        <div class="rumi-manual-export-simple">
                            <div class="rumi-export-simple-item">
                                <span class="rumi-export-view-name">SSOC - Open - Urgent</span>
                                <button class="rumi-manual-export-btn rumi-enhancement-button" data-view-id="360002226448" data-view-name="SSOC - Open - Urgent" title="Copy ticket IDs">${downloadIconSVG}</button>
                            </div>
                            <div class="rumi-export-simple-item">
                                <span class="rumi-export-view-name">SSOC - GCC & EM Open</span>
                                <button class="rumi-manual-export-btn rumi-enhancement-button" data-view-id="325978088" data-view-name="SSOC - GCC & EM Open" title="Copy ticket IDs">${downloadIconSVG}</button>
                            </div>
                            <div class="rumi-export-simple-item">
                                <span class="rumi-export-view-name">SSOC - Egypt Urgent</span>
                                <button class="rumi-manual-export-btn rumi-enhancement-button" data-view-id="360069695114" data-view-name="SSOC - Egypt Urgent" title="Copy ticket IDs">${downloadIconSVG}</button>
                            </div>
                            <div class="rumi-export-simple-item">
                                <span class="rumi-export-view-name">SSOC - Egypt Open</span>
                                <button class="rumi-manual-export-btn rumi-enhancement-button" data-view-id="360000843468" data-view-name="SSOC - Egypt Open" title="Copy ticket IDs">${downloadIconSVG}</button>
                            </div>
                            <div class="rumi-export-simple-item">
                                <span class="rumi-export-view-name">SSOC - Pending - Urgent</span>
                                <button class="rumi-manual-export-btn rumi-enhancement-button" data-view-id="360003923428" data-view-name="SSOC - Pending - Urgent" title="Copy ticket IDs">${downloadIconSVG}</button>
                            </div>
                            <div class="rumi-export-simple-item">
                                <span class="rumi-export-view-name">SSOC - GCC & EM Pending</span>
                                <button class="rumi-manual-export-btn rumi-enhancement-button" data-view-id="360000842448" data-view-name="SSOC - GCC & EM Pending" title="Copy ticket IDs">${downloadIconSVG}</button>
                            </div>
                            <div class="rumi-export-simple-item">
                                <span class="rumi-export-view-name">SSOC - Egypt Pending</span>
                                <button class="rumi-manual-export-btn rumi-enhancement-button" data-view-id="360002386547" data-view-name="SSOC - Egypt Pending" title="Copy ticket IDs">${downloadIconSVG}</button>
                            </div>
                        </div>
                    </div>

                    <!-- Test Ticket IDs -->
                    <div class="rumi-enhancement-section">
                        <h3>Test Ticket IDs (comma-separated):</h3>
                        <div style="display: flex; gap: 8px; margin-bottom: 8px;">
                            <input type="text" id="rumi-test-ticket-id" placeholder="117000000, 117000111, 177000222" style="flex: 1;" />
                            <button id="rumi-test-ticket" class="rumi-enhancement-button rumi-enhancement-button-primary">Process</button>
                        </div>
                        <div style="margin-top: 12px;">
                            <label style="display: flex; align-items: center; gap: 8px;">
                                <input type="checkbox" id="rumi-manual-dry-run" ${rumiEnhancement.dryRunModes.manual ? 'checked' : ''}>
                                Dry Run Mode
                        </div>
                    </div>


                    <!-- Testing Results -->
                    <div class="rumi-enhancement-section">
                        <h3>Testing Results</h3>
                        <div class="rumi-result-card selected" data-category="unprocessed" style="margin-bottom: 12px;">
                            <button id="rumi-export-unprocessed" class="rumi-enhancement-button">EXPORT UNPROCESSED</button>
                        </div>
                        <div id="rumi-test-result" style="padding: 12px; border-radius: 2px; font-size: 13px; border: 1px solid #E0E0E0; background: white; max-height: 300px; overflow-y: auto;">
                            <div style="text-align: center; color: #666666;">No test results yet</div>
                        </div>
                    </div>

                    <!-- Manual Processed Tickets -->
                    <div class="rumi-enhancement-section">
                        <h3>Processed Tickets</h3>
                        <div class="rumi-tabs">
                            <div class="rumi-tab-headers">
                                <button class="rumi-tab-header active" data-tab="manual-solved">Solved</button>
                                <button class="rumi-tab-header" data-tab="manual-pending">Pending</button>
                                <button class="rumi-tab-header" data-tab="manual-rta">RTA</button>
                            </div>
                            <div class="rumi-tab-content">
                                <div class="rumi-tab-panel active" id="rumi-manual-solved-tab">
                                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                                        <span style="font-size: 12px; color: #666;">Manual Solved Tickets (${rumiEnhancement.manualTickets.solved.length})</span>
                                        <button id="copy-manual-solved-ids" class="rumi-enhancement-button" style="font-size: 11px; padding: 4px 8px;">COPY IDs</button>
                                    </div>
                                    <div id="rumi-manual-solved-tickets" style="max-height: 400px; overflow-y: auto; border: 1px solid #E0E0E0; padding: 12px; background: white; border-radius: 2px; font-size: 13px;">
                                        ${rumiEnhancement.manualTickets.solved.length === 0 ? '<div style="text-align: center; color: #666666; padding: 20px;">No manual solved tickets yet</div>' : ''}
                                    </div>
                                </div>
                                <div class="rumi-tab-panel" id="rumi-manual-pending-tab">
                                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                                        <span style="font-size: 12px; color: #666;">Manual Pending Tickets (${rumiEnhancement.manualTickets.pending.length})</span>
                                        <button id="copy-manual-pending-ids" class="rumi-enhancement-button" style="font-size: 11px; padding: 4px 8px;">COPY IDs</button>
                                    </div>
                                    <div id="rumi-manual-pending-tickets" style="max-height: 400px; overflow-y: auto; border: 1px solid #E0E0E0; padding: 12px; background: white; border-radius: 2px; font-size: 13px;">
                                        ${rumiEnhancement.manualTickets.pending.length === 0 ? '<div style="text-align: center; color: #666666; padding: 20px;">No manual pending tickets yet</div>' : ''}
                                    </div>
                                </div>
                                <div class="rumi-tab-panel" id="rumi-manual-rta-tab">
                                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                                        <span style="font-size: 12px; color: #666;">Manual RTA Tickets (${rumiEnhancement.manualTickets.rta.length})</span>
                                        <button id="copy-manual-rta-ids" class="rumi-enhancement-button" style="font-size: 11px; padding: 4px 8px;">COPY IDs</button>
                                    </div>
                                    <div id="rumi-manual-rta-tickets" style="max-height: 400px; overflow-y: auto; border: 1px solid #E0E0E0; padding: 12px; background: white; border-radius: 2px; font-size: 13px;">
                                        ${rumiEnhancement.manualTickets.rta.length === 0 ? '<div style="text-align: center; color: #666666; padding: 20px;">No manual RTA tickets yet</div>' : ''}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- DATA & STATISTICS TAB -->
                <div class="rumi-main-tab-panel ${rumiEnhancement.activeTab === 'data' ? 'active' : ''}" id="rumi-data-tab">
                    <!-- Session Statistics -->
                    <div class="rumi-enhancement-section">
                        <h3>Session Statistics</h3>
                        <div style="margin-top: 12px; padding: 8px; background: #F8F9FA; border-radius: 2px; border: 1px solid #E0E0E0;">
                            <div id="rumi-monitoring-stats" style="font-size: 11px; color: #333;">
                                <div id="rumi-session-info"></div>
                                <div id="rumi-total-time"></div>
                                <div id="rumi-current-timer" style="color: #007BFF; font-weight: bold;"></div>
                            </div>
                        </div>
                    </div>

                    <!-- System Statistics -->
                    <div class="rumi-enhancement-section">
                        <h3>System Statistics</h3>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px;">
                            <div style="padding: 8px; border: 1px solid #E0E0E0; border-radius: 2px; text-align: center; background: white;">
                                <div style="font-size: 18px; font-weight: bold; color: #007BFF;" id="metric-api-calls">${rumiEnhancement.apiCallCount}</div>
                                <div style="font-size: 11px; color: #666;">API Calls</div>
                            </div>
                            <div style="padding: 8px; border: 1px solid #E0E0E0; border-radius: 2px; text-align: center; background: white;">
                                <div style="font-size: 18px; font-weight: bold; color: #DC3545;" id="metric-errors">${rumiEnhancement.consecutiveErrors}</div>
                                <div style="font-size: 11px; color: #666;">Errors</div>
                            </div>
                        </div>
                        <div style="margin: 16px 0; display: flex; gap: 20px;">
                            <label style="display: flex; align-items: center; gap: 8px;"><input type="checkbox" id="rumi-debug-mode" ${rumiEnhancement.currentLogLevel === 3 ? 'checked' : ''}> Debug Mode</label>
                        </div>
                    </div>

                    <!-- Automation Logs -->
                    <div class="rumi-enhancement-section">
                        <h3>Automation Logs</h3>
                        <div style="margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center;">
                            <div style="display: flex; gap: 8px; align-items: center;">
                                <label style="font-size: 12px; color: #666;">Show:</label>
                                <select id="rumi-log-filter" style="font-size: 12px; padding: 2px 6px;">
                                    <option value="all">All Logs</option>
                                    <option value="info">Info & Above</option>
                                    <option value="warn">Warnings & Errors</option>
                                    <option value="error">Errors Only</option>
                                </select>
                            </div>
                            <button id="rumi-clear-logs" class="rumi-enhancement-button" style="font-size: 11px; padding: 4px 8px;">CLEAR LOGS</button>
                        </div>
                        <div id="rumi-log-container" style="height: 200px; overflow-y: auto; border: 1px solid #E0E0E0; padding: 8px; background: white; border-radius: 2px; font-family: 'Courier New', monospace; font-size: 12px;">
                            <div style="text-align: center; color: #666; padding: 20px;">No logs yet</div>
                        </div>
                    </div>

                    <!-- Data Management -->
                    <div class="rumi-enhancement-section">
                        <h3>Data Management</h3>
                        <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
                            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                                <button id="rumi-export-config" class="rumi-enhancement-button">EXPORT CONFIG</button>
                                <button id="rumi-export-all-data" class="rumi-enhancement-button">EXPORT ALL DATA</button>
                                <button id="rumi-deduplicate-tickets" class="rumi-enhancement-button">FIX DUPLICATES</button>
                            </div>
                            <button id="rumi-clear-history" class="rumi-enhancement-button" style="background: #dc3545 !important; border-color: #dc3545 !important; color: white !important;">CLEAR ALL DATA</button>
                        </div>
                    </div>

                    <!-- Trigger Phrases -->
                    <div class="rumi-enhancement-section">
                        <details>
                            <summary style="font-size: 13px;">Pending Trigger Phrases (${rumiEnhancement.pendingTriggerPhrases.length} total)</summary>
                            <div style="margin: 12px 0 8px 0; display: flex; gap: 8px;">
                                <button id="pending-select-all" style="padding: 4px 8px; font-size: 11px; background: #007cbb; color: white; border: none; border-radius: 2px; cursor: pointer;">Select All</button>
                                <button id="pending-clear-all" style="padding: 4px 8px; font-size: 11px; background: #dc3545; color: white; border: none; border-radius: 2px; cursor: pointer;">Clear All</button>
                            </div>
                            <div style="margin-top: 12px; max-height: 200px; overflow-y: auto; border: 1px solid #E0E0E0; border-radius: 2px; background: white;">
                                ${rumiEnhancement.pendingTriggerPhrases.map((phrase, index) =>
        `<div style="margin-bottom: 0; padding: 8px 12px; border-bottom: 1px solid #F0F0F0; font-size: 12px; line-height: 1.4;">
                                        <div style="display: flex; align-items: center; margin-bottom: 4px;">
                                            <input type="checkbox" id="pending-phrase-${index}" ${rumiEnhancement.enabledPendingPhrases && rumiEnhancement.enabledPendingPhrases[index] !== false ? 'checked' : ''} style="margin-right: 8px;">
                                            <div style="color: #666666; font-weight: bold;">Phrase ${index + 1}:</div>
                                        </div>
                                        <div style="color: #333333; word-wrap: break-word;">"${phrase}"</div>
                                    </div>`
    ).join('')}
                            </div>
                        </details>
                        <details style="margin-top: 16px;">
                            <summary style="font-size: 13px;">Solved Trigger Phrases (${rumiEnhancement.solvedTriggerPhrases.length} total)</summary>
                            <div style="margin: 12px 0 8px 0; display: flex; gap: 8px;">
                                <button id="solved-select-all" style="padding: 4px 8px; font-size: 11px; background: #007cbb; color: white; border: none; border-radius: 2px; cursor: pointer;">Select All</button>
                                <button id="solved-clear-all" style="padding: 4px 8px; font-size: 11px; background: #dc3545; color: white; border: none; border-radius: 2px; cursor: pointer;">Clear All</button>
                            </div>
                            <div style="margin-top: 12px; max-height: 200px; overflow-y: auto; border: 1px solid #E0E0E0; border-radius: 2px; background: white;">
                                ${rumiEnhancement.solvedTriggerPhrases.map((phrase, index) =>
        `<div style="margin-bottom: 0; padding: 8px 12px; border-bottom: 1px solid #F0F0F0; font-size: 12px; line-height: 1.4;">
                                        <div style="display: flex; align-items: center; margin-bottom: 4px;">
                                            <input type="checkbox" id="solved-phrase-${index}" ${rumiEnhancement.enabledSolvedPhrases && rumiEnhancement.enabledSolvedPhrases[index] !== false ? 'checked' : ''} style="margin-right: 8px;">
                                            <div style="color: #666666; font-weight: bold;">Phrase ${index + 1}:</div>
                                        </div>
                                        <div style="color: #333333; word-wrap: break-word;">"${phrase}"</div>
                                    </div>`
    ).join('')}
                            </div>
                        </details>
                    </div>
                </div>

            </div>
        `;

        overlay.appendChild(panel);
        document.body.appendChild(overlay);

        // Attach event listeners
        attachRUMIEnhancementEventListeners();

        // Update processed tickets display
        updateProcessedTicketsDisplay();


        // Load saved selections
        loadRUMIEnhancementSelections();

        // Update selected count
        updateSelectedViewsCount();

        // Update UI based on restored settings
        updateRUMIEnhancementUI();

        // Start monitoring timer if currently monitoring
        if (rumiEnhancement.isMonitoring) {
            startMonitoringTimer();
        }

        // Auto-deduplicate existing data on panel creation
        setTimeout(() => {
            const result = RUMIStorage.deduplicateProcessedTickets();
            if (result) {
                const removedCount = (result.before.pending - result.after.pending) +
                                  (result.before.solved - result.after.solved) +
                                  (result.before.rta - result.after.rta);
                if (removedCount > 0) {
                    RUMILogger.info('DATA', `Auto-cleanup: Removed ${removedCount} duplicate entries on startup`);
                    updateRUMIEnhancementUI();
                    updateProcessedTicketsDisplay();
                }
            }
        }, 1000);

        RUMILogger.info('RUMI Enhancement panel created');
    }



    // Safe wrapper to prevent UI freezing
    async function safeCreateRUMIEnhancementPanel() {
        try {
            await createRUMIEnhancementPanel();
        } catch (error) {
            RUMILogger.error('UI', 'Critical error creating panel', error);
            // Create a minimal error panel
            const existingPanel = document.getElementById('rumi-enhancement-panel');
            if (existingPanel) existingPanel.remove();

            const errorPanel = document.createElement('div');
            errorPanel.className = 'rumi-enhancement-overlay';
            errorPanel.id = 'rumi-enhancement-panel';
            errorPanel.innerHTML = `
                <div class="rumi-enhancement-panel" style="padding: 20px; text-align: center;">
                    <h3>RUMI Enhancement - Error</h3>
                    <p style="color: #dc3545;">Panel failed to load. Please refresh the page.</p>
                    <button onclick="this.parentElement.parentElement.remove()">Close</button>
                </div>
            `;
            document.body.appendChild(errorPanel);
        }
    }

    function attachRUMIEnhancementEventListeners() {
        // Close panel (hide instead of remove to preserve state)
        document.getElementById('rumi-close-panel')?.addEventListener('click', () => {
            const panel = document.getElementById('rumi-enhancement-panel');
            if (panel) {
                panel.classList.add('rumi-hidden');
            }
        });

        // Main tab switching
        document.querySelectorAll('.rumi-main-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const targetTab = tab.getAttribute('data-maintab');

                // Remove active class from all tabs and panels
                document.querySelectorAll('.rumi-main-tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.rumi-main-tab-panel').forEach(p => p.classList.remove('active'));

                // Add active class to clicked tab and corresponding panel
                tab.classList.add('active');
                document.getElementById(`rumi-${targetTab}-tab`)?.classList.add('active');

                // Save active tab state
                rumiEnhancement.activeTab = targetTab;
                RUMIStorage.saveMonitoringState();
            });
        });

        // Start/Stop monitoring
        document.getElementById('rumi-start-stop')?.addEventListener('click', async () => {
            if (rumiEnhancement.isMonitoring) {
                await RUMIViewMonitor.stopMonitoring();
            } else {
                try {
                    await RUMIViewMonitor.startMonitoring();
                } catch (error) {
                    alert(`Failed to start monitoring: ${error.message}`);
                }
            }
        });

        // Modern view selection
        document.getElementById('rumi-view-grid')?.addEventListener('click', (e) => {
            const viewItem = e.target.closest('.rumi-view-item');
            if (!viewItem) return;

            const viewId = viewItem.dataset.viewId;
            const checkbox = viewItem.querySelector('.rumi-view-checkbox');

            // Toggle selection
            if (rumiEnhancement.selectedViews.has(viewId)) {
                rumiEnhancement.selectedViews.delete(viewId);
                checkbox.checked = false;
                viewItem.classList.remove('selected');
            } else {
                rumiEnhancement.selectedViews.add(viewId);
                checkbox.checked = true;
                viewItem.classList.add('selected');
            }

            updateSelectedViewsCount();
            saveRUMIEnhancementSelections();
            updateRUMIEnhancementUI();
        });

        // Handle direct checkbox clicks
        document.getElementById('rumi-view-grid')?.addEventListener('change', (e) => {
            if (e.target.classList.contains('rumi-view-checkbox')) {
                const viewItem = e.target.closest('.rumi-view-item');
                const viewId = viewItem.dataset.viewId;

                if (e.target.checked) {
                    rumiEnhancement.selectedViews.add(viewId);
                    viewItem.classList.add('selected');
                } else {
                    rumiEnhancement.selectedViews.delete(viewId);
                    viewItem.classList.remove('selected');
                }

                updateSelectedViewsCount();
                saveRUMIEnhancementSelections();
                updateRUMIEnhancementUI();
            }
        });

        // Select all views
        document.getElementById('rumi-select-all')?.addEventListener('click', () => {
            const viewItems = document.querySelectorAll('.rumi-view-item');
            rumiEnhancement.selectedViews.clear();

            viewItems.forEach(item => {
                const viewId = item.dataset.viewId;
                const checkbox = item.querySelector('.rumi-view-checkbox');

                rumiEnhancement.selectedViews.add(viewId);
                checkbox.checked = true;
                item.classList.add('selected');
            });

            updateSelectedViewsCount();
            saveRUMIEnhancementSelections();
            updateRUMIEnhancementUI();
        });

        // Clear all views
        document.getElementById('rumi-clear-all')?.addEventListener('click', () => {
            const viewItems = document.querySelectorAll('.rumi-view-item');
            rumiEnhancement.selectedViews.clear();

            viewItems.forEach(item => {
                const checkbox = item.querySelector('.rumi-view-checkbox');
                checkbox.checked = false;
                item.classList.remove('selected');
            });

            updateSelectedViewsCount();
            saveRUMIEnhancementSelections();
            updateRUMIEnhancementUI();
        });

        // Settings
        document.getElementById('rumi-interval-slider')?.addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            rumiEnhancement.config.CHECK_INTERVAL = value * 1000;
            document.getElementById('rumi-interval-display').textContent = `${value}s`;

            // Restart monitoring with new interval if active
            if (rumiEnhancement.isMonitoring) {
                RUMIViewMonitor.stopMonitoring();
                setTimeout(() => RUMIViewMonitor.startMonitoring(), 100);
            }
        });

        // Log panel controls
        document.getElementById('rumi-log-filter')?.addEventListener('change', () => {
            RUMILogger.updateLogDisplay();
        });

        document.getElementById('rumi-clear-logs')?.addEventListener('click', () => {
            rumiEnhancement.automationLogs = [];
            RUMILogger.updateLogDisplay();
        });

        // Setup log scroll detection for smart autoscroll
        setTimeout(() => {
            RUMILogger.setupLogScrollDetection();
        }, 100);

        document.getElementById('rumi-debug-mode')?.addEventListener('change', (e) => {
            rumiEnhancement.currentLogLevel = e.target.checked ? 3 : 2;
        });

        // Data management buttons
        document.getElementById('rumi-export-all-data')?.addEventListener('click', () => {
            const allData = {
                processedTickets: {
                    processedHistory: rumiEnhancement.processedHistory,
                    pendingTickets: rumiEnhancement.pendingTickets,
                    solvedTickets: rumiEnhancement.solvedTickets,
                    rtaTickets: rumiEnhancement.rtaTickets,
                    processedTickets: Array.from(rumiEnhancement.processedTickets)
                },
                automationLogs: rumiEnhancement.automationLogs,
                ticketHistory: Array.from(rumiEnhancement.ticketStatusHistory.entries()),
                monitoringState: {
                    selectedViews: Array.from(rumiEnhancement.selectedViews),
                    isDryRun: rumiEnhancement.isDryRun,
                    currentLogLevel: rumiEnhancement.currentLogLevel,
                    operationModes: rumiEnhancement.operationModes,
                    checkInterval: rumiEnhancement.config.CHECK_INTERVAL
                },
                exportedAt: new Date().toISOString()
            };

            const blob = new Blob([JSON.stringify(allData, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `rumi-data-${new Date().toISOString().split('T')[0]}.json`;
            a.click();
            URL.revokeObjectURL(url);
            RUMILogger.info('Exported all RUMI data');
        });

        document.getElementById('rumi-clean-old-data')?.addEventListener('click', () => {
            if (confirm('Clean data older than 7 days? This will remove old processed tickets, logs, and ticket history.')) {
                RUMIStorage.clearOldData(7);
                updateProcessedTicketsDisplay();
                updateRUMIEnhancementUI();
                RUMILogger.updateLogDisplay();
            }
        });

        // Automatic process dry run mode
        document.getElementById('rumi-automatic-dry-run')?.addEventListener('change', (e) => {
            rumiEnhancement.dryRunModes.automatic = e.target.checked;
            // Update legacy isDryRun for backward compatibility with automatic processes
            rumiEnhancement.isDryRun = e.target.checked;
            RUMIStorage.saveMonitoringState(); // Save settings
            RUMILogger.info(`Automatic dry run mode: ${e.target.checked ? 'ON' : 'OFF'}`);
        });

        // Manual process dry run mode
        document.getElementById('rumi-manual-dry-run')?.addEventListener('change', (e) => {
            rumiEnhancement.dryRunModes.manual = e.target.checked;
            RUMIStorage.saveMonitoringState(); // Save settings
            RUMILogger.info(`Manual dry run mode: ${e.target.checked ? 'ON' : 'OFF'}`);
        });

        // Operation modes checkboxes
        document.getElementById('rumi-operation-pending')?.addEventListener('change', (e) => {
            rumiEnhancement.operationModes.pending = e.target.checked;
            RUMIStorage.saveMonitoringState(); // Save settings
            RUMILogger.info(`Pending operations ${e.target.checked ? 'enabled' : 'disabled'}`);
        });
        document.getElementById('rumi-operation-solved')?.addEventListener('change', (e) => {
            rumiEnhancement.operationModes.solved = e.target.checked;
            RUMIStorage.saveMonitoringState(); // Save settings
            RUMILogger.info('SETTINGS', `Solved operations ${e.target.checked ? 'enabled' : 'disabled'}`);
        });
        document.getElementById('rumi-operation-rta')?.addEventListener('change', (e) => {
            rumiEnhancement.operationModes.rta = e.target.checked;
            RUMIStorage.saveMonitoringState(); // Save settings
            RUMILogger.info('SETTINGS', `RTA operations ${e.target.checked ? 'enabled' : 'disabled'}`);
        });

        // Tab functionality
        document.querySelectorAll('.rumi-tab-header').forEach(header => {
            header.addEventListener('click', (e) => {
                const targetTab = e.target.dataset.tab;

                // Remove active class from all headers and panels
                document.querySelectorAll('.rumi-tab-header').forEach(h => h.classList.remove('active'));
                document.querySelectorAll('.rumi-tab-panel').forEach(p => p.classList.remove('active'));

                // Add active class to clicked header and corresponding panel
                e.target.classList.add('active');
                document.getElementById(`rumi-${targetTab}-tab`).classList.add('active');
            });
        });

        // Copy ticket IDs functionality (legacy)
        document.getElementById('copy-pending-ids')?.addEventListener('click', () => {
            copyTicketIds(rumiEnhancement.pendingTickets, 'pending');
        });
        document.getElementById('copy-solved-ids')?.addEventListener('click', () => {
            copyTicketIds(rumiEnhancement.solvedTickets, 'solved');
        });
        document.getElementById('copy-rta-ids')?.addEventListener('click', () => {
            copyTicketIds(rumiEnhancement.rtaTickets, 'RTA');
        });

        // Copy automatic ticket IDs functionality
        document.getElementById('copy-auto-solved-ids')?.addEventListener('click', () => {
            copyTicketIds(rumiEnhancement.automaticTickets.solved, 'automatic solved');
        });
        document.getElementById('copy-auto-pending-ids')?.addEventListener('click', () => {
            copyTicketIds(rumiEnhancement.automaticTickets.pending, 'automatic pending');
        });
        document.getElementById('copy-auto-rta-ids')?.addEventListener('click', () => {
            copyTicketIds(rumiEnhancement.automaticTickets.rta, 'automatic RTA');
        });

        // Copy manual ticket IDs functionality
        document.getElementById('copy-manual-solved-ids')?.addEventListener('click', () => {
            copyTicketIds(rumiEnhancement.manualTickets.solved, 'manual solved');
        });
        document.getElementById('copy-manual-pending-ids')?.addEventListener('click', () => {
            copyTicketIds(rumiEnhancement.manualTickets.pending, 'manual pending');
        });
        document.getElementById('copy-manual-rta-ids')?.addEventListener('click', () => {
            copyTicketIds(rumiEnhancement.manualTickets.rta, 'manual RTA');
        });

        // Initialize phrase enable/disable arrays if not already set
        if (!rumiEnhancement.enabledPendingPhrases) {
            rumiEnhancement.enabledPendingPhrases = new Array(rumiEnhancement.pendingTriggerPhrases.length).fill(true);
        }
        // Ensure arrays match current phrase count (in case phrases were added/removed)
        if (rumiEnhancement.enabledPendingPhrases.length !== rumiEnhancement.pendingTriggerPhrases.length) {
            const newArray = new Array(rumiEnhancement.pendingTriggerPhrases.length).fill(true);
            // Preserve existing settings for phrases that still exist
            for (let i = 0; i < Math.min(rumiEnhancement.enabledPendingPhrases.length, newArray.length); i++) {
                newArray[i] = rumiEnhancement.enabledPendingPhrases[i];
            }
            rumiEnhancement.enabledPendingPhrases = newArray;
        }

        if (!rumiEnhancement.enabledSolvedPhrases) {
            rumiEnhancement.enabledSolvedPhrases = new Array(rumiEnhancement.solvedTriggerPhrases.length).fill(true);
        }
        // Ensure arrays match current phrase count (in case phrases were added/removed)
        if (rumiEnhancement.enabledSolvedPhrases.length !== rumiEnhancement.solvedTriggerPhrases.length) {
            const newArray = new Array(rumiEnhancement.solvedTriggerPhrases.length).fill(true);
            // Preserve existing settings for phrases that still exist
            for (let i = 0; i < Math.min(rumiEnhancement.enabledSolvedPhrases.length, newArray.length); i++) {
                newArray[i] = rumiEnhancement.enabledSolvedPhrases[i];
            }
            rumiEnhancement.enabledSolvedPhrases = newArray;
        }

        // Add event listeners for phrase checkboxes
        rumiEnhancement.pendingTriggerPhrases.forEach((phrase, index) => {
            const checkbox = document.getElementById(`pending-phrase-${index}`);
            if (checkbox) {
                checkbox.addEventListener('change', (e) => {
                    rumiEnhancement.enabledPendingPhrases[index] = e.target.checked;
                    RUMIStorage.saveMonitoringState(); // Save settings
                    RUMILogger.info('SETTINGS', `Pending phrase ${index + 1} ${e.target.checked ? 'enabled' : 'disabled'}`);
                });
            }
        });

        rumiEnhancement.solvedTriggerPhrases.forEach((phrase, index) => {
            const checkbox = document.getElementById(`solved-phrase-${index}`);
            if (checkbox) {
                checkbox.addEventListener('change', (e) => {
                    rumiEnhancement.enabledSolvedPhrases[index] = e.target.checked;
                    RUMIStorage.saveMonitoringState(); // Save settings
                    RUMILogger.info('SETTINGS', `Solved phrase ${index + 1} ${e.target.checked ? 'enabled' : 'disabled'}`);
                });
            }
        });

        // Select All / Clear All buttons for pending phrases
        document.getElementById('pending-select-all')?.addEventListener('click', () => {
            for (let i = 0; i < rumiEnhancement.pendingTriggerPhrases.length; i++) {
                rumiEnhancement.enabledPendingPhrases[i] = true;
                const checkbox = document.getElementById(`pending-phrase-${i}`);
                if (checkbox) {
                    checkbox.checked = true;
                }
            }
            RUMIStorage.saveMonitoringState();
            RUMILogger.info('SETTINGS', 'All pending trigger phrases enabled');
        });

        document.getElementById('pending-clear-all')?.addEventListener('click', () => {
            for (let i = 0; i < rumiEnhancement.pendingTriggerPhrases.length; i++) {
                rumiEnhancement.enabledPendingPhrases[i] = false;
                const checkbox = document.getElementById(`pending-phrase-${i}`);
                if (checkbox) {
                    checkbox.checked = false;
                }
            }
            RUMIStorage.saveMonitoringState();
            RUMILogger.info('SETTINGS', 'All pending trigger phrases disabled');
        });

        // Select All / Clear All buttons for solved phrases
        document.getElementById('solved-select-all')?.addEventListener('click', () => {
            for (let i = 0; i < rumiEnhancement.solvedTriggerPhrases.length; i++) {
                rumiEnhancement.enabledSolvedPhrases[i] = true;
                const checkbox = document.getElementById(`solved-phrase-${i}`);
                if (checkbox) {
                    checkbox.checked = true;
                }
            }
            RUMIStorage.saveMonitoringState();
            RUMILogger.info('SETTINGS', 'All solved trigger phrases enabled');
        });

        document.getElementById('solved-clear-all')?.addEventListener('click', () => {
            for (let i = 0; i < rumiEnhancement.solvedTriggerPhrases.length; i++) {
                rumiEnhancement.enabledSolvedPhrases[i] = false;
                const checkbox = document.getElementById(`solved-phrase-${i}`);
                if (checkbox) {
                    checkbox.checked = false;
                }
            }
            RUMIStorage.saveMonitoringState();
            RUMILogger.info('SETTINGS', 'All solved trigger phrases disabled');
        });

        // Clear history
        document.getElementById('rumi-clear-history')?.addEventListener('click', () => {
            rumiEnhancement.processedHistory = [];
            updateProcessedTicketsDisplay();
        });

        // Export config functionality
        document.getElementById('rumi-export-config')?.addEventListener('click', () => {
            const exportData = {
                timestamp: new Date().toISOString(),
                processedTickets: rumiEnhancement.processedHistory,
                selectedViews: Array.from(rumiEnhancement.selectedViews),
                config: rumiEnhancement.config,
                metrics: {
                    totalProcessed: rumiEnhancement.processedHistory.length,
                    apiCalls: rumiEnhancement.apiCallCount,
                    consecutiveErrors: rumiEnhancement.consecutiveErrors,
                    selectedViews: rumiEnhancement.selectedViews.size
                }
            };

            const dataStr = JSON.stringify(exportData, null, 2);
            const dataBlob = new Blob([dataStr], { type: 'application/json' });
            const url = URL.createObjectURL(dataBlob);

            const link = document.createElement('a');
            link.href = url;
            link.download = `rumi-enhancement-config-${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);

            RUMILogger.info('UI', 'Config exported successfully');
        });

        // Export unprocessed tickets functionality
        document.getElementById('rumi-export-unprocessed')?.addEventListener('click', async () => {
            // Use the full unprocessed tickets data instead of just IDs
            const unprocessedTickets = window.rumiTestResults?.unprocessed;

            if (!unprocessedTickets || unprocessedTickets.length === 0) {
                showExportToast('No unprocessed tickets');
                return;
            }

            // Format tickets as plain text - only ticket number and subject
            const formattedContent = unprocessedTickets.map(ticket => {
                const ticketId = ticket.id;
                const subject = ticket.details?.subject || 'Unknown Subject';
                return `#${ticketId} Subject: ${subject}`;
            }).join('\n');

            const success = await RUMICSVUtils.copyToClipboard(formattedContent);

            if (success) {
                showExportToast('Exported');
            } else {
                showExportToast('Export failed');
            }
        });

        // Test specific ticket(s)
        document.getElementById('rumi-test-ticket')?.addEventListener('click', async () => {
            const ticketIdInput = document.getElementById('rumi-test-ticket-id');
            const ticketIds = ticketIdInput.value.trim();

            if (!ticketIds) {
                showTestResult(`
                    <div style="text-align: center; padding: 15px;">
                        <strong style="color: #ff6666;">❌ INPUT REQUIRED</strong><br>
                        Please enter at least one ticket ID to test.
                    </div>
                `, 'error');
                return;
            }

            // Parse comma-separated ticket IDs
            const ticketIdList = ticketIds.split(',').map(id => id.trim()).filter(id => id && /^\d+$/.test(id));

            if (ticketIdList.length === 0) {
                showTestResult(`
                    <div style="text-align: center; padding: 15px;">
                        <strong style="color: #ff6666;">❌ INVALID INPUT</strong><br>
                        Please enter valid numeric ticket ID(s).<br>
                        <small>Example: 117000000, 117000111, 117000222</small>
                    </div>
                `, 'error');
                return;
            }

            showTestResult(`
                <div style="text-align: center; padding: 15px;">
                    <strong style="color: #66d9ff;">🚀 BATCH TESTING INITIATED</strong><br>
                    Testing ${ticketIdList.length} ticket(s)... Please wait.
                </div>
            `, 'info');

            try {
                let results = [];
                let successCount = 0;
                let errorCount = 0;
                let matchCount = 0;

                // Process all tickets concurrently for maximum speed
                const startTime = Date.now();

                // Show initial processing message
                showTestResult(`
                    <div style="text-align: center; padding: 15px;">
                        <strong style="color: #66d9ff;">Processing Tickets</strong><br>
                        Processing ${ticketIdList.length} tickets simultaneously...<br>
                        <div id="progress-counter" style="margin-top: 8px; font-size: 14px; color: #333;">
                            <strong>Progress: 0 / ${ticketIdList.length}</strong>
                        </div>
                    </div>
                `, 'info');

                // Progress tracking
                let completedCount = 0;
                const updateProgress = () => {
                    completedCount++;
                    const progressElement = document.getElementById('progress-counter');
                    if (progressElement) {
                        const percentage = Math.round((completedCount / ticketIdList.length) * 100);
                        progressElement.innerHTML = `
                            <strong>Progress: ${completedCount} / ${ticketIdList.length} (${percentage}%)</strong>
                            <div style="width: 100%; background-color: #e9ecef; border-radius: 4px; height: 8px; margin-top: 8px;">
                                <div style="width: ${percentage}%; background-color: #007bff; height: 100%; border-radius: 4px; transition: width 0.3s ease;"></div>
                            </div>
                        `;
                    }

                };

                // Create promises for all tickets - process them all at once
                const ticketPromises = ticketIdList.map(async (ticketId) => {
                    try {
                        // Use lightweight testing function for concurrent processing with manual dry run mode
                        const testResult = await testTicketFast(ticketId, rumiEnhancement.dryRunModes.manual);

                        // Update progress after each ticket completion
                        updateProgress();

                        return {
                            id: ticketId,
                            status: 'success',
                            message: 'Test completed successfully',
                            details: testResult
                        };
                    } catch (error) {
                        // Update progress even for errors
                        updateProgress();

                        return {
                            id: ticketId,
                            status: 'error',
                            message: error.message,
                            details: null
                        };
                    }
                });

                // Wait for all tickets to complete simultaneously
                results = await Promise.all(ticketPromises);

                // Calculate final metrics
                let actuallyProcessedCount = 0;
                results.forEach(result => {
                    if (result.status === 'success') {
                        successCount++;
                        if (result.details && result.details.matches) {
                            matchCount++;
                        }
                        if (result.details && result.details.processed) {
                            actuallyProcessedCount++;
                        }
                    } else {
                        errorCount++;
                    }
                });

                const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
                const avgTime = (parseFloat(totalTime) / ticketIdList.length).toFixed(2);

                // Update processed tickets display if tickets were actually processed
                if (actuallyProcessedCount > 0) {
                    updateProcessedTicketsDisplay();
                }

                // Create comprehensive batch summary with performance metrics
                const batchSummary = `
                    <div style="text-align: center; margin-bottom: 16px; padding: 12px; background: white; border: 1px solid #E0E0E0; border-radius: 2px;">
                        <strong style="color: #333333; font-size: 14px;">Testing Results</strong>
                        <div style="margin-top: 8px; color: #666; font-size: 12px;">
                            <strong>Mode:</strong> <span style="color: ${rumiEnhancement.dryRunModes.manual ? '#007bff' : '#28a745'}; font-weight: bold;">${rumiEnhancement.dryRunModes.manual ? '🧪 DRY RUN' : '🚀 LIVE PROCESSING'}</span><br>
                            Total Time: <strong>${totalTime}s</strong> | Average: <strong>${avgTime}s/ticket</strong> | Speed: <strong>${(ticketIdList.length / parseFloat(totalTime)).toFixed(1)} tickets/sec</strong>
                            ${actuallyProcessedCount > 0 ? `<br><strong style="color: #28a745;">Actually Processed: ${actuallyProcessedCount} tickets</strong>` : ''}
                        </div>
                        ${(() => {
                            const skippedTickets = results.filter(r => r.status === 'success' && r.details && !r.details.matches);
                            if (skippedTickets.length > 0) {
                                // Store unprocessed tickets for export button in Data Management section
                                window.rumiUnprocessedTickets = skippedTickets.map(r => r.id);
                                return `
                                    <div style="margin-top: 12px; padding-top: 8px; border-top: 1px solid #E0E0E0; text-align: center;">
                                        <div style="font-size: 12px; color: #666666;">
                                            <strong>${skippedTickets.length} unprocessed tickets</strong> - Use "Export Unprocessed" in Data Management section
                                        </div>
                                    </div>
                                `;
                            } else {
                                // Clear any stored unprocessed tickets
                                window.rumiUnprocessedTickets = null;
                                return '';
                            }
                        })()}
                    </div>

                    <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px;">
                        <div class="rumi-result-card" data-category="solved" style="background: white; padding: 12px; border-radius: 2px; border: 1px solid #E0E0E0; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.1); cursor: pointer; transition: all 0.2s;">
                            <span style="color: #007BFF; font-size: 18px; font-weight: bold; display: block;">${(() => { const processed = results.filter(r => r.details && r.details.matches); return processed.filter(r => r.details.action && r.details.action.includes('solved')).length; })()}</span>
                            <div style="color: #666666; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;">Solved</div>
                        </div>
                        <div class="rumi-result-card" data-category="pending" style="background: white; padding: 12px; border-radius: 2px; border: 1px solid #E0E0E0; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.1); cursor: pointer; transition: all 0.2s;">
                            <span style="color: #28A745; font-size: 18px; font-weight: bold; display: block;">${(() => { const processed = results.filter(r => r.details && r.details.matches); return processed.filter(r => !r.details.action.includes('solved') && !r.details.isHalaPattern && !(r.details.isSolvedPattern && r.details.assignee === '34980896869267') && !(r.details.action && r.details.action.includes('RTA'))).length; })()}</span>
                            <div style="color: #666666; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;">Pending</div>
                        </div>
                        <div class="rumi-result-card" data-category="rta" style="background: white; padding: 12px; border-radius: 2px; border: 1px solid #E0E0E0; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.1); cursor: pointer; transition: all 0.2s;">
                            <span style="color: #FFC107; font-size: 18px; font-weight: bold; display: block;">${(() => { const processed = results.filter(r => r.details && r.details.matches); return processed.filter(r => (r.details.isHalaPattern) || (r.details.isSolvedPattern && r.details.assignee === '34980896869267') || (r.details.action && r.details.action.includes('RTA'))).length; })()}</span>
                            <div style="color: #666666; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;">RTA</div>
                        </div>
                        <div class="rumi-result-card" data-category="unprocessed" style="background: white; padding: 12px; border-radius: 2px; border: 1px solid #E0E0E0; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.1); cursor: pointer; transition: all 0.2s;">
                            <span style="color: #DC3545; font-size: 18px; font-weight: bold; display: block;">${results.filter(r => r.status === 'success' && r.details && !r.details.matches || r.status === 'error').length}</span>
                            <div style="color: #666666; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;">Unprocessed</div>
                        </div>
                    </div>

                    <div id="rumi-unified-results" style="margin-top: 16px;">
                        <div style="text-align: center; color: #666; font-size: 12px; margin-bottom: 16px;">
                            Click on any category above to view the tickets
                        </div>
                        <div id="rumi-results-content" style="display: none;">
                            <!-- Content will be populated when cards are clicked -->
                        </div>
                    </div>


                    <div style="text-align: center; margin-top: 12px; padding: 12px; background: #E8F4FD; border: 1px solid #0066CC; border-radius: 2px;">
                        <strong style="color: #333333;">BATCH TESTING COMPLETED</strong><br>
                        <small style="color: #666666;">All ${ticketIdList.length} tickets have been processed</small>
                    </div>
                `;

                showTestResult(batchSummary, successCount === ticketIdList.length ? 'success' : (errorCount === ticketIdList.length ? 'error' : 'warning'));


                // Store results data and add click handlers
                setTimeout(() => {
                    // Store the results data for card interactions
                    // Debug: Log all action strings to understand the categorization
                    console.log('All processed tickets action strings:', results.filter(r => r.details && r.details.matches).map(r => r.details.action));

                    // More robust categorization logic
                    const allProcessedTickets = results.filter(r => r.details && r.details.matches);
                    const solvedResults = allProcessedTickets.filter(r => r.details.action && r.details.action.includes('solved'));
                    const rtaResults = allProcessedTickets.filter(r =>
                        (r.details.isHalaPattern) ||
                        (r.details.isSolvedPattern && r.details.assignee === '34980896869267') ||
                        (r.details.action && r.details.action.includes('RTA'))
                    );
                    const pendingResults = allProcessedTickets.filter(r =>
                        !r.details.action.includes('solved') &&
                        !r.details.isHalaPattern &&
                        !(r.details.isSolvedPattern && r.details.assignee === '34980896869267') &&
                        !(r.details.action && r.details.action.includes('RTA'))
                    );

                    console.log('Debug solved results:', solvedResults.length, solvedResults.map(r => r.details.action));
                    console.log('Debug pending results:', pendingResults.length, pendingResults.map(r => r.details.action));
                    console.log('Debug RTA results:', rtaResults.length);

                    window.rumiTestResults = {
                        solved: solvedResults,
                        pending: pendingResults,
                        rta: rtaResults,
                        unprocessed: results.filter(r => r.status === 'success' && r.details && !r.details.matches || r.status === 'error')
                    };


                    // Add click handlers to result cards
                    document.querySelectorAll('.rumi-result-card').forEach(card => {
                        card.addEventListener('click', () => {
                            const category = card.getAttribute('data-category');
                            const tickets = window.rumiTestResults[category] || [];

                            // Remove selected class from all cards
                            document.querySelectorAll('.rumi-result-card').forEach(c => c.classList.remove('selected'));
                            // Add selected class to clicked card
                            card.classList.add('selected');

                            // Show results content
                            const contentDiv = document.getElementById('rumi-results-content');
                            contentDiv.style.display = 'block';

                            if (tickets.length === 0) {
                                contentDiv.innerHTML = `<div style="text-align: center; color: #666; padding: 20px;">No ${category} tickets found</div>`;
                                return;
                            }

                            const categoryColors = {
                                solved: '#007BFF',
                                pending: '#28A745',
                                rta: '#FFC107',
                                unprocessed: '#DC3545'
                            };

                            const categoryNames = {
                                solved: 'Solved',
                                pending: 'Pending',
                                rta: 'RTA',
                                unprocessed: 'Unprocessed'
                            };

                            contentDiv.innerHTML = `
                                <div style="margin-bottom: 20px;">
                                    <div style="background: white; padding: 12px; border-radius: 4px 4px 0 0; border-left: 4px solid ${categoryColors[category]}; border: 1px solid #E0E0E0;">
                                        <strong style="color: ${categoryColors[category]}; font-size: 14px;">${categoryNames[category]} Tickets (${tickets.length})</strong>
                                    </div>
                                    <div style="max-height: 400px; overflow-y: auto; border: 1px solid #E0E0E0; border-top: none; background: white;">
                                        ${tickets.map(result => {
                                            const details = result.details || {};
                                            return `
                                                <div style="padding: 12px; border-bottom: 1px solid #e9ecef; border-left: 3px solid ${categoryColors[category]};">
                                                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                                                        <strong style="color: #333333; font-size: 13px;">Ticket <a href="https://gocareem.zendesk.com/agent/tickets/${result.id}" target="_blank" style="color: #0066CC; text-decoration: none; font-weight: bold;">#${result.id}</a></strong>
                                                        <span style="color: ${categoryColors[category]}; font-weight: bold; font-size: 11px; padding: 2px 8px; background: ${category === 'solved' ? '#E3F2FD' : category === 'pending' ? '#E8F5E8' : category === 'rta' ? '#FFF8E1' : '#FFEBEE'}; border-radius: 3px;">${categoryNames[category].toUpperCase()}</span>
                                                    </div>
                                                    ${details.subject ? `
                                                        <div style="background: #f8f9fa; padding: 8px; border-radius: 3px; margin-bottom: 8px;">
                                                            <div style="font-size: 12px; color: #333333; margin-bottom: 4px;">
                                                                <strong>Subject:</strong> <span style="color: #666666;">${details.subject}</span>
                                                            </div>
                                                            <div style="font-size: 12px; color: #333333;">
                                                                <strong>Status:</strong> <span style="color: #666666;">${details.previousStatus ? details.previousStatus.toUpperCase() : 'UNKNOWN'}</span>
                                                                ${details.currentStatus && details.currentStatus !== details.previousStatus ? ` → <span style="color: ${categoryColors[category]}; font-weight: bold;">${details.currentStatus.toUpperCase()}</span>` : ''}
                                                            </div>
                                                            ${details.action ? `<div style="font-size: 11px; color: #333333; margin-top: 4px;"><strong>Action:</strong> ${details.action}</div>` : ''}
                                                        </div>
                                                    ` : ''}
                                                    ${details.phrase ? `
                                                        <div style="font-size: 11px; color: #666666;">
                                                            <strong>Matched Phrase:</strong><br>
                                                            <div style="background: #f1f3f4; padding: 6px; border-radius: 2px; margin-top: 4px; font-family: monospace; word-wrap: break-word; font-size: 11px; line-height: 1.4;">
                                                                "${details.phrase}"
                                                            </div>
                                                        </div>
                                                    ` : ''}
                                                    ${result.status === 'error' ? `
                                                        <div style="font-size: 11px; color: #721c24; margin-top: 8px;">
                                                            <strong>Error:</strong> ${result.message}
                                                        </div>
                                                    ` : ''}
                                                </div>
                                            `;
                                        }).join('')}
                                    </div>
                                </div>
                            `;
                        });
                    });
                }, 500);

            } catch (error) {
                showTestResult(`
                    <div style="text-align: center; padding: 20px;">
                        <strong style="color: #ff6666;">❌ BATCH TEST FAILED</strong><br>
                        <div style="margin-top: 10px; background: rgba(0,0,0,0.3); padding: 10px; border-radius: 4px;">
                            <code style="color: #ccc;">${error.message}</code>
                        </div>
                    </div>
                `, 'error');


                RUMILogger.error('TEST', `Failed to test tickets`, error);
            }
        });

        // Allow Enter key in ticket ID input
        document.getElementById('rumi-test-ticket-id')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                document.getElementById('rumi-test-ticket').click();
            }
        });

        // Manual Export Event Handlers
        document.getElementById('rumi-manual-tab')?.addEventListener('click', async (e) => {
            // Handle Manual Export to Clipboard
            if (e.target.closest('.rumi-manual-export-btn')) {
                e.stopPropagation();
                const btn = e.target.closest('.rumi-manual-export-btn');
                const viewId = btn.dataset.viewId;
                const viewName = btn.dataset.viewName;

                RUMILogger.info('CSV', `Ticket IDs export requested for view ${viewId} (${viewName})`);

                // Show loading state
                const originalHTML = btn.innerHTML;
                btn.innerHTML = '⋯';
                btn.disabled = true;

                try {
                    // Fetch all tickets for the view
                    const viewData = await RUMIZendeskAPI.getViewTicketsForDirectCSV(viewId, viewName);

                    // Generate ticket IDs CSV (just comma-separated IDs)
                    const csvContent = RUMICSVUtils.generateTicketIDsCSV(viewData);

                    // Copy to clipboard
                    await navigator.clipboard.writeText(csvContent);

                    RUMILogger.info('CSV', `Successfully copied ${viewData.length} ticket IDs from ${viewName}`);
                    showExportToast(`Copied ${viewData.length} ticket IDs from ${viewName}`);

                } catch (error) {
                    RUMILogger.error('CSV', `Failed to export ticket IDs for view ${viewId}`, error);
                    showExportToast(`Failed to export ticket IDs: ${error.message}`, 'error');
                } finally {
                    // Restore button state
                    btn.innerHTML = originalHTML;
                    btn.disabled = false;
                }
            }
        });

        // CSV Export Event Handlers (keeping for backward compatibility if needed)
        document.getElementById('rumi-view-grid')?.addEventListener('click', async (e) => {
            // Handle CSV Export to Clipboard
            if (e.target.closest('.rumi-csv-download-btn')) {
                e.stopPropagation();
                const btn = e.target.closest('.rumi-csv-download-btn');
                const viewId = btn.dataset.viewId;
                const viewName = btn.dataset.viewName;

                RUMILogger.info('CSV', `Ticket IDs export requested for view ${viewId} (${viewName})`);

                // Show loading state
                const originalHTML = btn.innerHTML;
                btn.innerHTML = '⋯';
                btn.disabled = true;

                try {
                    // Fetch all tickets for the view
                    const viewData = await RUMIZendeskAPI.getViewTicketsForDirectCSV(viewId, viewName);

                    // Generate ticket IDs CSV (just comma-separated IDs)
                    const csvContent = RUMICSVUtils.generateTicketIDsCSV(viewData);

                    // Copy to clipboard
                    const success = await RUMICSVUtils.copyToClipboard(csvContent);

                    if (success) {
                        showExportToast('Exported');
                    } else {
                        throw new Error('Failed to copy to clipboard');
                    }

                } catch (error) {
                    RUMILogger.error('CSV', `Ticket IDs export failed for view ${viewId}`, error);
                    showExportToast('Export failed');
                } finally {
                    // Reset button
                    btn.innerHTML = originalHTML;
                    btn.disabled = false;
                }
            }
        });


        // Close on overlay click (but not during drag operations)
        let isDragging = false;
        let dragStartTime = 0;

        document.getElementById('rumi-enhancement-panel')?.addEventListener('mousedown', (e) => {
            if (e.target.className === 'rumi-enhancement-overlay') {
                isDragging = false;
                dragStartTime = Date.now();
            }
        });

        document.getElementById('rumi-enhancement-panel')?.addEventListener('mousemove', (e) => {
            if (e.target.className === 'rumi-enhancement-overlay' && e.buttons > 0) {
                isDragging = true;
            }
        });

        document.getElementById('rumi-enhancement-panel')?.addEventListener('click', (e) => {
            if (e.target.className === 'rumi-enhancement-overlay') {
                // Only close if it's a genuine click (not a drag operation)
                // Allow a small time window for quick clicks and ensure no dragging occurred
                const clickDuration = Date.now() - dragStartTime;
                if (!isDragging && clickDuration < 300) {
                    const panel = document.getElementById('rumi-enhancement-panel');
                    if (panel) {
                        panel.classList.add('rumi-hidden');
                    }
                }
                // Reset drag state
                isDragging = false;
                dragStartTime = 0;
            }
        });

        // Data management buttons
        document.getElementById('rumi-export-all-data')?.addEventListener('click', async () => {
            try {
                const allData = {
                    exportTimestamp: new Date().toISOString(),
                    processedTickets: {
                        pending: rumiEnhancement.pendingTickets,
                        solved: rumiEnhancement.solvedTickets,
                        rta: rumiEnhancement.rtaTickets
                    },
                    processedHistory: rumiEnhancement.processedHistory,
                    ticketStatusHistory: Array.from(rumiEnhancement.ticketStatusHistory.entries()),
                    automationLogs: rumiEnhancement.automationLogs,
                    monitoringStats: rumiEnhancement.monitoringStats,
                    settings: {
                        selectedViews: Array.from(rumiEnhancement.selectedViews),
                        isDryRun: rumiEnhancement.isDryRun,
                        operationModes: rumiEnhancement.operationModes,
                        currentLogLevel: rumiEnhancement.currentLogLevel
                    }
                };

                const dataStr = JSON.stringify(allData, null, 2);
                const dataBlob = new Blob([dataStr], { type: 'application/json' });
                const url = URL.createObjectURL(dataBlob);

                const link = document.createElement('a');
                link.href = url;
                link.download = `rumi-all-data-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(url);

                showExportToast('All data exported');
                RUMILogger.info('DATA', 'All data exported successfully');
            } catch (error) {
                showExportToast('Export failed');
                RUMILogger.error('DATA', 'Failed to export all data', error);
            }
        });


        document.getElementById('rumi-deduplicate-tickets')?.addEventListener('click', async () => {
            const result = RUMIStorage.deduplicateProcessedTickets();
            if (result) {
                const removedCount = (result.before.pending - result.after.pending) +
                                  (result.before.solved - result.after.solved) +
                                  (result.before.rta - result.after.rta);
                if (removedCount > 0) {
                    showExportToast(`Removed ${removedCount} duplicates`);
                    updateRUMIEnhancementUI(); // Refresh the display
                    updateProcessedTicketsDisplay(); // Refresh the tabs
                    RUMILogger.info('DATA', `Removed ${removedCount} duplicate ticket entries`);
                } else {
                    showExportToast('No duplicates found');
                }
            } else {
                showExportToast('Failed to deduplicate');
            }
        });

        document.getElementById('rumi-clear-history')?.addEventListener('click', async () => {
            if (confirm('Are you sure you want to clear ALL RUMI data? This cannot be undone.\n\nThis will clear:\n• All processed tickets (pending, solved, RTA)\n• Automation logs\n• Monitoring statistics\n• Ticket history\n• Settings')) {
                try {
                    // Get counts before clearing for confirmation
                    const beforeCounts = {
                        pending: rumiEnhancement.pendingTickets.length,
                        solved: rumiEnhancement.solvedTickets.length,
                        rta: rumiEnhancement.rtaTickets.length,
                        logs: rumiEnhancement.automationLogs.length,
                        history: rumiEnhancement.ticketStatusHistory.size
                    };

                    // Clear localStorage
                    RUMIStorage.clearAll();

                    // Also clear any other RUMI-related localStorage items
                    for (let i = localStorage.length - 1; i >= 0; i--) {
                        const key = localStorage.key(i);
                        if (key && key.startsWith('rumi_')) {
                            localStorage.removeItem(key);
                        }
                    }

                    // Reset in-memory data
                    rumiEnhancement.processedTickets.clear();
                    rumiEnhancement.processedHistory = [];
                    rumiEnhancement.pendingTickets = [];
                    rumiEnhancement.solvedTickets = [];
                    rumiEnhancement.rtaTickets = [];
                    rumiEnhancement.automationLogs = [];
                    rumiEnhancement.ticketStatusHistory.clear();
                    rumiEnhancement.baselineTickets.clear();
                    rumiEnhancement.selectedViews.clear();
                    rumiEnhancement.monitoringStats = {
                        sessionStartTime: null,
                        sessionStopTime: null,
                        totalRunningTime: 0,
                        sessionHistory: [],
                        currentSessionStart: null
                    };

                    // Reset settings to defaults
                    rumiEnhancement.isDryRun = true;
                    rumiEnhancement.currentLogLevel = 2;
                    rumiEnhancement.operationModes = {
                        pending: true,
                        solved: true,
                        rta: true
                    };
                    rumiEnhancement.consecutiveErrors = 0;
                    rumiEnhancement.apiCallCount = 0;

                    // Update UI immediately
                    updateRUMIEnhancementUI();
                    updateProcessedTicketsDisplay();

                    // Clear and update logs display
                    RUMILogger.updateLogDisplay();

                    // Log the clear action
                    RUMILogger.info('DATA', `Cleared all data - Previous counts: ${beforeCounts.pending} pending, ${beforeCounts.solved} solved, ${beforeCounts.rta} RTA, ${beforeCounts.logs} logs, ${beforeCounts.history} history entries`);

                    showExportToast('All data cleared successfully');

                } catch (error) {
                    RUMILogger.error('DATA', 'Failed to clear all data', error);
                    showExportToast('Error clearing data');
                }
            }
        });
    }

    function updateRUMIEnhancementUI() {
        const startButton = document.getElementById('rumi-start-stop');
        const statusIndicator = document.getElementById('rumi-status-indicator');
        const lastCheck = document.getElementById('rumi-last-check');

        if (startButton) {
            startButton.textContent = rumiEnhancement.isMonitoring ? 'Stop Monitoring' : 'Start Monitoring';
            startButton.className = rumiEnhancement.isMonitoring ?
                'rumi-enhancement-button rumi-enhancement-button-danger' :
                'rumi-enhancement-button rumi-enhancement-button-primary';
        }

        if (statusIndicator) {
            statusIndicator.textContent = rumiEnhancement.isMonitoring ? 'MONITORING' : 'STOPPED';
            statusIndicator.className = rumiEnhancement.isMonitoring ?
                'rumi-enhancement-status-active' : 'rumi-enhancement-status-inactive';
        }

        if (lastCheck && rumiEnhancement.lastCheckTime) {
            lastCheck.textContent = `Last check: ${rumiEnhancement.lastCheckTime.toLocaleTimeString()}`;
        }

        // Update metrics
        const processedCount = document.getElementById('metric-processed');
        const apiCalls = document.getElementById('metric-api-calls');
        const errors = document.getElementById('metric-errors');
        const views = document.getElementById('metric-views');

        if (processedCount) processedCount.textContent = rumiEnhancement.processedHistory.length;
        if (apiCalls) apiCalls.textContent = rumiEnhancement.apiCallCount;
        if (errors) errors.textContent = rumiEnhancement.consecutiveErrors;
        if (views) views.textContent = rumiEnhancement.selectedViews.size;

        // Update automatic/manual metrics
        const metricAutoSolved = document.getElementById('metric-auto-solved');
        const metricAutoPending = document.getElementById('metric-auto-pending');
        const metricAutoRta = document.getElementById('metric-auto-rta');
        const metricManualSolved = document.getElementById('metric-manual-solved');
        const metricManualPending = document.getElementById('metric-manual-pending');
        const metricManualRta = document.getElementById('metric-manual-rta');

        if (metricAutoSolved) metricAutoSolved.textContent = rumiEnhancement.automaticTickets.solved.length;
        if (metricAutoPending) metricAutoPending.textContent = rumiEnhancement.automaticTickets.pending.length;
        if (metricAutoRta) metricAutoRta.textContent = rumiEnhancement.automaticTickets.rta.length;
        if (metricManualSolved) metricManualSolved.textContent = rumiEnhancement.manualTickets.solved.length;
        if (metricManualPending) metricManualPending.textContent = rumiEnhancement.manualTickets.pending.length;
        if (metricManualRta) metricManualRta.textContent = rumiEnhancement.manualTickets.rta.length;
    }

    function updateProcessedTicketsDisplay() {
        // Update the metrics in the UI
        updateRUMIEnhancementUI();

        // Update tab headers with counts
        const solvedHeader = document.querySelector('[data-tab="solved"]');
        const pendingHeader = document.querySelector('[data-tab="pending"]');
        const rtaHeader = document.querySelector('[data-tab="rta"]');

        if (solvedHeader) solvedHeader.textContent = `Solved (${rumiEnhancement.solvedTickets.length})`;
        if (pendingHeader) pendingHeader.textContent = `Pending (${rumiEnhancement.pendingTickets.length})`;
        if (rtaHeader) rtaHeader.textContent = `RTA (${rumiEnhancement.rtaTickets.length})`;

        // Update solved tab
        updateTabContent('solved', rumiEnhancement.solvedTickets);

        // Update pending tab
        updateTabContent('pending', rumiEnhancement.pendingTickets);

        // Update RTA tab
        updateTabContent('rta', rumiEnhancement.rtaTickets);

        // Update automatic ticket displays
        updateAutomaticTabContent('auto-solved', rumiEnhancement.automaticTickets.solved);
        updateAutomaticTabContent('auto-pending', rumiEnhancement.automaticTickets.pending);
        updateAutomaticTabContent('auto-rta', rumiEnhancement.automaticTickets.rta);

        // Update manual ticket displays
        updateManualTicketDisplays();
    }

    function updateTabContent(tabType, tickets) {
        const displayArea = document.getElementById(`rumi-${tabType}-tickets`);
        if (!displayArea) return;

        if (tickets.length === 0) {
            displayArea.innerHTML = `<div style="text-align: center; color: #666666; padding: 20px;">No ${tabType} tickets yet</div>`;
            return;
        }

        const recentTickets = tickets.slice(-10).reverse();
        displayArea.innerHTML = recentTickets.map(item => {
            const timestamp = new Date(item.timestamp).toLocaleTimeString();
            const date = new Date(item.timestamp).toLocaleDateString();
            const ticketId = item.id || item.ticketId;

            return `
                <div class="rumi-processed-ticket-item">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <strong style="color: #333333; font-size: 13px;">Ticket ${createClickableTicketId(ticketId)}</strong>
                        <div style="text-align: right;">
                            <div style="font-size: 11px; color: #666666;">${date} ${timestamp}</div>
                        </div>
                    </div>

                    <div style="background: #F8F9FA; padding: 8px; border-radius: 2px; margin-bottom: 8px; border: 1px solid #E9ECEF;">
                        <div style="font-size: 12px; color: #333333; margin-bottom: 4px;">
                            <strong>View:</strong> <span style="color: #666666;">${item.viewName}</span>
                        </div>
                        <div style="font-size: 12px; color: #333333; margin-bottom: 4px;">
                            <strong>Status:</strong>
                            <span style="color: #666666;">${item.previousStatus?.toUpperCase() || 'UNKNOWN'}</span>
                            → <span style="color: ${getStatusColor(item.status || tabType)}; font-weight: bold;">${(item.status || tabType).toUpperCase()}</span>
                        </div>
                        ${item.triggerReason === 'end-user-reply-chain' ? `
                            <div style="font-size: 11px; color: #007bff; margin-bottom: 4px;">
                                📞 End-User Reply Chain
                            </div>
                        ` : ''}
                        ${item.phrase ? `
                    <div style="font-size: 11px; color: #666666;">
                        <strong>Matched Phrase:</strong><br>
                                <div style="background: #F1F3F4; padding: 6px; border-radius: 2px; margin-top: 2px; font-family: monospace; word-wrap: break-word; font-size: 11px; line-height: 1.4;">
                                    "${item.phrase}"
                        </div>
                            </div>
                        ` : ''}
                    </div>
                </div>
            `;
        }).join('');
    }

    function updateAutomaticTabContent(tabType, tickets) {
        const displayArea = document.getElementById(`rumi-${tabType}-tickets`);
        if (!displayArea) return;

        if (tickets.length === 0) {
            const typeLabel = tabType.replace('auto-', '');
            displayArea.innerHTML = `<div style="text-align: center; color: #666666; padding: 20px;">No automatic ${typeLabel} tickets yet</div>`;
            return;
        }

        const recentTickets = tickets.slice(-10).reverse();
        displayArea.innerHTML = recentTickets.map(item => {
            const timestamp = new Date(item.timestamp).toLocaleTimeString();
            const date = new Date(item.timestamp).toLocaleDateString();
            const ticketId = item.id || item.ticketId;

            return `
                <div class="rumi-processed-ticket-item">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <strong style="color: #333333; font-size: 13px;">Ticket ${createClickableTicketId(ticketId)}</strong>
                        <div style="text-align: right;">
                            <div style="font-size: 11px; color: #666666;">${date} ${timestamp}</div>
                            <div style="font-size: 10px; color: #007BFF; font-weight: bold;">AUTOMATIC</div>
                        </div>
                    </div>

                    <div style="background: #F8F9FA; padding: 8px; border-radius: 2px; margin-bottom: 8px; border: 1px solid #E9ECEF;">
                        <div style="font-size: 12px; color: #333333; margin-bottom: 4px;">
                            <strong>View:</strong> <span style="color: #666666;">${item.viewName || 'N/A'}</span>
                        </div>
                        <div style="font-size: 12px; color: #333333; margin-bottom: 4px;">
                            <strong>Status:</strong>
                            <span style="color: #666666;">${item.previousStatus?.toUpperCase() || 'UNKNOWN'}</span>
                            → <span style="color: ${getStatusColor(item.status || tabType.replace('auto-', ''))}; font-weight: bold;">${(item.status || tabType.replace('auto-', '')).toUpperCase()}</span>
                        </div>

                        ${item.phrase ? `
                        <div style="font-size: 11px; color: #666666; margin-bottom: 4px;">
                            <strong>Phrase:</strong> "${item.phrase.length > 60 ? item.phrase.substring(0, 60) + '...' : item.phrase}"
                        </div>` : ''}

                        ${item.action ? `
                        <div style="font-size: 11px; color: #666666;">
                            <strong>Action:</strong> ${item.action}
                        </div>` : ''}
                    </div>
                </div>
            `;
        }).join('');
    }

    function updateManualTicketDisplays() {
        // Update manual solved tickets
        updateManualTabContent('solved', rumiEnhancement.manualTickets.solved);

        // Update manual pending tickets
        updateManualTabContent('pending', rumiEnhancement.manualTickets.pending);

        // Update manual RTA tickets
        updateManualTabContent('rta', rumiEnhancement.manualTickets.rta);
    }

    function updateManualTabContent(tabType, tickets) {
        const displayArea = document.getElementById(`rumi-manual-${tabType}-tickets`);
        if (!displayArea) return;

        if (tickets.length === 0) {
            displayArea.innerHTML = `<div style="text-align: center; color: #666666; padding: 20px;">No manual ${tabType} tickets yet</div>`;
            return;
        }

        const recentTickets = tickets.slice(-10).reverse();
        displayArea.innerHTML = recentTickets.map(item => {
            const timestamp = new Date(item.timestamp).toLocaleTimeString();
            const date = new Date(item.timestamp).toLocaleDateString();
            const ticketId = item.id || item.ticketId;

            return `
                <div class="rumi-processed-ticket-item">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <strong style="color: #333333; font-size: 13px;">Ticket ${createClickableTicketId(ticketId)}</strong>
                        <div style="text-align: right;">
                            <div style="font-size: 11px; color: #666666;">${date} ${timestamp}</div>
                        </div>
                    </div>

                    <div style="background: #F8F9FA; padding: 8px; border-radius: 2px; margin-bottom: 8px; border: 1px solid #E9ECEF;">
                        <div style="font-size: 12px; color: #333333; margin-bottom: 4px;">
                            <strong>View:</strong> <span style="color: #666666;">${item.viewName || 'Manual Testing'}</span>
                        </div>
                        <div style="font-size: 12px; color: #333333; margin-bottom: 4px;">
                            <strong>Status:</strong>
                            <span style="color: #666666;">${item.previousStatus?.toUpperCase() || 'UNKNOWN'}</span>
                            → <span style="color: ${getStatusColor(item.status || tabType)}; font-weight: bold;">${(item.status || tabType).toUpperCase()}</span>
                        </div>
                        ${item.triggerReason === 'end-user-reply-chain' ? `
                            <div style="font-size: 11px; color: #007bff; margin-bottom: 4px;">
                                📞 End-User Reply Chain
                            </div>
                        ` : ''}
                        ${item.phrase ? `
                    <div style="font-size: 11px; color: #666666;">
                        <strong>Matched Phrase:</strong><br>
                                <div style="background: #F1F3F4; padding: 6px; border-radius: 2px; margin-top: 2px; font-family: monospace; word-wrap: break-word; font-size: 11px; line-height: 1.4;">
                                    "${item.phrase}"
                        </div>
                            </div>
                        ` : ''}
                    </div>
                </div>
            `;
        }).join('');
    }

    function getStatusColor(status) {
        switch (status.toLowerCase()) {
            case 'pending': return '#28a745';
            case 'solved': return '#007bff';
            case 'rta': return '#ffc107';
            default: return '#666666';
        }
    }

    function createClickableTicketId(ticketId) {
        return `<a href="https://gocareem.zendesk.com/agent/tickets/${ticketId}" target="_blank" style="color: #0066CC; text-decoration: none; font-weight: bold;">#${ticketId}</a>`;
    }

    function updateSelectedViewsCount() {
        const countElement = document.getElementById('rumi-selected-count');
        if (countElement) {
            countElement.textContent = rumiEnhancement.selectedViews.size;
        }
    }

    // Helper function to format duration
    function formatDuration(milliseconds) {
        if (!milliseconds || milliseconds < 0) return '0s';

        const seconds = Math.floor(milliseconds / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);

        if (hours > 0) {
            return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
        } else if (minutes > 0) {
            return `${minutes}m ${seconds % 60}s`;
        } else {
            return `${seconds}s`;
        }
    }

    // Update monitoring statistics display
    function updateMonitoringStats() {
        const sessionInfo = document.getElementById('rumi-session-info');
        const totalTime = document.getElementById('rumi-total-time');
        const currentTimer = document.getElementById('rumi-current-timer');

        if (!sessionInfo || !totalTime || !currentTimer) return;

        const stats = rumiEnhancement.monitoringStats;

        // Session start/stop info
        if (stats.sessionStartTime) {
            const startTime = new Date(stats.sessionStartTime).toLocaleTimeString();
            sessionInfo.innerHTML = `Started: ${startTime}`;
            if (stats.sessionStopTime && !rumiEnhancement.isMonitoring) {
                const stopTime = new Date(stats.sessionStopTime).toLocaleTimeString();
                sessionInfo.innerHTML += ` | Stopped: ${stopTime}`;
            }
        } else {
            sessionInfo.innerHTML = 'No session data';
        }

        // Total running time
        totalTime.innerHTML = `Total runtime: ${formatDuration(stats.totalRunningTime)}`;

        // Current session timer (if running)
        if (rumiEnhancement.isMonitoring && stats.currentSessionStart) {
            const currentDuration = Date.now() - new Date(stats.currentSessionStart);
            currentTimer.innerHTML = `Current session: ${formatDuration(currentDuration)}`;
            currentTimer.style.display = 'block';
        } else {
            currentTimer.style.display = 'none';
        }
    }

    // Start live timer updates
    let monitoringTimerInterval = null;

    function startMonitoringTimer() {
        if (monitoringTimerInterval) {
            clearInterval(monitoringTimerInterval);
        }

        monitoringTimerInterval = setInterval(() => {
            if (rumiEnhancement.isMonitoring) {
                updateMonitoringStats();
            }
        }, 1000); // Update every second
    }

    function stopMonitoringTimer() {
        if (monitoringTimerInterval) {
            clearInterval(monitoringTimerInterval);
            monitoringTimerInterval = null;
        }
    }


    async function copyTicketIds(ticketArray, type) {
        if (ticketArray.length === 0) {
            showExportToast(`No ${type} tickets to copy`);
            return;
        }

        const ticketIds = ticketArray.map(ticket => ticket.id || ticket).join('\n');
        const success = await RUMICSVUtils.copyToClipboard(ticketIds);

        if (success) {
            showExportToast(`Copied ${ticketArray.length} ${type} ticket IDs`);
        } else {
            showExportToast('Copy failed');
        }
    }

    function showTestResult(message, type = 'info') {
        const resultDiv = document.getElementById('rumi-test-result');
        if (!resultDiv) return;

        const colors = {
            info: { bg: '#E8F4FD', border: '#0066CC', text: '#333333' },
            success: { bg: '#D4EDDA', border: '#28A745', text: '#333333' },
            error: { bg: '#F8D7DA', border: '#DC3545', text: '#333333' },
            warning: { bg: '#FFF3CD', border: '#FFC107', text: '#333333' }
        };

        const color = colors[type] || colors.info;

        resultDiv.style.display = 'block';
        resultDiv.style.backgroundColor = color.bg;
        resultDiv.style.borderLeft = `4px solid ${color.border}`;
        resultDiv.style.color = color.text;
        resultDiv.innerHTML = message;
    }


    // ============================================================================
    // FAST TICKET TESTING FOR CONCURRENT PROCESSING
    // ============================================================================

    async function testTicketFast(ticketId, dryRun = null) {
        // Lightweight version without UI updates for concurrent processing
        // Respects dry run setting - only analyzes if dry run, processes if not dry run
        // Use provided dryRun parameter or fall back to legacy isDryRun for automatic processes
        const isDryRunMode = dryRun !== null ? dryRun : rumiEnhancement.isDryRun;
        RUMILogger.debug('FAST_TEST', `Testing ticket ${ticketId} (dry run: ${isDryRunMode})`);

        try {
            // Get ticket basic info
            const ticketResponse = await RUMIAPIManager.makeRequestWithRetry(`/api/v2/tickets/${ticketId}.json`);

            if (!ticketResponse || !ticketResponse.ticket) {
                throw new Error('Ticket not found or invalid response');
            }

            const ticket = ticketResponse.ticket;

            // First check for HALA provider tag (highest priority)
            if (ticket.tags && ticket.tags.includes('ghc_provider_hala-rides')) {
                let action = 'RTA Assignment - HALA provider tag detected';
                let processed = false;

                if (isDryRunMode) {
                    action = 'Would assign to RTA group';
                } else {
                    try {
                        await assignHalaTicketToGroup(ticketId);
                        action = 'Assigned to RTA group';
                        processed = true;
                    } catch (updateError) {
                        action = `Failed to assign: ${updateError.message}`;
                    }
                }

                return {
                    matches: true,
                    phrase: 'HALA provider tag: ghc_provider_hala-rides',
                    previousStatus: ticket.status,
                    currentStatus: 'rta',
                    subject: ticket.subject,
                    created_at: ticket.created_at,
                    updated_at: ticket.updated_at,
                    reason: 'HALA provider tag detected',
                    processed: processed,
                    action: action,
                    isHalaPattern: true,
                    assignee: '34980896869267'
                };
            }

            // Get ticket comments for regular processing
            const comments = await RUMIZendeskAPI.getTicketComments(ticketId);

            if (!comments || comments.length === 0) {
                return {
                    matches: false,
                    phrase: null,
                    previousStatus: ticket.status,
                    subject: ticket.subject,
                    created_at: ticket.created_at,
                    updated_at: ticket.updated_at,
                    reason: 'No comments to analyze',
                    processed: false,
                    action: 'Skipped - No comments'
                };
            }

            // First check for solved message patterns (higher priority)
            const solvedAnalysis = await RUMISolvedAnalyzer.analyzeSolvedPattern(comments);
            let analysis;

            if (solvedAnalysis.matches) {
                // Convert solved analysis to same format as pending analysis
                analysis = {
                    matches: true,
                    phrase: solvedAnalysis.phrase || `SOLVED PATTERN: ${solvedAnalysis.reason}`,
                    action: solvedAnalysis.action,
                    assignee: solvedAnalysis.assignee,
                    status: solvedAnalysis.status,
                    isSolvedPattern: true
                };
            } else {
                // Fall back to regular pending analysis
                analysis = await RUMICommentAnalyzer.analyzeLatestComment(comments);
                analysis.isSolvedPattern = false;
            }

            let processed = false;
            let action = 'Analysis only';
            let newStatus = ticket.status;

            // Check operation modes before processing
            if (analysis.matches) {
                // Check if the appropriate operation mode is enabled
                if (analysis.isSolvedPattern && !rumiEnhancement.operationModes.solved) {
                    return {
                        matches: false,
                        phrase: null,
                        previousStatus: ticket.status,
                        currentStatus: ticket.status,
                        subject: ticket.subject,
                        created_at: ticket.created_at,
                        updated_at: ticket.updated_at,
                        reason: 'Solved operations disabled in settings',
                        processed: false,
                        action: 'Skipped - Solved operations disabled'
                    };
                }

                if (!analysis.isSolvedPattern && !rumiEnhancement.operationModes.pending) {
                    return {
                        matches: false,
                        phrase: null,
                        previousStatus: ticket.status,
                        currentStatus: ticket.status,
                        subject: ticket.subject,
                        created_at: ticket.created_at,
                        updated_at: ticket.updated_at,
                        reason: 'Pending operations disabled in settings',
                        processed: false,
                        action: 'Skipped - Pending operations disabled'
                    };
                }
            }

            // If analysis matches and we're not in dry run mode, actually process the ticket
            if (analysis.matches) {
                if (isDryRunMode) {
                    if (analysis.isSolvedPattern) {
                        action = ticket.status === analysis.status ? `Would skip - Already ${analysis.status}` : `Would update to ${analysis.status}`;
                    } else {
                        action = ticket.status === 'pending' ? 'Would skip - Already pending' : 'Would update to pending';
                    }
                } else {
                    // Not in dry run mode - actually process the ticket
                    if (analysis.isSolvedPattern) {
                        // Handle solved pattern
                        if (ticket.status === analysis.status) {
                            action = `Skipped - Already ${analysis.status}`;
                        } else {
                            try {
                                await RUMIZendeskAPI.updateTicketWithAssignee(ticketId, analysis.status, analysis.assignee, 'Manual Test');
                                processed = true;
                                newStatus = analysis.status;
                                action = `Updated: ${ticket.status.toUpperCase()} → ${analysis.status.toUpperCase()}`;
                            } catch (updateError) {
                                action = `Failed to update: ${updateError.message}`;
                                RUMILogger.error('FAST_TEST', `Failed to update ticket ${ticketId}`, updateError);
                            }
                        }
                    } else {
                        // Handle pending pattern
                        if (ticket.status === 'pending') {
                            action = 'Skipped - Already pending';
                        } else {
                            try {
                                await RUMIZendeskAPI.updateTicketStatus(ticketId, 'pending', 'Manual Test');
                                processed = true;
                                newStatus = 'pending';
                                action = `Updated: ${ticket.status.toUpperCase()} → PENDING`;

                                // Add to processed history
                                rumiEnhancement.processedHistory.push({
                                    ticketId: ticketId,
                                    timestamp: new Date().toISOString(),
                                    viewName: 'Manual Test',
                                    phrase: analysis.phrase,
                                    previousStatus: ticket.status,
                                    triggerReason: analysis.triggerReason || 'direct-match',
                                    triggerCommentId: analysis.comment?.id,
                                    latestCommentId: analysis.latestComment?.id
                                });

                            } catch (updateError) {
                                RUMILogger.error('FAST_TEST', `Failed to update ticket ${ticketId}`, updateError);
                                action = `Update failed: ${updateError.message}`;
                            }
                        }
                    }
                }
            } else {
                action = isDryRunMode ? 'Would skip - No trigger phrase' : 'Skipped - No trigger phrase';
            }

            // Return comprehensive result
            return {
                matches: analysis.matches,
                phrase: analysis.phrase,
                previousStatus: ticket.status,
                currentStatus: newStatus,
                subject: ticket.subject,
                created_at: ticket.created_at,
                updated_at: ticket.updated_at,
                triggerReason: analysis.triggerReason,
                reason: analysis.matches ? 'Trigger phrase found' : 'No trigger phrase found',
                processed: processed,
                action: action,
                isDryRun: rumiEnhancement.isDryRun
            };

        } catch (error) {
            RUMILogger.error('FAST_TEST', `Fast test failed for ticket ${ticketId}`, error);
            throw error;
        }
    }

    async function testSpecificTicket(ticketId) {
        RUMILogger.info('TEST', `Testing ticket ${ticketId}`);

        try {
            // First, get ticket basic info to verify it exists
            showTestResult(`
                <div style="text-align: center; margin-bottom: 10px;">
                    <strong style="color: #66d9ff;">🔍 TESTING TICKET #${ticketId}</strong>
                </div>
                <div>Step 1/3: Fetching ticket information...</div>
            `, 'info');

            const ticketResponse = await RUMIAPIManager.makeRequestWithRetry(`/api/v2/tickets/${ticketId}.json`);

            if (!ticketResponse || !ticketResponse.ticket) {
                throw new Error('Ticket not found or invalid response');
            }

            const ticket = ticketResponse.ticket;

            showTestResult(`
                <div style="text-align: center; margin-bottom: 15px;">
                    <strong style="color: #66d9ff;">🔍 TESTING TICKET #${ticketId}</strong>
                </div>
                <div style="margin-bottom: 10px;">Step 2/3: Analyzing ticket comments...</div>
                <div style="background: rgba(0,0,0,0.2); padding: 10px; border-radius: 6px; margin: 10px 0;">
                    <strong>📋 Ticket Information:</strong><br>
                    • Status: <span style="color: #ffaa00;">${ticket.status.toUpperCase()}</span><br>
                    • Subject: <span style="color: #ccc;">${ticket.subject || 'No subject'}</span><br>
                    • Created: <span style="color: #ccc;">${new Date(ticket.created_at).toLocaleString()}</span><br>
                    • Updated: <span style="color: #ccc;">${new Date(ticket.updated_at).toLocaleString()}</span>
                </div>
            `, 'info');

            // Get ticket comments
            const comments = await RUMIZendeskAPI.getTicketComments(ticketId);

            if (!comments || comments.length === 0) {
                showTestResult(`
                    <div style="text-align: center; margin-bottom: 15px;">
                        <strong style="color: #66d9ff;">🔍 TESTING TICKET #${ticketId}</strong>
                    </div>
                    <div style="background: rgba(255,170,0,0.2); padding: 15px; border-radius: 6px; border-left: 4px solid #ffaa00;">
                        <strong>⚠️ NO COMMENTS FOUND</strong><br>
                        This ticket has no comments to analyze.
                    </div>
                `, 'warning');
                return;
            }

            // First check for solved message patterns (higher priority)
            const solvedAnalysis = await RUMISolvedAnalyzer.analyzeSolvedPattern(comments);
            let analysis;

            if (solvedAnalysis.matches) {
                // Convert solved analysis to same format as pending analysis for display
                analysis = {
                    matches: true,
                    phrase: solvedAnalysis.phrase || `SOLVED PATTERN: ${solvedAnalysis.reason}`,
                    action: solvedAnalysis.action,
                    assignee: solvedAnalysis.assignee,
                    status: solvedAnalysis.status,
                    isSolvedPattern: true
                };
            } else {
                // Fall back to regular pending analysis
                analysis = await RUMICommentAnalyzer.analyzeLatestComment(comments);
                analysis.isSolvedPattern = false;
            }

            const latestComment = comments[0];

            let resultHTML = `
                <div style="text-align: center; margin-bottom: 15px;">
                    <strong style="color: #66d9ff;">🔍 COMPREHENSIVE TEST RESULTS</strong>
                </div>

                <div style="background: rgba(0,0,0,0.2); padding: 12px; border-radius: 6px; margin: 10px 0;">
                    <strong style="color: #00ff88;">📊 TICKET ANALYSIS</strong><br>
                    • Ticket ID: <span style="color: #ffaa00;">#${ticketId}</span><br>
                    • Current Status: <span style="color: ${ticket.status === 'pending' ? '#00ff88' : '#ffaa00'};">${ticket.status.toUpperCase()}</span><br>
                    • Subject: <span style="color: #ccc;">${ticket.subject || 'No subject'}</span><br>
                    • Priority: <span style="color: #ccc;">${ticket.priority || 'Not set'}</span><br>
                    • Total Comments: <span style="color: #66d9ff;">${comments.length}</span><br>
                    • Assignee ID: <span style="color: #ccc;">${ticket.assignee_id || 'Unassigned'}</span>
                </div>

                <div style="background: rgba(0,0,0,0.2); padding: 12px; border-radius: 6px; margin: 10px 0;">
                    <strong style="color: #66d9ff;">💬 LATEST COMMENT ANALYSIS</strong><br>
                    • Comment ID: <span style="color: #ccc;">${latestComment.id}</span><br>
                    • Author ID: <span style="color: #ccc;">${latestComment.author_id}</span><br>
                    • Created: <span style="color: #ccc;">${new Date(latestComment.created_at).toLocaleString()}</span><br>
                    • Length: <span style="color: #66d9ff;">${latestComment.body ? latestComment.body.length : 0} characters</span><br>
                    • Type: <span style="color: #ccc;">${latestComment.public ? 'Public' : 'Internal'}</span>
                </div>
            `;

            // Check operation modes before processing
            if (analysis.matches) {
                // Check if the appropriate operation mode is enabled
                if (analysis.isSolvedPattern && !rumiEnhancement.operationModes.solved) {
                    showTestResult(resultHTML + `
                        <div style="background: rgba(255,170,0,0.2); padding: 15px; border-radius: 6px; border-left: 4px solid #ffaa00; margin: 15px 0;">
                            <strong style="color: #ffaa00;">⚙️ SOLVED OPERATIONS DISABLED</strong><br>
                            This ticket matches a solved pattern, but solved operations are disabled in settings.<br>
                            <small style="color: #ccc;">Enable "Solved Operations" in the Configuration section to process this ticket.</small>
                        </div>
                    `, 'warning');
                    return;
                }

                if (!analysis.isSolvedPattern && !rumiEnhancement.operationModes.pending) {
                    showTestResult(resultHTML + `
                        <div style="background: rgba(255,170,0,0.2); padding: 15px; border-radius: 6px; border-left: 4px solid #ffaa00; margin: 15px 0;">
                            <strong style="color: #ffaa00;">⚙️ PENDING OPERATIONS DISABLED</strong><br>
                            This ticket matches trigger phrases, but pending operations are disabled in settings.<br>
                            <small style="color: #ccc;">Enable "Pending Operations" in the Configuration section to process this ticket.</small>
                        </div>
                    `, 'warning');
                    return;
                }
            }

            if (analysis.matches) {
                const matchedPhrase = analysis.phrase;
                const phraseIndex = rumiEnhancement.pendingTriggerPhrases.indexOf(matchedPhrase) + 1;
                const isEndUserReplyChain = analysis.triggerReason === 'end-user-reply-chain';

                resultHTML += `
                    <div style="background: rgba(0,255,136,0.2); padding: 15px; border-radius: 6px; border-left: 4px solid #00ff88; margin: 15px 0;">
                        <strong style="color: #00ff88;">🎯 TRIGGER PHRASE MATCH FOUND!</strong><br><br>
                        ${isEndUserReplyChain ? `
                            <div style="background: rgba(0,170,255,0.2); padding: 10px; border-radius: 4px; margin: 8px 0; border-left: 3px solid #00aaff;">
                                <strong style="color: #00aaff;">📧 END-USER REPLY CHAIN DETECTED</strong><br>
                                <small style="color: #ccc;">Latest comment is from end-user, but previous agent comment contains trigger phrase</small>
                            </div>
                        ` : ''}
                        <strong>Matched Phrase #${phraseIndex}:</strong><br>
                        <div style="background: rgba(0,0,0,0.3); padding: 10px; border-radius: 4px; margin: 8px 0; font-family: monospace; word-wrap: break-word; font-size: 12px; color: #ccc;">
                            "${matchedPhrase}"
                        </div>
                        ${isEndUserReplyChain ? `
                            <div style="margin: 8px 0; font-size: 12px; color: #ccc;">
                                <strong>Trigger Comment:</strong> #${analysis.comment.id} (Previous agent comment)<br>
                                <strong>Latest Comment:</strong> #${analysis.latestComment.id} (End-user reply)
                            </div>
                        ` : ''}
                        <strong>Action:</strong> <span style="color: #00ff88;">This ticket qualifies for automated processing</span>
                    </div>
                `;

                // Check if ticket would be processed
                if (ticket.status === 'pending') {
                    resultHTML += `
                        <div style="background: rgba(255,170,0,0.2); padding: 12px; border-radius: 6px; border-left: 4px solid #ffaa00;">
                            <strong>⚠️ ALREADY PENDING</strong><br>
                            Ticket status is already "pending" - no action needed.
                        </div>
                    `;
                } else {
                    // Show what will happen
                    showTestResult(resultHTML + `
                        <div style="background: rgba(0,124,186,0.2); padding: 12px; border-radius: 6px; border-left: 4px solid #007cba; margin-top: 15px;">
                            <strong>⚙️ PROCESSING STATUS UPDATE</strong><br>
                            Step 3/3: ${rumiEnhancement.isDryRun ? 'Simulating status update...' : 'Performing status update...'}
                        </div>
                    `, 'info');

                    try {
                        const updateResult = await RUMIZendeskAPI.updateTicketStatus(ticketId, 'pending', 'Manual Test');

                        if (rumiEnhancement.isDryRun) {
                            resultHTML += `
                                <div style="background: rgba(0,124,186,0.2); padding: 15px; border-radius: 6px; border-left: 4px solid #007cba;">
                                    <strong style="color: #007cba;">🧪 DRY RUN MODE</strong><br>
                                    Would update status: <span style="color: #ffaa00;">${ticket.status}</span> → <span style="color: #00ff88;">pending</span><br>
                                    <small>No actual changes made to the ticket.</small>
                                </div>
                            `;
                        } else {
                            resultHTML += `
                                <div style="background: rgba(0,255,136,0.2); padding: 15px; border-radius: 6px; border-left: 4px solid #00ff88;">
                                    <strong style="color: #00ff88;">✅ UPDATE SUCCESSFUL</strong><br>
                                    Status updated: <span style="color: #ffaa00;">${ticket.status}</span> → <span style="color: #00ff88;">pending</span><br>
                                    <small>Ticket has been added to processed history.</small>
                                </div>
                            `;

                            // Add to processed history
                            rumiEnhancement.processedHistory.push({
                                ticketId,
                                timestamp: new Date().toISOString(),
                                viewName: 'Manual Test',
                                phrase: analysis.phrase, // Store full phrase without truncation
                                previousStatus: ticket.status,
                                triggerReason: analysis.triggerReason || 'direct-match',
                                triggerCommentId: analysis.comment?.id,
                                latestCommentId: analysis.latestComment?.id
                            });
                            updateProcessedTicketsDisplay();
                        }
                    } catch (updateError) {
                        let errorMessage = updateError.message;
                        let explanation = '';

                        if (errorMessage.includes('403')) {
                            explanation = `
                                <div style="margin-top: 8px; font-size: 12px; color: #ccc;">
                                    <strong>Possible reasons:</strong><br>
                                    • You're not the assignee of this ticket<br>
                                    • The ticket is locked or in a workflow state<br>
                                    • Insufficient role permissions<br>
                                    • Ticket may be closed or solved
                                </div>
                            `;
                        } else if (errorMessage.includes('429')) {
                            explanation = `
                                <div style="margin-top: 8px; font-size: 12px; color: #ccc;">
                                    <strong>Rate limit exceeded.</strong> Too many API requests.<br>
                                    Wait a moment and try again.
                                </div>
                            `;
                        } else if (errorMessage.includes('CSRF')) {
                            explanation = `
                                <div style="margin-top: 8px; font-size: 12px; color: #ccc;">
                                    <strong>Authentication issue.</strong> Try refreshing the page.
                                </div>
                            `;
                        }

                        resultHTML += `
                            <div style="background: rgba(255,102,102,0.2); padding: 15px; border-radius: 6px; border-left: 4px solid #ff6666;">
                                <strong style="color: #ff6666;">❌ UPDATE FAILED</strong><br>
                                Error: <span style="color: #ccc;">${errorMessage}</span>
                                ${explanation}
                            </div>
                        `;
                    }
                }
            } else {
                resultHTML += `
                    <div style="background: rgba(255,170,0,0.2); padding: 15px; border-radius: 6px; border-left: 4px solid #ffaa00; margin: 15px 0;">
                        <strong style="color: #ffaa00;">❌ NO TRIGGER PHRASE MATCH</strong><br>
                        The latest comment does not contain any of the ${rumiEnhancement.pendingTriggerPhrases.length} configured pending trigger phrases.
                    </div>
                `;

                // Show comment preview for debugging
                if (latestComment.body) {
                    const preview = latestComment.body.substring(0, 300);
                    resultHTML += `
                        <div style="background: rgba(0,0,0,0.2); padding: 12px; border-radius: 6px; margin: 10px 0;">
                            <strong style="color: #ccc;">📝 LATEST COMMENT PREVIEW:</strong><br>
                            <div style="background: rgba(0,0,0,0.3); padding: 10px; border-radius: 4px; margin: 8px 0; font-family: monospace; font-size: 11px; color: #999; word-wrap: break-word; max-height: 100px; overflow-y: auto;">
                                "${preview}${latestComment.body.length > 300 ? '...' : ''}"
                            </div>
                            <small style="color: #666;">Full comment length: ${latestComment.body.length} characters</small>
                        </div>
                    `;
                }
            }

            // Add final summary
            resultHTML += `
                <div style="background: rgba(0,124,186,0.1); padding: 12px; border-radius: 6px; border-top: 2px solid #007cba; margin-top: 15px; text-align: center;">
                    <strong style="color: #007cba;">📋 TEST SUMMARY</strong><br>
                    Ticket #${ticketId}: ${analysis.matches ?
                        '<span style="color: #00ff88;">WOULD BE PROCESSED</span>' :
                        '<span style="color: #ffaa00;">WOULD BE SKIPPED</span>'}
                </div>
            `;

            showTestResult(resultHTML, analysis.matches ? 'success' : 'warning');
            RUMILogger.info('TEST', `Test completed for ticket ${ticketId}`, { matches: analysis.matches, status: ticket.status });

            // Return test result details for batch processing
            return {
                matches: analysis.matches,
                phrase: analysis.phrase,
                previousStatus: ticket.status,
                subject: ticket.subject,
                created_at: ticket.created_at,
                updated_at: ticket.updated_at
            };

        } catch (error) {
            RUMILogger.error('TEST', `Test failed for ticket ${ticketId}`, error);
            throw error;
        }
    }


    function saveRUMIEnhancementSelections() {
        try {
            sessionStorage.setItem('rumi_enhancement_views', JSON.stringify([...rumiEnhancement.selectedViews]));
        } catch (e) {
            RUMILogger.warn('UI', 'Failed to save selections', e);
        }
    }

    function loadRUMIEnhancementSelections() {
        try {
            const saved = sessionStorage.getItem('rumi_enhancement_views');
            if (saved) {
                const viewIds = JSON.parse(saved);

                rumiEnhancement.selectedViews.clear();
                viewIds.forEach(id => {
                    rumiEnhancement.selectedViews.add(id);
                });

                // Update UI elements if they exist
                const viewItems = document.querySelectorAll('.rumi-view-item');
                viewItems.forEach(item => {
                    const viewId = item.dataset.viewId;
                    const checkbox = item.querySelector('.rumi-view-checkbox');

                    if (rumiEnhancement.selectedViews.has(viewId)) {
                        checkbox.checked = true;
                        item.classList.add('selected');
                    } else {
                        checkbox.checked = false;
                        item.classList.remove('selected');
                    }
                });

                updateSelectedViewsCount();
                updateRUMIEnhancementUI();
            }
        } catch (e) {
            RUMILogger.warn('UI', 'Failed to load selections', e);
        }
    }

    // Check if we're on a ticket page
    function isTicketView() {
        return window.location.pathname.includes('/agent/tickets/');
    }

    // Handle ticket view specific functionality
    function handleTicketView() {
        if (!isTicketView() || observerDisconnected) return;

        // Wait a bit for content to stabilize, then add buttons and check for HALA tag
        setTimeout(() => {
            insertRumiButton();
            tryAddToggleButton();

            // Apply the saved field visibility state
            setTimeout(() => {
                applyFieldVisibilityState();
            }, 100);

            // HALA provider tag checking integrated into ticket processing workflow
        }, 500);
    }

    // Handle RUMI Enhancement initialization (legacy function - automation now loads immediately)
    function handleRUMIEnhancementInit() {
        // This function is no longer needed since automation loads immediately in init()
        // Keeping for compatibility but making it a no-op
        return;
    }

    // Views filter functionality
    let viewsAreHidden = false;
    const essentialViews = [
        'SSOC - Open - Urgent',
        'SSOC - Pending - Urgent',
        'SSOC - GCC & EM Open',
        'SSOC - GCC & EM Pending',
        'SSOC - Egypt Urgent',
        'SSOC - Egypt Open',
        'SSOC - Egypt Pending',
        'SSOC_JOD_from ZD only',
        'KSA Safety & Security Tickets',
        'KSA Safety & Security Tickets - New & Open',
        'KSA Safety & Security Tickets - On-hold & Pending',
        'Non-Uber Tickets routing to L1',
        'Autoclosure of warning sent - uber tickets',
        'UAE Safety & Security Tickets'
    ];

    function createViewsToggleButton() {
        // Find the Views header
        const viewsHeader = document.querySelector('[data-test-id="views_views-list_header"] h3');
        if (!viewsHeader) return false;

        // Check if already converted to clickable
        if (viewsHeader.querySelector('#views-toggle-wrapper')) return true;

        // Save the original text content
        const originalText = viewsHeader.textContent.trim();

        // Clear the h3 content and create a wrapper for just the "Views" text
        viewsHeader.innerHTML = '';

        // Create a clickable wrapper for just the "Views" text
        const clickableWrapper = document.createElement('span');
        clickableWrapper.id = 'views-toggle-wrapper';
        clickableWrapper.setAttribute('data-views-toggle', 'true');
        clickableWrapper.setAttribute('role', 'button');
        clickableWrapper.setAttribute('tabindex', '0');
        clickableWrapper.title = 'Click to hide/show non-essential views';

        // Style the clickable wrapper to only affect the text area
        clickableWrapper.style.cssText = `
            cursor: pointer !important;
            user-select: none !important;
            transition: all 0.2s ease !important;
            padding: 2px 6px !important;
            border-radius: 4px !important;
            display: inline-block !important;
            background: transparent !important;
            border: none !important;
            font: inherit !important;
            color: inherit !important;
        `;

        // Add the "Views" text (no icon)
        const textSpan = document.createElement('span');
        textSpan.textContent = originalText;
        clickableWrapper.appendChild(textSpan);

        // Add the clickable wrapper to the h3
        viewsHeader.appendChild(clickableWrapper);

        // Add hover effects only to the wrapper
        const handleMouseEnter = (e) => {
            e.stopPropagation();
            clickableWrapper.style.backgroundColor = '#f8f9fa';
        };

        const handleMouseLeave = (e) => {
            e.stopPropagation();
            clickableWrapper.style.backgroundColor = 'transparent';
        };

        clickableWrapper.addEventListener('mouseenter', handleMouseEnter);
        clickableWrapper.addEventListener('mouseleave', handleMouseLeave);

        // Add click handler with debouncing
        let isClicking = false;
        const handleClick = (e) => {
            e.preventDefault();
            e.stopPropagation();

            if (isClicking) {
                console.log('⚠️ Click ignored - Views text is processing');
                return;
            }

            isClicking = true;
            console.log('🖱️ Views text clicked');

            // Add visual feedback
            clickableWrapper.style.opacity = '0.8';

            try {
                toggleNonEssentialViews();
            } catch (error) {
                console.error('❌ Error in toggle function:', error);
            }

            // Reset visual feedback and debounce flag
            setTimeout(() => {
                clickableWrapper.style.opacity = '1';
                isClicking = false;
            }, 300);
        };

        // Add keyboard support
        const handleKeyDown = (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleClick(e);
            }
        };

        clickableWrapper.addEventListener('click', handleClick);
        clickableWrapper.addEventListener('keydown', handleKeyDown);

        // Set up refresh button monitoring
        setupRefreshButtonMonitoring();

        console.log('✅ Views text converted to clickable toggle (refresh button unaffected)');
        return true;
    }

    function setupRefreshButtonMonitoring() {
        // Find and monitor the refresh button
        const refreshButton = document.querySelector('[data-test-id="views_views-list_header-refresh"]');
        if (refreshButton) {
            // Add event listener to detect refresh clicks
            refreshButton.addEventListener('click', () => {
                if (viewsAreHidden) {
                    console.log('🔄 Refresh button clicked - will re-apply view hiding after refresh completes');

                    // Wait for refresh to complete, then re-apply hiding
                    setTimeout(() => {
                        if (viewsAreHidden) {
                            console.log('🔄 Re-applying view hiding after refresh button click');
                            hideNonEssentialViews();
                        }
                    }, 1000); // Give more time for refresh to fully complete
                }
            });

            console.log('👀 Refresh button monitoring set up');
        } else {
            // If button not found now, try again later
            setTimeout(setupRefreshButtonMonitoring, 1000);
        }
    }

    function toggleNonEssentialViews() {
        console.log(`🔀 Toggling views. Current state: ${viewsAreHidden ? 'hidden' : 'shown'}`);

        viewsAreHidden = !viewsAreHidden;
        const toggleWrapper = document.getElementById('views-toggle-wrapper');

        if (viewsAreHidden) {
            console.log('🙈 Hiding non-essential views...');
            if (toggleWrapper) {
                toggleWrapper.title = 'Click to show all views';
            }
            hideNonEssentialViews();
        } else {
            console.log('👁️ Showing all views...');
            if (toggleWrapper) {
                toggleWrapper.title = 'Click to hide non-essential views';
            }
            showAllViews();
        }

        // Save the state
        localStorage.setItem('viewsAreHidden', viewsAreHidden.toString());
        console.log(`💾 State saved: viewsAreHidden = ${viewsAreHidden}`);
    }

    function hideNonEssentialViews() {
        // Find all view list items - use a more specific selector to avoid duplicates
        const viewItems = document.querySelectorAll('[data-test-id*="views_views-list_item"]:not([data-test-id*="tooltip"])');

        if (viewItems.length === 0) {
            console.log('⚠️ No view items found');
            return;
        }

        console.log(`✅ Found ${viewItems.length} view items`);

        let hiddenCount = 0;
        let keptCount = 0;
        const processedItems = new Set(); // Track processed items to avoid duplicates

        viewItems.forEach(item => {
            // Skip if already processed or is a button/refresh element or our toggle button
            if (item.getAttribute('aria-label') === 'Refresh views pane' ||
                item.id === 'views-toggle-button' ||
                item.getAttribute('data-views-toggle') === 'true' ||
                item.className?.includes('views-toggle-btn') ||
                processedItems.has(item)) {
                return;
            }

            // Get the view name - try to find the most reliable text source
            let viewName = '';

            // Look for the main text element that contains the view name
            const titleElement = item.querySelector('[data-garden-id="typography.ellipsis"]') ||
                item.querySelector('.StyledEllipsis-sc-1u4umy-0') ||
                item.querySelector('span[title]') ||
                item.querySelector('span:not([class*="count"]):not([class*="number"])');

            if (titleElement) {
                viewName = titleElement.getAttribute('title')?.trim() ||
                    titleElement.textContent?.trim() || '';
            }

            // Fallback to item's direct text content, but clean it up
            if (!viewName) {
                const fullText = item.textContent?.trim() || '';
                // Remove trailing numbers that might be counts (like "5", "162", "6.6K")
                viewName = fullText.replace(/\d+(?:\.\d+)?[KMB]?$/, '').trim();
            }

            // Skip if we couldn't get a clean view name or it's too short/generic
            if (!viewName ||
                viewName.length < 3 ||
                viewName.toLowerCase().includes('refresh') ||
                /^\d+$/.test(viewName) || // Skip pure numbers
                viewName === 'Views') {
                return;
            }

            processedItems.add(item);
            console.log(`🔍 Checking view: "${viewName}"`);

            // Check if this view is essential (exact match)
            const isEssential = essentialViews.includes(viewName);

            if (!isEssential) {
                item.classList.add('hidden-view-item');
                item.setAttribute('data-hidden-by-toggle', 'true');
                item.setAttribute('data-view-name', viewName);
                hiddenCount++;
                console.log(`🙈 Hidden view: "${viewName}"`);
            } else {
                // Ensure essential views are visible
                item.classList.remove('hidden-view-item');
                item.removeAttribute('data-hidden-by-toggle');
                keptCount++;
                console.log(`👁️ Keeping essential view: "${viewName}"`);
            }
        });

        console.log(`🔍 Non-essential views hidden: ${hiddenCount} hidden, ${keptCount} kept visible`);

        // Set up observer to handle React re-renders, but with better filtering
        setupViewsObserver();
    }

    function showAllViews() {
        // Show all hidden view items
        const hiddenItems = document.querySelectorAll('[data-hidden-by-toggle="true"]');

        hiddenItems.forEach(item => {
            item.classList.remove('hidden-view-item');
            item.removeAttribute('data-hidden-by-toggle');
        });

        console.log(`👁️ All views shown: ${hiddenItems.length} items restored`);

        // Stop the views observer when showing all views
        if (window.viewsObserver) {
            window.viewsObserver.disconnect();
            window.viewsObserver = null;
        }
    }

    function setupViewsObserver() {
        // Disconnect existing observer if any
        if (window.viewsObserver) {
            window.viewsObserver.disconnect();
        }

        // Create a new observer to handle React re-renders and refresh events
        let isReapplying = false; // Prevent infinite loops

        window.viewsObserver = new MutationObserver((mutations) => {
            if (!viewsAreHidden || isReapplying) return;

            let needsReapply = false;
            let refreshDetected = false;

            // Check for specific changes that would affect view visibility
            mutations.forEach(mutation => {
                // Skip changes to our toggle button, wrapper, or container
                if (mutation.target.id === 'views-toggle-button' ||
                    mutation.target.id === 'views-toggle-wrapper' ||
                    mutation.target.id === 'views-header-left-container' ||
                    mutation.target.getAttribute('data-views-toggle') === 'true' ||
                    mutation.target.className?.includes('views-toggle-btn')) {
                    return;
                }

                // Detect if new view items have been added (refresh scenario)
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeType === 1) { // Element node
                            // Check if this looks like view items being re-added
                            if (node.matches && node.matches('[data-test-id*="views_views-list_item"]')) {
                                console.log('🔄 Detected new view items - likely refresh event');
                                refreshDetected = true;
                            } else if (node.querySelector && node.querySelector('[data-test-id*="views_views-list_item"]')) {
                                console.log('🔄 Detected container with new view items - likely refresh event');
                                refreshDetected = true;
                            }
                        }
                    });
                }

                // Also check for previously hidden items being restored
                if (mutation.target.hasAttribute && mutation.target.hasAttribute('data-hidden-by-toggle')) {
                    if (mutation.type === 'attributes' &&
                        (mutation.attributeName === 'style' || mutation.attributeName === 'class')) {
                        // Check if the hidden class was removed
                        if (!mutation.target.classList.contains('hidden-view-item')) {
                            needsReapply = true;
                        }
                    }
                }
            });

            if (refreshDetected || needsReapply) {
                console.log('🔄 Re-applying view hiding due to refresh or React override...');
                isReapplying = true;

                // Wait a bit for the refresh to complete, then re-apply hiding
                setTimeout(() => {
                    if (viewsAreHidden) {
                        console.log('🔄 Re-running hideNonEssentialViews after refresh...');
                        hideNonEssentialViews();
                    }

                    // Reset the flag
                    isReapplying = false;
                }, 500); // Give time for the refresh to complete
            }
        });

        // Observe the entire views container to catch refresh events
        const viewsContainer = document.querySelector('[data-test-id="views_views-pane_content"]');
        if (viewsContainer) {
            window.viewsObserver.observe(viewsContainer, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['style', 'class']
            });
            console.log('👀 Views observer set up to monitor refresh events');
        }

        // Also observe specific hidden items for direct style changes
        const hiddenItems = document.querySelectorAll('[data-hidden-by-toggle="true"]');
        hiddenItems.forEach(item => {
            window.viewsObserver.observe(item, {
                attributes: true,
                attributeFilter: ['style', 'class']
            });
        });

        console.log(`👀 Views observer set up for refresh detection and ${hiddenItems.length} hidden items`);
    }

    function loadViewsToggleState() {
        const saved = localStorage.getItem('viewsAreHidden');
        if (saved === 'true') {
            viewsAreHidden = true;
            setTimeout(() => {
                const toggleWrapper = document.getElementById('views-toggle-wrapper');

                if (toggleWrapper) {
                    toggleWrapper.title = 'Click to show all views';

                    // Apply hiding directly
                    hideNonEssentialViews();
                }
            }, 500);
        }
    }

    function isViewsPage() {
        return window.location.pathname.includes('/agent/filters/') ||
            document.querySelector('[data-test-id="views_views-pane-div"]');
    }

    function handleViewsPage() {
        if (!isViewsPage()) return;

        // Check if toggle wrapper already exists to prevent duplicates
        if (document.getElementById('views-toggle-wrapper')) {
            console.log('✅ Views toggle already exists');
            return;
        }

        setTimeout(() => {
            if (!document.getElementById('views-toggle-wrapper')) {
                createViewsToggleButton();
                loadViewsToggleState();
            }
        }, 500);
    }

    // Main initialization function
    function init() {
        console.log('🚀 RUMI script initializing...');

        // Always inject CSS and initialize username (regardless of current page)
        injectCSS();
        promptForUsername();

        // Load the saved field visibility state
        loadFieldVisibilityState();

        // Set up observer for dynamic content and URL changes
        const observer = new MutationObserver(() => {
            // Check for ticket view whenever DOM changes
            handleTicketView();
            // Check for views page whenever DOM changes
            handleViewsPage();
            // Note: RUMI Enhancement system loads immediately now, no need for delayed init
        });

        // Start observing (always, not just on ticket pages)
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        // Also listen for URL changes (for single-page app navigation)
        let currentUrl = window.location.href;
        const urlCheckInterval = setInterval(() => {
            if (window.location.href !== currentUrl) {
                currentUrl = window.location.href;
                // URL changed, check if we need to handle ticket view or views page
                setTimeout(handleTicketView, 300);
                setTimeout(handleViewsPage, 300);
            }
        }, 500);

        // Initial attempt if already on a ticket page
        if (isTicketView()) {
            setTimeout(() => {
                insertRumiButton();
                tryAddToggleButton();

                // Apply the saved field visibility state
                setTimeout(() => {
                    applyFieldVisibilityState();
                }, 100);

                // HALA provider tag checking integrated into ticket processing workflow
            }, 1000);
        }

        // Initial attempt if already on a views page
        if (isViewsPage()) {
            setTimeout(() => {
                createViewsToggleButton();
                loadViewsToggleState();
            }, 1000);
        }

        // Initialize RUMI Enhancement system immediately (no delays for automation)
        console.log('🤖 Initializing RUMI Automation system...');
        // Restore saved data first
        RUMIStorage.loadAll();

        // Try to create overlay button with retries for DOM readiness
        const tryCreateOverlayButton = (attempts = 0) => {
            const maxAttempts = 10;
            const success = createRUMIEnhancementOverlayButton();

            if (!success && attempts < maxAttempts) {
                // Retry in 500ms if Zendesk icon not found yet
                setTimeout(() => tryCreateOverlayButton(attempts + 1), 500);
            } else if (success) {
                console.log('✅ RUMI Automation overlay button ready');
            } else {
                console.log('⚠️ RUMI Automation loaded but overlay button creation failed after retries');
            }
        };

        tryCreateOverlayButton();

        // Add keyboard shortcut as fallback (Ctrl+Shift+R)
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.shiftKey && e.key === 'R') {
                e.preventDefault();
                toggleRUMIEnhancementPanel();
                RUMILogger.info('UI', 'RUMI Enhancement opened via keyboard shortcut (Ctrl+Shift+R)');
            }
        });

        RUMILogger.info('SYSTEM', 'RUMI Enhancement system initialized and data restored');
        console.log('✅ RUMI Automation system ready - Use Ctrl+Shift+R or right-click Zendesk icon');
        console.log('🎯 RUMI Automation: Keyboard shortcut Ctrl+Shift+R available as fallback');

        console.log('✅ RUMI script initialized - Automation ready immediately, ticket features wait for page navigation');
    }

    // Wait for page to load and then initialize
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
