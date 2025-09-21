// ==UserScript==
// @name         Jira Auto-Select Fields
// @namespace    http://tampermonkey.net/
// @version      1.3
// @description  Automatically sets fields and parses booking information on paste, adds ticket copy button
// @author       Your Name
// @match        https://careem-tech.atlassian.net/servicedesk/customer/portal/14/create/*
// @match        https://careem-tech.atlassian.net/servicedesk/customer/portal/14/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    let lastUrl = location.href;
    let copyButtonAdded = false;


    function addCopyButton() {

        if (copyButtonAdded) return;


        const ticketElement = document.querySelector('[data-test-id="requestKey"]');
        if (!ticketElement) return;


        const ticketNumber = ticketElement.textContent;
        const ticketUrl = ticketElement.href;


        // Create hyperlink copy button (with link icon)
        const copyLinkButton = document.createElement('button');
        copyLinkButton.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 24 24" style="vertical-align: middle;">
                <path fill="currentColor" d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H6.9C4.01 7 1.9 9.11 1.9 12s2.11 5 5 5H11v-1.9H6.9c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm5-6h4.1c2.89 0 5 2.11 5 5s-2.11 5-5 5H13v-1.9h4.1c1.71 0 3.1-1.39 3.1-3.1 0-1.71-1.39-3.1-3.1-3.1H13V7z"/>
            </svg>
        `;
        copyLinkButton.style.marginLeft = '8px';
        copyLinkButton.style.padding = '6px';
        copyLinkButton.style.backgroundColor = 'transparent';
        copyLinkButton.style.color = '#6B778C';
        copyLinkButton.style.border = 'none';
        copyLinkButton.style.borderRadius = '3px';
        copyLinkButton.style.cursor = 'pointer';
        copyLinkButton.style.display = 'inline-flex';
        copyLinkButton.style.alignItems = 'center';
        copyLinkButton.style.transition = 'color 0.2s, background-color 0.2s';
        copyLinkButton.title = 'Copy formatted link';

        // Create plain text copy button (with clipboard icon)
        const copyTextButton = document.createElement('button');
        copyTextButton.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 24 24" style="vertical-align: middle;">
                <path fill="currentColor" d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
            </svg>
        `;
        copyTextButton.style.marginLeft = '4px';
        copyTextButton.style.padding = '6px';
        copyTextButton.style.backgroundColor = 'transparent';
        copyTextButton.style.color = '#42526E';
        copyTextButton.style.border = 'none';
        copyTextButton.style.borderRadius = '3px';
        copyTextButton.style.cursor = 'pointer';
        copyTextButton.style.display = 'inline-flex';
        copyTextButton.style.alignItems = 'center';
        copyTextButton.style.transition = 'color 0.2s, background-color 0.2s';
        copyTextButton.title = 'Copy ticket number';

        // Hover effects for link button
        copyLinkButton.addEventListener('mouseover', () => {
            copyLinkButton.style.backgroundColor = '#F4F5F7';
            copyLinkButton.style.color = '#0052CC';
        });
        copyLinkButton.addEventListener('mouseout', () => {
            copyLinkButton.style.backgroundColor = 'transparent';
            copyLinkButton.style.color = '#6B778C';
        });

        // Hover effects for text button
        copyTextButton.addEventListener('mouseover', () => {
            copyTextButton.style.backgroundColor = '#F4F5F7';
            copyTextButton.style.color = '#0052CC';
        });
        copyTextButton.addEventListener('mouseout', () => {
            copyTextButton.style.backgroundColor = 'transparent';
            copyTextButton.style.color = '#42526E';
        });


        // Link button click handler
        copyLinkButton.addEventListener('click', async () => {
            const hyperLink = `[${ticketNumber}](${ticketUrl})`;
            const formattedText = `Requested for pair Blocking: Yes (${hyperLink})`;
            
            try {
                await navigator.clipboard.writeText(formattedText);
                
                const originalHTML = copyLinkButton.innerHTML;
                copyLinkButton.innerHTML = `
                    <svg width="18" height="18" viewBox="0 0 24 24" style="vertical-align: middle;">
                        <path fill="currentColor" d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/>
                    </svg>
                `;
                copyLinkButton.style.color = '#00875A';
                
                setTimeout(() => {
                    copyLinkButton.innerHTML = originalHTML;
                    copyLinkButton.style.color = '#6B778C';
                }, 2000);
            } catch (err) {
                console.error('Failed to copy formatted link:', err);
            }
        });

        // Text button click handler
        copyTextButton.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(ticketNumber);
                
                const originalHTML = copyTextButton.innerHTML;
                copyTextButton.innerHTML = `
                    <svg width="18" height="18" viewBox="0 0 24 24" style="vertical-align: middle;">
                        <path fill="currentColor" d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/>
                    </svg>
                `;
                copyTextButton.style.color = '#00875A';
                
                setTimeout(() => {
                    copyTextButton.innerHTML = originalHTML;
                    copyTextButton.style.color = '#42526E';
                }, 2000);
            } catch (err) {
                console.error('Failed to copy ticket number:', err);
            }
        });


        // Insert both buttons after the ticket element
        ticketElement.parentNode.insertBefore(copyLinkButton, ticketElement.nextSibling);
        ticketElement.parentNode.insertBefore(copyTextButton, copyLinkButton.nextSibling);
        copyButtonAdded = true;
    }


    function addGlobalPasteListener() {
        // Add global paste event listener to document
        document.addEventListener('paste', async (e) => {
            // Only process paste events on the create page
            if (!location.href.includes('/create/')) return;
            
            // Get pasted text
            const pastedText = e.clipboardData.getData('text');
            
            // Check if the pasted text contains booking information
            if (pastedText.includes('BOOKING INFO') || 
                pastedText.includes('User ID') || 
                pastedText.includes('Captain ID')) {
                
                setTimeout(async () => {
                    await parseAndFillIds(pastedText);
                    await setAllValues();
                }, 10);
            }
        });
    }


    function checkAndInitialize() {
        const currentUrl = location.href;
        

        if (currentUrl !== lastUrl) {
            copyButtonAdded = false;
            lastUrl = currentUrl;
        }

        if (!currentUrl.includes('/create/')) {

            if (document.querySelector('[data-test-id="requestKey"]')) {
                addCopyButton();
            }
        }
    }


    const observer = new MutationObserver((mutations) => {
        checkAndInitialize();
    });


    observer.observe(document.body, {
        childList: true,
        subtree: true
    });


    checkAndInitialize();
    
    // Add global paste listener once when script loads
    addGlobalPasteListener();


    async function parseAndFillIds(text) {

        const bookingIdMatch = text.match(/BOOKING INFO\s*ID#\s*(\d+)/);
        const bookingId = bookingIdMatch ? bookingIdMatch[1] : '';


        const userIdMatch = text.match(/User ID\s*(\d+)/);
        const userId = userIdMatch ? userIdMatch[1] : '';


        const captainIdMatch = text.match(/Captain ID\s*(\d+)/);
        const captainId = captainIdMatch ? captainIdMatch[1] : '';


        async function setIdFieldValue(selector, value) {
            const input = document.querySelector(selector);
            if (input && value) {

                input.focus();
                

                const setValue = (val) => {

                    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, val);
                    

                    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
                    

                    const keyEvent = new KeyboardEvent('keydown', {
                        bubbles: true,
                        cancelable: true,
                        key: val[val.length - 1],
                        keyCode: val[val.length - 1].charCodeAt(0)
                    });
                    input.dispatchEvent(keyEvent);
                };


                setValue(value + '1');
                

                await new Promise(resolve => setTimeout(resolve, 100));
                

                setValue(value);
                

                input.blur();
                input.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));
                

                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }


        if (bookingId) {
            await setIdFieldValue('#customfield_10139', bookingId);
        }

        if (userId) {
            await setIdFieldValue('#customfield_10079', userId);
        }

        if (captainId) {
            await setIdFieldValue('#customfield_10611', captainId);
        }
    }


    function setValue(input, value) {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeInputValueSetter.call(input, value);

        const event = new Event('input', { bubbles: true });
        input.dispatchEvent(event);
    }


    function simulateSelectAndClick(input, value) {
        return new Promise((resolve) => {

            input.focus();


            setValue(input, value);


            input.dispatchEvent(new KeyboardEvent('keydown', { key: value[0] }));
            input.dispatchEvent(new KeyboardEvent('keypress', { key: value[0] }));
            input.dispatchEvent(new KeyboardEvent('keyup', { key: value[0] }));


            const options = document.querySelectorAll('[role="option"]');
            const targetOption = Array.from(options).find(opt => 
                opt.textContent.toLowerCase().includes(value.toLowerCase())
            );
            if (targetOption) {
                targetOption.click();
            }
            resolve();
        });
    }


    function setJustificationText(text) {
        const editor = document.querySelector('#ak-editor-textarea');
        if (!editor) return;


        editor.focus();


        editor.innerHTML = `<p data-prosemirror-content-type="node" data-prosemirror-node-name="paragraph" data-prosemirror-node-block="true">${text}</p>`;


        const inputEvent = new InputEvent('input', {
            bubbles: true,
            cancelable: true,
        });
        editor.dispatchEvent(inputEvent);


        const blurEvent = new FocusEvent('blur', {
            bubbles: true,
            cancelable: true,
        });
        editor.dispatchEvent(blurEvent);
    }


    async function setAllValues() {

        const servingSiteInput = document.querySelector('#customfield_10142');
        const teamInput = document.querySelector('#customfield_10126');
        const yourTeamInput = document.querySelector('#customfield_13273');

        if (!servingSiteInput || !teamInput || !yourTeamInput) {
            console.error('Could not find all required fields');
            return;
        }


        try {
            await simulateSelectAndClick(servingSiteInput, 'Jordan');
            await simulateSelectAndClick(teamInput, 'Care');
            await simulateSelectAndClick(yourTeamInput, 'Extensya');
            setJustificationText('SSOC');
        } catch (error) {
            console.error('Error setting values:', error);
        }
    }
})(); 
