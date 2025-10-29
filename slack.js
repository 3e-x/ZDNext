// ==UserScript==
// @name         Slackdesk
// @namespace    http://tampermonkey.net/
// @version      2.2
// @description  View Zendesk ticket JSON data from Slack, using Zendesk session automatically
// @author       You
// @match        https://app.slack.com/*
// @grant        GM_xmlhttpRequest
// @connect      gocareem.zendesk.com
// @connect      solutions.careempartner.com
// ==/UserScript==

(function() {
    'use strict';

    const CITY_FIELD_ID = 37033787;
    const COUNTRY_FIELD_ID = 58670148;
    const BOOKING_ID_FIELD_ID = 37016168;
    const INCIDENT_TYPE_FIELD_ID = 360000457487;
    const INCIDENT_TYPE_FIELD_ENDPOINT = `https://gocareem.zendesk.com/api/v2/ticket_fields/${INCIDENT_TYPE_FIELD_ID}.json`;
    const REPORT_TIME_OFFSET_HOURS = 3;
    const CAREEM_PARTNER_EMAIL = "shirin.obeidat@extensya.com";

    let incidentTypeOptionsCache = null;
    let incidentTypeOptionsPromise = null;

    const BASE_TEMPLATE_HTML = '<div class="p-rich_text_block" dir="auto"><div class="p-rich_text_section"><b data-stringify-type="bold">Incident Category: [Critical]</b><br aria-hidden="true"><b data-stringify-type="bold">Date report received: </b>{{DATE_REPORT_RECEIVED}}<br aria-hidden="true"><b data-stringify-type="bold">Time report received: </b>{{TIME_REPORT_RECEIVED}}<br aria-hidden="true"><b data-stringify-type="bold">Date of incident: </b>{{DATE_OF_INCIDENT}}<br aria-hidden="true"><b data-stringify-type="bold">Time of incident: </b>{{TIME_OF_INCIDENT}}<br aria-hidden="true"><b data-stringify-type="bold">Case status:&nbsp; </b>{{CASE_STATUS}}<br aria-hidden="true"><b data-stringify-type="bold">L4+ classification: No</b><br aria-hidden="true"><b data-stringify-type="bold">Key incident details:</b><br aria-hidden="true"></div><ul data-stringify-type="unordered-list" data-list-tree="true" class="p-rich_text_list p-rich_text_list__bullet p-rich_text_list--nested" data-indent="0" data-border="0"><li data-stringify-indent="0" data-stringify-border="0"><b data-stringify-type="bold">Incident type: </b>{{INCIDENT_TYPE}}</li><li data-stringify-indent="0" data-stringify-border="0"><b data-stringify-type="bold">City: </b>{{CITY}}<b data-stringify-type="bold">, Country: </b>{{COUNTRY}}</li><li data-stringify-indent="0" data-stringify-border="0"><b data-stringify-type="bold">Booking ID: </b>{{BOOKING_ID}}</li><li data-stringify-indent="0" data-stringify-border="0"><b data-stringify-type="bold">Zendesk ticket ID: </b>{{ZENDESK_ID}}</li><li data-stringify-indent="0" data-stringify-border="0"><b data-stringify-type="bold">L4+ classification</b>: No<ul data-stringify-type="unordered-list" data-list-tree="true" class="p-rich_text_list p-rich_text_list__bullet p-rich_text_list--nested" data-indent="1" data-border="0"><li data-stringify-indent="1" data-stringify-border="0"><b data-stringify-type="bold">Reason</b>: N/A</li></ul></li></ul><div class="p-rich_text_section">.........................................................................<br aria-hidden="true"></div><ul data-stringify-type="unordered-list" data-list-tree="true" class="p-rich_text_list p-rich_text_list__bullet p-rich_text_list--nested" data-indent="0" data-border="0"><li data-stringify-indent="0" data-stringify-border="0">Captain history rating: </li><li data-stringify-indent="0" data-stringify-border="0">Tenure : </li><li data-stringify-indent="0" data-stringify-border="0">Trip count:<ul data-stringify-type="unordered-list" data-list-tree="true" class="p-rich_text_list p-rich_text_list__bullet p-rich_text_list--nested" data-indent="1" data-border="0"><li data-stringify-indent="1" data-stringify-border="0">MONTHLY / TOTAL TRIPS: </li></ul></li><li data-stringify-indent="0" data-stringify-border="0">Captain safety history:<ul data-stringify-type="unordered-list" data-list-tree="true" class="p-rich_text_list p-rich_text_list__bullet p-rich_text_list--nested" data-indent="1" data-border="0"><li data-stringify-indent="1" data-stringify-border="0">SSOC related:<ul data-stringify-type="unordered-list" data-list-tree="true" class="p-rich_text_list p-rich_text_list__bullet p-rich_text_list--nested" data-indent="2" data-border="0"><li data-stringify-indent="2" data-stringify-border="0">Non Critical: </li></ul></li><li data-stringify-indent="1" data-stringify-border="0">Not SSOC related:<ul data-stringify-type="unordered-list" data-list-tree="true" class="p-rich_text_list p-rich_text_list__bullet p-rich_text_list--nested" data-indent="2" data-border="0"><li data-stringify-indent="2" data-stringify-border="0"><span data-stringify-type="text">&nbsp;</span></li></ul></li></ul></li><li data-stringify-indent="0" data-stringify-border="0"><span data-stringify-type="text">&nbsp;</span></li></ul><div class="p-rich_text_section">.........................................................................<br aria-hidden="true"></div><ul data-stringify-type="unordered-list" data-list-tree="true" class="p-rich_text_list p-rich_text_list__bullet p-rich_text_list--nested" data-indent="0" data-border="0"><li data-stringify-indent="0" data-stringify-border="0">Customer history rating: </li><li data-stringify-indent="0" data-stringify-border="0">Trip count:<ul data-stringify-type="unordered-list" data-list-tree="true" class="p-rich_text_list p-rich_text_list__bullet p-rich_text_list--nested" data-indent="1" data-border="0"><li data-stringify-indent="1" data-stringify-border="0">Past 6 months: </li></ul></li><li data-stringify-indent="0" data-stringify-border="0">Customer history:<ul data-stringify-type="unordered-list" data-list-tree="true" class="p-rich_text_list p-rich_text_list__bullet p-rich_text_list--nested" data-indent="1" data-border="0"><li data-stringify-indent="1" data-stringify-border="0"><span data-stringify-type="text">&nbsp;</span></li></ul></li></ul><div class="p-rich_text_section">.........................................................................<br aria-hidden="true"><b data-stringify-type="bold">Customer investigation summary:</b><span aria-label="&nbsp;" class="c-mrkdwn__br" data-stringify-type="paragraph-break"></span>Follow Up:<span aria-label="&nbsp;" class="c-mrkdwn__br" data-stringify-type="paragraph-break"></span><b data-stringify-type="bold">Action with customer: </b><br aria-hidden="true"><b data-stringify-type="bold">Captain investigation summary:</b><span aria-label="&nbsp;" class="c-mrkdwn__br" data-stringify-type="paragraph-break"></span><b data-stringify-type="bold">Action with captain: </b><span aria-label="&nbsp;" class="c-mrkdwn__br" data-stringify-type="paragraph-break"></span>******************************************************************************</div></div>';

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
                               dateOfIncident,
                               timeOfIncident,
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
            '{{DATE_OF_INCIDENT}}': escapeHtml(dateOfIncident || 'N/A'),
            '{{TIME_OF_INCIDENT}}': escapeHtml(timeOfIncident || 'N/A'),
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

    async function fetchBookingTimestamp(bookingId) {
        if (!bookingId || bookingId === 'N/A') {
            return null;
        }

        try {
            const url = `https://solutions.careempartner.com/trip/overview/details.json?bookingId=${bookingId}`;
            console.log(`[Careem Partner] Fetching booking data from: ${url}`);

            // Use GM_xmlhttpRequest to bypass CORS
            const response = await new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: url,
                    headers: {
                        'Accept': 'application/json'
                    },
                    onload: (response) => resolve(response),
                    onerror: (response) => reject(new Error('Network error')),
                    ontimeout: () => reject(new Error('Request timeout'))
                });
            });

            console.log(`[Careem Partner] Response status: ${response.status}`);
            console.log(`[Careem Partner] Response headers:`, response.responseHeaders);

            // Check if we got JSON or HTML
            const contentType = response.responseHeaders.toLowerCase();
            const isJson = contentType.includes('application/json');
            const isHtml = contentType.includes('text/html');

            if (isHtml) {
                console.log('[Careem Partner] Received HTML response (login required)');
                console.log('='.repeat(80));
                console.log(response.responseText.substring(0, 1000));
                console.log('='.repeat(80));

                throw new Error('Authentication required. Please manually sign in to solutions.careempartner.com with email: ' + CAREEM_PARTNER_EMAIL + ' in a separate browser tab, then try again.');
            }

            if (response.status !== 200) {
                throw new Error(`HTTP ${response.status} - ${response.statusText}`);
            }

            const data = JSON.parse(response.responseText);
            console.log('[Careem Partner] Booking data:', data);

            // Check for bookedTimestamp in multiple possible locations
            let bookedTimestamp = null;

            if (data && data.data && data.data.booking && data.data.booking.bookedTimestamp) {
                bookedTimestamp = data.data.booking.bookedTimestamp;
            } else if (data && data.booking && data.booking.bookedTimestamp) {
                bookedTimestamp = data.booking.bookedTimestamp;
            } else if (data && data.bookedTimestamp) {
                bookedTimestamp = data.bookedTimestamp;
            }

            if (bookedTimestamp) {
                console.log('[Careem Partner] Found bookedTimestamp:', bookedTimestamp);
                return bookedTimestamp;
            } else {
                console.warn('[Careem Partner] bookedTimestamp not found in response');
                return null;
            }
        } catch (err) {
            console.error('[Careem Partner] Error fetching booking timestamp:', err);
            return null;
        }
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
        <p class="me-subtitle">Stay signed in to <strong>gocareem.zendesk.com</strong> and <strong>solutions.careempartner.com</strong> so the ticket details can be fetched automatically.</p>
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
        <div class="me-shortcut-hint">Shortcut: <code>Alt + E</code> or <code>Alt + ع</code></div>
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
        if (key === 'e' || key === 'ع') {
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

                // Parse all comments to extract investigation details
                investigationDetails = parseCommentsForDetails(comments);
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

            // Fetch booking timestamp
            let dateOfIncident = 'N/A';
            let timeOfIncident = 'N/A';

            if (bookingId && bookingId !== 'N/A') {
                setStatus('Fetching booking timestamp...', 'loading');
                const bookedTimestamp = await fetchBookingTimestamp(bookingId);

                if (bookedTimestamp) {
                    dateOfIncident = formatTicketDate(bookedTimestamp) || 'N/A';
                    timeOfIncident = formatTicketTime(bookedTimestamp) || 'N/A';
                }
            }

            let templateHtml = buildTemplate({
                city,
                country,
                bookingId,
                zendeskId,
                dateReportReceived,
                timeReportReceived,
                dateOfIncident,
                timeOfIncident,
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

    function parseCommentsForDetails(comments) {
        let customerSummary = '';
        let customerAction = '';
        let captainSummary = '';
        let captainAction = '';
        let captainRating = '';
        let tenure = '';
        let trips = '';
        let customerRating = '';

        // Find the first comment with trigger phrases
        let firstComment = null;
        for (const comment of comments) {
            if (!comment || !comment.body) continue;
            const lowerBody = comment.body.toLowerCase();
            if (lowerBody.includes('kindly refer to the ticket below') ||
                lowerBody.includes('please be informed that we placed a call indicating the following details')) {
                firstComment = comment.body;
                break;
            }
        }

        if (!firstComment) return { customerSummary, customerAction, captainSummary, captainAction, captainRating, tenure, trips, customerRating };

        // Extract Captain Profile data
        const captainProfileMatch = firstComment.match(/\*{1,3}\s*captain profile\s*\*{0,3}/is);
        if (captainProfileMatch) {
            // Extract Trips (MONTHLY / TOTAL TRIPS)
            const tripsMatch = firstComment.match(/trips:\s*(\d+\s*\/\s*\d+)/i);
            if (tripsMatch) {
                trips = tripsMatch[1].trim();
            }

            // Extract Tenure
            const tenureMatch = firstComment.match(/tenure:\s*\n?\s*-?\s*\(?\s*(\d+\s*-\s*\d+)\s*\)?/is);
            if (tenureMatch) {
                tenure = `( ${tenureMatch[1].trim()} )`;
            }

            // Extract Rating (Captain history rating)
            const ratingMatch = firstComment.match(/rating:\s*([\d.]+\s*\/\s*[\d.]+)/i);
            if (ratingMatch) {
                captainRating = ratingMatch[1].trim();
            }
        }

        // Extract Customer Profile data
        const customerProfileMatch = firstComment.match(/\*{1,3}\s*customer profile\s*\*{0,3}/is);
        if (customerProfileMatch) {
            // Extract Rating of past trips (Customer history rating)
            const customerRatingMatch = firstComment.match(/rating of past trips:\s*([\d.]+)/i);
            if (customerRatingMatch) {
                customerRating = customerRatingMatch[1].trim();
            }
        }

        const lowerFirst = firstComment.toLowerCase();

        // Extract customer data from first comment
        const customerSectionMatch = firstComment.match(/\*{1,3}\s*customer:\s*\*{0,3}\s*\n\s*1\.\s*call summary and reaction:\s*(.*?)\s*\n\s*2\.\s*other actions:\s*(.*?)(?=\n\s*requested for pair blocking|$)/is);

        if (customerSectionMatch) {
            const custSummary = customerSectionMatch[1].trim();
            const custAction = customerSectionMatch[2].trim();

            if (!/^(no\s*call|not\s*yet)$/i.test(custSummary)) {
                customerSummary = custSummary;
                customerAction = custAction;
            }
        }

        // Extract captain data from first comment
        const captainSectionMatch = firstComment.match(/\*{1,3}\s*captain:\s*\*{0,3}\s*\n\s*1\.\s*call summary and reaction:\s*(.*?)\s*\n\s*2\.\s*other actions:\s*(.*?)(?=\n|$)/is);

        if (captainSectionMatch) {
            const captSummary = captainSectionMatch[1].trim();
            const captAction = captainSectionMatch[2].trim();

            if (!/^(no\s*call|not\s*yet)$/i.test(captSummary)) {
                captainSummary = captSummary;
                captainAction = captAction;
            }
        }

        // If customer or captain data is missing, look for the last "new actions taken" comment
        if (!customerSummary || !captainSummary) {
            let lastNewActionsComment = null;
            for (let i = comments.length - 1; i >= 0; i--) {
                const comment = comments[i];
                if (comment && comment.body) {
                    const lowerBody = comment.body.toLowerCase();
                    if (lowerBody.includes('new actions taken')) {
                        lastNewActionsComment = comment.body;
                        break;
                    }
                }
            }

            if (lastNewActionsComment) {
                // Extract captain data from new actions comment if not already found
                if (!captainSummary) {
                    const newCaptainMatch = lastNewActionsComment.match(/_\*{1,3}\s*captain:\s*\*{0,3}_\s*\n\s*-\s*call summary and reaction:\s*(.*?)\s*\n\s*-\s*other actions:\s*(.*?)(?=\n\s*_\*{1,3}\s*customer:|$)/is);

                    if (newCaptainMatch) {
                        const captSummary = newCaptainMatch[1].trim();
                        const captAction = newCaptainMatch[2].trim();

                        if (!/^(no\s*call|not\s*yet|as above)$/i.test(captSummary)) {
                            captainSummary = captSummary;
                            captainAction = captAction;
                        }
                    }
                }

                // Extract customer data from new actions comment if not already found
                if (!customerSummary) {
                    const newCustomerMatch = lastNewActionsComment.match(/_\*{1,3}\s*customer:\s*\*{0,3}_\s*\n\s*-\s*call summary and reaction:\s*(.*?)\s*\n\s*-\s*other actions:\s*(.*?)(?=\n\s*requested for pair blocking|$)/is);

                    if (newCustomerMatch) {
                        const custSummary = newCustomerMatch[1].trim();
                        const custAction = newCustomerMatch[2].trim();

                        if (!/^(no\s*call|not\s*yet|as above)$/i.test(custSummary)) {
                            customerSummary = custSummary;
                            customerAction = custAction;
                        }
                    }
                }
            }
        }

        return {
            customerSummary,
            customerAction,
            captainSummary,
            captainAction,
            captainRating,
            tenure,
            trips,
            customerRating
        };
    }

    function updateTemplateWithDetails(template, details) {
        // Replace Captain and Customer profile data in the template
        template = template.replace('Captain history rating: ', 'Captain history rating: ' + escapeHtml(details.captainRating || ''));
        template = template.replace('Tenure : ', 'Tenure : ' + escapeHtml(details.tenure || ''));
        template = template.replace('MONTHLY / TOTAL TRIPS: ', 'MONTHLY / TOTAL TRIPS: ' + escapeHtml(details.trips || ''));
        template = template.replace('Customer history rating: ', 'Customer history rating: ' + escapeHtml(details.customerRating || ''));

        // Build the replacement HTML using <p> tags
        let replacementParts = [];

        replacementParts.push('<p><strong>Customer investigation summary:</strong></p>');

        if (details.customerSummary) {
            replacementParts.push('<p>' + escapeHtml(details.customerSummary) + '</p>');
        }

        replacementParts.push('<p>Follow Up:</p>');
        replacementParts.push('<p><strong>Action with customer: </strong>' + escapeHtml(details.customerAction || '') + '</p>');
        replacementParts.push('<p><strong>Captain investigation summary:</strong></p>');

        if (details.captainSummary) {
            replacementParts.push('<p>' + escapeHtml(details.captainSummary) + '</p>');
        }

        replacementParts.push('<p><strong>Action with captain: </strong>' + escapeHtml(details.captainAction || '') + '</p>');
        replacementParts.push('<p>******************************************************************************</p>');

        const replacement = replacementParts.join('');

        // Find the section to replace in the template
        const startPattern = /<b data-stringify-type="bold">Customer investigation summary:<\/b>/;
        const endPattern = /\*{80}/;

        const startMatch = template.match(startPattern);
        if (!startMatch) return template;

        const startIndex = template.indexOf(startMatch[0]);
        const endIndex = template.indexOf('******************************************************************************', startIndex);

        if (startIndex !== -1 && endIndex !== -1) {
            const beforeSection = template.substring(0, startIndex);
            const afterEndMarker = template.substring(endIndex + '******************************************************************************'.length);
            return beforeSection + replacement + afterEndMarker;
        }

        return template;
    }

    fetchBtn.onclick = fetchTicket;
    ticketInput.addEventListener('keydown', e => { if (e.key === 'Enter') fetchTicket(); });

    // Slash command handler for /eTicketNumber
    function setupSlashCommandListener() {
        const composer = findComposerElement();
        if (!composer) return;

        // Mark that we've already attached a listener to prevent duplicates
        if (composer.dataset.slashListenerAttached) return;
        composer.dataset.slashListenerAttached = 'true';

        composer.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
                const text = composer.textContent || composer.innerText || '';
                const match = text.match(/\/e(\d+)/);

                if (match) {
                    event.preventDefault();
                    event.stopPropagation();

                    const ticketId = match[1];

                    // Clear the composer
                    composer.textContent = '';

                    // Trigger the fetch with the ticket ID
                    triggerSlashCommandFetch(ticketId);
                }
            }
        }, true);
    }

    async function triggerSlashCommandFetch(ticketId) {
        try {
            // Fetch ticket details
            const [ticketResp, commentsResp] = await Promise.all([
                fetch(`https://gocareem.zendesk.com/api/v2/tickets/${ticketId}.json`, {
                    credentials: 'include'
                }),
                fetch(`https://gocareem.zendesk.com/api/v2/tickets/${ticketId}/comments.json`, {
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
                investigationDetails = parseCommentsForDetails(comments);
            }

            const rawCountry = getCustomFieldValue(ticket, COUNTRY_FIELD_ID);
            const rawCity = getCustomFieldValue(ticket, CITY_FIELD_ID);
            const rawBookingId = getCustomFieldValue(ticket, BOOKING_ID_FIELD_ID);
            const incidentTypeValue = getCustomFieldValue(ticket, INCIDENT_TYPE_FIELD_ID);

            const country = normalizeCountryValue(rawCountry) || 'N/A';
            const city = normalizeCityValue(rawCity) || 'N/A';
            const bookingId = rawBookingId ? String(rawBookingId).trim() : 'N/A';
            const zendeskId = (ticket.id != null ? String(ticket.id) : ticketId) || 'N/A';
            const dateReportReceived = formatTicketDate(ticket.created_at) || 'N/A';
            const timeReportReceived = formatTicketTime(ticket.created_at) || 'N/A';
            const caseStatus = ticket.status ? String(ticket.status).toUpperCase() : 'N/A';
            const incidentType = (await resolveIncidentTypeName(incidentTypeValue)) || 'N/A';

            // Fetch booking timestamp
            let dateOfIncident = 'N/A';
            let timeOfIncident = 'N/A';

            if (bookingId && bookingId !== 'N/A') {
                const bookedTimestamp = await fetchBookingTimestamp(bookingId);

                if (bookedTimestamp) {
                    dateOfIncident = formatTicketDate(bookedTimestamp) || 'N/A';
                    timeOfIncident = formatTicketTime(bookedTimestamp) || 'N/A';
                }
            }

            let templateHtml = buildTemplate({
                city,
                country,
                bookingId,
                zendeskId,
                dateReportReceived,
                timeReportReceived,
                dateOfIncident,
                timeOfIncident,
                caseStatus,
                incidentType
            });

            // Update template with investigation details
            templateHtml = updateTemplateWithDetails(templateHtml, investigationDetails);

            insertTemplateIntoComposer(templateHtml);
        } catch (err) {
            console.error('Slash command error:', err);
            const composer = findComposerElement();
            if (composer) {
                composer.textContent = `Error: ${err.message}`;
            }
        }
    }

    // Set up slash command listener with retry and monitoring
    setInterval(() => {
        setupSlashCommandListener();
    }, 2000);

    // Initial setup
    setTimeout(() => {
        setupSlashCommandListener();
    }, 1000);

})();
