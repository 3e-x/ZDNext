// ==UserScript==
// @name         Slackdesk
// @namespace    http://tampermonkey.net/
// @version      2.3
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

    const MOT_TEMPLATE_HTML = '<div class="p-rich_text_block" dir="auto"><p><ts-mention data-id="U03KAGQHWAE" data-label="@Rahaf Alasal" spellcheck="false" class="c-member_slug c-member_slug--link ts_tip_texty" dir="ltr">@Rahaf Alasal</ts-mention> <ts-mention data-id="UR9AU9C9M" data-label="@Saja Altaany" spellcheck="false" class="c-member_slug c-member_slug--link ts_tip_texty" dir="ltr">@Saja Altaany</ts-mention> <ts-mention data-id="U2FTT26CR" data-label="@farida.hussein" spellcheck="false" class="c-member_slug c-member_slug--link ts_tip_texty" dir="ltr">@farida.hussein</ts-mention> <ts-mention data-id="U030EUV2Z97" data-label="@Safa Ali" spellcheck="false" class="c-member_slug c-member_slug--link ts_tip_texty" dir="ltr">@Safa Ali</ts-mention> <ts-mention data-id="U01SST1FKPC" data-label="@SHR" spellcheck="false" class="c-member_slug c-member_slug--link ts_tip_texty" dir="ltr">@SHR</ts-mention></p><p><br></p><p><strong>Incident Classification: </strong>{{INCIDENT_CLASSIFICATION}}</p><p><strong>Date of Incident: </strong>{{DATE_OF_INCIDENT}}</p><p><strong>Time of Incident: </strong>{{TIME_OF_INCIDENT}}</p><p><strong>Date Report Received: </strong>{{DATE_OF_INCIDENT}}</p><p><strong>Time Report Received: <img data-id=":attention:" data-title=":attention:" data-stringify-text=":attention:" class="emoji" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" alt="attention emoji" style="background-image: url(https://emoji.slack-edge.com/T0K1Z5308/attention/286bfcb407ed76d6.gif);"></strong></p><p><br></p><p><strong>Captain Information</strong></p><p>Name: {{CAPTAIN_NAME}}</p><p>Captain ID: {{CAPTAIN_ID}}</p><p>Contact: {{CAPTAIN_CONTACT}}</p><p>Safety History: <img data-id=":attention:" data-title=":attention:" data-stringify-text=":attention:" class="emoji" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" alt="attention emoji" style="background-image: url(https://emoji.slack-edge.com/T0K1Z5308/attention/286bfcb407ed76d6.gif);"></p><p><br></p><p><strong>Trip &amp; Operational Details</strong></p><p>Vertical: {{VERTICAL}}</p><p>City: {{CITY}}</p><p>Country: {{COUNTRY}}</p><p>Booking ID: {{BOOKING_ID}}</p><p>Order ID: {{ORDER_ID}}</p><p>Zendesk Ticket ID: {{ZENDESK_ID}}</p><p><br></p><p><strong>Incident Details</strong></p><p>Incident Type: {{INCIDENT_TYPE}}</p><p>Key Details: {{KEY_DETAILS}}</p><p>Other Actions: {{OTHER_ACTIONS}}</p><p><br></p><p><strong>Follow-up Actions</strong></p><p>L1 &amp; L2 MoT Accident: Safety in-app message sent to Captain?</p><p>No</p><p>L2 MoT Accident: In-ride Insurance message sent to Captain?</p><p>No</p><p>L3 or L4 Incidents: S&amp;S team called?</p><p>No</p><p>L3 or L4 Incidents – Email sent to <a href="mailto:safetysecurity@careem.com" rel="noopener noreferrer" target="_blank">safetysecurity@careem.com</a>?</p><p>No</p><p><br></p><p>Additional Notes: none</p></div>';

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

    function extractOrderId(notesToDriver) {
        if (!notesToDriver) {
            return '';
        }
        // Look for pattern "Order: #123456" or "Order:#123456"
        const match = notesToDriver.match(/Order:\s*#?(\d+)/i);
        if (match && match[1]) {
            return match[1];
        }
        return '';
    }

    function extractIncidentClassification(incidentType) {
        if (!incidentType) {
            return '';
        }
        // Extract the last part after the last "__" which should be L1, L2, L3, or L4
        const parts = incidentType.split('__');
        if (parts.length > 0) {
            const lastPart = parts[parts.length - 1].trim();
            // Check if it matches L1, L2, L3, L4 pattern
            if (/^L[1-4]$/i.test(lastPart)) {
                return lastPart.toUpperCase();
            }
        }
        return '';
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
})();
