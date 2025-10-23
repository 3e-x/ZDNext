// ==UserScript==
// @name         SLackdesk
// @namespace    http://tampermonkey.net/
// @version      2.1
// @description  View Zendesk ticket JSON data from Slack, using Zendesk session automatically
// @author       You
// @match        https://app.slack.com/*
// @grant        GM_xmlhttpRequest
// @connect      gocareem.zendesk.com
// ==/UserScript==

(function() {
    'use strict';

    const CITY_FIELD_ID = 37033787;
    const COUNTRY_FIELD_ID = 58670148;
    const BOOKING_ID_FIELD_ID = 37016168;
    const INCIDENT_TYPE_FIELD_ID = 360000457487;
    const INCIDENT_TYPE_FIELD_ENDPOINT = `https://gocareem.zendesk.com/api/v2/ticket_fields/${INCIDENT_TYPE_FIELD_ID}.json`;
    const REPORT_TIME_OFFSET_HOURS = 3;

    let incidentTypeOptionsCache = null;
    let incidentTypeOptionsPromise = null;

    const BASE_TEMPLATE_HTML = '<div class="p-rich_text_block" dir="auto"><div class="p-rich_text_section"><b data-stringify-type="bold">Incident Category: [Critical]</b><br aria-hidden="true"><b data-stringify-type="bold">Date report received: </b>{{DATE_REPORT_RECEIVED}}<br aria-hidden="true"><b data-stringify-type="bold">Time report received: </b>{{TIME_REPORT_RECEIVED}}<br aria-hidden="true"><b data-stringify-type="bold">Date of incident: </b><br aria-hidden="true"><b data-stringify-type="bold">Time of incident: </b><br aria-hidden="true"><b data-stringify-type="bold">Case status:&nbsp; </b>{{CASE_STATUS}}<br aria-hidden="true"><b data-stringify-type="bold">Incident type: </b>{{INCIDENT_TYPE}}<br aria-hidden="true"><b data-stringify-type="bold">L4+ classification: No</b><br aria-hidden="true"><b data-stringify-type="bold">Key incident details:</b><br aria-hidden="true"></div><ul data-stringify-type="unordered-list" data-list-tree="true" class="p-rich_text_list p-rich_text_list__bullet p-rich_text_list--nested" data-indent="0" data-border="0"><li data-stringify-indent="0" data-stringify-border="0"></li><li data-stringify-indent="0" data-stringify-border="0"><b data-stringify-type="bold">City: </b>{{CITY}}<b data-stringify-type="bold">, </b><b data-stringify-type="bold">Country: </b>{{COUNTRY}}</li><li data-stringify-indent="0" data-stringify-border="0"><b data-stringify-type="bold">Booking ID: </b>{{BOOKING_ID}}</li><li data-stringify-indent="0" data-stringify-border="0"><b data-stringify-type="bold">Zendesk ticket ID: </b>{{ZENDESK_ID}}</li><li data-stringify-indent="0" data-stringify-border="0"><b data-stringify-type="bold">L4+ classification</b>: No<ul data-stringify-type="unordered-list" data-list-tree="true" class="p-rich_text_list p-rich_text_list__bullet p-rich_text_list--nested" data-indent="1" data-border="0"><li data-stringify-indent="1" data-stringify-border="0"><b data-stringify-type="bold">Reason</b>: N/A</li></ul></li></ul><div class="p-rich_text_section">.........................................................................<br aria-hidden="true"></div><ul data-stringify-type="unordered-list" data-list-tree="true" class="p-rich_text_list p-rich_text_list__bullet p-rich_text_list--nested" data-indent="0" data-border="0"><li data-stringify-indent="0" data-stringify-border="0">Captain history rating: </li><li data-stringify-indent="0" data-stringify-border="0">Tenure : </li><li data-stringify-indent="0" data-stringify-border="0">Trip count:<ul data-stringify-type="unordered-list" data-list-tree="true" class="p-rich_text_list p-rich_text_list__bullet p-rich_text_list--nested" data-indent="1" data-border="0"><li data-stringify-indent="1" data-stringify-border="0">MONTHLY / TOTAL TRIPS: </li></ul></li><li data-stringify-indent="0" data-stringify-border="0">Captain safety history:<ul data-stringify-type="unordered-list" data-list-tree="true" class="p-rich_text_list p-rich_text_list__bullet p-rich_text_list--nested" data-indent="1" data-border="0"><li data-stringify-indent="1" data-stringify-border="0">SSOC related:<ul data-stringify-type="unordered-list" data-list-tree="true" class="p-rich_text_list p-rich_text_list__bullet p-rich_text_list--nested" data-indent="2" data-border="0"><li data-stringify-indent="2" data-stringify-border="0">Non Critical: </li></ul></li><li data-stringify-indent="1" data-stringify-border="0">Not SSOC related:<ul data-stringify-type="unordered-list" data-list-tree="true" class="p-rich_text_list p-rich_text_list__bullet p-rich_text_list--nested" data-indent="2" data-border="0"><li data-stringify-indent="2" data-stringify-border="0"><span data-stringify-type="text">&nbsp;</span></li></ul></li></ul></li></ul><div class="p-rich_text_section"><span aria-label="&nbsp;" class="c-mrkdwn__br" data-stringify-type="paragraph-break"></span><span aria-label="&nbsp;" class="c-mrkdwn__br" data-stringify-type="paragraph-break"></span>.........................................................................<br aria-hidden="true"></div><ul data-stringify-type="unordered-list" data-list-tree="true" class="p-rich_text_list p-rich_text_list__bullet p-rich_text_list--nested" data-indent="0" data-border="0"><li data-stringify-indent="0" data-stringify-border="0">Customer history rating: </li><li data-stringify-indent="0" data-stringify-border="0">Trip count:<ul data-stringify-type="unordered-list" data-list-tree="true" class="p-rich_text_list p-rich_text_list__bullet p-rich_text_list--nested" data-indent="1" data-border="0"><li data-stringify-indent="1" data-stringify-border="0">Past 6 months: </li></ul></li><li data-stringify-indent="0" data-stringify-border="0">Customer history:<ul data-stringify-type="unordered-list" data-list-tree="true" class="p-rich_text_list p-rich_text_list__bullet p-rich_text_list--nested" data-indent="1" data-border="0"><li data-stringify-indent="1" data-stringify-border="0"><span data-stringify-type="text">&nbsp;</span></li></ul></li></ul><div class="p-rich_text_section"><span aria-label="&nbsp;" class="c-mrkdwn__br" data-stringify-type="paragraph-break"></span>.........................................................................<br aria-hidden="true"><b data-stringify-type="bold">Customer investigation summary:</b><span aria-label="&nbsp;" class="c-mrkdwn__br" data-stringify-type="paragraph-break"></span>Follow Up:<span aria-label="&nbsp;" class="c-mrkdwn__br" data-stringify-type="paragraph-break"></span><b data-stringify-type="bold">Action with customer: </b><br aria-hidden="true"><b data-stringify-type="bold">Captain investigation summary:</b><span aria-label="&nbsp;" class="c-mrkdwn__br" data-stringify-type="paragraph-break"></span><b data-stringify-type="bold">Action with captain: </b><span aria-label="&nbsp;" class="c-mrkdwn__br" data-stringify-type="paragraph-break"></span>******************************************************************************</div></div>';

    function escapeHtml(value) {
        if (value == null) {
            return '';
        }
        return String(value).replace(/[&<>"]/g, (char) => {
            switch (char) {
            case '&':
                return '&amp;';
            case '<':
                return '&lt;';
            case '>':
                return '&gt;';
            case '"':
                return '&quot;';
            case '\'':
                return '&#39;';
            default:
                return char;
            }
        });
    }

    function capitalizeWords(value) {
        const lower = value.toLowerCase();
        return lower.split(/([\s-]+)/).map((segment) => {
            if (!segment || /[\s-]+/.test(segment)) {
                return segment;
            }
            return segment.charAt(0).toUpperCase() + segment.slice(1);
        }).join('');
    }

    function normalizeCountryValue(value) {
        if (value == null) {
            return '';
        }

        let raw = String(value).trim();
        const match = /^__dc_country___(.+?)(__+)?$/i.exec(raw);
        if (match) {
            raw = match[1];
        } else if (raw.toLowerCase().startsWith('__dc_country___')) {
            raw = raw.replace(/^__dc_country___/i, '');
        }

        raw = raw.replace(/^_+|_+$/g, '');
        raw = raw.replace(/_/g, ' ');
        raw = raw.replace(/\s+/g, ' ').trim();

        if (!raw) {
            return '';
        }

        return capitalizeWords(raw);
    }

    function normalizeCityValue(value) {
        if (value == null) {
            return '';
        }

        let raw = String(value).trim();
        raw = raw.replace(/_/g, ' ');
        raw = raw.replace(/\s+/g, ' ').trim();

        if (!raw) {
            return '';
        }

        return capitalizeWords(raw);
    }

    function formatTicketDate(timestamp) {
        if (!timestamp) {
            return '';
        }
        const date = new Date(timestamp);
        if (Number.isNaN(date.getTime())) {
            return '';
        }
        const offsetDate = new Date(date.getTime() + REPORT_TIME_OFFSET_HOURS * 60 * 60 * 1000);
        return new Intl.DateTimeFormat('en-US', {
            month: 'short',
            day: '2-digit',
            year: 'numeric',
            timeZone: 'UTC'
        }).format(offsetDate);
    }

    function formatTicketTime(timestamp) {
        if (!timestamp) {
            return '';
        }
        const date = new Date(timestamp);
        if (Number.isNaN(date.getTime())) {
            return '';
        }
        const offsetDate = new Date(date.getTime() + REPORT_TIME_OFFSET_HOURS * 60 * 60 * 1000);
        return new Intl.DateTimeFormat('en-GB', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
            timeZone: 'UTC'
        }).format(offsetDate);
    }

    function buildTemplate({
        city,
        country,
        bookingId,
        zendeskId,
        dateReportReceived,
        timeReportReceived,
        caseStatus,
        incidentType
    }) {
        const replacements = {
            '{{CITY}}': escapeHtml(city || 'N/A'),
            '{{COUNTRY}}': escapeHtml(country || 'N/A'),
            '{{BOOKING_ID}}': escapeHtml(bookingId || 'N/A'),
            '{{ZENDESK_ID}}': escapeHtml(zendeskId || 'N/A'),
            '{{DATE_REPORT_RECEIVED}}': escapeHtml(dateReportReceived || 'N/A'),
            '{{TIME_REPORT_RECEIVED}}': escapeHtml(timeReportReceived || 'N/A'),
            '{{CASE_STATUS}}': escapeHtml(caseStatus || 'N/A'),
            '{{INCIDENT_TYPE}}': escapeHtml(incidentType || 'N/A')
        };

        let html = BASE_TEMPLATE_HTML;
        for (const [placeholder, value] of Object.entries(replacements)) {
            html = html.split(placeholder).join(value);
        }
        return html;
    }

    function getCustomFieldValue(ticket, fieldId) {
        const fields = (ticket && Array.isArray(ticket.custom_fields)) ? ticket.custom_fields : [];
        const field = fields.find((item) => item && Number(item.id) === fieldId);
        if (!field || field.value == null) {
            return '';
        }
        if (typeof field.value === 'string') {
            return field.value;
        }
        return String(field.value);
    }

    async function fetchIncidentTypeOptions() {
        if (incidentTypeOptionsCache) {
            return incidentTypeOptionsCache;
        }
        if (!incidentTypeOptionsPromise) {
            incidentTypeOptionsPromise = (async () => {
                const resp = await fetch(INCIDENT_TYPE_FIELD_ENDPOINT, {
                    credentials: 'include'
                });
                if (!resp.ok) {
                    throw new Error(`HTTP ${resp.status} - ${resp.statusText}`);
                }
                const data = await resp.json();
                const options = data && data.ticket_field && Array.isArray(data.ticket_field.custom_field_options)
                    ? data.ticket_field.custom_field_options
                    : [];
                incidentTypeOptionsCache = options;
                return options;
            })().catch((err) => {
                console.warn('Unable to load incident type options:', err);
                throw err;
            }).finally(() => {
                incidentTypeOptionsPromise = null;
            });
        }
        try {
            return await incidentTypeOptionsPromise;
        } catch (err) {
            console.warn('Falling back to cached incident type options due to fetch error:', err);
            return incidentTypeOptionsCache || [];
        }
    }

    async function resolveIncidentTypeName(value) {
        if (!value) {
            return 'N/A';
        }
        try {
            const options = await fetchIncidentTypeOptions();
            const match = options.find((option) => option && option.value === value);
            if (match && match.name) {
                return match.name;
            }
        } catch (err) {
            console.warn('Unable to resolve incident type name:', err);
        }
        return 'N/A';
    }

    function findComposerElement() {
        const selectors = [
            '[data-qa="message_input"] .ql-editor',
            '.p-message_input .ql-editor',
            '.c-texty_input .ql-editor',
            '.c-wysiwyg_container__content .ql-editor'
        ];

        for (const selector of selectors) {
            const el = document.querySelector(selector);
            if (el) {
                return el;
            }
        }

        return null;
    }

    function getQuillInstanceFrom(element) {
        let current = element;
        while (current) {
            if (current.__quill) {
                return current.__quill;
            }
            current = current.parentElement;
        }
        return null;
    }

    function insertTemplateIntoComposer(html) {
        const composer = findComposerElement();
        if (!composer) {
            return false;
        }

        composer.focus({ preventScroll: true });

        const quill = getQuillInstanceFrom(composer);
        if (quill && quill.clipboard && typeof quill.clipboard.convert === 'function' && typeof quill.setContents === 'function') {
            try {
                const delta = quill.clipboard.convert(html);
                quill.setContents(delta, 'user');
                const cursorPos = quill.getLength();
                quill.setSelection(cursorPos, cursorPos, 'silent');
                return true;
            } catch (err) {
                console.warn('Unable to insert via Quill clipboard:', err);
            }
        }

        try {
            document.execCommand('selectAll', false, null);
            const execOk = document.execCommand('insertHTML', false, html);
            if (execOk) {
                composer.dispatchEvent(new Event('input', { bubbles: true }));
                return true;
            }
        } catch (err) {
            console.warn('execCommand insertHTML failed:', err);
        }

        composer.innerHTML = html;
        composer.dispatchEvent(new Event('input', { bubbles: true }));

        const selection = window.getSelection();
        if (selection) {
            try {
                selection.removeAllRanges();
                const range = document.createRange();
                range.selectNodeContents(composer);
                range.collapse(false);
                selection.addRange(range);
            } catch (err) {
                console.warn('Unable to adjust selection:', err);
            }
        }

        return true;
    }

    const STYLE_ID = 'manager-escalation-styles';

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) {
            return;
        }
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
#manager-escalation-drawer {
    display: none;
    position: fixed;
    z-index: 100010;
    min-width: 320px;
    max-width: 360px;
    padding: 16px 20px 20px;
    border-radius: 12px;
    border: 1px solid rgba(29, 28, 29, 0.12);
    background: var(--sk_primary_background, #ffffff);
    box-shadow: 0px 24px 60px rgba(0, 0, 0, 0.22);
    font-family: Slack-Lato, Lato, sans-serif;
    color: var(--sk_primary_foreground, #1d1c1d);
    transform-origin: top right;
    opacity: 0;
    transform: translateY(8px) scale(0.98);
    transition: opacity 120ms ease, transform 120ms ease;
}

#manager-escalation-drawer.is-open {
    display: block;
    opacity: 1;
    transform: translateY(0) scale(1);
}

#manager-escalation-drawer:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px rgba(18, 100, 163, 0.5);
}

#manager-escalation-drawer .me-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 12px;
}

#manager-escalation-drawer .me-title {
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 0.01em;
}

#manager-escalation-drawer .me-subtitle {
    font-size: 13px;
    color: var(--sk_foreground_max_s, rgba(94, 94, 94, 0.92));
    margin-bottom: 16px;
    line-height: 1.45;
}

#manager-escalation-drawer .me-close {
    border: none;
    background: none;
    color: inherit;
    padding: 6px;
    border-radius: 6px;
}

#manager-escalation-drawer .me-close:hover,
#manager-escalation-drawer .me-close:focus-visible {
    background: rgba(29, 28, 29, 0.07);
}

#manager-escalation-drawer .me-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
}

#manager-escalation-drawer .me-label {
    font-size: 13px;
    font-weight: 600;
}

#manager-escalation-drawer .me-input-row {
    display: flex;
    gap: 10px;
    align-items: center;
}

#manager-escalation-drawer input[type="text"] {
    flex: 1;
    border-radius: 8px;
    border: 1px solid rgba(29, 28, 29, 0.3);
    background: var(--sk_primary_background, #fff);
    color: inherit;
    padding: 10px 12px;
    font-size: 14px;
    line-height: 20px;
}

#manager-escalation-drawer input[type="text"]:focus-visible {
    border-color: rgba(18, 100, 163, 0.6);
    box-shadow: 0 0 0 1px rgba(18, 100, 163, 0.55);
    outline: none;
}

#manager-escalation-drawer .me-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 16px;
}

#manager-escalation-drawer .me-primary {
    border: none;
    border-radius: 8px;
    background: var(--sk_button_primary_background, #611f69);
    color: var(--sk_button_primary_text, #fff);
    font-weight: 600;
    font-size: 14px;
    padding: 9px 18px;
    letter-spacing: 0.015em;
    transition: background 120ms ease, box-shadow 120ms ease;
}

#manager-escalation-drawer .me-primary:hover:not([disabled]) {
    cursor: pointer;
    background: var(--sk_button_primary_background_hover, #4a154b);
}

#manager-escalation-drawer .me-primary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
}

#manager-escalation-drawer .me-secondary {
    border: none;
    background: none;
    color: var(--sk_primary_foreground, #1d1c1d);
    padding: 9px 12px;
    font-size: 14px;
    border-radius: 8px;
}

#manager-escalation-drawer .me-secondary:hover,
#manager-escalation-drawer .me-secondary:focus-visible {
    background: rgba(29, 28, 29, 0.07);
}

#manager-escalation-drawer .me-status {
    margin-top: 12px;
    font-size: 12px;
    min-height: 18px;
    color: var(--sk_foreground_low, #616061);
    display: flex;
    align-items: center;
    gap: 6px;
}

#manager-escalation-drawer .me-status[data-status="loading"] {
    color: #1264a3;
}

#manager-escalation-drawer .me-status[data-status="success"] {
    color: #2eb67d;
}

#manager-escalation-drawer .me-status[data-status="error"] {
    color: #d1453b;
}

#manager-escalation-drawer .me-status[data-status="warning"] {
    color: #e8912d;
}

#manager-escalation-drawer .me-shortcut-hint {
    margin-top: 18px;
    font-size: 11px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--sk_foreground_max, rgba(97, 96, 97, 0.9));
}

#manager-escalation-drawer .me-shortcut-hint code {
    background: rgba(29, 28, 29, 0.08);
    color: inherit;
    border-radius: 6px;
    padding: 2px 6px;
    font-size: 11px;
}
        `;
        document.head.appendChild(style);
    }

    injectStyles();

    const drawer = document.createElement('div');
    drawer.id = 'manager-escalation-drawer';
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-modal', 'false');
    drawer.setAttribute('aria-hidden', 'true');
    drawer.innerHTML = `
        <div class="me-header">
            <div>
                <div class="me-title" id="manager-escalation-title">Manager Escalation Helper</div>
            </div>
            <button type="button" class="c-button-unstyled me-close" aria-label="Close manager escalation helper" data-role="close">×</button>
        </div>
        <p class="me-subtitle">Stay signed in to <strong>gocareem.zendesk.com</strong> so the ticket details can be fetched automatically.</p>
        <div class="me-field">
            <label class="me-label" for="manager-escalation-ticket">Zendesk ticket ID</label>
            <div class="me-input-row">
                <input id="manager-escalation-ticket" type="text" placeholder="e.g. 119060571" autocomplete="off" data-role="ticket-input" />
                <button type="button" class="me-primary" data-role="generate">Generate</button>
            </div>
        </div>
        <div class="me-actions">
            <button type="button" class="me-secondary" data-role="close-secondary">Close</button>
        </div>
        <div class="me-status" data-role="status" data-status="idle"></div>
        <div class="me-shortcut-hint">Shortcut: <code>Alt + E</code> or <code>Alt + ث</code></div>
    `;

    document.body.appendChild(drawer);

    const ticketInput = drawer.querySelector('[data-role="ticket-input"]');
    const fetchBtn = drawer.querySelector('[data-role="generate"]');
    const closeButtons = drawer.querySelectorAll('[data-role="close"], [data-role="close-secondary"]');
    const statusDiv = drawer.querySelector('[data-role="status"]');

    let drawerOpen = false;

    function setStatus(message, state = 'idle') {
        statusDiv.textContent = message;
        statusDiv.setAttribute('data-status', state);
    }

    function focusComposer() {
        const composer = findComposerElement();
        if (composer) {
            composer.focus({ preventScroll: true });
        }
    }

    function positionDrawer() {
        const anchor = document.querySelector('.c-texty_buttons') || document.querySelector('.p-message_pane .c-wysiwyg_container, .p-message_pane .c-texty_input, [data-qa="message_input"]');
        if (!drawerOpen) {
            return;
        }
        if (anchor) {
            const rect = anchor.getBoundingClientRect();
            const drawerRect = drawer.getBoundingClientRect();
            let top = rect.top - drawerRect.height - 16;
            if (top < 16) {
                top = rect.bottom + 16;
            }
            let left = rect.left + rect.width - drawerRect.width;
            if (left < 16) {
                left = 16;
            }
            const maxLeft = window.innerWidth - drawerRect.width - 16;
            drawer.style.top = `${Math.min(top, window.innerHeight - drawerRect.height - 16)}px`;
            drawer.style.left = `${Math.min(Math.max(left, 16), maxLeft)}px`;
        } else {
            drawer.style.top = `${window.innerHeight - 220}px`;
            drawer.style.left = `${window.innerWidth - 380}px`;
        }
    }

    const repositionOnScroll = () => positionDrawer();

    function onDocumentMouseUp(event) {
        if (!drawerOpen) {
            return;
        }
        if (drawer.contains(event.target)) {
            return;
        }
        closeDrawer(true);
    }

    function onDocumentKeyUp(event) {
        if (!drawerOpen) {
            return;
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            closeDrawer(true);
        }
    }

    function openDrawer() {
        if (drawerOpen) {
            ticketInput.focus({ preventScroll: true });
            return;
        }
        drawerOpen = true;
        drawer.classList.add('is-open');
        drawer.setAttribute('aria-hidden', 'false');
        positionDrawer();
        window.addEventListener('resize', positionDrawer);
        document.addEventListener('scroll', repositionOnScroll, true);
        document.addEventListener('mouseup', onDocumentMouseUp, true);
        document.addEventListener('keyup', onDocumentKeyUp, true);
        requestAnimationFrame(() => {
            positionDrawer();
            ticketInput.focus({ preventScroll: true });
        });
    }

    function closeDrawer(shouldRefocus = false) {
        if (!drawerOpen) {
            return;
        }
        drawerOpen = false;
        drawer.classList.remove('is-open');
        drawer.setAttribute('aria-hidden', 'true');
        window.removeEventListener('resize', positionDrawer);
        document.removeEventListener('scroll', repositionOnScroll, true);
        document.removeEventListener('mouseup', onDocumentMouseUp, true);
        document.removeEventListener('keyup', onDocumentKeyUp, true);
        fetchBtn.disabled = false;
        setStatus('', 'idle');
        ticketInput.value = '';
        if (shouldRefocus) {
            focusComposer();
        }
    }

    closeButtons.forEach((btn) => {
        btn.addEventListener('click', () => closeDrawer(true));
    });

    drawer.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            closeDrawer(true);
        }
    });

    function handleGlobalShortcut(event) {
        if (!event.altKey || event.metaKey || event.ctrlKey) {
            return;
        }
        const key = (event.key || '').toLowerCase();
        if (key === 'e' || key === 'ث') {
            event.preventDefault();
            openDrawer();
        }
    }

    document.addEventListener('keydown', handleGlobalShortcut, true);

    async function fetchTicket() {
        const id = ticketInput.value.trim();
        if (!/^\d+$/.test(id)) {
            setStatus('Invalid ticket ID.', 'error');
            return;
        }

        setStatus('Fetching ticket data...', 'loading');
        fetchBtn.disabled = true;

        try {
            // Fetch ticket details
            const [ticketResp, commentsResp] = await Promise.all([
                fetch(`https://gocareem.zendesk.com/api/v2/tickets/${id}.json`, {
                    credentials: 'include'
                }),
                fetch(`https://gocareem.zendesk.com/api/v2/tickets/${id}/comments.json`, {
                    credentials: 'include'
                })
            ]);

            if (!ticketResp.ok) {
                throw new Error(`HTTP ${ticketResp.status} - ${ticketResp.statusText}`);
            }

            const ticketData = await ticketResp.json();
            const ticket = ticketData && ticketData.ticket;

            if (!ticket) {
                throw new Error('Ticket payload missing.');
            }

            // Process comments if available
            let investigationDetails = {
                customerSummary: '',
                customerAction: '',
                captainSummary: '',
                captainAction: ''
            };

            if (commentsResp.ok) {
                const commentsData = await commentsResp.json();
                const comments = commentsData.comments || [];

                // Process comments in reverse order (oldest first) to find the most recent valid data
                for (let i = comments.length - 1; i >= 0; i--) {
                    const comment = comments[i];
                    if (comment && comment.body) {
                        const details = parseCommentForDetails(comment.body);

                        // Only update if we found new information
                        if (details.customerSummary && !investigationDetails.customerSummary) {
                            investigationDetails.customerSummary = details.customerSummary;
                        }
                        if (details.customerAction && !investigationDetails.customerAction) {
                            investigationDetails.customerAction = details.customerAction;
                        }
                        if (details.captainSummary && !investigationDetails.captainSummary) {
                            investigationDetails.captainSummary = details.captainSummary;
                        }
                        if (details.captainAction && !investigationDetails.captainAction) {
                            investigationDetails.captainAction = details.captainAction;
                        }
                    }
                }
            }

            const rawCountry = getCustomFieldValue(ticket, COUNTRY_FIELD_ID);
            const rawCity = getCustomFieldValue(ticket, CITY_FIELD_ID);
            const rawBookingId = getCustomFieldValue(ticket, BOOKING_ID_FIELD_ID);
            const incidentTypeValue = getCustomFieldValue(ticket, INCIDENT_TYPE_FIELD_ID);

            const country = normalizeCountryValue(rawCountry) || 'N/A';
            const city = normalizeCityValue(rawCity) || 'N/A';
            const bookingId = rawBookingId ? String(rawBookingId).trim() : 'N/A';
            const zendeskId = (ticket.id != null ? String(ticket.id) : id) || 'N/A';
            const dateReportReceived = formatTicketDate(ticket.created_at) || 'N/A';
            const timeReportReceived = formatTicketTime(ticket.created_at) || 'N/A';
            const caseStatus = ticket.status ? String(ticket.status).toUpperCase() : 'N/A';
            const incidentType = (await resolveIncidentTypeName(incidentTypeValue)) || 'N/A';

            let templateHtml = buildTemplate({
                city,
                country,
                bookingId,
                zendeskId,
                dateReportReceived,
                timeReportReceived,
                caseStatus,
                incidentType
            });

            // Update template with investigation details
            templateHtml = updateTemplateWithDetails(templateHtml, investigationDetails);

            if (insertTemplateIntoComposer(templateHtml)) {
                setStatus('✅ Escalation template inserted into Slack composer. Review before sending.', 'success');
                setTimeout(() => closeDrawer(true), 320);
            } else {
                setStatus('⚠️ Escalation template could not be inserted automatically. Copy it from the console.', 'warning');
                console.info('[Manager Escalation Template]', templateHtml);
            }

        } catch (err) {
            setStatus(`❌ ${err.message}`, 'error');
        } finally {
            fetchBtn.disabled = false;
        }
    }

    function parseCommentForDetails(comment) {
        const lowerComment = comment.toLowerCase();
        let customerSummary = '';
        let customerAction = '';
        let captainSummary = '';
        let captainAction = '';

        // Check if this is a comment with the expected format
        if (lowerComment.includes('kindly refer to the ticket below') ||
            lowerComment.includes('please be informed that we placed a call indicating the following details')) {

            // Extract customer section
            const customerMatch = comment.match(/(?:\*{1,3}customer:\*{0,3}[\s\n]+(?:call summary and reaction|1\. call summary and reaction):\s*([\s\S]*?))(?:\n\s*\*{0,3}other actions:|\n\s*2\.\s*other actions:|$)/i);
            if (customerMatch && customerMatch[1] && !/no\s*call|not\s*yet/i.test(customerMatch[1])) {
                customerSummary = customerMatch[1].trim();

                // Extract customer action
                const customerActionMatch = comment.match(/(?:other actions:|2\. other actions:)([\s\S]*?)(?:requested for pair blocking|$)/i);
                if (customerActionMatch && customerActionMatch[1]) {
                    customerAction = customerActionMatch[1].trim();
                }
            }

            // Extract captain section
            const captainMatch = comment.match(/(?:\*{1,3}captain:\*{0,3}[\s\n]+(?:call summary and reaction|1\. call summary and reaction):\s*([\s\S]*?))(?:\n\s*\*{0,3}other actions:|\n\s*2\.\s*other actions:|$)/i);
            if (captainMatch && captainMatch[1] && !/no\s*call|not\s*yet/i.test(captainMatch[1])) {
                captainSummary = captainMatch[1].trim();

                // Extract captain action
                const captainActionMatch = comment.match(/(?:other actions:|2\. other actions:)([\s\S]*?)(?:\*{1,3}customer:|$)/is);
                if (captainActionMatch && captainActionMatch[1]) {
                    captainAction = captainActionMatch[1].trim();
                }
            }
        }

        // If we didn't find valid data in the first format, look for "new actions taken" comments
        if (!customerSummary && !captainSummary && comment.includes('**new actions taken:**')) {
            // Extract customer section from new actions
            const newCustomerMatch = comment.match(/_\*{1,3}customer:_[\s\n]*- call summary and reaction:([\s\S]*?)(?:other actions|$)/i);
            if (newCustomerMatch && newCustomerMatch[1] && !/no\s*call|not\s*yet/i.test(newCustomerMatch[1])) {
                customerSummary = newCustomerMatch[1].trim();

                // Extract customer action from new actions
                const newCustomerActionMatch = comment.match(/other actions:([\s\S]*?)(?:requested for pair blocking|$)/i);
                if (newCustomerActionMatch && newCustomerActionMatch[1]) {
                    customerAction = newCustomerActionMatch[1].trim();
                }
            }

            // Extract captain section from new actions
            const newCaptainMatch = comment.match(/_\*{1,3}captain:_[\s\n]*- call summary and reaction:([\s\S]*?)(?:other actions|$)/i);
            if (newCaptainMatch && newCaptainMatch[1] && !/no\s*call|not\s*yet/i.test(newCaptainMatch[1])) {
                captainSummary = newCaptainMatch[1].trim();

                // Extract captain action from new actions
                const newCaptainActionMatch = comment.match(/other actions:([\s\S]*?)(?:_\*{1,3}customer:|$)/is);
                if (newCaptainActionMatch && newCaptainActionMatch[1]) {
                    captainAction = newCaptainActionMatch[1].trim();
                }
            }
        }

        return {
            customerSummary,
            customerAction,
            captainSummary,
            captainAction
        };
    }

    function updateTemplateWithDetails(template, details) {
        // Create the replacement content with exact formatting
        let replacement = [
            '<b data-stringify-type="bold">Customer investigation summary:</b>',
            details.customerSummary || '',
            'Follow Up:',
            '<b data-stringify-type="bold">Action with customer: </b>' + (details.customerAction || ''),
            '<b data-stringify-type="bold">Captain investigation summary:</b>',
            details.captainSummary || '',
            '<b data-stringify-type="bold">Action with captain: </b>' + (details.captainAction || '')
        ].join('\n');

        // Find the section to replace
        const startMarker = '<b data-stringify-type="bold">Customer investigation summary:</b>';
        const endMarker = '******************************************************************************';

        const startIndex = template.indexOf(startMarker);
        const endIndex = template.indexOf(endMarker, startIndex);

        if (startIndex !== -1 && endIndex !== -1) {
            const beforeSection = template.substring(0, startIndex);
            const afterSection = template.substring(endIndex);
            return beforeSection + replacement + '\n' + afterSection;
        }

        return template;
    }

    fetchBtn.onclick = fetchTicket;
    ticketInput.addEventListener('keydown', e => { if (e.key === 'Enter') fetchTicket(); });

    const BUTTON_ID = 'manager-escalation-button';

    function ensureSlackButton() {
        const container = document.querySelector('.c-texty_buttons');
        if (!container) {
            return false;
        }

        if (container.querySelector(`#${BUTTON_ID}`)) {
            return true;
        }

        const button = document.createElement('button');
        button.id = BUTTON_ID;
        button.type = 'button';
        button.className = 'c-button-unstyled c-icon_button c-icon_button--size_small c-wysiwyg_container__button c-icon_button--default';
        button.setAttribute('aria-label', 'Manager escalation helper');
        button.setAttribute('data-qa', 'manager_escalation_button');
        button.setAttribute('data-sk', 'tooltip_parent');
        button.setAttribute('title', 'Manager escalation helper');
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('fill', 'rgba(29, 28, 29, 0.7)');
        svg.setAttribute('stroke', 'rgba(29, 28, 29, 0.7)');
        svg.setAttribute('stroke-width', '0.00016');
        svg.setAttribute('height', '18');
        svg.setAttribute('width', '18');
        svg.setAttribute('viewBox', '0 0 16 16');
        svg.setAttribute('version', '1.2');
        svg.setAttribute('baseProfile', 'tiny');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('focusable', 'false');
        svg.style.display = 'block';
        svg.style.transform = 'translateY(1px)';

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', `M5.781,1.363c0-0.567,0.46-1.027,1.027-1.027c0.567,0,1.027,0.46,1.027,1.027c0,0.567-0.46,1.027-1.027,1.027
      C6.241,2.39,5.781,1.93,5.781,1.363z M15.75,3.415c0,1.19-1.03,2.015-1.759,2.015c-0.668,0-1.513,0-1.513,0
      c-0.225,0-0.298,0.036-0.429,0.152L5.924,11.69c-0.494,0.465-1.092,0.654-1.586,0.654c-0.494,0-2.092,0-2.092,0
      c-1.287,0-1.996-1.138-1.996-2.039s0.709-1.963,1.891-1.963c0,0,1.174,0,1.175,0c0.356,0,0.378-0.008,0.559-0.189l1.921-1.921H5.792
      v-2.64c0-1.364,2.033-1.379,2.033,0v0.647l0,0h0v0l2.21-2.208c0.379-0.379,1.014-0.581,1.508-0.581h2.388
      C14.712,1.453,15.75,2.238,15.75,3.415z M14.712,3.4c0-0.349-0.352-0.933-0.875-0.933h-2.149c-0.439,0-0.694,0.032-0.952,0.29
      L4.459,9.034c-0.232,0.232-0.5,0.349-0.907,0.349H2.156c-0.455,0-0.894,0.326-0.894,0.906c0,0.581,0.461,1.023,0.984,1.023h2.036
      c0.407,0,0.724-0.099,0.973-0.349l6.173-6.173c0.315-0.315,0.557-0.392,1.104-0.392h1.292C14.462,4.399,14.712,3.749,14.712,3.4z`);

        svg.appendChild(path);
        button.appendChild(svg);

        button.addEventListener('click', () => {
            openDrawer();
        });

        const slashButton = container.querySelector('[data-qa="slash_commands_composer_button"]');
        if (slashButton) {
            slashButton.insertAdjacentElement('afterend', button);
        } else {
            container.appendChild(button);
        }
        return true;
    }

    const observer = new MutationObserver(() => {
        if (ensureSlackButton()) {
            observer.disconnect();
        }
        if (!document.body.contains(drawer)) {
            document.addEventListener('keydown', handleGlobalShortcut, true);
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    ensureSlackButton();

})();
