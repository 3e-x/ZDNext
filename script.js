// ==UserScript==
// @name         AutoDeskX
// @namespace    http://tampermonkey.net/
// @version      2.1
// @description  Streamlines Zendesk workflows with field control, autofill, and ticket parsing
// @author       QWJiYXM=
// @match        *://*.zendesk.com/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    // Field visibility state: 'all', 'standard', 'minimal'
    let fieldVisibilityState = 'standard';
    let globalButton = null;
    let textWindow = null;

    let lastCsvResult = '';
    let lastCaptainCsv = '';
    let lastCustomerCsv = '';
    let username = '';

    // Store processed profile data for inbound template
    let storedCaptainProfile = null;
    let storedCustomerProfile = null;

    // Performance optimization variables
    let domCache = new Map();
    let isProcessing = false;
    let pendingUpdates = new Set();
    let observerDisconnected = false;

    // Debouncing variables
    let debounceTimers = new Map();

    // Cleanup registry for intervals and observers
    let cleanupRegistry = new Set();

    // Utility functions for performance optimization
    function debounce(func, delay, key) {
        if (debounceTimers.has(key)) {
            clearTimeout(debounceTimers.get(key));
        }

        const timerId = setTimeout(() => {
            debounceTimers.delete(key);
            func();
        }, delay);

        debounceTimers.set(key, timerId);
        cleanupRegistry.add(() => {
            if (debounceTimers.has(key)) {
                clearTimeout(debounceTimers.get(key));
                debounceTimers.delete(key);
            }
        });
    }

    function getCachedElements(selector, maxAge = 1000) {
        const now = Date.now();
        const cached = domCache.get(selector);

        if (cached && (now - cached.timestamp) < maxAge) {
            return cached.elements;
        }

        const elements = document.querySelectorAll(selector);
        domCache.set(selector, { elements, timestamp: now });

        // Clean old cache entries
        if (domCache.size > 50) {
            for (const [key, value] of domCache.entries()) {
                if ((now - value.timestamp) > maxAge * 2) {
                    domCache.delete(key);
                }
            }
        }

        return elements;
    }

    function clearDomCache() {
        domCache.clear();
    }

    function registerCleanup(cleanupFn) {
        cleanupRegistry.add(cleanupFn);
    }

    function performCleanup() {
        cleanupRegistry.forEach(fn => {
            try {
                fn();
            } catch (e) {
                console.warn('Cleanup error:', e);
            }
        });
        cleanupRegistry.clear();
        clearDomCache();
    }

    // Throttled processing to prevent overwhelming the browser
    function processWithThrottling(processFn, delay = 100) {
        if (isProcessing) {
            return Promise.resolve();
        }

        isProcessing = true;
        return new Promise(resolve => {
            setTimeout(() => {
                try {
                    processFn();
                } finally {
                    isProcessing = false;
                    resolve();
                }
            }, delay);
        });
    }

    // Function to prompt for agent name
    function promptForUsername() {
        return new Promise((resolve) => {
            // Check if username is already stored in localStorage
            const storedUsername = localStorage.getItem('zendesk_agent_username');
            if (storedUsername && storedUsername.trim()) {
                username = storedUsername.trim();
                console.log(`🔐 Agent name loaded from storage: ${username}`);
                resolve(username);
                return;
            }

            // Create a modal overlay
            const overlay = document.createElement('div');
            overlay.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background-color: rgba(0, 0, 0, 0.7);
                z-index: 10000;
                display: flex;
                justify-content: center;
                align-items: center;
                font-family: Arial, sans-serif;
            `;

            // Create the modal dialog
            const modal = document.createElement('div');
            modal.style.cssText = `
                background: white;
                padding: 30px;
                border-radius: 10px;
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
                max-width: 400px;
                width: 90%;
                text-align: center;
            `;

            // Create the form content
            modal.innerHTML = `
                <h2 style="margin: 0 0 20px 0; color: #333; font-size: 24px;">AutoDeskX Setup</h2>
                <p style="margin: 0 0 20px 0; color: #666; font-size: 16px;">Please enter your agent name to continue:</p>
                <input type="text" id="agent-name-input" placeholder="Enter your name..."
                       style="width: 100%; padding: 12px; border: 2px solid #ddd; border-radius: 5px;
                              font-size: 16px; margin-bottom: 20px; box-sizing: border-box;">
                <div>
                    <button id="agent-name-submit"
                            style="background: #007cbb; color: white; border: none; padding: 12px 24px;
                                   border-radius: 5px; font-size: 16px; cursor: pointer; margin-right: 10px;">
                        Continue
                    </button>
                    <button id="agent-name-cancel"
                            style="background: #ccc; color: #333; border: none; padding: 12px 24px;
                                   border-radius: 5px; font-size: 16px; cursor: pointer;">
                        Cancel
                    </button>
                </div>
            `;

            overlay.appendChild(modal);
            document.body.appendChild(overlay);

            const input = modal.querySelector('#agent-name-input');
            const submitBtn = modal.querySelector('#agent-name-submit');
            const cancelBtn = modal.querySelector('#agent-name-cancel');

            // Focus on input
            setTimeout(() => input.focus(), 100);

            // Handle submit
            function handleSubmit() {
                const name = input.value.trim();
                if (name) {
                    username = name;
                    localStorage.setItem('zendesk_agent_username', username);
                    console.log(`🔐 Agent name set: ${username}`);
                    document.body.removeChild(overlay);
                    resolve(username);
                } else {
                    input.style.borderColor = '#ff4444';
                    input.placeholder = 'Name is required!';
                    input.focus();
                }
            }

            // Handle cancel
            function handleCancel() {
                document.body.removeChild(overlay);
                console.log('🚫 Agent name setup cancelled');
                resolve('');
            }

            // Event listeners
            submitBtn.addEventListener('click', handleSubmit);
            cancelBtn.addEventListener('click', handleCancel);

            // Allow Enter key to submit
            input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    handleSubmit();
                }
            });

            // Allow Escape key to cancel
            document.addEventListener('keydown', function escapeHandler(e) {
                if (e.key === 'Escape') {
                    document.removeEventListener('keydown', escapeHandler);
                    handleCancel();
                }
            });
        });
    }

    function injectCSS() {
        if (document.getElementById('form-manager-styles')) return;

        const style = document.createElement('style');
        style.id = 'form-manager-styles';
        style.textContent = `
                .hidden-form-field {
                    display: none !important;
                }
                .form-toggle-icon {
                    width: 26px;
                    height: 26px;
                    cursor: pointer;
                    padding: 8px;
                    border-radius: 4px;
                    margin: 4px 12px;
                    background: transparent;
                    border: none;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: rgb(23, 24, 26);
                }
                .form-toggle-icon:hover {
                    background-color: rgba(47, 57, 65, 0.08);
                }
                .form-toggle-icon svg {
                    width: 26px;
                    height: 26px;
                    fill: currentColor;
                }
                .nav-separator {
                    height: 2px;
                    background-color: rgba(47, 57, 65, 0.24);
                    margin: 12px 16px;
                    width: calc(100% - 32px);
                    border-radius: 1px;
                }
                .custom-nav-section {
                    margin-top: 12px;
                }
                .form-toggle-text {
                    font-family: -apple-system, system-ui, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                    font-size: 13px;
                    margin-left: 8px;
                    color: rgb(68, 73, 80);
                }
                .text-window-pane {
                    position: fixed;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    background: white;
                    padding: 20px;
                    border-radius: 8px;
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
                    z-index: 10000;
                    width: 600px;
                    display: none;
                }
                .text-window-pane.show {
                    display: block;
                }
                .text-window-textarea {
                    width: 100%;
                    height: 300px;
                    margin: 10px 0;
                    padding: 8px;
                    border: 1px solid #ccc;
                    border-radius: 4px;
                    resize: vertical;
                    font-family: monospace;
                    white-space: pre;
                    font-size: 14px;
                    line-height: 1.4;
                }
                .text-window-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 15px;
                }
                .text-window-title {
                    font-size: 16px;
                    font-weight: 600;
                    color: #2f3941;
                }
                .text-window-close {
                    background: transparent;
                    border: none;
                    cursor: pointer;
                    padding: 4px;
                    color: #68737d;
                    font-size: 20px;
                }
                .text-window-close:hover {
                    color: #2f3941;
                }
                .text-window-overlay {
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: rgba(0, 0, 0, 0.5);
                    z-index: 9999;
                    display: none;
                }
                .text-window-overlay.show {
                    display: block;
                }
                .nav-list-item {
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    width: 100%;
                }
                .toast-notification {
                    position: fixed;
                    top: 20px;
                    left: 50%;
                    transform: translateX(-50%);
                    background-color: #17494D;
                    color: white;
                    padding: 12px 24px;
                    border-radius: 4px;
                    z-index: 10000;
                    font-family: -apple-system, system-ui, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                    font-size: 14px;
                    box-shadow: 0 2px 5px rgba(0,0,0,0.2);
                    opacity: 0;
                    transition: opacity 0.3s ease-in-out;
                }
                .toast-notification.show {
                    opacity: 1;
                }
                .copy-button {
                    background: transparent;
                    border: none;
                    cursor: pointer;
                    padding: 4px;
                    margin-left: 4px;
                    border-radius: 4px;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    color: rgb(68, 73, 80);
                    position: absolute;
                    right: 8px;
                    z-index: 100;
                }
                .copy-button:hover {
                    background-color: rgba(47, 57, 65, 0.08);
                }
                .copy-button svg {
                    width: 14px;
                    height: 14px;
                    fill: currentColor;
                }
                .sidebar_box_container {
                    padding-bottom: 20px !important;
                }
                            .label-container {
                display: flex;
                align-items: center;
                margin-bottom: 4px;
            }
            .StyledField-sc-12gzfsu-0 {
                position: relative;
            }
            [data-garden-id="forms.input_label"] {
                display: inline-flex;
                align-items: center;
            }
            /* Fix for autocomplete menu labels */
            label.StyledLabel-sc-2utmsz-0[data-garden-id="forms.input_label"][for^="downshift-"][id^="downshift-"][class*="jIoHmc"],
            .mount-point-wrapper:empty {
                display: none !important;
            }
            .text-window-transform-button {
                background-color: #17494D;
                color: white;
                border: none;
                padding: 10px 20px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 14px;
                margin-top: 10px;
                width: 100%;
                transition: background-color 0.2s;
            }
            .text-window-transform-button:hover {
                background-color: #1A5B60;
            }
            .text-window-transform-button:active {
                background-color: #153F42;
            }
            .sc-ymabb7-1.fTDEYw {
                display: inline-flex !important;
                align-items: center !important;
            }
            /* Custom text icon styles */
            .custom-text-icon {
                position: relative !important;
            }
            .custom-text-icon::before {
                content: attr(data-icon-text) !important;
                position: absolute !important;
                top: 50% !important;
                left: 50% !important;
                transform: translate(-50%, -50%) !important;
                font-family: Arial, "Helvetica Neue", sans-serif !important;
                font-size: 16px !important;
                font-weight: normal !important;
                color: currentColor !important;
                pointer-events: none !important;
                line-height: 1 !important;
                text-rendering: auto !important;
                -webkit-font-feature-settings: "liga" off !important;
                font-feature-settings: "liga" off !important;
            }
            `;
        document.head.appendChild(style);
    }

    const eyeOpenSVG = `<svg viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>`;
    const eyeClosedSVG = `<svg viewBox="0 0 24 24"><path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/></svg>`;
    const eyeMinimalSVG = `<svg viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg>`;
    const copySVG = `<svg viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>`;
    const checklistSVG = `<svg viewBox="0 0 24 24"><path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7zm-4 6h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"/></svg>`;
    const autoFillSVG = `<svg viewBox="0 0 24 24"><path fill="currentColor" d="M21 3h-6.18C14.4 1.84 13.3 1 12 1s-2.4.84-2.82 2H3v18h18V3zm-9 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm-2 15l-5-5 1.41-1.41L10 15.17l7.59-7.59L19 9l-9 9z"/></svg>`;
    const memoSVG = `<svg viewBox="0 0 24 24"><path fill="currentColor" d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 7V3.5L18.5 9H13zm-3 5c0 .6.4 1 1 1h6c.6 0 1-.4 1-1s-.4-1-1-1h-6c-.6 0-1 .4-1 1zm0 3c0 .6.4 1 1 1h6c.6 0 1-.4 1-1s-.4-1-1-1h-6c-.6 0-1 .4-1 1zm-2-6c-.6 0-1-.4-1-1s.4-1 1-1 1 .4 1 1-.4 1-1 1zm0 3c-.6 0-1-.4-1-1s.4-1 1-1 1 .4 1 1-.4 1-1 1zm0 3c-.6 0-1-.4-1-1s.4-1 1-1 1 .4 1 1-.4 1-1 1z"/></svg>`;
    const historyListSVG = `<svg viewBox="0 0 24 24"><path fill="currentColor" d="M13 3c-4.97 0-9 4.03-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42C8.27 19.99 10.51 21 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm-1 5v5l4.25 2.52.77-1.28-3.52-2.09V8z"/></svg>`;



    // Field sets for different visibility states
    const standardFields = [
        'Tags',
        'Reason (Quality/GO/Billing)*',
		'Reason (Quality/GO/Billing)',
        'Captain ID',
        'Booking ID',
        'Parent Ticket Source',
        'User ID',
        'City',
        'Country',
        'Route ID',
        'SSOC - Action with Customer',
        'SSOC - Action with Captain',
        'SSOC - Escalation Call',
        'SSOC Reason',
        'Is Insurance required ?',
        'Type',
        'Priority',
        'Phone number',
        'Language'
    ];

    const minimalFields = [
        'Tags',
        'Reason (Quality/GO/Billing)*',
		'Reason (Quality/GO/Billing)',
        'SSOC Reason',
        'Action Taken - Consumer',
        'SSOC incident source'
		'City',
		'Country'
    ];

    // Check if a field is a system field that should never be hidden (Requester, Assignee, CCs)
    function isSystemField(field) {
        if (!field || !field.querySelector) return false;
        
        const label = field.querySelector('label');
        if (!label) return false;
        
        const labelText = label.textContent.trim().toLowerCase();
        const systemFieldLabels = [
            'assignee',
            'ccs',
            'cc',
            'collaborators',
            'followers'
        ];
        
        // Check if this is a system field by label text
        if (systemFieldLabels.some(sysLabel => labelText.includes(sysLabel))) {
            return true;
        }
        
        // Special handling for "Requester" - only the main requester field, not device/IP fields
        if (labelText === 'requester') {
            return true;
        }
        
        // Check by data-test-id patterns for system fields (be specific to avoid catching device/IP fields)
        const testIds = [
            'ticket-system-field-requester-label',  // More specific to avoid device/IP fields
            'ticket-system-field-requester-select', // More specific to avoid device/IP fields
            'assignee-field',
            'ticket-fields-collaborators'
        ];
        
        if (testIds.some(testId => field.querySelector(`[data-test-id*="${testId}"]`) || field.getAttribute('data-test-id') === testId)) {
            return true;
        }
        
        // Also check if the field itself has the requester system field test-id
        const fieldTestId = field.getAttribute('data-test-id') || '';
        if (fieldTestId === 'ticket-system-field-requester-label' || 
            fieldTestId === 'ticket-system-field-requester-select') {
            return true;
        }
        
        return false;
    }

    function isTargetField(field) {
        const label = field.querySelector('label');
        if (!label) return false;

        if (fieldVisibilityState === 'all') {
            // In 'all' state, no fields are considered target fields (all visible)
            return false;
        }
        
        let targetLabels = [];
        if (fieldVisibilityState === 'standard') {
            targetLabels = standardFields;
        } else if (fieldVisibilityState === 'minimal') {
            targetLabels = minimalFields;
        }
        
        // Enhanced matching for different label structures
        const labelText = label.textContent.trim();
        const isMinimalField = targetLabels.some(targetText => {
            // Exact match
            if (labelText === targetText) return true;
            
            // Handle labels with asterisks or other suffixes
            if (labelText.replace(/\*$/, '').trim() === targetText) return true;
            
            // Handle labels without asterisks when target has them
            if (targetText.endsWith('*') && labelText === targetText.slice(0, -1).trim()) return true;
            
            // Case insensitive match as fallback
            if (labelText.toLowerCase() === targetText.toLowerCase()) return true;
            
            return false;
        });
        
        return isMinimalField;
    }


    function clearUserIdField(container) {
        const fields = container.querySelectorAll('[class*="field"], [data-test-id*="field"], div:has(label)');
        Array.from(fields).forEach(field => {
            const label = field.querySelector('label');
            if (label && label.textContent.trim() === 'User ID') {
                const input = field.querySelector('input');
                if (input) {

                    const key = Object.keys(input).find(key => key.startsWith('__reactProps$'));
                    if (key) {
                        const props = input[key];
                        if (props.onChange) {

                            const syntheticEvent = {
                                target: input,
                                currentTarget: input,
                                type: 'change',
                                bubbles: true,
                                cancelable: true,
                                preventDefault: () => { },
                                stopPropagation: () => { },
                                persist: () => { }
                            };


                            input.value = '';
                            props.onChange(syntheticEvent);


                            input.dispatchEvent(new Event('input', { bubbles: true }));
                            input.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                    }

                }
            }
        });
    }


    function copyBookingIdToRouteId(container) {
        const fields = container.querySelectorAll('[class*="field"], [data-test-id*="field"], div:has(label)');
        let bookingIdValue = '';

        Array.from(fields).forEach(field => {
            const label = field.querySelector('label');
            if (label && label.textContent.trim() === 'Booking ID') {
                const input = field.querySelector('input');
                if (input) {
                    bookingIdValue = input.value;
                }
            }
        });

        if (bookingIdValue) {
            Array.from(fields).forEach(field => {
                const label = field.querySelector('label');
                if (label && label.textContent.trim() === 'Route ID') {
                    const input = field.querySelector('input');
                    if (input) {

                        const key = Object.keys(input).find(key => key.startsWith('__reactProps$'));
                        if (key) {
                            const props = input[key];
                            if (props.onChange) {

                                const syntheticEvent = {
                                    target: input,
                                    currentTarget: input,
                                    type: 'change',
                                    bubbles: true,
                                    cancelable: true,
                                    preventDefault: () => { },
                                    stopPropagation: () => { },
                                    persist: () => { }
                                };


                                input.value = bookingIdValue;
                                props.onChange(syntheticEvent);


                                input.dispatchEvent(new Event('input', { bubbles: true }));
                                input.dispatchEvent(new Event('change', { bubbles: true }));
                            }
                        }

                    }
                }
            });
        }
    }


    // Optimize city to country mapping using Map for better performance
    const cityToCountry = new Map([
        // UAE
        ['Abu Dhabi', 'United Arab Emirates'], ['Dubai', 'United Arab Emirates'],
        ['Al Ain', 'United Arab Emirates'], ['Sharjah', 'United Arab Emirates'],
        ['Fujairah', 'United Arab Emirates'], ['Ras Al Khaimah', 'United Arab Emirates'],
        ['Ajman', 'United Arab Emirates'],

        // Jordan
        ['Amman', 'Jordan'], ['Irbid', 'Jordan'], ['Zarqa', 'Jordan'], ['Aqaba', 'Jordan'],

        // Saudi Arabia
        ['Al Hada', 'Saudi Arabia'], ['Al Hasa', 'Saudi Arabia'], ['Al Bahah', 'Saudi Arabia'],
        ['Aseer', 'Saudi Arabia'], ['Ash Shafa', 'Saudi Arabia'], ['Dammam', 'Saudi Arabia'],
        ['Hail', 'Saudi Arabia'], ['Jazan', 'Saudi Arabia'], ['Jeddah', 'Saudi Arabia'],
        ['Jubail', 'Saudi Arabia'], ['Madinah', 'Saudi Arabia'], ['Makkah', 'Saudi Arabia'],
        ['Qassim', 'Saudi Arabia'], ['Riyadh', 'Saudi Arabia'], ['Tabuk', 'Saudi Arabia'],
        ['Taif', 'Saudi Arabia'], ['Yanbu', 'Saudi Arabia'], ['Abqaiq', 'Saudi Arabia'],
        ['Al Ula', 'Saudi Arabia'], ['AlJowf', 'Saudi Arabia'], ['Al Kharj', 'Saudi Arabia'],
        ['Ar Rass', 'Saudi Arabia'], ['Hafar AlBatin', 'Saudi Arabia'], ['KAEC', 'Saudi Arabia'],
        ['Madinah Governorates', 'Saudi Arabia'], ['Najran', 'Saudi Arabia'],
        ['Ras Tanura', 'Saudi Arabia'], ['Tabuk Governorates', 'Saudi Arabia'],
        ['Tihamah', 'Saudi Arabia'], ['Al Leith', 'Saudi Arabia'], ['Al Qunfudah', 'Saudi Arabia'],
        ['ALQurayyat', 'Saudi Arabia'], ['Sharurah', 'Saudi Arabia'], ['Wadi Al Dawasir', 'Saudi Arabia'],

        // Egypt
        ['Alexandria', 'Egypt'], ['Banha', 'Egypt'], ['Cairo', 'Egypt'], ['Damanhour', 'Egypt'],
        ['Damietta', 'Egypt'], ['Gouna', 'Egypt'], ['Hurghada', 'Egypt'], ['Ismailia', 'Egypt'],
        ['Kafr El-Shiek', 'Egypt'], ['Mansoura', 'Egypt'], ['Port Said', 'Egypt'], ['Sahel', 'Egypt'],
        ['Suez', 'Egypt'], ['Tanta', 'Egypt'], ['zagazig', 'Egypt'], ['Zagzig', 'Egypt'],
        ['Asyut', 'Egypt'], ['Minya', 'Egypt'], ['Menofia', 'Egypt'], ['Sohag', 'Egypt'],
        ['Aswan', 'Egypt'], ['Qena', 'Egypt'], ['Fayoum', 'Egypt'], ['Marsa Matrouh', 'Egypt'],
        ['Beni Suef', 'Egypt'], ['Luxor', 'Egypt'], ['Marsa Matruh', 'Egypt'], ['Sokhna', 'Egypt'],

        // Pakistan
        ['Faisalabad', 'Pakistan'], ['Gujranwala', 'Pakistan'], ['Hyderabad', 'Pakistan'],
        ['Islamabad', 'Pakistan'], ['Karachi', 'Pakistan'], ['Lahore', 'Pakistan'],
        ['Multan', 'Pakistan'], ['Peshawar', 'Pakistan'], ['Sialkot', 'Pakistan'],
        ['Abbottabad', 'Pakistan'], ['Mardan', 'Pakistan'], ['Quetta', 'Pakistan'],
        ['Sargodha', 'Pakistan'], ['Sukkur', 'Pakistan'], ['Bahawalpur', 'Pakistan'],

        // Other countries
        ['Beirut', 'Lebanon'], ['Jounieh', 'Lebanon'],
        ['Casablanca', 'Morocco'], ['Rabat', 'Morocco'], ['Marrakech', 'Morocco'],
        ['Mohammedia', 'Morocco'], ['Tangier', 'Morocco'],
        ['Kuwait City', 'Kuwait'], ['Manama', 'Bahrain'], ['Muscat', 'Oman'],
        ['Doha', 'Qatar'], ['Wakrah', 'Qatar'],
        ['Baghdad', 'Iraq'], ['Basrah', 'Iraq'], ['Mosul', 'Iraq'], ['Najaf', 'Iraq'], ['Erbil', 'Iraq'],
        ['ramallah', 'Palestine'], ['gaza', 'Palestine'], ['nablus', 'Palestine'], ['Bethlehem', 'Palestine'],
        ['Algiers', 'Algeria'],

        // Cities without mapping
        ['Istanbul', ''], ['bodrum', ''], ['bursa', ''], ['Adana', ''], ['khartoum', ''], ['Gotham City', '']
    ]);


    const countryToIndex = {
        'Algeria': 1,
        'Bahrain': 2,
        'Egypt': 3,
        'Iraq': 4,
        'Jordan': 5,
        'Kuwait': 6,
        'Lebanon': 7,
        'Morocco': 8,
        'Oman': 9,
        'Pakistan': 10,
        'Palestine': 11,
        'Saudi Arabia': 12,
        'United Arab Emirates': 13
    };


    function getSelectedCity(container) {
        const fields = container.querySelectorAll('[class*="field"], [data-test-id*="field"], div:has(label)');
        let selectedCity = '';

        Array.from(fields).forEach(field => {
            const label = field.querySelector('label');
            if (label && label.textContent.trim() === 'City') {

                const cityElement = field.querySelector('div[title]');
                if (cityElement) {
                    selectedCity = cityElement.getAttribute('title');
                }


                if (!selectedCity) {
                    const ellipsisDiv = field.querySelector('.StyledEllipsis-sc-1u4umy-0');
                    if (ellipsisDiv) {
                        selectedCity = ellipsisDiv.textContent.trim();
                    }
                }
            }
        });


        return selectedCity;
    }

    /**
     * Optimized dropdown selection helper function with caching and improved error handling
     */
    async function selectDropdownOption(dropdownTrigger, optionIndex, retries = 2) {
        return new Promise((resolve, reject) => {
            if (!dropdownTrigger || observerDisconnected) {
                reject(new Error('No dropdown trigger found or script is shutting down'));
                return;
            }

            // Avoid multiple simultaneous dropdown operations
            if (dropdownTrigger.dataset.isProcessing === 'true') {
                resolve(false);
                return;
            }

            dropdownTrigger.dataset.isProcessing = 'true';

            try {
                // Single click to open dropdown
                dropdownTrigger.click();

                // Wait for options to load with reduced delay
                const timeoutId = setTimeout(() => {
                    try {
                        const options = getCachedElements('[role="option"], [data-test-id="ticket-field-option"]', 500);
                        const targetOption = Array.from(options)[optionIndex];

                        if (targetOption && targetOption.isConnected) {
                            // Direct option click
                            targetOption.click();

                            // Minimal cleanup delay
                            setTimeout(() => {
                                try {
                                    if (document.activeElement === dropdownTrigger) {
                                        dropdownTrigger.blur();
                                    }
                                    dropdownTrigger.dataset.isProcessing = 'false';
                                    resolve(true);
                                } catch (e) {
                                    dropdownTrigger.dataset.isProcessing = 'false';
                                    resolve(false);
                                }
                            }, 30); // Reduced from 50ms to 30ms
                        } else {
                            // Option not found - close dropdown and retry if possible
                            dropdownTrigger.blur();
                            dropdownTrigger.dataset.isProcessing = 'false';

                            if (retries > 0 && !observerDisconnected) {
                                setTimeout(() => {
                                    selectDropdownOption(dropdownTrigger, optionIndex, retries - 1)
                                        .then(resolve)
                                        .catch(reject);
                                }, 80); // Reduced from 100ms to 80ms
                            } else {
                                reject(new Error(`Option at index ${optionIndex} not found after retries`));
                            }
                        }
                    } catch (e) {
                        dropdownTrigger.dataset.isProcessing = 'false';
                        reject(e);
                    }
                }, 120); // Reduced from 150ms to 120ms

                // Register cleanup for the timeout
                registerCleanup(() => clearTimeout(timeoutId));

            } catch (e) {
                dropdownTrigger.dataset.isProcessing = 'false';
                reject(e);
            }
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
            const success = await tryManualDropdownSet(field, valueText, 0); // 0 retries
            console.log(`${success ? '✅' : '❌'} "${valueText}" ${success ? 'SUCCESS' : 'FAILED'}`);
            return success;
        } catch (e) {
            console.warn('Dropdown set failed:', e);
            return false;
        }
    }

    // Wait for field to be fully ready for interaction
    async function waitForFieldReady(field, timeout = 2000) {
        return new Promise((resolve) => {
            const startTime = Date.now();

            const checkReady = () => {
                if (Date.now() - startTime > timeout) {
                    resolve();
                    return;
                }

                const input = field.querySelector('input[data-test-id="ticket-field-input"]') ||
                             field.querySelector('[role="combobox"] input') ||
                             field.querySelector('input');

                if (input && field.isConnected && field.offsetParent !== null) {
                    resolve();
                } else {
                    setTimeout(checkReady, 50);
                }
            };

            checkReady();
        });
    }

    // Try instant value setting without opening dropdown
    async function tryInstantValueSet(field, input, valueText) {
        try {
            const valueProp = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');

            // Set input value
            try { valueProp.set.call(input, valueText); } catch {}
            input.setAttribute('value', valueText);

            // Try to find and trigger React's internal onChange handler
            const reactKey = Object.keys(input).find(key =>
                key.startsWith('__reactProps$') ||
                key.startsWith('__reactInternalInstance$') ||
                key.startsWith('__reactEventHandlers$') ||
                key.startsWith('__reactFiber$')
            );

            console.log(`🔍 React key search for "${valueText}":`, {
                inputKeys: Object.keys(input),
                foundKey: reactKey
            });

            if (reactKey && input[reactKey]) {
                const reactData = input[reactKey];
                console.log(`📝 React data for "${valueText}":`, {
                    hasOnChange: !!(reactData && reactData.onChange),
                    reactDataKeys: Object.keys(reactData || {})
                });

                if (reactData && reactData.onChange) {
                    try {
                        const syntheticEvent = {
                            target: input,
                            currentTarget: input,
                            type: 'change',
                            bubbles: true,
                            cancelable: true,
                            preventDefault: () => {},
                            stopPropagation: () => {},
                            persist: () => {}
                        };
                        console.log(`⚛️ Triggering React onChange for "${valueText}"`);
                        reactData.onChange(syntheticEvent);
                    } catch (reactError) {
                        console.warn('React onChange trigger failed:', reactError);
                    }
                } else {
                    console.log(`⚠️ No React onChange found for "${valueText}"`);
                }
            } else {
                console.log(`⚠️ No React data found for "${valueText}"`);
            }

            // Dispatch events with proper timing
            input.dispatchEvent(new Event('input', { bubbles: true }));
            await new Promise(resolve => setTimeout(resolve, 50));
            input.dispatchEvent(new Event('change', { bubbles: true }));

            // Update hidden backing input if present
            const hidden = field.querySelector('input[type="hidden"][name], input[hidden][name]');
            if (hidden) {
                try { valueProp.set.call(hidden, valueText); } catch {}
                hidden.setAttribute('value', valueText);
                hidden.dispatchEvent(new Event('input', { bubbles: true }));
                hidden.dispatchEvent(new Event('change', { bubbles: true }));
            }

            // Wait longer for React to process the change
            await new Promise(resolve => setTimeout(resolve, 200));

            // More comprehensive verification - check both display AND form state
            const display = field.querySelector('[title]') ||
                            field.querySelector('[data-garden-id="typography.ellipsis"]') ||
                            field.querySelector('.StyledEllipsis-sc-1u4umy-0');

            const displayValue = display ? (display.getAttribute('title') || display.textContent.trim()) : null;
            const inputValue = input.value;

            // Only consider it successful if BOTH display and input values match
            // This ensures the form state is actually updated, not just the visual display
            const isDisplayCorrect = displayValue === valueText;
            const isInputCorrect = inputValue === valueText;

            console.log(`Instant set verification for "${valueText}": display=${displayValue}, input=${inputValue}, both correct=${isDisplayCorrect && isInputCorrect}`);

            if (isDisplayCorrect && isInputCorrect) {
                input.blur();
                return true;
            }

            // If only display is correct but input isn't, this means visual-only update (the problem!)
            if (isDisplayCorrect && !isInputCorrect) {
                console.warn(`Visual-only update detected for "${valueText}" - falling back to manual selection`);
                input.blur();
                return false;
            }

            input.blur();
            return false;
        } catch (e) {
            console.warn('Instant value set attempt failed:', e);
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

                    // Quick verification
                    const displayValue = field.querySelector('[title]')?.getAttribute('title') ||
                                        field.querySelector('.StyledEllipsis-sc-1u4umy-0')?.textContent.trim() ||
                                        field.querySelector('[data-garden-id="typography.ellipsis"]')?.textContent.trim();

                    trigger.dataset.isProcessing = 'false';
                    return displayValue === valueText;
                } else {
                    trigger.blur();
                    trigger.dataset.isProcessing = 'false';
                    return false;
                }
            } finally {
                trigger.dataset.isProcessing = 'false';
            }
        } catch (e) {
            return false;
        }
    }

    // Async version for sequential processing
    async function setCountryBasedOnCityAsync(container, country) {
        try {
            const fields = container.querySelectorAll('[class*="field"], [data-test-id*="field"], div:has(label)');
            const promises = [];

            Array.from(fields).forEach(field => {
                const label = field.querySelector('label');
                if (label && label.textContent.trim() === 'Country') {
                    const currentValue = field.querySelector('[title]')?.getAttribute('title') ||
                        field.querySelector('.StyledEllipsis-sc-1u4umy-0')?.textContent.trim() ||
                        field.querySelector('[data-garden-id="typography.ellipsis"]')?.textContent.trim();

                    if (currentValue && currentValue !== '-' && currentValue === country) {
                        console.log(`Country already set to "${country}"`);
                        return;
                    }

                    const promise = setDropdownFieldValueInstant(field, country);
                    promises.push(promise);
                }
            });

            // Wait for all attempts to complete
            if (promises.length > 0) {
                const results = await Promise.all(promises);
                return results.every(result => result === true);
            }
            return true;
        } catch (error) {
            console.error('Error in setCountryBasedOnCityAsync:', error);
            return false;
        }
    }

    function setCountryBasedOnCity(container) {
        const selectedCity = getSelectedCity(container);


        if (!selectedCity || selectedCity === '-') {

            return;
        }

        const country = cityToCountry.get(selectedCity);
        if (!country) {

            return;
        }

        const countryIndex = countryToIndex[country];
        if (!countryIndex) {

            return;
        }

        const fields = container.querySelectorAll('[class*="field"], [data-test-id*="field"], div:has(label)');
        Array.from(fields).forEach(field => {
            const label = field.querySelector('label');
            if (label && label.textContent.trim() === 'Country') {



                const currentValue = field.querySelector('[title]')?.getAttribute('title') ||
                    field.querySelector('.StyledEllipsis-sc-1u4umy-0')?.textContent.trim() ||
                    field.querySelector('[data-garden-id="typography.ellipsis"]')?.textContent.trim();

                if (currentValue && currentValue !== '-' && currentValue === country) {

                    return;
                }



                // Async set with improved reliability
                setDropdownFieldValueInstant(field, country).then(success => {
                    if (success) {
                        console.log(`✓ Successfully set Country to "${country}"`);
                    } else {
                        console.warn(`✗ Failed to set Country to "${country}"`);
                    }
                }).catch(error => {
                    console.error('Error setting country field:', error);
                });
            }
        });
    }

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
        icon.innerHTML = eyeClosedSVG;
        icon.firstChild.setAttribute('width', '26');
        icon.firstChild.setAttribute('height', '26');
        icon.firstChild.setAttribute('data-garden-id', 'chrome.nav_item_icon');
        icon.firstChild.setAttribute('data-garden-version', '9.5.2');
        icon.firstChild.classList.add('StyledBaseIcon-sc-1moykgb-0', 'StyledNavItemIcon-sc-7w9rpt-0', 'eWlVPJ', 'YOjtB');

        const text = document.createElement('span');
        text.textContent = 'Standard';
        text.className = 'StyledNavItemText-sc-13m84xl-0 iOGbGR';
        text.setAttribute('data-garden-id', 'chrome.nav_item_text');
        text.setAttribute('data-garden-version', '9.5.2');

        iconWrapper.appendChild(icon);
        iconWrapper.appendChild(text);
        button.appendChild(iconWrapper);
        listItem.appendChild(button);

        return listItem;
    }


    function createFieldOpsButton() {
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
        icon.innerHTML = checklistSVG;
        icon.firstChild.setAttribute('width', '26');
        icon.firstChild.setAttribute('height', '26');
        icon.firstChild.setAttribute('data-garden-id', 'chrome.nav_item_icon');
        icon.firstChild.setAttribute('data-garden-version', '9.5.2');
        icon.firstChild.classList.add('StyledBaseIcon-sc-1moykgb-0', 'StyledNavItemIcon-sc-7w9rpt-0', 'eWlVPJ', 'YOjtB');

        const text = document.createElement('span');
        text.textContent = 'Auto Fill';
        text.className = 'StyledNavItemText-sc-13m84xl-0 iOGbGR';
        text.setAttribute('data-garden-id', 'chrome.nav_item_text');
        text.setAttribute('data-garden-version', '9.5.2');

        iconWrapper.appendChild(icon);
        iconWrapper.appendChild(text);
        button.appendChild(iconWrapper);
        listItem.appendChild(button);

        return listItem;
    }

    function createShowCsvButton() {
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
        icon.innerHTML = checklistSVG;
        icon.firstChild.setAttribute('width', '26');
        icon.firstChild.setAttribute('height', '26');
        icon.firstChild.setAttribute('data-garden-id', 'chrome.nav_item_icon');
        icon.firstChild.setAttribute('data-garden-version', '9.5.2');
        icon.firstChild.classList.add('StyledBaseIcon-sc-1moykgb-0', 'StyledNavItemIcon-sc-7w9rpt-0', 'eWlVPJ', 'YOjtB');

        const text = document.createElement('span');
        text.textContent = 'Show CSV';
        text.className = 'StyledNavItemText-sc-13m84xl-0 iOGbGR';
        text.setAttribute('data-garden-id', 'chrome.nav_item_text');
        text.setAttribute('data-garden-version', '9.5.2');

        iconWrapper.appendChild(icon);
        iconWrapper.appendChild(text);
        button.appendChild(iconWrapper);
        listItem.appendChild(button);

        return listItem;
    }



    function toggleAllFields() {
        // Use debouncing to prevent rapid successive calls
        debounce(() => {
            let allForms = getCachedElements('section.grid-ticket-fields-panel', 2000);
            
            // If no forms found with the primary selector, try fallback selectors
            if (allForms.length === 0) {
                const formSelectors = [
                    'section[class*="ticket-fields"]',
                    '[data-test-id*="TicketFieldsPane"]',
                    'div[data-test-id="ticket-fields"][data-tracking-id="ticket-fields"]',
                    '.ticket_fields'
                ];
                
                for (const selector of formSelectors) {
                    allForms = document.querySelectorAll(selector);
                    if (allForms.length > 0) {
                        console.log(`📋 Found forms using fallback selector: ${selector}`);
                        break;
                    }
                }
            }

            if (allForms.length === 0) {
                return;
            }

            // Cycle through the 3 states: standard -> minimal -> all -> standard
            if (fieldVisibilityState === 'standard') {
                fieldVisibilityState = 'minimal';
            } else if (fieldVisibilityState === 'minimal') {
                fieldVisibilityState = 'all';
            } else {
                fieldVisibilityState = 'standard';
            }

            // Use requestAnimationFrame for better performance
            requestAnimationFrame(() => {
                allForms.forEach(form => {
                    if (!form || !form.isConnected) return;

                    // Enhanced field detection to handle both old and new structures
                    // Start with a broad search and then filter out system fields
                    const allPossibleFields = Array.from(form.querySelectorAll('[data-garden-id="forms.field"], .StyledField-sc-12gzfsu-0, [class*="field"], [data-test-id*="field"], div:has(label)'));
                    
                    const fields = [];
                    allPossibleFields.forEach(field => {
                        try {
                            // Must have a label and be connected
                            if (field.nodeType !== Node.ELEMENT_NODE || 
                                !field.isConnected || 
                                !field.querySelector('label')) {
                                return;
                            }
                            
                            // Skip system fields (Requester, Assignee, CCs)
                            if (isSystemField(field)) {
                                return;
                            }
                            
                            // Skip duplicates
                            if (fields.includes(field)) {
                                return;
                            }
                            
                            fields.push(field);
                        } catch (e) {
                            console.debug('Error processing field:', field, e);
                        }
                    });

                    // Batch DOM operations
                    const fieldsToHide = [];
                    const fieldsToShow = [];

                    fields.forEach(field => {
                        try {
                            if (fieldVisibilityState === 'all') {
                                // Show all fields
                                fieldsToShow.push(field);
                            } else if (isTargetField(field)) {
                                // This is a target field for the current state, show it
                                fieldsToShow.push(field);
                            } else {
                                // This is not a target field for the current state, hide it
                                fieldsToHide.push(field);
                            }
                        } catch (e) {
                            // Silent error handling to avoid console spam
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

    function updateToggleButtonState() {
        if (!globalButton) return;

        const button = globalButton.querySelector('button');
        if (!button) return;

        const iconSvg = button.querySelector('svg');
        if (iconSvg) {
            let newSvg, title, text;
            
            switch (fieldVisibilityState) {
                case 'all':
                    newSvg = eyeOpenSVG;
                    title = 'Showing All Fields - Click for Standard View';
                    text = 'All Fields';
                    break;
                case 'standard':
                    newSvg = eyeClosedSVG;
                    title = 'Showing Standard Fields - Click for Minimal View';
                    text = 'Standard';
                    break;
                case 'minimal':
                    newSvg = eyeMinimalSVG;
                    title = 'Showing Minimal Fields - Click for All Fields';
                    text = 'Minimal';
                    break;
                default:
                    newSvg = eyeClosedSVG;
                    title = 'Standard View';
                    text = 'Standard';
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
            
            button.title = title;
            const span = button.querySelector('span');
            if (span) {
                span.textContent = text;
            }
        }
    }


    function showToast(message, duration = 3000) {

        const existingToast = document.querySelector('.toast-notification');
        if (existingToast) {
            existingToast.remove();
        }


        const toast = document.createElement('div');
        toast.className = 'toast-notification';
        toast.textContent = message;
        document.body.appendChild(toast);


        toast.offsetHeight;
        toast.classList.add('show');


        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }



    async function setReasonToNA(container) {
        const fields = container.querySelectorAll('[class*="field"], [data-test-id*="field"], div:has(label)');
        const promises = [];
        let fieldFound = false;

        Array.from(fields).forEach(field => {
            const label = field.querySelector('label');
            if (label && (label.textContent.trim() === 'Reason (Quality/GO/Billing)*' ||label.textContent.trim() === 'Reason (Quality/GO/Billing)')) {
                // Prevent processing multiple identical fields
                if (fieldFound) {
                    console.log('⚠️ Skipping duplicate Reason field');
                    return;
                }
                fieldFound = true;

                const currentValue = field.querySelector('[title]')?.getAttribute('title') ||
                    field.querySelector('.StyledEllipsis-sc-1u4umy-0')?.textContent.trim() ||
                    field.querySelector('[data-garden-id="typography.ellipsis"]')?.textContent.trim();

                if (currentValue === 'N/A') {
                    console.log('💡 Reason field already set to N/A');
                    return;
                }

                const promise = setDropdownFieldValueInstant(field, 'N/A');
                promises.push(promise);
            }
        });

        // Wait for all attempts to complete
        if (promises.length > 0) {
            const results = await Promise.all(promises);
            return results.every(result => result === true);
        }
        return true;
    }

    async function setEscalationCallToNo(container) {
        const fields = container.querySelectorAll('[class*="field"], [data-test-id*="field"], div:has(label)');
        const promises = [];
        let fieldFound = false;

        Array.from(fields).forEach(field => {
            const label = field.querySelector('label');
            if (label && label.textContent.trim() === 'SSOC - Escalation Call') {
                // Prevent processing multiple identical fields
                if (fieldFound) {
                    console.log('⚠️ Skipping duplicate Escalation field');
                    return;
                }
                fieldFound = true;

                const currentValue = field.querySelector('[title]')?.getAttribute('title') ||
                    field.querySelector('.StyledEllipsis-sc-1u4umy-0')?.textContent.trim() ||
                    field.querySelector('[data-garden-id="typography.ellipsis"]')?.textContent.trim();

                // Skip if already set to "No"
                if (currentValue === 'No') {
                    console.log('💡 SSOC - Escalation Call already set to "No"');
                    return;
                }

                const promise = setDropdownFieldValueInstant(field, 'No');
                promises.push(promise);
            }
        });

        // Wait for all attempts to complete
        if (promises.length > 0) {
            const results = await Promise.all(promises);
            return results.every(result => result === true);
        }
        return true;
    }

    async function setInsuranceRequiredToNo(container) {
        const fields = container.querySelectorAll('[class*="field"], [data-test-id*="field"], div:has(label)');
        const promises = [];
        let fieldFound = false;

        Array.from(fields).forEach(field => {
            const label = field.querySelector('label');
            if (label && label.textContent.trim() === 'Is Insurance required ?') {
                // Prevent processing multiple identical fields
                if (fieldFound) {
                    console.log('⚠️ Skipping duplicate Insurance field');
                    return;
                }
                fieldFound = true;

                const currentValue = field.querySelector('[title]')?.getAttribute('title') ||
                    field.querySelector('.StyledEllipsis-sc-1u4umy-0')?.textContent.trim() ||
                    field.querySelector('[data-garden-id="typography.ellipsis"]')?.textContent.trim();

                // Skip if already set to "No"
                if (currentValue === 'No') {
                    console.log('💡 Is Insurance required ? already set to "No"');
                    return;
                }

                const promise = setDropdownFieldValueInstant(field, 'No');
                promises.push(promise);
            }
        });

        // Wait for all attempts to complete
        if (promises.length > 0) {
            const results = await Promise.all(promises);
            return results.every(result => result === true);
        }
        return true;
    }

    async function setParentTicketSourceBasedOnSubject(container) {
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
            console.log('⚠️ Subject field not found - skipping Parent Ticket Source update');
            return true; // Return true to not fail the overall process
        }

        const subjectText = subjectField.value.trim();
        if (!subjectText) {
            console.log('⚠️ Subject field is empty - skipping Parent Ticket Source update');
            return true; // Return true to not fail the overall process
        }

        // Determine the appropriate Parent Ticket Source value based on subject content
        let targetValue = null;
        let ruleMatched = null;

        const subjectLower = subjectText.toLowerCase();

        // Rule 1: Check for "Dispute" -> Customer Email
        if (subjectLower.includes('dispute')) {
            targetValue = 'Customer Email';
            ruleMatched = 'Dispute';
        }
        // Rule 2: Check for "from [anything] reported" pattern -> Captain Email
        else if (/from\s+\w+\s+reported/i.test(subjectText)) {
            targetValue = 'Captain Email';
            ruleMatched = 'from [word] reported pattern';
        }
        // Rule 3: Check for "Quality rating of" -> Rating
        else if (subjectLower.includes('quality rating of')) {
            targetValue = 'Rating';
            ruleMatched = 'Quality rating of';
        }
        // Rule 4: Check for "@" symbol or phone number with country code -> Help
        else if (subjectText.includes('@') || /\b(966|971|962|973|965|968|974|967|964|970|972)\d{6,}/i.test(subjectText)) {
            targetValue = 'Help';
            ruleMatched = subjectText.includes('@') ? 'Email symbol (@)' : 'Phone number with country code';
        }

        // If no rules matched, skip the update
        if (!targetValue) {
            console.log('💡 Subject does not match any Parent Ticket Source rules - skipping update');
            return true; // Return true since this is expected behavior
        }

        console.log(`📋 Subject matched rule "${ruleMatched}": ${subjectText}`);
        console.log(`🎯 Target Parent Ticket Source: ${targetValue}`);

        // Find the Parent Ticket Source field in the current container
        const fields = container.querySelectorAll('[class*="field"], [data-test-id*="field"], div:has(label)');
        let parentTicketSourceField = null;

        Array.from(fields).forEach(field => {
            const label = field.querySelector('label');
            if (label && label.textContent.trim() === 'Parent Ticket Source') {
                parentTicketSourceField = field;
            }
        });

        if (!parentTicketSourceField) {
            console.log('⚠️ Parent Ticket Source field not found in current form');
            return true; // Return true to not fail the overall process
        }

        // Check if already set to the target value
        const currentValue = parentTicketSourceField.querySelector('[title]')?.getAttribute('title') ||
                            parentTicketSourceField.querySelector('.StyledEllipsis-sc-1u4umy-0')?.textContent.trim() ||
                            parentTicketSourceField.querySelector('[data-garden-id="typography.ellipsis"]')?.textContent.trim();

        if (currentValue === targetValue) {
            console.log(`💡 Parent Ticket Source already set to "${targetValue}"`);
            return true;
        }

        // Set the field to the target value
        try {
            console.log(`📝 Setting Parent Ticket Source to "${targetValue}"...`);
            const success = await setDropdownFieldValueInstant(parentTicketSourceField, targetValue);
            console.log(`✅ Parent Ticket Source result: ${success ? 'SUCCESS' : 'FAILED'}`);
            return success;
        } catch (error) {
            console.error('❌ Error setting Parent Ticket Source:', error);
            return false;
        }
    }

    function updateAllFields() {
        console.log('🚀 updateAllFields triggered');
        // Use debouncing to prevent rapid successive calls
        debounce(() => {
            if (observerDisconnected) return;

            let allForms = getCachedElements('section.grid-ticket-fields-panel', 1000);
            
            // If no forms found with the primary selector, try fallback selectors
            if (allForms.length === 0) {
                const formSelectors = [
                    'section[class*="ticket-fields"]',
                    '[data-test-id*="TicketFieldsPane"]',
                    'div[data-test-id="ticket-fields"][data-tracking-id="ticket-fields"]',
                    '.ticket_fields'
                ];
                
                for (const selector of formSelectors) {
                    allForms = document.querySelectorAll(selector);
                    if (allForms.length > 0) {
                        console.log(`📋 Found forms using fallback selector: ${selector}`);
                        break;
                    }
                }
            }
            
            console.log(`📋 Found ${allForms.length} forms to process`);
            const allTicketDivs = document.querySelectorAll('div[data-test-id*="ticket"]');

            console.log(`🔍 Debug form detection:`, {
                formsFound: allForms.length,
                anyTicketDivs: allTicketDivs.length
            });

            if (allForms.length === 0) {
                console.log('⚠️ No forms found with exact selector, trying alternatives...');

                // Try alternative selectors
                const alternativeForms = altForms1.length > 0 ? altForms1 :
                                       altForms2.length > 0 ? altForms2 : null;

                if (alternativeForms && alternativeForms.length > 0) {
                    console.log(`✅ Found ${alternativeForms.length} forms with alternative selector`);
                    // Process alternative forms
                    Array.from(alternativeForms).forEach((form, index) => {
                        setTimeout(async () => {
                            try {
                                await processFormUpdate(form);
                            } catch (e) {
                                console.warn('Error processing alternative form:', e);
                            }
                        }, index * 50);
                    });
                    return;
                } else {
                    console.log('❌ No ticket forms found at all');
                    return;
                }
            }

            // Process forms one at a time to avoid conflicts and race conditions
            processWithThrottling(async () => {
                for (let i = 0; i < allForms.length; i++) {
                    const form = allForms[i];
                    if (!form || !form.isConnected) continue;

                    try {
                        console.log(`🔄 Processing form ${i + 1} of ${allForms.length}...`);
                        const success = await processFormUpdate(form);
                        console.log(`📋 Form ${i + 1} result: ${success ? 'SUCCESS' : 'FAILED'}`);

                        // Minimal delay between forms
                        if (i < allForms.length - 1) {
                            await new Promise(resolve => setTimeout(resolve, 50));
                        }
                    } catch (e) {
                        console.warn(`Error processing form ${i + 1}:`, e);
                    }
                }
                console.log('🎯 All forms processed');
            });
        }, 200, 'updateAllFields');
    }

    async function processFormUpdate(form) {
        if (!form || !form.isConnected || observerDisconnected) return;

        console.log('🔄 Starting form update process...');

        try {
            // Clear and copy operations (synchronous)
            clearUserIdField(form);
            copyBookingIdToRouteId(form);

            // STEP 1: Always set Reason field first and wait for it to complete
            console.log('📝 Step 1: Setting Reason field...');
            const reasonSuccess = await setReasonToNA(form);
            console.log(`✅ Reason field result: ${reasonSuccess ? 'SUCCESS' : 'FAILED'}`);

            // Minimal delay between operations
            await new Promise(resolve => setTimeout(resolve, 50));

            // STEP 2: Handle country based on city selection
            const selectedCity = getSelectedCity(form);
            const desiredCountry = selectedCity ? cityToCountry.get(selectedCity) : null;

            let countrySuccess = true;
            if (desiredCountry) {
                const countryField = Array.from(form.querySelectorAll('[class*="field"], [data-test-id*="field"], div:has(label)')).find(field => {
                    const label = field.querySelector('label');
                    return label && label.textContent.trim() === 'Country';
                });

                if (countryField) {
                    const currentValue = countryField.querySelector('[title]')?.getAttribute('title') ||
                        countryField.querySelector('.StyledEllipsis-sc-1u4umy-0')?.textContent.trim() ||
                        countryField.querySelector('[data-garden-id="typography.ellipsis"]')?.textContent.trim();

                    const countryNeedsUpdate = !currentValue || currentValue === '-' || currentValue !== desiredCountry;

                    if (countryNeedsUpdate) {
                        console.log(`🌍 Step 2: Setting Country to "${desiredCountry}"...`);
                        countrySuccess = await setCountryBasedOnCityAsync(form, desiredCountry);
                        console.log(`✅ Country field result: ${countrySuccess ? 'SUCCESS' : 'FAILED'}`);

                        // Minimal delay after country update
                        await new Promise(resolve => setTimeout(resolve, 30));
                    } else {
                        console.log(`🌍 Country already set to "${currentValue}"`);
                    }
                }
            }

            // STEP 3: Set additional dropdown fields sequentially
            console.log('⚙️ Step 3: Setting additional dropdown fields...');

            const escalationSuccess = await setEscalationCallToNo(form);
            console.log(`✅ Escalation field result: ${escalationSuccess ? 'SUCCESS' : 'FAILED'}`);

            // Minimal delay between dropdown operations
            await new Promise(resolve => setTimeout(resolve, 30));

            const insuranceSuccess = await setInsuranceRequiredToNo(form);
            console.log(`✅ Insurance field result: ${insuranceSuccess ? 'SUCCESS' : 'FAILED'}`);

            // Minimal delay between dropdown operations
            await new Promise(resolve => setTimeout(resolve, 30));

            const parentTicketSourceSuccess = await setParentTicketSourceBasedOnSubject(form);
            console.log(`✅ Parent Ticket Source result: ${parentTicketSourceSuccess ? 'SUCCESS' : 'FAILED'}`);

            // Final summary
            const overallSuccess = reasonSuccess && countrySuccess && escalationSuccess && insuranceSuccess && parentTicketSourceSuccess;
            console.log(`🎯 Form update complete. Overall success: ${overallSuccess ? 'SUCCESS' : 'PARTIAL/FAILED'}`);

            return overallSuccess;

        } catch (error) {
            console.error('❌ Error in processFormUpdate:', error);
            return false;
        }
    }

    function createCopyButton() {
        const button = document.createElement('button');
        button.className = 'copy-button';
        button.innerHTML = copySVG;
        button.title = 'Copy SSOC Reason';
        return button;
    }

    function copySSOCReason(container) {

        const ssocReasonElement = container.querySelector('[title^="SSOC -"]') ||
            container.querySelector('.StyledEllipsis-sc-1u4uqmy-0') ||
            container.querySelector('[data-garden-id="typography.ellipsis"]');

        if (ssocReasonElement) {
            const ssocReason = ssocReasonElement.getAttribute('title') || ssocReasonElement.textContent.trim();
            navigator.clipboard.writeText(ssocReason)
                .then(() => {
                    showToast('SSOC Reason copied to clipboard!');
                })
                .catch(err => {
                    console.error('Failed to copy text:', err);
                    showToast('Failed to copy SSOC Reason');
                });
        }
    }

    function addCopyButtonToSSOCReason(container) {
        const fields = container.querySelectorAll('[class*="field"], [data-test-id*="field"], div:has(label)');
        Array.from(fields).forEach(field => {

            const label = field.querySelector('label[data-garden-id="forms.input_label"]') ||
                field.querySelector('label');

            if (label &&
                label.textContent.trim() === 'SSOC Reason' &&
                !field.querySelector('.copy-button')) {

                const copyButton = createCopyButton();
                copyButton.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    copySSOCReason(field);
                });


                const labelContainer = label.parentElement;
                if (labelContainer) {
                    labelContainer.style.position = 'relative';
                    labelContainer.appendChild(copyButton);
                }
            }
        });
    }

    function initFormManager(container) {
        if (!container || observerDisconnected) {
            return;
        }

        // Use debouncing to prevent multiple rapid initializations
        debounce(() => {
            if (!container.isConnected || observerDisconnected) {
                return;
            }

            // Enhanced field detection to handle both old and new structures
            // Start with a broad search and then filter out system fields
            const allPossibleFields = Array.from(container.querySelectorAll('[data-garden-id="forms.field"], .StyledField-sc-12gzfsu-0, [class*="field"], [data-test-id*="field"], div:has(label)'));
            
            const fields = [];
            allPossibleFields.forEach(field => {
                try {
                    // Must have a label and be connected
                    if (field.nodeType !== Node.ELEMENT_NODE || 
                        !field.isConnected || 
                        !field.querySelector('label')) {
                        return;
                    }
                    
                    // Skip system fields (Requester, Assignee, CCs)
                    if (isSystemField(field)) {
                        return;
                    }
                    
                    // Skip duplicates
                    if (fields.includes(field)) {
                        return;
                    }
                    
                    fields.push(field);
                } catch (e) {
                    console.debug('Error processing field:', field, e);
                }
            });

            if (fields.length === 0) {
                return;
            }

            // Use requestAnimationFrame for better performance
            requestAnimationFrame(() => {
                if (observerDisconnected) return;

                // Batch process fields
                const fieldsToHide = [];
                const fieldsToShow = [];

                fields.forEach(field => {
                    try {
                        if (fieldVisibilityState === 'all') {
                            // Show all fields
                            fieldsToShow.push(field);
                        } else if (isTargetField(field)) {
                            // This is a target field for the current state, show it
                            fieldsToShow.push(field);
                        } else {
                            // This is not a target field for the current state, hide it
                            fieldsToHide.push(field);
                        }
                    } catch (e) {
                        // Silent error handling
                    }
                });

                // Apply changes in batches to minimize reflows
                fieldsToHide.forEach(field => field.classList.add('hidden-form-field'));
                fieldsToShow.forEach(field => field.classList.remove('hidden-form-field'));

                // Add copy button functionality
                addCopyButtonToSSOCReason(container);
            });
        }, 50, `initFormManager-${container.dataset.uniqueId || Math.random()}`);
    }

    function setCaptainId(captainId) {
        let allForms = document.querySelectorAll('section.grid-ticket-fields-panel');
        
        // If no forms found with the primary selector, try fallback selectors
        if (allForms.length === 0) {
            const formSelectors = [
                'section[class*="ticket-fields"]',
                '[data-test-id*="TicketFieldsPane"]',
                'div[data-test-id="ticket-fields"][data-tracking-id="ticket-fields"]',
                '.ticket_fields'
            ];
            
            for (const selector of formSelectors) {
                allForms = document.querySelectorAll(selector);
                if (allForms.length > 0) break;
            }
        }
        
        allForms.forEach(form => {
            const fields = form.querySelectorAll('[class*="field"], [data-test-id*="field"], div:has(label)');
            Array.from(fields).forEach(field => {
                const label = field.querySelector('label');
                if (label && label.textContent.trim() === 'Captain ID') {
                    const input = field.querySelector('input');
                    if (input) {
                        // Clear any existing value first
                        input.value = '';

                        // Try to access React's internal props and use proper onChange handler
                        const key = Object.keys(input).find(key => key.startsWith('__reactProps$'));
                        if (key) {
                            const props = input[key];
                            if (props.onChange) {
                                // Create a proper synthetic event for React
                                const syntheticEvent = {
                                    target: input,
                                    currentTarget: input,
                                    type: 'change',
                                    bubbles: true,
                                    cancelable: true,
                                    preventDefault: () => { },
                                    stopPropagation: () => { },
                                    persist: () => { }
                                };

                                // Set the value and trigger React's onChange
                                input.value = captainId;
                                props.onChange(syntheticEvent);
                            }
                        }

                        // Also trigger standard DOM events as fallback
                        input.value = captainId;
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                        input.dispatchEvent(new Event('change', { bubbles: true }));

                        // Force a focus and blur to ensure the field is recognized as "touched"
                        input.focus();
                        setTimeout(() => {
                            input.blur();
                        }, 10);

                        // Add protection against value being cleared on hover/focus
                        addCaptainIdProtection(input, captainId);

                        console.log('Captain ID set successfully:', captainId);
                    }
                }
            });
        });
    }

    function setCaptainIdWithRetry(captainId, maxRetries = 3) {
        let attempts = 0;

        const attemptSet = () => {
            attempts++;
            console.log(`Setting Captain ID (attempt ${attempts}):`, captainId);

            setCaptainId(captainId);

            // Verify the value was set correctly after a short delay
            setTimeout(() => {
                let allForms = document.querySelectorAll('section.grid-ticket-fields-panel');
                
                // If no forms found with the primary selector, try fallback selectors
                if (allForms.length === 0) {
                    const formSelectors = [
                        'section[class*="ticket-fields"]',
                        '[data-test-id*="TicketFieldsPane"]',
                        'div[data-test-id="ticket-fields"][data-tracking-id="ticket-fields"]',
                        '.ticket_fields'
                    ];
                    
                    for (const selector of formSelectors) {
                        allForms = document.querySelectorAll(selector);
                        if (allForms.length > 0) break;
                    }
                }
                
                let valueSet = false;

                allForms.forEach(form => {
                    const fields = form.querySelectorAll('[class*="field"], [data-test-id*="field"], div:has(label)');
                    Array.from(fields).forEach(field => {
                        const label = field.querySelector('label');
                        if (label && label.textContent.trim() === 'Captain ID') {
                            const input = field.querySelector('input');
                            if (input && input.value === captainId) {
                                valueSet = true;
                                console.log('Captain ID verified successfully:', captainId);
                            }
                        }
                    });
                });

                // If value wasn't set and we have retries left, try again
                if (!valueSet && attempts < maxRetries) {
                    console.log(`Captain ID verification failed, retrying... (${attempts}/${maxRetries})`);
                    setTimeout(attemptSet, 500); // Wait 500ms before retry
                } else if (!valueSet) {
                    console.error('Failed to set Captain ID after', maxRetries, 'attempts');
                }
            }, 200); // Wait 200ms to verify
        };

        attemptSet();
    }

    function addCaptainIdProtection(input, expectedValue) {
        // Remove any existing protection listeners to avoid duplicates
        if (input._captainIdProtected) {
            cleanupCaptainIdProtection(input);
        }
        input._captainIdProtected = true;

        // Store the expected value
        input._expectedCaptainId = expectedValue;

        // Track user interaction state
        let userIsEditing = false;
        let lastUserInputTime = 0;

        // Optimized protection handler with throttling and user input detection
        let lastRestoreTime = 0;
        const protectionHandler = (event) => {
            const now = Date.now();
            if (now - lastRestoreTime < 200) return; // Throttle restoration attempts

            // Don't restore if user is actively editing (within 2 seconds of last input)
            if (now - lastUserInputTime < 2000) {
                return;
            }

            // If the value is unexpectedly empty or different, restore it
            if (input.value !== expectedValue && expectedValue && input.isConnected && !userIsEditing) {
                lastRestoreTime = now;

                // Restore the value
                input.value = expectedValue;

                // Re-trigger events to ensure React state is updated
                const key = Object.keys(input).find(key => key.startsWith('__reactProps$'));
                if (key) {
                    const props = input[key];
                    if (props.onChange) {
                        const syntheticEvent = {
                            target: input,
                            currentTarget: input,
                            type: 'change',
                            bubbles: true,
                            cancelable: true,
                            preventDefault: () => { },
                            stopPropagation: () => { },
                            persist: () => { }
                        };
                        props.onChange(syntheticEvent);
                    }
                }
            }
        };

        // User input detection handlers
        const userInputHandler = (event) => {
            userIsEditing = true;
            lastUserInputTime = Date.now();
            
            // Update the expected value to the new user input after a short delay
            setTimeout(() => {
                if (input.value && input.value !== expectedValue) {
                    expectedValue = input.value;
                    input._expectedCaptainId = expectedValue;
                    console.log('Captain ID manually updated to:', expectedValue);
                }
            }, 100);
        };

        const userEditEndHandler = (event) => {
            setTimeout(() => {
                userIsEditing = false;
            }, 500); // Give some time buffer after user stops editing
        };

        // Store handlers for cleanup
        input._protectionHandlers = {
            focus: protectionHandler,
            mouseenter: protectionHandler,
            mouseleave: protectionHandler,
            input: userInputHandler,
            keydown: userInputHandler,
            keyup: userInputHandler,
            blur: userEditEndHandler
        };

        // Monitor events that might clear the field and user input events
        Object.entries(input._protectionHandlers).forEach(([event, handler]) => {
            input.addEventListener(event, handler, { passive: true });
        });

        // Use MutationObserver to watch for value changes (more efficient than interval)
        const observer = new MutationObserver(() => {
            const now = Date.now();
            // Only restore if user hasn't been editing recently
            if (input.isConnected && input.value !== expectedValue && expectedValue && 
                !userIsEditing && now - lastUserInputTime > 2000) {
                protectionHandler();
            }
        });

        observer.observe(input, {
            attributes: true,
            attributeFilter: ['value']
        });

        // Store the observer for potential cleanup
        input._captainIdObserver = observer;

        // Reduced frequency periodic check - only run every 5 seconds instead of 1
        const periodicCheck = setInterval(() => {
            if (!input.isConnected || observerDisconnected) {
                cleanupCaptainIdProtection(input);
                return;
            }

            const now = Date.now();
            // Only restore if user hasn't been editing recently
            if (input.value !== expectedValue && expectedValue && 
                !userIsEditing && now - lastUserInputTime > 2000) {
                protectionHandler();
            }
        }, 5000); // Reduced from 1000ms to 5000ms

        // Store the interval for cleanup
        input._captainIdInterval = periodicCheck;

        // Register cleanup function
        registerCleanup(() => cleanupCaptainIdProtection(input));
    }

    function cleanupCaptainIdProtection(input) {
        if (!input) return;

        // Remove event listeners
        if (input._protectionHandlers) {
            Object.entries(input._protectionHandlers).forEach(([event, handler]) => {
                input.removeEventListener(event, handler);
            });
            delete input._protectionHandlers;
        }

        // Disconnect observer
        if (input._captainIdObserver) {
            input._captainIdObserver.disconnect();
            delete input._captainIdObserver;
        }

        // Clear interval
        if (input._captainIdInterval) {
            clearInterval(input._captainIdInterval);
            delete input._captainIdInterval;
        }

        // Reset protection flag
        input._captainIdProtected = false;
    }

    function processCustomerProfile(customerText) {
        let joinedDate = 'N/A';
        let customerRating = 'N/A';
        let blockHistory = '(0, Clear)';

        if (!customerText || !customerText.trim()) {
            return { joinedDate, customerRating, blockHistory };
        }

        console.log('Processing customer text:', customerText); // Debug

        // Extract joined date - multiple patterns
        let joinedMatch = customerText.match(/Member since\s+(\d{1,2}\s+\w{3}\s+\d{4})/i);
        if (!joinedMatch) {
            // Try alternative patterns
            joinedMatch = customerText.match(/#\d+\s*-\s*Member since\s+(\d{1,2}\s+\w{3}\s+\d{4})/i);
        }
        if (joinedMatch) {
            joinedDate = joinedMatch[1];
            console.log('Found joined date:', joinedDate); // Debug
        }

        // Extract rating - look for rating pattern before "Member since"
        const lines = customerText.split('\n');
        console.log('Splitting into lines:', lines.length); // Debug

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            console.log(`Line ${i}:`, line); // Debug

            if (line.match(/Member since/i)) {
                console.log(`Found "Member since" at line ${i}`); // Debug
                // Look for rating in previous lines (expanded search)
                for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
                    const prevLine = lines[j].trim();
                    console.log(`  Checking previous line ${j}:`, prevLine); // Debug

                    // Multiple rating patterns
                    let ratingMatch = prevLine.match(/^(\d+(?:\.\d+)?)$/);
                    if (!ratingMatch) {
                        // Try patterns with extra characters
                        ratingMatch = prevLine.match(/(\d+(?:\.\d+)?)\s*$/);
                    }
                    if (!ratingMatch) {
                        // Try finding rating anywhere in the line
                        ratingMatch = prevLine.match(/(\d+\.\d+)/);
                    }

                    if (ratingMatch) {
                        customerRating = ratingMatch[1];
                        console.log('Found rating:', customerRating); // Debug
                        break;
                    }
                }
                break;
            }
        }

        // Process block history
        const customerCsv = extractCustomerBlockHistoryCSV(customerText);
        if (customerCsv && customerCsv.trim()) {
            blockHistory = convertCustomerCSVToBlockHistory(customerCsv);
        }

        console.log('Final result:', { joinedDate, customerRating, blockHistory }); // Debug
        return { joinedDate, customerRating, blockHistory };
    }

    function extractCustomerBlockHistoryCSV(customerText) {
        if (!customerText || !customerText.trim()) {
            return '';
        }

        const lines = customerText.split('\n').map(line => line.trim()).filter(line => line);

        // Find the column headers section
        const columnHeaders = [
            'Current Status',
            'Old Status',
            'Action',
            'Updated On',
            'Updated By',
            'Reason',
            'Current CreditJOD',
            'Old CreditJOD',
            'User'
        ];

        // Find where the column headers end and data starts
        let headerEndIndex = -1;
        let dataStartIndex = -1;

        // Look for the pattern where all column headers appear consecutively
        for (let i = 0; i < lines.length - columnHeaders.length; i++) {
            let matchCount = 0;
            let tempIndex = i;

            for (let j = 0; j < columnHeaders.length; j++) {
                if (tempIndex < lines.length && lines[tempIndex] === columnHeaders[j]) {
                    matchCount++;
                    tempIndex++;
                } else {
                    break;
                }
            }

            if (matchCount === columnHeaders.length) {
                headerEndIndex = tempIndex - 1;
                dataStartIndex = tempIndex;
                break;
            }
        }

        if (headerEndIndex === -1 || dataStartIndex === -1) {
            console.log('Could not find column headers in customer profile');
            return '';
        }

        // Process all remaining lines after the headers, with validation
        const dataLines = lines.slice(dataStartIndex);

        // Process data lines - each line contains tab-separated values
        const allEntries = [];
        let nonSSOCCount = 0;

        // Helper functions for customer profile deduplication
        function parseCustomerDate(dateStr) {
            // Handle dates like "Aug 07, 2025 04:43 PM"
            try {
                return new Date(dateStr).getTime();
            } catch (e) {
                return 0;
            }
        }

        function extractCustomerIds(reason) {
            // Extract B.ID and T.ID from reason field
            const bIdMatch = reason.match(/B\.\s*ID:\s*(\d+)/);
            const tIdMatch = reason.match(/T\.\s*ID:\s*(\d+)/);
            return bIdMatch && tIdMatch ? `${bIdMatch[1]}-${tIdMatch[1]}` : null;
        }

        function generateCustomerEntryId(entry) {
            // Generate unique ID based on date, time, and user for better duplicate detection
            const dateObj = new Date(parseCustomerDate(entry.updatedOn));
            const timeKey = `${dateObj.getFullYear()}-${dateObj.getMonth()}-${dateObj.getDate()}-${dateObj.getHours()}-${dateObj.getMinutes()}`;
            // Also include a part of the reason to make it more unique
            const reasonPart = (entry.reason || '').substring(0, 20).replace(/[^\w]/g, '');
            return `${timeKey}-${entry.user}-${reasonPart}`.replace(/\s+/g, '_');
        }

        function findSharedKeywords(text1, text2) {
            const excludeWords = new Set([
                'block', 'unblock', 'status', 'current', 'old', 'action', 'updated', 'credit',
                'cash', 'trips', 'trip', 'allowed', 'more', 'due', 'enough', 'normal',
                'the', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'by',
                'from', 'up', 'about', 'into', 'through', 'during', 'before', 'after',
                'correction', 'corrected'
            ]);

            const extractKeywords = (text) => {
                return text.toLowerCase()
                    .replace(/[^\w\s]/g, ' ')
                    .split(/\s+/)
                    .filter(word => word.length > 2 && !excludeWords.has(word));
            };

            const keywords1 = extractKeywords(text1);
            const keywords2 = extractKeywords(text2);

            return keywords1.filter(word => keywords2.includes(word));
        }

        function findCorrectionTarget(correctionEntry, existingEntries) {
            const candidates = [];

            // First, try to find exact B.ID and T.ID matches
            const correctionIds = extractCustomerIds(correctionEntry.reason || '');
            if (correctionIds) {
                for (const existing of existingEntries.values()) {
                    if (existing.hasCorrection) continue;

                    const existingIds = extractCustomerIds(existing.reason || '');
                    if (existingIds === correctionIds) {
                        // Exact match found - this should be the highest priority
                        return { entry: existing, score: 1000, id: existing.entryId };
                    }
                }
            }

            // If no exact match found, use the scoring system
            for (const existing of existingEntries.values()) {
                if (existing.hasCorrection) continue;

                let score = 0;

                // Date proximity (within 30 days)
                const daysDiff = Math.abs(correctionEntry.timestamp - existing.timestamp) / (1000 * 60 * 60 * 24);
                if (daysDiff <= 30) score += 2;

                // Status matching
                if (existing.currentStatus === correctionEntry.currentStatus) score += 1;
                if (existing.oldStatus === correctionEntry.oldStatus) score += 1;
                if (existing.action === correctionEntry.action) score += 1;

                // User matching
                if (existing.user === correctionEntry.user) score += 2;

                // Shared keywords in reasons
                const sharedKeywords = findSharedKeywords(existing.reason || '', correctionEntry.reason || '');
                if (sharedKeywords.length >= 2) score += 2;

                // Credit amount proximity
                if (existing.currentCredit && correctionEntry.currentCredit) {
                    const creditDiff = Math.abs(parseFloat(existing.currentCredit) - parseFloat(correctionEntry.currentCredit));
                    if (creditDiff <= 1) score += 1;
                }

                if (score >= 4) {
                    candidates.push({ entry: existing, score, id: existing.entryId });
                }
            }

            return candidates.length > 0 ? candidates.sort((a, b) => b.score - a.score)[0] : null;
        }

        // Parse all entries first
        for (let line of dataLines) {
            const trimmedLine = line.trim();
            if (trimmedLine) {
                // Skip obvious non-data lines
                if (trimmedLine.includes('Block User DeviceCurrent') ||
                    trimmedLine.includes('Device Information') ||
                    trimmedLine.includes('Total Credit') ||
                    trimmedLine === 'Current Status' ||
                    trimmedLine === 'Old Status' ||
                    trimmedLine.includes('Credit History') ||
                    !trimmedLine.includes('\t')) {
                    continue;
                }

                const values = line.split('\t');
                if (values.length >= columnHeaders.length) {
                    const row = values.slice(0, columnHeaders.length);

                    // Check if Reason field (index 5) is "-"
                    if (row[5] && row[5].trim() === '-') {
                        nonSSOCCount++;
                        continue; // Skip processing these for now
                    }

                    // Create entry object
                    const entry = {
                        currentStatus: row[0] || '',
                        oldStatus: row[1] || '',
                        action: row[2] || '',
                        updatedOn: row[3] || '',
                        updatedBy: row[4] || '',
                        reason: row[5] || '',
                        currentCredit: row[6] || '',
                        oldCredit: row[7] || '',
                        user: row[8] || '',
                        timestamp: parseCustomerDate(row[3]),
                        hasCorrection: (row[5] || '').toLowerCase().includes('correction') ||
                                     (row[2] || '').toLowerCase().includes('correction'),
                        rawRow: row
                    };

                    entry.entryId = generateCustomerEntryId(entry);
                    allEntries.push(entry);
                }
            }
        }

        // Remove duplicates and handle corrections
        const uniqueEntries = new Map();
        const correctionEntries = [];

        // Separate corrections from regular entries and handle better duplicate detection
        for (const entry of allEntries) {
            if (entry.hasCorrection) {
                correctionEntries.push(entry);
            } else {
                // Check for duplicates with more sophisticated matching
                let isDuplicate = false;
                let duplicateKey = null;

                for (const [existingKey, existingEntry] of uniqueEntries) {
                    let isDuplicateMatch = false;

                    // Check 1: Same user, close in time (within 1 hour)
                    const timeDiff = Math.abs(entry.timestamp - existingEntry.timestamp) / (1000 * 60 * 60);
                    if (timeDiff <= 1 && entry.user === existingEntry.user) {
                        // Check if they are related (same action types or reverse actions)
                        const isRelatedAction = (
                            entry.action === existingEntry.action ||
                            (entry.action.includes('BLOCKED') && existingEntry.action.includes('UNBLOCKED')) ||
                            (entry.action.includes('UNBLOCKED') && existingEntry.action.includes('BLOCKED'))
                        );

                        if (isRelatedAction) {
                            isDuplicateMatch = true;
                        }
                    }

                    // Check 2: Same B.ID and T.ID (regardless of user or time)
                    if (!isDuplicateMatch) {
                        const entryIds = extractCustomerIds(entry.reason || '');
                        const existingIds = extractCustomerIds(existingEntry.reason || '');

                        if (entryIds && existingIds && entryIds === existingIds) {
                            // Same incident IDs - this is a duplicate
                            isDuplicateMatch = true;
                        }
                    }

                    if (isDuplicateMatch) {
                        isDuplicate = true;
                        duplicateKey = existingKey;
                        break;
                    }
                }

                if (isDuplicate) {
                    // Keep the later entry, or prioritize UNBLOCKED when timestamps are equal
                    const existing = uniqueEntries.get(duplicateKey);
                    if (entry.timestamp > existing.timestamp) {
                        uniqueEntries.set(duplicateKey, entry);
                    } else if (entry.timestamp === existing.timestamp) {
                        // When timestamps are identical, prioritize UNBLOCKED actions
                        if (entry.action.includes('UNBLOCKED') && !existing.action.includes('UNBLOCKED')) {
                            uniqueEntries.set(duplicateKey, entry);
                        }
                        // Keep existing if it's already UNBLOCKED or if new entry is BLOCKED
                    } else {
                        // entry.timestamp < existing.timestamp, but still check for UNBLOCKED priority
                        // If existing is BLOCKED and new entry is UNBLOCKED, replace with UNBLOCKED
                        if (entry.action.includes('UNBLOCKED') && existing.action.includes('BLOCKED') && !existing.action.includes('UNBLOCKED')) {
                            uniqueEntries.set(duplicateKey, entry);
                        }
                        // Otherwise keep the existing (later) entry
                    }
                } else {
                    // Add as new entry
                    uniqueEntries.set(entry.entryId, entry);
                }
            }
        }

        // Apply corrections
        const uniqueCorrections = new Map();
        for (const correction of correctionEntries) {
            if (uniqueCorrections.has(correction.entryId)) {
                const existing = uniqueCorrections.get(correction.entryId);
                if (correction.timestamp >= existing.timestamp) {
                    uniqueCorrections.set(correction.entryId, correction);
                }
            } else {
                uniqueCorrections.set(correction.entryId, correction);
            }
        }

        // Match corrections to existing entries
        for (const correction of uniqueCorrections.values()) {
            // Check if this is a same-day same-user correction
            let sameDaySameUserTarget = null;
            const correctionDate = new Date(correction.timestamp);
            const correctionDateKey = `${correctionDate.getFullYear()}-${String(correctionDate.getMonth()).padStart(2, '0')}-${String(correctionDate.getDate()).padStart(2, '0')}`;

            // First check for same-day same-user entries (regardless of incident IDs)
            for (const [entryId, entry] of uniqueEntries) {
                if (entry.hasCorrection) continue; // Skip other corrections

                const entryDate = new Date(entry.timestamp);
                const entryDateKey = `${entryDate.getFullYear()}-${String(entryDate.getMonth()).padStart(2, '0')}-${String(entryDate.getDate()).padStart(2, '0')}`;

                // Same day and same user (must be exact match)
                if (entryDateKey === correctionDateKey && entry.updatedBy === correction.updatedBy) {
                    // Additional check: the entry should be reasonably close in time (within same day but not too far apart)
                    const hoursDiff = Math.abs(correction.timestamp - entry.timestamp) / (1000 * 60 * 60);
                    if (hoursDiff <= 24) { // Within 24 hours
                        sameDaySameUserTarget = { entry, id: entryId, score: 100 }; // High score for same-day same-user
                        break;
                    }
                }
            }

            // If no same-day same-user target found, use the original correction target logic
            const correctionTarget = sameDaySameUserTarget || findCorrectionTarget(correction, uniqueEntries);

            if (correctionTarget) {
                // Replace the target entry with the correction
                uniqueEntries.delete(correctionTarget.id);
                uniqueEntries.set(correction.entryId, correction);
            } else {
                // Add correction as new entry if no target found
                uniqueEntries.set(correction.entryId, correction);
            }
        }

        // Convert back to CSV rows
        const csvRows = Array.from(uniqueEntries.values()).map(entry => entry.rawRow);

        // Add consolidated "Not SSOC related" entry if there were any "-" reason entries
        if (nonSSOCCount > 0) {
            const notSSocEntry = columnHeaders.map(() => 'Not SSOC related');
            csvRows.push(notSSocEntry);
        }

        if (csvRows.length === 0) {
            return 'No block history data found';
        }

        // Generate CSV with comma delimiters
        // Escape commas and quotes in values for proper CSV format
        function escapeCSVValue(value) {
            if (value.includes(',') || value.includes('"') || value.includes('\n')) {
                return '"' + value.replace(/"/g, '""') + '"';
            }
            return value;
        }

        let csv = columnHeaders.map(header => escapeCSVValue(header)).join(',') + '\n';
        for (let row of csvRows) {
            csv += row.map(value => escapeCSVValue(value)).join(',') + '\n';
        }

        return csv;
    }

    function convertCustomerCSVToBlockHistory(csvText) {
        if (!csvText || csvText.trim() === '') {
            return '(0, Clear)';
        }

        const lines = csvText.split('\n').filter(line => line.trim());
        if (lines.length <= 1) {
            return '(0, Clear)';
        }

        // Skip header line
        const dataLines = lines.slice(1);

        // Count incident types
        const incidentCounts = {};
        let hasNotSSocRelated = false;

        for (const line of dataLines) {
            if (!line.trim()) continue;

            // Parse CSV line (handle quoted fields)
            const fields = [];
            let currentField = '';
            let inQuotes = false;

            for (let i = 0; i < line.length; i++) {
                const char = line[i];
                if (char === '"' && (i === 0 || line[i-1] === ',')) {
                    inQuotes = true;
                } else if (char === '"' && inQuotes && (i === line.length - 1 || line[i+1] === ',')) {
                    inQuotes = false;
                } else if (char === ',' && !inQuotes) {
                    fields.push(currentField.trim());
                    currentField = '';
                } else {
                    currentField += char;
                }
            }
            fields.push(currentField.trim());

            if (fields.length >= 6) {
                const reason = fields[5] || '';

                // Check if it's the "Not SSOC related" placeholder
                if (reason === 'Not SSOC related') {
                    hasNotSSocRelated = true;
                    continue;
                }

                // Categorize SSOC incidents using similar logic to captain profiles
                const incidents = categorizeCustomerIncidents(reason);
                for (const incident of incidents) {
                    incidentCounts[incident] = (incidentCounts[incident] || 0) + 1;
                }
            }
        }

        // Build the block history string
        const parts = [];

        // Add specific incident counts
        for (const [incident, count] of Object.entries(incidentCounts)) {
            parts.push(`(${count}, ${incident})`);
        }

        // Handle "Not SSOC related" cases
        if (hasNotSSocRelated) {
            if (parts.length === 0) {
                // Only "Not SSOC related" entries
                return 'Not SSOC related';
            } else {
                // Mix of SSOC and non-SSOC entries
                parts.push('& others not SSOC related');
            }
        }

        if (parts.length === 0) {
            return '(0, Clear)';
        }

        return parts.join(', ');
    }

    function categorizeCustomerIncidents(reason) {
        if (!reason || reason.trim() === '' || reason === '-') {
            return [];
        }

        const input_string = reason.toLowerCase();
        const incidents = [];

        // Check for AIC/AINC designation first (for customers, we want to show these)
        let designation = '';
        if (input_string.includes(' aic ') || input_string.includes('-aic-') ||
            input_string.includes(' aic-') || input_string.includes('-aic ') ||
            input_string.includes('aic-') || input_string.includes('-aic')) {
            designation = ' AIC';
        } else if (input_string.includes(' ainc ') || input_string.includes('-ainc-') ||
            input_string.includes(' ainc-') || input_string.includes('-ainc ') ||
            input_string.includes('ainc-') || input_string.includes('-ainc')) {
            designation = ' AINC';
        }
        // For VIC/VINC, we don't add any designation (opposite of captain logic)

        // Use similar patterns to captain profile incident detection
        // Sexual harassment types
        if (input_string.includes('inappropriate talk') || input_string.includes('inapprepiate talk')) {
            incidents.push('Inappropriate talk');
        } else if (input_string.includes('sexual harassment')) {
            if (input_string.includes('staring') || input_string.includes('adjusting the mirror')) {
                incidents.push('Staring');
            } else {
                incidents.push('Sexual Harassment');
            }
        } else if (input_string.includes('staring') || input_string.includes('adjusting the mirror')) {
            incidents.push('Staring');
        }

        // Contact after ride / Stalking
        if (input_string.includes('contact after ride') || input_string.includes('by phone or sms') || input_string.includes('by social media')) {
            if (input_string.includes('stalking') || input_string.includes('physical contact (stalking)')) {
                incidents.push('Stalking');
            } else {
                incidents.push('Contact After Ride');
            }
        } else if (input_string.includes('stalking')) {
            incidents.push('Stalking');
        }

        // Physical incidents
        if (input_string.includes('physical attack')) {
            incidents.push('Physical Attack');
        }
        if (input_string.includes('threats of physical harm')) {
            incidents.push('Threats of Physical Harm');
        }
        if (input_string.includes('held against will')) {
            incidents.push('Held Against Will');
        }
        if (input_string.includes('captain touched customer')) {
            incidents.push('Captain Touched Customer');
        }
        if (input_string.includes('captain kidnapped customer') || input_string.includes('kidnap')) {
            incidents.push('Captain Kidnapped Customer');
        }

        // Safety incidents
        if (input_string.includes('unsafe driving')) {
            if (input_string.includes('reckless')) {
                incidents.push('Reckless Driving');
            } else {
                incidents.push('Unsafe Driving');
            }
        }
        // Check for direct reckless driving patterns (like "I:Reckless Driving")
        if (!incidents.some(incident => incident.includes('Reckless Driving')) && 
            (input_string.includes('reckless driving') || input_string.includes('i:reckless driving'))) {
            incidents.push('Reckless Driving');
        }
        if (input_string.includes('using phone')) {
            incidents.push('Using Phone');
        }
        // Detailed accident categorization (same as captain profile logic)
        if (input_string.includes('accident') || input_string.includes('accidents')) {
            if (input_string.includes('fatality') || input_string.includes('fatalities')) {
                if (input_string.includes('unknown') || input_string.includes('unverified')) {
                    incidents.push('Accident Fatality - Unknown Cause');
                } else if (input_string.includes('using phone')) {
                    incidents.push('Accident Fatality - Using Phone');
                } else if (input_string.includes('speed') || input_string.includes('reckless')) {
                    incidents.push('Accident Fatality - Reckless');
                } else if (input_string.includes('3rd party') || input_string.includes('caused by 3rd party')) {
                    incidents.push('Accident Fatality - 3rd party');
                } else {
                    incidents.push('Accident Fatality');
                }
            } else if (input_string.includes('no injury') || input_string.includes('no injuries') || input_string.includes('no-injuries')) {
                if (input_string.includes('unknown') || input_string.includes('unverified')) {
                    incidents.push('Accident No Injuries - Unknown Cause');
                } else if (input_string.includes('using phone')) {
                    incidents.push('Accident No Injuries - Using Phone');
                } else if (input_string.includes('speed') || input_string.includes('reckless') || input_string.includes('caused by speed')) {
                    incidents.push('Accident No Injuries - Reckless');
                } else if (input_string.includes('3rd party') || input_string.includes('caused by 3rd party')) {
                    incidents.push('Accident No Injuries - 3rd party');
                } else {
                    incidents.push('Accident No Injuries');
                }
            } else if (input_string.includes('injury') || input_string.includes('injuries')) {
                if (input_string.includes('unknown') || input_string.includes('unverified')) {
                    incidents.push('Accident Injury - Unknown Cause');
                } else if (input_string.includes('using phone')) {
                    incidents.push('Accident Injury - Using Phone');
                } else if (input_string.includes('speed') || input_string.includes('reckless')) {
                    incidents.push('Accident Injury - Reckless');
                } else if (input_string.includes('3rd party') || input_string.includes('caused by 3rd party')) {
                    incidents.push('Accident Injury - 3rd party');
                } else {
                    incidents.push('Accident Injury');
                }
            } else {
                incidents.push('Accident');
            }
        }

        // Other incidents
        if (input_string.includes('theft')) {
            incidents.push('Theft');
        }
        if (input_string.includes('robbery')) {
            incidents.push('Robbery');
        }
        if (input_string.includes('unauthorized person in vehicle')) {
            incidents.push('Unauthorized Person in Vehicle');
        }

        // Impostor incidents - check for specific patterns
        // Handle the specific pattern "Impostor / Not Specified Captain" first
        if (input_string.includes('impostor / not specified captain') ||
            input_string.includes('not specified captain') ||
            (input_string.includes('impostor') && input_string.includes('captain'))) {
            incidents.push('Impostor Captain');
        }
        // Check for "cap" when not part of "captain" - treat as Impostor Captain
        else if (input_string.includes('cap') && !input_string.includes('captain')) {
            incidents.push('Impostor Captain');
        }
        else if (input_string.includes('not specified car') || (input_string.includes('impostor') && input_string.includes('car'))) {
            incidents.push('Impostor Car');
        }
        else if (input_string.includes('impostor') && !input_string.includes('captain') && !input_string.includes('car')) {
            incidents.push('Impostor');
        }

        // If no specific incident found but contains SSOC indicators, mark as generic SSOC
        if (incidents.length === 0 && (
            input_string.includes('safety & security operations') ||
            input_string.includes('safety and security operations') ||
            input_string.includes('vic -') ||
            input_string.includes('ssoc') ||
            input_string.includes('b. id:') ||
            input_string.includes('t. id:')
        )) {
            incidents.push('SSOC');
        }

        // Apply designation to all incidents (only for AIC/AINC, not VIC/VINC)
        const finalIncidents = [];
        for (const incident of incidents) {
            // Don't add designation if incident already ends with AIC or AINC
            if (designation && (incident.endsWith(' AIC') || incident.endsWith(' AINC'))) {
                finalIncidents.push(incident);
            } else if (designation) {
                finalIncidents.push(incident + designation);
            } else {
                finalIncidents.push(incident);
            }
        }

        return finalIncidents;
    }

    function processBothProfiles(captainText, customerText) {
        // Process customer profile first
        const customerData = processCustomerProfile(customerText);

        // Process captain profile with customer data
        const result = processText(captainText, customerData);

        // Store the processed data for use in inbound template
        storedCaptainProfile = {
            text: captainText,
            processed: result
        };
        storedCustomerProfile = {
            text: customerText,
            processed: customerData
        };

        return result;
    }

    function processText(inputText, customerData = null) {

        let csvResult = '';
        let incidentFormat = '';


        if (inputText.includes('BLOCK HISTORY')) {
            csvResult = processBlockHistory(inputText);

            if (csvResult) {
                incidentFormat = convertCsvToIncidentFormat(csvResult);
            }
        }

        lastCsvResult = csvResult;
        lastCaptainCsv = csvResult;

        const captainIdMatch = inputText.match(/\((\d+)\)/);
        const captainId = captainIdMatch ? captainIdMatch[1] : '';

        if (captainId) {
            // Set Captain ID with retry mechanism to ensure it sticks
            setCaptainIdWithRetry(captainId, 3);
        }

        const tripsMatch = inputText.match(/MONTHLY \/ TOTAL TRIPS\s*(\d+\s*\/\s*\d+)/);

        let rating = 'N/A';

        const ratingLine = inputText.match(/AVERAGE\s*\/\s*LIFETIME\s*RATING\s*([0-9.]+\s*\/\s*[0-9.]*)/i);

        if (ratingLine) {
            rating = ratingLine[1].trim();
        }

        const tierMatch = inputText.match(/CURRENT TIER\s*(\w+)/);
        const dateMatch = inputText.match(/(\d+)\s+(\w+),\s+(\d{4})/);

        let tenureCategory = '';
        if (dateMatch) {
            const [_, day, month, year] = dateMatch;
            const joinDate = new Date(`${month} ${day}, ${year}`);
            const now = new Date();
            const tenureInMonths = (now.getFullYear() - joinDate.getFullYear()) * 12 +
                (now.getMonth() - joinDate.getMonth());
            const tenureInYears = tenureInMonths / 12;

            if (tenureInYears >= 10) {
                tenureCategory = '( 10+ )';
            } else if (tenureInYears >= 6) {
                tenureCategory = '( 6 - 9 )';
            } else if (tenureInYears >= 5) {
                tenureCategory = '( 2 - 5 )';
            } else if (tenureInYears >= 2) {
                tenureCategory = '( 2 - 5 )';
            } else if (tenureInMonths >= 6) {
                tenureCategory = '( 6 - 2 )';
            } else {
                tenureCategory = '( 0 - 6 )';
            }
        }


        let blockHistoryText = '';
        if (incidentFormat) {
            blockHistoryText = incidentFormat.split('\n').map(line => `    ${line}`).join('\n');
        } else {
            blockHistoryText = `    1- Sexual behavior: (0, Clear)
    2- Physical altercations: (0, Clear)
    3- Road safety: (0, Clear)
    4- Minor: (0, Clear)
    5- Others SSOC related: (0, Clear)`;
        }

        const formattedText = `**\*Captain Profile**
* Trips: ${tripsMatch ? tripsMatch[1] : 'N/A'}
* Tenure:
    * ${tenureCategory}
* Rating: ${rating}
* Tier: ${tierMatch ? tierMatch[1] : 'N/A'}
* Block History:
${blockHistoryText}

* Past Trips Rating:

**\*Customer Profile**
* Joined Careem: ${customerData ? customerData.joinedDate : 'N/A'}
* Rating of past trips: ${customerData ? customerData.customerRating : 'N/A'}
* Block History: ${customerData && customerData.blockHistory ? customerData.blockHistory : '(0, Clear)'}
* Other complaints/claims sent: Clear
* Other Zendesk Ticket/s relating to the Booking ID, Ticket: None`;


        return {
            formattedText,
            csvResult,
            incidentFormat
        };
    }

    function createTextWindow() {
        const overlay = document.createElement('div');
        overlay.className = 'text-window-overlay';

        const windowPane = document.createElement('div');
        windowPane.className = 'text-window-pane';

        const header = document.createElement('div');
        header.className = 'text-window-header';

        const title = document.createElement('div');
        title.className = 'text-window-title';
        title.textContent = 'Paste Captain Profile';

        const closeButton = document.createElement('button');
        closeButton.className = 'text-window-close';
        closeButton.innerHTML = '×';
        closeButton.onclick = closeTextWindow;

        const textarea = document.createElement('textarea');
        textarea.className = 'text-window-textarea';
        textarea.placeholder = 'Paste captain profile text here...';

        let captainText = '';
        let currentStep = 'captain'; // 'captain' or 'customer'

        textarea.addEventListener('paste', (e) => {
            setTimeout(() => {
                const inputText = textarea.value;

                if (currentStep === 'captain') {
                    // Store captain text and switch to customer
                    captainText = inputText;
                    currentStep = 'customer';

                    // Update UI for customer input
                    title.textContent = 'Paste Customer Profile';
                    textarea.value = '';
                    textarea.placeholder = 'Paste customer profile text here...';

                } else if (currentStep === 'customer') {
                    // Process both profiles
                    const customerText = inputText;
                    const result = processBothProfiles(captainText, customerText);

                    // Generate CSV from customer profile block history
                    const customerCsv = extractCustomerBlockHistoryCSV(customerText);

                    // Convert CSV to block history format for customer profile
                    const blockHistoryText = convertCustomerCSVToBlockHistory(customerCsv);

                    // Store CSV globally for Block History window
                    if (customerCsv && customerCsv.trim()) {
                        lastCsvResult = customerCsv;
                        lastCustomerCsv = customerCsv;

                        // If Block History window is open, update it
                        if (blockHistoryWindow && blockHistoryWindow.textarea) {
                            blockHistoryWindow.textarea.value = customerCsv;
                        }

                        showToast('Customer profile processed! CSV generated and available in Block History window.');
                    } else {
                        showToast('Customer profile processed! No block history found for CSV generation.');
                    }

                    // Extract customer data properly
                    const customerData = processCustomerProfile(customerText);

                    // Update customer data with block history
                    const updatedCustomerData = {
                        ...customerData,
                        blockHistory: blockHistoryText
                    };

                    // Regenerate the result with updated customer data
                    const updatedResult = processText(captainText, updatedCustomerData);

                    // Show result
                    textarea.value = updatedResult.formattedText;

                    // Copy to clipboard
                    navigator.clipboard.writeText(updatedResult.formattedText)
                        .then(() => {
                            showToast('Both profiles processed and copied to clipboard!');
                            closeTextWindow();
                        })
                        .catch(err => {
                            console.error('Failed to copy text:', err);
                            showToast('Error copying to clipboard');
                        });
                }
            }, 100);
        });

        header.appendChild(title);
        header.appendChild(closeButton);
        windowPane.appendChild(header);
        windowPane.appendChild(textarea);

        overlay.appendChild(windowPane);
        document.body.appendChild(overlay);

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                closeTextWindow();
            }
        });

        return {
            overlay,
            windowPane,
            textarea,
            title,
            get currentStep() { return currentStep; },
            set currentStep(value) { currentStep = value; },
            get captainText() { return captainText; },
            set captainText(value) { captainText = value; }
        };
    }

    function showTextWindow() {
        if (!textWindow) {
            textWindow = createTextWindow();
        }

        // Reset the window to captain profile state
        textWindow.title.textContent = 'Paste Captain Profile';
        textWindow.textarea.value = '';
        textWindow.textarea.placeholder = 'Paste captain profile text here...';
        textWindow.currentStep = 'captain';
        textWindow.captainText = '';

        textWindow.overlay.classList.add('show');
        textWindow.windowPane.classList.add('show');
        textWindow.textarea.focus();
    }

    function closeTextWindow() {
        if (textWindow) {
            textWindow.overlay.classList.remove('show');
            textWindow.windowPane.classList.remove('show');

            // Reset state for next use
            textWindow.title.textContent = 'Paste Captain Profile';
            textWindow.textarea.value = '';
            textWindow.textarea.placeholder = 'Paste captain profile text here...';
            textWindow.currentStep = 'captain';
            textWindow.captainText = '';
        }
    }


    function categorizeIncident(comment) {
        const incidents = categorizeAllIncidents(comment);
        return incidents.length > 0 ? incidents[0] : "Other SSOC Incident";
    }


    function parseIndividualIncidents(comment) {
        const incidents = [];

        // First try to split by "I:Category" for multi-incident format (including common typos)
        const incidentParts = comment.split(/i:categ[ro]y|I:Categ[ro]y/gi);

        if (incidentParts.length > 1) {
            for (let i = 1; i < incidentParts.length; i++) {
            const incidentText = "i:category" + incidentParts[i];
            const incidentLower = incidentText.toLowerCase();

            const incidentTypes = categorizeIndividualIncident(incidentText);


            let designation = '';
            if (incidentLower.includes(' vic ') || incidentLower.includes('-vic-') ||
                incidentLower.includes(' vic-') || incidentLower.includes('-vic ') ||
                incidentLower.includes('vic-') || incidentLower.includes('-vic')) {
                designation = ' VIC';
            } else if (incidentLower.includes(' vinc ') || incidentLower.includes('-vinc-') ||
                incidentLower.includes(' vinc-') || incidentLower.includes('-vinc ') ||
                incidentLower.includes('vinc-') || incidentLower.includes('-vinc')) {
                designation = ' VINC';
            }


            for (const incidentType of incidentTypes) {
                // Don't add designation if incident already ends with VIC or VINC
                if (designation && (incidentType.endsWith(' VIC') || incidentType.endsWith(' VINC'))) {
                    incidents.push(incidentType);
                } else {
                    incidents.push(incidentType + designation);
                }
            }
            }
        } else {
            // Handle single comment with potentially multiple incidents
            // Look for patterns like "i:" followed by incident descriptions
            const singleCommentIncidents = categorizeAllIncidents(comment);

            // Check for overall VIC/VINC designation
            const commentLower = comment.toLowerCase();
            let designation = '';
            if (commentLower.includes(' vic ') || commentLower.includes('-vic-') ||
                commentLower.includes(' vic-') || commentLower.includes('-vic ') ||
                commentLower.includes('vic-') || commentLower.includes('-vic')) {
                designation = ' VIC';
            } else if (commentLower.includes(' vinc ') || commentLower.includes('-vinc-') ||
                commentLower.includes(' vinc-') || commentLower.includes('-vinc ') ||
                commentLower.includes('vinc-') || commentLower.includes('-vinc')) {
                designation = ' VINC';
            }

            // Add each incident type with designation
            for (const incidentType of singleCommentIncidents) {
                // Don't add designation if incident already ends with VIC or VINC
                if (designation && (incidentType.endsWith(' VIC') || incidentType.endsWith(' VINC'))) {
                    incidents.push(incidentType);
                } else {
                    incidents.push(incidentType + designation);
                }
            }
        }

        return incidents;
    }


    function parseIndividualIncidentsByPattern(input_string) {
        const incidents = [];

        // Split by "i:" to find individual incident descriptions
        const incidentParts = input_string.split(/\s+i:/);

        if (incidentParts.length <= 1) {
            return incidents; // No individual incidents found
        }

        // Process each incident part (skip the first one as it's before the first "i:")
        for (let i = 1; i < incidentParts.length; i++) {
            const incidentText = "i:" + incidentParts[i];
            const incidentIncidents = categorizeIndividualIncident(incidentText);
            incidents.push(...incidentIncidents);
        }

        return incidents;
    }

    function categorizeIndividualIncident(incidentText) {
        const input_string = incidentText.toLowerCase();
        const incidents = [];



        // Specific incident patterns for individual incidents
        if (input_string.includes("physical attack")) {
            incidents.push("Physical Attack");
        }
        if (input_string.includes("threats of physical harm")) {
            incidents.push("Threats of Physical Harm");
        }
        if (input_string.includes("captain kidnapped customer") || input_string.includes("kidnap")) {
            incidents.push("Captain Kidnapped Customer");
        }
        // Check for specific sexual harassment types first
        if (input_string.includes("staring") || input_string.includes("mirror") || input_string.includes("adjusting the mirror")) {
            incidents.push("Staring");
        } else if (input_string.includes("inappropriate talk") || input_string.includes("inapprepiate talk")) {
            incidents.push("Inappropriate Talk");
        } else if (input_string.includes("captain touched customer")) {
            incidents.push("Captain Touched Customer");
        } else if (input_string.includes("sexual harassment")) {
            incidents.push("Sexual Harassment");
        }

        if (input_string.includes("contact after ride") || input_string.includes("by phone or sms")) {
            if (input_string.includes("stalking") || input_string.includes("physical contact (stalking)")) {
                incidents.push("Stalking");
            } else {
                incidents.push("Contact After Ride");
            }
        }
        if (input_string.includes("other sexual physical contact")) {
            incidents.push("Other Sexual Physical Contact");
        }
        if (input_string.includes("unsafe driving")) {
            if (input_string.includes("reckless")) {
                incidents.push("Reckless Driving");
            } else if (input_string.includes("using phone")) {
                incidents.push("Using Phone");
            }
        } else if (input_string.includes("using phone")) {
            incidents.push("Using Phone");
        }
        if (input_string.includes("no seatbelt") || input_string.includes("no helmet")) {
            incidents.push("No Seatbelt / Helmet");
        }
        // Check for "no injuries" first to avoid matching "injuries" as "injury"
        if (input_string.includes("accident no injuries") || input_string.includes("accident no-injuries") ||
            (input_string.includes("accident") && (input_string.includes("no injuries") || input_string.includes("no-injuries")))) {
            if (input_string.includes("reckless") || input_string.includes("speed")) {
                incidents.push("Accident No Injuries - Reckless");
            } else if (input_string.includes("3rd party")) {
                incidents.push("Accident No Injuries - 3rd party VIC");
            } else {
                incidents.push("Accident No Injuries");
            }
        } else if (input_string.includes("accident injury") || (input_string.includes("accident") && input_string.includes("injury") && !input_string.includes("no injury") && !input_string.includes("no-injury"))) {
            if (input_string.includes("reckless") || input_string.includes("speed")) {
                incidents.push("Accident Injury - Reckless");
            } else if (input_string.includes("3rd party")) {
                incidents.push("Accident Injury - 3rd party VIC");
            } else {
                incidents.push("Accident Injury");
            }
        }
        if (input_string.includes("driving under influence") || input_string.includes("substance related")) {
            incidents.push("Driving Under Influence");
        }
        // Handle impostor incidents with priority for specific patterns
        if (input_string.includes("impostor / not specified captain") ||
            input_string.includes("not specified captain") ||
            (input_string.includes("impostor") && input_string.includes("captain"))) {
            incidents.push("Impostor Captain");
        }
        // Check for "cap" when not part of "captain" - treat as Impostor Captain
        else if (input_string.includes("cap") && !input_string.includes("captain")) {
            incidents.push("Impostor Captain");
        }
        else if (input_string.includes("impostor") && input_string.includes("car")) {
            incidents.push("Impostor Car");
        }
        // Add Theft only when not an Armed Robbery context
        if ((input_string.includes("theft") || input_string.includes("captain stole from customer")) &&
            !(input_string.includes("armed robbery") || (input_string.includes("robbery") && input_string.includes("captain stole from customer")))) {
            incidents.push("Theft");
        }
        if (input_string.includes("armed robbery")) {
            incidents.push("Armed Robbery");
        }
        if (input_string.includes("unauthorized person in vehicle")) {
            incidents.push("Unauthorized Person in Vehicle");
        }
        if (input_string.includes("medical emergency")) {
            incidents.push("Medical Emergency");
        }
        if (input_string.includes("drop off not added") || input_string.includes("unsafe / forced drop off")) {
            incidents.push("Forced Drop off");
        }


        return incidents;
    }

    function categorizeAllIncidents(comment) {
        const input_string = comment.toLowerCase();
        const incidents = [];

        // First try to parse individual incidents separated by "i:" patterns
        const individualIncidents = parseIndividualIncidentsByPattern(input_string);
        if (individualIncidents.length > 0) {
            incidents.push(...individualIncidents);
            return incidents;
        }


        if (input_string.includes("accident") || input_string.includes("accidents")) {
            if (input_string.includes("fatality") || input_string.includes("fatalities")) {
                if (input_string.includes("unknown") || input_string.includes("unverified")) {
                    incidents.push("Accident Fatality - Unknown Cause");
                } else if (input_string.includes("using phone")) {
                    incidents.push("Accident Fatality - Using Phone");
                } else if (input_string.includes("speed") || input_string.includes("reckless")) {
                    incidents.push("Accident Fatality - Reckless");
                } else if (input_string.includes("3rd party")) {
                    incidents.push("Accident Fatality - 3rd party");
                } else {
                    incidents.push("Accident Fatality");
                }
            } else if (input_string.includes("no injury") || input_string.includes("no injuries") || input_string.includes("no-injuries")) {
                if (input_string.includes("unknown") || input_string.includes("unverified")) {
                    incidents.push("Accident No Injuries - Unknown Cause");
                } else if (input_string.includes("using phone")) {
                    incidents.push("Accident No Injuries - Using Phone");
                } else if (input_string.includes("speed") || input_string.includes("reckless") || input_string.includes("caused by speed")) {
                    incidents.push("Accident No Injuries - Reckless");
                } else if (input_string.includes("3rd party") || input_string.includes("caused by 3rd party")) {
                    incidents.push("Accident No Injuries - 3rd party VIC");
                } else {
                    incidents.push("Accident No Injuries");
                }
            } else if (input_string.includes("injury") || input_string.includes("injuries")) {
                if (input_string.includes("unknown") || input_string.includes("unverified")) {
                    incidents.push("Accident Injury - Unknown Cause");
                } else if (input_string.includes("using phone")) {
                    incidents.push("Accident Injury - Using Phone");
                } else if (input_string.includes("speed") || input_string.includes("reckless")) {
                    incidents.push("Accident Injury - Reckless");
                } else if (input_string.includes("3rd party") || input_string.includes("caused by 3rd party")) {
                    incidents.push("Accident Injury - 3rd party VIC");
                } else {
                    incidents.push("Accident Injury");
                }
            } else {
                incidents.push("Accident");
            }
        }


        let foundSpecificSexualIncident = false;

        if (input_string.includes("customer touched captain")) {
            incidents.push("Customer Touched Captain");
            foundSpecificSexualIncident = true;
        }
        if (input_string.includes("inappropriate talk") || input_string.includes("inapprepiate talk")) {
            incidents.push("Inappropriate Talk");
            foundSpecificSexualIncident = true;
        }
        if (input_string.includes("captain touched customer")) {
            incidents.push("Captain Touched Customer");
            foundSpecificSexualIncident = true;
        }
        if (input_string.includes("mirror") || input_string.includes("staring") || input_string.includes("adjusting the mirror")) {
            incidents.push("Staring");
            foundSpecificSexualIncident = true;
        }
        if (input_string.includes("other sexual physical contact")) {
            incidents.push("Other Sexual Physical Contact");
            foundSpecificSexualIncident = true;
        }
        if (input_string.includes("contact after ride")) {
            if (input_string.includes("stalking") || input_string.includes("physical contact (stalking)")) {
                incidents.push("Stalking");
            } else {
                incidents.push("Contact After Ride");
            }
            foundSpecificSexualIncident = true;
        }


        if (!foundSpecificSexualIncident && input_string.includes("sexual harassment")) {
            incidents.push("Sexual Harassment");
        }


        let foundSpecificKidnapIncident = false;
        let foundSpecificPhysicalIncident = false;

        if (input_string.includes("customer kidnapped captain")) {
            incidents.push("Customer Kidnapped Captain");
            foundSpecificKidnapIncident = true;
        }
        if (input_string.includes("captain kidnapped customer")) {
            incidents.push("Captain Kidnapped Customer");
            foundSpecificKidnapIncident = true;
        }
        if (input_string.includes("held by law enforcement") || input_string.includes("held by law")) {
            incidents.push("Held By Law Enforcement");
            foundSpecificPhysicalIncident = true;
        }
        if (input_string.includes("held against will")) {
            incidents.push("Held Against Will");
            foundSpecificPhysicalIncident = true;
        }
        if (input_string.includes("physical attack")) {
            incidents.push("Physical Attack");
            foundSpecificPhysicalIncident = true;
        }
        if (input_string.includes("threats of physical harm")) {
            incidents.push("Threats of Physical Harm");
            foundSpecificPhysicalIncident = true;
        }


        if (!foundSpecificKidnapIncident && input_string.includes("kidnap")) {
            incidents.push("Kidnap");
        }


        const hasAccidentIncident = incidents.some(i => i.includes("Accident"));

        if (input_string.includes("driving under influence")) {
            incidents.push("Driving Under Influence");
        }
        if (input_string.includes("no seatbelt") || input_string.includes("no helmet") || input_string.includes("no seatbelt / helmet")) {
            incidents.push("No Seatbelt / Helmet");
        }

        if (!hasAccidentIncident && (input_string.includes("reckless driving") || input_string.includes("reckless"))) {
            incidents.push("Reckless Driving");
        }
        if (input_string.includes("sleepy") || input_string.includes("tired") || input_string.includes("sleepy / tired captain")) {
            incidents.push("Sleepy Captain");
        }

        if (input_string.includes("using phone") && !hasAccidentIncident) {
            incidents.push("Using Phone");
        }


        if (input_string.includes("medical emergency")) {
            incidents.push("Medical Emergency");
        }
        if (input_string.includes("unsafe / forced drop off") ||
            input_string.includes("unsafe drop off") ||
            input_string.includes("forced drop off") ||
            input_string.includes("unsafe / forced dropoff") ||
            input_string.includes("unsafe dropoff") ||
            input_string.includes("forced dropoff") ||
            input_string.includes("drop off not added")) {
            incidents.push("Forced Drop off");
        }
        if (input_string.includes("covid 19") || input_string.includes("covid19") || input_string.includes("covid-19")) {
            incidents.push("Covid-19");
        }

        let foundSpecificSubstanceIncident = false;

        if (input_string.includes("customer under influence")) {
            incidents.push("Customer Under Influence");
            foundSpecificSubstanceIncident = true;
        }
        if ((input_string.includes("selling") || input_string.includes("offering")) && input_string.includes("drugs")) {
            incidents.push("Selling Drugs");
            foundSpecificSubstanceIncident = true;
        }
        if (input_string.includes("transporting drugs")) {
            incidents.push("Transporting Drugs");
            foundSpecificSubstanceIncident = true;
        }


        let foundSpecificRobberyIncident = false;
        let foundSpecificTheftIncident = false;

        if (input_string.includes("armed robbery") || (input_string.includes("robbery") && input_string.includes("captain stole from customer"))) {
            incidents.push("Armed Robbery");
            foundSpecificRobberyIncident = true;
        }
        if (input_string.includes("theft") || input_string.includes("captain stole from customer")) {
            incidents.push("Theft");
            foundSpecificTheftIncident = true;
        }
        // Handle impostor incidents with priority for specific patterns
        if (input_string.includes("impostor / not specified captain") ||
            input_string.includes("not specified captain") ||
            (input_string.includes("impostor") && input_string.includes("captain"))) {
            incidents.push("Impostor Captain");
        }
        // Check for "cap" when not part of "captain" - treat as Impostor Captain
        else if (input_string.includes("cap") && !input_string.includes("captain")) {
            incidents.push("Impostor Captain");
        }
        else if (input_string.includes("not specified car") || (input_string.includes("impostor") && input_string.includes("car"))) {
            incidents.push("Impostor Car");
        }
        if (input_string.includes("unauthorized person in vehicle")) {
            incidents.push("Unauthorized Person in Vehicle");
        }


        if (incidents.length === 0) {
            incidents.push("Other SSOC Incident");
        }

        return incidents;
    }

    function convertCsvToIncidentFormat(csvText) {
        const lines = csvText.split('\n').filter(line => line.trim());


        const dataLines = lines.slice(1);


        const categoryIncidents = {
            'Sexual behavior': [],
            'Physical altercations': [],
            'Road safety': [],
            'Minor': [],
            'Others SSOC related': []
        };


        const othersIncidents = {
            ssoc: [],
            safetyBySupply: 0,
            rideBehavior: 0,
            notSSOCRelated: 0
        };


        for (let i = 0; i < dataLines.length; i++) {
            const line = dataLines[i];
            if (!line.trim()) continue;

            const fields = parseCsvLine(line);
            if (fields.length < 7) continue;

            const category = fields[4];
            const subCategory = fields[5];
            const comment = fields[6];


            if (comment.toLowerCase().includes('not ssoc related')) {
                othersIncidents.notSSOCRelated++;
                continue;
            }


            if (category.toLowerCase() === 'safety' && subCategory.toLowerCase() !== 'ssoc') {
                othersIncidents.safetyBySupply++;
                continue;
            }


            if (subCategory.toLowerCase() === 'ride_behavior' || subCategory.toLowerCase() === 'ride behavior') {
                othersIncidents.rideBehavior++;
                continue;
            }


            if (subCategory.toLowerCase() === 're-training completed' || subCategory.toLowerCase() === 're training completed') {
                continue;
            }


            if (category.toLowerCase() === 'safety' && subCategory.toLowerCase() === 'ssoc') {
                const allIncidents = parseIndividualIncidents(comment);


                for (const incidentType of allIncidents) {
                    const mainCategory = getMainCategory(incidentType, comment);

                    if (mainCategory === 'Others SSOC related') {
                        othersIncidents.ssoc.push(incidentType);
                    } else {
                        categoryIncidents[mainCategory].push(incidentType);
                    }
                }
            }
        }


        let result = '';
        const orderedCategories = [
            'Sexual behavior',
            'Physical altercations',
            'Road safety',
            'Minor'
        ];


        for (let i = 0; i < 4; i++) {
            const mainCategory = orderedCategories[i];
            const incidents = categoryIncidents[mainCategory];

            if (incidents.length > 0) {

                const incidentCounts = {};
                incidents.forEach(incident => {
                    incidentCounts[incident] = (incidentCounts[incident] || 0) + 1;
                });


                const incidentsList = Object.entries(incidentCounts)
                    .map(([incident, count]) => `${count}, ${incident}`)
                    .join('), (');

                result += `${i + 1}- ${mainCategory}: (${incidentsList})\n`;
            } else {

                result += `${i + 1}- ${mainCategory}: (0, Clear)\n`;
            }
        }


        const hasOthers = othersIncidents.ssoc.length > 0 ||
            othersIncidents.safetyBySupply > 0 ||
            othersIncidents.rideBehavior > 0 ||
            othersIncidents.notSSOCRelated > 0;

        if (hasOthers) {
            result += formatOthersCategory(othersIncidents);
        }

        return result.trim();
    }

    function formatOthersCategory(othersIncidents) {
        const parts = [];


        if (othersIncidents.ssoc.length > 0) {
            const ssocCounts = {};
            othersIncidents.ssoc.forEach(incident => {
                ssocCounts[incident] = (ssocCounts[incident] || 0) + 1;
            });

            for (const [incident, count] of Object.entries(ssocCounts)) {
                parts.push(`${count}, ${incident}`);
            }
        }


        if (othersIncidents.safetyBySupply > 0) {
            parts.push(`${othersIncidents.safetyBySupply}, Safety by supply`);
        }


        if (othersIncidents.rideBehavior > 0) {
            parts.push(`${othersIncidents.rideBehavior}, ride_behavior, re-training completed`);
        }


        if (othersIncidents.notSSOCRelated > 0) {
            if (parts.length === 0) {

                return '5- Others: Not SSOC related\n';
            } else {

                const formattedParts = parts.map(part => `(${part})`).join(', ');
                return `5- Others: ${formattedParts} & others not SSOC related\n`;
            }
        } else {

            const formattedParts = parts.map(part => `(${part})`).join(', ');
            return `5- Others: ${formattedParts}\n`;
        }
    }

    function getMainCategory(incidentType, originalComment) {
        const comment = originalComment.toLowerCase();


        if (comment.includes('minor')) {
            return 'Minor';
        }


        if (incidentType.includes('Accident') ||
            incidentType === 'No Seatbelt / Helmet' ||
            incidentType === 'Reckless Driving' ||
            incidentType === 'Sleepy Captain' ||
            incidentType === 'Using Phone' ||
            (incidentType === 'Driving Under Influence' && !incidentType.includes(' VIC'))) {
            return 'Road safety';
        }


        if (incidentType === 'Customer Touched Captain' ||
            incidentType === 'Captain Touched Customer' ||
            incidentType === 'Inappropriate Talk' ||
            incidentType === 'Staring' ||
            incidentType === 'Other Sexual Physical Contact' ||
            incidentType === 'Sexual Harassment' ||
            incidentType === 'Stalking' ||
            incidentType === 'Contact After Ride') {
            return 'Sexual behavior';
        }


        if (incidentType === 'Customer Kidnapped Captain' ||
            incidentType === 'Captain Kidnapped Customer' ||
            incidentType === 'Kidnap' ||
            incidentType === 'Held Against Will' ||
            incidentType === 'Physical Attack' ||
            incidentType === 'Threats of Physical Harm') {
            return 'Physical altercations';
        }


        // Handle Driving Under Influence VIC as Others
        if (incidentType.includes('Driving Under Influence') && incidentType.includes(' VIC')) {
            return 'Others SSOC related';
        }

        // Return "Others SSOC related" for any other incident types
        return 'Others SSOC related';
    }

    function parseCsvLine(line) {
        const fields = [];
        let currentField = '';
        let inQuotes = false;
        let i = 0;

        while (i < line.length) {
            const char = line[i];

            if (char === '"') {
                if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {

                    currentField += '"';
                    i += 2;
                    continue;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (char === ',' && !inQuotes) {
                fields.push(currentField);
                currentField = '';
            } else {
                currentField += char;
            }
            i++;
        }


        fields.push(currentField);

        return fields;
    }

    function processBlockHistory(text) {

        const lines = text.split('\n').filter(line => line.trim());


        let csv = '"date","user","captain status","revised status","category","sub-category","comment","unblocking"\n';


        const uniqueEntries = new Map();


        const safetyOtherEntries = [];


        const rideBehaviorEntries = [];


        const retrainingEntries = [];


        let hasNonMatchingEntries = false;


        function extractIds(comment) {
            const bIdMatch = comment.match(/B\.\s*ID:\s*(\d+)/);
            const tIdMatch = comment.match(/T\.\s*ID:\s*(\d+)/);
            return bIdMatch && tIdMatch ? `${bIdMatch[1]}-${tIdMatch[1]}` : null;
        }


        function extractAllIds(comment) {
            const ids = [];
            const bIdMatches = comment.matchAll(/B\.\s*ID:\s*(\d+)/g);
            const tIdMatches = comment.matchAll(/T\.\s*ID:\s*(\d+)/g);

            for (const match of bIdMatches) {
                ids.push(match[1]);
            }
            for (const match of tIdMatches) {
                ids.push(match[1]);
            }

            return [...new Set(ids)];
        }


        function parseDate(dateStr) {
            // Handle dates like "Thu Jan 9, 2025 10:47" or "Sun July 28, 2024 18:20"
            const parts = dateStr.split(' ');

            if (parts.length === 5) {
                // Format: DayName Month Day, Year Time
                const [dayName, month, dayWithComma, year, time] = parts;
                const day = dayWithComma.replace(',', '');
                const [hours, minutes] = time.split(':');
                return new Date(`${month} ${day} ${year} ${hours}:${minutes}`);
            } else if (parts.length === 4) {
                // Format: DayName Month Day Time (assuming current year or missing year)
                const [dayName, month, day, time] = parts;
                const [hours, minutes] = time.split(':');
                const currentYear = new Date().getFullYear();
                return new Date(`${month} ${day} ${currentYear} ${hours}:${minutes}`);
            } else {
                // Fallback to original logic
                const [dayName, month, day, year, time] = parts;
                const [hours, minutes] = time.split(':');
                return new Date(`${month} ${day} ${year} ${hours}:${minutes}`);
            }
        }


        function normalizeSubCategory(subCat) {
            return subCat.toLowerCase().replace(/[-_]/g, ' ').trim();
        }


        function findSharedKeywords(comment1, comment2) {

            const excludeWords = new Set([
                'captain', 'id', 'aic', 'safety', 'security', 'operations', 'operation',
                'received', 'verbal', 'warning', 'yes', 'no', 'push', 'sent', 'during',
                'the', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'by',
                'from', 'up', 'about', 'into', 'through', 'during', 'before', 'after',
                'above', 'below', 'between', 'among', 'through', 'during', 'before',
                'correction', 'educate', 'education'
            ]);


            const extractKeywords = (text) => {
                return text.toLowerCase()
                    .replace(/[^\w\s]/g, ' ')
                    .split(/\s+/)
                    .filter(word =>
                        word.length >= 3 &&
                        !excludeWords.has(word) &&
                        !/^\d+$/.test(word)
                    );
            };

            const keywords1 = new Set(extractKeywords(comment1));
            const keywords2 = new Set(extractKeywords(comment2));


            const shared = [];
            for (const keyword of keywords1) {
                if (keywords2.has(keyword)) {
                    shared.push(keyword);
                }
            }

            return shared;
        }


        function findCorrectionTarget(correctionEntry, existingEntries) {
            const candidates = [];

            for (const existing of existingEntries.values()) {

                if (existing.hasCorrection) continue;

                let score = 0;


                const daysDiff = Math.abs(correctionEntry.timestamp - existing.timestamp) / (1000 * 60 * 60 * 24);
                if (daysDiff <= 30) score += 2;


                if (existing.category === correctionEntry.category) score += 1;
                if (existing.subCategory === correctionEntry.subCategory) score += 1;


                const correctionIds = extractAllIds(correctionEntry.comment);
                const existingIds = extractAllIds(existing.comment);
                const sharedIds = correctionIds.filter(id => existingIds.includes(id));
                if (sharedIds.length > 0) score += 3;


                if (existing.user === correctionEntry.user) score += 1;


                const sharedKeywords = findSharedKeywords(existing.comment, correctionEntry.comment);
                if (sharedKeywords.length >= 2) score += 2;

                if (score >= 4) {
                    candidates.push({ entry: existing, score, ids: extractIds(existing.comment) });
                }
            }


            return candidates.length > 0 ?
                candidates.sort((a, b) => b.score - a.score)[0] :
                null;
        }


        const allSsocEntries = [];


        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();


            if (line === 'BLOCK HISTORY' ||
                line === 'Date\tUser\tCaptain Status\tCategory\tSub-Category\tComment\tUnblocking' ||
                line === 'Date\tUser\tCaptain Status\tRevised Status\tCategory\tSub-Category\tComment\tUnblocking' ||
                line === 'Previous\tRevised' ||
                line.includes('Previous\tRevised') ||
                !line.includes('\t')) {
                continue;
            }


            const parts = line.split('\t').map(part => part.trim());


            if (parts.length < 4) continue;


            const date = parts[0] || '';
            const user = parts[1] || '';
            const captainStatus = parts[2] || '';
            let revisedStatus = '';
            let category = '';
            let subCategory = '';
            let comment = '';
            let unblocking = '';

            // Check if we have the standard 8-column format with revised status
            if (parts.length >= 8) {
                // Format: Date | User | Captain Status | Revised Status | Category | Sub-Category | Comment | Unblocking
                revisedStatus = parts[3] || '';
                category = parts[4] || '';
                subCategory = parts[5] || '';
                comment = parts[6] || '';
                unblocking = parts[7] || '';
            } else if (parts.length >= 7 && (parts[3] === 'Active' || parts[3] === 'Temporary Blocked' || parts[3] === 'Permanent Blocked' ||
                parts[3] === 'Invalid' || parts[3] === 'Temporary Block (24 hours)')) {
                // Format with revised status: Date | User | Captain Status | Revised Status | Category | Sub-Category | Comment
                revisedStatus = parts[3];
                category = parts[4] || '';
                subCategory = parts[5] || '';
                comment = parts[6] || '';
                unblocking = parts[7] || '';
            } else {
                // Legacy format without revised status: Date | User | Captain Status | Category | Sub-Category | Comment | Unblocking
                category = parts[3] || '';
                subCategory = parts[4] || '';
                comment = parts[5] || '';
                unblocking = parts[6] || '';
            }


            const entry = {
                date,
                user,
                captainStatus,
                revisedStatus,
                category,
                subCategory,
                comment,
                unblocking,
                timestamp: parseDate(date),
                hasCorrection: comment.toLowerCase().includes('correction')
            };

            const normalizedSubCat = normalizeSubCategory(subCategory);


            if (subCategory.toLowerCase() !== 'ssoc' &&
                !(category.toLowerCase() === 'safety' && subCategory.toLowerCase() !== 'ssoc') &&
                normalizedSubCat !== 'ride behavior' &&
                normalizedSubCat !== 're training completed') {
                hasNonMatchingEntries = true;
            }


            if (normalizedSubCat === 'ride behavior') {
                rideBehaviorEntries.push(entry);
            } else if (normalizedSubCat === 're training completed') {
                retrainingEntries.push(entry);
            } else {
                if (category.toLowerCase() === 'safety' && subCategory.toLowerCase() !== 'ssoc') {
                    safetyOtherEntries.push(entry);
                    continue;
                }

                if (subCategory.toLowerCase() === 'ssoc') {
                    allSsocEntries.push(entry);
                }
            }
        }



        for (const entry of allSsocEntries) {
            if (!entry.hasCorrection) {
                const ids = extractIds(entry.comment);
                if (!ids) continue;

                if (uniqueEntries.has(ids)) {
                    const existingEntry = uniqueEntries.get(ids);

                    if (!existingEntry.hasCorrection) {
                        if (entry.timestamp >= existingEntry.timestamp) {
                            uniqueEntries.set(ids, entry);
                        }
                    }
                } else {
                    uniqueEntries.set(ids, entry);
                }
            }
        }


        const correctionEntries = allSsocEntries.filter(entry => entry.hasCorrection);
        const uniqueCorrections = new Map();


        for (const correction of correctionEntries) {
            const ids = extractIds(correction.comment);
            if (!ids) continue;

            if (uniqueCorrections.has(ids)) {
                const existing = uniqueCorrections.get(ids);

                if (correction.timestamp >= existing.timestamp) {
                    uniqueCorrections.set(ids, correction);
                }
            } else {
                uniqueCorrections.set(ids, correction);
            }
        }


        for (const correction of uniqueCorrections.values()) {
            const correctionTarget = findCorrectionTarget(correction, uniqueEntries);
            if (correctionTarget) {

                uniqueEntries.delete(correctionTarget.ids);
                const correctionIds = extractIds(correction.comment);
                if (correctionIds) {
                    uniqueEntries.set(correctionIds, correction);
                }
            } else {

                const ids = extractIds(correction.comment);
                if (ids) {
                    uniqueEntries.set(ids, correction);
                }
            }
        }


        const pairedEntries = [];
        const usedRetrainingIndexes = new Set();

        rideBehaviorEntries.forEach(rbEntry => {

            const matchingRetrainingIndex = retrainingEntries.findIndex((rtEntry, index) => {
                if (usedRetrainingIndexes.has(index)) return false;


                const timeDiff = Math.abs(rtEntry.timestamp - rbEntry.timestamp);
                const hoursDiff = timeDiff / (1000 * 60 * 60);

                return rtEntry.user.toLowerCase() === rbEntry.user.toLowerCase() &&
                    hoursDiff <= 24;
            });

            if (matchingRetrainingIndex !== -1) {
                const retrainingEntry = retrainingEntries[matchingRetrainingIndex];
                usedRetrainingIndexes.add(matchingRetrainingIndex);


                if (rbEntry.timestamp <= retrainingEntry.timestamp) {
                    pairedEntries.push(rbEntry);
                    pairedEntries.push(retrainingEntry);
                } else {
                    pairedEntries.push(retrainingEntry);
                    pairedEntries.push(rbEntry);
                }
            } else {

                pairedEntries.push(rbEntry);
            }
        });


        retrainingEntries.forEach((rtEntry, index) => {
            if (!usedRetrainingIndexes.has(index)) {
                pairedEntries.push(rtEntry);
            }
        });


        const escapeCsvField = (value) => {
            const str = (value ?? '').toString().toLowerCase();
            // RFC 4180: escape embedded quotes by doubling them
            const escaped = str.replace(/"/g, '""');
            return `"${escaped}"`;
        };

        const entryToCsv = (entry) => [
            escapeCsvField(entry.date),
            escapeCsvField(entry.user),
            escapeCsvField(entry.captainStatus),
            escapeCsvField(entry.revisedStatus),
            escapeCsvField(entry.category),
            escapeCsvField(entry.subCategory),
            escapeCsvField(entry.comment),
            escapeCsvField(entry.unblocking)
        ].join(',') + '\n';


        for (const entry of uniqueEntries.values()) {
            csv += entryToCsv(entry);
        }


        for (const entry of safetyOtherEntries) {
            csv += entryToCsv(entry);
        }


        for (const entry of pairedEntries) {
            csv += entryToCsv(entry);
        }


        if (hasNonMatchingEntries) {
            csv += '"not ssoc related","not ssoc related","not ssoc related","not ssoc related","not ssoc related","not ssoc related","not ssoc related",""\n';
        }

        return csv;
    }

    function createBlockHistoryWindow() {
        const overlay = document.createElement('div');
        overlay.className = 'text-window-overlay';

        const windowPane = document.createElement('div');
        windowPane.className = 'text-window-pane';

        const header = document.createElement('div');
        header.className = 'text-window-header';

        const title = document.createElement('div');
        title.className = 'text-window-title';
        title.textContent = 'Block History to CSV';

        const closeButton = document.createElement('button');
        closeButton.className = 'text-window-close';
        closeButton.innerHTML = '×';
        closeButton.onclick = () => {
            overlay.classList.remove('show');
            windowPane.classList.remove('show');
        };

        const textarea = document.createElement('textarea');
        textarea.className = 'text-window-textarea';
        textarea.placeholder = 'Paste block history text here...';

        // Create a button container for multiple options
        const buttonContainer = document.createElement('div');
        buttonContainer.style.cssText = `
            display: flex;
            gap: 10px;
            margin-top: 10px;
            flex-wrap: wrap;
        `;

        const transformButton = document.createElement('button');
        transformButton.className = 'text-window-transform-button';
        transformButton.textContent = 'Convert to CSV';
        transformButton.onclick = () => {
            const inputText = textarea.value;
            const csvText = processBlockHistory(inputText);
            textarea.value = csvText;
            navigator.clipboard.writeText(csvText)
                .then(() => {
                    showToast('CSV copied to clipboard!');
                })
                .catch(err => {
                    console.error('Failed to copy CSV:', err);
                    showToast('Error copying CSV to clipboard');
                });
        };

        const captainCsvButton = document.createElement('button');
        captainCsvButton.className = 'text-window-transform-button';
        captainCsvButton.textContent = 'Load Captain CSV';
        captainCsvButton.style.backgroundColor = '#4CAF50';
        captainCsvButton.onclick = () => {
            if (lastCaptainCsv && lastCaptainCsv.trim()) {
                textarea.value = lastCaptainCsv;
                showToast('Captain CSV loaded!');
            } else {
                showToast('No Captain CSV available. Process a captain profile first.');
            }
        };

        const customerCsvButton = document.createElement('button');
        customerCsvButton.className = 'text-window-transform-button';
        customerCsvButton.textContent = 'Load Customer CSV';
        customerCsvButton.style.backgroundColor = '#2196F3';
        customerCsvButton.onclick = () => {
            if (lastCustomerCsv && lastCustomerCsv.trim()) {
                textarea.value = lastCustomerCsv;
                showToast('Customer CSV loaded!');
            } else {
                showToast('No Customer CSV available. Process a customer profile first.');
            }
        };

        buttonContainer.appendChild(transformButton);
        buttonContainer.appendChild(captainCsvButton);
        buttonContainer.appendChild(customerCsvButton);

        header.appendChild(title);
        header.appendChild(closeButton);
        windowPane.appendChild(header);
        windowPane.appendChild(textarea);
        windowPane.appendChild(buttonContainer);

        overlay.appendChild(windowPane);
        document.body.appendChild(overlay);

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.classList.remove('show');
                windowPane.classList.remove('show');
            }
        });

        return {
            overlay,
            windowPane,
            textarea
        };
    }



    let blockHistoryWindow = null;

    function showBlockHistoryWindow() {
        if (!blockHistoryWindow) {
            blockHistoryWindow = createBlockHistoryWindow();
        }
        blockHistoryWindow.overlay.classList.add('show');
        blockHistoryWindow.windowPane.classList.add('show');
        blockHistoryWindow.textarea.focus();
    }







    function attachBlockHistoryToZendeskLogo() {
        const brandLogo = document.querySelector('div[data-test-id="zendesk_icon"][data-garden-id="chrome.brandmark_nav_list_item"]');
        if (!brandLogo) return;
        if (brandLogo.dataset.blockHistoryAttached === 'true') return;

        brandLogo.style.cursor = 'pointer';
        brandLogo.title = 'Left-click: PQMS Dashboard | Right-click: Block History to CSV';
        brandLogo.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            
            // Check if this is a right-click or middle-click for Block History
            if (event.button === 2 || event.button === 1) {
                // Right-click or middle-click: Show Block History Window
                showBlockHistoryWindow();
            } else {
                // Left-click: Open PQMS Dashboard
                togglePQMSDashboard();
            }

            // Smart loading: prefer customer CSV if available, otherwise captain CSV
            let csvToLoad = '';
            let csvType = '';

            if (lastCustomerCsv && lastCustomerCsv.trim()) {
                csvToLoad = lastCustomerCsv;
                csvType = 'Customer';
            } else if (lastCaptainCsv && lastCaptainCsv.trim()) {
                csvToLoad = lastCaptainCsv;
                csvType = 'Captain';
            }

            if (csvToLoad) {
                if (blockHistoryWindow && blockHistoryWindow.textarea) {
                    blockHistoryWindow.textarea.value = csvToLoad;
                }
                showToast(`${csvType} CSV loaded! Use the buttons to switch between Captain/Customer CSV.`);
            } else {
                if (blockHistoryWindow && blockHistoryWindow.textarea) {
                    blockHistoryWindow.textarea.value = 'No CSV found. Process captain/customer profiles first, or paste block history and click Convert to CSV.';
                }
                showToast('No CSV found. Process captain/customer profiles first.');
            }
        }, true);
        brandLogo.dataset.blockHistoryAttached = 'true';
    }

    function createSeparator() {
        const separator = document.createElement('li');
        separator.className = 'nav-separator';
        return separator;
    }

    function tryAddButtons() {

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


            const fieldOpsButton = createFieldOpsButton();
            const fieldOpsButtonEl = fieldOpsButton.querySelector('button');
            fieldOpsButtonEl.addEventListener('click', () => {
                console.log('🖱️ Autofill button clicked!');

                // Quick debug: Check what ticket-related elements exist
                const allElements = document.querySelectorAll('*[data-test-id*="ticket"], *[data-tracking-id*="ticket"]');
                console.log(`🎯 All ticket elements found: ${allElements.length}`);
                if (allElements.length > 0) {
                    console.log('📝 Sample ticket elements:', Array.from(allElements).slice(0, 5).map(el => ({
                        tagName: el.tagName,
                        testId: el.getAttribute('data-test-id'),
                        trackingId: el.getAttribute('data-tracking-id'),
                        className: el.className.substring(0, 50)
                    })));
                }

                updateAllFields();
            });
            customSection.appendChild(fieldOpsButton);



            // CSV button removed; Zendesk logo now acts as the trigger

            navList.appendChild(customSection);

            // Add PQMS button (below the eye button) if it doesn't exist
            if (!pqmsButton) {
                pqmsButton = createPQMSButton();
                const pqmsBtn = pqmsButton.querySelector('button');
                pqmsBtn.addEventListener('click', showPQMSStatusMenu);
                navList.appendChild(pqmsButton);
            }

            return true;
        }
        return false;
    }

    let addLinkButtonDuplicated = false;
    
    // Set SSOC Reason to "Escalated to Uber"
    async function setSSOCReasonToEscalated(container) {
        const fields = container.querySelectorAll('[class*="field"], [data-test-id*="field"], div:has(label)');
        let fieldFound = false;

        for (const field of fields) {
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
        return true; // Return true to not fail the overall process
    }

    // Set Action Taken - Consumer to "Resolved - Escalated to Uber"
    async function setActionTakenConsumer(container) {
        const fields = container.querySelectorAll('[class*="field"], [data-test-id*="field"], div:has(label)');
        let fieldFound = false;

        for (const field of fields) {
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
        return true; // Return true to not fail the overall process
    }

    // Enhanced dropdown setter with better debugging and fallback options
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

    // Set SSOC incident source based on subject (similar to Parent Ticket Source logic)
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

        // Determine the appropriate SSOC incident source value based on subject content
        let targetValue = 'Voice Care'; // Default value
        let ruleMatched = 'Default';

        const subjectLower = subjectText.toLowerCase();

        // Check for "dispute" -> Customer Email
        if (subjectLower.includes('dispute')) {
            targetValue = 'Customer Email';
            ruleMatched = 'Dispute';
        }

        console.log(`📋 Subject matched rule "${ruleMatched}": ${subjectText}`);
        console.log(`🎯 Target SSOC incident source: ${targetValue}`);

        // Find the SSOC incident source field in the current container
        const fields = container.querySelectorAll('[class*="field"], [data-test-id*="field"], div:has(label)');
        let ssocIncidentSourceField = null;

        for (const field of fields) {
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

        // Check if already set to the target value
        const currentValue = ssocIncidentSourceField.querySelector('[title]')?.getAttribute('title') ||
                            ssocIncidentSourceField.querySelector('.StyledEllipsis-sc-1u4umy-0')?.textContent.trim() ||
                            ssocIncidentSourceField.querySelector('[data-garden-id="typography.ellipsis"]')?.textContent.trim();

        if (currentValue === targetValue) {
            console.log(`💡 SSOC incident source already set to "${targetValue}"`);
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

    // Process Template T autofill for a single form
    async function processTemplateTAutofill(form) {
        if (!form || !form.isConnected || observerDisconnected) return;

        console.log('🔄 Starting Template T autofill process...');

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

            console.log('🎉 Template T autofill process completed');
            return true;
        } catch (error) {
            console.error('❌ Error during Template T autofill process:', error);
            return false;
        }
    }

    // Extract current Reason field value
    function getCurrentReasonValue() {
        let allForms = document.querySelectorAll('section.grid-ticket-fields-panel');
        
        // If no forms found with the primary selector, try fallback selectors
        if (allForms.length === 0) {
            const formSelectors = [
                'section[class*="ticket-fields"]',
                '[data-test-id*="TicketFieldsPane"]',
                'div[data-test-id="ticket-fields"][data-tracking-id="ticket-fields"]',
                '.ticket_fields'
            ];
            
            for (const selector of formSelectors) {
                allForms = document.querySelectorAll(selector);
                if (allForms.length > 0) break;
            }
        }
        
        for (const form of allForms) {
            const fields = form.querySelectorAll('[class*="field"], [data-test-id*="field"], div:has(label)');
            for (const field of fields) {
                const label = field.querySelector('label');
                if (label && (label.textContent.trim() === 'Reason (Quality/GO/Billing)*' ||label.textContent.trim() === 'Reason (Quality/GO/Billing)')) {
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
        let allForms = document.querySelectorAll('section.grid-ticket-fields-panel');
        
        // If no forms found with the primary selector, try fallback selectors
        if (allForms.length === 0) {
            const formSelectors = [
                'section[class*="ticket-fields"]',
                '[data-test-id*="TicketFieldsPane"]',
                'div[data-test-id="ticket-fields"][data-tracking-id="ticket-fields"]',
                '.ticket_fields'
            ];
            
            for (const selector of formSelectors) {
                allForms = document.querySelectorAll(selector);
                if (allForms.length > 0) break;
            }
        }
        
        for (const form of allForms) {
            const fields = form.querySelectorAll('[class*="field"], [data-test-id*="field"], div:has(label)');
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

    // Create and show tiny text input next to T button
    function createTextInput(tButton) {
        // Remove any existing input
        const existingInput = document.querySelector('.template-t-text-input');
        if (existingInput) {
            existingInput.remove();
        }

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'template-t-text-input';
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

        // Position relative to T button
        const tButtonRect = tButton.getBoundingClientRect();
        input.style.position = 'fixed';
        input.style.left = (tButtonRect.right + 5) + 'px';
        input.style.top = (tButtonRect.top + (tButtonRect.height - 20) / 2) + 'px';

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
        const input = document.querySelector('.template-t-text-input');
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
        
        console.log(`📋 Current Reason: "${reasonValue}"`);
        console.log(`📋 Current SSOC incident source: "${ssocIncidentSource}"`);
        
        // Parse incident type from reason
        const incidentType = parseIncidentTypeFromReason(reasonValue);
        
        // Determine phone source
        const phoneSource = determinePhoneSource(ssocIncidentSource);
        
        // Build the template text
        const incidentTypeLine = incidentType ? `Incident Type: ${incidentType}\u00A0` : 'Incident Type:\u00A0';
        const phoneSourceLine = `Is the Source of incident CareemInboundPhone :- ${phoneSource}\u00A0`;
        const customerLanguageLine = customerLanguage ? `Customer Language: ${customerLanguage}\u00A0` : 'Customer Language:\u00A0';
        const customerWordsLine = customerWords ? `Customer Words: ${customerWords}\u00A0` : 'Customer Words:\u00A0';
        
        const templateText = `${incidentTypeLine}
Description:\u00A0Customer is complaining about,  
${phoneSourceLine} 
${customerLanguageLine} 
${customerWordsLine}`;

        console.log('✅ Generated template text:');
        console.log(templateText);
        
        return templateText;
    }

    function copyTemplateT(buttonElement) {
        console.log('🚀 Template T clicked - showing text input');
        
        // Create and show the text input
        const textInput = createTextInput(buttonElement);
        
        // Wait for text to be pasted
        const handlePaste = async (event) => {
            // Small delay to ensure paste is processed
            setTimeout(async () => {
                const pastedText = textInput.value.trim();
                console.log(`📝 Text pasted: "${pastedText}"`);
                
                // Remove the text input
                removeTextInput();
                
                if (pastedText) {
                    // Detect language based on first word
                    const customerLanguage = detectLanguage(pastedText);
                    console.log(`🌍 Customer language: ${customerLanguage}`);
                    
                    // Start the autofill and template generation process
                    await performTemplateTOperations(pastedText, customerLanguage);
                } else {
                    // If no text was pasted, continue with empty values
                    await performTemplateTOperations('', '');
                }
            }, 10);
        };
        
        // Handle various ways text might be entered
        textInput.addEventListener('paste', handlePaste);
        textInput.addEventListener('input', (event) => {
            // If text is typed/entered, trigger the same process after a short delay
            clearTimeout(textInput.inputTimer);
            textInput.inputTimer = setTimeout(async () => {
                const enteredText = textInput.value.trim();
                if (enteredText) {
                    console.log(`⌨️ Text entered: "${enteredText}"`);
                    removeTextInput();
                    const customerLanguage = detectLanguage(enteredText);
                    await performTemplateTOperations(enteredText, customerLanguage);
                }
            }, 500); // Wait 500ms after user stops typing
        });
        
        // Handle Enter key
        textInput.addEventListener('keydown', async (event) => {
            if (event.key === 'Enter') {
                const enteredText = textInput.value.trim();
                console.log(`↵ Enter pressed with text: "${enteredText}"`);
                removeTextInput();
                const customerLanguage = detectLanguage(enteredText);
                await performTemplateTOperations(enteredText, customerLanguage);
            } else if (event.key === 'Escape') {
                // Cancel operation
                console.log('❌ Template T operation cancelled');
                removeTextInput();
            }
        });
        
        // Auto-hide input after 10 seconds if no action
        setTimeout(() => {
            if (document.querySelector('.template-t-text-input')) {
                console.log('⏰ Text input timeout - continuing with empty values');
                removeTextInput();
                performTemplateTOperations('', '');
            }
        }, 10000);
    }

    // Perform the actual autofill and template generation operations
    async function performTemplateTOperations(customerWords, customerLanguage) {
        console.log('🚀 Starting Template T autofill and template generation');
        console.log(`📝 Customer Words: "${customerWords}"`);
        console.log(`🌍 Customer Language: "${customerLanguage}"`);
        
        // First, perform autofill operations
        let allForms = getCachedElements('section.grid-ticket-fields-panel', 1000);
        
        // If no forms found with the primary selector, try fallback selectors
        if (allForms.length === 0) {
            const formSelectors = [
                'section[class*="ticket-fields"]',
                '[data-test-id*="TicketFieldsPane"]',
                'div[data-test-id="ticket-fields"][data-tracking-id="ticket-fields"]',
                '.ticket_fields'
            ];
            
            for (const selector of formSelectors) {
                allForms = document.querySelectorAll(selector);
                if (allForms.length > 0) {
                    console.log(`📋 Found forms using fallback selector: ${selector}`);
                    break;
                }
            }
        }
        
        console.log(`📋 Found ${allForms.length} forms to process for Template T autofill`);

        if (allForms.length > 0) {
            // Process forms one at a time with small delays
            for (let i = 0; i < allForms.length; i++) {
                try {
                    await processTemplateTAutofill(allForms[i]);
                    // Small delay between forms
                    if (i < allForms.length - 1) {
                        await new Promise(resolve => setTimeout(resolve, 100));
                    }
                } catch (e) {
                    console.warn('Error processing Template T autofill for form:', e);
                }
            }
            
            // Wait a bit more for the UI to update after autofill
            await new Promise(resolve => setTimeout(resolve, 200));
        } else {
            console.log('⚠️ No forms found for Template T autofill');
        }

        // Now generate dynamic template text based on current field values and customer input
        const templateText = generateDynamicTemplateText(customerWords, customerLanguage);

        // Copy to clipboard
        navigator.clipboard.writeText(templateText)
            .then(() => {
                showToast('Template copied to clipboard!');
                
                // After successful clipboard copy, click the "take it" button
                setTimeout(() => {
                    clickTakeItButton();
                }, 300); // Small delay to ensure clipboard operation completes
            })
            .catch(err => {
                console.error('Failed to copy text:', err);
                showToast('Error copying to clipboard');
                
                // Even if clipboard fails, still try to click "take it" button
                setTimeout(() => {
                    clickTakeItButton();
                }, 300);
            });
    }

    // Function to find and click the "take it" button
    function clickTakeItButton() {
        console.log('🎯 Looking for "take it" button...');
        
        // Try multiple selectors to find the "take it" button
        const selectors = [
            'button[data-test-id="assignee-field-take-it-button"]',
            'button:contains("take it")',
            '.bCIuZx', // Class from the HTML
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
                    showToast('Ticket assigned to you!');
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
      
      function setRequesterToAgentName() {
        return new Promise((resolve) => {
            try {
                console.log('🔄 Setting requester to agent name:', username);
                
                if (!username || !username.trim()) {
                    console.log('⚠️ No agent name available, skipping requester update');
                    resolve(false);
                    return;
                }

                // Find the requester field
                const requesterField = document.querySelector('[data-test-id="ticket-system-field-requester-select"]');
                if (!requesterField) {
                    console.log('⚠️ Requester field not found');
                    resolve(false);
                    return;
                }

                // Find the input element within the requester field
                const requesterInput = requesterField.querySelector('input[data-garden-id="forms.input"]');
                if (!requesterInput) {
                    console.log('⚠️ Requester input not found');
                    resolve(false);
                    return;
                }

                // Clear and focus the input, then set the full name at once
                requesterInput.value = '';
                requesterInput.focus();
                requesterInput.value = username;
                
                // Trigger input events to notify React
                const inputEvent = new Event('input', { bubbles: true });
                const changeEvent = new Event('change', { bubbles: true });
                
                requesterInput.dispatchEvent(inputEvent);
                requesterInput.dispatchEvent(changeEvent);

                // Try to access React's internal props and use proper onChange handler if available
                const key = Object.keys(requesterInput).find(key => key.startsWith('__reactProps$'));
                if (key) {
                    const props = requesterInput[key];
                    if (props.onChange) {
                        const syntheticEvent = {
                            target: requesterInput,
                            currentTarget: requesterInput,
                            type: 'change',
                            bubbles: true,
                            cancelable: true,
                            preventDefault: () => { },
                            stopPropagation: () => { },
                            persist: () => { }
                        };
                        props.onChange(syntheticEvent);
                    }
                }

                console.log('📝 Name entered, waiting for user profile dropdown to appear...');
                
                // Wait 1.5 seconds for the dropdown to appear, then try selection methods
                setTimeout(() => {
                    console.log('🔍 Attempting to select profile from dropdown...');
                    
                    // First, check if dropdown is visible
                    const dropdownMenu = document.querySelector('[data-test-id="ticket-system-field-requester-menu"]') ||
                                        document.querySelector('[role="listbox"]') ||
                                        document.querySelector('.StyledMenu-sc-lzt5u6-0');
                    
                    if (dropdownMenu) {
                        console.log('✅ Dropdown found, attempting to click first option');
                        
                        // Try to find and click the first option
                        const options = dropdownMenu.querySelectorAll('[role="option"]') ||
                                       dropdownMenu.querySelectorAll('li') ||
                                       dropdownMenu.querySelectorAll('[data-test-id*="option"]');
                        
                        if (options && options.length > 0) {
                            console.log(`🎯 Found ${options.length} option(s), clicking first one`);
                            const firstOption = options[0];
                            console.log('📝 Option text:', firstOption.textContent?.trim());
                            
                            // Click the first option
                            firstOption.click();
                            
                            console.log('✅ Profile option clicked');
                            resolve(true);
                            return;
                        }
                    }
                    
                    console.log('⚠️ Dropdown not found or no options, trying keyboard methods...');
                    
                    // Fallback: Try Arrow Down + Enter
                    const arrowDownEvent = new KeyboardEvent('keydown', {
                        key: 'ArrowDown',
                        code: 'ArrowDown',
                        keyCode: 40,
                        which: 40,
                        bubbles: true,
                        cancelable: true
                    });
                    
                    requesterInput.dispatchEvent(arrowDownEvent);
                    
                    // Wait a moment then press Enter
                    setTimeout(() => {
                        const enterKeyDown = new KeyboardEvent('keydown', {
                            key: 'Enter',
                            code: 'Enter',
                            keyCode: 13,
                            which: 13,
                            bubbles: true,
                            cancelable: true
                        });
                        
                        requesterInput.dispatchEvent(enterKeyDown);
                        console.log('⌨️ Arrow Down + Enter attempted');
                        resolve(true);
                    }, 200);
                    
                }, 1500); // Wait 1.5 seconds instead of 3

            } catch (error) {
                console.error('❌ Error setting requester field:', error);
                resolve(false);
            }
        });
    }

    function setAssigneeToAgentName() {
        return new Promise((resolve) => {
            try {
                console.log('🔄 Setting assignee to agent name:', username);
                
                if (!username || !username.trim()) {
                    console.log('⚠️ No agent name available, skipping assignee update');
                    resolve(false);
                    return;
                }

                // Find the assignee field - try multiple selectors
                const assigneeField = document.querySelector('[data-test-id="assignee-field"]') ||
                                     document.querySelector('[data-test-id="assignee-field-autocomplete-trigger"]');
                
                if (!assigneeField) {
                    console.log('⚠️ Assignee field not found, trying alternative selectors...');
                    console.log('Available elements with assignee in test-id:');
                    const assigneeElements = document.querySelectorAll('[data-test-id*="assignee"]');
                    assigneeElements.forEach(el => console.log('-', el.getAttribute('data-test-id')));
                    resolve(false);
                    return;
                }

                console.log('✅ Found assignee field:', assigneeField.getAttribute('data-test-id'));

                // Find the input element within the assignee field - try multiple selectors
                const assigneeInput = assigneeField.querySelector('input[data-garden-id="forms.input"]') ||
                                     assigneeField.querySelector('input[role="combobox"]') ||
                                     assigneeField.querySelector('input');
                
                if (!assigneeInput) {
                    console.log('⚠️ Assignee input not found, checking field structure...');
                    console.log('Field HTML:', assigneeField.outerHTML.substring(0, 200) + '...');
                    resolve(false);
                    return;
                }

                console.log('✅ Found assignee input element');

                // Click the assignee field to open dropdown (no need to type agent name)
                assigneeInput.click();
                assigneeInput.focus();
                
                console.log('📝 Assignee field clicked, waiting for department dropdown...');
                
                // Wait 1.5 seconds for the dropdown to appear, then select JOR Safety & Security Operations option
                setTimeout(() => {
                    console.log('🔍 Looking for assignee dropdown options...');
                    
                    // Look for the assignee dropdown menu
                    const assigneeDropdown = document.querySelector('[data-test-id="assignee-field-dropdown-menu"]') ||
                                           document.querySelector('[role="listbox"]') ||
                                           document.querySelector('.StyledMenu-sc-lzt5u6-0');
                    
                    if (assigneeDropdown) {
                        console.log('✅ Assignee dropdown found, searching for JOR Safety & Security Operations option');
                        
                        // Find all options in the dropdown
                        const options = assigneeDropdown.querySelectorAll('[role="option"]') ||
                                       assigneeDropdown.querySelectorAll('li') ||
                                       assigneeDropdown.querySelectorAll('[data-test-id*="option"]') ||
                                       assigneeDropdown.querySelectorAll('div[data-garden-id="dropdowns.option"]');
                        
                        if (options && options.length > 0) {
                            console.log(`🎯 Found ${options.length} assignee option(s), searching for JOR Safety & Security Operations`);
                            
                            // Look for the option that contains "JOR Safety & Security Operations"
                            let jorOption = null;
                            
                            for (let option of options) {
                                const optionText = option.textContent || option.innerText || '';
                                console.log('📝 Checking option:', optionText.trim());
                                
                                if (optionText.includes('JOR Safety & Security Operations') || 
                                    optionText.includes('JOR Safety & Secuirty Operations')) {
                                    jorOption = option;
                                    console.log('🎯 Found JOR Safety & Security Operations option!');
                                    break;
                                }
                            }
                            
                            if (jorOption) {
                                console.log('🖱️ Clicking JOR Safety & Security Operations option');
                                jorOption.click();
                                
                                // Also try mouse events for better compatibility
                                const mouseDownEvent = new MouseEvent('mousedown', { bubbles: true });
                                const mouseUpEvent = new MouseEvent('mouseup', { bubbles: true });
                                const clickEvent = new MouseEvent('click', { bubbles: true });

                                jorOption.dispatchEvent(mouseDownEvent);
                                jorOption.dispatchEvent(mouseUpEvent);
                                jorOption.dispatchEvent(clickEvent);
                                
                                console.log('✅ JOR Safety & Security Operations selected, waiting for agent names dropdown...');
                                
                                // Wait for the second dropdown with agent names to appear
                                setTimeout(() => {
                                    selectAgentFromSecondDropdown(resolve);
                                }, 1000); // Wait 1 second instead of 2
                                return;
                            } else {
                                console.log('⚠️ JOR Safety & Security Operations option not found, clicking first option as fallback');
                                options[0].click();
                                resolve(true);
                                return;
                            }
                        } else {
                            console.log('⚠️ No options found in assignee dropdown');
                        }
                    } else {
                        console.log('⚠️ Assignee dropdown not found');
                    }
                    
                    // Fallback: Try keyboard navigation
                    console.log('⚠️ Dropdown selection failed, trying keyboard fallback...');
                    
                    const arrowDownEvent = new KeyboardEvent('keydown', {
                        key: 'ArrowDown',
                        code: 'ArrowDown',
                        keyCode: 40,
                        which: 40,
                        bubbles: true,
                        cancelable: true
                    });
                    
                    assigneeInput.dispatchEvent(arrowDownEvent);
                    
                    setTimeout(() => {
                        const enterKeyDown = new KeyboardEvent('keydown', {
                            key: 'Enter',
                            code: 'Enter',
                            keyCode: 13,
                            which: 13,
                            bubbles: true,
                            cancelable: true
                        });
                        
                        assigneeInput.dispatchEvent(enterKeyDown);
                        console.log('⌨️ Keyboard fallback attempted for assignee');
                        resolve(true);
                    }, 200);
                    
                }, 1500); // Wait 1.5 seconds instead of 3

            } catch (error) {
                console.error('❌ Error setting assignee field:', error);
                resolve(false);
            }
        });
    }



    function selectAgentFromSecondDropdown(resolve) {
        try {
            console.log('🔍 Looking for second dropdown with agent names...');
            
            // Look for the second dropdown (agent names under JOR Safety & Security Operations)
            const agentDropdown = document.querySelector('[data-test-id="assignee-field-dropdown-menu"]') ||
                                document.querySelector('[role="listbox"]') ||
                                document.querySelector('.StyledMenu-sc-lzt5u6-0');
            
            if (agentDropdown) {
                console.log('✅ Agent names dropdown found');
                
                // Find all options in the agent dropdown
                const agentOptions = agentDropdown.querySelectorAll('[role="option"]') ||
                                   agentDropdown.querySelectorAll('li') ||
                                   agentDropdown.querySelectorAll('[data-test-id*="option"]') ||
                                   agentDropdown.querySelectorAll('div[data-garden-id="dropdowns.option"]');
                
                if (agentOptions && agentOptions.length > 0) {
                    console.log(`🎯 Found ${agentOptions.length} agent option(s), searching for: "${username}"`);
                    
                    // Look for the option that matches the agent name
                    let matchingAgentOption = null;
                    
                    for (let option of agentOptions) {
                        const optionText = (option.textContent || option.innerText || '').trim();
                        console.log('📝 Checking agent option:', optionText);
                        
                        // Check if this option contains the agent name
                        if (optionText.includes(username) || optionText.toLowerCase().includes(username.toLowerCase())) {
                            matchingAgentOption = option;
                            console.log('🎯 Found matching agent name!');
                            break;
                        }
                    }
                    
                    if (matchingAgentOption) {
                        console.log('🖱️ Clicking agent name option');
                        console.log('📝 Selected agent:', matchingAgentOption.textContent?.trim());
                        
                        matchingAgentOption.click();
                        
                        // Also try mouse events for better compatibility
                        const mouseDownEvent = new MouseEvent('mousedown', { bubbles: true });
                        const mouseUpEvent = new MouseEvent('mouseup', { bubbles: true });
                        const clickEvent = new MouseEvent('click', { bubbles: true });

                        matchingAgentOption.dispatchEvent(mouseDownEvent);
                        matchingAgentOption.dispatchEvent(mouseUpEvent);
                        matchingAgentOption.dispatchEvent(clickEvent);
                        
                        console.log('✅ Agent name selected successfully');
                        resolve(true);
                        return;
                    } else {
                        console.log('⚠️ Agent name not found in dropdown, selecting first option as fallback');
                        agentOptions[0].click();
                        resolve(true);
                        return;
                    }
                } else {
                    console.log('⚠️ No agent options found in second dropdown');
                }
            } else {
                console.log('⚠️ Second dropdown with agent names not found');
            }
            
            // If we reach here, something went wrong
            console.log('❌ Failed to select agent from second dropdown');
            resolve(false);
            
        } catch (error) {
            console.error('❌ Error selecting agent from second dropdown:', error);
            resolve(false);
        }
    }

    function copyInboundTemplate() {
        let profileSection;

        // Use stored profile data if available, otherwise use default template
        if (storedCaptainProfile && storedCaptainProfile.processed && storedCaptainProfile.processed.formattedText) {
            profileSection = storedCaptainProfile.processed.formattedText;
        } else {
            profileSection = `***Captain Profile**
* Trips:
* Tenure:
    * ( 0 - 6 )
    * ( 6 - 2 )
    * ( 2 - 5 )
    * ( 6 - 9 )
    * ( 10+ )
* Rating:
* Tier:
* Block History:
    1. Sexual behaviour: (0, Clear)
    2. Physical altercations: (0, Clear)
    3. Road safety: (0, Clear)
    4. Minor: (0, Clear)

* Past Trips Rating:

**\*Customer Profile**
* Joined Careem: ${storedCustomerProfile && storedCustomerProfile.processed ? storedCustomerProfile.processed.joinedDate || 'N/A' : 'N/A'}
* Rating of past trips: ${storedCustomerProfile && storedCustomerProfile.processed ? storedCustomerProfile.processed.customerRating || 'N/A' : 'N/A'}
* Block History: ${storedCustomerProfile && storedCustomerProfile.processed && storedCustomerProfile.processed.blockHistory ? storedCustomerProfile.processed.blockHistory : '(0, Clear)'}
* Other complaints/claims sent: Clear
* Other Zendesk Ticket/s relating to the Booking ID, Ticket: None`;
        }

        const inboundTemplate = `TO:
CC:

Please be informed that we placed a call indicating the following details:

${profileSection}

**Actions Taken:**

* **Captain:**
1. Call Summary and Reaction: No call
2. Other Actions: Not yet

* **Customer:**
1. Call Summary and Reaction: We received a call from the customer stating that,
2. Other Actions: Apology

Requested for pair Blocking: No
Captain: I:Category (....................),Type: - B. ID:Number - T. ID:Number - AINC/AIC/VINC/VIC - Safety & Security Operation
Customer: I:Category (....................),Type: - B. ID:Number - T. ID:Number - AINC/AIC/VINC/VIC - Safety & Security Operation
Recorded: No
Escalated: No
To: No one

**Next Steps:**
&#45; Follow up with Captain: Yes
For: Take action

&#45; Follow up with customer: No
For: No need
Recorded: Yes

Regards,
${username}
Safety & Security Operations Team`;

        // Show booking info text box FIRST (don't copy template yet)
        showBookingInfoTextBox(() => {
            // After booking info is processed, start automation and THEN copy template
            startAutomatedOperations(() => {
                // Copy template LAST
                navigator.clipboard.writeText(inboundTemplate)
                    .then(() => {
                        showToast('Inbound template copied to clipboard!');
                    })
                    .catch(err => {
                        console.error('Failed to copy text:', err);
                        showToast('Error copying to clipboard');
                    });
            });
        });

        function startAutomatedOperations(callback) {
            // Perform automated operations
            console.log('🤖 Starting automated operations...');
            
            // Set requester to agent name
            setTimeout(async () => {
                try {
                    const requesterSet = await setRequesterToAgentName();
                    if (requesterSet) {
                        showToast('Requester set to: ' + username);
                        
                        // After requester is set, proceed with assignee
                        console.log('🔄 Proceeding to set assignee...');
                        setTimeout(async () => {
                            try {
                                const assigneeSet = await setAssigneeToAgentName();
                                if (assigneeSet) {
                                    showToast('Assignee set to: ' + username + ' (JOR Safety & Security)');
                                } else {
                                    console.log('⚠️ Failed to set assignee field');
                                }
                                
                                // Call the callback after automation is complete
                                if (callback) {
                                    setTimeout(() => callback(), 200);
                                }
                            } catch (error) {
                                console.error('❌ Error in assignee automation:', error);
                                if (callback) callback();
                            }
                        }, 500); // Wait 500ms between requester and assignee
                        
                    } else {
                        console.log('⚠️ Failed to set requester field');
                        if (callback) callback();
                    }
                } catch (error) {
                    console.error('❌ Error in requester automation:', error);
                    if (callback) callback();
                }
            }, 100);
        }
    }

    function showBookingInfoTextBox(callback) {
        console.log('📋 Creating booking info text box...');
        
        // Create the small text box similar to T button
        const textBox = document.createElement('div');
        textBox.id = 'booking-info-textbox';
        textBox.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            width: 300px;
            background: #fff;
            border: 2px solid #007cbb;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            z-index: 9999;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        `;

        const header = document.createElement('div');
        header.style.cssText = `
            background: #007cbb;
            color: white;
            padding: 8px 12px;
            font-size: 14px;
            font-weight: 500;
            border-radius: 6px 6px 0 0;
        `;
        header.textContent = '📋 Paste Booking Info';

        const textarea = document.createElement('textarea');
        textarea.style.cssText = `
            width: 100%;
            height: 120px;
            border: none;
            padding: 12px;
            font-size: 12px;
            font-family: monospace;
            resize: none;
            outline: none;
            box-sizing: border-box;
            background: #f8f9fa;
        `;
        textarea.placeholder = 'Paste booking information here...';

        const footer = document.createElement('div');
        footer.style.cssText = `
            padding: 8px 12px;
            font-size: 11px;
            color: #666;
            background: #f8f9fa;
            border-radius: 0 0 6px 6px;
            border-top: 1px solid #e9ecef;
        `;
        footer.textContent = 'Auto-extracts Booking ID • Press Esc to close';

        textBox.appendChild(header);
        textBox.appendChild(textarea);
        textBox.appendChild(footer);
        document.body.appendChild(textBox);

        // Focus the textarea
        textarea.focus();

        let isProcessing = false;

        // Auto-process when text is pasted
        textarea.addEventListener('paste', () => {
            if (isProcessing) return;
            
            setTimeout(() => {
                if (isProcessing) return;
                isProcessing = true;
                
                const bookingText = textarea.value.trim();
                if (bookingText) {
                    console.log('📝 Processing pasted booking info...');
                    extractAndApplyBookingID(bookingText);
                    
                    // Close the text box
                    document.body.removeChild(textBox);
                    
                    // Continue with automation
                    setTimeout(() => callback(), 200);
                } else {
                    isProcessing = false;
                }
            }, 100);
        });

        // Handle Escape key to close
        textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                document.body.removeChild(textBox);
                callback(); // Continue with automation even if closed
            }
        });

        // Auto-close after 10 seconds if nothing is pasted
        setTimeout(() => {
            if (document.body.contains(textBox)) {
                console.log('📋 Auto-closing booking info text box...');
                document.body.removeChild(textBox);
                callback(); // Continue with automation
            }
        }, 10000);
    }

    function extractAndApplyBookingID(bookingText) {
        console.log('🔍 Extracting Booking ID from booking information...');
        
        try {
            // Extract Booking ID using patterns that match your example
            const bookingIdPatterns = [
                /BOOKING\s+INFOID#\s*[\r\n]*\s*(\d+)/i,  // "BOOKING INFOID# \n2218114250"
                /ID#\s*[\r\n]*\s*(\d+)/i,               // "ID# \n2218114250"  
                /Trip#\s*(\d+)/i,                        // "Trip# 1607963506"
                /(\d{10,})/                              // Any 10+ digit number as fallback
            ];
            
            let bookingId = null;
            
            for (let pattern of bookingIdPatterns) {
                const match = bookingText.match(pattern);
                if (match) {
                    bookingId = match[1].trim();
                    console.log('✅ Found Booking ID:', bookingId, 'using pattern:', pattern);
                    break;
                }
            }
            
            if (bookingId) {
                // Apply to both Booking ID and Route ID fields
                applyBookingIdToFields(bookingId);
                showToast(`Booking ID extracted: ${bookingId}`);
            } else {
                console.log('⚠️ No Booking ID found in the text');
                showToast('No Booking ID found in pasted text');
            }
            
        } catch (error) {
            console.error('❌ Error extracting Booking ID:', error);
            showToast('Error processing booking information');
        }
    }

    function applyBookingIdToFields(bookingId) {
        console.log('📝 Applying Booking ID to form fields:', bookingId);
        
        try {
            // Find the form container
            let formContainer = document.querySelector('section.grid-ticket-fields-panel');
            
            // If no form found with the primary selector, try fallback selectors
            if (!formContainer) {
                const formSelectors = [
                    'section[class*="ticket-fields"]',
                    '[data-test-id*="TicketFieldsPane"]',
                    'div[data-test-id="ticket-fields"][data-tracking-id="ticket-fields"]',
                    '.ticket_fields'
                ];
                
                for (const selector of formSelectors) {
                    formContainer = document.querySelector(selector);
                    if (formContainer) break;
                }
            }
            
            if (!formContainer) {
                console.log('⚠️ Form container not found');
                return;
            }

            const fields = formContainer.querySelectorAll('[class*="field"], [data-test-id*="field"], div:has(label)');
            let appliedCount = 0;
            
            // Apply to Booking ID field
            Array.from(fields).forEach(field => {
                const label = field.querySelector('label');
                if (label && label.textContent.trim() === 'Booking ID') {
                    const input = field.querySelector('input');
                    if (input) {
                        setFieldValue(input, bookingId);
                        appliedCount++;
                        console.log('✅ Booking ID field updated');
                    }
                }
            });
            
            // Apply to Route ID field
            Array.from(fields).forEach(field => {
                const label = field.querySelector('label');
                if (label && label.textContent.trim() === 'Route ID') {
                    const input = field.querySelector('input');
                    if (input) {
                        setFieldValue(input, bookingId);
                        appliedCount++;
                        console.log('✅ Route ID field updated');
                    }
                }
            });
            
            console.log(`✅ Applied Booking ID to ${appliedCount} fields`);
            
        } catch (error) {
            console.error('❌ Error applying Booking ID to fields:', error);
        }
    }

    function setFieldValue(input, value) {
        try {
            // Clear and set value
            input.value = '';
            input.value = value;
            
            // Trigger React events
            const inputEvent = new Event('input', { bubbles: true });
            const changeEvent = new Event('change', { bubbles: true });
            
            input.dispatchEvent(inputEvent);
            input.dispatchEvent(changeEvent);

            // Try to access React's internal props
            const key = Object.keys(input).find(key => key.startsWith('__reactProps$'));
            if (key) {
                const props = input[key];
                if (props.onChange) {
                    const syntheticEvent = {
                        target: input,
                        currentTarget: input,
                        type: 'change',
                        bubbles: true,
                        cancelable: true,
                        preventDefault: () => { },
                        stopPropagation: () => { },
                        persist: () => { }
                    };
                    props.onChange(syntheticEvent);
                }
            }
        } catch (error) {
            console.error('❌ Error setting field value:', error);
        }
    }

    function createSecondButton() {
        const wrapper = document.createElement('div');
        wrapper.className = 'sc-ymabb7-1 fTDEYw';

        const button = document.createElement('button');
        button.setAttribute('aria-pressed', 'false');
        button.setAttribute('aria-label', 'Inbound Template');
        button.setAttribute('data-test-id', 'inbound-template-button');
        button.setAttribute('data-active', 'false');
        button.setAttribute('title', 'Inbound Template');
        button.setAttribute('tabindex', '0');
        button.className = 'StyledButton-sc-qe3ace-0 StyledIconButton-sc-1t0ughp-0 eUFUgT iQoDao sc-k83b6s-0 ihwxVG';
        button.setAttribute('data-garden-id', 'buttons.icon_button');
        button.setAttribute('data-garden-version', '9.7.0');
        button.setAttribute('type', 'button');

        // Create SVG element (will be hidden)
        const svg = document.createElement('svg');
        svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        svg.setAttribute('width', '16');
        svg.setAttribute('height', '16');
        svg.setAttribute('viewBox', '0 0 16 16');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('focusable', 'false');
        svg.setAttribute('data-garden-id', 'buttons.icon');
        svg.setAttribute('data-garden-version', '9.7.0');
        svg.className = 'StyledBaseIcon-sc-1moykgb-0 StyledIcon-sc-19meqgg-0 eWlVPJ cxMMcO';
        svg.style.display = 'none';

        button.appendChild(svg);

        // Add custom icon class and symbol
        button.classList.add('custom-text-icon');
        button.setAttribute('data-icon-text', '☎');

        // Add slight visual difference
        button.style.opacity = '0.85';

        // Add click handler
        button.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            copyInboundTemplate();
        });

        wrapper.appendChild(button);
        return wrapper;
    }

    function createThirdButton() {
        const wrapper = document.createElement('div');
        wrapper.className = 'sc-ymabb7-1 fTDEYw';

        const button = document.createElement('button');
        button.setAttribute('aria-pressed', 'false');
        button.setAttribute('aria-label', 'Template T');
        button.setAttribute('data-test-id', 'template-t-button');
        button.setAttribute('data-active', 'false');
        button.setAttribute('title', 'Template T');
        button.setAttribute('tabindex', '0');
        button.className = 'StyledButton-sc-qe3ace-0 StyledIconButton-sc-1t0ughp-0 eUFUgT iQoDao sc-k83b6s-0 ihwxVG';
        button.setAttribute('data-garden-id', 'buttons.icon_button');
        button.setAttribute('data-garden-version', '9.7.0');
        button.setAttribute('type', 'button');

        // Create SVG element (will be hidden)
        const svg = document.createElement('svg');
        svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        svg.setAttribute('width', '16');
        svg.setAttribute('height', '16');
        svg.setAttribute('viewBox', '0 0 16 16');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('focusable', 'false');
        svg.setAttribute('data-garden-id', 'buttons.icon');
        svg.setAttribute('data-garden-version', '9.7.0');
        svg.className = 'StyledBaseIcon-sc-1moykgb-0 StyledIcon-sc-19meqgg-0 eWlVPJ cxMMcO';
        svg.style.display = 'none';

        button.appendChild(svg);

        // Add custom icon class and symbol - uppercase T
        button.classList.add('custom-text-icon');
        button.setAttribute('data-icon-text', 'T');

        // Add slight visual difference
        button.style.opacity = '0.85';

        // Add click handler
        button.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            copyTemplateT(button);
        });

        wrapper.appendChild(button);
        return wrapper;
    }

    function ensureButtonsInToolbar(toolbar, retryCount = 0) {
        if (!toolbar) return;

        // If our duplicate exists, ensure the inbound button also exists; if not, add it
        const existingDuplicateButton = toolbar.querySelector('[data-test-id="duplicate-add-link-button"]');
        if (existingDuplicateButton) {
            addLinkButtonDuplicated = true;
            const existingInbound = toolbar.querySelector('[data-test-id="inbound-template-button"]');
            if (!existingInbound) {
                const secondButton = createSecondButton();
                const duplicateWrapper = existingDuplicateButton.parentElement;
                if (duplicateWrapper && duplicateWrapper.parentNode) {
                    duplicateWrapper.parentNode.insertBefore(secondButton, duplicateWrapper.nextSibling);
                }
            }
            
            // Check for the third button (Template T) and add it if it doesn't exist
            const existingTemplateT = toolbar.querySelector('[data-test-id="template-t-button"]');
            if (!existingTemplateT) {
                const thirdButton = createThirdButton();
                const inboundWrapper = toolbar.querySelector('[data-test-id="inbound-template-button"]')?.parentElement;
                if (inboundWrapper && inboundWrapper.parentNode) {
                    inboundWrapper.parentNode.insertBefore(thirdButton, inboundWrapper.nextSibling);
                }
            }
            return;
        }

        // Duplicate missing - clear flag so we can re-add
        addLinkButtonDuplicated = false;

        // Find the original "Add link" button; the toolbar might still be initializing
        const originalLinkButton = toolbar.querySelector('[data-test-id="ticket-composer-toolbar-link-button"]');
        if (!originalLinkButton) {
            if (retryCount < 10) {
                setTimeout(() => ensureButtonsInToolbar(toolbar, retryCount + 1), 200);
            }
            return;
        }

        // Get the wrapper div of the original button
        const originalWrapper = originalLinkButton.parentElement;
        if (!originalWrapper) return;

        // Clone the entire wrapper and all its contents
        const duplicateWrapper = originalWrapper.cloneNode(true);

        // Find the button inside the cloned wrapper and update its attributes
        const duplicateButton = duplicateWrapper.querySelector('button');
        if (duplicateButton) {
            // Update the test-id to make it unique
            duplicateButton.setAttribute('data-test-id', 'duplicate-add-link-button');
            duplicateButton.setAttribute('title', 'Open Text Box');
            duplicateButton.setAttribute('aria-label', 'Open Text Box');

            // Add a slight visual difference (optional: add a small indicator)
            duplicateButton.style.opacity = '0.85';

            // Remove all existing event listeners by cloning the element
            const cleanButton = duplicateButton.cloneNode(true);
            duplicateButton.parentNode.replaceChild(cleanButton, duplicateButton);

            // Hide the original SVG and add letter "A" via CSS
            const svg = cleanButton.querySelector('svg');
            if (svg) {
                svg.style.display = 'none';
            }

            // Add a class to enable CSS-based icon
            cleanButton.classList.add('custom-text-icon');
            cleanButton.setAttribute('data-icon-text', '✎');

            // Add custom click handler to open text window
            cleanButton.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                showTextWindow();
            });
        }

        // Insert the duplicate button right after the original
        originalWrapper.parentNode.insertBefore(duplicateWrapper, originalWrapper.nextSibling);

        // Create a second new button next to the duplicated button
        const secondButton = createSecondButton();
        duplicateWrapper.parentNode.insertBefore(secondButton, duplicateWrapper.nextSibling);

        // Create a third button (Template T) next to the second button
        const thirdButton = createThirdButton();
        secondButton.parentNode.insertBefore(thirdButton, secondButton.nextSibling);

        addLinkButtonDuplicated = true;
    }

    function duplicateAddLinkButton(retryCount = 0) {
        // Ensure buttons in all editor toolbars (multiple Zendesk tabs)
        const toolbars = document.querySelectorAll('[data-test-id="ticket-editor-app-icon-view"]');
        if (!toolbars || toolbars.length === 0) {
            addLinkButtonDuplicated = false;
            return;
        }
        toolbars.forEach(tb => ensureButtonsInToolbar(tb, retryCount));
    }




    function initObserver() {
        injectCSS();

        function isTicketView() {
            return window.location.pathname.includes('/agent/tickets/');
        }

        function handleTicketView() {
            if (!isTicketView() || observerDisconnected) return;

            // Use debouncing to prevent multiple rapid calls
            debounce(() => {
                if (observerDisconnected) return;

                if (!globalButton) {
                    tryAddButtons();
                }

                // Ensure the Zendesk brand logo acts as the Block History to CSV trigger
                attachBlockHistoryToZendeskLogo();

                // Try to duplicate the add link button
                duplicateAddLinkButton();

                // Use cached elements for better performance
                let formContainers = getCachedElements('section.grid-ticket-fields-panel', 2000);
                
                // If no forms found with the primary selector, try fallback selectors
                if (formContainers.length === 0) {
                    const formSelectors = [
                        'section[class*="ticket-fields"]',
                        '[data-test-id*="TicketFieldsPane"]',
                        'div[data-test-id="ticket-fields"][data-tracking-id="ticket-fields"]',
                        '.ticket_fields'
                    ];
                    
                    for (const selector of formSelectors) {
                        formContainers = document.querySelectorAll(selector);
                        if (formContainers.length > 0) break;
                    }
                }

                if (formContainers.length === 0) {
                    // Single retry with timeout cleanup
                    const timeoutId = setTimeout(() => {
                        if (observerDisconnected) return;
                        let retryContainers = getCachedElements('section.grid-ticket-fields-panel', 500);
                        
                        // If no forms found with the primary selector, try fallback selectors
                        if (retryContainers.length === 0) {
                            const formSelectors = [
                                'section[class*="ticket-fields"]',
                                '[data-test-id*="TicketFieldsPane"]',
                                'div[data-test-id="ticket-fields"][data-tracking-id="ticket-fields"]',
                                '.ticket_fields'
                            ];
                            
                            for (const selector of formSelectors) {
                                retryContainers = document.querySelectorAll(selector);
                                if (retryContainers.length > 0) break;
                            }
                        }
                        retryContainers.forEach(container => {
                            if (container.offsetParent !== null && container.isConnected) {
                                initFormManager(container);
                            }
                        });
                        duplicateAddLinkButton();
                    }, 300); // Reduced from 500ms

                    registerCleanup(() => clearTimeout(timeoutId));
                    return;
                }

                formContainers.forEach(container => {
                    if (container.offsetParent !== null && container.isConnected) {
                        initFormManager(container);
                    }
                });
            }, 100, 'handleTicketView');
        }

        // Optimized form observer with reduced scope
        const formObserver = new MutationObserver((mutations) => {
            if (observerDisconnected) return;

            let shouldHandle = false;
            for (const mutation of mutations) {
                if (mutation.target.matches &&
                    (mutation.target.matches('section.grid-ticket-fields-panel') ||
                        mutation.target.matches('section[class*="ticket-fields"]') ||
                        mutation.target.matches('div[data-test-id="ticket-fields"]') ||
                        mutation.target.closest('section.grid-ticket-fields-panel') ||
                        mutation.target.closest('section[class*="ticket-fields"]') ||
                        mutation.target.closest('div[data-test-id="ticket-fields"]'))) {
                    shouldHandle = true;
                    break;
                }
            }

            if (shouldHandle) {
                // Increased delay to allow form to fully render before autofill attempts
                debounce(handleTicketView, 250, 'formObserver');
            }
        });

        // Optimized toolbar observer with reduced overhead
        const toolbarObserver = new MutationObserver((mutations) => {
            if (observerDisconnected) return;

            let shouldHandle = false;
            for (const mutation of mutations) {
                const target = mutation.target;
                if (!target || !target.matches) continue;
                const composerContainer = target.closest('[data-test-id="ticket-editor-app"]') ||
                    target.closest('[data-test-id="ticket-editor-app-icon-view"]');
                if (composerContainer) {
                    shouldHandle = true;
                    break;
                }
            }

            if (shouldHandle && isTicketView()) {
                debounce(() => duplicateAddLinkButton(0), 100, 'toolbarObserver');
            }
        });

        // Observe with more targeted selectors for better performance
        const mainContent = document.querySelector('main') || document.body;

        formObserver.observe(mainContent, {
            childList: true,
            subtree: true,
            attributeFilter: ['data-test-id', 'title', 'value'], // Watch for dropdown value changes too
            characterData: false // Don't watch text changes for performance
        });

        toolbarObserver.observe(mainContent, {
            childList: true,
            subtree: true,
            attributeFilter: ['data-test-id']
        });

        // Optimized click handler with better debouncing
        const clickHandler = (event) => {
            if (observerDisconnected) return;

            const trigger = event.target && event.target.closest && event.target.closest('[data-test-id="ticket-editor-app-menu-trigger"], [data-test-id="ticket-editor-app-editor-type-select"], [data-garden-container-id="containers.menu.trigger"]');
            if (trigger && isTicketView()) {
                // Reduced number of retries and delays
                for (let i = 1; i <= 3; i++) {
                    const timeoutId = setTimeout(() => {
                        if (!observerDisconnected) {
                            duplicateAddLinkButton(0);
                        }
                    }, i * 150); // Reduced from 200ms to 150ms

                    registerCleanup(() => clearTimeout(timeoutId));
                }
            }
        };

        document.addEventListener('click', clickHandler, { passive: true, capture: true });

        // URL change observer
        let lastUrl = location.href;
        const urlObserver = new MutationObserver(() => {
            if (observerDisconnected) return;

            const url = location.href;
            if (url !== lastUrl) {
                lastUrl = url;
                addLinkButtonDuplicated = false;
                clearDomCache(); // Clear cache on navigation

                const timeoutId = setTimeout(() => {
                    if (!observerDisconnected) {
                        handleTicketView();
                    }
                }, 300); // Reduced from 500ms

                registerCleanup(() => clearTimeout(timeoutId));
            }
        });

        const titleElement = document.querySelector('title');
        if (titleElement) {
            urlObserver.observe(titleElement, {
                childList: true,
                characterData: true
            });
        }

        // Register cleanup for all observers
        registerCleanup(() => {
            observerDisconnected = true;
            formObserver.disconnect();
            toolbarObserver.disconnect();
            urlObserver.disconnect();
            document.removeEventListener('click', clickHandler, { passive: true, capture: true });
            clearDomCache();
        });

        // Initial setup with reduced delay
        const initialTimeoutId = setTimeout(() => {
            if (!observerDisconnected && isTicketView()) {
                handleTicketView();
            }
        }, 800); // Reduced from 1000ms

        registerCleanup(() => clearTimeout(initialTimeoutId));
    }

    // Initialize username prompt when script loads
    promptForUsername().then((name) => {
        if (name) {
            console.log(`✅ AutoDeskX initialized for agent: ${name}`);
        } else {
            console.log('⚠️ AutoDeskX initialized without agent name');
        }
        // Start the main script functionality after username is set
        initObserver();
        
        // Add PQMS keyboard shortcuts (Alt+O, Alt+P, Alt+S)
        document.addEventListener('keydown', (e) => {
            // Check if Alt key is pressed (without Ctrl or Shift to avoid conflicts)
            if (e.altKey && !e.ctrlKey && !e.shiftKey) {
                let status = null;
                
                if (e.key === 'o' || e.key === 'O') {
                    status = 'Open';
                } else if (e.key === 'p' || e.key === 'P') {
                    status = 'Pending';
                } else if (e.key === 's' || e.key === 'S') {
                    status = 'Solved';
                }
                
                if (status) {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log(`PQMS: Keyboard shortcut triggered - ${status}`);
                    submitToPQMS(status);
                }
            }
        });
    }).catch((error) => {
        console.error('❌ Error during username setup:', error);
        // Initialize anyway to ensure script functionality
        initObserver();
        
        // Add PQMS keyboard shortcuts (Alt+O, Alt+P, Alt+S)
        document.addEventListener('keydown', (e) => {
            // Check if Alt key is pressed (without Ctrl or Shift to avoid conflicts)
            if (e.altKey && !e.ctrlKey && !e.shiftKey) {
                let status = null;
                
                if (e.key === 'o' || e.key === 'O') {
                    status = 'Open';
                } else if (e.key === 'p' || e.key === 'P') {
                    status = 'Pending';
                } else if (e.key === 's' || e.key === 'S') {
                    status = 'Solved';
                }
                
                if (status) {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log(`PQMS: Keyboard shortcut triggered - ${status}`);
                    submitToPQMS(status);
                }
            }
        });
    });

    // Add cleanup on page unload to prevent memory leaks
    window.addEventListener('beforeunload', () => {
        observerDisconnected = true;
        performCleanup();
    }, { passive: true });

    window.addEventListener('unload', () => {
        observerDisconnected = true;
        performCleanup();
    }, { passive: true });

    // Also cleanup on visibility change (tab switching)
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            clearDomCache(); // Clear cache when tab becomes hidden
        }
    }, { passive: true });

    // ============================================================================
    // PQMS SUBMISSION
    // ============================================================================

    let pqmsButton = null;
    let isSubmittingToPQMS = false; // Flag to prevent duplicate submissions

    async function submitToPQMS(ticketStatus = 'Solved') {
        // Wrap everything in try-catch to prevent ANY submission if errors occur
        try {
            // Prevent duplicate submissions
            if (isSubmittingToPQMS) {
                console.warn('PQMS: Submission already in progress, ignoring duplicate request');
                showPQMSToast('Error: A submission is already in progress', 'error');
                return;
            }

            // ============================================================
            // VALIDATION PHASE - NO SUBMISSION IF ANY VALIDATION FAILS
            // ============================================================

            // Validation 1: Check Ticket ID
            const ticketId = getCurrentTicketId();
            
            if (!ticketId || ticketId === '' || ticketId === null || ticketId === undefined) {
                console.error('PQMS VALIDATION FAILED: Invalid or missing Ticket ID');
                showPQMSToast('Error: Could not get valid Ticket ID', 'error');
                return;
            }

            // Validate Ticket ID format (should be numeric)
            if (!/^\d+$/.test(ticketId.toString())) {
                console.error('PQMS VALIDATION FAILED: Ticket ID is not numeric:', ticketId);
                showPQMSToast('Error: Invalid Ticket ID format', 'error');
                return;
            }

            // Validation 2: Check Ticket Status
            const validStatuses = ['Open', 'Pending', 'Solved'];
            if (!validStatuses.includes(ticketStatus)) {
                console.error('PQMS VALIDATION FAILED: Invalid ticket status:', ticketStatus);
                showPQMSToast(`Error: Invalid ticket status "${ticketStatus}". Must be Open, Pending, or Solved`, 'error');
                return;
            }

            // Validation 3: Get and validate selected user
            const selectedUser = getPQMSSelectedUser();
            
            if (!selectedUser || !selectedUser.opsId || !selectedUser.name) {
                console.error('PQMS VALIDATION FAILED: No user selected or user data incomplete');
                showPQMSToast('Error: Please select an OPS ID in the dashboard first', 'error');
                return;
            }

            // Validation 4: Verify OPS ID exists in database
            if (!PQMS_USERS[selectedUser.opsId]) {
                console.error('PQMS VALIDATION FAILED: OPS ID not found in database:', selectedUser.opsId);
                showPQMSToast(`Error: Invalid OPS ID "${selectedUser.opsId}"`, 'error');
                return;
            }

            // Validation 5: Verify Name matches the OPS ID in database
            const expectedName = PQMS_USERS[selectedUser.opsId];
            if (selectedUser.name !== expectedName) {
                console.error('PQMS VALIDATION FAILED: Name mismatch for OPS ID', selectedUser.opsId);
                console.error('Expected:', expectedName);
                console.error('Got:', selectedUser.name);
                showPQMSToast(`Error: Name mismatch for OPS ID ${selectedUser.opsId}`, 'error');
                return;
            }

            // Validation 6: Additional safety checks
            if (typeof ticketId !== 'string' && typeof ticketId !== 'number') {
                console.error('PQMS VALIDATION FAILED: Ticket ID has invalid type:', typeof ticketId);
                showPQMSToast('Error: Ticket ID type validation failed', 'error');
                return;
            }

            // ============================================================
            // ALL VALIDATIONS PASSED - PROCEED WITH SUBMISSION
            // ============================================================

            console.log('PQMS: All validations passed ✓');
            console.log('PQMS: Ticket ID:', ticketId);
            console.log('PQMS: Status:', ticketStatus);
            console.log('PQMS: OPS ID:', selectedUser.opsId);
            console.log('PQMS: Name:', selectedUser.name);

            // Set flag to prevent duplicate submissions
            isSubmittingToPQMS = true;

            // Show loading state
            showPQMSToast('Submitting to PQMS...', 'info');

            // Prepare the parameters exactly as the PQMS system expects
            const params = new URLSearchParams({
                'Ticket_ID': ticketId.toString(),
                'SSOC_Reason': 'Felt Unsafe',
                'Ticket_Type': 'Non - Critical',
                'Ticket_Status': ticketStatus,
                'Attempts': 'NA',
                'Escelated': '',
                'Follow_Up': '',
                'Comments': '',
                'username': selectedUser.opsId,
                'name': selectedUser.name
            });

            const url = `https://pqms05.extensya.com/Careem/ticket/submit_SSOC_ticket.php?${params.toString()}`;

            // CORS workaround: Use hidden iframe to submit
            // This bypasses CORS restrictions by loading the URL directly
            const iframe = document.createElement('iframe');
            iframe.style.display = 'none';
            iframe.style.width = '0';
            iframe.style.height = '0';
            iframe.style.border = 'none';
            
            // Set up load handler to detect success
            let loadTimeout;
            const loadPromise = new Promise((resolve, reject) => {
                iframe.onload = () => {
                    clearTimeout(loadTimeout);
                    resolve();
                };
                iframe.onerror = () => {
                    clearTimeout(loadTimeout);
                    reject(new Error('Failed to load PQMS endpoint'));
                };
                // Timeout after 10 seconds
                loadTimeout = setTimeout(() => {
                    reject(new Error('Request timeout'));
                }, 10000);
            });

            document.body.appendChild(iframe);
            iframe.src = url;

            try {
                await loadPromise;
                console.log(`PQMS: Successfully submitted ticket ${ticketId} as ${ticketStatus}`);
                showPQMSToast(`✓ Ticket ${ticketId} submitted to PQMS as ${ticketStatus}`, 'success');
                
                // Fetch ticket data and save to history
                fetchTicketData(ticketId).then(({ subject, groupName }) => {
                    savePQMSSubmission(ticketId, subject, groupName, ticketStatus);
                    console.log('PQMS: Submission saved to history');
                }).catch(err => {
                    console.error('PQMS: Failed to save submission to history', err);
                });
            } catch (loadError) {
                // Even if we can't detect success, the request was sent
                // This is because CORS prevents us from reading the response
                console.warn(`PQMS: Request sent for ticket ${ticketId} as ${ticketStatus} (response hidden by CORS)`);
                showPQMSToast(`→ Ticket ${ticketId} sent to PQMS as ${ticketStatus}`, 'info');
                
                // Still save to history even if we can't confirm
                fetchTicketData(ticketId).then(({ subject, groupName }) => {
                    savePQMSSubmission(ticketId, subject, groupName, ticketStatus);
                    console.log('PQMS: Submission saved to history');
                }).catch(err => {
                    console.error('PQMS: Failed to save submission to history', err);
                });
            } finally {
                // Remove iframe after a short delay
                setTimeout(() => {
                    if (iframe && iframe.parentNode) {
                        iframe.parentNode.removeChild(iframe);
                    }
                }, 1000);
            }

        } catch (error) {
            // Catch ANY unexpected error and prevent submission
            console.error('PQMS CRITICAL ERROR: Submission aborted due to unexpected error:', error);
            console.error('Error details:', error.message, error.stack);
            showPQMSToast(`Error: Submission failed - ${error.message}`, 'error');
            
            // Ensure no iframe was created in case of error
            const existingIframe = document.querySelector('iframe[src*="pqms05.extensya.com"]');
            if (existingIframe && existingIframe.parentNode) {
                existingIframe.parentNode.removeChild(existingIframe);
            }
        } finally {
            // Always reset the flag after submission completes or fails
            setTimeout(() => {
                isSubmittingToPQMS = false;
            }, 2000); // Wait 2 seconds before allowing another submission
        }
    }

    function showPQMSToast(message, type = 'info') {
        // Create toast notification
        const toast = document.createElement('div');
        toast.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 15px 20px;
            background-color: ${type === 'success' ? '#28a745' : type === 'error' ? '#dc3545' : '#007bff'};
            color: white;
            border-radius: 5px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            z-index: 10000;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 14px;
            max-width: 400px;
            animation: slideIn 0.3s ease-out;
        `;
        toast.textContent = message;

        // Add animation
        const style = document.createElement('style');
        style.textContent = `
            @keyframes slideIn {
                from {
                    transform: translateX(100%);
                    opacity: 0;
                }
                to {
                    transform: translateX(0);
                    opacity: 1;
                }
            }
        `;
        document.head.appendChild(style);

        document.body.appendChild(toast);

        // Remove after 3 seconds
        setTimeout(() => {
            toast.style.animation = 'slideIn 0.3s ease-out reverse';
            setTimeout(() => {
                toast.remove();
                style.remove();
            }, 300);
        }, 3000);
    }

    // ============================================================================
    // PQMS USER SETTINGS
    // ============================================================================

    // User database
    const PQMS_USERS = {
			'45724': 'Alabbas Ibrahim Abdo Dabajeh',
			'22529': 'Diya Jalal Abdel Hadi Mallah',
            '42727': 'Omar Mohammad Amin Yousef Hazaymeh',
            '40268': 'Nader Mohammad Qasim Abujalil',
            '37862': 'Husam Ahmad Ibrahim Alnajy',
            '32951': 'Bader Alzoubi',
            '47962': 'Ammar Ibrahim Mohammad Bani hamad',
            '47968': 'Mohanad Bani Mostafa'
    };

    // Storage key for selected user
    const PQMS_USER_STORAGE_KEY = 'pqms_selected_user';
    const PQMS_HISTORY_STORAGE_KEY = 'pqms_submission_history';

    // Get submission history from localStorage
    function getPQMSHistory() {
        const saved = localStorage.getItem(PQMS_HISTORY_STORAGE_KEY);
        if (saved) {
            try {
                return JSON.parse(saved);
            } catch (e) {
                console.error('PQMS: Error parsing history', e);
                return [];
            }
        }
        return [];
    }

    // Save submission to history
    function savePQMSSubmission(ticketId, ticketSubject, groupName, status) {
        const history = getPQMSHistory();
        const submission = {
            ticketId,
            ticketSubject,
            groupName,
            status,
            timestamp: new Date().toISOString(),
            submittedBy: getPQMSSelectedUser()?.name || 'Unknown'
        };
        
        // Add to beginning of array
        history.unshift(submission);
        
        // Keep only last 100 submissions
        if (history.length > 100) {
            history.splice(100);
        }
        
        localStorage.setItem(PQMS_HISTORY_STORAGE_KEY, JSON.stringify(history));
    }

    // Get current selected user from localStorage
    function getPQMSSelectedUser() {
        const saved = localStorage.getItem(PQMS_USER_STORAGE_KEY);
        if (saved) {
            try {
                const userData = JSON.parse(saved);
                // Validate that the user still exists in our database
                if (PQMS_USERS[userData.opsId]) {
                    return userData;
                }
            } catch (e) {
                console.error('PQMS: Error parsing saved user data', e);
            }
        }
        return null;
    }

    // Save selected user to localStorage
    function savePQMSSelectedUser(opsId, name) {
        const userData = { opsId, name };
        localStorage.setItem(PQMS_USER_STORAGE_KEY, JSON.stringify(userData));
    }

    // Clear selected user
    function clearPQMSSelectedUser() {
        localStorage.removeItem(PQMS_USER_STORAGE_KEY);
    }

    // Fetch ticket subject from Zendesk API
    async function fetchTicketSubject(ticketId) {
        try {
            const response = await fetch(`/api/v2/tickets/${ticketId}.json`);
            if (!response.ok) throw new Error('Failed to fetch ticket');
            const data = await response.json();
            return data.ticket.subject || 'Unknown Subject';
        } catch (error) {
            console.error('PQMS: Error fetching ticket subject:', error);
            return 'Unknown Subject';
        }
    }

    // Fetch group name from Zendesk API
    async function fetchGroupName(groupId) {
        try {
            if (!groupId) return 'No Group';
            const response = await fetch(`/api/v2/groups/${groupId}.json`);
            if (!response.ok) throw new Error('Failed to fetch group');
            const data = await response.json();
            return data.group.name || 'Unknown Group';
        } catch (error) {
            console.error('PQMS: Error fetching group name:', error);
            return 'Unknown Group';
        }
    }

    // Fetch ticket data (subject and group)
    async function fetchTicketData(ticketId) {
        try {
            const response = await fetch(`/api/v2/tickets/${ticketId}.json`);
            if (!response.ok) throw new Error('Failed to fetch ticket');
            const data = await response.json();
            
            const subject = data.ticket.subject || 'Unknown Subject';
            const groupId = data.ticket.group_id;
            
            // Fetch group name if group_id exists
            let groupName = 'No Group';
            if (groupId) {
                groupName = await fetchGroupName(groupId);
            }
            
            return { subject, groupName };
        } catch (error) {
            console.error('PQMS: Error fetching ticket data:', error);
            return { subject: 'Unknown Subject', groupName: 'Unknown Group' };
        }
    }

    // ============================================================================
    // PQMS DASHBOARD
    // ============================================================================

    function togglePQMSDashboard() {
        const existingDashboard = document.getElementById('pqms-dashboard');
        
        if (existingDashboard) {
            // Toggle visibility
            if (existingDashboard.style.display === 'none') {
                existingDashboard.style.display = 'flex';
            } else {
                existingDashboard.style.display = 'none';
            }
            return;
        }

        // Create new dashboard
        createPQMSDashboard();
    }

    function createPQMSDashboard() {
        // Create dashboard overlay - Professional Corporate Design
        const dashboard = document.createElement('div');
        dashboard.id = 'pqms-dashboard';
        dashboard.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 800px;
            max-width: 95%;
            height: 85vh;
            min-height: 600px;
            max-height: 90vh;
            background: #ffffff;
            border: 1px solid #d1d5db;
            border-radius: 8px;
            box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
            z-index: 100000;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        `;

        // Header - Corporate style
        const header = document.createElement('div');
        header.style.cssText = `
            background: #f9fafb;
            border-bottom: 1px solid #e5e7eb;
            padding: 18px 24px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        `;
        
        const headerTitle = document.createElement('div');
        headerTitle.style.cssText = `
            display: flex;
            align-items: center;
            gap: 10px;
        `;
        
        const titleIcon = document.createElement('span');
        titleIcon.textContent = '⚙';
        titleIcon.style.cssText = `
            font-size: 20px;
            color: #4b5563;
        `;
        
        const titleText = document.createElement('span');
        titleText.textContent = 'PQMS Dashboard';
        titleText.style.cssText = `
            font-size: 18px;
            font-weight: 600;
            color: #111827;
            letter-spacing: -0.025em;
        `;
        
        headerTitle.appendChild(titleIcon);
        headerTitle.appendChild(titleText);
        
        // Settings and Close buttons
        const buttonGroup = document.createElement('div');
        buttonGroup.style.cssText = `
            display: flex;
            gap: 8px;
            align-items: center;
        `;
        
        const settingsBtn = document.createElement('button');
        settingsBtn.id = 'pqms-settings-btn';
        settingsBtn.innerHTML = '⚙';
        settingsBtn.style.cssText = `
            background: transparent;
            border: none;
            color: #6b7280;
            width: 32px;
            height: 32px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 18px;
            line-height: 1;
            transition: all 0.15s;
            display: flex;
            align-items: center;
            justify-content: center;
        `;
        
        const closeBtn = document.createElement('button');
        closeBtn.id = 'pqms-close-btn';
        closeBtn.innerHTML = '&times;';
        closeBtn.style.cssText = `
            background: transparent;
            border: none;
            color: #6b7280;
            width: 32px;
            height: 32px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 24px;
            line-height: 1;
            transition: all 0.15s;
            display: flex;
            align-items: center;
            justify-content: center;
        `;
        
        buttonGroup.appendChild(settingsBtn);
        buttonGroup.appendChild(closeBtn);
        
        header.appendChild(headerTitle);
        header.appendChild(buttonGroup);

        // Content - Professional Corporate Style
        const content = document.createElement('div');
        content.style.cssText = `
            padding: 24px;
            display: flex;
            flex-direction: column;
            gap: 24px;
            background: #ffffff;
            overflow-y: auto;
            flex: 1;
            min-height: 0;
        `;

        // Get current user
        const currentUser = getPQMSSelectedUser();
        const isUserSelected = !!currentUser;

        // Get submission history and calculate counters
        const history = getPQMSHistory();
        const counters = {
            all: history.length,
            open: history.filter(h => h.status === 'Open').length,
            pending: history.filter(h => h.status === 'Pending').length,
            solved: history.filter(h => h.status === 'Solved').length
        };

        // Counters Section
        const countersSection = document.createElement('div');
        countersSection.style.cssText = `
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 12px;
            margin-bottom: 24px;
        `;

        const counterItems = [
            { label: 'All', count: counters.all, color: '#6b7280' },
            { label: 'Open', count: counters.open, color: '#9ca3af' },
            { label: 'Pending', count: counters.pending, color: '#9ca3af' },
            { label: 'Solved', count: counters.solved, color: '#22c55e' }
        ];

        counterItems.forEach(item => {
            const counter = document.createElement('div');
            counter.style.cssText = `
                background: #f9fafb;
                border: 1px solid #e5e7eb;
                border-radius: 6px;
                padding: 12px;
                text-align: center;
            `;
            counter.innerHTML = `
                <div style="
                    font-size: 24px;
                    font-weight: 700;
                    color: ${item.color};
                    line-height: 1;
                    margin-bottom: 4px;
                ">${item.count}</div>
                <div style="
                    font-size: 11px;
                    font-weight: 600;
                    color: #6b7280;
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                ">${item.label}</div>
            `;
            countersSection.appendChild(counter);
        });

        // OPS ID Section
        const opsSection = document.createElement('div');
        opsSection.innerHTML = `
            <label style="
                display: block;
                font-weight: 600;
                margin-bottom: 8px;
                color: #374151;
                font-size: 13px;
                text-transform: uppercase;
                letter-spacing: 0.025em;
            ">OPS ID</label>
            <select id="pqms-ops-select" style="
                width: 100%;
                padding: 12px 12px;
                border: 1px solid #d1d5db;
                border-radius: 6px;
                font-size: 14px;
                background: ${isUserSelected ? '#f9fafb' : '#ffffff'};
                cursor: ${isUserSelected ? 'not-allowed' : 'pointer'};
                color: ${isUserSelected ? '#9ca3af' : '#111827'};
                transition: all 0.15s;
                font-family: 'Courier New', monospace;
                font-weight: 500;
                min-height: 44px;
                line-height: 1.2;
            " ${isUserSelected ? 'disabled' : ''}>
                <option value="">Select an OPS ID</option>
                ${Object.keys(PQMS_USERS).map(opsId => 
                    `<option value="${opsId}" ${currentUser?.opsId === opsId ? 'selected' : ''}>${opsId}</option>`
                ).join('')}
            </select>
        `;

        // Name Display Section
        const nameSection = document.createElement('div');
        nameSection.innerHTML = `
            <label style="
                display: block;
                font-weight: 600;
                margin-bottom: 8px;
                color: #374151;
                font-size: 13px;
                text-transform: uppercase;
                letter-spacing: 0.025em;
            ">Full Name</label>
            <div id="pqms-name-display" style="
                width: 100%;
                padding: 10px 12px;
                border: 1px solid #d1d5db;
                border-radius: 6px;
                font-size: 14px;
                background: #f9fafb;
                color: ${currentUser ? '#111827' : '#9ca3af'};
                min-height: 42px;
                display: flex;
                align-items: center;
                font-weight: 500;
            ">${currentUser ? currentUser.name : 'No operator selected'}</div>
        `;

        // Status Indicator (if user is selected)
        const statusSection = document.createElement('div');
        if (isUserSelected) {
            statusSection.innerHTML = `
                <div style="
                    padding: 12px 16px;
                    background: #f0fdf4;
                    border: 1px solid #bbf7d0;
                    border-radius: 6px;
                    display: flex;
                    align-items: center;
                    gap: 10px;
                ">
                    <span style="
                        width: 8px;
                        height: 8px;
                        background: #22c55e;
                        border-radius: 50%;
                        display: inline-block;
                    "></span>
                    <span style="
                        font-size: 13px;
                        color: #166534;
                        font-weight: 500;
                    ">Selected</span>
                </div>
            `;
        }

        // Button Section
        const buttonSection = document.createElement('div');
        buttonSection.style.cssText = `
            display: flex;
            gap: 10px;
            margin-top: 4px;
            padding-top: 20px;
            border-top: 1px solid #e5e7eb;
        `;

        if (isUserSelected) {
            // Show unchoose button
            buttonSection.innerHTML = `
                <button id="pqms-unchoose-btn" style="
                    flex: 1;
                    padding: 10px 18px;
                    background: #ffffff;
                    color: #dc2626;
                    border: 1px solid #dc2626;
                    border-radius: 6px;
                    font-size: 14px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.15s;
                ">Clear Selection</button>
            `;
        } else {
            // Show select button
            buttonSection.innerHTML = `
                <button id="pqms-select-btn" style="
                    flex: 1;
                    padding: 10px 18px;
                    background: #111827;
                    color: #ffffff;
                    border: 1px solid #111827;
                    border-radius: 6px;
                    font-size: 14px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.15s;
                ">Confirm Selection</button>
            `;
        }

        // Submission History Section
        const historySection = document.createElement('div');
        historySection.style.cssText = `
            margin-top: 24px;
            padding-top: 24px;
            border-top: 1px solid #e5e7eb;
        `;

        const historyHeader = document.createElement('div');
        historyHeader.style.cssText = `
            font-weight: 600;
            margin-bottom: 12px;
            color: #374151;
            font-size: 13px;
            text-transform: uppercase;
            letter-spacing: 0.025em;
        `;
        historyHeader.textContent = 'Submission History';

        const historyTable = document.createElement('div');
        historyTable.style.cssText = `
            border: 1px solid #e5e7eb;
            border-radius: 6px;
            overflow: hidden;
            max-height: 400px;
            overflow-y: auto;
            background: #ffffff;
            flex: 1;
            min-height: 300px;
        `;

        if (history.length === 0) {
            historyTable.innerHTML = `
                <div style="
                    padding: 40px 20px;
                    text-align: center;
                    color: #9ca3af;
                    font-size: 13px;
                ">No submissions yet</div>
            `;
        } else {
            // Create table
            const table = document.createElement('table');
            table.style.cssText = `
                width: 100%;
                border-collapse: collapse;
                font-size: 13px;
            `;

            // Table header
            table.innerHTML = `
                <thead>
                    <tr style="background: #f9fafb; border-bottom: 1px solid #e5e7eb;">
                        <th style="padding: 10px 12px; text-align: left; font-weight: 600; color: #6b7280; text-transform: uppercase; font-size: 11px; letter-spacing: 0.05em;">Ticket</th>
                        <th style="padding: 10px 12px; text-align: left; font-weight: 600; color: #6b7280; text-transform: uppercase; font-size: 11px; letter-spacing: 0.05em;">Subject</th>
                        <th style="padding: 10px 12px; text-align: left; font-weight: 600; color: #6b7280; text-transform: uppercase; font-size: 11px; letter-spacing: 0.05em;">Group</th>
                        <th style="padding: 10px 12px; text-align: center; font-weight: 600; color: #6b7280; text-transform: uppercase; font-size: 11px; letter-spacing: 0.05em;">Status</th>
                    </tr>
                </thead>
                <tbody></tbody>
            `;

            const tbody = table.querySelector('tbody');

            // Show only last 10 submissions
            history.slice(0, 10).forEach((item, index) => {
                const row = document.createElement('tr');
                row.style.cssText = `
                    border-bottom: ${index < Math.min(history.length - 1, 9) ? '1px solid #f3f4f6' : 'none'};
                `;

                // Status badge colors
                let statusColor = '#6b7280';
                let statusBg = '#f3f4f6';
                if (item.status === 'Open') {
                    statusColor = '#6b7280';
                    statusBg = '#f3f4f6';
                } else if (item.status === 'Pending') {
                    statusColor = '#6b7280';
                    statusBg = '#f3f4f6';
                } else if (item.status === 'Solved') {
                    statusColor = '#166534';
                    statusBg = '#dcfce7';
                }

                row.innerHTML = `
                    <td style="padding: 10px 12px; color: #111827; font-weight: 500; font-family: 'Courier New', monospace;">#${item.ticketId}</td>
                    <td style="padding: 10px 12px; color: #374151; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${item.ticketSubject}">${item.ticketSubject}</td>
                    <td style="padding: 10px 12px; color: #6b7280; font-size: 12px;">${item.groupName}</td>
                    <td style="padding: 10px 12px; text-align: center;">
                        <span style="
                            display: inline-block;
                            padding: 3px 10px;
                            background: ${statusBg};
                            color: ${statusColor};
                            border-radius: 12px;
                            font-size: 11px;
                            font-weight: 600;
                        ">${item.status}</span>
                    </td>
                `;
                tbody.appendChild(row);
            });

            historyTable.appendChild(table);
        }

        historySection.appendChild(historyHeader);
        historySection.appendChild(historyTable);

        // Assemble dashboard - Main content first
        content.appendChild(countersSection);
        content.appendChild(historySection);
        dashboard.appendChild(header);
        dashboard.appendChild(content);

        // Create settings panel (initially hidden)
        const settingsPanel = document.createElement('div');
        settingsPanel.id = 'pqms-settings-panel';
        settingsPanel.style.cssText = `
            position: absolute;
            top: 0;
            right: 0;
            width: 300px;
            height: 100%;
            background: #ffffff;
            border-left: 1px solid #e5e7eb;
            padding: 24px;
            transform: translateX(100%);
            transition: transform 0.3s ease;
            z-index: 100001;
            overflow-y: auto;
        `;

        // Settings panel content
        const settingsContent = document.createElement('div');
        settingsContent.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 24px;
        `;

        const settingsHeader = document.createElement('div');
        settingsHeader.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
        `;
        settingsHeader.innerHTML = `
            <h3 style="
                font-size: 16px;
                font-weight: 600;
                color: #111827;
                margin: 0;
            ">Settings</h3>
            <button id="pqms-settings-close" style="
                background: transparent;
                border: none;
                color: #6b7280;
                width: 24px;
                height: 24px;
                cursor: pointer;
                font-size: 18px;
                display: flex;
                align-items: center;
                justify-content: center;
            ">&times;</button>
        `;

        settingsContent.appendChild(settingsHeader);
        settingsContent.appendChild(opsSection);
        settingsContent.appendChild(nameSection);
        if (isUserSelected) {
            settingsContent.appendChild(statusSection);
        }
        settingsContent.appendChild(buttonSection);

        settingsPanel.appendChild(settingsContent);
        dashboard.appendChild(settingsPanel);

        // Add backdrop - Professional style
        const backdrop = document.createElement('div');
        backdrop.id = 'pqms-dashboard-backdrop';
        backdrop.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.4);
            backdrop-filter: blur(2px);
            z-index: 99999;
        `;

        // Add event listeners
        document.body.appendChild(backdrop);
        document.body.appendChild(dashboard);

        // Close button hover effects
        closeBtn.addEventListener('click', closePQMSDashboard);
        closeBtn.addEventListener('mouseenter', function() {
            this.style.background = '#f3f4f6';
            this.style.color = '#111827';
        });
        closeBtn.addEventListener('mouseleave', function() {
            this.style.background = 'transparent';
            this.style.color = '#6b7280';
        });

        // Settings button
        settingsBtn.addEventListener('click', function() {
            const panel = document.getElementById('pqms-settings-panel');
            if (panel.style.transform === 'translateX(100%)') {
                panel.style.transform = 'translateX(0)';
            } else {
                panel.style.transform = 'translateX(100%)';
            }
        });
        settingsBtn.addEventListener('mouseenter', function() {
            this.style.background = '#f3f4f6';
            this.style.color = '#111827';
        });
        settingsBtn.addEventListener('mouseleave', function() {
            this.style.background = 'transparent';
            this.style.color = '#6b7280';
        });

        // Settings panel close button
        const settingsCloseBtn = document.getElementById('pqms-settings-close');
        settingsCloseBtn.addEventListener('click', function() {
            const panel = document.getElementById('pqms-settings-panel');
            panel.style.transform = 'translateX(100%)';
        });
        settingsCloseBtn.addEventListener('mouseenter', function() {
            this.style.background = '#f3f4f6';
            this.style.color = '#111827';
        });
        settingsCloseBtn.addEventListener('mouseleave', function() {
            this.style.background = 'transparent';
            this.style.color = '#6b7280';
        });

        // Backdrop click to close
        backdrop.addEventListener('click', closePQMSDashboard);

        // OPS ID dropdown change
        const opsSelect = document.getElementById('pqms-ops-select');
        opsSelect.addEventListener('change', function() {
            const selectedOpsId = this.value;
            const nameDisplay = document.getElementById('pqms-name-display');
            
            if (selectedOpsId && PQMS_USERS[selectedOpsId]) {
                nameDisplay.textContent = PQMS_USERS[selectedOpsId];
                nameDisplay.style.color = '#111827';
            } else {
                nameDisplay.textContent = 'No operator selected';
                nameDisplay.style.color = '#9ca3af';
            }
        });

        // Select button
        const selectBtn = document.getElementById('pqms-select-btn');
        if (selectBtn) {
            selectBtn.addEventListener('click', function() {
                const opsSelect = document.getElementById('pqms-ops-select');
                const selectedOpsId = opsSelect.value;

                if (!selectedOpsId) {
                    showPQMSToast('Please select an OPS ID', 'error');
                    return;
                }

                const name = PQMS_USERS[selectedOpsId];
                savePQMSSelectedUser(selectedOpsId, name);
                showPQMSToast(`User selected: ${name}`, 'success');
                
                // Refresh dashboard
                closePQMSDashboard();
                setTimeout(() => createPQMSDashboard(), 100);
            });

            selectBtn.addEventListener('mouseenter', function() {
                this.style.background = '#1f2937';
                this.style.borderColor = '#1f2937';
            });
            selectBtn.addEventListener('mouseleave', function() {
                this.style.background = '#111827';
                this.style.borderColor = '#111827';
            });
        }

        // Unchoose button
        const unchooseBtn = document.getElementById('pqms-unchoose-btn');
        if (unchooseBtn) {
            unchooseBtn.addEventListener('click', function() {
                clearPQMSSelectedUser();
                showPQMSToast('User unselected', 'info');
                
                // Refresh dashboard
                closePQMSDashboard();
                setTimeout(() => createPQMSDashboard(), 100);
            });

            unchooseBtn.addEventListener('mouseenter', function() {
                this.style.background = '#fef2f2';
                this.style.borderColor = '#dc2626';
            });
            unchooseBtn.addEventListener('mouseleave', function() {
                this.style.background = '#ffffff';
                this.style.borderColor = '#dc2626';
            });
        }

        // Escape key to close
        const escapeHandler = (e) => {
            if (e.key === 'Escape') {
                closePQMSDashboard();
                document.removeEventListener('keydown', escapeHandler);
            }
        };
        document.addEventListener('keydown', escapeHandler);
    }

    function closePQMSDashboard() {
        const dashboard = document.getElementById('pqms-dashboard');
        const backdrop = document.getElementById('pqms-dashboard-backdrop');
        
        if (dashboard) dashboard.remove();
        if (backdrop) backdrop.remove();
    }

    // ============================================================================
    // PQMS STATUS SELECTION MENU (Professional Dropdown)
    // ============================================================================

    function showPQMSStatusMenu(event) {
        // Prevent default behavior
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }

        // Check if menu already exists - toggle it
        const existingMenu = document.getElementById('pqms-status-menu');
        if (existingMenu) {
            closePQMSStatusMenu();
            return;
        }

        // Find the PQMS button to position menu near it
        const pqmsButton = event?.currentTarget || document.querySelector('.pqms-button');
        if (!pqmsButton) {
            console.error('PQMS: Could not find button to position menu');
            return;
        }

        const buttonRect = pqmsButton.getBoundingClientRect();

        // Create dropdown menu (tree-like)
        const menu = document.createElement('div');
        menu.id = 'pqms-status-menu';
        menu.style.cssText = `
            position: fixed;
            left: ${buttonRect.right + 12}px;
            top: ${buttonRect.top}px;
            background: #ffffff;
            border: 1px solid #d1d5db;
            border-radius: 6px;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12), 0 2px 4px rgba(0, 0, 0, 0.08);
            z-index: 100001;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            min-width: 220px;
            overflow: hidden;
            animation: slideInMenu 0.15s ease-out;
        `;

        // Add animation
        const style = document.createElement('style');
        style.id = 'pqms-menu-animation';
        style.textContent = `
            @keyframes slideInMenu {
                from {
                    opacity: 0;
                    transform: translateX(-8px);
                }
                to {
                    opacity: 1;
                    transform: translateX(0);
                }
            }
        `;
        document.head.appendChild(style);

        // Header
        const header = document.createElement('div');
        header.style.cssText = `
            background: #f9fafb;
            border-bottom: 1px solid #e5e7eb;
            padding: 10px 16px;
            font-size: 12px;
            font-weight: 600;
            color: #6b7280;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        `;
        header.textContent = 'Select Status';

        // Options container
        const optionsContainer = document.createElement('div');
        optionsContainer.style.cssText = `
            padding: 4px 0;
        `;

        // Status options - professional corporate styling
        const statuses = [
            { name: 'Open', shortcut: 'Alt+O', icon: '○' },
            { name: 'Pending', shortcut: 'Alt+P', icon: '◐' },
            { name: 'Solved', shortcut: 'Alt+S', icon: '⏺' }
        ];

        statuses.forEach((status, index) => {
            const item = document.createElement('button');
            item.style.cssText = `
                width: 100%;
                padding: 10px 16px;
                background: transparent;
                border: none;
                border-bottom: ${index < statuses.length - 1 ? '1px solid #f3f4f6' : 'none'};
                cursor: pointer;
                transition: background-color 0.1s ease;
                display: flex;
                justify-content: space-between;
                align-items: center;
                font-size: 14px;
                color: #1f2937;
                text-align: left;
            `;

            const leftSection = document.createElement('div');
            leftSection.style.cssText = `
                display: flex;
                align-items: center;
                gap: 10px;
            `;

            const icon = document.createElement('span');
            icon.textContent = status.icon;
            icon.style.cssText = `
                font-size: 16px;
                color: #6b7280;
                width: 20px;
                text-align: center;
            `;

            const statusName = document.createElement('span');
            statusName.textContent = status.name;
            statusName.style.cssText = `
                font-weight: 500;
            `;

            leftSection.appendChild(icon);
            leftSection.appendChild(statusName);

            const shortcut = document.createElement('span');
            shortcut.textContent = status.shortcut;
            shortcut.style.cssText = `
                font-size: 11px;
                color: #9ca3af;
                font-family: 'Courier New', monospace;
                background: #f3f4f6;
                padding: 2px 6px;
                border-radius: 3px;
            `;

            item.appendChild(leftSection);
            item.appendChild(shortcut);

            item.addEventListener('click', () => {
                closePQMSStatusMenu();
                submitToPQMS(status.name);
            });

            item.addEventListener('mouseenter', function() {
                this.style.backgroundColor = '#f3f4f6';
            });

            item.addEventListener('mouseleave', function() {
                this.style.backgroundColor = 'transparent';
            });

            optionsContainer.appendChild(item);
        });

        // Assemble menu
        menu.appendChild(header);
        menu.appendChild(optionsContainer);

        // Create invisible backdrop (for click-away)
        const backdrop = document.createElement('div');
        backdrop.id = 'pqms-status-menu-backdrop';
        backdrop.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: transparent;
            z-index: 100000;
        `;

        // Add to page
        document.body.appendChild(backdrop);
        document.body.appendChild(menu);

        // Click backdrop to close
        backdrop.addEventListener('click', closePQMSStatusMenu);

        // Escape key to close
        const escapeHandler = (e) => {
            if (e.key === 'Escape') {
                closePQMSStatusMenu();
                document.removeEventListener('keydown', escapeHandler);
            }
        };
        document.addEventListener('keydown', escapeHandler);
    }
	
	// Function to get current ticket ID from URL
        function getCurrentTicketId() {
            // Extract ticket ID from URL pattern like /agent/tickets/12345
            const match = window.location.pathname.match(/\/agent\/tickets\/(\d+)/);
            return match ? match[1] : null;
        }
	
    function closePQMSStatusMenu() {
        const menu = document.getElementById('pqms-status-menu');
        const backdrop = document.getElementById('pqms-status-menu-backdrop');
        const style = document.getElementById('pqms-menu-animation');
        
        if (menu) menu.remove();
        if (backdrop) backdrop.remove();
        if (style) style.remove();
    }

    // SVG icon for PQMS button (upload/send icon)
    const pqmsSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
        <polyline points="17 8 12 3 7 8"></polyline>
        <line x1="12" y1="3" x2="12" y2="15"></line>
    </svg>`;

    function createPQMSButton() {
        const listItem = document.createElement('li');
        listItem.className = 'nav-list-item';

        const button = document.createElement('button');
        button.className = 'pqms-button StyledBaseNavItem-sc-zvo43f-0 StyledNavButton-sc-f5ux3-0 gvFgbC dXnFqH';
        button.setAttribute('tabindex', '0');
        button.setAttribute('data-garden-id', 'chrome.nav_button');
        button.setAttribute('data-garden-version', '9.5.2');
        button.setAttribute('title', 'Submit to PQMS as "Felt Unsafe"');

        const iconWrapper = document.createElement('div');
        iconWrapper.style.display = 'flex';
        iconWrapper.style.alignItems = 'center';

        const icon = document.createElement('div');
        icon.innerHTML = pqmsSVG;
        icon.firstChild.setAttribute('width', '26');
        icon.firstChild.setAttribute('height', '26');
        icon.firstChild.setAttribute('data-garden-id', 'chrome.nav_item_icon');
        icon.firstChild.setAttribute('data-garden-version', '9.5.2');
        icon.firstChild.classList.add('StyledBaseIcon-sc-1moykgb-0', 'StyledNavItemIcon-sc-7w9rpt-0', 'eWlVPJ', 'YOjtB');

        const text = document.createElement('span');
        text.textContent = 'Submit PQMS';
        text.className = 'StyledNavItemText-sc-13m84xl-0 iOGbGR';
        text.setAttribute('data-garden-id', 'chrome.nav_item_text');
        text.setAttribute('data-garden-version', '9.5.2');

        iconWrapper.appendChild(icon);
        iconWrapper.appendChild(text);
        button.appendChild(iconWrapper);
        listItem.appendChild(button);

        return listItem;
    }

})();
