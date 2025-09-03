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
    let halaToastShownForTicket = null; // Track which ticket ID had the toast shown

    // Performance optimization variables
    let domCache = new Map();
    let debounceTimers = new Map();

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
            
            /* Toast notification styling */
            .hala-toast {
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background-color: #2f3941;
                color: white;
                padding: 20px 40px;
                border-radius: 8px;
                font-size: 18px;
                font-weight: bold;
                z-index: 10000;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
                animation: hala-toast-fade-in 0.3s ease-in-out;
            }
            
            @keyframes hala-toast-fade-in {
                from {
                    opacity: 0;
                    transform: translate(-50%, -50%) scale(0.8);
                }
                to {
                    opacity: 1;
                    transform: translate(-50%, -50%) scale(1);
                }
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

            // Fallback to prompt if automatic extraction fails
            const name = prompt('Please enter your full name (for RUMI functionality):');
            if (name && name.trim()) {
                username = name.trim();
                localStorage.setItem('zendesk_agent_username', username);
                console.log(`🔐 Agent name set: ${username}`);
            }
            resolve(username || '');
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
            if (label && (label.textContent.trim() === 'Reason (Quality/GO/Billing)*'||label.textContent.trim() === 'Reason (Quality/GO/Billing)')) {
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

        // Determine the appropriate SSOC incident source value based on subject content
        let targetValue = 'Voice Care'; // Default value
        let ruleMatched = 'Default';

        const subjectLower = subjectText.toLowerCase();

        // Check for "dispute" or "contact us" -> Customer Email
        if (subjectLower.includes('dispute')) {
            targetValue = 'Customer Email';
            ruleMatched = 'Dispute';
        } else if (subjectLower.includes('contact us')) {
            targetValue = 'Customer Email';
            ruleMatched = 'Contact Us';
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
                if (label && (label.textContent.trim() === 'Reason (Quality/GO/Billing)*'||label.textContent.trim() === 'Reason (Quality/GO/Billing)')) {
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
Description:\u00A0 
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

    // Function to check for "ghc_provider_hala-rides" tag and show HALA Taxi toast
    function checkForHalaProviderTag() {
        console.log('🔍 Checking for ghc_provider_hala-rides tag...');
        
        // Get current ticket ID to track if toast was already shown
        const currentTicketId = getCurrentTicketId();
        if (!currentTicketId) {
            console.log('⚠️ Could not determine ticket ID - skipping HALA provider check');
            return;
        }
        
        // Check if toast was already shown for this ticket
        if (halaToastShownForTicket === currentTicketId) {
            console.log(`✅ HALA toast already shown for ticket ${currentTicketId} - skipping`);
            return;
        }
        
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
            console.log(`🎯 Found ghc_provider_hala-rides tag for ticket ${currentTicketId} - showing HALA Taxi toast`);
            showHalaToast();
            // Mark this ticket as having shown the toast
            halaToastShownForTicket = currentTicketId;
            console.log(`✅ Marked ticket ${currentTicketId} as having shown HALA toast`);
        } else {
            console.log('⚠️ ghc_provider_hala-rides tag not found in tags');
        }
    }
    
    // Function to show HALA Taxi toast notification
    function showHalaToast() {
        // Remove any existing toast
        const existingToast = document.querySelector('.hala-toast');
        if (existingToast) {
            existingToast.remove();
        }
        
        // Create toast element
        const toast = document.createElement('div');
        toast.className = 'hala-toast';
        toast.textContent = 'HALA Taxi';
        
        // Add toast to body
        document.body.appendChild(toast);
        
        console.log('🍞 HALA Taxi toast displayed');
        
        // Auto-remove toast after 3 seconds
        setTimeout(() => {
            if (toast && toast.parentElement) {
                toast.remove();
                console.log('🍞 HALA Taxi toast removed automatically');
            }
        }, 3000);
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
        button.addEventListener('click', function(e) {
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
        button.addEventListener('click', function(e) {
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
            
            // Check for HALA provider tag after additional delay to ensure tags are loaded
            setTimeout(() => {
                checkForHalaProviderTag();
            }, 1000);
        }, 500);
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
                
                // Check for HALA provider tag after additional delay to ensure tags are loaded
                setTimeout(() => {
                    checkForHalaProviderTag();
                }, 1000);
            }, 1000);
        }

        // Initial attempt if already on a views page
        if (isViewsPage()) {
            setTimeout(() => {
                createViewsToggleButton();
                loadViewsToggleState();
            }, 1000);
        }
        
        console.log('✅ RUMI script initialized and waiting for ticket and views pages');
    }

    // Wait for page to load and then initialize
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
