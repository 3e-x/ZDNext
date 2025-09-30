// ==UserScript==
// @name         No Activity Handler - Zendesk (Complete)
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Automatically handles tickets with "no activity details available" - Complete with UI
// @author       QWJiYXM=
// @match        *://*.zendesk.com/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    // CONFIGURATION
    const CONFIG = {
        TARGET_GROUP_ID: 20705088,
        TARGET_STATUS: 'open',
        REQUIRED_STATUS: 'new',
        SUBJECT_KEYWORD: 'no activity details available',
        CHECK_INTERVAL: 60000, // Default: 60 seconds
        MIN_INTERVAL: 10000, // Minimum: 10 seconds
        MAX_INTERVAL: 600000, // Maximum: 10 minutes
        MAX_RETRIES: 3,
        CIRCUIT_BREAKER_THRESHOLD: 5,
        DRY_RUN: false
    };

    const state = {
        isMonitoring: false,
        selectedViews: new Set(),
        processedTickets: new Map(),
        baselineTickets: new Map(),
        lastCheckTime: null,
        monitoringStartTime: null,
        totalProcessed: 0,
        totalSkipped: 0,
        consecutiveErrors: 0,
        apiCallCount: 0,
        monitorInterval: null,
        checkInterval: CONFIG.CHECK_INTERVAL,
        logs: [],
        maxLogs: 200
    };

    // LOGGER
    const Logger = {
        levels: ['ERROR', 'WARN', 'INFO', 'DEBUG'],
        currentLevel: 2,
        log(level, category, message, ticketId = null, data = null) {
            const levelNum = this.levels.indexOf(level);
            if (levelNum > this.currentLevel) return;
            const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
            const logEntry = { timestamp, level, category, message, ticketId, data };
            state.logs.push(logEntry);
            if (state.logs.length > state.maxLogs) state.logs.shift();
            const prefix = `[NoActivity ${timestamp}] [${level}] [${category}]`;
            const msg = ticketId ? `${message} (Ticket: ${ticketId})` : message;
            switch (level) {
                case 'ERROR': console.error(prefix, msg, data || ''); break;
                case 'WARN': console.warn(prefix, msg, data || ''); break;
                case 'INFO': console.info(prefix, msg, data || ''); break;
                case 'DEBUG': console.log(prefix, msg, data || ''); break;
            }
            updateLogDisplay();
        },
        error(c, m, t = null, d = null) { this.log('ERROR', c, m, t, d); },
        warn(c, m, t = null, d = null) { this.log('WARN', c, m, t, d); },
        info(c, m, t = null, d = null) { this.log('INFO', c, m, t, d); },
        debug(c, m, t = null, d = null) { this.log('DEBUG', c, m, t, d); }
    };

    // STORAGE
    const Storage = {
        prefix: 'noActivityHandler_',
        save(key, data) {
            try {
                localStorage.setItem(this.prefix + key, JSON.stringify(data));
            } catch (e) {
                Logger.error('STORAGE', `Failed to save ${key}`, null, e);
            }
        },
        load(key, defaultValue = null) {
            try {
                const item = localStorage.getItem(this.prefix + key);
                return item ? JSON.parse(item) : defaultValue;
            } catch (e) {
                return defaultValue;
            }
        },
        saveProcessedTickets() {
            this.save('processedTickets', Array.from(state.processedTickets.entries()));
        },
        loadProcessedTickets() {
            state.processedTickets = new Map(this.load('processedTickets', []));
        },
        saveSelectedViews() {
            this.save('selectedViews', Array.from(state.selectedViews));
        },
        loadSelectedViews() {
            state.selectedViews = new Set(this.load('selectedViews', []));
        },
        saveCheckInterval() {
            this.save('checkInterval', state.checkInterval);
        },
        loadCheckInterval() {
            const saved = this.load('checkInterval', CONFIG.CHECK_INTERVAL);
            state.checkInterval = Math.max(CONFIG.MIN_INTERVAL, Math.min(CONFIG.MAX_INTERVAL, saved));
        },
        clearOldData(days = 7) {
            const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
            let removed = 0;
            for (const [id, data] of state.processedTickets.entries()) {
                if (data.timestamp < cutoff) {
                    state.processedTickets.delete(id);
                    removed++;
                }
            }
            if (removed > 0) {
                this.saveProcessedTickets();
                Logger.info('STORAGE', `Cleared ${removed} old tickets`);
            }
        }
    };

    // API
    const API = {
        async makeRequest(endpoint, options = {}) {
            if (state.consecutiveErrors >= CONFIG.CIRCUIT_BREAKER_THRESHOLD) {
                throw new Error('Circuit breaker activated');
            }
            const opts = {
                method: 'GET',
                headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
                credentials: 'same-origin',
                ...options
            };
            try {
                const response = await fetch(endpoint, opts);
                if (response.status === 429) throw new Error('HTTP 429: Rate limited');
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const data = await response.json();
                state.consecutiveErrors = 0;
                state.apiCallCount++;
                return data;
            } catch (error) {
                if (!error.message.includes('429')) state.consecutiveErrors++;
                Logger.error('API', `Request failed: ${error.message}`, null, { endpoint });
                throw error;
            }
        },
        async makeRequestWithRetry(endpoint, options = {}, retries = CONFIG.MAX_RETRIES) {
            try {
                return await this.makeRequest(endpoint, options);
            } catch (error) {
                if (!error.message.includes('429') && retries > 0) {
                    await new Promise(r => setTimeout(r, 2000));
                    return await this.makeRequestWithRetry(endpoint, options, retries - 1);
                }
                throw error;
            }
        },
        getCSRFToken() {
            return document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') ||
                   document.querySelector('meta[name="_csrf"]')?.getAttribute('content') ||
                   window.csrfToken || null;
        }
    };

    // ZENDESK API
    const Zendesk = {
        async getViews() {
            const data = await API.makeRequestWithRetry('/api/v2/views.json');
            return data.views || [];
        },
        async getViewTickets(viewId) {
            const data = await API.makeRequestWithRetry(`/api/v2/views/${viewId}/tickets.json?include=subjects`);
            return data.tickets || [];
        },
        async getTicket(ticketId) {
            const data = await API.makeRequestWithRetry(`/api/v2/tickets/${ticketId}.json`);
            return data.ticket;
        },
        async updateTicket(ticketId, updates) {
            if (CONFIG.DRY_RUN) {
                const desc = Object.entries(updates).map(([k, v]) => `${k}: ${v}`).join(', ');
                Logger.info('DRY-RUN', `Would update ticket ${ticketId} - ${desc}`, ticketId);
                return { ticket: { id: ticketId, ...updates } };
            }
            const csrfToken = API.getCSRFToken();
            if (!csrfToken) throw new Error('CSRF token not found');
            const data = await API.makeRequestWithRetry(`/api/v2/tickets/${ticketId}.json`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': csrfToken,
                    'X-Requested-With': 'XMLHttpRequest'
                },
                body: JSON.stringify({ ticket: updates })
            });
            const updatesList = Object.entries(updates).map(([k, v]) => `${k}: ${v}`).join(', ');
            Logger.info('ZENDESK', `Updated ticket ${ticketId} - ${updatesList}`, ticketId);
            return data;
        }
    };

    // TICKET PROCESSOR
    const Processor = {
        shouldProcess(ticket) {
            if (state.processedTickets.has(ticket.id)) {
                return { process: false, reason: 'Already processed' };
            }
            if (ticket.status !== CONFIG.REQUIRED_STATUS) {
                return { process: false, reason: `Status is "${ticket.status}", not "${CONFIG.REQUIRED_STATUS}"` };
            }
            const subject = (ticket.subject || '').toLowerCase();
            if (!subject.includes(CONFIG.SUBJECT_KEYWORD.toLowerCase())) {
                return { process: false, reason: 'Subject does not contain keyword' };
            }
            return { process: true };
        },
        async processTicket(ticket, viewName = null) {
            const ticketId = ticket.id;
            Logger.info('PROCESS', `Evaluating ticket ${ticketId}`, ticketId);
            
            // Always fetch full ticket details to ensure we have accurate status
            let fullTicket;
            try {
                fullTicket = await Zendesk.getTicket(ticketId);
                Logger.debug('PROCESS', `Fetched full ticket ${ticketId} - status: ${fullTicket.status}`, ticketId);
            } catch (error) {
                Logger.error('PROCESS', `Failed to fetch ticket ${ticketId}`, ticketId, error);
                return false;
            }
            
            const check = this.shouldProcess(fullTicket);
            if (!check.process) {
                Logger.debug('PROCESS', `Skipped: ${check.reason}`, ticketId);
                state.totalSkipped++;
                return false;
            }
            try {
                await Zendesk.updateTicket(ticketId, {
                    group_id: CONFIG.TARGET_GROUP_ID,
                    status: CONFIG.TARGET_STATUS
                });
                state.processedTickets.set(ticketId, {
                    timestamp: Date.now(),
                    status: CONFIG.TARGET_STATUS,
                    groupId: CONFIG.TARGET_GROUP_ID,
                    subject: fullTicket.subject,
                    viewName: viewName || 'Unknown'
                });
                state.totalProcessed++;
                Storage.saveProcessedTickets();
                updateUI();
                Logger.info('PROCESS', `Successfully processed ticket ${ticketId}`, ticketId);
                return true;
            } catch (error) {
                Logger.error('PROCESS', `Failed to process ticket ${ticketId}`, ticketId, error);
                return false;
            }
        },
        async processById(ticketId) {
            // processTicket now fetches the full ticket internally, so just pass the ID
            return await this.processTicket({ id: ticketId });
        }
    };

    // MONITORING
    const Monitor = {
        async establishBaseline() {
            Logger.info('MONITOR', 'Establishing baseline');
            for (const viewId of state.selectedViews) {
                try {
                    const tickets = await Zendesk.getViewTickets(viewId);
                    state.baselineTickets.set(viewId, new Set(tickets.map(t => t.id)));
                    Logger.info('MONITOR', `Baseline for view ${viewId}: ${tickets.length} tickets`);
                } catch (error) {
                    Logger.error('MONITOR', `Failed baseline for view ${viewId}`, null, error);
                }
            }
        },
        async checkViews() {
            if (!state.isMonitoring || state.selectedViews.size === 0) return;
            state.lastCheckTime = new Date();
            updateUI();
            if (state.consecutiveErrors >= CONFIG.CIRCUIT_BREAKER_THRESHOLD) {
                Logger.warn('MONITOR', 'Circuit breaker - pausing 2min');
                setTimeout(() => {
                    if (state.isMonitoring) {
                        state.consecutiveErrors = 0;
                        Logger.info('MONITOR', 'Resuming');
                    }
                }, 120000);
                return;
            }
            const viewIds = Array.from(state.selectedViews);
            const results = await Promise.allSettled(viewIds.map(id => this.checkSingleView(id)));
            let rateLimits = 0;
            results.forEach(r => {
                if (r.status === 'rejected' && r.reason.message.includes('429')) rateLimits++;
            });
            if (rateLimits > 0) {
                Logger.warn('MONITOR', `Rate limited ${rateLimits}/${viewIds.length} views`);
            }
            updateUI();
        },
        async checkSingleView(viewId) {
            const tickets = await Zendesk.getViewTickets(viewId);
            const currentIds = new Set(tickets.map(t => t.id));
            const baselineIds = state.baselineTickets.get(viewId) || new Set();
            const newTickets = tickets.filter(t => !baselineIds.has(t.id));
            if (newTickets.length > 0) {
                Logger.info('MONITOR', `Found ${newTickets.length} new tickets in view ${viewId}`);
                for (const ticket of newTickets) {
                    if (!state.processedTickets.has(ticket.id)) {
                        await Processor.processTicket(ticket, `View ${viewId}`);
                        await new Promise(r => setTimeout(r, 1000));
                    }
                }
            }
            state.baselineTickets.set(viewId, currentIds);
        },
        async start() {
            if (state.isMonitoring) {
                Logger.warn('MONITOR', 'Already active');
                return;
            }
            if (state.selectedViews.size === 0) {
                alert('Please select at least one view');
                return;
            }
            Logger.info('MONITOR', `Starting for ${state.selectedViews.size} views`);
            state.isMonitoring = true;
            state.monitoringStartTime = new Date();
            try {
                await this.establishBaseline();
                state.monitorInterval = setInterval(() => this.checkViews(), state.checkInterval);
                Logger.info('MONITOR', `Started with ${state.checkInterval}ms interval`);
            } catch (error) {
                Logger.error('MONITOR', 'Failed to start', null, error);
                state.isMonitoring = false;
            }
            updateUI();
        },
        async restart() {
            if (!state.isMonitoring) return;
            Logger.info('MONITOR', 'Restarting with new interval');
            if (state.monitorInterval) {
                clearInterval(state.monitorInterval);
                state.monitorInterval = null;
            }
            state.monitorInterval = setInterval(() => this.checkViews(), state.checkInterval);
            Logger.info('MONITOR', `Restarted with ${state.checkInterval}ms interval`);
        },
        stop() {
            if (!state.isMonitoring) return;
            Logger.info('MONITOR', 'Stopping');
            state.isMonitoring = false;
            if (state.monitorInterval) {
                clearInterval(state.monitorInterval);
                state.monitorInterval = null;
            }
            updateUI();
        }
    };

    // UI FUNCTIONS
    function updateUI() {
        const els = {
            processed: document.getElementById('totalProcessed'),
            skipped: document.getElementById('totalSkipped'),
            apiCalls: document.getElementById('apiCalls'),
            errorCount: document.getElementById('errorCount'),
            lastCheck: document.getElementById('lastCheck'),
            status: document.getElementById('monitoringStatus'),
            startBtn: document.getElementById('startMonitoring'),
            stopBtn: document.getElementById('stopMonitoring'),
            intervalInput: document.getElementById('checkInterval')
        };
        
        if (els.processed) els.processed.textContent = state.totalProcessed;
        if (els.skipped) els.skipped.textContent = state.totalSkipped;
        if (els.apiCalls) els.apiCalls.textContent = state.apiCallCount;
        if (els.errorCount) els.errorCount.textContent = state.consecutiveErrors;
        
        if (els.lastCheck && state.lastCheckTime) {
            const seconds = Math.floor((Date.now() - state.lastCheckTime.getTime()) / 1000);
            els.lastCheck.textContent = seconds < 60 ? `${seconds}s ago` : `${Math.floor(seconds / 60)}m ago`;
        }
        
        if (els.status) {
            els.status.textContent = state.isMonitoring ? 'Active' : 'Inactive';
            els.status.style.color = state.isMonitoring ? '#2ecc71' : '#e74c3c';
        }
        
        if (els.startBtn) {
            els.startBtn.disabled = state.isMonitoring;
            els.startBtn.style.opacity = state.isMonitoring ? '0.5' : '1';
        }
        
        if (els.stopBtn) {
            els.stopBtn.disabled = !state.isMonitoring;
            els.stopBtn.style.opacity = state.isMonitoring ? '1' : '0.5';
        }
        
        if (els.intervalInput && els.intervalInput.value !== String(state.checkInterval / 1000)) {
            els.intervalInput.value = state.checkInterval / 1000;
        }
        
        updateProcessedList();
        updateViewsCount();
    }

    function updateProcessedList() {
        const list = document.getElementById('processedList');
        if (!list) return;
        if (state.processedTickets.size === 0) {
            list.innerHTML = '<p style="color: #999; text-align: center;">No tickets processed yet</p>';
            return;
        }
        const tickets = Array.from(state.processedTickets.entries())
            .sort((a, b) => b[1].timestamp - a[1].timestamp)
            .slice(0, 20);
        list.innerHTML = tickets.map(([id, data]) => {
            const mins = Math.floor((Date.now() - data.timestamp) / 60000);
            const time = mins < 60 ? `${mins}m ago` : `${Math.floor(mins / 60)}h ago`;
            return `<div style="padding: 8px; border-bottom: 1px solid #eee;">
                <a href="https://gocareem.zendesk.com/agent/tickets/${id}" target="_blank" 
                   style="color: #2ecc71; text-decoration: none; font-weight: bold;">#${id}</a>
                <span style="color: #666; font-size: 11px; margin-left: 10px;">${time}</span>
                <div style="font-size: 11px; color: #999; margin-top: 4px;">${data.subject || 'No subject'}</div>
            </div>`;
        }).join('');
    }

    function updateLogDisplay() {
        const logDisplay = document.getElementById('logDisplay');
        if (!logDisplay) return;
        const colors = { 'ERROR': '#e74c3c', 'WARN': '#f39c12', 'INFO': '#3498db', 'DEBUG': '#95a5a6' };
        const recent = state.logs.slice(-50).reverse();
        logDisplay.innerHTML = recent.map(log => {
            const color = colors[log.level] || '#dcdcdc';
            const ticket = log.ticketId ? ` [#${log.ticketId}]` : '';
            return `<div style="margin-bottom: 4px;"><span style="color: #888;">${log.timestamp}</span> <span style="color: ${color}; font-weight: bold;">[${log.level}]</span> <span style="color: #6a9fb5;">[${log.category}]</span> ${log.message}${ticket}</div>`;
        }).join('');
    }

    function updateViewsCount() {
        const el = document.getElementById('viewsCount');
        if (el) el.textContent = `(${state.selectedViews.size} selected)`;
    }

    async function loadViewsList() {
        const list = document.getElementById('viewsList');
        list.innerHTML = '<p style="color: #999; text-align: center;">Loading...</p>';
        try {
            const views = await Zendesk.getViews();
            list.innerHTML = '';
            views.forEach(view => {
                const checked = state.selectedViews.has(view.id) ? 'checked' : '';
                const div = document.createElement('div');
                div.style.cssText = 'display: flex; align-items: center; padding: 8px; border-bottom: 1px solid #eee; cursor: pointer;';
                div.innerHTML = `<input type="checkbox" id="view_${view.id}" ${checked} style="margin-right: 10px;">
                    <label for="view_${view.id}" style="cursor: pointer; flex: 1;">${view.title}</label>`;
                div.addEventListener('click', (e) => {
                    if (e.target.tagName !== 'INPUT') {
                        const cb = div.querySelector('input');
                        cb.checked = !cb.checked;
                    }
                    const cb = div.querySelector('input');
                    if (cb.checked) {
                        state.selectedViews.add(view.id);
                    } else {
                        state.selectedViews.delete(view.id);
                    }
                    Storage.saveSelectedViews();
                    updateViewsCount();
                });
                list.appendChild(div);
            });
            Logger.info('UI', `Loaded ${views.length} views`);
        } catch (error) {
            list.innerHTML = '<p style="color: #e74c3c; text-align: center;">Failed to load views</p>';
            Logger.error('UI', 'Failed to load views', null, error);
        }
    }

    function createUI() {
        // Add right-click handler to Zendesk icon instead of floating button
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
                Logger.debug('UI', `Found Zendesk icon with selector: ${selector}`);
                break;
            }
        }

        if (!zendeskIcon) {
            Logger.warn('UI', 'Zendesk icon not found - cannot attach handler');
            return;
        }

        // Check if already enhanced
        if (zendeskIcon.dataset.noActivityEnhanced === 'true') {
            return; // Already enhanced
        }

        // Mark as enhanced
        zendeskIcon.dataset.noActivityEnhanced = 'true';

        // Update title to indicate right-click
        const originalTitle = zendeskIcon.getAttribute('title') || 'Zendesk';
        zendeskIcon.setAttribute('title', `${originalTitle} - Right-click for No Activity Handler`);

        // Add visual indicator (small icon)
        const indicator = document.createElement('div');
        indicator.innerHTML = '📋';
        indicator.style.cssText = `
            position: absolute !important;
            bottom: -3px !important;
            right: -3px !important;
            font-size: 10px !important;
            z-index: 10000 !important;
            pointer-events: none !important;
            opacity: 0.7 !important;
            background: white !important;
            border-radius: 50% !important;
            width: 16px !important;
            height: 16px !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
        `;

        zendeskIcon.style.position = 'relative';
        zendeskIcon.appendChild(indicator);

        // Add right-click handler
        zendeskIcon.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            togglePanel();
        });

        // Add hover effect
        zendeskIcon.addEventListener('mouseenter', () => {
            indicator.style.opacity = '1';
        });

        zendeskIcon.addEventListener('mouseleave', () => {
            indicator.style.opacity = '0.7';
        });

        Logger.info('UI', 'No Activity Handler attached to Zendesk icon (right-click to open)');

        // Panel
        const panel = document.createElement('div');
        panel.id = 'noActivityPanel';
        Object.assign(panel.style, {
            position: 'fixed', top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)', width: '900px', maxHeight: '80vh',
            backgroundColor: 'white', borderRadius: '12px',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
            zIndex: '10000', display: 'none', flexDirection: 'column'
        });
        
        panel.innerHTML = `
            <div style="background: linear-gradient(135deg, #2ecc71 0%, #27ae60 100%); padding: 20px; color: white;">
                <h2 style="margin: 0; font-size: 24px; font-weight: bold;">📋 No Activity Handler</h2>
                <p style="margin: 5px 0 0 0; opacity: 0.9; font-size: 14px;">Automatically processes tickets with "${CONFIG.SUBJECT_KEYWORD}"</p>
                <button id="closePanel" style="position: absolute; top: 15px; right: 15px; background: rgba(255,255,255,0.2); border: none; color: white; font-size: 24px; cursor: pointer; width: 35px; height: 35px; border-radius: 50%;">×</button>
            </div>
            <div style="padding: 20px; overflow-y: auto; flex: 1;">
                <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
                    <h3 style="margin: 0 0 10px 0; font-size: 16px;">Status</h3>
                    <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px;">
                        <div style="background: white; padding: 10px; border-radius: 6px; text-align: center;">
                            <div id="totalProcessed" style="font-size: 24px; font-weight: bold; color: #2ecc71;">0</div>
                            <div style="font-size: 12px; color: #666;">Processed</div>
                        </div>
                        <div style="background: white; padding: 10px; border-radius: 6px; text-align: center;">
                            <div id="totalSkipped" style="font-size: 24px; font-weight: bold; color: #95a5a6;">0</div>
                            <div style="font-size: 12px; color: #666;">Skipped</div>
                        </div>
                        <div style="background: white; padding: 10px; border-radius: 6px; text-align: center;">
                            <div id="apiCalls" style="font-size: 24px; font-weight: bold; color: #3498db;">0</div>
                            <div style="font-size: 12px; color: #666;">API Calls</div>
                        </div>
                        <div style="background: white; padding: 10px; border-radius: 6px; text-align: center;">
                            <div id="errorCount" style="font-size: 24px; font-weight: bold; color: #e74c3c;">0</div>
                            <div style="font-size: 12px; color: #666;">Errors</div>
                        </div>
                    </div>
                    <div style="margin-top: 10px; font-size: 12px; color: #666;">
                        <div>Last Check: <span id="lastCheck">Never</span></div>
                        <div>Monitoring: <span id="monitoringStatus" style="font-weight: bold;">Inactive</span></div>
                    </div>
                </div>
                <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
                    <h3 style="margin: 0 0 10px 0; font-size: 16px;">Controls</h3>
                    <div style="display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 15px;">
                        <button id="startMonitoring" style="flex: 1; padding: 10px 20px; background: #2ecc71; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold;">▶ Start</button>
                        <button id="stopMonitoring" style="flex: 1; padding: 10px 20px; background: #e74c3c; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold;" disabled>⏹ Stop</button>
                        <button id="testTicket" style="flex: 1; padding: 10px 20px; background: #3498db; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold;">🧪 Test</button>
                        <button id="clearData" style="padding: 10px 20px; background: #95a5a6; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold;">🗑 Clear</button>
                    </div>
                    <div style="background: white; padding: 12px; border-radius: 6px; display: flex; align-items: center; gap: 10px;">
                        <label for="checkInterval" style="font-weight: bold; color: #333;">Check Interval:</label>
                        <input type="number" id="checkInterval" min="10" max="600" step="5" style="padding: 8px; border: 2px solid #ddd; border-radius: 4px; width: 100px; font-size: 14px;">
                        <span style="color: #666;">seconds</span>
                        <button id="applyInterval" style="padding: 8px 16px; background: #3498db; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; margin-left: auto;">Apply</button>
                        <span id="intervalStatus" style="color: #666; font-size: 12px;"></span>
                    </div>
                </div>
                <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
                    <h3 style="margin: 0 0 10px 0; font-size: 16px;">Views <span id="viewsCount" style="color: #2ecc71; font-weight: bold;">(0 selected)</span></h3>
                    <button id="loadViews" style="padding: 8px 16px; background: #3498db; color: white; border: none; border-radius: 6px; cursor: pointer; margin-bottom: 10px;">Load Views</button>
                    <div id="viewsList" style="max-height: 200px; overflow-y: auto; background: white; border-radius: 6px; padding: 10px;">
                        <p style="color: #999; text-align: center;">Click "Load Views"</p>
                    </div>
                </div>
                <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
                    <h3 style="margin: 0 0 10px 0; font-size: 16px;">Processed Tickets</h3>
                    <div id="processedList" style="max-height: 200px; overflow-y: auto; background: white; border-radius: 6px; padding: 10px;">
                        <p style="color: #999; text-align: center;">No tickets yet</p>
                    </div>
                </div>
                <div style="background: #f8f9fa; padding: 15px; border-radius: 8px;">
                    <h3 style="margin: 0 0 10px 0; font-size: 16px;">Logs</h3>
                    <div id="logDisplay" style="max-height: 200px; overflow-y: auto; background: #1e1e1e; color: #dcdcdc; border-radius: 6px; padding: 10px; font-family: monospace; font-size: 11px;">
                        <div style="color: #888;">Logs will appear here...</div>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(panel);
        attachEventListeners();
    }

    function togglePanel() {
        const panel = document.getElementById('noActivityPanel');
        if (panel.style.display === 'none') {
            panel.style.display = 'flex';
            updateUI();
        } else {
            panel.style.display = 'none';
        }
    }

    function attachEventListeners() {
        document.getElementById('closePanel').addEventListener('click', togglePanel);
        document.getElementById('startMonitoring').addEventListener('click', () => Monitor.start());
        document.getElementById('stopMonitoring').addEventListener('click', () => Monitor.stop());
        document.getElementById('testTicket').addEventListener('click', async () => {
            const id = prompt('Enter ticket ID:');
            if (id) {
                Logger.info('TEST', `Testing ticket ${id}`);
                const result = await Processor.processById(parseInt(id));
                alert(result ? `Ticket ${id} processed!` : `Failed to process ${id}`);
            }
        });
        document.getElementById('clearData').addEventListener('click', () => {
            if (confirm('Clear all data?')) {
                state.processedTickets.clear();
                Storage.saveProcessedTickets();
                Logger.info('STORAGE', 'Cleared all data');
                updateUI();
            }
        });
        document.getElementById('loadViews').addEventListener('click', loadViewsList);
        document.getElementById('applyInterval').addEventListener('click', () => {
            const input = document.getElementById('checkInterval');
            const seconds = parseInt(input.value);
            const ms = seconds * 1000;
            
            if (ms < CONFIG.MIN_INTERVAL || ms > CONFIG.MAX_INTERVAL) {
                const statusEl = document.getElementById('intervalStatus');
                statusEl.textContent = `Must be between ${CONFIG.MIN_INTERVAL / 1000}-${CONFIG.MAX_INTERVAL / 1000}s`;
                statusEl.style.color = '#e74c3c';
                setTimeout(() => { statusEl.textContent = ''; }, 3000);
                return;
            }
            
            state.checkInterval = ms;
            Storage.saveCheckInterval();
            
            const statusEl = document.getElementById('intervalStatus');
            statusEl.textContent = '✓ Saved!';
            statusEl.style.color = '#2ecc71';
            setTimeout(() => { statusEl.textContent = ''; }, 2000);
            
            Logger.info('CONFIG', `Check interval updated to ${seconds}s`);
            
            // Restart monitoring if active
            if (state.isMonitoring) {
                Monitor.restart();
            }
        });
    }

    // INIT
    function init() {
        Logger.info('INIT', 'No Activity Handler initializing...');
        Storage.loadProcessedTickets();
        Storage.loadSelectedViews();
        Storage.loadCheckInterval();
        Storage.clearOldData(7);
        
        // Try to create UI with retries (Zendesk icon may not be immediately available)
        const tryCreateUI = (attempts = 0) => {
            const maxAttempts = 10;
            const zendeskIcon = document.querySelector('div[data-test-id="zendesk_icon"]') || 
                               document.querySelector('div[title="Zendesk"]');
            
            if (zendeskIcon) {
                createUI();
                Logger.info('INIT', 'Handler initialized successfully');
            } else if (attempts < maxAttempts) {
                Logger.debug('INIT', `Zendesk icon not found, retrying (${attempts + 1}/${maxAttempts})...`);
                setTimeout(() => tryCreateUI(attempts + 1), 1000);
            } else {
                Logger.error('INIT', 'Failed to find Zendesk icon after maximum attempts');
            }
        };
        
        setTimeout(() => tryCreateUI(), 2000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
