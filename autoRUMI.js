// ==UserScript==
// @name         autoRUMI
// @namespace    http://tampermonkey.net/
// @version      2.0.2
// @description  Zendesk ticket monitoring with automated business logic processing
// @author       QUxBQkJBUyBEQUJBSkVI
// @match        https://gocareem.zendesk.com/agent/tickets/111111110
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // Phase 2 adds business logic processing on top of the monitoring infrastructure
    // Rules are evaluated in strict priority order to ensure consistent ticket handling

    // ============================================================================
    // CONFIGURATION & CONSTANTS
    // ============================================================================

    const CONFIG = {
        LOG_MAX_ENTRIES: 5000,
        RETRY_MAX_ATTEMPTS: 3,
        RETRY_BACKOFF_MS: 1000,
        DEFAULT_INTERVAL_SECONDS: 10,
        MIN_INTERVAL_SECONDS: 5,
        MAX_INTERVAL_SECONDS: 60,
        TRACE_BACK_COMMENT_LIMIT: 50,
        CAREEM_CARE_ID: '34980896869267'
    };

    const GROUP_IDS = {
        CARE: 20705088,
        HALA_RIDES: 360003368353,
        CASABLANCA: 360011852054
    };

    const TARGET_VIEWS = [
        'SSOC - Open - Urgent',
        'SSOC - GCC & EM Open',
        'SSOC - Egypt Urgent',
        'SSOC - Egypt Open',
        'SSOC - Pending - Urgent',
        'SSOC - GCC & EM Pending',
        'SSOC - Egypt Pending'
    ];

    // ============================================================================
    // BUSINESS RULES & TRIGGER PHRASES
    // ============================================================================

    class RUMIRules {
        static PENDING_TRIGGERS = [
            // ESCALATION & INTERNAL TRANSFER (English)
            "directed this matter to the most appropriate support team",
            "escalated this matter to a specialized support team",
            "escalated this matter to a specialised support team",
            "escalated this issue to a dedicated support team",
            "escalated this to a specialized support team",
            "escalated this to a specialised support team",
            "have escalated your issue to a specialized team to review this further",
            "a member of our team will be in touch with you shortly",
            "we've forwarded this issue to a specialized support team",
            "we have forwarded this to a dedicated support team",
            "we're going to escalate your issue to our team that can investigate further",
            "and will provide you with an update as soon as possible",
            "in order to best assist you, we need to bring in another team",
            "you will receive a response as soon as possible",

            // ESCALATION & INTERNAL TRANSFER (Arabic)
            "لقد قمنا بتصعيد هذا الأمر إلى الفريق المختص",
            "لقد قمنا بتصعيد هذه المشكلة إلى فريق دعم",
            "لقد قمنا بتصعيد الأمر إلى فريق دعم متخصص",
            "فريق دعم متخصص سيتواصل معك في أقرب وقت ممكن",
            "لقد قمنا بتحويل ملاحظتك إلى الفريق المختص لمتابعتها واتخاذ اللازم",
            "لقد قمنا بتصعيد هذا الأمر إلى فريق دعم متخصص",
            "بمجرد حصولنا على تحديث سنتواصل معك مرة أخرى",

            // REQUESTING MORE INFORMATION (English)
            "we want you to provide us with more information about what happened",
            "if you feel additional information could be helpful",
            "this contact thread will say \"waiting for your reply\"",
            "any additional information would be beneficial to our investigation",
            "we'll keep an eye out for your reply",
            "if you feel additional information could be helpful, please reply to this message",
            "in order to be able to further investigate the issue",
            "provide us with more details about what happened",

            // REQUESTING MORE INFORMATION (Arabic)
            "مزيد من التفاصيل عن ما حدث معك أثناء الرحلة",
            "أي تفاصيل إضافية ستساعدنا",
            "المزيد من المعلومات قد",
            "أي معلومات إضافية قد تكون مفيدة",
            "سيتم التواصل في الوقت اللذي تم تحديده",

            // WAITING FOR REPLY STATUS (English)
            "awaiting your reply",
            "waiting for your reply",
            "waiting for your kind response",
            "will be waiting for your reply",
            "keep a keen eye out for your reply",
            "keeping an eye out for your reply",
            "awaiting your response",
            "look out for your reply",

            // WAITING FOR REPLY STATUS (Arabic)
            "في انتظار ردك",
            "ف انتظار ردك",
            "ننتظر ردك",
            "في انتظار الرد",
            "سنكون بانتظار ردك",

            // INTERNAL NOTES/ACTIONS & CODES
            "emea urgent triage team zzzdut",
            "no urgent safety concern found",
            "please re-escalate if urgent concerns are confirmed",
            "https://blissnxt.uberinternal.com",
            "https://uber.lighthouse-cloud.com",
            "https://apps.mypurecloud.ie",
            "call attempt",
            "first call",
            "second call",
            "third call",
            "1st call",
            "2nd call",
            "3rd call",
            "more info",
            "#safety",
            "#audiomissing"
        ];

        static SOLVED_TRIGGERS = [
            // ACTION TAKEN / RESOLUTION CONFIRMED (English)
            "be following up with the driver and taking the appropriate actions",
            "be following up with your driver in order to take the appropriate actions",
            "be taking the appropriate actions",
            "be taking the appropriate action",
            "be taking any necessary internal actions",
            "be following up with the driver involved",
            "we have taken the necessary internal actions",
            "already taken the appropriate action internally",
            "already taken the appropriate actions internally",
            "we have already taken all the appropriate actions internally",
            "already taken all the necessary internal actions",
            "started taking the appropriate internal actions",
            "these are the actions we have taken",
            "thanks for your understanding",
            "please note that GIG will follow up regarding the insurance within 2 business days",
            "we have followed up with the partner-driver immediately",
            "we are unable to specify any internal action taken with individual users of the application",
            "happy to hear the issue has been resolved",
            // ACTION TAKEN / RESOLUTION CONFIRMED (Arabic)
            "وقد اتخذنا بالفعل الإجراء المناسب داخليا",
            "وسنتخذ الإجراءات الداخلية",
            "وسوف نقوم بمتابعة التحقيق واتخاذ الإجراءات",
            "وسوف نتخذ الإجراءات المناسبة",
            "سنتابع الأمر مع السائق من أجل اتخاذ الإجراءات المناسبة",
            "وسنتابع الأمر مع الشريك السائق المعني",
            "وقد قمنا بالفعل باتخاذ الإجراءات المناسبة",
            "وسنتابع الأمر مع السائق، لاتخاذ الإجراءات الداخلية المناسبة",
            "سنتابع الأمر مع الشريك السائق ونتخذ الإجراءات الملائمة",
            "وسنتابع الأمر مع الشريك السائق ونتّخذ الإجراءات المناسبة",
            "وسنتخذ الإجراءات الداخلية الملائمة بحق السائق المتورط في الأمر",

            // SAFETY & PRECAUTIONARY MEASURES (English)
            "to try to ensure the experience you describe can't happen again",
            "we have also made some changes in the application to reduce the chance of you being paired with this partner driver in the future",
            "we want everyone, both drivers and riders, to have a safe, respectful, and comfortable experience as stated in our careem rides community guidelines",
            "we also want to make you aware of it as it is something we take very seriously here at",
            "we can confirm that this trip isn’t eligible for a price adjustment",
            "we can confirm that this trip isn't eligible for a price adjustment",

            // SAFETY & PRECAUTIONARY MEASURES (Arabic)
            "قد أجرينا أيضا بعض التغييرات في التطبيق للتقليل من فرص",
            "إذا تمت مطابقتك مرة أخرى، يرجى إلغاء الرحلة والتواصل معنا من خلال التطبيق",
            "لذلك قمنا بإعادة قيمة أجرة هذه الرحلة",
            // INTERNAL PROCESS / STATUS UPDATES (English)
            "it looks like you've already raised a similar concern for this trip that our support team has resolved",
            "will be handled by one of our specialized teams through another message soon",
            "already directed your concern to the relevant team and they will get back to you as soon as possible",

            // INTERNAL PROCESS / STATUS UPDATES (Arabic)
            "وسوف يقوم أحد أعضاء الفريق المختص لدينا بالتواصل معك من خلال رسالة أخرى بخصوص استفسارك في أقرب وقت ممكن",
            "سوف يتم الرد على إستفسارك في رسالة أخرى من الفريق المختص",
            "ومن ثم، سنغلق تذكرة الدعم الحالية لتسهيل التواصل وتجنب أي التباس",
            "يمكننا الرد على أي استفسارات حول هذا الأمر في أي وقت",
            "لنمنح الركاب تجربة خالية من المتاعب حتى يتمكنوا من إجراء مشوار في أقرب وقت ممكن",
            "ويمكننا ملاحظة أنك قد تواصلت معنا بشأنها من قبل",
            "نحرص دائما على توفير تجربة آمنة ومريحة تتسم بالاحترام للركاب والسائقين",
            "فسوف يتم الرد عليك برسالة أخرى من الفريق المختص",
            "إن سلامة جميع المستخدمين من أهم أولوياتنا",
            "يتم مراجعة الملاحظات وإتخاذ أي إجراءات داخلية ضرورية",
            "بالتواصل معك بخصوص استفسارك من خلال رسالة أخرى",
            "وقام أحد أعضاء الفريق المختص لدينا بالتواصل معك من خلال رسالة أخرى",
            "ويسعدنا معرفة أنه قد تم حل المشكلة",
            "سوف يتم الرد على إستفسارك في رسالة أخرى من الفريق المختص",
            "من خلال بوابة الاستجابة للسلامة العامة المخصصة",
            "نود إعلامك أنه قد تم بالفعل اتخاذ الإجراءات اللازمة حول هذا الأمر",

            // INTERNAL CODES & REFERENCES
            "pb",
            "pushback",
            "push back",
            "lert@uber.com",
            "nrn"
        ];

        static CARE_ROUTING_PHRASES = [
            "#notsafety",
            "careem actions required on rider",
            "careem actions required for rider",
            "action required by careem",
            "actions required by careem",
            "ask the rider",
            "inform the rider",
            "captain asks for extra money is no longer a safety case",
            "not safety related^"
        ];

        static ESCALATED_BUT_NO_RESPONSE = "i’m truly sorry to hear about what happened during your trip. to assist you better, our team will contact you shortly to get more details about the incident";
    }

    // ============================================================================
    // COMMENT PROCESSING & NORMALIZATION
    // ============================================================================

    class RUMICommentProcessor {
        static htmlToPlainText(htmlBody) {
            if (!htmlBody) return '';

            let text = htmlBody;

            // Decode Unicode escapes that Zendesk API returns
            text = text.replace(/\\u003C/g, '<').replace(/\\u003E/g, '>');

            // Extract href URLs and preserve them as text
            text = text.replace(/<a\s+href="([^"]+)"[^>]*>([^<]*)<\/a>/gi, '$2 ($1)');

            // Convert common block elements to newlines
            text = text.replace(/<\/?(p|div|br)[^>]*>/gi, '\n');

            // Remove all remaining HTML tags
            text = text.replace(/<[^>]+>/g, '');

            // Decode common HTML entities
            text = text.replace(/&amp;/g, '&')
                       .replace(/&lt;/g, '<')
                       .replace(/&gt;/g, '>')
                       .replace(/&quot;/g, '"')
                       .replace(/&#39;/g, "'")
                       .replace(/&nbsp;/g, ' ');

            // Normalize whitespace (multiple spaces/newlines to single)
            text = text.replace(/\s+/g, ' ').trim();

            return text;
        }

        static normalizeForMatching(htmlBody) {
            // Arabic diacritics removal for consistent matching
            const diacritics = /[\u064B-\u0652]/g;
            const plainText = this.htmlToPlainText(htmlBody);
            return plainText.toLowerCase().replace(diacritics, '');
        }

        static matchesTrigger(normalizedComment, triggerPhrase) {
            return normalizedComment.includes(triggerPhrase.toLowerCase());
        }

        static matchesAnyTrigger(normalizedComment, triggerPhrases) {
            return triggerPhrases.some(phrase =>
                this.matchesTrigger(normalizedComment, phrase)
            );
        }
    }

    // ============================================================================
    // IDEMPOTENCY TRACKING
    // ============================================================================

    class RUMIIdempotency {
        static getProcessedData(ticketId) {
            const key = `processed_${ticketId}`;
            return RUMIStorage.get(key, null);
        }

        static setProcessedData(ticketId, data) {
            const key = `processed_${ticketId}`;
            RUMIStorage.set(key, {
                lastProcessedCommentId: data.commentId,
                actionType: data.actionType,
                timesTriggered: (this.getProcessedData(ticketId)?.timesTriggered || 0) + 1,
                lastProcessedAtUTC: new Date().toISOString()
            });
        }

        static clearProcessedData(ticketId) {
            const key = `processed_${ticketId}`;
            RUMIStorage.remove(key);
        }

        static shouldProcess(ticketId, latestCommentId, actionType) {
            const processed = this.getProcessedData(ticketId);

            if (!processed) {
                return true;
            }

            // Routing actions should always process - they can repeat every time ticket comes into view
            // This ensures tickets with routing phrases get routed continuously until conditions change
            if (['care', 'hala', 'casablanca'].includes(actionType)) {
                // Clear any stale idempotency data for routing actions
                this.clearProcessedData(ticketId);
                return true;
            }

            // Pending and solved use strict idempotency - only process once per comment ID
            if (['pending', 'solved'].includes(actionType)) {
                return processed.lastProcessedCommentId !== latestCommentId;
            }

            return true;
        }
    }

    // ============================================================================
    // TICKET PROCESSING ENGINE
    // ============================================================================

    class RUMIProcessor {
        static isDryRun = false;
        static currentUserId = null;

        static async init() {
            try {
                const userData = await RUMIAPIManager.get('/api/v2/users/me.json');
                this.currentUserId = userData.user.id;
                RUMILogger.info('PROCESSOR', 'Initialized with cached user ID', { userId: this.currentUserId });
            } catch (error) {
                RUMILogger.error('PROCESSOR', 'Failed to fetch current user', { error: error.message });
            }
        }

        static clearCachedUserId() {
            this.currentUserId = null;
            RUMILogger.info('PROCESSOR', 'Cached user ID cleared');
        }

        static async ensureCurrentUserId() {
            if (!this.currentUserId) {
                RUMILogger.warn('PROCESSOR', 'User ID not cached, fetching now');
                await this.init();
            }
            return this.currentUserId;
        }

        static async processTicket(ticketId, viewName = null) {
            try {
                // Fetch ticket data first (needed for both pins and normal processing)
                const ticket = await RUMIAPIManager.get(`/api/v2/tickets/${ticketId}.json`);
                const comments = await RUMIAPIManager.get(`/api/v2/tickets/${ticketId}/comments.json`);

                const ticketData = ticket.ticket;
                const commentsList = comments.comments || [];

                // PRIORITY 1: Check if ticket is blocked (highest priority)
                if (RUMIPinManager.checkBlockedPin(ticketId)) {
                    // Store blocked pin in processed table
                    const previousGroupName = await this.fetchAndCacheGroupName(ticketData.group_id);
                    const blockedPinData = {
                        ticketId: ticketId,
                        subject: ticketData.subject || 'N/A',
                        viewName: viewName || 'Manual',
                        action: 'skipped',
                        trigger: 'Blocked Pin',
                        previousStatus: ticketData.status,
                        newStatus: ticketData.status,
                        previousGroupId: ticketData.group_id,
                        previousGroupName: previousGroupName,
                        newGroupId: ticketData.group_id,
                        newGroupName: previousGroupName,
                        previousAssigneeId: ticketData.assignee_id,
                        newAssigneeId: ticketData.assignee_id,
                        dryRun: false,
                        alreadyCorrect: false,
                        note: 'Ticket is pinned as blocked',
                        isBlockedPin: true
                    };
                    RUMIStorage.addProcessedTicket(blockedPinData);
                    return { action: 'skipped', reason: 'blocked_pin' };
                }

                // PRIORITY 2: Check for care routing pin
                const careRoutingResult = await RUMIPinManager.checkCareRoutingPin(ticketId, ticketData, commentsList);
                
                if (careRoutingResult) {
                    // If care routing pin returned a result, process it or skip
                    if (careRoutingResult.action === 'care') {
                        // Apply Care routing
                        const payload = careRoutingResult.payload;

                        const previousGroupName = await this.fetchAndCacheGroupName(ticketData.group_id);
                        const newGroupId = payload?.ticket?.group_id || ticketData.group_id;
                        const newGroupName = await this.fetchAndCacheGroupName(newGroupId);

                        if (this.isDryRun) {
                            RUMILogger.info('PROCESSOR', '[DRY RUN] Would route to Care via pin', { ticketId });
                        } else {
                            await this.applyChanges(ticketId, payload);
                            RUMILogger.info('PROCESSOR', 'Routed to Care via pin', { ticketId });
                        }

                        // Store care routing pin in processed table
                        const carePinData = {
                            ticketId: ticketId,
                            subject: ticketData.subject || 'N/A',
                            viewName: viewName || 'Manual',
                            action: 'care',
                            trigger: 'Pinned Ticket',
                            previousStatus: ticketData.status,
                            newStatus: payload?.ticket?.status || ticketData.status,
                            previousGroupId: ticketData.group_id,
                            previousGroupName: previousGroupName,
                            newGroupId: newGroupId,
                            newGroupName: newGroupName,
                            previousAssigneeId: ticketData.assignee_id,
                            newAssigneeId: payload?.ticket?.assignee_id || ticketData.assignee_id,
                            dryRun: this.isDryRun,
                            alreadyCorrect: false,
                            note: null
                        };
                        RUMIStorage.addProcessedTicket(carePinData);
                    }
                    return careRoutingResult;
                }

                // Store original ticket state
                const originalStatus = ticketData.status;
                const originalGroupId = ticketData.group_id;
                const originalAssigneeId = ticketData.assignee_id;

                // Closed tickets are read-only, treat as dry run regardless of mode
                if (ticketData.status === 'closed') {
                    RUMILogger.info('PROCESSOR', 'Skipping closed ticket', { ticketId });
                    return { action: 'skipped', reason: 'closed' };
                }

                if (commentsList.length === 0) {
                    RUMILogger.debug('PROCESSOR', 'No comments found', { ticketId });
                    return { action: 'skipped', reason: 'no_comments' };
                }

                // Evaluate rules in priority order (normal business rules)
                const result = await this.evaluateRules(ticketData, commentsList, false, viewName);

                if (result.action === 'none') {
                    RUMILogger.debug('PROCESSOR', 'No action needed', { ticketId });
                    return result;
                }

                // Check idempotency before applying changes
                const latestCommentId = commentsList[commentsList.length - 1].id;
                if (!RUMIIdempotency.shouldProcess(ticketId, latestCommentId, result.action)) {
                    RUMILogger.info('PROCESSOR', 'Already processed', { ticketId, action: result.action });
                    return { action: 'skipped', reason: 'idempotency' };
                }

                // Check if ticket is already in desired state
                const targetStatus = result.payload?.ticket?.status;
                const targetGroupId = result.payload?.ticket?.group_id;
                const alreadyCorrect = (targetStatus && targetStatus === originalStatus) ||
                                       (targetGroupId && targetGroupId === originalGroupId);

                // Fetch group names for display
                const previousGroupName = await this.fetchAndCacheGroupName(originalGroupId);
                const newGroupId = result.payload?.ticket?.group_id || originalGroupId;
                const newGroupName = await this.fetchAndCacheGroupName(newGroupId);

                // Prepare ticket processing record
                const processedTicketData = {
                    ticketId: ticketId,
                    subject: ticketData.subject || 'N/A',
                    viewName: viewName || 'Manual',
                    action: result.action,
                    trigger: result.trigger || 'N/A',
                    previousStatus: originalStatus,
                    newStatus: result.payload?.ticket?.status || originalStatus,
                    previousGroupId: originalGroupId,
                    previousGroupName: previousGroupName,
                    newGroupId: newGroupId,
                    newGroupName: newGroupName,
                    previousAssigneeId: originalAssigneeId,
                    newAssigneeId: result.payload?.ticket?.assignee_id || originalAssigneeId,
                    dryRun: this.isDryRun,
                    alreadyCorrect: alreadyCorrect,
                    note: alreadyCorrect ? `Ticket should be set to ${targetStatus || newGroupName}, but it won't because it is already ${originalStatus || previousGroupName}` : null
                };

                // Apply changes or log dry run
                if (this.isDryRun) {
                    RUMILogger.info('PROCESSOR', '[DRY RUN] Would apply', { ticketId, ...result, alreadyCorrect });

                    // Store processed ticket even in dry run
                    RUMIStorage.addProcessedTicket(processedTicketData);
                    RUMIStorage.updateProcessingStats(result.action);

                    return { ...result, dryRun: true, ticketData: processedTicketData };
                } else {
                    // Only apply changes if ticket is not already in desired state
                    if (!alreadyCorrect) {
                        await this.applyChanges(ticketId, result.payload);
                        // Don't mark routing actions as processed - they should process repeatedly
                        if (!['care', 'hala', 'casablanca'].includes(result.action)) {
                            RUMIIdempotency.setProcessedData(ticketId, {
                                commentId: latestCommentId,
                                actionType: result.action
                            });
                        }
                        RUMILogger.info('PROCESSOR', 'Applied changes', { ticketId, action: result.action });
                    } else {
                        RUMILogger.info('PROCESSOR', 'Ticket already in desired state', { ticketId, action: result.action });
                    }

                    // Store processed ticket regardless
                    RUMIStorage.addProcessedTicket(processedTicketData);
                    RUMIStorage.updateProcessingStats(result.action);

                    return { ...result, ticketData: processedTicketData };
                }

            } catch (error) {
                RUMILogger.error('PROCESSOR', 'Failed to process ticket', { ticketId, error: error.message });
                return { action: 'error', error: error.message };
            }
        }

        // Process ticket using pre-fetched data (for batch processing)
        static async processTicketWithData(ticketId, ticketData, commentsList, viewName = null, isManual = false) {
            try {
                // PRIORITY 1: Check if ticket is blocked (highest priority)
                if (RUMIPinManager.checkBlockedPin(ticketId)) {
                    // Store blocked pin in processed table
                    const previousGroupName = await this.fetchAndCacheGroupName(ticketData.group_id);
                    const blockedPinData = {
                        ticketId: ticketId,
                        subject: ticketData.subject || 'N/A',
                        viewName: viewName || 'Manual',
                        action: 'skipped',
                        trigger: 'Blocked Pin',
                        previousStatus: ticketData.status,
                        newStatus: ticketData.status,
                        previousGroupId: ticketData.group_id,
                        previousGroupName: previousGroupName,
                        newGroupId: ticketData.group_id,
                        newGroupName: previousGroupName,
                        previousAssigneeId: ticketData.assignee_id,
                        newAssigneeId: ticketData.assignee_id,
                        dryRun: false,
                        alreadyCorrect: false,
                        note: 'Ticket is pinned as blocked',
                        isBlockedPin: true
                    };

                    // Use appropriate storage based on manual flag
                    if (isManual) {
                        RUMIStorage.addManualProcessedTicket(blockedPinData);
                    } else {
                        RUMIStorage.addProcessedTicket(blockedPinData);
                    }
                    return { action: 'skipped', reason: 'blocked_pin' };
                }

                // PRIORITY 2: Check for care routing pin (pass pre-fetched data for efficiency)
                const careRoutingResult = await RUMIPinManager.checkCareRoutingPin(ticketId, ticketData, commentsList);
                
                if (careRoutingResult) {
                    // If care routing pin returned a result, process it or skip
                    if (careRoutingResult.action === 'care') {
                        // Apply Care routing
                        const payload = careRoutingResult.payload;

                        const previousGroupName = await this.fetchAndCacheGroupName(ticketData.group_id);
                        const newGroupId = payload?.ticket?.group_id || ticketData.group_id;
                        const newGroupName = await this.fetchAndCacheGroupName(newGroupId);

                        // Determine which dry run mode to use
                        const isDryRunMode = isManual ? RUMIStorage.getManualProcessingSettings().dryRunMode : this.isDryRun;

                        if (isDryRunMode) {
                            const prefix = isManual ? '[MANUAL DRY RUN]' : '[DRY RUN]';
                            RUMILogger.info('PROCESSOR', `${prefix} Would route to Care via pin`, { ticketId });
                        } else {
                            await this.applyChanges(ticketId, payload);
                            const prefix = isManual ? '[MANUAL]' : '';
                            RUMILogger.info('PROCESSOR', `${prefix} Routed to Care via pin`, { ticketId });
                        }

                        // Store care routing pin in processed table
                        const carePinData = {
                            ticketId: ticketId,
                            subject: ticketData.subject || 'N/A',
                            viewName: viewName || 'Manual',
                            action: 'care',
                            trigger: 'Pinned Ticket',
                            previousStatus: ticketData.status,
                            newStatus: payload?.ticket?.status || ticketData.status,
                            previousGroupId: ticketData.group_id,
                            previousGroupName: previousGroupName,
                            newGroupId: newGroupId,
                            newGroupName: newGroupName,
                            previousAssigneeId: ticketData.assignee_id,
                            newAssigneeId: payload?.ticket?.assignee_id || ticketData.assignee_id,
                            dryRun: isDryRunMode,
                            alreadyCorrect: false,
                            note: null
                        };

                        // Use appropriate storage based on manual flag
                        if (isManual) {
                            RUMIStorage.addManualProcessedTicket(carePinData);
                            RUMIStorage.updateManualProcessingStats('care');
                        } else {
                            RUMIStorage.addProcessedTicket(carePinData);
                            RUMIStorage.updateProcessingStats('care');
                        }
                    }
                    return careRoutingResult;
                }

                // Store original ticket state
                const originalStatus = ticketData.status;
                const originalGroupId = ticketData.group_id;
                const originalAssigneeId = ticketData.assignee_id;

                // Closed tickets are read-only, treat as dry run regardless of mode
                if (ticketData.status === 'closed') {
                    RUMILogger.info('PROCESSOR', 'Skipping closed ticket', { ticketId });
                    return { action: 'skipped', reason: 'closed' };
                }

                if (commentsList.length === 0) {
                    RUMILogger.debug('PROCESSOR', 'No comments found', { ticketId });
                    return { action: 'skipped', reason: 'no_comments' };
                }

                // Evaluate rules in priority order (normal business rules)
                const result = await this.evaluateRules(ticketData, commentsList, isManual, viewName);

                if (result.action === 'none') {
                    RUMILogger.debug('PROCESSOR', 'No action needed - ticket does not match any rules', { ticketId });

                    // Store unprocessed tickets (only for manual processing)
                    if (isManual) {
                        // Determine which dry run mode to use
                        const isDryRunMode = RUMIStorage.getManualProcessingSettings().dryRunMode;

                        const unprocessedTicketData = {
                            ticketId: ticketId,
                            subject: ticketData.subject || 'N/A',
                            viewName: viewName || 'Manual',
                            action: 'none',
                            trigger: 'No matching rule',
                            previousStatus: originalStatus,
                            newStatus: originalStatus,
                            previousGroupId: originalGroupId,
                            previousGroupName: await this.fetchAndCacheGroupName(originalGroupId),
                            newGroupId: originalGroupId,
                            newGroupName: await this.fetchAndCacheGroupName(originalGroupId),
                            previousAssigneeId: originalAssigneeId,
                            newAssigneeId: originalAssigneeId,
                            dryRun: isDryRunMode,
                            alreadyCorrect: false,
                            note: 'Ticket does not match any business rules'
                        };
                        RUMIStorage.addManualProcessedTicket(unprocessedTicketData);
                    }

                    return result;
                }

                // Check idempotency before applying changes
                const latestCommentId = commentsList[commentsList.length - 1].id;
                if (!RUMIIdempotency.shouldProcess(ticketId, latestCommentId, result.action)) {
                    RUMILogger.info('PROCESSOR', 'Already processed', { ticketId, action: result.action });
                    return { action: 'skipped', reason: 'idempotency' };
                }

                // Check if ticket is already in desired state
                const targetStatus = result.payload?.ticket?.status;
                const targetGroupId = result.payload?.ticket?.group_id;
                const alreadyCorrect = (targetStatus && targetStatus === originalStatus) ||
                                       (targetGroupId && targetGroupId === originalGroupId);

                // Fetch group names for display
                const previousGroupName = await this.fetchAndCacheGroupName(originalGroupId);
                const newGroupId = result.payload?.ticket?.group_id || originalGroupId;
                const newGroupName = await this.fetchAndCacheGroupName(newGroupId);

                // Determine which dry run mode to use
                const isDryRunMode = isManual ? RUMIStorage.getManualProcessingSettings().dryRunMode : this.isDryRun;

                // Prepare ticket processing record
                const processedTicketData = {
                    ticketId: ticketId,
                    subject: ticketData.subject || 'N/A',
                    viewName: viewName || 'Manual',
                    action: result.action,
                    trigger: result.trigger || 'N/A',
                    previousStatus: originalStatus,
                    newStatus: result.payload?.ticket?.status || originalStatus,
                    previousGroupId: originalGroupId,
                    previousGroupName: previousGroupName,
                    newGroupId: newGroupId,
                    newGroupName: newGroupName,
                    previousAssigneeId: originalAssigneeId,
                    newAssigneeId: result.payload?.ticket?.assignee_id || originalAssigneeId,
                    dryRun: isDryRunMode,
                    alreadyCorrect: alreadyCorrect,
                    note: alreadyCorrect ? `Ticket should be set to ${targetStatus || newGroupName}, but it won't because it is already ${originalStatus || previousGroupName}` : null
                };

                // Apply changes or log dry run
                if (isDryRunMode) {
                    const prefix = isManual ? '[MANUAL DRY RUN]' : '[DRY RUN]';
                    RUMILogger.info('PROCESSOR', `${prefix} Would apply`, { ticketId, ...result, alreadyCorrect });

                    // Store processed ticket even in dry run (use appropriate storage based on manual flag)
                    if (isManual) {
                        RUMIStorage.addManualProcessedTicket(processedTicketData);
                        RUMIStorage.updateManualProcessingStats(result.action);
                    } else {
                        RUMIStorage.addProcessedTicket(processedTicketData);
                        RUMIStorage.updateProcessingStats(result.action);
                    }

                    return { ...result, dryRun: true, ticketData: processedTicketData };
                } else {
                    // Only apply changes if ticket is not already in desired state
                    if (!alreadyCorrect) {
                        await this.applyChanges(ticketId, result.payload);
                        // Don't mark routing actions as processed - they should process repeatedly
                        if (!['care', 'hala', 'casablanca'].includes(result.action)) {
                            RUMIIdempotency.setProcessedData(ticketId, {
                                commentId: latestCommentId,
                                actionType: result.action
                            });
                        }
                        const prefix = isManual ? '[MANUAL]' : '';
                        RUMILogger.info('PROCESSOR', `${prefix} Applied changes`, { ticketId, action: result.action });
                    } else {
                        RUMILogger.info('PROCESSOR', 'Ticket already in desired state', { ticketId, action: result.action });
                    }

                    // Store processed ticket regardless (use appropriate storage based on manual flag)
                    if (isManual) {
                        RUMIStorage.addManualProcessedTicket(processedTicketData);
                        RUMIStorage.updateManualProcessingStats(result.action);
                    } else {
                        RUMIStorage.addProcessedTicket(processedTicketData);
                        RUMIStorage.updateProcessingStats(result.action);
                    }

                    return { ...result, ticketData: processedTicketData };
                }

            } catch (error) {
                RUMILogger.error('PROCESSOR', 'Failed to process ticket', { ticketId, error: error.message });
                return { action: 'error', error: error.message };
            }
        }

        static async evaluateRules(ticket, comments, isManual = false, viewName = null) {
            // Load settings based on processing mode
            const settings = isManual ? RUMIStorage.getManualSettings() : RUMIStorage.getAutomaticSettings();

            // Rule priority: Routing → Escalation Response → Pending → Solved

            // 1. Check routing rules (including Care #notsafety)
            const routingResult = await this.evaluateRoutingRules(ticket, comments, settings);
            if (routingResult.action !== 'none') {
                return routingResult;
            }

            // 2. Check escalation response rules (ESCALATED_BUT_NO_RESPONSE)
            const escalationResult = await this.evaluateEscalationResponseRules(ticket, comments, settings, viewName);
            if (escalationResult.action !== 'none') {
                return escalationResult;
            }

            // 3. Check pending rules
            const pendingResult = await this.evaluatePendingRules(ticket, comments, settings, viewName);
            if (pendingResult.action !== 'none') {
                return pendingResult;
            }

            // 4. Check solved rules
            const solvedResult = await this.evaluateSolvedRules(ticket, comments, settings);
            if (solvedResult.action !== 'none') {
                return solvedResult;
            }

            return { action: 'none' };
        }

        static async evaluateRoutingRules(ticket, comments, settings) {
            // Hala Rides routing
            if (settings.actionTypes.rta && ticket.tags && ticket.tags.includes('ghc_provider_hala-rides')) {
                const payload = { ticket: { group_id: GROUP_IDS.HALA_RIDES } };
                // If ticket is pending or solved, change to open
                if (ticket.status === 'pending' || ticket.status === 'solved') {
                    payload.ticket.status = 'open';
                }
                return {
                    action: 'hala',
                    trigger: 'Tag: ghc_provider_hala-rides',
                    payload: payload
                };
            } else if (!settings.actionTypes.rta && ticket.tags && ticket.tags.includes('ghc_provider_hala-rides')) {
                RUMILogger.debug('Processor', 'RTA action type disabled in settings', { ticketId: ticket.id });
            }

            // Casablanca routing
            if (settings.actionTypes.casablanca && ticket.tags && ticket.tags.includes('casablanca')) {
                const payload = { ticket: { group_id: GROUP_IDS.CASABLANCA } };
                // If ticket is pending or solved, change to open
                if (ticket.status === 'pending' || ticket.status === 'solved') {
                    payload.ticket.status = 'open';
                }
                return {
                    action: 'casablanca',
                    trigger: 'Tag: casablanca',
                    payload: payload
                };
            } else if (!settings.actionTypes.casablanca && ticket.tags && ticket.tags.includes('casablanca')) {
                RUMILogger.debug('Processor', 'Casablanca action type disabled in settings', { ticketId: ticket.id });
            }

            // Care routing checks require care action type to be enabled
            if (!settings.actionTypes.care) {
                RUMILogger.debug('Processor', 'Care action type disabled in settings', { ticketId: ticket.id });
                return { action: 'none' };
            }

            // Care routing - ONLY check latest comment (no trace-back)
            // SOLID RULE: Routing operations if the reason is a comment trigger only works if the trigger is in the latest comment
            if (comments.length > 0) {
                const latestComment = comments[comments.length - 1];
                const triggerResult = await this.checkCommentForTriggers(latestComment, settings);

                if (triggerResult && triggerResult.type === 'care') {
                    const payload = { ticket: { group_id: GROUP_IDS.CARE } };
                    // If ticket is pending or solved, change to open
                    if (ticket.status === 'pending' || ticket.status === 'solved') {
                        payload.ticket.status = 'open';
                    }
                    return {
                        action: 'care',
                        trigger: `Routing phrase: ${triggerResult.trigger}`,
                        payload: payload
                    };
                }
            }

            // Care routing - subject-based (noActivityDetails)
            if (ticket.subject &&
                ticket.subject.toLowerCase().includes('noActivityDetails available') &&
                ticket.status === 'new') {

                const hasPrivateComments = comments.some(c => c.public === false);
                if (!hasPrivateComments) {
                    return {
                        action: 'care',
                        trigger: 'Subject: noActivityDetails available',
                        payload: { ticket: { group_id: GROUP_IDS.CARE, status: 'open' } }
                    };
                }
            }

            // Care routing - IRT concern
            if (ticket.requester_id === CONFIG.CAREEM_CARE_ID) {
                for (const comment of comments) {
                    const normalized = RUMICommentProcessor.normalizeForMatching(comment.html_body);
                    if (normalized.includes('irt concern has been handled')) {
                        const payload = { ticket: { group_id: GROUP_IDS.CARE } };
                        // If ticket is pending or solved, change to open
                        if (ticket.status === 'pending' || ticket.status === 'solved') {
                            payload.ticket.status = 'open';
                        }
                        return {
                            action: 'care',
                            trigger: 'IRT concern handled',
                            payload: payload
                        };
                    }
                }
            }

            return { action: 'none' };
        }

        static async evaluateEscalationResponseRules(ticket, comments, settings, viewName = null) {
            // Check if pending action type is enabled (this rule sets to pending)
            if (!settings.actionTypes.pending) {
                RUMILogger.debug('Processor', 'Pending action type disabled in settings', { ticketId: ticket.id });
                return { action: 'none' };
            }

            if (comments.length === 0) return { action: 'none' };

            const latestComment = comments[comments.length - 1];
            const latestAuthor = await this.getUserRole(latestComment.author_id);
            const latestNormalized = RUMICommentProcessor.normalizeForMatching(latestComment.html_body);
            const isLatestRFR = latestNormalized.includes('careem.rfr') || latestNormalized.includes('global.rfr');

            // Check if latest comment contains ESCALATED_BUT_NO_RESPONSE (do nothing if so)
            const escalationPhrase = RUMIRules.ESCALATED_BUT_NO_RESPONSE.toLowerCase();
            if (latestNormalized.includes(escalationPhrase)) {
                // ESCALATED_BUT_NO_RESPONSE is the last comment - no action
                return { action: 'none' };
            }

            // Only proceed if latest comment is from end-user OR contains "Careem.RFR" OR "Global.RFR"
            if (!latestAuthor.isEndUser && !isLatestRFR) {
                return { action: 'none' };
            }

            // Trace backwards through ONLY end-user or RFR (Careem.RFR/Global.RFR) comments
            // Stop at the first comment that is neither
            const startIndex = Math.max(0, comments.length - CONFIG.TRACE_BACK_COMMENT_LIMIT);
            let commentBeforeChain = null;

            for (let i = comments.length - 2; i >= startIndex; i--) {
                const comment = comments[i];
                const author = await this.getUserRole(comment.author_id);
                const normalized = RUMICommentProcessor.normalizeForMatching(comment.html_body);
                const isRFR = normalized.includes('careem.rfr') || normalized.includes('global.rfr');

                // If this comment is NOT (end-user OR RFR), it breaks the chain
                if (!author.isEndUser && !isRFR) {
                    // Found the first comment that breaks the chain
                    commentBeforeChain = comment;
                    break;
                }
                // Otherwise, continue tracing back through the chain
            }

            if (!commentBeforeChain) {
                return { action: 'none' };
            }

            // Check if this comment is internal (public = false) and contains ESCALATED_BUT_NO_RESPONSE
            if (commentBeforeChain.public === false) {
                const normalized = RUMICommentProcessor.normalizeForMatching(commentBeforeChain.html_body);

                if (normalized.includes(escalationPhrase)) {
                    // User or RFR responded after escalation - set to pending and assign to CAREEM_CARE_ID
                    const viewId = RUMIUI.viewsMap.get(viewName);
                    const specialViewIds = ['360069695114', '360000843468'];
                    const shouldSetPriorityNormal = viewId && specialViewIds.includes(String(viewId)) && ticket.priority !== 'normal';

                    const payload = {
                        ticket: {
                            status: 'pending',
                            assignee_id: CONFIG.CAREEM_CARE_ID
                        }
                    };

                    if (shouldSetPriorityNormal) {
                        payload.ticket.priority = 'normal';
                    }

                    return {
                        action: 'pending',
                        trigger: 'ESCALATED_BUT_NO_RESPONSE',
                        payload: payload
                    };
                }
            }

            // Chain was broken by a comment that does NOT contain ESCALATED_BUT_NO_RESPONSE
            // Do not keep looking - stop here
            return { action: 'none' };
        }

        static async evaluatePendingRules(ticket, comments, settings, viewName = null) {
            // Check if pending action type is enabled
            if (!settings.actionTypes.pending) {
                RUMILogger.debug('Processor', 'Pending action type disabled in settings', { ticketId: ticket.id });
                return { action: 'none' };
            }

            // Pending status - USE trace-back logic (different from care routing)
            // Status changes (pending/solved) should use trace-back because if agent sets pending and customer replies, it should still go pending
            const commentToCheck = await this.findCommentToCheck(comments);
            if (!commentToCheck) {
                return { action: 'none' };
            }

            // Special logic for link triggers: Check BEFORE regular trigger checks
            if (commentToCheck.public === false && commentToCheck.author_id.toString() === CONFIG.CAREEM_CARE_ID) {
                const commentIndex = comments.findIndex(c => c.id === commentToCheck.id);
                
                const linkTriggers = [
                    "https://blissnxt.uberinternal.com",
                    "https://uber.lighthouse-cloud.com", 
                    "https://apps.mypurecloud.ie"
                ];
                
                const normalizedComment = RUMICommentProcessor.normalizeForMatching(commentToCheck.html_body);
                const hasLinkTrigger = linkTriggers.some(link => 
                    RUMICommentProcessor.matchesTrigger(normalizedComment, link)
                );

                if (hasLinkTrigger) {
                    // Check preceding comment for triggers
                    if (commentIndex > 0) {
                        const precedingComment = comments[commentIndex - 1];
                        const precedingTriggerResult = await this.checkCommentForTriggers(precedingComment, settings);

                        if (precedingTriggerResult && precedingTriggerResult.type === 'solved') {
                            // Preceding comment has solved trigger → Set ticket to SOLVED
                            const userId = await this.ensureCurrentUserId();
                            return {
                                action: 'solved',
                                trigger: `Link trigger with solved preceding: ${precedingTriggerResult.trigger.substring(0, 40)}${precedingTriggerResult.trigger.length > 40 ? '...' : ''}`,
                                payload: {
                                    ticket: {
                                        status: 'solved',
                                        assignee_id: userId
                                    }
                                }
                            };
                        } else {
                            // Preceding comment has no triggers or non-solved triggers → Set ticket to PENDING
                            const viewId = RUMIUI.viewsMap.get(viewName);
                            const specialViewIds = ['360069695114', '360000843468'];
                            const shouldSetPriorityNormal = viewId && specialViewIds.includes(String(viewId)) && ticket.priority !== 'normal';

                            const payload = {
                                ticket: {
                                    status: 'pending',
                                    assignee_id: CONFIG.CAREEM_CARE_ID
                                }
                            };

                            if (shouldSetPriorityNormal) {
                                payload.ticket.priority = 'normal';
                            }

                            return {
                                action: 'pending',
                                trigger: `Link trigger with ${precedingTriggerResult ? 'non-solved' : 'no'} preceding trigger`,
                                payload: payload
                            };
                        }
                    } else {
                        // No preceding comment exists → Take NO ACTION
                        return { action: 'none' };
                    }
                }
            }

            // Check if the found comment has any triggers
            const triggerResult = await this.checkCommentForTriggers(commentToCheck, settings);

            // If comment has a trigger, process it based on type
            if (triggerResult) {
                if (triggerResult.type === 'pending') {
                    const viewId = RUMIUI.viewsMap.get(viewName);
                    const specialViewIds = ['360069695114', '360000843468'];
                    const shouldSetPriorityNormal = viewId && specialViewIds.includes(String(viewId)) && ticket.priority !== 'normal';

                    const payload = {
                        ticket: {
                            status: 'pending',
                            assignee_id: CONFIG.CAREEM_CARE_ID
                        }
                    };

                    if (shouldSetPriorityNormal) {
                        payload.ticket.priority = 'normal';
                    }

                    return {
                        action: 'pending',
                        trigger: triggerResult.trigger.substring(0, 500) + (triggerResult.trigger.length > 500 ? '...' : ''),
                        payload: payload
                    };
                }
                // If it has other triggers (solved/care), those are handled by other rule evaluators
                return { action: 'none' };
            }

            // No triggers found in commentToCheck
            // Check if commentToCheck is internal (private) - if so, check one comment before
            if (commentToCheck.public === false && commentToCheck.author_id.toString() === CONFIG.CAREEM_CARE_ID) {
                const commentIndex = comments.findIndex(c => c.id === commentToCheck.id);

                if (commentIndex > 0) {
                    const precedingComment = comments[commentIndex - 1];

                    // Check if preceding is from CAREEM_CARE_ID
                    if (precedingComment.author_id.toString() === CONFIG.CAREEM_CARE_ID) {
                        const precedingTriggerResult = await this.checkCommentForTriggers(precedingComment, settings);

                        if (precedingTriggerResult && precedingTriggerResult.type === 'pending') {
                            const viewId = RUMIUI.viewsMap.get(viewName);
                            const specialViewIds = ['360069695114', '360000843468'];
                            const shouldSetPriorityNormal = viewId && specialViewIds.includes(String(viewId)) && ticket.priority !== 'normal';

                            const payload = {
                                ticket: {
                                    status: 'pending',
                                    assignee_id: CONFIG.CAREEM_CARE_ID
                                }
                            };

                            if (shouldSetPriorityNormal) {
                                payload.ticket.priority = 'normal';
                            }

                            return {
                                action: 'pending',
                                trigger: `Preceding: ${precedingTriggerResult.trigger.substring(0, 40)}${precedingTriggerResult.trigger.length > 40 ? '...' : ''}`,
                                payload: payload
                            };
                        }
                    }
                }

            }

            // If commentToCheck is public from CAREEM_CARE_ID with no triggers, no action
            return { action: 'none' };
        }

        static async evaluateSolvedRules(ticket, comments, settings) {
            // Check if solved action type is enabled
            if (!settings.actionTypes.solved) {
                RUMILogger.debug('Processor', 'Solved action type disabled in settings', { ticketId: ticket.id });
                return { action: 'none' };
            }

            // Solved status - USE trace-back logic (different from care routing)
            // Status changes (pending/solved) should use trace-back because if agent sets solved and customer replies, it should still go solved/pending
            const commentToCheck = await this.findCommentToCheck(comments);
            if (!commentToCheck) {
                return { action: 'none' };
            }

            // Special logic for link triggers: Check BEFORE regular trigger checks
            if (commentToCheck.public === false && commentToCheck.author_id.toString() === CONFIG.CAREEM_CARE_ID) {
                const commentIndex = comments.findIndex(c => c.id === commentToCheck.id);
                
                const linkTriggers = [
                    "https://blissnxt.uberinternal.com",
                    "https://uber.lighthouse-cloud.com", 
                    "https://apps.mypurecloud.ie"
                ];
                
                const normalizedComment = RUMICommentProcessor.normalizeForMatching(commentToCheck.html_body);
                const hasLinkTrigger = linkTriggers.some(link => 
                    RUMICommentProcessor.matchesTrigger(normalizedComment, link)
                );

                if (hasLinkTrigger) {
                    // Check preceding comment for triggers
                    if (commentIndex > 0) {
                        const precedingComment = comments[commentIndex - 1];
                        const precedingTriggerResult = await this.checkCommentForTriggers(precedingComment, settings);

                        if (precedingTriggerResult && precedingTriggerResult.type === 'solved') {
                            // Preceding comment has solved trigger → Set ticket to SOLVED
                            const userId = await this.ensureCurrentUserId();
                            return {
                                action: 'solved',
                                trigger: `Link trigger with solved preceding: ${precedingTriggerResult.trigger.substring(0, 40)}${precedingTriggerResult.trigger.length > 40 ? '...' : ''}`,
                                payload: {
                                    ticket: {
                                        status: 'solved',
                                        assignee_id: userId
                                    }
                                }
                            };
                        } else {
                            // Preceding comment has no triggers or non-solved triggers → Set ticket to PENDING
                            return {
                                action: 'pending',
                                trigger: `Link trigger with ${precedingTriggerResult ? 'non-solved' : 'no'} preceding trigger`,
                                payload: {
                                    ticket: {
                                        status: 'pending',
                                        assignee_id: CONFIG.CAREEM_CARE_ID
                                    }
                                }
                            };
                        }
                    } else {
                        // No preceding comment exists → Take NO ACTION
                        return { action: 'none' };
                    }
                }
            }

            // Check if latest comment is from end-user (for traceback detection)
            const latestComment = comments[comments.length - 1];
            const latestAuthor = await this.getUserRole(latestComment.author_id);
            const isTracedBackFromEndUser = latestAuthor.isEndUser && commentToCheck.id !== latestComment.id;

            // Check if the found comment has any triggers
            const triggerResult = await this.checkCommentForTriggers(commentToCheck, settings);

            // If comment has a trigger, process it based on type
            if (triggerResult) {
                if (triggerResult.type === 'solved') {
                    const userId = await this.ensureCurrentUserId();

                    // If traced back from end-user comment, set to pending instead of solved
                    if (isTracedBackFromEndUser) {
                        return {
                            action: 'pending',
                            trigger: `end-user comment after: ${triggerResult.trigger.substring(0, 500)}${triggerResult.trigger.length > 500 ? '...' : ''}`,
                            payload: {
                                ticket: {
                                    status: 'pending',
                                    assignee_id: CONFIG.CAREEM_CARE_ID
                                }
                            }
                        };
                    }

                    // Otherwise, set to solved as normal
                    return {
                        action: 'solved',
                        trigger: triggerResult.trigger.substring(0, 500) + (triggerResult.trigger.length > 500 ? '...' : ''),
                        payload: {
                            ticket: {
                                status: 'solved',
                                assignee_id: userId
                            }
                        }
                    };
                }
                // If it has other triggers (pending/care), those are handled by other rule evaluators
                return { action: 'none' };
            }

            // No triggers found in commentToCheck
            // Check if commentToCheck is internal (private) - if so, check one comment before
            if (commentToCheck.public === false && commentToCheck.author_id.toString() === CONFIG.CAREEM_CARE_ID) {
                const commentIndex = comments.findIndex(c => c.id === commentToCheck.id);

                if (commentIndex > 0) {
                    const precedingComment = comments[commentIndex - 1];

                    // Check if preceding is from CAREEM_CARE_ID
                    if (precedingComment.author_id.toString() === CONFIG.CAREEM_CARE_ID) {
                        const precedingTriggerResult = await this.checkCommentForTriggers(precedingComment, settings);

                        if (precedingTriggerResult && precedingTriggerResult.type === 'solved') {
                            const userId = await this.ensureCurrentUserId();

                            // If traced back from end-user comment, set to pending instead of solved
                            if (isTracedBackFromEndUser) {
                                return {
                                    action: 'pending',
                                    trigger: `end-user comment after: Preceding: ${precedingTriggerResult.trigger.substring(0, 40)}${precedingTriggerResult.trigger.length > 40 ? '...' : ''}`,
                                    payload: {
                                        ticket: {
                                            status: 'pending',
                                            assignee_id: CONFIG.CAREEM_CARE_ID
                                        }
                                    }
                                };
                            }

                            // Otherwise, set to solved as normal
                            return {
                                action: 'solved',
                                trigger: `Preceding: ${precedingTriggerResult.trigger.substring(0, 40)}${precedingTriggerResult.trigger.length > 40 ? '...' : ''}`,
                                payload: {
                                    ticket: {
                                        status: 'solved',
                                        assignee_id: userId
                                    }
                                }
                            };
                        }
                    }
                }

            }

            // If commentToCheck is public from CAREEM_CARE_ID with no triggers, no action
            return { action: 'none' };
        }

        static async findCommentToCheck(comments) {
            if (comments.length === 0) return null;

            const latestComment = comments[comments.length - 1];
            const latestAuthor = await this.getUserRole(latestComment.author_id);

            // Case A: Latest comment is from end-user - trace back to find first CAREEM_CARE_ID comment
            if (latestAuthor.isEndUser) {
                const startIndex = Math.max(0, comments.length - CONFIG.TRACE_BACK_COMMENT_LIMIT);
                for (let i = comments.length - 2; i >= startIndex; i--) {
                    const comment = comments[i];
                    if (comment.author_id.toString() === CONFIG.CAREEM_CARE_ID) {
                        return comment;
                    }
                }
                return null;
            }

            // Case B & C: Latest comment is from CAREEM_CARE_ID
            if (latestComment.author_id.toString() === CONFIG.CAREEM_CARE_ID) {
                return latestComment;
            }

            // Latest comment is from another agent (not end-user, not CAREEM_CARE_ID)
            return null;
        }

        static async checkCommentForTriggers(comment, settings) {
            // Check if a comment contains any trigger phrases and return the result
            // PRIORITY ORDER: Routing triggers (Care, Casablanca, RTA) MUST be checked first, as they take priority over all other triggers
            const normalized = RUMICommentProcessor.normalizeForMatching(comment.html_body);

            // Check care routing triggers FIRST (highest priority)
            const enabledCareRoutingPhrases = RUMIRules.CARE_ROUTING_PHRASES.filter(phrase => {
                return settings.triggerPhrases.careRouting[phrase] !== false;
            });
            const careTrigger = enabledCareRoutingPhrases.find(phrase =>
                RUMICommentProcessor.matchesTrigger(normalized, phrase)
            );
            if (careTrigger) {
                // Check if the comment contains "duplicate" or "duplicated" - if so, mark as solved
                const duplicateCheck = normalized.toLowerCase();
                if (duplicateCheck.includes('duplicate') || duplicateCheck.includes('duplicated')) {
                    return { type: 'solved', trigger: 'duplicate_case' };
                }
                return { type: 'care', trigger: careTrigger };
            }

            // Check for both pending and solved triggers in the same comment
            const enabledPendingTriggers = RUMIRules.PENDING_TRIGGERS.filter(phrase => {
                return settings.triggerPhrases.pending[phrase] !== false;
            });
            const enabledSolvedTriggers = RUMIRules.SOLVED_TRIGGERS.filter(phrase => {
                return settings.triggerPhrases.solved[phrase] !== false;
            });
            
            const pendingTrigger = enabledPendingTriggers.find(phrase =>
                RUMICommentProcessor.matchesTrigger(normalized, phrase)
            );
            const solvedTrigger = enabledSolvedTriggers.find(phrase =>
                RUMICommentProcessor.matchesTrigger(normalized, phrase)
            );

            // If both solved and pending triggers exist in the same comment, prioritize solved
            if (solvedTrigger && pendingTrigger) {
                return { type: 'solved', trigger: solvedTrigger };
            }

            // Check pending triggers (second priority)
            if (pendingTrigger) {
                return { type: 'pending', trigger: pendingTrigger };
            }

            // Check solved triggers (lowest priority)
            if (solvedTrigger) {
                return { type: 'solved', trigger: solvedTrigger };
            }

            return null; // No triggers found
        }

        static async getUserRole(userId) {
            try {
                // CareemCare is never an end-user
                if (userId.toString() === CONFIG.CAREEM_CARE_ID) {
                    return { isEndUser: false, role: 'agent' };
                }

                const userData = await RUMIAPIManager.get(`/api/v2/users/${userId}.json`);
                return {
                    isEndUser: userData.user.role === 'end-user',
                    role: userData.user.role
                };
            } catch (error) {
                // If we can't fetch user, assume it's an agent to avoid routing processing
                RUMILogger.warn('PROCESSOR', 'Failed to fetch user role, assuming agent', { userId, error: error.message });
                return { isEndUser: false, role: 'unknown' };
            }
        }

        static async fetchAndCacheGroupName(groupId) {
            if (!groupId) return 'N/A';

            // Check cache first
            const cached = RUMIStorage.getGroupName(groupId);
            if (cached !== `Group ${groupId}`) {
                return cached;
            }

            // Fetch from API
            try {
                const data = await RUMIAPIManager.get(`/api/v2/groups/${groupId}.json`);
                const groupName = data.group.name;
                RUMIStorage.cacheGroup(groupId, groupName);
                return groupName;
            } catch (error) {
                RUMILogger.error('PROCESSOR', 'Failed to fetch group name', {
                    groupId,
                    error: error.message
                });
                return `Group ${groupId}`;
            }
        }

        static async applyChanges(ticketId, payload) {
            await RUMIAPIManager.put(`/api/v2/tickets/${ticketId}.json`, payload);
        }
    }

    // ============================================================================
    // STORAGE LAYER
    // ============================================================================

    class RUMIStorage {
        static get(key, defaultValue = null) {
            try {
                const value = GM_getValue('rumi_' + key);
                return value !== undefined ? JSON.parse(value) : defaultValue;
            } catch (error) {
                // Storage corruption can happen if user manually edited values
                // or if there was an incomplete write during a crash
                RUMILogger.error('STORAGE', 'Failed to parse stored value', { key, error: error.message });
                return defaultValue;
            }
        }

        static set(key, value) {
            try {
                GM_setValue('rumi_' + key, JSON.stringify(value));
            } catch (error) {
                RUMILogger.error('STORAGE', 'Failed to store value', { key, error: error.message });
            }
        }

        static remove(key) {
            try {
                GM_deleteValue('rumi_' + key);
            } catch (error) {
                RUMILogger.error('STORAGE', 'Failed to remove value', { key, error: error.message });
            }
        }

        static getSelectedViews() {
            const result = this.get('selected_views', []);
            console.log('[RUMI DEBUG] RUMIStorage.getSelectedViews() returning:', result);
            return result;
        }

        static setSelectedViews(viewIds) {
            console.log('[RUMI DEBUG] RUMIStorage.setSelectedViews() called with:', viewIds);
            this.set('selected_views', viewIds);
            // Verify immediately
            const rawValue = GM_getValue('rumi_selected_views');
            console.log('[RUMI DEBUG] Raw GM_getValue after set:', rawValue);
        }

        static getLogs() {
            return this.get('logs', []);
        }

        static addLog(entry) {
            const logs = this.getLogs();
            logs.push(entry);

            // Logs can grow unbounded over days of monitoring, causing storage bloat
            // and slowing down log retrieval. Cap at 5000 most recent entries.
            if (logs.length > CONFIG.LOG_MAX_ENTRIES) {
                logs.splice(0, logs.length - CONFIG.LOG_MAX_ENTRIES);
            }

            this.set('logs', logs);
        }

        static getProcessingSettings() {
            return this.get('processing_settings', {
                automaticProcessing: false,
                dryRunMode: true
            });
        }

        static setProcessingSettings(settings) {
            this.set('processing_settings', settings);
        }

        static getProcessingStats() {
            return this.get('processing_stats', {
                totalProcessed: 0,
                pending: 0,
                solved: 0,
                care: 0,
                hala: 0,
                casablanca: 0,
                errors: 0
            });
        }

        static updateProcessingStats(action) {
            const stats = this.getProcessingStats();
            stats.totalProcessed++;

            if (action === 'pending') stats.pending++;
            else if (action === 'solved') stats.solved++;
            else if (action === 'care') stats.care++;
            else if (action === 'hala') stats.hala++;
            else if (action === 'casablanca') stats.casablanca++;
            else if (action === 'error') stats.errors++;

            this.set('processing_stats', stats);
        }

        static resetProcessingStats() {
            this.remove('processing_stats');
        }

        // Manual Processing Stats (separate from automatic processing)
        static getManualProcessingStats() {
            return this.get('manual_processing_stats', {
                totalProcessed: 0,
                pending: 0,
                solved: 0,
                care: 0,
                hala: 0,
                casablanca: 0,
                errors: 0
            });
        }

        static updateManualProcessingStats(action) {
            const stats = this.getManualProcessingStats();
            stats.totalProcessed++;

            if (action === 'pending') stats.pending++;
            else if (action === 'solved') stats.solved++;
            else if (action === 'care') stats.care++;
            else if (action === 'hala') stats.hala++;
            else if (action === 'casablanca') stats.casablanca++;
            else if (action === 'error') stats.errors++;

            this.set('manual_processing_stats', stats);
        }

        static resetManualProcessingStats() {
            this.remove('manual_processing_stats');
        }

        static getProcessedTickets() {
            return this.get('processed_tickets', []);
        }

        static addProcessedTicket(ticketData) {
            const tickets = this.getProcessedTickets();
            tickets.push({
                ...ticketData,
                timestamp: new Date().toISOString()
            });

            // Keep last 1500 processed tickets
            if (tickets.length > 1500) {
                tickets.splice(0, tickets.length - 1500);
            }

            this.set('processed_tickets', tickets);
        }

        static clearProcessedTickets() {
            this.remove('processed_tickets');
        }

        // Manual Processing Tickets (separate from automatic processing)
        static getManualProcessedTickets() {
            return this.get('manual_processed_tickets', []);
        }

        static addManualProcessedTicket(ticketData) {
            const tickets = this.getManualProcessedTickets();
            tickets.push({
                ...ticketData,
                timestamp: new Date().toISOString()
            });

            // Keep last 1500 processed tickets
            if (tickets.length > 1500) {
                tickets.splice(0, tickets.length - 1500);
            }

            this.set('manual_processed_tickets', tickets);
        }

        static clearManualProcessedTickets() {
            this.remove('manual_processed_tickets');
        }

        // Manual Processing Settings (separate dry run mode)
        static getManualProcessingSettings() {
            return this.get('manual_processing_settings', {
                dryRunMode: true
            });
        }

        static setManualProcessingSettings(settings) {
            this.set('manual_processing_settings', settings);
        }

        static getGroupCache() {
            return this.get('group_cache', {});
        }

        static cacheGroup(groupId, groupName) {
            const cache = this.getGroupCache();
            cache[groupId] = groupName;
            this.set('group_cache', cache);
        }

        static getGroupName(groupId) {
            if (!groupId) return 'N/A';
            const cache = this.getGroupCache();
            return cache[groupId] || `Group ${groupId}`;
        }

        // Pinned Tickets Storage
        static getPinnedBlocked() {
            return this.get('pinned_blocked', []);
        }

        static setPinnedBlocked(pins) {
            this.set('pinned_blocked', pins);
        }

        static getPinnedCareRouting() {
            return this.get('pinned_care_routing', []);
        }

        static setPinnedCareRouting(pins) {
            this.set('pinned_care_routing', pins);
        }

        static addPinnedBlocked(ticketId) {
            const pins = this.getPinnedBlocked();
            pins.push({
                ticketId: ticketId,
                timestamp: new Date().toISOString()
            });
            this.setPinnedBlocked(pins);
        }

        static addPinnedCareRouting(ticketId, commentId) {
            const pins = this.getPinnedCareRouting();
            pins.push({
                ticketId: ticketId,
                timestamp: new Date().toISOString(),
                lastCommentId: commentId,
                status: 'active'
            });
            this.setPinnedCareRouting(pins);
        }

        static removePinnedBlocked(ticketId) {
            const pins = this.getPinnedBlocked();
            const filtered = pins.filter(p => p.ticketId !== ticketId);
            this.setPinnedBlocked(filtered);
        }

        static removePinnedCareRouting(ticketId) {
            const pins = this.getPinnedCareRouting();
            const filtered = pins.filter(p => p.ticketId !== ticketId);
            this.setPinnedCareRouting(filtered);
        }

        static updatePinnedCareRoutingStatus(ticketId, status, commentId = null) {
            const pins = this.getPinnedCareRouting();
            const pin = pins.find(p => p.ticketId === ticketId);
            if (pin) {
                pin.status = status;
                if (status === 'changed') {
                    pin.lastCommentId = null;
                } else if (commentId !== null) {
                    pin.lastCommentId = commentId;
                }
                this.setPinnedCareRouting(pins);
            }
        }

        static isTicketPinned(ticketId) {
            const blockedPins = this.getPinnedBlocked();
            const careRoutingPins = this.getPinnedCareRouting();

            const isBlocked = blockedPins.some(p => p.ticketId === ticketId);
            const isCareRouting = careRoutingPins.some(p => p.ticketId === ticketId);

            return isBlocked || isCareRouting;
        }

        static getAutomaticSettings() {
            const defaults = {
                actionTypes: {
                    solved: true,
                    pending: true,
                    care: true,
                    rta: true,
                    casablanca: true
                },
                triggerPhrases: {
                    pending: {},
                    solved: {},
                    careRouting: {}
                }
            };

            const stored = this.get('rumi_settings_automatic', null);
            if (!stored) {
                // First time - initialize with all enabled
                const initialized = this.initializeSettings(defaults);
                this.setAutomaticSettings(initialized);
                return initialized;
            }

            // Sync with current trigger phrases (add new ones, keep existing settings)
            const synced = this.syncTriggerPhrases(stored);
            if (synced !== stored) {
                this.setAutomaticSettings(synced);
            }

            return synced;
        }

        static setAutomaticSettings(settings) {
            this.set('rumi_settings_automatic', settings);
        }

        static getManualSettings() {
            const defaults = {
                actionTypes: {
                    solved: true,
                    pending: true,
                    care: true,
                    rta: true,
                    casablanca: true
                },
                triggerPhrases: {
                    pending: {},
                    solved: {},
                    careRouting: {}
                }
            };

            const stored = this.get('rumi_settings_manual', null);
            if (!stored) {
                // First time - initialize with all enabled
                const initialized = this.initializeSettings(defaults);
                this.setManualSettings(initialized);
                return initialized;
            }

            // Sync with current trigger phrases (add new ones, keep existing settings)
            const synced = this.syncTriggerPhrases(stored);
            if (synced !== stored) {
                this.setManualSettings(synced);
            }

            return synced;
        }

        static setManualSettings(settings) {
            this.set('rumi_settings_manual', settings);
        }

        static initializeSettings(defaults) {
            // Initialize all trigger phrases from RUMIRules with enabled = true
            const settings = JSON.parse(JSON.stringify(defaults)); // Deep clone

            RUMIRules.PENDING_TRIGGERS.forEach(phrase => {
                settings.triggerPhrases.pending[phrase] = true;
            });

            RUMIRules.SOLVED_TRIGGERS.forEach(phrase => {
                settings.triggerPhrases.solved[phrase] = true;
            });

            RUMIRules.CARE_ROUTING_PHRASES.forEach(phrase => {
                settings.triggerPhrases.careRouting[phrase] = true;
            });

            return settings;
        }

        static syncTriggerPhrases(settings) {
            // Sync stored settings with current trigger phrases in code
            // This ensures new/modified phrases are added while preserving user's enabled/disabled choices
            // and removes phrases that are no longer in the code
            let modified = false;
            const synced = JSON.parse(JSON.stringify(settings)); // Deep clone

            // Ensure structure exists
            if (!synced.triggerPhrases) {
                synced.triggerPhrases = { pending: {}, solved: {}, careRouting: {} };
                modified = true;
            }
            if (!synced.triggerPhrases.pending) {
                synced.triggerPhrases.pending = {};
                modified = true;
            }
            if (!synced.triggerPhrases.solved) {
                synced.triggerPhrases.solved = {};
                modified = true;
            }
            if (!synced.triggerPhrases.careRouting) {
                synced.triggerPhrases.careRouting = {};
                modified = true;
            }

            // Create sets of current phrases for efficient lookup
            const currentPendingPhrases = new Set(RUMIRules.PENDING_TRIGGERS);
            const currentSolvedPhrases = new Set(RUMIRules.SOLVED_TRIGGERS);
            const currentCareRoutingPhrases = new Set(RUMIRules.CARE_ROUTING_PHRASES);

            // Remove phrases that are no longer in the code
            const pendingPhrasesToRemove = Object.keys(synced.triggerPhrases.pending).filter(
                phrase => !currentPendingPhrases.has(phrase)
            );
            if (pendingPhrasesToRemove.length > 0) {
                RUMILogger.info('STORAGE', 'Removing obsolete pending trigger phrases', {
                    removedPhrases: pendingPhrasesToRemove
                });
                pendingPhrasesToRemove.forEach(phrase => {
                    delete synced.triggerPhrases.pending[phrase];
                    modified = true;
                });
            }

            const solvedPhrasesToRemove = Object.keys(synced.triggerPhrases.solved).filter(
                phrase => !currentSolvedPhrases.has(phrase)
            );
            if (solvedPhrasesToRemove.length > 0) {
                RUMILogger.info('STORAGE', 'Removing obsolete solved trigger phrases', {
                    removedPhrases: solvedPhrasesToRemove
                });
                solvedPhrasesToRemove.forEach(phrase => {
                    delete synced.triggerPhrases.solved[phrase];
                    modified = true;
                });
            }

            const careRoutingPhrasesToRemove = Object.keys(synced.triggerPhrases.careRouting).filter(
                phrase => !currentCareRoutingPhrases.has(phrase)
            );
            if (careRoutingPhrasesToRemove.length > 0) {
                RUMILogger.info('STORAGE', 'Removing obsolete care routing trigger phrases', {
                    removedPhrases: careRoutingPhrasesToRemove
                });
                careRoutingPhrasesToRemove.forEach(phrase => {
                    delete synced.triggerPhrases.careRouting[phrase];
                    modified = true;
                });
            }

            // Add any new pending triggers
            const newPendingPhrases = [];
            RUMIRules.PENDING_TRIGGERS.forEach(phrase => {
                if (!(phrase in synced.triggerPhrases.pending)) {
                    synced.triggerPhrases.pending[phrase] = true; // Default to enabled
                    newPendingPhrases.push(phrase);
                    modified = true;
                }
            });
            if (newPendingPhrases.length > 0) {
                RUMILogger.info('STORAGE', 'Adding new pending trigger phrases', {
                    newPhrases: newPendingPhrases
                });
            }

            // Add any new solved triggers
            const newSolvedPhrases = [];
            RUMIRules.SOLVED_TRIGGERS.forEach(phrase => {
                if (!(phrase in synced.triggerPhrases.solved)) {
                    synced.triggerPhrases.solved[phrase] = true; // Default to enabled
                    newSolvedPhrases.push(phrase);
                    modified = true;
                }
            });
            if (newSolvedPhrases.length > 0) {
                RUMILogger.info('STORAGE', 'Adding new solved trigger phrases', {
                    newPhrases: newSolvedPhrases
                });
            }

            // Add any new care routing phrases
            const newCareRoutingPhrases = [];
            RUMIRules.CARE_ROUTING_PHRASES.forEach(phrase => {
                if (!(phrase in synced.triggerPhrases.careRouting)) {
                    synced.triggerPhrases.careRouting[phrase] = true; // Default to enabled
                    newCareRoutingPhrases.push(phrase);
                    modified = true;
                }
            });
            if (newCareRoutingPhrases.length > 0) {
                RUMILogger.info('STORAGE', 'Adding new care routing trigger phrases', {
                    newPhrases: newCareRoutingPhrases
                });
            }

            return modified ? synced : settings;
        }

        static getUISettings() {
            return this.get('ui_settings', {
                theme: 'dark' // Default to dark mode
            });
        }

        static setUISettings(settings) {
            this.set('ui_settings', settings);
        }

        static getCurrentUser() {
            return this.get('current_user', null);
        }

        static setCurrentUser(user) {
            this.set('current_user', user);
        }
    }

    // ============================================================================
    // PIN MANAGER
    // ============================================================================

    class RUMIPinManager {
        static async addPin(ticketId, pinType) {
            try {
                // Validate inputs
                if (!ticketId || !ticketId.trim()) {
                    RUMIUI.showToast('Please enter a valid ticket ID', 'error');
                    return false;
                }

                const trimmedTicketId = ticketId.trim();

                // Check for duplicates
                if (RUMIStorage.isTicketPinned(trimmedTicketId)) {
                    RUMIUI.showToast(`Ticket ${trimmedTicketId} is already pinned`, 'warning');
                    return false;
                }

                if (pinType === 'blocked') {
                    RUMIStorage.addPinnedBlocked(trimmedTicketId);
                    RUMILogger.info('PIN_MANAGER', 'Blocked pin added', { ticketId: trimmedTicketId });
                    RUMIUI.showToast(`Ticket ${trimmedTicketId} blocked from processing`, 'success');
                } else if (pinType === 'care_routing') {
                    // Fetch ticket to get latest comment ID
                    const comments = await RUMIAPIManager.get(`/api/v2/tickets/${trimmedTicketId}/comments.json`);

                    if (!comments || !comments.comments || comments.comments.length === 0) {
                        RUMIUI.showToast(`Cannot pin ticket ${trimmedTicketId}: No comments found`, 'error');
                        return false;
                    }

                    const latestCommentId = comments.comments[comments.comments.length - 1].id;
                    RUMIStorage.addPinnedCareRouting(trimmedTicketId, latestCommentId);
                    RUMILogger.info('PIN_MANAGER', 'Care routing pin added', {
                        ticketId: trimmedTicketId,
                        commentId: latestCommentId
                    });

                    // Immediately route to Care
                    await this.processCareRoutingPin(trimmedTicketId);

                    RUMIUI.showToast(`Ticket ${trimmedTicketId} pinned for Care routing`, 'success');
                }

                // Refresh the pinned list UI
                RUMIUI.renderPinnedList();
                return true;

            } catch (error) {
                RUMILogger.error('PIN_MANAGER', 'Failed to add pin', { ticketId, pinType, error: error.message });
                RUMIUI.showToast(`Failed to pin ticket: ${error.message}`, 'error');
                return false;
            }
        }

        static removePin(ticketId, pinType) {
            try {
                if (pinType === 'blocked') {
                    RUMIStorage.removePinnedBlocked(ticketId);
                    RUMILogger.info('PIN_MANAGER', 'Blocked pin removed', { ticketId });
                    RUMIUI.showToast(`Ticket ${ticketId} unblocked`, 'success');
                } else if (pinType === 'care_routing') {
                    RUMIStorage.removePinnedCareRouting(ticketId);
                    RUMILogger.info('PIN_MANAGER', 'Care routing pin removed', { ticketId });
                    RUMIUI.showToast(`Care routing pin removed for ticket ${ticketId}`, 'success');
                }

                // Refresh the pinned list UI
                RUMIUI.renderPinnedList();
                return true;

            } catch (error) {
                RUMILogger.error('PIN_MANAGER', 'Failed to remove pin', { ticketId, pinType, error: error.message });
                RUMIUI.showToast(`Failed to remove pin: ${error.message}`, 'error');
                return false;
            }
        }

        // Check if ticket is blocked, called at start of processing
        static checkBlockedPin(ticketId) {
            const blockedPins = RUMIStorage.getPinnedBlocked();
            const isBlocked = blockedPins.some(p => p.ticketId === ticketId);

            if (isBlocked) {
                RUMILogger.info('PIN_MANAGER', 'Ticket skipped due to blocked pin', { ticketId });
                return true;
            }

            return false;
        }

        // Check and process care routing pin
        // Accepts optional ticketData and commentsList to avoid redundant API calls
        static async checkCareRoutingPin(ticketId, ticketData = null, commentsList = null) {
            const careRoutingPins = RUMIStorage.getPinnedCareRouting();
            const pin = careRoutingPins.find(p => p.ticketId === ticketId);

            if (!pin) {
                return null; // No care routing pin for this ticket
            }

            RUMILogger.info('PIN_MANAGER', '📌 Care routing pin found - processing ticket', { 
                ticketId, 
                pinStatus: pin.status, 
                lastCommentId: pin.lastCommentId,
                timestamp: pin.timestamp
            });

            // If status is 'changed', skip processing
            if (pin.status === 'changed') {
                RUMILogger.info('PIN_MANAGER', '⏭️ Ticket skipped: care routing pin status is changed', { ticketId });
                return { action: 'skipped', reason: 'care_pin_changed' };
            }

            // Status is 'active', process the pin
            try {
                // Fetch ticket data if not provided (for closed ticket check and status check)
                if (!ticketData) {
                    const ticketResponse = await RUMIAPIManager.get(`/api/v2/tickets/${ticketId}.json`);
                    ticketData = ticketResponse.ticket;
                }

                // Check if ticket is closed - cannot route closed tickets
                if (ticketData.status === 'closed') {
                    RUMILogger.warn('PIN_MANAGER', '❌ Cannot route closed ticket via care routing pin', { ticketId });
                    return { action: 'skipped', reason: 'ticket_closed' };
                }

                // Fetch comments if not provided
                if (!commentsList) {
                    const commentsResponse = await RUMIAPIManager.get(`/api/v2/tickets/${ticketId}/comments.json`);
                    commentsList = commentsResponse.comments || [];
                } else {
                    // If commentsList is an object with comments property, extract the array
                    if (commentsList.comments) {
                        commentsList = commentsList.comments;
                    }
                }

                if (!commentsList || commentsList.length === 0) {
                    RUMILogger.warn('PIN_MANAGER', '❌ No comments found for care routing pin', { ticketId });
                    return { action: 'skipped', reason: 'no_comments' };
                }

                const latestCommentId = commentsList[commentsList.length - 1].id;

                // For care routing pins, always route to Care regardless of comment changes
                // Update the pin's lastCommentId to track the latest comment
                if (latestCommentId !== pin.lastCommentId) {
                    RUMILogger.info('PIN_MANAGER', '🆕 New comment detected, marking pin as changed', {
                        ticketId,
                        oldCommentId: pin.lastCommentId,
                        newCommentId: latestCommentId
                    });
                    
                    // Mark pin as 'changed' - stops automatic processing
                    RUMIStorage.updatePinnedCareRoutingStatus(ticketId, 'changed');
                } else {
                    RUMILogger.info('PIN_MANAGER', '🔄 Comment unchanged, routing to Care', {
                        ticketId,
                        commentId: latestCommentId,
                        currentStatus: ticketData.status
                    });
                }

                // Always route to Care for active care routing pins
                // Build payload - only set status to 'open' if not already 'open'
                const payload = {
                    ticket: {
                        group_id: CONFIG.GROUP_IDS.CARE
                    }
                };

                if (ticketData.status !== 'open') {
                    payload.ticket.status = 'open';
                    RUMILogger.info('PIN_MANAGER', '📝 Will also set status to open', {
                        ticketId,
                        currentStatus: ticketData.status
                    });
                }

                RUMILogger.info('PIN_MANAGER', '🚀 Routing to Care via pin', {
                    ticketId,
                    targetGroupId: CONFIG.GROUP_IDS.CARE,
                    currentGroupId: ticketData.group_id
                });

                return {
                    action: 'care',
                    trigger: 'Care Routing Pin',
                    payload: payload
                };

            } catch (error) {
                RUMILogger.error('PIN_MANAGER', 'Error checking care routing pin', { ticketId, error: error.message });
                return { action: 'error', error: error.message };
            }
        }

        // Process a care routing pin immediately (called when pin is first added)
        static async processCareRoutingPin(ticketId) {
            try {
                const ticket = await RUMIAPIManager.get(`/api/v2/tickets/${ticketId}.json`);
                const ticketData = ticket.ticket;

                // Only route if ticket is not already closed
                if (ticketData.status === 'closed') {
                    RUMILogger.warn('PIN_MANAGER', 'Cannot route closed ticket to Care', { ticketId });
                    return;
                }

                // Build payload - only set status to 'open' if not already 'open'
                const payload = {
                    ticket: {
                        group_id: GROUP_IDS.CARE
                    }
                };

                if (ticketData.status !== 'open') {
                    payload.ticket.status = 'open';
                }

                // Get group names for processed table entry
                const previousGroupName = await RUMIProcessor.fetchAndCacheGroupName(ticketData.group_id);
                const newGroupId = payload.ticket.group_id;
                const newGroupName = await RUMIProcessor.fetchAndCacheGroupName(newGroupId);

                // Respect dry run mode
                if (RUMIProcessor.isDryRun) {
                    RUMILogger.info('PIN_MANAGER', '[DRY RUN] Would apply initial Care routing', {
                        ticketId,
                        payload,
                        currentStatus: ticketData.status
                    });
                } else {
                    await RUMIProcessor.applyChanges(ticketId, payload);
                    RUMILogger.info('PIN_MANAGER', 'Initial Care routing applied', {
                        ticketId,
                        statusChanged: ticketData.status !== 'open'
                    });
                }

                // Add to automatic processed table regardless of dry run mode
                const carePinData = {
                    ticketId: ticketId,
                    subject: ticketData.subject || 'N/A',
                    viewName: 'Pinned Ticket',
                    action: 'care',
                    trigger: 'pinned ticket',
                    previousStatus: ticketData.status,
                    newStatus: payload.ticket.status || ticketData.status,
                    previousGroupId: ticketData.group_id,
                    previousGroupName: previousGroupName,
                    newGroupId: newGroupId,
                    newGroupName: newGroupName,
                    previousAssigneeId: ticketData.assignee_id,
                    newAssigneeId: ticketData.assignee_id,
                    dryRun: RUMIProcessor.isDryRun,
                    alreadyCorrect: false,
                    note: null
                };
                RUMIStorage.addProcessedTicket(carePinData);
                RUMIStorage.updateProcessingStats('care');

            } catch (error) {
                RUMILogger.error('PIN_MANAGER', 'Failed to process care routing pin', { ticketId, error: error.message });
            }
        }
    }

    // ============================================================================
    // LOGGING LAYER
    // ============================================================================

    class RUMILogger {
        static isManualProcessing = false; // Flag to suppress verbose logging during batch

        static debug(module, message, meta = {}) {
            // Skip DEBUG logs during manual processing to reduce memory usage
            if (this.isManualProcessing && module === 'API') {
                return;
            }
            this.log('debug', module, message, meta);
        }

        static info(module, message, meta = {}) {
            // Skip verbose UI logs that clutter the log view
            if (module === 'UI' && message === 'Saved selected views') {
                return;
            }
            this.log('info', module, message, meta);
        }

        static warn(module, message, meta = {}) {
            this.log('warn', module, message, meta);
        }

        static error(module, message, meta = {}) {
            this.log('error', module, message, meta);
        }

        static log(level, module, message, meta) {
            const entry = {
                timestamp: new Date().toISOString(),
                level,
                module,
                message,
                meta: this.sanitizeMeta(meta)
            };

            RUMIStorage.addLog(entry);

            // Update UI logs if the logs container exists
            if (typeof RUMIUI !== 'undefined' && RUMIUI.renderLogs) {
                RUMIUI.renderLogs();
            }
        }

        static sanitizeMeta(meta) {
            // Logs can be exported or viewed by support staff, so we strip
            // authentication tokens and credentials to prevent security leaks
            const sanitized = { ...meta };
            delete sanitized.csrfToken;
            delete sanitized.authToken;
            delete sanitized.password;
            delete sanitized.token;
            return sanitized;
        }
    }

    // ============================================================================
    // API LAYER
    // ============================================================================

    class RUMIAPIManager {
        static csrfToken = null;
        static retryConfig = {
            maxRetries: CONFIG.RETRY_MAX_ATTEMPTS,
            backoffMs: CONFIG.RETRY_BACKOFF_MS
        };

        static async init() {
            try {
                // Zendesk requires CSRF token for state-changing requests, extract it once on init
                const meta = document.querySelector('meta[name="csrf-token"]');
                if (meta) {
                    this.csrfToken = meta.content;
                    RUMILogger.info('API', 'CSRF token extracted successfully');
                } else {
                    RUMILogger.warn('API', 'No CSRF token found in page');
                }
            } catch (error) {
                RUMILogger.error('API', 'Failed to initialize API manager', { error: error.message });
            }
        }

        static async request(method, endpoint, data = null, attempt = 1) {
            const startTime = Date.now();

            const options = {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest'
                },
                credentials: 'same-origin'
            };

            // Add CSRF token for state-changing requests
            if (method !== 'GET' && this.csrfToken) {
                options.headers['X-CSRF-Token'] = this.csrfToken;
            }

            // Add body for non-GET requests
            if (data && method !== 'GET') {
                options.body = JSON.stringify(data);
            }

            try {
                const response = await fetch(endpoint, options);
                const duration = Date.now() - startTime;

                if (response.status >= 200 && response.status < 300) {
                    RUMILogger.debug('API', `${method} ${endpoint} succeeded`, {
                        status: response.status,
                        duration
                    });
                    const result = await response.json();
                    return result;
                }

                // Zendesk may rate limit during high-traffic monitoring periods
                // Respect their Retry-After header to avoid getting blocked entirely
                if (response.status === 429) {
                    const retryAfter = parseInt(response.headers.get('Retry-After') || '5', 10);
                    RUMILogger.warn('API', `Rate limited, retrying after ${retryAfter}s`, {
                        endpoint,
                        attempt
                    });

                    if (attempt < this.retryConfig.maxRetries) {
                        await this.sleep(retryAfter * 1000);
                        return await this.request(method, endpoint, data, attempt + 1);
                    } else {
                        throw new Error(`Rate limit exceeded after ${attempt} attempts`);
                    }
                }

                // Zendesk occasionally has transient 5xx errors during deployments
                // Exponential backoff gives their servers time to recover
                if (response.status >= 500) {
                    RUMILogger.warn('API', `Server error ${response.status}, retrying`, {
                        endpoint,
                        attempt
                    });

                    if (attempt < this.retryConfig.maxRetries) {
                        const backoffMs = this.retryConfig.backoffMs * Math.pow(2, attempt - 1);
                        await this.sleep(backoffMs);
                        return await this.request(method, endpoint, data, attempt + 1);
                    } else {
                        throw new Error(`Server error after ${attempt} attempts`);
                    }
                }

                // Permission errors mean agent lacks view access or session expired
                // No point retrying, user needs to fix permissions or re-login
                if (response.status === 401 || response.status === 403) {
                    RUMILogger.error('API', `Permission denied: ${response.status}`, {
                        endpoint,
                        status: response.status
                    });
                    throw new Error(`Permission denied: ${response.status}`);
                }

                RUMILogger.error('API', `Request failed: ${response.status}`, {
                    endpoint,
                    status: response.status,
                    duration
                });
                throw new Error(`API Error: ${response.status}`);

            } catch (error) {
                const duration = Date.now() - startTime;

                // If it's not our custom error, it's a network error
                if (!error.message.startsWith('Rate limit') &&
                    !error.message.startsWith('Server error') &&
                    !error.message.startsWith('Permission denied') &&
                    !error.message.startsWith('API Error')) {
                    RUMILogger.error('API', 'Network error', {
                        endpoint,
                        error: error.message,
                        duration
                    });
                }
                throw error;
            }
        }

        static async get(endpoint) {
            return this.request('GET', endpoint);
        }

        static async put(endpoint, data) {
            return this.request('PUT', endpoint, data);
        }

        // Batch fetch multiple tickets at once (up to 100 per request)
        static async batchGetTickets(ticketIds) {
            const BATCH_SIZE = 200; // Zendesk limit
            const allTickets = [];

            for (let i = 0; i < ticketIds.length; i += BATCH_SIZE) {
                const batch = ticketIds.slice(i, i + BATCH_SIZE);
                const idsParam = batch.join(',');
                const response = await this.get(`/api/v2/tickets/show_many.json?ids=${idsParam}`);
                allTickets.push(...(response.tickets || []));
            }

            return allTickets;
        }

        // Batch fetch multiple tickets with their comments in parallel
        static async batchGetTicketsWithComments(ticketIds) {
            const CONCURRENT_LIMIT = 50; // Process 50 tickets at once
            const results = [];

            for (let i = 0; i < ticketIds.length; i += CONCURRENT_LIMIT) {
                const batch = ticketIds.slice(i, i + CONCURRENT_LIMIT);

                // Fetch tickets and comments in parallel for this batch
                const batchPromises = batch.map(async (ticketId) => {
                    try {
                        const [ticketResponse, commentsResponse] = await Promise.all([
                            this.get(`/api/v2/tickets/${ticketId}.json`),
                            this.get(`/api/v2/tickets/${ticketId}/comments.json`)
                        ]);

                        return {
                            ticketId,
                            ticket: ticketResponse.ticket,
                            comments: commentsResponse.comments || [],
                            success: true
                        };
                    } catch (error) {
                        RUMILogger.error('API', `Failed to fetch ticket ${ticketId}`, {
                            ticketId,
                            error: error.message
                        });
                        return {
                            ticketId,
                            ticket: null,
                            comments: [],
                            success: false,
                            error: error.message
                        };
                    }
                });

                const batchResults = await Promise.all(batchPromises);
                results.push(...batchResults);
            }

            return results;
        }

        static sleep(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        }
    }

    // ============================================================================
    // MONITORING ENGINE
    // ============================================================================

    class RUMIMonitor {
        static isRunning = false;
        static intervalId = null;
        static selectedViews = [];
        static intervalSeconds = CONFIG.DEFAULT_INTERVAL_SECONDS;
        static baselineTickets = new Map(); // Track existing tickets per view
        static manualProcessingCancelled = false; // Flag to cancel manual processing
        static failedPolls = new Map(); // Track which views failed to poll (viewId -> failureCount)

        static async start() {
            if (this.isRunning) {
                RUMILogger.warn('MONITOR', 'Already running');
                return false;
            }

            this.selectedViews = RUMIStorage.getSelectedViews();

            // Also log to console for debugging
            console.log('[RUMI DEBUG] Retrieved selected views:', this.selectedViews);
            console.log('[RUMI DEBUG] Selected views count:', this.selectedViews.length);
            console.log('[RUMI DEBUG] Selected views type:', typeof this.selectedViews, Array.isArray(this.selectedViews));

            RUMILogger.info('MONITOR', 'Starting monitoring - checking selected views', {
                selectedViews: this.selectedViews,
                count: this.selectedViews.length,
                rawStorageValue: GM_getValue('rumi_selected_views')
            });

            if (!Array.isArray(this.selectedViews) || this.selectedViews.length === 0) {
                console.error('[RUMI DEBUG] No views selected or invalid data type');
                RUMILogger.warn('MONITOR', 'No views selected - cannot start');
                RUMIUI.showToast('Please select at least one view to monitor', 'warning');
                return false;
            }

            // Process existing tickets and establish baseline
            RUMILogger.info('MONITOR', 'Processing existing tickets in selected views');
            RUMIUI.showToast('Processing existing tickets...', 'info');
            try {
                await this.processExistingAndEstablishBaseline();
                RUMIUI.showToast('Existing tickets processed - now monitoring for new tickets', 'success');
            } catch (error) {
                RUMILogger.error('MONITOR', 'Failed to process existing tickets', { error: error.message });
                RUMIUI.showToast('Failed to start monitoring - could not process existing tickets', 'error');
                return false;
            }

            this.isRunning = true;
            RUMILogger.info('MONITOR', 'Started monitoring', {
                viewCount: this.selectedViews.length,
                interval: this.intervalSeconds
            });

            RUMIUI.updateConnectionStatus('monitoring');

            // Poll immediately so users see activity without waiting for first interval
            await this.poll();

            this.intervalId = setInterval(() => this.poll(), this.intervalSeconds * 1000);
            return true;
        }

        static async processExistingAndEstablishBaseline() {
            this.baselineTickets.clear();

            for (const viewId of this.selectedViews) {
                try {
                    const viewName = await RUMIUI.getViewName(viewId);
                    const data = await RUMIAPIManager.get(`/api/v2/views/${viewId}/execute.json`);

                    // Handle different API response structures (like tempRUMI.js)
                    let ticketData = [];
                    if (data.rows && Array.isArray(data.rows)) {
                        ticketData = data.rows;
                    } else if (data.tickets && Array.isArray(data.tickets)) {
                        ticketData = data.tickets;
                    }

                    // Extract ticket IDs - handle multiple ID field locations
                    const ticketIds = ticketData.map(item => {
                        // Try different ways to extract ticket ID
                        if (item.id) {
                            return item.id;
                        } else if (item.ticket_id) {
                            return item.ticket_id;
                        } else if (item.ticket && item.ticket.id) {
                            return item.ticket.id;
                        }
                        return null;
                    }).filter(id => id !== null);

                    RUMILogger.info('MONITOR', `Found ${ticketIds.length} existing tickets in view "${viewName}" - processing now`, {
                        viewId,
                        viewName,
                        ticketCount: ticketIds.length,
                        responseType: data.rows ? 'rows' : (data.tickets ? 'tickets' : 'unknown')
                    });

                    // Process all existing tickets
                    if (ticketIds.length > 0) {
                        for (const ticketId of ticketIds) {
                            const result = await RUMIProcessor.processTicket(ticketId, viewName);
                            if (result.action !== 'none' && result.action !== 'skipped') {
                                // Stats are updated inside processor
                                RUMIUI.updateCounters();
                                RUMIUI.updateProcessedTicketsDisplay();
                            }
                            // Small delay between processing to avoid overwhelming the API
                            await new Promise(resolve => setTimeout(resolve, 300));
                        }

                        RUMILogger.info('MONITOR', `Finished processing ${ticketIds.length} existing tickets in view "${viewName}"`, {
                            viewId,
                            viewName,
                            ticketCount: ticketIds.length
                        });
                    }

                    // Now establish baseline with these tickets so they won't be processed again
                    this.baselineTickets.set(viewId, new Set(ticketIds));

                    RUMILogger.info('MONITOR', `Baseline established for view "${viewName}"`, {
                        viewId,
                        viewName,
                        ticketCount: ticketIds.length
                    });
                } catch (error) {
                    const viewName = await RUMIUI.getViewName(viewId);
                    RUMILogger.error('MONITOR', `Failed to process existing tickets for view "${viewName}"`, {
                        viewId,
                        viewName,
                        error: error.message
                    });
                    throw error;
                }
            }
        }

        static stop() {
            if (!this.isRunning) {
                return;
            }

            this.isRunning = false;
            if (this.intervalId) {
                clearInterval(this.intervalId);
                this.intervalId = null;
            }

            // Clear baseline so that restarting monitoring will process existing tickets again
            this.baselineTickets.clear();

            // Clear failed polls tracking
            this.failedPolls.clear();

            RUMILogger.info('MONITOR', 'Stopped monitoring and cleared baseline');
            RUMIUI.updateConnectionStatus('offline');
        }

        static async poll() {
            RUMILogger.debug('MONITOR', 'Starting poll cycle', {
                viewCount: this.selectedViews.length
            });

            for (const viewId of this.selectedViews) {
                try {
                    const viewName = await RUMIUI.getViewName(viewId);
                    const data = await RUMIAPIManager.get(`/api/v2/views/${viewId}/execute.json`);

                    // Handle different API response structures (like tempRUMI.js)
                    let ticketData = [];
                    if (data.rows && Array.isArray(data.rows)) {
                        ticketData = data.rows;
                    } else if (data.tickets && Array.isArray(data.tickets)) {
                        ticketData = data.tickets;
                    }

                    // Extract ticket IDs - handle multiple ID field locations
                    const ticketIds = ticketData.map(item => {
                        // Try different ways to extract ticket ID
                        if (item.id) {
                            return item.id;
                        } else if (item.ticket_id) {
                            return item.ticket_id;
                        } else if (item.ticket && item.ticket.id) {
                            return item.ticket.id;
                        }
                        return null;
                    }).filter(id => id !== null);

                    // Check if this view had failed polls previously
                    const hadFailedPoll = this.failedPolls.has(viewId);
                    const failureCount = this.failedPolls.get(viewId) || 0;

                    // Get baseline for this view
                    const baselineIds = this.baselineTickets.get(viewId) || new Set();

                    // CATCH-UP MODE: If we had failed polls, process ALL tickets in view (like startup)
                    // This ensures we don't miss any tickets that were added during rate limit period
                    if (hadFailedPoll) {
                        RUMILogger.warn('MONITOR', `CATCH-UP MODE: View "${viewName}" recovering from ${failureCount} failed poll(s) - processing ALL ${ticketIds.length} tickets`, {
                            viewId,
                            viewName,
                            failureCount,
                            ticketsToProcess: ticketIds.length,
                            totalInView: ticketIds.length
                        });

                        RUMIUI.showToast(`Recovering view "${viewName}" - processing ${ticketIds.length} tickets`, 'warning');

                        // Process ALL tickets in the view (like initial baseline establishment)
                        for (const ticketId of ticketIds) {
                            const result = await RUMIProcessor.processTicket(ticketId, viewName);
                            if (result.action !== 'none' && result.action !== 'skipped') {
                                RUMIUI.updateCounters();
                                RUMIUI.updateProcessedTicketsDisplay();
                            }
                            await new Promise(resolve => setTimeout(resolve, 300));
                        }

                        // Clear the failed poll flag for this view
                        this.failedPolls.delete(viewId);

                        RUMILogger.info('MONITOR', `CATCH-UP COMPLETE: View "${viewName}" recovered successfully`, {
                            viewId,
                            viewName,
                            processedCount: ticketIds.length
                        });

                        RUMIUI.showToast(`View "${viewName}" recovered - ${ticketIds.length} tickets processed`, 'success');
                    } else {
                        // NORMAL MODE: Find NEW tickets (not in baseline)
                        const newTicketIds = ticketIds.filter(id => !baselineIds.has(id));

                        if (newTicketIds.length > 0) {
                            RUMILogger.info('MONITOR', `Found ${newTicketIds.length} NEW tickets in view "${viewName}"`, {
                                viewId,
                                viewName,
                                newTickets: newTicketIds,
                                totalInView: ticketIds.length
                            });

                            // Process only NEW tickets
                            for (const ticketId of newTicketIds) {
                                const result = await RUMIProcessor.processTicket(ticketId, viewName);
                                if (result.action !== 'none' && result.action !== 'skipped') {
                                    // Stats are updated inside processor
                                    RUMIUI.updateCounters();
                                    RUMIUI.updateProcessedTicketsDisplay();
                                }
                                // Small delay between processing
                                await new Promise(resolve => setTimeout(resolve, 300));
                            }
                        } else {
                            RUMILogger.debug('MONITOR', `No new tickets in view "${viewName}"`, {
                                viewId,
                                viewName,
                                totalInView: ticketIds.length,
                                baselineSize: baselineIds.size
                            });
                        }
                    }

                    // Update baseline with current tickets (both catch-up and normal mode)
                    // Create a fresh Set copy to avoid reference issues
                    this.baselineTickets.set(viewId, new Set(ticketIds));
                    RUMILogger.debug('MONITOR', `Updated baseline for view "${viewName}"`, {
                        viewId,
                        viewName,
                        baselineSize: ticketIds.length,
                        mode: hadFailedPoll ? 'catch-up' : 'normal'
                    });

                } catch (error) {
                    const viewName = await RUMIUI.getViewName(viewId);

                    // Track this failed poll
                    const currentFailureCount = this.failedPolls.get(viewId) || 0;
                    this.failedPolls.set(viewId, currentFailureCount + 1);

                    RUMILogger.error('MONITOR', `Failed to poll view "${viewName}" (failure #${currentFailureCount + 1})`, {
                        viewId,
                        viewName,
                        error: error.message,
                        failureCount: currentFailureCount + 1,
                        willCatchUp: true
                    });

                    // Show toast for rate limit errors specifically
                    if (error.message.includes('Rate limit')) {
                        RUMIUI.showToast(`Rate limited on view "${viewName}" - will catch up on next poll`, 'error');
                    }
                }
            }

            RUMIUI.updateLastRunTime();
        }

        static async manualProcess(ticketIdsString, progressCallback = null) {
            console.log('[RUMI DEBUG] manualProcess called with:', ticketIdsString);
            // Parse comma-separated ticket IDs
            const ticketIds = ticketIdsString
                .split(',')
                .map(id => id.trim())
                .filter(id => id.length > 0 && /^\d+$/.test(id));

            if (ticketIds.length === 0) {
                RUMILogger.warn('MONITOR', 'No valid ticket IDs provided for manual processing');
                return { processed: 0, actioned: 0 };
            }

            // Reset cancellation flag at the start
            this.manualProcessingCancelled = false;

            RUMILogger.info('MONITOR', 'Starting manual processing', { ticketCount: ticketIds.length });

            // Enable batch processing mode to suppress verbose DEBUG logs
            RUMILogger.isManualProcessing = true;

            let processedCount = 0;
            let actionCount = 0;
            const totalCount = ticketIds.length;

            // Process all tickets in parallel - each fetches and processes immediately
            const allPromises = ticketIds.map(async (ticketId) => {
                // Check if cancellation was requested before processing this ticket
                if (this.manualProcessingCancelled) {
                    return { success: false, ticketId, cancelled: true };
                }

                try {
                    // Fetch ticket and comments in parallel
                    const [ticketResponse, commentsResponse] = await Promise.all([
                        RUMIAPIManager.get(`/api/v2/tickets/${ticketId}.json`),
                        RUMIAPIManager.get(`/api/v2/tickets/${ticketId}/comments.json`)
                    ]);

                    // Check cancellation again before processing
                    if (this.manualProcessingCancelled) {
                        return { success: false, ticketId, cancelled: true };
                    }

                    // Process immediately after fetching (with isManual=true)
                    const result = await RUMIProcessor.processTicketWithData(
                        ticketId,
                        ticketResponse.ticket,
                        commentsResponse.comments || [],
                        'Manual',
                        true  // isManual flag to use separate manual storage
                    );

                    // Update progress immediately
                    processedCount++;
                    if (progressCallback) {
                        progressCallback(processedCount, totalCount);
                    }

                    if (result.action !== 'none' && result.action !== 'skipped') {
                        actionCount++;
                    }

                    return { success: true, ticketId };
                } catch (error) {
                    processedCount++;
                    if (progressCallback) {
                        progressCallback(processedCount, totalCount);
                    }

                    RUMILogger.error('MONITOR', `Manual processing failed for ticket ${ticketId}`, {
                        ticketId,
                        error: error.message
                    });
                    return { success: false, ticketId, error: error.message };
                }
            });

            // Wait for ALL tickets to complete
            await Promise.all(allPromises);

            // Re-enable normal logging after batch completes
            RUMILogger.isManualProcessing = false;

            const status = this.manualProcessingCancelled ? 'cancelled' : 'complete';
            RUMILogger.info('MONITOR', `Manual processing ${status}`, {
                processedCount,
                actionCount
            });

            return { processed: processedCount, actioned: actionCount, cancelled: this.manualProcessingCancelled };
        }

        static async processView(viewId, viewName, progressCallback = null) {
            // Fetches all tickets from a view and processes them (with pagination support)
            RUMILogger.info('MONITOR', `Starting view processing for "${viewName}"`, { viewId, viewName });

            try {
                // Phase 1: Fetch ALL tickets from the view (handle pagination)
                if (progressCallback) {
                    progressCallback({ phase: 'fetching', current: 0, total: 0, viewName });
                }

                let allTicketIds = [];
                let nextPageUrl = `/api/v2/views/${viewId}/execute.json?page[size]=100`;
                let pageCount = 0;

                // Fetch all pages
                while (nextPageUrl) {
                    pageCount++;
                    RUMILogger.debug('MONITOR', `Fetching page ${pageCount} for view "${viewName}"`, {
                        viewId,
                        viewName,
                        currentTicketCount: allTicketIds.length
                    });

                    const data = await RUMIAPIManager.get(nextPageUrl);

                    // Handle different API response structures
                    let ticketData = [];
                    if (data.rows && Array.isArray(data.rows)) {
                        ticketData = data.rows;
                    } else if (data.tickets && Array.isArray(data.tickets)) {
                        ticketData = data.tickets;
                    }

                    // Extract ticket IDs from this page
                    const pageTicketIds = ticketData.map(item => {
                        if (item.id) {
                            return item.id;
                        } else if (item.ticket_id) {
                            return item.ticket_id;
                        } else if (item.ticket && item.ticket.id) {
                            return item.ticket.id;
                        }
                        return null;
                    }).filter(id => id !== null);

                    allTicketIds.push(...pageTicketIds);

                    // Update progress with fetching count
                    if (progressCallback) {
                        progressCallback({
                            phase: 'fetching',
                            current: allTicketIds.length,
                            total: allTicketIds.length,
                            viewName,
                            page: pageCount
                        });
                    }

                    // Check for next page
                    // Zendesk uses different pagination formats:
                    // 1. meta.has_more + links.next (cursor-based)
                    // 2. next_page (older format)
                    if (data.meta && data.meta.has_more && data.links && data.links.next) {
                        // Cursor-based pagination (newer API)
                        nextPageUrl = data.links.next;
                        // Remove the base URL if present, keep only the path
                        if (nextPageUrl.includes('zendesk.com')) {
                            nextPageUrl = nextPageUrl.substring(nextPageUrl.indexOf('/api/'));
                        }
                    } else if (data.next_page) {
                        // Older pagination format
                        nextPageUrl = data.next_page;
                        // Remove the base URL if present
                        if (nextPageUrl.includes('zendesk.com')) {
                            nextPageUrl = nextPageUrl.substring(nextPageUrl.indexOf('/api/'));
                        }
                    } else {
                        // No more pages
                        nextPageUrl = null;
                    }

                    // Safety limit: don't fetch more than 1000 pages
                    if (pageCount >= 1000) {
                        RUMILogger.warn('MONITOR', `Reached page limit (1000) for view "${viewName}"`, {
                            viewId,
                            viewName,
                            ticketCount: allTicketIds.length
                        });
                        break;
                    }
                }

                if (allTicketIds.length === 0) {
                    RUMILogger.warn('MONITOR', `No tickets found in view "${viewName}"`, { viewId, viewName });
                    return { fetched: 0, processed: 0, actioned: 0 };
                }

                RUMILogger.info('MONITOR', `Fetched ${allTicketIds.length} tickets from view "${viewName}" (${pageCount} pages)`, {
                    viewId,
                    viewName,
                    ticketCount: allTicketIds.length,
                    pageCount: pageCount
                });

                const ticketIds = allTicketIds;

                // Phase 2: Process the tickets
                if (progressCallback) {
                    progressCallback({ phase: 'processing', current: 0, total: ticketIds.length, viewName });
                }

                // Enable batch processing mode to suppress verbose DEBUG logs
                RUMILogger.isManualProcessing = true;

                let processedCount = 0;
                let actionCount = 0;
                const totalCount = ticketIds.length;

                // Process all tickets in parallel
                const allPromises = ticketIds.map(async (ticketId) => {
                    try {
                        // Fetch ticket and comments in parallel
                        const [ticketResponse, commentsResponse] = await Promise.all([
                            RUMIAPIManager.get(`/api/v2/tickets/${ticketId}.json`),
                            RUMIAPIManager.get(`/api/v2/tickets/${ticketId}/comments.json`)
                        ]);

                        // Process immediately after fetching (with isManual=true)
                        const result = await RUMIProcessor.processTicketWithData(
                            ticketId,
                            ticketResponse.ticket,
                            commentsResponse.comments || [],
                            viewName,
                            true  // isManual flag to use separate manual storage
                        );

                        // Update progress immediately
                        processedCount++;
                        if (progressCallback) {
                            progressCallback({ phase: 'processing', current: processedCount, total: totalCount, viewName });
                        }

                        if (result.action !== 'none' && result.action !== 'skipped') {
                            actionCount++;
                        }

                        return { success: true, ticketId };
                    } catch (error) {
                        processedCount++;
                        if (progressCallback) {
                            progressCallback({ phase: 'processing', current: processedCount, total: totalCount, viewName });
                        }
                        RUMILogger.error('MONITOR', `Failed to process ticket ${ticketId} from view "${viewName}"`, {
                            ticketId,
                            viewName,
                            error: error.message
                        });
                        return { success: false, ticketId, error: error.message };
                    }
                });

                await Promise.all(allPromises);

                // Restore normal logging mode
                RUMILogger.isManualProcessing = false;

                RUMILogger.info('MONITOR', `View processing completed for "${viewName}"`, {
                    viewName,
                    fetched: ticketIds.length,
                    processed: processedCount,
                    actioned: actionCount
                });

                return { fetched: ticketIds.length, processed: processedCount, actioned: actionCount };
            } catch (error) {
                // Restore normal logging mode
                RUMILogger.isManualProcessing = false;

                RUMILogger.error('MONITOR', `Failed to process view "${viewName}"`, {
                    viewId,
                    viewName,
                    error: error.message
                });
                throw error;
            }
        }
    }

    // ============================================================================
    // UI STYLES
    // ============================================================================

    const CSS_STYLES = `
        :root {
            --rumi-bg: #F5F6F7;
            --rumi-panel-bg: #FFFFFF;
            --rumi-text: #111827;
            --rumi-text-secondary: #6B7280;
            --rumi-border: #E6E9EB;
            --rumi-accent-blue: #2563EB;
            --rumi-accent-green: #10B981;
            --rumi-accent-red: #EF4444;
            --rumi-accent-yellow: #F59E0B;
        }

        [data-theme="dark"] {
            --rumi-bg: #1F2937;
            --rumi-panel-bg: #111827;
            --rumi-text: #F9FAFB;
            --rumi-text-secondary: #D1D5DB;
            --rumi-border: #374151;
            --rumi-accent-blue: #3B82F6;
            --rumi-accent-green: #10B981;
            --rumi-accent-red: #EF4444;
            --rumi-accent-yellow: #F59E0B;
        }

        #rumi-root {
            position: fixed;
            inset: 0;
            z-index: 999999;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 14px;
            color: var(--rumi-text);
            background: var(--rumi-bg);
            display: flex;
            flex-direction: column;
        }

        #rumi-topbar {
            height: 60px;
            background: var(--rumi-panel-bg);
            border-bottom: 1px solid var(--rumi-border);
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0 20px;
        }

        #rumi-main {
            display: flex;
            flex: 1;
            overflow: hidden;
        }

        .rumi-main-tab-panel {
            display: none;
            flex: 1;
            overflow: hidden;
            width: 100%;
            height: 100%;
        }

        .rumi-main-tab-panel[style*="display: flex"] {
            display: flex !important;
            visibility: visible !important;
        }

        #rumi-left-panel {
            width: 350px;
            min-width: 350px;
            flex-shrink: 0;
            background: var(--rumi-panel-bg);
            border-right: 1px solid var(--rumi-border);
            padding: 20px;
            overflow-y: auto;
            overflow-x: hidden;
        }

        #rumi-work-area {
            flex: 1;
            padding: 20px;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            min-width: 0;
        }

        #rumi-work-area-manual {
            flex: 1;
            padding: 20px;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            min-width: 0;
        }

        #rumi-left-panel-manual {
            width: 350px;
            min-width: 350px;
            flex-shrink: 0;
            background: var(--rumi-panel-bg);
            border-right: 1px solid var(--rumi-border);
            padding: 20px;
            overflow-y: auto;
            overflow-x: hidden;
        }

        .rumi-btn {
            padding: 8px 16px;
            border-radius: 6px;
            border: none;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
            transition: all 0.2s;
        }

        .rumi-btn:focus {
            outline: 2px solid var(--rumi-accent-blue);
            outline-offset: 2px;
        }

        .rumi-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .rumi-btn-primary {
            background: var(--rumi-accent-blue);
            color: white;
        }

        .rumi-btn-primary:hover:not(:disabled) {
            opacity: 0.9;
        }

        .rumi-btn-secondary {
            background: var(--rumi-border);
            color: var(--rumi-text);
        }

        .rumi-btn-secondary:hover:not(:disabled) {
            background: #D1D5DB;
        }

        .rumi-status-indicator {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .rumi-status-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: var(--rumi-accent-red);
        }

        .rumi-status-dot.rumi-monitoring {
            background: var(--rumi-accent-green);
            animation: rumi-pulse 2s infinite;
        }

        @keyframes rumi-pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }

        .rumi-view-checkbox {
            display: flex;
            align-items: center;
            gap: 8px;
            margin: 8px 0;
            padding: 4px;
            border-radius: 4px;
            transition: background 0.2s;
        }

        .rumi-view-checkbox:hover {
            background: var(--rumi-bg);
        }

        .rumi-view-checkbox input[type="checkbox"] {
            cursor: pointer;
        }

        .rumi-view-checkbox input[type="checkbox"]:focus {
            outline: 2px solid var(--rumi-accent-blue);
            outline-offset: 2px;
        }

        .rumi-log-entry {
            padding: 8px 12px;
            margin: 4px 0;
            border-radius: 4px;
            background: var(--rumi-panel-bg);
            font-family: 'Courier New', monospace;
            font-size: 12px;
            border-left: 3px solid transparent;
        }

        .rumi-log-entry.rumi-error {
            border-left-color: var(--rumi-accent-red);
        }

        [data-theme="light"] .rumi-log-entry.rumi-error {
            background: #FEF2F2;
        }

        [data-theme="dark"] .rumi-log-entry.rumi-error {
            background: rgba(239, 68, 68, 0.1);
        }

        .rumi-log-entry.rumi-warn {
            border-left-color: var(--rumi-accent-yellow);
        }

        [data-theme="light"] .rumi-log-entry.rumi-warn {
            background: #FFFBEB;
        }

        [data-theme="dark"] .rumi-log-entry.rumi-warn {
            background: rgba(245, 158, 11, 0.1);
        }

        .rumi-log-entry.rumi-info {
            border-left-color: var(--rumi-accent-blue);
        }

        [data-theme="light"] .rumi-log-entry.rumi-info {
            background: #EFF6FF;
        }

        [data-theme="dark"] .rumi-log-entry.rumi-info {
            background: rgba(59, 130, 246, 0.1);
        }

        .rumi-log-entry.rumi-debug {
            border-left-color: var(--rumi-text-secondary);
            background: var(--rumi-bg);
        }

        .rumi-section-title {
            font-size: 16px;
            font-weight: 600;
            margin: 16px 0 8px 0;
        }

        .rumi-section-title:first-child {
            margin-top: 0;
        }

        .rumi-divider {
            margin: 24px 0;
            border: none;
            border-top: 1px solid var(--rumi-border);
        }

        .rumi-input-number {
            width: 60px;
            margin-left: 8px;
            padding: 4px 8px;
            border: 1px solid var(--rumi-border);
            border-radius: 4px;
            font-size: 14px;
            background: var(--rumi-panel-bg);
            color: var(--rumi-text);
        }

        .rumi-input-number:focus {
            outline: 2px solid var(--rumi-accent-blue);
            outline-offset: 0;
            border-color: var(--rumi-accent-blue);
        }

        .rumi-select {
            margin-left: 8px;
            padding: 4px 8px;
            border: 1px solid var(--rumi-border);
            border-radius: 4px;
            font-size: 14px;
            cursor: pointer;
            background: var(--rumi-panel-bg);
            color: var(--rumi-text);
        }

        .rumi-select:focus {
            outline: 2px solid var(--rumi-accent-blue);
            outline-offset: 0;
            border-color: var(--rumi-accent-blue);
        }

        .rumi-textarea {
            width: 100%;
            min-height: 100px;
            padding: 12px;
            border: 1px solid var(--rumi-border);
            border-radius: 4px;
            font-family: monospace;
            font-size: 13px;
            resize: vertical;
            background: var(--rumi-panel-bg);
            color: var(--rumi-text);
        }

        .rumi-textarea:focus {
            outline: 2px solid var(--rumi-accent-blue);
            outline-offset: 0;
            border-color: var(--rumi-accent-blue);
        }

        .rumi-textarea::placeholder {
            color: var(--rumi-text-secondary);
            opacity: 0.7;
        }

        input[type="text"],
        input[type="number"],
        input[type="time"] {
            background: var(--rumi-panel-bg);
            color: var(--rumi-text);
            border: 1px solid var(--rumi-border);
        }

        input[type="text"]:focus,
        input[type="number"]:focus,
        input[type="time"]:focus {
            background: var(--rumi-panel-bg);
            color: var(--rumi-text);
        }

        input[type="checkbox"],
        input[type="radio"] {
            accent-color: var(--rumi-accent-blue);
        }

        select option {
            background: var(--rumi-panel-bg);
            color: var(--rumi-text);
        }

        .rumi-status-text {
            font-size: 13px;
            color: var(--rumi-text-secondary);
            margin-top: 16px;
        }

        .rumi-button-group {
            display: flex;
            gap: 8px;
            margin-top: 16px;
        }

        .rumi-log-meta {
            margin-top: 4px;
            font-size: 11px;
            color: var(--rumi-text-secondary);
        }

        .rumi-loading {
            text-align: center;
            padding: 20px;
            color: var(--rumi-text-secondary);
        }

        .rumi-error-message {
            padding: 12px;
            border: 1px solid var(--rumi-accent-red);
            border-radius: 4px;
            color: var(--rumi-accent-red);
            margin: 12px 0;
        }

        [data-theme="light"] .rumi-error-message {
            background: #FEF2F2;
        }

        [data-theme="dark"] .rumi-error-message {
            background: rgba(239, 68, 68, 0.15);
        }

        .rumi-warning-banner {
            text-align: center;
            padding: 12px;
            border: 1px solid #FFC107;
            border-radius: 6px;
            margin: 8px;
        }

        [data-theme="light"] .rumi-warning-banner {
            background: #FFF3CD;
            color: #856404;
        }

        [data-theme="dark"] .rumi-warning-banner {
            background: rgba(245, 158, 11, 0.15);
            color: var(--rumi-accent-yellow);
        }

        .rumi-checkbox-label {
            display: flex;
            align-items: center;
            gap: 8px;
            margin: 12px 0;
            padding: 8px;
            border-radius: 4px;
            transition: background 0.2s;
            cursor: pointer;
        }

        .rumi-checkbox-label:hover {
            background: var(--rumi-bg);
        }

        .rumi-checkbox-label input[type="checkbox"] {
            cursor: pointer;
        }

        .rumi-checkbox-label input[type="checkbox"]:focus {
            outline: 2px solid var(--rumi-accent-blue);
            outline-offset: 2px;
        }

        .rumi-stats-box {
            margin-top: 16px;
            padding: 12px;
            background: var(--rumi-bg);
            border-radius: 6px;
            border: 1px solid var(--rumi-border);
        }

        .rumi-stats-title {
            font-weight: 600;
            margin-bottom: 8px;
            font-size: 13px;
        }

        .rumi-stats-row {
            display: flex;
            justify-content: space-between;
            padding: 4px 0;
            font-size: 12px;
        }

        .rumi-stats-row span:last-child {
            font-weight: 600;
            color: var(--rumi-accent-blue);
        }

        .rumi-counters-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 8px;
            margin-top: 12px;
        }

        .rumi-counter-card {
            background: var(--rumi-panel-bg);
            border: 2px solid var(--rumi-border);
            border-radius: 8px;
            padding: 12px;
            text-align: center;
            transition: all 0.2s;
        }

        .rumi-counter-card:hover {
            border-color: var(--rumi-accent-blue);
            transform: translateY(-2px);
        }

        .rumi-counter-value {
            font-size: 24px;
            font-weight: 700;
            color: var(--rumi-text);
            margin-bottom: 4px;
        }

        .rumi-counter-label {
            font-size: 11px;
            color: var(--rumi-text-secondary);
            font-weight: 500;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .rumi-counter-pending { border-color: #1f73b7; }
        .rumi-counter-solved { border-color: #5c6970; }
        .rumi-counter-care { border-color: #EF4444; }
        .rumi-counter-hala { border-color: #8B5CF6; }
        .rumi-counter-casablanca { border-color: #06B6D4; }

        [data-theme="light"] .rumi-counter-pending:hover { border-color: #1f73b7; background: #E3F2FD; }
        [data-theme="light"] .rumi-counter-solved:hover { border-color: #5c6970; background: #F5F5F5; }
        [data-theme="light"] .rumi-counter-care:hover { border-color: #EF4444; background: #FEF2F2; }
        [data-theme="light"] .rumi-counter-hala:hover { border-color: #8B5CF6; background: #F5F3FF; }
        [data-theme="light"] .rumi-counter-casablanca:hover { border-color: #06B6D4; background: #ECFEFF; }

        [data-theme="dark"] .rumi-counter-pending:hover { border-color: #1f73b7; background: rgba(31, 115, 183, 0.1); }
        [data-theme="dark"] .rumi-counter-solved:hover { border-color: #5c6970; background: rgba(92, 105, 112, 0.1); }
        [data-theme="dark"] .rumi-counter-care:hover { border-color: #EF4444; background: rgba(239, 68, 68, 0.1); }
        [data-theme="dark"] .rumi-counter-hala:hover { border-color: #8B5CF6; background: rgba(139, 92, 246, 0.1); }
        [data-theme="dark"] .rumi-counter-casablanca:hover { border-color: #06B6D4; background: rgba(6, 182, 212, 0.1); }

        .rumi-tabs-nav {
            display: flex;
            gap: 4px;
            border-bottom: 2px solid var(--rumi-border);
            margin-bottom: 16px;
            overflow-x: auto;
        }

        .rumi-tab-btn {
            padding: 10px 16px;
            border: none;
            background: transparent;
            color: var(--rumi-text-secondary);
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            border-bottom: 3px solid transparent;
            transition: all 0.2s;
            white-space: nowrap;
        }

        .rumi-tab-btn:hover {
            color: var(--rumi-text);
            background: var(--rumi-bg);
        }

        .rumi-tab-btn.active {
            color: var(--rumi-accent-blue);
            border-bottom-color: var(--rumi-accent-blue);
            font-weight: 600;
        }

        .rumi-tab-content {
            flex: 1;
            overflow: auto;
            min-height: 0;
        }

        .rumi-tab-panel {
            display: none;
        }

        .rumi-tab-panel.active {
            display: block;
        }

        .rumi-table-container {
            overflow: visible;
            max-height: none;
        }

        .rumi-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 12px;
        }

        .rumi-table thead {
            position: sticky;
            top: 0;
            z-index: 100;
            background: var(--rumi-panel-bg);
        }

        .rumi-table thead::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: var(--rumi-panel-bg);
            z-index: -1;
        }

        .rumi-table thead tr {
            background: var(--rumi-panel-bg);
        }

        .rumi-table th {
            text-align: left;
            padding: 10px 12px;
            border-bottom: 2px solid var(--rumi-border);
            border-right: 1px solid var(--rumi-border);
            font-weight: 600;
            font-size: 11px;
            text-transform: uppercase;
            color: var(--rumi-text-secondary);
            letter-spacing: 0.5px;
            cursor: pointer;
            user-select: none;
            position: relative;
            background: var(--rumi-panel-bg);
        }

        .rumi-table th:last-child {
            border-right: none;
        }

        .rumi-table th:hover {
            background: var(--rumi-bg);
        }

        .rumi-table th.sortable::after {
            content: '⇅';
            margin-left: 6px;
            opacity: 0.3;
        }

        .rumi-table th.sortable.sorted-asc::after {
            content: '↑';
            opacity: 1;
            color: var(--rumi-accent-blue);
        }

        .rumi-table th.sortable.sorted-desc::after {
            content: '↓';
            opacity: 1;
            color: var(--rumi-accent-blue);
        }

        .rumi-table-filter-row {
            background: var(--rumi-bg);
            position: relative;
            z-index: 50;
        }

        .rumi-table-filter-row td {
            background: var(--rumi-bg);
            padding: 8px 12px;
            position: relative;
            z-index: 50;
            border-right: 1px solid var(--rumi-border);
        }

        .rumi-table-filter-row td:last-child {
            border-right: none;
        }

        .rumi-table-filter-input {
            width: 100% !important;
            padding: 7px 10px !important;
            border: 1px solid var(--rumi-border) !important;
            border-radius: 6px !important;
            font-size: 11px !important;
            box-sizing: border-box !important;
            background: var(--rumi-panel-bg) !important;
            color: var(--rumi-text) !important;
            height: auto !important;
            box-shadow: none !important;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
            line-height: 1.5 !important;
            transition: all 0.15s ease !important;
        }

        .rumi-table-filter-input:hover {
            border-color: #9CA3AF !important;
        }

        [data-theme="light"] .rumi-table-filter-input:hover {
            background-color: #FAFAFA !important;
        }

        [data-theme="dark"] .rumi-table-filter-input:hover {
            background-color: rgba(255, 255, 255, 0.05) !important;
        }

        .rumi-table-filter-input:focus {
            outline: none !important;
            border-color: var(--rumi-accent-blue) !important;
            box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.2) !important;
            background-color: var(--rumi-panel-bg) !important;
        }

        .rumi-table-filter-input::placeholder {
            color: var(--rumi-text-secondary);
            opacity: 0.6;
        }

        /* Individual filter input styles - can be customized per column */
        .rumi-table-filter-input-ticketId {
            /* Ticket ID filter - customize width here if needed */
            /* Example: width: 80px !important; */
        }

        .rumi-table-filter-input-subject {
            /* Subject filter - customize width here if needed */
            /* Example: width: 300px !important; */
        }

        /* Custom Dropdown Container */
        .rumi-custom-select {
            position: relative;
            width: 100%;
        }

        .rumi-custom-select-trigger {
            width: 100%;
            min-width: fit-content;
            padding: 7px 28px 7px 10px;
            border: 1px solid var(--rumi-border);
            border-radius: 6px;
            font-size: 11px;
            box-sizing: border-box;
            background: var(--rumi-panel-bg);
            color: var(--rumi-text);
            cursor: pointer;
            transition: all 0.15s ease;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            line-height: 1.5;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            display: block;
            user-select: none;
        }

        .rumi-custom-select-trigger:hover {
            border-color: #9CA3AF;
            background-color: #FAFAFA;
        }

        .rumi-custom-select-trigger.active {
            border-color: var(--rumi-accent-blue);
            box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.2);
        }

        .rumi-custom-select-arrow {
            position: absolute;
            right: 8px;
            top: 50%;
            transform: translateY(-50%);
            width: 14px;
            height: 14px;
            pointer-events: none;
            transition: transform 0.2s ease;
        }

        .rumi-custom-select-trigger.active .rumi-custom-select-arrow {
            transform: translateY(-50%) rotate(180deg);
        }

        .rumi-custom-select-dropdown {
            position: fixed;
            background: var(--rumi-panel-bg);
            border: 1px solid var(--rumi-border);
            border-radius: 8px;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
            max-height: 240px;
            overflow-y: auto;
            overflow-x: hidden;
            z-index: 10000;
            opacity: 0;
            visibility: hidden;
            transform: translateY(-8px);
            transition: opacity 0.15s ease, visibility 0.15s ease, transform 0.15s ease;
            padding: 6px;
            width: max-content;
            max-width: 400px;
        }

        .rumi-custom-select-dropdown.active {
            opacity: 1;
            visibility: visible;
            transform: translateY(0);
        }

        .rumi-custom-select-dropdown::-webkit-scrollbar {
            width: 6px;
        }

        .rumi-custom-select-dropdown::-webkit-scrollbar-track {
            background: transparent;
        }

        .rumi-custom-select-dropdown::-webkit-scrollbar-thumb {
            background: #D1D5DB;
            border-radius: 3px;
        }

        .rumi-custom-select-dropdown::-webkit-scrollbar-thumb:hover {
            background: #9CA3AF;
        }

        .rumi-custom-select-option {
            padding: 8px 12px;
            font-size: 12px;
            color: var(--rumi-text);
            cursor: pointer;
            border-radius: 4px;
            transition: all 0.1s ease;
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin: 2px 0;
            white-space: nowrap;
            min-width: fit-content;
        }

        .rumi-custom-select-option:hover {
            background: #F3F4F6;
            color: var(--rumi-text);
        }

        .rumi-custom-select-option.selected {
            background: #EFF6FF;
            color: var(--rumi-accent-blue);
            font-weight: 500;
        }

        .rumi-custom-select-option.selected::after {
            content: '✓';
            font-weight: 600;
            margin-left: 8px;
        }

        /* Fallback for native select (hidden) */
        .rumi-table-filter-select {
            display: none;
        }

        .rumi-time-filter-container {
            display: flex;
            gap: 4px;
            align-items: center;
            width: 100%;
        }

        .rumi-time-filter-time {
            padding: 4px 6px;
            border: 1px solid var(--rumi-border);
            border-radius: 4px;
            font-size: 11px;
            flex: 1;
            background: var(--rumi-panel-bg);
            color: var(--rumi-text);
            transition: all 0.2s;
        }

        .rumi-time-filter-time:hover {
            border-color: var(--rumi-text-secondary);
            background-color: var(--rumi-bg);
        }

        .rumi-time-filter-time:focus {
            outline: none;
            border-color: var(--rumi-accent-blue);
            background-color: var(--rumi-panel-bg);
            box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.2);
        }

        .rumi-table tbody {
            position: relative;
            z-index: 1;
        }

        .rumi-table td {
            padding: 10px 12px;
            border-bottom: 1px solid var(--rumi-border);
            border-right: 1px solid var(--rumi-border);
            word-wrap: break-word;
            overflow-wrap: break-word;
            color: var(--rumi-text);
        }

        .rumi-table td:last-child {
            border-right: none;
        }

        .rumi-table td a {
            color: var(--rumi-accent-blue);
            text-decoration: none;
        }

        .rumi-table td a:hover {
            text-decoration: underline;
        }

        .rumi-table tbody tr {
            position: relative;
            z-index: 1;
            background: var(--rumi-panel-bg);
        }

        .rumi-table tbody tr:hover {
            background: var(--rumi-bg);
        }

        .rumi-table th,
        .rumi-table td {
            white-space: nowrap;
        }

        /* Column width controls for processed tickets tables */
        /* Column 1: Row Number */
        .rumi-table th:nth-child(1),
        .rumi-table td:nth-child(1) {
            width: 50px;
            min-width: 50px;
            max-width: 50px;
            text-align: center;
        }

        /* Column 2: Ticket ID */
        .rumi-table th:nth-child(2),
        .rumi-table td:nth-child(2) {
            width: 100px;
            min-width: 100px;
            max-width: 100px;
        }

        /* Column 3: Subject */
        .rumi-table th:nth-child(3),
        .rumi-table td:nth-child(3) {
            width: 350px;
            min-width: 350px;
            max-width: 350px;
            white-space: normal;
            word-wrap: break-word;
        }

        /* Column 4: View */
        .rumi-table th:nth-child(4),
        .rumi-table td:nth-child(4) {
            width: 150px;
            min-width: 150px;
            max-width: 150px;
        }

        /* Column 5: Action */
        .rumi-table th:nth-child(5),
        .rumi-table td:nth-child(5) {
            width: 120px;
            min-width: 120px;
            max-width: 120px;
            white-space: normal;
            word-wrap: break-word;
        }

        /* Column 6: Trigger */
        .rumi-table th:nth-child(6),
        .rumi-table td:nth-child(6) {
            width: 200px;
            min-width: 200px;
            max-width: 200px;
            white-space: normal;
            word-wrap: break-word;
        }

        /* Column 7: Previous Status */
        .rumi-table th:nth-child(7),
        .rumi-table td:nth-child(7) {
            width: 100px;
            min-width: 100px;
            max-width: 100px;
        }

        /* Column 8: New Status */
        .rumi-table th:nth-child(8),
        .rumi-table td:nth-child(8) {
            width: 100px;
            min-width: 100px;
            max-width: 100px;
        }

        /* Column 9: Previous Group */
        .rumi-table th:nth-child(9),
        .rumi-table td:nth-child(9) {
            width: 150px;
            min-width: 150px;
            max-width: 150px;
            white-space: normal;
            word-wrap: break-word;
            overflow-wrap: break-word;
            overflow: hidden;
        }

        /* Column 10: New Group */
        .rumi-table th:nth-child(10),
        .rumi-table td:nth-child(10) {
            width: 150px;
            min-width: 150px;
            max-width: 150px;
            white-space: normal;
            word-wrap: break-word;
            overflow-wrap: break-word;
            overflow: hidden;
        }

        /* Column 11: Processed At */
        .rumi-table th:nth-child(11),
        .rumi-table td:nth-child(11) {
            width: 160px;
            min-width: 160px;
            max-width: 160px;
            white-space: normal;
            word-wrap: break-word;
            overflow-wrap: break-word;
            overflow: hidden;
        }

        /* Column 12: Dry Run */
        .rumi-table th:nth-child(12),
        .rumi-table td:nth-child(12) {
            width: 80px;
            min-width: 80px;
            max-width: 80px;
        }

        /* Column 13: Updated? */
        .rumi-table th:nth-child(13),
        .rumi-table td:nth-child(13) {
            width: 90px;
            min-width: 90px;
            max-width: 90px;
        }

        [data-theme="light"] .rumi-table tbody tr.rumi-dry-run {
            background: #FEF2F2 !important;
        }

        [data-theme="dark"] .rumi-table tbody tr.rumi-dry-run {
            background: rgba(239, 68, 68, 0.15) !important;
        }

        [data-theme="light"] .rumi-table tbody tr.rumi-dry-run:hover {
            background: #FEE2E2 !important;
        }

        [data-theme="dark"] .rumi-table tbody tr.rumi-dry-run:hover {
            background: rgba(239, 68, 68, 0.25) !important;
        }

        /* Blocked Pin Styles */
        [data-theme="light"] .rumi-table tbody tr.rumi-blocked-pin {
            background: #FFEBEE !important;
            border-left: 4px solid #DC2626 !important;
        }

        [data-theme="dark"] .rumi-table tbody tr.rumi-blocked-pin {
            background: rgba(220, 38, 38, 0.2) !important;
            border-left: 4px solid #EF4444 !important;
        }

        [data-theme="light"] .rumi-table tbody tr.rumi-blocked-pin:hover {
            background: #FFCDD2 !important;
        }

        [data-theme="dark"] .rumi-table tbody tr.rumi-blocked-pin:hover {
            background: rgba(220, 38, 38, 0.3) !important;
        }

        .rumi-badge {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 10px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .rumi-badge-yes {
            background: #D1FAE5;
            color: #059669;
        }

        .rumi-badge-no {
            background: #FEE2E2;
            color: #DC2626;
        }

        .rumi-badge-warning {
            background: #FEF3C7;
            color: #D97706;
            cursor: help;
        }

        [data-theme="light"] .rumi-badge-pending {
            background: #1f73b7;
            color: #FFFFFF;
        }

        [data-theme="dark"] .rumi-badge-pending {
            background: #2693d6;
            color: #151a1e;
        }

        [data-theme="light"] .rumi-badge-solved {
            background: #5c6970;
            color: #FFFFFF;
        }

        [data-theme="dark"] .rumi-badge-solved {
            background: #9CA3AF;
            color: #151a1e;
        }

        [data-theme="light"] .rumi-badge-care {
            background: #DC2626;
            color: #FFFFFF;
        }

        [data-theme="dark"] .rumi-badge-care {
            background: #EF4444;
            color: #151a1e;
        }

        [data-theme="light"] .rumi-badge-hala {
            background: #7C3AED;
            color: #FFFFFF;
        }

        [data-theme="dark"] .rumi-badge-hala {
            background: #A78BFA;
            color: #151a1e;
        }

        [data-theme="light"] .rumi-badge-casablanca {
            background: #0891B2;
            color: #FFFFFF;
        }

        [data-theme="dark"] .rumi-badge-casablanca {
            background: #22D3EE;
            color: #151a1e;
        }

        [data-theme="light"] .rumi-badge-none {
            background: #9CA3AF;
            color: #1F2937;
        }

        [data-theme="dark"] .rumi-badge-none {
            background: #6B7280;
            color: #F3F4F6;
        }

        .rumi-status-badge {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 10px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        [data-theme="light"] .rumi-status-badge-new {
            background: #fca347;
            color: #4c2c17;
        }

        [data-theme="dark"] .rumi-status-badge-new {
            background: #e38215;
            color: #151a1e;
        }

        [data-theme="light"] .rumi-status-badge-open {
            background: #cd3642;
            color: #FFFFFF;
        }

        [data-theme="dark"] .rumi-status-badge-open {
            background: #eb5c69;
            color: #151a1e;
        }

        [data-theme="light"] .rumi-status-badge-pending {
            background: #1f73b7;
            color: #ffffff;
        }

        [data-theme="dark"] .rumi-status-badge-pending {
            background: #2693d6;
            color: #151a1e;
        }

        [data-theme="light"] .rumi-status-badge-solved {
            background: #5c6970;
            color: #ffffff;
        }

        [data-theme="dark"] .rumi-status-badge-solved {
            background: #b0b8be;
            color: #151a1e;
        }

        .rumi-logs-container {
            max-height: calc(100vh - 220px);
            overflow-y: auto;
        }

        .rumi-empty-state {
            text-align: center;
            padding: 60px 20px;
            color: var(--rumi-text-secondary);
        }

        .rumi-empty-state-icon {
            font-size: 48px;
            margin-bottom: 16px;
            opacity: 0.3;
        }

        .rumi-empty-state-text {
            font-size: 14px;
            font-weight: 500;
        }

        /* Pinned Tickets Styles */
        .rumi-pin-input-group {
            display: flex;
            flex-direction: column;
            gap: 8px;
            margin-top: 12px;
        }

        .rumi-pin-input {
            width: 100%;
            padding: 8px;
            border: 1px solid var(--rumi-border);
            border-radius: 4px;
            font-size: 13px;
            box-sizing: border-box;
            background: var(--rumi-panel-bg);
            color: var(--rumi-text);
        }

        .rumi-pin-input:focus {
            outline: 2px solid var(--rumi-accent-blue);
            outline-offset: 0;
            border-color: var(--rumi-accent-blue);
        }

        .rumi-pin-input::placeholder {
            color: var(--rumi-text-secondary);
            opacity: 0.6;
        }

        .rumi-pin-radio-group {
            display: flex;
            gap: 16px;
            padding: 8px 0;
        }

        .rumi-pin-radio-label {
            display: flex;
            align-items: center;
            gap: 6px;
            cursor: pointer;
            font-size: 13px;
        }

        .rumi-pin-radio-label input[type="radio"] {
            cursor: pointer;
        }

        .rumi-pin-radio-label input[type="radio"]:focus {
            outline: 2px solid var(--rumi-accent-blue);
            outline-offset: 2px;
        }

        .rumi-pinned-list {
            margin-top: 12px;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .rumi-pinned-item {
            padding: 10px;
            background: var(--rumi-bg);
            border: 1px solid var(--rumi-border);
            border-radius: 6px;
            font-size: 12px;
        }

        .rumi-pinned-item-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 6px;
        }

        .rumi-pinned-item-badge {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 10px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .rumi-pinned-badge-blocked {
            background: #FEE2E2;
            color: #DC2626;
        }

        .rumi-pinned-badge-care-active {
            background: #DBEAFE;
            color: #1D4ED8;
        }

        .rumi-pinned-badge-care-changed {
            background: #FEF3C7;
            color: #D97706;
        }

        .rumi-pinned-item-remove {
            padding: 2px 8px;
            background: transparent;
            border: 1px solid var(--rumi-border);
            border-radius: 4px;
            cursor: pointer;
            font-size: 11px;
            color: var(--rumi-text-secondary);
            transition: all 0.2s;
        }

        .rumi-pinned-item-remove:hover {
            background: var(--rumi-accent-red);
            color: white;
            border-color: var(--rumi-accent-red);
        }

        .rumi-pinned-item-remove:focus {
            outline: 2px solid var(--rumi-accent-blue);
            outline-offset: 2px;
        }

        .rumi-pinned-item-info {
            display: flex;
            flex-direction: column;
            gap: 4px;
            color: var(--rumi-text-secondary);
        }

        .rumi-pinned-item-link {
            color: var(--rumi-accent-blue);
            text-decoration: none;
            font-weight: 600;
        }

        .rumi-pinned-item-link:hover {
            text-decoration: underline;
        }

        .rumi-pinned-empty {
            padding: 20px;
            text-align: center;
            color: var(--rumi-text-secondary);
            font-size: 12px;
            background: var(--rumi-bg);
            border-radius: 6px;
            margin-top: 12px;
        }

        .rumi-view-process-btn {
            padding: 8px 12px;
            border: 1px solid var(--rumi-border);
            border-radius: 6px;
            background: var(--rumi-panel-bg);
            color: var(--rumi-text);
            font-size: 12px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s;
            text-align: left;
            width: 100%;
        }

        .rumi-view-process-btn:hover:not(:disabled) {
            background: var(--rumi-bg);
            border-color: var(--rumi-accent-blue);
            color: var(--rumi-accent-blue);
        }

        .rumi-view-process-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        @keyframes rumi-toast-in {
            from {
                transform: translateY(100px);
                opacity: 0;
            }
            to {
                transform: translateY(0);
                opacity: 1;
            }
        }

        @keyframes rumi-toast-out {
            from {
                transform: translateY(0);
                opacity: 1;
            }
            to {
                transform: translateY(100px);
                opacity: 0;
            }
        }

        /* Settings Tab Styles */
        #rumi-settings-content {
            flex: 1;
            padding: 20px;
            overflow-y: auto;
        }

        /* Settings Category View */
        .rumi-settings-category-view {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
            gap: 20px;
            padding: 20px 0;
        }

        .rumi-settings-category-card {
            background: var(--rumi-panel-bg);
            border: 2px solid var(--rumi-border);
            border-radius: 12px;
            padding: 24px;
            cursor: pointer;
            transition: all 0.3s ease;
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        .rumi-settings-category-card:hover {
            border-color: var(--rumi-accent-blue);
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        }

        .rumi-settings-category-icon {
            font-size: 32px;
            color: var(--rumi-accent-blue);
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .rumi-settings-category-icon svg {
            width: 32px;
            height: 32px;
            stroke: var(--rumi-accent-blue);
            transition: all 0.3s ease;
        }

        .rumi-settings-category-card:hover .rumi-settings-category-icon svg {
            stroke: var(--rumi-accent-blue);
            transform: scale(1.1);
        }

        .rumi-settings-category-title {
            font-size: 18px;
            font-weight: 600;
            color: var(--rumi-text);
            margin: 0;
        }

        .rumi-settings-category-description {
            font-size: 13px;
            color: var(--rumi-text-secondary);
            margin: 0;
            line-height: 1.5;
        }

        /* Settings Detail View */
        .rumi-settings-detail-view {
            display: none;
        }

        .rumi-settings-detail-view.active {
            display: block;
        }

        .rumi-settings-back-button {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 8px 16px;
            margin-bottom: 20px;
            border: none;
            background: var(--rumi-panel-bg);
            border: 1px solid var(--rumi-border);
            border-radius: 6px;
            color: var(--rumi-text);
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s;
        }

        .rumi-settings-back-button:hover {
            background: var(--rumi-bg);
            border-color: var(--rumi-accent-blue);
            color: var(--rumi-accent-blue);
        }

        .rumi-settings-section {
            background: var(--rumi-panel-bg);
            border: 1px solid var(--rumi-border);
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 20px;
        }

        .rumi-settings-section-title {
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 16px;
            color: var(--rumi-text);
            display: flex;
            align-items: center;
            justify-content: space-between;
        }

        .rumi-settings-controls {
            display: flex;
            gap: 8px;
        }

        .rumi-settings-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 12px;
            border: 1px solid var(--rumi-border);
            border-radius: 6px;
            margin-bottom: 8px;
            transition: all 0.2s;
        }

        .rumi-settings-item:hover {
            background: var(--rumi-bg);
            border-color: var(--rumi-accent-blue);
        }

        .rumi-settings-item-label {
            font-size: 13px;
            color: var(--rumi-text);
            flex: 1;
            word-break: break-word;
        }

        .rumi-settings-sub-tabs {
            display: flex;
            gap: 8px;
            margin-bottom: 20px;
            border-bottom: 2px solid var(--rumi-border);
        }

        .rumi-settings-sub-tab {
            padding: 10px 20px;
            border: none;
            background: transparent;
            color: var(--rumi-text-secondary);
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            border-bottom: 3px solid transparent;
            transition: all 0.2s;
        }

        .rumi-settings-sub-tab:hover {
            color: var(--rumi-text);
            background: var(--rumi-bg);
        }

        .rumi-settings-sub-tab.active {
            color: var(--rumi-accent-blue);
            border-bottom-color: var(--rumi-accent-blue);
            font-weight: 600;
        }

        .rumi-settings-sub-content {
            display: none;
        }

        .rumi-settings-sub-content.active {
            display: block;
        }

        /* Toggle Switch */
        .rumi-toggle-switch {
            position: relative;
            width: 44px;
            height: 24px;
            flex-shrink: 0;
        }

        .rumi-toggle-switch input {
            opacity: 0;
            width: 0;
            height: 0;
        }

        .rumi-toggle-slider {
            position: absolute;
            cursor: pointer;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background-color: #D1D5DB;
            transition: 0.3s;
            border-radius: 24px;
        }

        .rumi-toggle-slider:before {
            position: absolute;
            content: "";
            height: 18px;
            width: 18px;
            left: 3px;
            bottom: 3px;
            background-color: white;
            transition: 0.3s;
            border-radius: 50%;
        }

        .rumi-toggle-switch input:checked + .rumi-toggle-slider {
            background-color: var(--rumi-accent-blue);
        }

        .rumi-toggle-switch input:focus + .rumi-toggle-slider {
            box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.2);
        }

        .rumi-toggle-switch input:checked + .rumi-toggle-slider:before {
            transform: translateX(20px);
        }

        .rumi-toggle-switch input:disabled + .rumi-toggle-slider {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .rumi-btn-sm {
            padding: 6px 12px;
            font-size: 12px;
            border-radius: 4px;
            border: 1px solid var(--rumi-border);
            background: var(--rumi-panel-bg);
            color: var(--rumi-text);
            cursor: pointer;
            transition: all 0.2s;
            font-weight: 500;
        }

        .rumi-btn-sm:hover:not(:disabled) {
            background: var(--rumi-bg);
            border-color: var(--rumi-accent-blue);
            color: var(--rumi-accent-blue);
        }

        .rumi-btn-sm:focus {
            outline: 2px solid var(--rumi-accent-blue);
            outline-offset: 2px;
        }

        .rumi-btn-sm:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        /* Export Button Dropdown Styles */
        .rumi-export-dropdown {
            position: relative;
            display: inline-block;
            width: 100%;
            margin-top: 8px;
        }

        .rumi-export-btn {
            width: 100%;
            padding: 4px 8px;
            font-size: 11px;
            background: var(--rumi-accent-blue);
            color: white;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            font-weight: 500;
            transition: all 0.2s;
        }

        .rumi-export-btn:hover {
            opacity: 0.9;
            transform: translateY(-1px);
        }

        .rumi-export-btn:active {
            transform: translateY(0);
        }

        .rumi-export-arrow {
            font-size: 10px;
            transition: transform 0.2s;
        }

        .rumi-export-dropdown.active .rumi-export-arrow {
            transform: rotate(180deg);
        }

        .rumi-export-menu {
            position: absolute;
            bottom: 100%;
            left: 0;
            right: 0;
            background: var(--rumi-panel-bg);
            border: 1px solid var(--rumi-border);
            border-radius: 6px;
            box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.15);
            margin-bottom: 4px;
            opacity: 0;
            visibility: hidden;
            transform: translateY(10px);
            transition: all 0.2s ease;
            z-index: 1000;
            overflow: hidden;
        }

        .rumi-export-dropdown.active .rumi-export-menu {
            opacity: 1;
            visibility: visible;
            transform: translateY(0);
        }

        .rumi-export-option {
            padding: 10px 12px;
            cursor: pointer;
            transition: all 0.15s;
            border-bottom: 1px solid var(--rumi-border);
            font-size: 12px;
            font-weight: 500;
            color: var(--rumi-text);
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .rumi-export-option:last-child {
            border-bottom: none;
        }

        .rumi-export-option:hover {
            background: var(--rumi-bg);
            color: var(--rumi-accent-blue);
        }

        .rumi-export-option-icon {
            width: 16px;
            height: 16px;
            flex-shrink: 0;
        }

        .rumi-export-btn svg {
            flex-shrink: 0;
        }

        /* Visual Rules Styles */
        .rumi-visual-rules-container {
            display: flex;
            flex-direction: column;
            height: 100%;
            overflow: hidden;
        }

        .rumi-visual-rules-header {
            padding: 20px;
            border-bottom: 1px solid var(--rumi-border);
            background: var(--rumi-panel-bg);
        }

        .rumi-visual-rules-controls {
            display: flex;
            gap: 12px;
            align-items: center;
            flex-wrap: wrap;
        }

        .rumi-visual-rules-ticket-input {
            padding: 8px 12px;
            border: 1px solid var(--rumi-border);
            border-radius: 6px;
            font-size: 13px;
            background: var(--rumi-bg);
            color: var(--rumi-text);
            width: 150px;
        }

        .rumi-visual-rules-ticket-input:focus {
            outline: 2px solid var(--rumi-accent-blue);
            outline-offset: 0;
            border-color: var(--rumi-accent-blue);
        }

        .rumi-visual-rules-ticket-input::placeholder {
            color: var(--rumi-text-secondary);
            opacity: 0.6;
        }

        .rumi-visual-rules-canvas-wrapper {
            flex: 1;
            position: relative;
            overflow: hidden;
            background: var(--rumi-bg);
        }

        .rumi-visual-rules-canvas {
            width: 100%;
            height: 100%;
            cursor: grab;
        }

        .rumi-visual-rules-canvas.panning {
            cursor: grabbing;
        }

        .rumi-visual-rules-zoom-controls {
            position: absolute;
            bottom: 20px;
            right: 20px;
            display: flex;
            flex-direction: column;
            gap: 8px;
            z-index: 10;
        }

        .rumi-visual-rules-zoom-btn {
            width: 40px;
            height: 40px;
            border: 1px solid var(--rumi-border);
            border-radius: 8px;
            background: var(--rumi-panel-bg);
            color: var(--rumi-text);
            font-size: 18px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .rumi-visual-rules-zoom-btn:hover:not(:disabled) {
            background: var(--rumi-bg);
            border-color: var(--rumi-accent-blue);
            color: var(--rumi-accent-blue);
        }

        .rumi-visual-rules-zoom-btn:disabled {
            opacity: 0.4;
            cursor: not-allowed;
        }

        .rumi-visual-rules-legend {
            position: absolute;
            top: 20px;
            left: 20px;
            background: var(--rumi-panel-bg);
            border: 1px solid var(--rumi-border);
            border-radius: 8px;
            padding: 16px;
            max-width: 280px;
            z-index: 10;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
        }

        .rumi-visual-rules-legend-title {
            font-size: 14px;
            font-weight: 600;
            margin-bottom: 12px;
            color: var(--rumi-text);
        }

        .rumi-visual-rules-legend-item {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 8px;
            font-size: 12px;
            color: var(--rumi-text);
        }

        .rumi-visual-rules-legend-item:last-child {
            margin-bottom: 0;
        }

        .rumi-visual-rules-legend-color {
            width: 24px;
            height: 24px;
            border-radius: 4px;
            border: 2px solid var(--rumi-border);
            flex-shrink: 0;
        }

        .rumi-visual-rules-legend-toggle {
            cursor: pointer;
            padding: 4px 8px;
            margin-top: 8px;
            border: 1px solid var(--rumi-border);
            border-radius: 4px;
            background: var(--rumi-bg);
            color: var(--rumi-text-secondary);
            font-size: 11px;
            text-align: center;
            transition: all 0.2s;
        }

        .rumi-visual-rules-legend-toggle:hover {
            color: var(--rumi-accent-blue);
            border-color: var(--rumi-accent-blue);
        }

        .rumi-visual-rules-legend.collapsed .rumi-visual-rules-legend-item {
            display: none;
        }

        .rumi-visual-rules-tooltip {
            position: absolute;
            background: var(--rumi-panel-bg);
            border: 1px solid var(--rumi-border);
            border-radius: 6px;
            padding: 10px 12px;
            font-size: 12px;
            color: var(--rumi-text);
            z-index: 20;
            pointer-events: none;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            max-width: 300px;
        }

        .rumi-visual-rules-tooltip-title {
            font-weight: 600;
            margin-bottom: 6px;
        }

        .rumi-visual-rules-tooltip-description {
            font-size: 11px;
            color: var(--rumi-text-secondary);
            line-height: 1.4;
        }

        .rumi-visual-rules-node-highlight {
            stroke: var(--rumi-accent-blue);
            stroke-width: 4;
            fill: none;
        }

        /* Node color classes */
        .rumi-node-entry { fill: #9CA3AF; }
        .rumi-node-priority { fill: #EF4444; }
        .rumi-node-tag-routing { fill: #8B5CF6; }
        .rumi-node-comment-action { fill: #10B981; }
        .rumi-node-subject { fill: #F59E0B; }
        .rumi-node-blocking { fill: #DC2626; }
        .rumi-node-action { fill: #3B82F6; }
        .rumi-node-disabled { fill: #D1D5DB; opacity: 0.6; }

        [data-theme="dark"] .rumi-node-entry { fill: #6B7280; }
        [data-theme="dark"] .rumi-node-priority { fill: #EF4444; }
        [data-theme="dark"] .rumi-node-tag-routing { fill: #A78BFA; }
        [data-theme="dark"] .rumi-node-comment-action { fill: #34D399; }
        [data-theme="dark"] .rumi-node-subject { fill: #FBBF24; }
        [data-theme="dark"] .rumi-node-blocking { fill: #F87171; }
        [data-theme="dark"] .rumi-node-action { fill: #60A5FA; }
        [data-theme="dark"] .rumi-node-disabled { fill: #4B5563; opacity: 0.6; }

        .rumi-visual-rules-loading {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            text-align: center;
            color: var(--rumi-text-secondary);
        }

        .rumi-visual-rules-loading-spinner {
            width: 40px;
            height: 40px;
            border: 4px solid var(--rumi-border);
            border-top-color: var(--rumi-accent-blue);
            border-radius: 50%;
            animation: rumi-spin 1s linear infinite;
            margin: 0 auto 12px;
        }

        @keyframes rumi-spin {
            to { transform: rotate(360deg); }
        }

        .rumi-visual-rules-error {
            padding: 20px;
            text-align: center;
            color: var(--rumi-accent-red);
        }
    `;

    // ============================================================================
    // UI HTML TEMPLATE
    // ============================================================================

    const HTML_TEMPLATE = `
        <div id="rumi-root" role="application" aria-label="RUMI Automation Tool">
            <!-- Top Bar -->
            <div id="rumi-topbar">
                <div>
                    <h1 style="margin:0; font-size:18px;">RUMI Automation Tool</h1>
                    <small style="color: var(--rumi-text-secondary);">Ticket Processing & Business Logic</small>
                </div>

                <div class="rumi-status-indicator">
                    <span class="rumi-status-dot" id="rumi-status-dot" aria-hidden="true"></span>
                    <span id="rumi-status-text" role="status" aria-live="polite">Offline</span>
                </div>

                <div style="display:flex; gap:8px; align-items:center;">
                    <label class="rumi-checkbox-label" style="margin:0; padding:4px 8px; background: var(--rumi-panel-bg); border-radius:4px;">
                        <input type="checkbox" id="rumi-dry-run-global" checked aria-label="Enable dry run mode">
                        <span style="font-weight:600; color: var(--rumi-accent-red);">DRY RUN MODE</span>
                    </label>
                    <button id="rumi-btn-monitor-toggle" class="rumi-btn rumi-btn-primary" aria-label="Start monitoring">Start Monitoring</button>
                </div>
            </div>

            <!-- Top-Level Tab Navigation -->
            <div class="rumi-tabs-nav" style="background: var(--rumi-panel-bg); border-bottom: 2px solid var(--rumi-border); padding: 0 20px; justify-content: space-between;">
                <div style="display: flex; gap: 4px;">
                    <button class="rumi-tab-btn active" data-main-tab="automatic">Automatic Processing</button>
                    <button class="rumi-tab-btn" data-main-tab="manual">Manual Processing</button>
                    <button class="rumi-tab-btn" data-main-tab="logs">Logs</button>
                </div>
                <button class="rumi-tab-btn" data-main-tab="settings">Settings</button>
            </div>

            <!-- Main Content Area for Automatic Processing -->
            <div id="rumi-main-automatic" class="rumi-main-tab-panel" style="display: flex; flex: 1; overflow: hidden;">
                <!-- Left Panel -->
                <div id="rumi-left-panel">
                    <h2 class="rumi-section-title">Select Views to Monitor</h2>
                    <div id="rumi-views-list" role="group" aria-label="Zendesk views selection"></div>

                    <div class="rumi-button-group">
                        <button id="rumi-select-all" class="rumi-btn rumi-btn-secondary" style="font-size:12px; padding:6px 12px;">Select All</button>
                        <button id="rumi-clear-all" class="rumi-btn rumi-btn-secondary" style="font-size:12px; padding:6px 12px;">Clear All</button>
                    </div>

                    <hr class="rumi-divider">

                    <h2 class="rumi-section-title">Monitoring</h2>

                    <label style="display:block; margin:12px 0 8px 0;">
                        Interval (seconds):
                        <input type="number" id="rumi-interval" class="rumi-input-number" min="5" max="60" value="10">
                    </label>

                    <p id="rumi-monitor-status" class="rumi-status-text">
                        Not monitoring
                    </p>

                    <p id="rumi-last-run" class="rumi-status-text">
                        Last run: Never
                    </p>

                    <hr class="rumi-divider">

                    <h2 class="rumi-section-title">Counters</h2>
                    <div class="rumi-counters-grid">
                        <div class="rumi-counter-card">
                            <div class="rumi-counter-value" id="rumi-counter-total">0</div>
                            <div class="rumi-counter-label">Total</div>
                        </div>
                        <div class="rumi-counter-card rumi-counter-pending">
                            <div class="rumi-counter-value" id="rumi-counter-pending">0</div>
                            <div class="rumi-counter-label">Pending</div>
                        </div>
                        <div class="rumi-counter-card rumi-counter-solved">
                            <div class="rumi-counter-value" id="rumi-counter-solved">0</div>
                            <div class="rumi-counter-label">Solved</div>
                        </div>
                        <div class="rumi-counter-card rumi-counter-care">
                            <div class="rumi-counter-value" id="rumi-counter-care">0</div>
                            <div class="rumi-counter-label">Care</div>
                        </div>
                        <div class="rumi-counter-card rumi-counter-hala">
                            <div class="rumi-counter-value" id="rumi-counter-hala">0</div>
                            <div class="rumi-counter-label">Hala/RTA</div>
                        </div>
                        <div class="rumi-counter-card rumi-counter-casablanca">
                            <div class="rumi-counter-value" id="rumi-counter-casablanca">0</div>
                            <div class="rumi-counter-label">Casablanca</div>
                        </div>
                    </div>
                    <button id="rumi-reset-counters" class="rumi-btn rumi-btn-secondary" style="width:100%; margin-top:8px; font-size:11px; padding:4px 8px;">
                        Clear Data
                    </button>

                    <!-- Export Button with Dropdown -->
                    <div class="rumi-export-dropdown" id="rumi-export-dropdown-auto">
                        <button class="rumi-export-btn" id="rumi-export-btn-auto">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                <polyline points="7 10 12 15 17 10"></polyline>
                                <line x1="12" y1="15" x2="12" y2="3"></line>
                            </svg>
                            <span>Export Data</span>
                            <span class="rumi-export-arrow">▼</span>
                        </button>
                        <div class="rumi-export-menu">
                            <div class="rumi-export-option" data-export-type="csv" data-tab="auto">
                                <svg class="rumi-export-option-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                    <polyline points="14 2 14 8 20 8"></polyline>
                                    <line x1="16" y1="13" x2="8" y2="13"></line>
                                    <line x1="16" y1="17" x2="8" y2="17"></line>
                                    <polyline points="10 9 9 9 8 9"></polyline>
                                </svg>
                                <span>Export as CSV</span>
                            </div>
                            <div class="rumi-export-option" data-export-type="html" data-tab="auto">
                                <svg class="rumi-export-option-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <circle cx="12" cy="12" r="10"></circle>
                                    <line x1="2" y1="12" x2="22" y2="12"></line>
                                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                                </svg>
                                <span>Export as Interactive HTML</span>
                            </div>
                        </div>
                    </div>

                    <hr class="rumi-divider">

                    <h2 class="rumi-section-title">Pinned Tickets</h2>
                    <div class="rumi-pin-input-group">
                        <input
                            type="text"
                            id="rumi-pin-ticket-id"
                            class="rumi-pin-input"
                            placeholder="Enter Ticket ID"
                            aria-label="Ticket ID to pin"
                        >
                        <div class="rumi-pin-radio-group" role="radiogroup" aria-label="Pin type">
                            <label class="rumi-pin-radio-label">
                                <input
                                    type="radio"
                                    name="rumi-pin-type"
                                    value="blocked"
                                    checked
                                    aria-label="Block Processing"
                                >
                                <span>Block Processing</span>
                            </label>
                            <label class="rumi-pin-radio-label">
                                <input
                                    type="radio"
                                    name="rumi-pin-type"
                                    value="care_routing"
                                    aria-label="Care Routing"
                                >
                                <span>Care Routing</span>
                            </label>
                        </div>
                        <button id="rumi-add-pin" class="rumi-btn rumi-btn-primary" style="font-size:12px; padding:6px 12px;">
                            Add Pin
                        </button>
                    </div>
                    <div id="rumi-pinned-list" class="rumi-pinned-list" role="list" aria-label="Pinned tickets list">
                        <!-- Pinned items will be rendered here -->
                    </div>
                </div>

                <!-- Work Area for Automatic Processing -->
                <div id="rumi-work-area">
                    <!-- Sub-Tab Navigation -->
                    <div class="rumi-tabs-nav">
                        <button class="rumi-tab-btn active" data-auto-tab="all">All Processed (0)</button>
                        <button class="rumi-tab-btn" data-auto-tab="pending">Pending (0)</button>
                        <button class="rumi-tab-btn" data-auto-tab="solved">Solved (0)</button>
                        <button class="rumi-tab-btn" data-auto-tab="care">Care (0)</button>
                        <button class="rumi-tab-btn" data-auto-tab="hala">Hala/RTA (0)</button>
                        <button class="rumi-tab-btn" data-auto-tab="casablanca">Casablanca (0)</button>
                    </div>

                    <!-- Tab Content -->
                    <div class="rumi-tab-content">
                        <!-- All Processed Tickets -->
                        <div id="rumi-tab-all" class="rumi-tab-panel active">
                            <div class="rumi-table-container">
                                <table class="rumi-table">
                                    <thead>
                                        <tr>
                                            <th>#</th>
                                            <th>Ticket ID</th>
                                            <th>Subject</th>
                                            <th>View</th>
                                            <th>Action</th>
                                            <th>Trigger</th>
                                            <th>Prev Status</th>
                                            <th>New Status</th>
                                            <th>Prev Group</th>
                                            <th>New Group</th>
                                            <th>Processed At</th>
                                            <th>Dry Run</th>
                                            <th>Updated?</th>
                                        </tr>
                                    </thead>
                                    <tbody id="rumi-table-all"></tbody>
                                </table>
                            </div>
                        </div>

                        <!-- Pending Tickets -->
                        <div id="rumi-tab-pending" class="rumi-tab-panel">
                            <div class="rumi-table-container">
                                <table class="rumi-table">
                                    <thead>
                                        <tr>
                                            <th>#</th>
                                            <th>Ticket ID</th>
                                            <th>Subject</th>
                                            <th>View</th>
                                            <th>Action</th>
                                            <th>Trigger</th>
                                            <th>Prev Status</th>
                                            <th>New Status</th>
                                            <th>Prev Group</th>
                                            <th>New Group</th>
                                            <th>Processed At</th>
                                            <th>Dry Run</th>
                                            <th>Updated?</th>
                                        </tr>
                                    </thead>
                                    <tbody id="rumi-table-pending"></tbody>
                                </table>
                            </div>
                        </div>

                        <!-- Solved Tickets -->
                        <div id="rumi-tab-solved" class="rumi-tab-panel">
                            <div class="rumi-table-container">
                                <table class="rumi-table">
                                    <thead>
                                        <tr>
                                            <th>#</th>
                                            <th>Ticket ID</th>
                                            <th>Subject</th>
                                            <th>View</th>
                                            <th>Action</th>
                                            <th>Trigger</th>
                                            <th>Prev Status</th>
                                            <th>New Status</th>
                                            <th>Prev Group</th>
                                            <th>New Group</th>
                                            <th>Processed At</th>
                                            <th>Dry Run</th>
                                            <th>Updated?</th>
                                        </tr>
                                    </thead>
                                    <tbody id="rumi-table-solved"></tbody>
                                </table>
                            </div>
                        </div>

                        <!-- Care Routed Tickets -->
                        <div id="rumi-tab-care" class="rumi-tab-panel">
                            <div class="rumi-table-container">
                                <table class="rumi-table">
                                    <thead>
                                        <tr>
                                            <th>#</th>
                                            <th>Ticket ID</th>
                                            <th>Subject</th>
                                            <th>View</th>
                                            <th>Action</th>
                                            <th>Trigger</th>
                                            <th>Prev Status</th>
                                            <th>New Status</th>
                                            <th>Prev Group</th>
                                            <th>New Group</th>
                                            <th>Processed At</th>
                                            <th>Dry Run</th>
                                            <th>Updated?</th>
                                        </tr>
                                    </thead>
                                    <tbody id="rumi-table-care"></tbody>
                                </table>
                            </div>
                        </div>

                        <!-- Hala/RTA Routed Tickets -->
                        <div id="rumi-tab-hala" class="rumi-tab-panel">
                            <div class="rumi-table-container">
                                <table class="rumi-table">
                                    <thead>
                                        <tr>
                                            <th>#</th>
                                            <th>Ticket ID</th>
                                            <th>Subject</th>
                                            <th>View</th>
                                            <th>Action</th>
                                            <th>Trigger</th>
                                            <th>Prev Status</th>
                                            <th>New Status</th>
                                            <th>Prev Group</th>
                                            <th>New Group</th>
                                            <th>Processed At</th>
                                            <th>Dry Run</th>
                                            <th>Updated?</th>
                                        </tr>
                                    </thead>
                                    <tbody id="rumi-table-hala"></tbody>
                                </table>
                            </div>
                        </div>

                        <!-- Casablanca Routed Tickets -->
                        <div id="rumi-tab-casablanca" class="rumi-tab-panel">
                            <div class="rumi-table-container">
                                <table class="rumi-table">
                                    <thead>
                                        <tr>
                                            <th>#</th>
                                            <th>Ticket ID</th>
                                            <th>Subject</th>
                                            <th>View</th>
                                            <th>Action</th>
                                            <th>Trigger</th>
                                            <th>Prev Status</th>
                                            <th>New Status</th>
                                            <th>Prev Group</th>
                                            <th>New Group</th>
                                            <th>Processed At</th>
                                            <th>Dry Run</th>
                                            <th>Updated?</th>
                                        </tr>
                                    </thead>
                                    <tbody id="rumi-table-casablanca"></tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Main Content Area for Manual Processing -->
            <div id="rumi-main-manual" class="rumi-main-tab-panel" style="display: none; flex: 1; overflow: hidden;">
                <!-- Left Panel for Manual Processing -->
                <div id="rumi-left-panel-manual">
                    <h2 class="rumi-section-title">Manual Processing</h2>

                    <!-- Input Mode Selector -->
                    <div class="rumi-pin-radio-group" style="margin-bottom:12px;">
                        <label class="rumi-pin-radio-label">
                            <input type="radio" name="manual-input-mode" value="ticket-ids" checked>
                            <span>Ticket IDs</span>
                        </label>
                        <label class="rumi-pin-radio-label">
                            <input type="radio" name="manual-input-mode" value="json">
                            <span>JSON Input</span>
                        </label>
                    </div>

                    <!-- Ticket IDs Input -->
                    <div id="rumi-ticket-ids-input">
                        <textarea id="rumi-manual-ids" class="rumi-textarea" placeholder="Enter ticket IDs (comma-separated)&#10;Example: 12345, 67890, 54321"></textarea>

                        <div id="rumi-ticket-count" style="margin-top:8px; font-size:13px; color:var(--rumi-text-secondary); font-weight:500;">
                            <span id="rumi-ticket-count-value">0</span> tickets ready to process
                        </div>
                    </div>

                    <!-- JSON Input -->
                    <div id="rumi-json-input" style="display:none;">
                        <div style="padding:8px; background:var(--rumi-bg); border:1px solid var(--rumi-accent-yellow); border-radius:4px; margin-bottom:8px; font-size:12px; color:var(--rumi-accent-yellow); font-weight:600;">
                            ⚠️ JSON input always runs in DRY RUN mode for safety
                        </div>
                        <textarea id="rumi-manual-json" class="rumi-textarea" style="min-height:200px; font-family:monospace; font-size:12px;" placeholder='Paste JSON comments data here...&#10;Example:&#10;{&#10;  "comments": [...]&#10;}'></textarea>

                        <div id="rumi-json-status" style="margin-top:8px; font-size:13px; color:var(--rumi-text-secondary); font-weight:500;">
                            <span id="rumi-json-status-text">Waiting for JSON input...</span>
                        </div>
                    </div>

                    <div id="rumi-manual-progress" style="display:none; margin-top:8px; padding:8px; background:var(--rumi-bg); border-radius:4px; text-align:center; font-weight:600; color:var(--rumi-accent-blue); font-size:12px;">
                        Processing 0/0 tickets...
                    </div>

                    <label class="rumi-checkbox-label" style="margin-top:12px;">
                        <input type="checkbox" id="rumi-manual-dry-run" checked aria-label="Enable manual dry run mode">
                        <span style="font-weight:600; color:var(--rumi-accent-red);">DRY RUN MODE</span>
                    </label>

                    <button id="rumi-manual-process" class="rumi-btn rumi-btn-primary" style="width:100%; margin-top:12px;">
                        Process Tickets
                    </button>

                    <hr class="rumi-divider">

                    <h2 class="rumi-section-title">Process View</h2>
                    <div style="font-size:12px; color:var(--rumi-text-secondary); margin-bottom:12px;">
                        Click a view to fetch and process all tickets in that view
                    </div>
                    <div id="rumi-view-buttons-container" style="display:flex; flex-direction:column; gap:6px;">
                        <!-- View buttons will be populated by JavaScript -->
                    </div>

                    <hr class="rumi-divider">

                    <h2 class="rumi-section-title">Counters</h2>
                    <div class="rumi-counters-grid">
                        <div class="rumi-counter-card">
                            <div class="rumi-counter-value" id="rumi-manual-counter-total">0</div>
                            <div class="rumi-counter-label">Total</div>
                        </div>
                        <div class="rumi-counter-card rumi-counter-pending">
                            <div class="rumi-counter-value" id="rumi-manual-counter-pending">0</div>
                            <div class="rumi-counter-label">Pending</div>
                        </div>
                        <div class="rumi-counter-card rumi-counter-solved">
                            <div class="rumi-counter-value" id="rumi-manual-counter-solved">0</div>
                            <div class="rumi-counter-label">Solved</div>
                        </div>
                        <div class="rumi-counter-card rumi-counter-care">
                            <div class="rumi-counter-value" id="rumi-manual-counter-care">0</div>
                            <div class="rumi-counter-label">Care</div>
                        </div>
                        <div class="rumi-counter-card rumi-counter-hala">
                            <div class="rumi-counter-value" id="rumi-manual-counter-hala">0</div>
                            <div class="rumi-counter-label">Hala/RTA</div>
                        </div>
                        <div class="rumi-counter-card rumi-counter-casablanca">
                            <div class="rumi-counter-value" id="rumi-manual-counter-casablanca">0</div>
                            <div class="rumi-counter-label">Casablanca</div>
                        </div>
                    </div>
                    <button id="rumi-reset-manual-counters" class="rumi-btn rumi-btn-secondary" style="width:100%; margin-top:8px; font-size:11px; padding:4px 8px;">
                        Clear Data
                    </button>

                    <!-- Export Button with Dropdown -->
                    <div class="rumi-export-dropdown" id="rumi-export-dropdown-manual">
                        <button class="rumi-export-btn" id="rumi-export-btn-manual">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                <polyline points="7 10 12 15 17 10"></polyline>
                                <line x1="12" y1="15" x2="12" y2="3"></line>
                            </svg>
                            <span>Export Data</span>
                            <span class="rumi-export-arrow">▼</span>
                        </button>
                        <div class="rumi-export-menu">
                            <div class="rumi-export-option" data-export-type="csv" data-tab="manual">
                                <svg class="rumi-export-option-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                    <polyline points="14 2 14 8 20 8"></polyline>
                                    <line x1="16" y1="13" x2="8" y2="13"></line>
                                    <line x1="16" y1="17" x2="8" y2="17"></line>
                                    <polyline points="10 9 9 9 8 9"></polyline>
                                </svg>
                                <span>Export as CSV</span>
                            </div>
                            <div class="rumi-export-option" data-export-type="html" data-tab="manual">
                                <svg class="rumi-export-option-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <circle cx="12" cy="12" r="10"></circle>
                                    <line x1="2" y1="12" x2="22" y2="12"></line>
                                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                                </svg>
                                <span>Export as Interactive HTML</span>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Work Area for Manual Processing -->
                <div id="rumi-work-area-manual">
                    <!-- Sub-Tab Navigation -->
                    <div class="rumi-tabs-nav">
                        <button class="rumi-tab-btn active" data-manual-tab="manual-all">All Processed (0)</button>
                        <button class="rumi-tab-btn" data-manual-tab="manual-pending">Pending (0)</button>
                        <button class="rumi-tab-btn" data-manual-tab="manual-solved">Solved (0)</button>
                        <button class="rumi-tab-btn" data-manual-tab="manual-care">Care (0)</button>
                        <button class="rumi-tab-btn" data-manual-tab="manual-hala">Hala/RTA (0)</button>
                        <button class="rumi-tab-btn" data-manual-tab="manual-casablanca">Casablanca (0)</button>
                        <button class="rumi-tab-btn" data-manual-tab="manual-unprocessed">Unprocessed (0)</button>
                    </div>

                    <!-- Tab Content for Manual Processing -->
                    <div class="rumi-tab-content">
                        <!-- Manual All Processed Tickets -->
                        <div id="rumi-manual-tab-all" class="rumi-tab-panel active">
                                            <div class="rumi-table-container">
                                                <table class="rumi-table">
                                                    <thead>
                                                        <tr>
                                                            <th>#</th>
                                                            <th>Ticket ID</th>
                                                            <th>Subject</th>
                                                            <th>View</th>
                                                            <th>Action</th>
                                                            <th>Trigger</th>
                                                            <th>Prev Status</th>
                                                            <th>New Status</th>
                                                            <th>Prev Group</th>
                                                            <th>New Group</th>
                                                            <th>Processed At</th>
                                                            <th>Dry Run</th>
                                                            <th>Updated?</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody id="rumi-manual-table-all"></tbody>
                                                </table>
                                            </div>
                                        </div>

                                        <!-- Manual Pending Tickets -->
                                        <div id="rumi-manual-tab-pending" class="rumi-tab-panel">
                                            <div class="rumi-table-container">
                                                <table class="rumi-table">
                                                    <thead>
                                                        <tr>
                                                            <th>#</th>
                                                            <th>Ticket ID</th>
                                                            <th>Subject</th>
                                                            <th>View</th>
                                                            <th>Action</th>
                                                            <th>Trigger</th>
                                                            <th>Prev Status</th>
                                                            <th>New Status</th>
                                                            <th>Prev Group</th>
                                                            <th>New Group</th>
                                                            <th>Processed At</th>
                                                            <th>Dry Run</th>
                                                            <th>Updated?</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody id="rumi-manual-table-pending"></tbody>
                                                </table>
                                            </div>
                                        </div>

                                        <!-- Manual Solved Tickets -->
                                        <div id="rumi-manual-tab-solved" class="rumi-tab-panel">
                                            <div class="rumi-table-container">
                                                <table class="rumi-table">
                                                    <thead>
                                                        <tr>
                                                            <th>#</th>
                                                            <th>Ticket ID</th>
                                                            <th>Subject</th>
                                                            <th>View</th>
                                                            <th>Action</th>
                                                            <th>Trigger</th>
                                                            <th>Prev Status</th>
                                                            <th>New Status</th>
                                                            <th>Prev Group</th>
                                                            <th>New Group</th>
                                                            <th>Processed At</th>
                                                            <th>Dry Run</th>
                                                            <th>Updated?</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody id="rumi-manual-table-solved"></tbody>
                                                </table>
                                            </div>
                                        </div>

                                        <!-- Manual Care Routed Tickets -->
                                        <div id="rumi-manual-tab-care" class="rumi-tab-panel">
                                            <div class="rumi-table-container">
                                                <table class="rumi-table">
                                                    <thead>
                                                        <tr>
                                                            <th>#</th>
                                                            <th>Ticket ID</th>
                                                            <th>Subject</th>
                                                            <th>View</th>
                                                            <th>Action</th>
                                                            <th>Trigger</th>
                                                            <th>Prev Status</th>
                                                            <th>New Status</th>
                                                            <th>Prev Group</th>
                                                            <th>New Group</th>
                                                            <th>Processed At</th>
                                                            <th>Dry Run</th>
                                                            <th>Updated?</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody id="rumi-manual-table-care"></tbody>
                                                </table>
                                            </div>
                                        </div>

                                        <!-- Manual Hala/RTA Routed Tickets -->
                                        <div id="rumi-manual-tab-hala" class="rumi-tab-panel">
                                            <div class="rumi-table-container">
                                                <table class="rumi-table">
                                                    <thead>
                                                        <tr>
                                                            <th>#</th>
                                                            <th>Ticket ID</th>
                                                            <th>Subject</th>
                                                            <th>View</th>
                                                            <th>Action</th>
                                                            <th>Trigger</th>
                                                            <th>Prev Status</th>
                                                            <th>New Status</th>
                                                            <th>Prev Group</th>
                                                            <th>New Group</th>
                                                            <th>Processed At</th>
                                                            <th>Dry Run</th>
                                                            <th>Updated?</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody id="rumi-manual-table-hala"></tbody>
                                                </table>
                                            </div>
                                        </div>

                                        <!-- Manual Casablanca Routed Tickets -->
                                        <div id="rumi-manual-tab-casablanca" class="rumi-tab-panel">
                                            <div class="rumi-table-container">
                                                <table class="rumi-table">
                                                    <thead>
                                                        <tr>
                                                            <th>#</th>
                                                            <th>Ticket ID</th>
                                                            <th>Subject</th>
                                                            <th>View</th>
                                                            <th>Action</th>
                                                            <th>Trigger</th>
                                                            <th>Prev Status</th>
                                                            <th>New Status</th>
                                                            <th>Prev Group</th>
                                                            <th>New Group</th>
                                                            <th>Processed At</th>
                                                            <th>Dry Run</th>
                                                            <th>Updated?</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody id="rumi-manual-table-casablanca"></tbody>
                                                </table>
                                            </div>
                                        </div>

                                        <!-- Manual Unprocessed Tickets -->
                                        <div id="rumi-manual-tab-unprocessed" class="rumi-tab-panel">
                                            <div class="rumi-table-container">
                                                <table class="rumi-table">
                                                    <thead>
                                                        <tr>
                                                            <th>#</th>
                                                            <th>Ticket ID</th>
                                                            <th>Subject</th>
                                                            <th>View</th>
                                                            <th>Action</th>
                                                            <th>Trigger</th>
                                                            <th>Prev Status</th>
                                                            <th>New Status</th>
                                                            <th>Prev Group</th>
                                                            <th>New Group</th>
                                                            <th>Processed At</th>
                                                            <th>Dry Run</th>
                                                            <th>Updated?</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody id="rumi-manual-table-unprocessed"></tbody>
                                                </table>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

            <!-- Main Content Area for Logs -->
            <div id="rumi-main-logs" class="rumi-main-tab-panel" style="display: none; flex: 1; overflow: hidden;">
                <div style="flex: 1; padding: 20px; overflow-y: auto;">
                            <div style="margin-bottom:16px; display:flex; gap:8px; align-items:center;">
                                <label>
                                    Filter:
                                    <select id="rumi-log-filter" class="rumi-select">
                                        <option value="all">All Levels</option>
                                        <option value="info">Info</option>
                                        <option value="warn">Warn</option>
                                        <option value="error">Error</option>
                                        <option value="debug">Debug</option>
                                    </select>
                                </label>
                                <button id="rumi-download-logs" class="rumi-btn rumi-btn-primary" style="font-size:12px; padding:6px 12px;">Download All Logs</button>
                                <button id="rumi-clear-logs" class="rumi-btn rumi-btn-secondary" style="font-size:12px; padding:6px 12px;">Clear Logs</button>
                            </div>

                    <div id="rumi-logs-container" class="rumi-logs-container"></div>
                </div>
            </div>

            <!-- Main Content Area for Settings -->
            <div id="rumi-main-settings" class="rumi-main-tab-panel" style="display: none; flex: 1; overflow: hidden;">
                <div id="rumi-settings-content">
                    <!-- Settings content will be rendered dynamically -->
                </div>
            </div>
        </div>
    `;

    // ============================================================================
    // UI CONTROLLER
    // ============================================================================

    class RUMIUI {
        static viewsMap = new Map(); // title -> id
        static viewIdToNameMap = new Map(); // id -> title
        static logRenderScheduled = false;
        static lastRenderedLogTimestamp = null; // Track timestamp of last rendered log for rolling window
        static currentLogFilter = 'all'; // Track current filter to detect changes
        static currentAutoTab = 'all'; // Track current active automatic tab
        static currentManualTab = 'manual-all'; // Track current active manual tab
        static tableFilters = {
            automatic: {},
            manual: {}
        };
        static tableSortState = {
            automatic: { column: null, direction: null },
            manual: { column: null, direction: null }
        };
        static timeFilters = {
            automatic: {},
            manual: {}
        };

        static async init() {
            try {
                console.log('[RUMI DEBUG] UI.init() starting');

                // Initialize settings storage (will create defaults if not exist)
                RUMIStorage.getAutomaticSettings();
                RUMIStorage.getManualSettings();
                RUMILogger.info('UI', 'Settings initialized');

                // Apply theme from settings (defaults to dark mode)
                const uiSettings = RUMIStorage.getUISettings();
                this.applyTheme(uiSettings.theme);
                RUMILogger.info('UI', 'Theme applied on initialization', { theme: uiSettings.theme });

                this.attachEventListeners();
                await this.loadViews();

                // Views are already restored in loadViews()

                // Restore dry run setting from previous session (automatic processing)
                const settings = RUMIStorage.getProcessingSettings();
                document.getElementById('rumi-dry-run-global').checked = settings.dryRunMode;
                RUMIProcessor.isDryRun = settings.dryRunMode;

                // Restore manual processing dry run setting from previous session
                const manualSettings = RUMIStorage.getManualProcessingSettings();
                document.getElementById('rumi-manual-dry-run').checked = manualSettings.dryRunMode;

                // Add global click listener to close dropdowns when clicking outside
                document.addEventListener('click', (e) => {
                    if (!e.target.closest('.rumi-custom-select')) {
                        this.closeAllDropdowns();
                    }
                });

                // Close dropdowns on scroll to prevent misalignment
                document.querySelectorAll('.rumi-table-container').forEach(container => {
                    container.addEventListener('scroll', () => {
                        this.closeAllDropdowns();
                    });
                });

                // Display current data (both automatic and manual)
                this.updateCounters();
                this.updateProcessedTicketsDisplay();
                this.updateManualCounters();
                this.updateManualProcessedTicketsDisplay();
                this.renderLogs();
                this.renderPinnedList();

                // Set up filters and sorting ONCE during initialization
                // This should NOT be called during updates to prevent loss of focus
                this.setupAllTableFiltersAndSorting();

                // Ensure the default "automatic" tab is visible
                console.log('[RUMI DEBUG] Ensuring automatic tab is visible on init');
                const automaticPanel = document.getElementById('rumi-main-automatic');
                if (automaticPanel) {
                    automaticPanel.style.display = 'flex';
                    automaticPanel.style.visibility = 'visible';
                    automaticPanel.style.flex = '1';
                    console.log('[RUMI DEBUG] Automatic panel visibility ensured');
                } else {
                    console.error('[RUMI DEBUG] Could not find automatic panel!');
                }

                RUMILogger.info('UI', 'Initialized');
            } catch (error) {
                console.error('[RUMI DEBUG] UI.init() error:', error);
                RUMILogger.error('UI', 'Failed to initialize', { error: error.message });
            }
        }

        static attachEventListeners() {
            const monitorToggleBtn = document.getElementById('rumi-btn-monitor-toggle');

            monitorToggleBtn.onclick = async () => {
                if (RUMIMonitor.isRunning) {
                    // Stop monitoring
                    RUMIMonitor.stop();
                    monitorToggleBtn.textContent = 'Start Monitoring';
                    monitorToggleBtn.classList.remove('rumi-btn-secondary');
                    monitorToggleBtn.classList.add('rumi-btn-primary');
                    monitorToggleBtn.setAttribute('aria-label', 'Start monitoring');
                } else {
                    // Start monitoring - wait for validation
                    const started = await RUMIMonitor.start();

                    // Only update button if monitoring actually started
                    if (started) {
                        monitorToggleBtn.textContent = 'Stop Monitoring';
                        monitorToggleBtn.classList.remove('rumi-btn-primary');
                        monitorToggleBtn.classList.add('rumi-btn-secondary');
                        monitorToggleBtn.setAttribute('aria-label', 'Stop monitoring');
                    } else {
                        // Keep button as "Start" if it failed to start
                        RUMILogger.debug('UI', 'Monitoring failed to start, keeping button as Start');
                    }
                }
            };

            // View selection
            document.getElementById('rumi-select-all').onclick = () => {
                document.querySelectorAll('.rumi-view-checkbox input').forEach(cb => {
                    cb.checked = true;
                });
                this.saveSelectedViews();
            };

            document.getElementById('rumi-clear-all').onclick = () => {
                document.querySelectorAll('.rumi-view-checkbox input').forEach(cb => {
                    cb.checked = false;
                });
                this.saveSelectedViews();
            };

            // Monitoring interval control
            const intervalInput = document.getElementById('rumi-interval');
            intervalInput.onchange = (e) => {
                const value = parseInt(e.target.value, 10);
                if (value >= CONFIG.MIN_INTERVAL_SECONDS && value <= CONFIG.MAX_INTERVAL_SECONDS) {
                    RUMIMonitor.intervalSeconds = value;
                    RUMILogger.info('UI', 'Interval changed', { interval: value });
                } else {
                    e.target.value = Math.max(CONFIG.MIN_INTERVAL_SECONDS, Math.min(CONFIG.MAX_INTERVAL_SECONDS, value));
                }
            };

            // Dry run mode toggle (global)
            document.getElementById('rumi-dry-run-global').onchange = (e) => {
                const settings = RUMIStorage.getProcessingSettings();
                settings.dryRunMode = e.target.checked;
                RUMIStorage.setProcessingSettings(settings);
                RUMIProcessor.isDryRun = e.target.checked;
                RUMILogger.info('UI', 'Dry run mode toggled', { enabled: e.target.checked });

                // Visual feedback
                if (e.target.checked) {
                    this.showToast('DRY RUN MODE ENABLED - No tickets will be modified', 'warning');
                } else {
                    if (confirm('Are you sure you want to DISABLE dry run mode? This will allow actual ticket modifications.')) {
                        // User confirmed
                        this.showToast('Live mode enabled - Tickets will be modified!', 'error');
                    } else {
                        // User cancelled, re-enable dry run
                        e.target.checked = true;
                        settings.dryRunMode = true;
                        RUMIStorage.setProcessingSettings(settings);
                        RUMIProcessor.isDryRun = true;
                    }
                }
            };

            // Real-time ticket counter for manual processing textarea
            const manualTextarea = document.getElementById('rumi-manual-ids');
            const ticketCountValue = document.getElementById('rumi-ticket-count-value');
            const jsonTextarea = document.getElementById('rumi-manual-json');
            const jsonStatusText = document.getElementById('rumi-json-status-text');
            const ticketIdsInput = document.getElementById('rumi-ticket-ids-input');
            const jsonInput = document.getElementById('rumi-json-input');

            // Input mode switching
            document.querySelectorAll('input[name="manual-input-mode"]').forEach(radio => {
                radio.addEventListener('change', (e) => {
                    console.log('[RUMI DEBUG] Input mode changed to:', e.target.value);
                    if (e.target.value === 'ticket-ids') {
                        ticketIdsInput.style.display = 'block';
                        jsonInput.style.display = 'none';
                    } else {
                        ticketIdsInput.style.display = 'none';
                        jsonInput.style.display = 'block';
                    }
                });
            });

            // Ensure correct initial state
            const initialMode = document.querySelector('input[name="manual-input-mode"]:checked');
            if (initialMode) {
                console.log('[RUMI DEBUG] Initial input mode:', initialMode.value);
                if (initialMode.value === 'ticket-ids') {
                    ticketIdsInput.style.display = 'block';
                    jsonInput.style.display = 'none';
                } else {
                    ticketIdsInput.style.display = 'none';
                    jsonInput.style.display = 'block';
                }
            }

            // Fast ticket counting function
            const updateTicketCount = () => {
                const text = manualTextarea.value;
                if (!text.trim()) {
                    ticketCountValue.textContent = '0';
                    ticketCountValue.style.color = 'var(--rumi-text-secondary)';
                    return;
                }

                // Quick parse: split by comma and count valid ticket IDs
                const validCount = text
                    .split(',')
                    .map(id => id.trim())
                    .filter(id => id.length > 0 && /^\d+$/.test(id))
                    .length;

                ticketCountValue.textContent = validCount.toString();
                ticketCountValue.style.color = validCount > 0 ? 'var(--rumi-accent-blue)' : 'var(--rumi-accent-red)';
            };

            // JSON validation function
            const validateJsonInput = () => {
                const jsonText = jsonTextarea.value.trim();
                if (!jsonText) {
                    jsonStatusText.textContent = 'Waiting for JSON input...';
                    jsonStatusText.style.color = 'var(--rumi-text-secondary)';
                    return false;
                }

                try {
                    const data = JSON.parse(jsonText);
                    if (!data.comments || !Array.isArray(data.comments)) {
                        jsonStatusText.textContent = 'Invalid JSON: Missing or invalid "comments" array';
                        jsonStatusText.style.color = 'var(--rumi-accent-red)';
                        return false;
                    }

                    jsonStatusText.textContent = `Valid JSON: ${data.comments.length} comments found`;
                    jsonStatusText.style.color = 'var(--rumi-accent-green)';
                    return true;
                } catch (error) {
                    jsonStatusText.textContent = `Invalid JSON: ${error.message}`;
                    jsonStatusText.style.color = 'var(--rumi-accent-red)';
                    return false;
                }
            };

            // Update counter on every keystroke (input event)
            manualTextarea.addEventListener('input', updateTicketCount);
            jsonTextarea.addEventListener('input', validateJsonInput);

            // Also update on paste
            manualTextarea.addEventListener('paste', () => {
                // Small delay to let paste complete
                setTimeout(updateTicketCount, 10);
            });

            jsonTextarea.addEventListener('paste', () => {
                // Small delay to let paste complete
                setTimeout(validateJsonInput, 10);
            });

            // Manual processing
            document.getElementById('rumi-manual-process').onclick = async () => {
                const btn = document.getElementById('rumi-manual-process');
                const textarea = document.getElementById('rumi-manual-ids');
                const jsonTextarea = document.getElementById('rumi-manual-json');
                const progressDiv = document.getElementById('rumi-manual-progress');

                // Check if we're currently processing (button shows "Stop Processing")
                if (btn.textContent.includes('Stop')) {
                    // Cancel the processing
                    RUMIMonitor.manualProcessingCancelled = true;
                    btn.textContent = 'Stopping...';
                    btn.disabled = true;
                    this.showToast('Stopping manual processing...', 'warning');
                    return;
                }

                // Determine input mode
                const inputMode = document.querySelector('input[name="manual-input-mode"]:checked').value;
                console.log('[RUMI DEBUG] Input mode detected:', inputMode);

                // Safety check: if inputMode is not valid, default to ticket-ids
                const validInputMode = inputMode === 'json' ? 'json' : 'ticket-ids';
                if (validInputMode !== inputMode) {
                    console.log('[RUMI DEBUG] Invalid input mode detected, defaulting to ticket-ids');
                }

                let ticketIds, parsedIds;

                if (validInputMode === 'ticket-ids') {
                    ticketIds = textarea.value;
                    if (!ticketIds.trim()) {
                        this.showToast('Please enter ticket IDs', 'warning');
                        return;
                    }

                    // Parse ticket IDs first to get the count
                    parsedIds = ticketIds
                        .split(',')
                        .map(id => id.trim())
                        .filter(id => id.length > 0 && /^\d+$/.test(id));

                    if (parsedIds.length === 0) {
                        this.showToast('No valid ticket IDs found', 'warning');
                        return;
                    }
                } else {
                    // JSON input mode
                    const jsonText = jsonTextarea.value.trim();
                    if (!jsonText) {
                        this.showToast('Please enter JSON data', 'warning');
                        return;
                    }

                    if (!validateJsonInput()) {
                        this.showToast('Invalid JSON data', 'warning');
                        return;
                    }

                    try {
                        const jsonData = JSON.parse(jsonText);
                        // For JSON input, we'll process it as a single "ticket" with the provided comments
                        parsedIds = ['json-input'];
                    } catch (error) {
                        this.showToast('Invalid JSON data: ' + error.message, 'warning');
                        return;
                    }
                }

                btn.disabled = false; // Keep enabled so user can stop
                btn.textContent = 'Stop Processing';
                btn.classList.remove('rumi-btn-primary');
                btn.classList.add('rumi-btn-secondary');

                // Show progress indicator with correct total from the start
                progressDiv.style.display = 'block';
                progressDiv.textContent = `Processing 0/${parsedIds.length} tickets...`;

                try {
                    let lastUpdateTime = 0;
                    const UPDATE_THROTTLE_MS = 500; // Update UI max once per 500ms for maximum performance

                    // Progress callback with aggressive throttling to minimize UI update overhead
                    const progressCallback = (current, total) => {
                        // Always update the progress text (very cheap operation)
                        progressDiv.textContent = `Processing ${current}/${total} tickets...`;

                        const now = Date.now();
                        // Only do expensive table/counter updates if 500ms has passed or it's the last ticket
                        if (now - lastUpdateTime > UPDATE_THROTTLE_MS || current === total) {
                            lastUpdateTime = now;
                            this.updateManualCounters();
                            this.updateManualProcessedTicketsDisplay();
                        }
                    };

                    let result;
                    if (validInputMode === 'json') {
                        console.log('[RUMI DEBUG] Processing as JSON input');
                        // JSON input always runs in dry run mode for safety
                        const originalDryRun = RUMIProcessor.isDryRun;
                        RUMIProcessor.isDryRun = true;

                        try {
                            result = await this.processJsonInput(jsonTextarea.value, progressCallback);
                        } finally {
                            // Restore original dry run state
                            RUMIProcessor.isDryRun = originalDryRun;
                        }
                    } else {
                        console.log('[RUMI DEBUG] Processing as ticket IDs:', ticketIds);
                        // Process ticket IDs normally
                        result = await RUMIMonitor.manualProcess(ticketIds, progressCallback);
                    }

                    // Final UI update
                    this.updateManualCounters();
                    this.updateManualProcessedTicketsDisplay();

                    const manualDryRun = RUMIStorage.getManualProcessingSettings().dryRunMode;
                    const mode = (validInputMode === 'json' || manualDryRun) ? 'MANUAL DRY RUN' : 'MANUAL LIVE';

                    if (result.cancelled) {
                        this.showToast(`[${mode}] Processing stopped - Processed ${result.processed} tickets, ${result.actioned} actions taken`, 'warning');
                    } else {
                        this.showToast(`[${mode}] Processed ${result.processed} tickets, ${result.actioned} actions taken`, 'success');
                        // Only clear input on complete success (not on cancellation)
                        if (validInputMode === 'ticket-ids') {
                            textarea.value = '';
                            document.getElementById('rumi-ticket-count-value').textContent = '0';
                            document.getElementById('rumi-ticket-count-value').style.color = 'var(--rumi-text-secondary)';
                        } else {
                            jsonTextarea.value = '';
                            document.getElementById('rumi-json-status-text').textContent = 'Waiting for JSON input...';
                            document.getElementById('rumi-json-status-text').style.color = 'var(--rumi-text-secondary)';
                        }
                    }
                } catch (error) {
                    this.showToast('Manual processing failed: ' + error.message, 'error');
                } finally {
                    btn.disabled = false;
                    btn.textContent = 'Process Tickets';
                    btn.classList.remove('rumi-btn-secondary');
                    btn.classList.add('rumi-btn-primary');
                    // Hide progress indicator
                    setTimeout(() => {
                        progressDiv.style.display = 'none';
                    }, 2000);
                }
            };

            // Clear data (Automatic)
            document.getElementById('rumi-reset-counters').onclick = () => {
                if (confirm('Clear all automatic processing data including counters and processed tickets history from storage?')) {
                    RUMIStorage.resetProcessingStats();
                    RUMIStorage.clearProcessedTickets();
                    RUMIProcessor.clearCachedUserId();
                    this.updateCounters();
                    this.updateProcessedTicketsDisplay();
                    RUMILogger.info('UI', 'Automatic processing data cleared from storage');
                    this.showToast('Automatic processing data cleared', 'success');
                }
            };

            // Manual dry run toggle
            document.getElementById('rumi-manual-dry-run').onchange = (e) => {
                const isDryRun = e.target.checked;
                const settings = RUMIStorage.getManualProcessingSettings();
                settings.dryRunMode = isDryRun;
                RUMIStorage.setManualProcessingSettings(settings);

                const mode = isDryRun ? 'enabled' : 'disabled';
                this.showToast(`Manual dry run mode ${mode}`, isDryRun ? 'warning' : 'info');
                RUMILogger.info('UI', `Manual dry run mode ${mode}`, { isDryRun });

                if (!isDryRun) {
                    if (!confirm('⚠ WARNING ⚠\n\nYou are about to DISABLE manual dry run mode.\n\nThis means manually processed tickets WILL BE MODIFIED in Zendesk.\n\nAre you absolutely sure?')) {
                        e.target.checked = true;
                        settings.dryRunMode = true;
                        RUMIStorage.setManualProcessingSettings(settings);
                        this.showToast('Manual dry run mode remains enabled', 'info');
                    }
                }
            };

            // Clear data (Manual)
            document.getElementById('rumi-reset-manual-counters').onclick = () => {
                if (confirm('Clear all manual processing data including counters and processed tickets history from storage?')) {
                    RUMIStorage.resetManualProcessingStats();
                    RUMIStorage.clearManualProcessedTickets();
                    RUMIProcessor.clearCachedUserId();
                    this.updateManualCounters();
                    this.updateManualProcessedTicketsDisplay();
                    RUMILogger.info('UI', 'Manual processing data cleared from storage');
                    this.showToast('Manual processing data cleared', 'success');
                }
            };

            // Export Button Dropdowns
            this.setupExportDropdowns();

            // Pinned Tickets Controls
            document.getElementById('rumi-add-pin').onclick = async () => {
                const ticketIdInput = document.getElementById('rumi-pin-ticket-id');
                const ticketId = ticketIdInput.value.trim();
                const pinTypeRadio = document.querySelector('input[name="rumi-pin-type"]:checked');
                const pinType = pinTypeRadio ? pinTypeRadio.value : 'blocked';

                if (await RUMIPinManager.addPin(ticketId, pinType)) {
                    ticketIdInput.value = ''; // Clear input on success
                }
            };

            // Enter key support for adding pins
            document.getElementById('rumi-pin-ticket-id').onkeypress = async (e) => {
                if (e.key === 'Enter') {
                    document.getElementById('rumi-add-pin').click();
                }
            };

            // Event delegation for pinned list remove buttons
            document.getElementById('rumi-pinned-list').onclick = (e) => {
                if (e.target.classList.contains('rumi-pinned-item-remove')) {
                    const ticketId = e.target.dataset.ticketId;
                    const pinType = e.target.dataset.pinType;
                    if (ticketId && pinType) {
                        RUMIPinManager.removePin(ticketId, pinType);
                    }
                }
            };

            // Top-level tab switching (Automatic / Manual / Logs)
            document.querySelectorAll('.rumi-tab-btn[data-main-tab]').forEach(btn => {
                btn.onclick = () => this.switchMainTab(btn.dataset.mainTab);
            });

            // Automatic processing sub-tabs switching
            document.querySelectorAll('.rumi-tab-btn[data-auto-tab]').forEach(btn => {
                btn.onclick = () => this.switchAutoTab(btn.dataset.autoTab);
            });

            // Manual processing sub-tabs switching
            document.querySelectorAll('.rumi-tab-btn[data-manual-tab]').forEach(btn => {
                btn.onclick = () => this.switchManualTab(btn.dataset.manualTab);
            });

            // Log controls
            document.getElementById('rumi-log-filter').onchange = () => {
                this.renderLogs();
            };

            document.getElementById('rumi-download-logs').onclick = () => {
                this.downloadAllLogs();
            };

            document.getElementById('rumi-clear-logs').onclick = () => {
                if (confirm('Clear all logs from storage? This cannot be undone.')) {
                    RUMIStorage.remove('logs');
                    this.lastRenderedLogTimestamp = null; // Reset tracking
                    document.getElementById('rumi-logs-container').innerHTML = ''; // Clear UI
                    this.renderLogs();
                    RUMILogger.info('UI', 'Logs cleared from storage by user');
                }
            };
        }

        static async loadViews() {
            try {
                const container = document.getElementById('rumi-views-list');
                container.innerHTML = '<div class="rumi-loading">Loading views...</div>';

                const data = await RUMIAPIManager.get('/api/v2/views.json');
                const allViews = data.views || [];

                // Zendesk returns all views for this agent, but we only care about SSOC views
                const targetViews = allViews.filter(view =>
                    TARGET_VIEWS.includes(view.title)
                );

                if (targetViews.length === 0) {
                    container.innerHTML = '<div class="rumi-error-message">No target views found. Please ensure you have access to SSOC views.</div>';
                    RUMILogger.warn('UI', 'No target views found in Zendesk');
                    return;
                }

                targetViews.forEach(view => {
                    this.viewsMap.set(view.title, view.id);
                    this.viewIdToNameMap.set(String(view.id), view.title);
                });

                // Also populate the manual processing view buttons
                this.populateViewProcessButtons(targetViews);

                // Preserve the order defined in TARGET_VIEWS for consistency
                const sortedViews = TARGET_VIEWS
                    .map(title => targetViews.find(v => v.title === title))
                    .filter(Boolean);

                container.innerHTML = sortedViews.map(view => {
                    const escapedTitle = this.escapeHtml(view.title);
                    return `
                        <label class="rumi-view-checkbox">
                            <input type="checkbox" data-view-id="${view.id}" aria-label="Select ${escapedTitle}">
                            <span>${escapedTitle}</span>
                        </label>
                    `;
                }).join('');

                // Attach event listeners to checkboxes (proper way, not inline handlers)
                const checkboxes = container.querySelectorAll('input[type="checkbox"]');
                checkboxes.forEach(checkbox => {
                    checkbox.addEventListener('change', () => {
                        this.saveSelectedViews();
                    });
                });

                // Restore previously selected views
                const selectedViews = RUMIStorage.getSelectedViews();
                RUMILogger.info('UI', 'Restoring selected views from storage', {
                    selectedViews,
                    selectedCount: selectedViews.length,
                    availableViews: sortedViews.map(v => v.id)
                });

                let restoredCount = 0;
                selectedViews.forEach(viewId => {
                    const checkbox = container.querySelector(`input[data-view-id="${viewId}"]`);
                    if (checkbox) {
                        checkbox.checked = true;
                        restoredCount++;
                        RUMILogger.debug('UI', `✓ Restored checkbox for view ${viewId}`);
                    } else {
                        RUMILogger.warn('UI', `✗ Could not find checkbox for view ${viewId}`);
                    }
                });

                RUMILogger.info('UI', 'Loaded views successfully', {
                    totalViews: sortedViews.length,
                    selectedCount: selectedViews.length,
                    restoredCount: restoredCount,
                    eventListenersAttached: checkboxes.length
                });

            } catch (error) {
                RUMILogger.error('UI', 'Failed to load views', { error: error.message });
                const container = document.getElementById('rumi-views-list');
                container.innerHTML = '<div class="rumi-error-message">Failed to load views. Check console for details.</div>';
            }
        }

        static saveSelectedViews() {
            console.log('[RUMI DEBUG] saveSelectedViews() called');

            const checkboxes = document.querySelectorAll('.rumi-view-checkbox input');
            console.log('[RUMI DEBUG] Found checkboxes:', checkboxes.length);

            const selected = Array.from(checkboxes)
                .filter(cb => cb.checked)
                .map(cb => String(cb.getAttribute('data-view-id'))); // Ensure strings

            console.log('[RUMI DEBUG] Selected view IDs:', selected);

            RUMIStorage.setSelectedViews(selected);

            // Verify it was saved by reading it back
            const verification = RUMIStorage.getSelectedViews();
            console.log('[RUMI DEBUG] Verification read back:', verification);

            RUMILogger.info('UI', 'Saved selected views', {
                count: selected.length,
                viewIds: selected,
                totalCheckboxes: checkboxes.length,
                verifiedSaved: verification
            });
        }

        static populateViewProcessButtons(targetViews) {
            // Populate the manual processing view buttons
            const container = document.getElementById('rumi-view-buttons-container');

            // Preserve the order defined in TARGET_VIEWS for consistency
            const sortedViews = TARGET_VIEWS
                .map(title => targetViews.find(v => v.title === title))
                .filter(Boolean);

            container.innerHTML = sortedViews.map(view => {
                const escapedTitle = this.escapeHtml(view.title);
                return `<button class="rumi-view-process-btn" data-view-id="${view.id}" data-view-name="${escapedTitle}">
                    ${escapedTitle}
                </button>`;
            }).join('');

            // Attach event listeners to view process buttons
            const buttons = container.querySelectorAll('.rumi-view-process-btn');
            buttons.forEach(button => {
                button.addEventListener('click', async () => {
                    const viewId = button.dataset.viewId;
                    const viewName = button.dataset.viewName;
                    await this.handleViewProcess(viewId, viewName, button);
                });
            });

            RUMILogger.info('UI', 'Populated view process buttons', { count: buttons.length });
        }

        static async handleViewProcess(viewId, viewName, button) {
            // Handle processing a specific view
            const progressDiv = document.getElementById('rumi-manual-progress');

            // Disable all view buttons during processing
            const allButtons = document.querySelectorAll('.rumi-view-process-btn');
            allButtons.forEach(btn => btn.disabled = true);

            const originalText = button.textContent;
            button.textContent = 'Processing...';

            // Show progress indicator
            progressDiv.style.display = 'block';
            progressDiv.textContent = `Fetching tickets from "${viewName}"...`;

            try {
                let lastUpdateTime = 0;
                const UPDATE_THROTTLE_MS = 500; // Update UI max once per 500ms

                // Progress callback with throttling
                const progressCallback = (progress) => {
                    if (progress.phase === 'fetching') {
                        const pageInfo = progress.page ? ` (page ${progress.page})` : '';
                        progressDiv.textContent = `Fetching tickets from "${viewName}"${pageInfo}... (${progress.current} tickets so far)`;
                    } else if (progress.phase === 'processing') {
                        progressDiv.textContent = `Processing ${progress.current}/${progress.total} tickets from "${viewName}"...`;

                        const now = Date.now();
                        // Only do expensive table/counter updates if 500ms has passed or it's the last ticket
                        if (now - lastUpdateTime > UPDATE_THROTTLE_MS || progress.current === progress.total) {
                            lastUpdateTime = now;
                            this.updateManualCounters();
                            this.updateManualProcessedTicketsDisplay();
                        }
                    }
                };

                const result = await RUMIMonitor.processView(viewId, viewName, progressCallback);

                // Final UI update
                this.updateManualCounters();
                this.updateManualProcessedTicketsDisplay();

                const manualDryRun = RUMIStorage.getManualProcessingSettings().dryRunMode;
                const mode = manualDryRun ? 'MANUAL DRY RUN' : 'MANUAL LIVE';
                this.showToast(`[${mode}] View "${viewName}": Fetched ${result.fetched} tickets, Processed ${result.processed}, ${result.actioned} actions taken`, 'success');

            } catch (error) {
                this.showToast(`Failed to process view "${viewName}": ${error.message}`, 'error');
                RUMILogger.error('UI', `Failed to process view "${viewName}"`, { viewId, viewName, error: error.message });
            } finally {
                // Re-enable all view buttons
                allButtons.forEach(btn => {
                    btn.disabled = false;
                    if (btn === button) {
                        btn.textContent = originalText;
                    }
                });

                // Hide progress indicator after a delay
                setTimeout(() => {
                    progressDiv.style.display = 'none';
                }, 2000);
            }
        }

        static updateConnectionStatus(status) {
            const dot = document.getElementById('rumi-status-dot');
            const text = document.getElementById('rumi-status-text');
            const monitorStatus = document.getElementById('rumi-monitor-status');

            if (status === 'monitoring') {
                dot.classList.add('rumi-monitoring');
                text.textContent = 'Monitoring';
                const viewCount = RUMIStorage.getSelectedViews().length;
                monitorStatus.textContent = `Monitoring ${viewCount} view${viewCount !== 1 ? 's' : ''}`;
            } else {
                dot.classList.remove('rumi-monitoring');
                text.textContent = 'Offline';
                monitorStatus.textContent = 'Not monitoring';
            }
        }

        static updateLastRunTime() {
            const now = new Date().toLocaleString();
            const lastRunEl = document.getElementById('rumi-last-run');
            lastRunEl.textContent = `Last run: ${now}`;
        }

        static updateCounters() {
            const stats = RUMIStorage.getProcessingStats();
            document.getElementById('rumi-counter-total').textContent = stats.totalProcessed;
            document.getElementById('rumi-counter-pending').textContent = stats.pending;
            document.getElementById('rumi-counter-solved').textContent = stats.solved;
            document.getElementById('rumi-counter-care').textContent = stats.care;
            document.getElementById('rumi-counter-hala').textContent = stats.hala;
            document.getElementById('rumi-counter-casablanca').textContent = stats.casablanca;

            // Update tab counts
            const tickets = RUMIStorage.getProcessedTickets();
            const counts = {
                all: tickets.length,
                pending: tickets.filter(t => t.action === 'pending').length,
                solved: tickets.filter(t => t.action === 'solved').length,
                care: tickets.filter(t => t.action === 'care').length,
                hala: tickets.filter(t => t.action === 'hala').length,
                casablanca: tickets.filter(t => t.action === 'casablanca').length
            };

            document.querySelector('[data-auto-tab="all"]').textContent = `All Processed (${counts.all})`;
            document.querySelector('[data-auto-tab="pending"]').textContent = `Pending (${counts.pending})`;
            document.querySelector('[data-auto-tab="solved"]').textContent = `Solved (${counts.solved})`;
            document.querySelector('[data-auto-tab="care"]').textContent = `Care (${counts.care})`;
            document.querySelector('[data-auto-tab="hala"]').textContent = `Hala/RTA (${counts.hala})`;
            document.querySelector('[data-auto-tab="casablanca"]').textContent = `Casablanca (${counts.casablanca})`;
        }

        static updateManualCounters() {
            const stats = RUMIStorage.getManualProcessingStats();
            document.getElementById('rumi-manual-counter-total').textContent = stats.totalProcessed;
            document.getElementById('rumi-manual-counter-pending').textContent = stats.pending;
            document.getElementById('rumi-manual-counter-solved').textContent = stats.solved;
            document.getElementById('rumi-manual-counter-care').textContent = stats.care;
            document.getElementById('rumi-manual-counter-hala').textContent = stats.hala;
            document.getElementById('rumi-manual-counter-casablanca').textContent = stats.casablanca;

            // Update manual tab counts
            const tickets = RUMIStorage.getManualProcessedTickets();
            const counts = {
                all: tickets.length,
                pending: tickets.filter(t => t.action === 'pending').length,
                solved: tickets.filter(t => t.action === 'solved').length,
                care: tickets.filter(t => t.action === 'care').length,
                hala: tickets.filter(t => t.action === 'hala').length,
                casablanca: tickets.filter(t => t.action === 'casablanca').length,
                unprocessed: tickets.filter(t => t.action === 'none').length
            };

            document.querySelector('[data-manual-tab="manual-all"]').textContent = `All (${counts.all})`;
            document.querySelector('[data-manual-tab="manual-pending"]').textContent = `Pending (${counts.pending})`;
            document.querySelector('[data-manual-tab="manual-solved"]').textContent = `Solved (${counts.solved})`;
            document.querySelector('[data-manual-tab="manual-care"]').textContent = `Care (${counts.care})`;
            document.querySelector('[data-manual-tab="manual-hala"]').textContent = `Hala/RTA (${counts.hala})`;
            document.querySelector('[data-manual-tab="manual-casablanca"]').textContent = `Casablanca (${counts.casablanca})`;
            document.querySelector('[data-manual-tab="manual-unprocessed"]').textContent = `Unprocessed (${counts.unprocessed})`;
        }

        static async processJsonInput(jsonText, progressCallback) {
            console.log('[RUMI DEBUG] processJsonInput called with:', jsonText.substring(0, 100) + '...');
            try {
                const jsonData = JSON.parse(jsonText);
                const comments = jsonData.comments || [];

                if (comments.length === 0) {
                    return { processed: 0, actioned: 0, cancelled: false };
                }

                // Create a mock ticket object for processing
                const mockTicket = {
                    id: 'json-input',
                    subject: 'JSON Input',
                    status: 'open',
                    group_id: null,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                };

                // Ensure dry run mode is enabled for JSON processing
                const originalDryRun = RUMIProcessor.isDryRun;
                RUMIProcessor.isDryRun = true;

                try {
                    // Process the comments with the mock ticket
                    const result = await RUMIProcessor.processTicketWithData(
                        mockTicket.id,
                        mockTicket,
                        comments,
                        'Manual JSON',
                        true  // isManual flag
                    );

                    // Update progress
                    if (progressCallback) {
                        progressCallback(1, 1);
                    }

                    return {
                        processed: 1,
                        actioned: result.action !== 'none' && result.action !== 'skipped' ? 1 : 0,
                        cancelled: false
                    };
                } finally {
                    // Restore original dry run state
                    RUMIProcessor.isDryRun = originalDryRun;
                }

            } catch (error) {
                console.error('JSON processing error:', error);
                throw new Error('Failed to process JSON input: ' + error.message);
            }
        }

        static switchMainTab(tabName) {
            console.log('[RUMI DEBUG] switchMainTab called with:', tabName);

            // Update main tab buttons
            document.querySelectorAll('.rumi-tab-btn[data-main-tab]').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.mainTab === tabName);
            });

            // Hide all main tab panels
            document.querySelectorAll('.rumi-main-tab-panel').forEach(panel => {
                panel.style.display = 'none';
                panel.style.visibility = 'hidden';
            });

            // Show the selected main tab panel
            const selectedPanel = document.getElementById(`rumi-main-${tabName}`);
            console.log('[RUMI DEBUG] selectedPanel:', selectedPanel);

            if (selectedPanel) {
                selectedPanel.style.display = 'flex';
                selectedPanel.style.visibility = 'visible';
                selectedPanel.style.flex = '1';
                selectedPanel.style.overflow = 'hidden';

                console.log('[RUMI DEBUG] Panel display set to flex, visibility visible');
            } else {
                console.error('[RUMI DEBUG] Panel not found for tab:', tabName);
            }

            // Render appropriate content
            if (tabName === 'logs') {
                this.renderLogs();
            } else if (tabName === 'manual') {
                // Load manual counters and tickets when switching to manual tab
                this.updateManualCounters();
                this.updateManualProcessedTicketsDisplay();
            } else if (tabName === 'automatic') {
                // Refresh automatic data when switching
                this.updateCounters();
                this.updateProcessedTicketsDisplay();
            } else if (tabName === 'settings') {
                // Render settings tab when switching to it (show category view)
                this.renderSettingsTab();
            }
        }

        static switchAutoTab(tabName) {
            // Track current active tab
            this.currentAutoTab = tabName;

            // Update automatic tab buttons
            document.querySelectorAll('.rumi-tab-btn[data-auto-tab]').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.autoTab === tabName);
            });

            // Update automatic tab panels
            document.querySelectorAll('#rumi-tab-all, #rumi-tab-pending, #rumi-tab-solved, #rumi-tab-care, #rumi-tab-hala, #rumi-tab-casablanca').forEach(panel => {
                panel.classList.toggle('active', panel.id === `rumi-tab-${tabName}`);
            });

            // Render only the active tab
            this.renderActiveAutoTab();
        }

        static switchManualTab(tabName) {
            // Track current active tab
            this.currentManualTab = tabName;

            // Update manual tab buttons
            document.querySelectorAll('.rumi-tab-btn[data-manual-tab]').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.manualTab === tabName);
            });

            const panelId = `rumi-${tabName.replace('manual-', 'manual-tab-')}`;
            document.querySelectorAll('#rumi-manual-tab-all, #rumi-manual-tab-pending, #rumi-manual-tab-solved, #rumi-manual-tab-care, #rumi-manual-tab-hala, #rumi-manual-tab-casablanca, #rumi-manual-tab-unprocessed').forEach(panel => {
                panel.classList.toggle('active', panel.id === panelId);
            });

            // Render only the active tab
            this.renderActiveManualTab();
        }

        static async updateProcessedTicketsDisplay() {
            // Update counters
            this.updateCounters();

            // Only render the currently active tab (memory optimization)
            await this.renderActiveAutoTab();

            // Note: Don't call setupAllTableFiltersAndSorting() here as it destroys and recreates
            // filter inputs, causing loss of focus. Filters are set up once during initialization.
        }

        static async renderActiveAutoTab() {
            // Get all tickets and filter based on active tab
            const tickets = RUMIStorage.getProcessedTickets();
            const tabName = this.currentAutoTab;

            let filteredTickets;
            switch(tabName) {
                case 'pending':
                    filteredTickets = tickets.filter(t => t.action === 'pending');
                    break;
                case 'solved':
                    filteredTickets = tickets.filter(t => t.action === 'solved');
                    break;
                case 'care':
                    filteredTickets = tickets.filter(t => t.action === 'care');
                    break;
                case 'hala':
                    filteredTickets = tickets.filter(t => t.action === 'hala');
                    break;
                case 'casablanca':
                    filteredTickets = tickets.filter(t => t.action === 'casablanca');
                    break;
                default: // 'all'
                    filteredTickets = tickets;
            }

            await this.renderTicketsTable(tabName, filteredTickets);
        }

        static async updateManualProcessedTicketsDisplay() {
            // Update counters
            this.updateManualCounters();

            // Only render the currently active tab (memory optimization)
            await this.renderActiveManualTab();

            // Note: Don't call setupAllTableFiltersAndSorting() here as it destroys and recreates
            // filter inputs, causing loss of focus. Filters are set up once during initialization.
        }

        static async renderActiveManualTab() {
            // Get all tickets and filter based on active tab
            const tickets = RUMIStorage.getManualProcessedTickets();
            const tabName = this.currentManualTab;

            let filteredTickets;
            switch(tabName) {
                case 'manual-pending':
                    filteredTickets = tickets.filter(t => t.action === 'pending');
                    break;
                case 'manual-solved':
                    filteredTickets = tickets.filter(t => t.action === 'solved');
                    break;
                case 'manual-care':
                    filteredTickets = tickets.filter(t => t.action === 'care');
                    break;
                case 'manual-hala':
                    filteredTickets = tickets.filter(t => t.action === 'hala');
                    break;
                case 'manual-casablanca':
                    filteredTickets = tickets.filter(t => t.action === 'casablanca');
                    break;
                case 'manual-unprocessed':
                    filteredTickets = tickets.filter(t => t.action === 'none');
                    break;
                default: // 'manual-all'
                    filteredTickets = tickets;
            }

            await this.renderManualTicketsTable(tabName, filteredTickets);
        }

        static filterTickets(tickets, filters, timeFilters, tableType) {
            let filtered = tickets;

            // Apply regular filters
            if (filters && Object.keys(filters).length > 0) {
                filtered = filtered.filter(ticket => {
                    for (const [column, filterValue] of Object.entries(filters)) {
                        if (!filterValue) continue;

                        const filterLower = filterValue.toLowerCase();
                        let cellValue = '';

                        switch (column) {
                            case 'ticketId':
                                cellValue = String(ticket.ticketId);
                                break;
                            case 'subject':
                                cellValue = String(ticket.subject || '');
                                break;
                            case 'viewName':
                                cellValue = String(ticket.viewName || '');
                                break;
                            case 'action':
                                cellValue = String(ticket.action || '');
                                break;
                            case 'trigger':
                                cellValue = String(ticket.trigger || '');
                                break;
                            case 'previousStatus':
                                cellValue = String(ticket.previousStatus || '');
                                break;
                            case 'newStatus':
                                cellValue = String(ticket.newStatus || '');
                                break;
                            case 'previousGroupName':
                                cellValue = String(ticket.previousGroupName || '');
                                break;
                            case 'newGroupName':
                                cellValue = String(ticket.newGroupName || '');
                                break;
                            case 'dryRun':
                                cellValue = ticket.dryRun ? 'yes' : 'no';
                                break;
                            case 'alreadyCorrect':
                                cellValue = ticket.alreadyCorrect ? 'yes' : 'no';
                                break;
                        }

                        if (!cellValue.toLowerCase().includes(filterLower)) {
                            return false;
                        }
                    }
                    return true;
                });
            }

            // Apply time filters
            if (timeFilters && timeFilters[tableType]) {
                const timeFilter = timeFilters[tableType];
                if (timeFilter.time) {
                    filtered = filtered.filter(ticket => {
                        const ticketDate = new Date(ticket.timestamp);
                        const ticketTime = ticketDate.getHours() * 60 + ticketDate.getMinutes();

                        const [hours, minutes] = timeFilter.time.split(':').map(Number);
                        const filterTime = hours * 60 + minutes;

                        switch (timeFilter.operator) {
                            case 'at':
                                return ticketTime === filterTime;
                            case 'before':
                                return ticketTime <= filterTime;
                            case 'after':
                                return ticketTime >= filterTime;
                            default:
                                return true;
                        }
                    });
                }
            }

            return filtered;
        }

        static sortTickets(tickets, column, direction) {
            if (!column || !direction) {
                return tickets;
            }

            return [...tickets].sort((a, b) => {
                let aVal = '';
                let bVal = '';

                switch (column) {
                    case 'ticketId':
                        aVal = Number(a.ticketId);
                        bVal = Number(b.ticketId);
                        break;
                    case 'subject':
                        aVal = String(a.subject || '').toLowerCase();
                        bVal = String(b.subject || '').toLowerCase();
                        break;
                    case 'viewName':
                        aVal = String(a.viewName || '').toLowerCase();
                        bVal = String(b.viewName || '').toLowerCase();
                        break;
                    case 'action':
                        aVal = String(a.action || '').toLowerCase();
                        bVal = String(b.action || '').toLowerCase();
                        break;
                    case 'trigger':
                        aVal = String(a.trigger || '').toLowerCase();
                        bVal = String(b.trigger || '').toLowerCase();
                        break;
                    case 'previousStatus':
                        aVal = String(a.previousStatus || '').toLowerCase();
                        bVal = String(b.previousStatus || '').toLowerCase();
                        break;
                    case 'newStatus':
                        aVal = String(a.newStatus || '').toLowerCase();
                        bVal = String(b.newStatus || '').toLowerCase();
                        break;
                    case 'previousGroupName':
                        aVal = String(a.previousGroupName || '').toLowerCase();
                        bVal = String(b.previousGroupName || '').toLowerCase();
                        break;
                    case 'newGroupName':
                        aVal = String(a.newGroupName || '').toLowerCase();
                        bVal = String(b.newGroupName || '').toLowerCase();
                        break;
                    case 'timestamp':
                        aVal = new Date(a.timestamp).getTime();
                        bVal = new Date(b.timestamp).getTime();
                        break;
                    case 'dryRun':
                        aVal = a.dryRun ? 1 : 0;
                        bVal = b.dryRun ? 1 : 0;
                        break;
                    case 'alreadyCorrect':
                        aVal = a.alreadyCorrect ? 1 : 0;
                        bVal = b.alreadyCorrect ? 1 : 0;
                        break;
                    default:
                        return 0;
                }

                if (typeof aVal === 'number' && typeof bVal === 'number') {
                    return direction === 'asc' ? aVal - bVal : bVal - aVal;
                } else {
                    if (aVal < bVal) return direction === 'asc' ? -1 : 1;
                    if (aVal > bVal) return direction === 'asc' ? 1 : -1;
                    return 0;
                }
            });
        }

        static async renderTicketsTable(type, tickets) {
            const tbody = document.getElementById(`rumi-table-${type}`);

            if (tickets.length === 0) {
                tbody.innerHTML = '<tr><td colspan="13" class="rumi-empty-state"><div class="rumi-empty-state-icon"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--rumi-text-secondary);"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg></div><div class="rumi-empty-state-text">No processed tickets yet</div></td></tr>';
                return;
            }

            // Apply filters (including time filters)
            const filteredTickets = this.filterTickets(tickets, this.tableFilters.automatic, this.timeFilters, 'automatic');

            // Apply sorting or default to most recent first
            let processedTickets;
            if (this.tableSortState.automatic.column && this.tableSortState.automatic.direction) {
                processedTickets = this.sortTickets(filteredTickets, this.tableSortState.automatic.column, this.tableSortState.automatic.direction);
            } else {
                processedTickets = [...filteredTickets].reverse();
            }

            // Resolve view names for all tickets (handles both IDs and names)
            const ticketsWithResolvedNames = await Promise.all(processedTickets.map(async ticket => {
                // Check if viewName looks like a numeric ID
                const isNumericId = /^\d+$/.test(String(ticket.viewName));
                if (isNumericId) {
                    // Resolve the ID to a name
                    ticket.viewName = await this.getViewName(ticket.viewName);
                }
                return ticket;
            }));

            // All tabs show the same columns
            tbody.innerHTML = ticketsWithResolvedNames.map((ticket, index) => {
                const rowNumber = ticketsWithResolvedNames.length - index; // Last processed is #1
                const actionBadge = `<span class="rumi-badge rumi-badge-${ticket.action}">${ticket.action}</span>`;
                const previousStatusBadge = `<span class="rumi-status-badge rumi-status-badge-${ticket.previousStatus}">${ticket.previousStatus}</span>`;
                const newStatusBadge = `<span class="rumi-status-badge rumi-status-badge-${ticket.newStatus}">${ticket.newStatus}</span>`;
                const dryRunBadge = ticket.dryRun
                    ? '<span class="rumi-badge rumi-badge-yes">YES</span>'
                    : '<span class="rumi-badge rumi-badge-no">NO</span>';

                const updatedBadge = ticket.alreadyCorrect
                    ? '<span class="rumi-badge rumi-badge-no">NO</span>'
                    : '<span class="rumi-badge rumi-badge-yes">YES</span>';

                // Determine row class: blocked pins get red, dry runs get existing styling
                let rowClass = '';
                if (ticket.isBlockedPin) {
                    rowClass = 'rumi-blocked-pin';
                } else if (ticket.dryRun) {
                    rowClass = 'rumi-dry-run';
                }

                return `
                    <tr class="${rowClass}">
                        <td>${rowNumber}</td>
                        <td><a href="/agent/tickets/${ticket.ticketId}" target="_blank">${ticket.ticketId}</a></td>
                        <td style="max-width: 300px; word-wrap: break-word; white-space: normal;">${this.escapeHtml(ticket.subject || 'N/A')}</td>
                        <td>${this.escapeHtml(ticket.viewName)}</td>
                        <td>${actionBadge}</td>
                        <td style="max-width: 250px; word-wrap: break-word; white-space: normal;">${this.escapeHtml(ticket.trigger)}</td>
                        <td>${previousStatusBadge}</td>
                        <td>${newStatusBadge}</td>
                        <td>${this.escapeHtml(ticket.previousGroupName || 'N/A')}</td>
                        <td>${this.escapeHtml(ticket.newGroupName || 'N/A')}</td>
                        <td>${new Date(ticket.timestamp).toLocaleString()}</td>
                        <td>${dryRunBadge}</td>
                        <td>${updatedBadge}</td>
                    </tr>
                `;
            }).join('');

            // Update tab count to reflect filtered results
            this.updateTabCount(type, ticketsWithResolvedNames.length);
        }

        static async renderManualTicketsTable(type, tickets) {
            const tbody = document.getElementById(`rumi-${type === 'manual-all' ? 'manual-table-all' : type.replace('manual-', 'manual-table-')}`);

            if (!tbody) {
                // Table doesn't exist yet, skip rendering
                return;
            }

            if (tickets.length === 0) {
                tbody.innerHTML = '<tr><td colspan="13" class="rumi-empty-state"><div class="rumi-empty-state-icon"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--rumi-text-secondary);"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg></div><div class="rumi-empty-state-text">No manually processed tickets yet</div></td></tr>';
                return;
            }

            // Apply filters (including time filters)
            const filteredTickets = this.filterTickets(tickets, this.tableFilters.manual, this.timeFilters, 'manual');

            // Apply sorting or default to most recent first
            let processedTickets;
            if (this.tableSortState.manual.column && this.tableSortState.manual.direction) {
                processedTickets = this.sortTickets(filteredTickets, this.tableSortState.manual.column, this.tableSortState.manual.direction);
            } else {
                processedTickets = [...filteredTickets].reverse();
            }

            // Resolve view names for all tickets (handles both IDs and names)
            const ticketsWithResolvedNames = await Promise.all(processedTickets.map(async ticket => {
                // Check if viewName looks like a numeric ID
                const isNumericId = /^\d+$/.test(String(ticket.viewName));
                if (isNumericId) {
                    // Resolve the ID to a name
                    ticket.viewName = await this.getViewName(ticket.viewName);
                }
                return ticket;
            }));

            tbody.innerHTML = ticketsWithResolvedNames.map((ticket, index) => {
                const rowNumber = ticketsWithResolvedNames.length - index; // Last processed is #1
                const actionBadge = `<span class="rumi-badge rumi-badge-${ticket.action}">${ticket.action}</span>`;
                const previousStatusBadge = `<span class="rumi-status-badge rumi-status-badge-${ticket.previousStatus}">${ticket.previousStatus}</span>`;
                const newStatusBadge = `<span class="rumi-status-badge rumi-status-badge-${ticket.newStatus}">${ticket.newStatus}</span>`;
                const dryRunBadge = ticket.dryRun
                    ? '<span class="rumi-badge rumi-badge-yes">YES</span>'
                    : '<span class="rumi-badge rumi-badge-no">NO</span>';

                const updatedBadge = ticket.alreadyCorrect
                    ? '<span class="rumi-badge rumi-badge-no">NO</span>'
                    : '<span class="rumi-badge rumi-badge-yes">YES</span>';

                // Determine row class: blocked pins get red, dry runs get existing styling
                let rowClass = '';
                if (ticket.isBlockedPin) {
                    rowClass = 'rumi-blocked-pin';
                } else if (ticket.dryRun) {
                    rowClass = 'rumi-dry-run';
                }

                return `
                    <tr class="${rowClass}">
                        <td>${rowNumber}</td>
                        <td><a href="/agent/tickets/${ticket.ticketId}" target="_blank">${ticket.ticketId}</a></td>
                        <td style="max-width: 300px; word-wrap: break-word; white-space: normal;">${this.escapeHtml(ticket.subject || 'N/A')}</td>
                        <td>${this.escapeHtml(ticket.viewName || 'N/A')}</td>
                        <td>${actionBadge}</td>
                        <td style="max-width: 250px; word-wrap: break-word; white-space: normal;">${this.escapeHtml(ticket.trigger)}</td>
                        <td>${previousStatusBadge}</td>
                        <td>${newStatusBadge}</td>
                        <td>${this.escapeHtml(ticket.previousGroupName || 'N/A')}</td>
                        <td>${this.escapeHtml(ticket.newGroupName || 'N/A')}</td>
                        <td>${new Date(ticket.timestamp).toLocaleString()}</td>
                        <td>${dryRunBadge}</td>
                        <td>${updatedBadge}</td>
                    </tr>
                `;
            }).join('');

            // Update tab count to reflect filtered results
            this.updateManualTabCount(type, ticketsWithResolvedNames.length);
        }

        static updateTabCount(tabType, count) {
            // Update tab label with current filtered count
            const tabButton = document.querySelector(`[data-auto-tab="${tabType}"]`);
            if (tabButton) {
                const tabLabels = {
                    'all': 'All Processed',
                    'pending': 'Pending',
                    'solved': 'Solved',
                    'care': 'Care',
                    'hala': 'Hala/RTA',
                    'casablanca': 'Casablanca'
                };
                tabButton.textContent = `${tabLabels[tabType]} (${count})`;
            }
        }

        static updateManualTabCount(tabType, count) {
            // Update tab label with current filtered count
            const tabButton = document.querySelector(`[data-manual-tab="${tabType}"]`);
            if (tabButton) {
                const tabLabels = {
                    'manual-all': 'All Processed',
                    'manual-pending': 'Pending',
                    'manual-solved': 'Solved',
                    'manual-care': 'Care',
                    'manual-hala': 'Hala/RTA',
                    'manual-casablanca': 'Casablanca',
                    'manual-unprocessed': 'Unprocessed'
                };
                tabButton.textContent = `${tabLabels[tabType]} (${count})`;
            }
        }

        static getUniqueColumnValues(tickets, columnName) {
            const values = new Set();
            tickets.forEach(ticket => {
                let value;
                switch (columnName) {
                    case 'viewName':
                        value = ticket.viewName;
                        break;
                    case 'action':
                        value = ticket.action;
                        break;
                    case 'trigger':
                        value = ticket.trigger;
                        break;
                    case 'previousStatus':
                        value = ticket.previousStatus;
                        break;
                    case 'newStatus':
                        value = ticket.newStatus;
                        break;
                    case 'previousGroupName':
                        value = ticket.previousGroupName || 'N/A';
                        break;
                    case 'newGroupName':
                        value = ticket.newGroupName || 'N/A';
                        break;
                }
                if (value) values.add(value);
            });
            return Array.from(values).sort();
        }

        static createCustomDropdown(options, selectedValue, onChange) {
            const container = document.createElement('div');
            container.classList.add('rumi-custom-select');

            const trigger = document.createElement('div');
            trigger.classList.add('rumi-custom-select-trigger');
            trigger.textContent = selectedValue || options[0] || 'All';

            const arrow = document.createElement('div');
            arrow.classList.add('rumi-custom-select-arrow');
            arrow.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
            trigger.appendChild(arrow);

            const dropdown = document.createElement('div');
            dropdown.classList.add('rumi-custom-select-dropdown');

            options.forEach(option => {
                const optionEl = document.createElement('div');
                optionEl.classList.add('rumi-custom-select-option');
                optionEl.textContent = option;
                optionEl.dataset.value = option;

                if (option === selectedValue) {
                    optionEl.classList.add('selected');
                }

                optionEl.onclick = (e) => {
                    e.stopPropagation();

                    // Update selection
                    dropdown.querySelectorAll('.rumi-custom-select-option').forEach(opt => {
                        opt.classList.remove('selected');
                    });
                    optionEl.classList.add('selected');
                    trigger.childNodes[0].textContent = option;

                    // Close dropdown
                    trigger.classList.remove('active');
                    dropdown.classList.remove('active');

                    // Trigger callback
                    if (onChange) {
                        onChange(option === 'All' ? '' : option);
                    }
                };

                dropdown.appendChild(optionEl);
            });

            trigger.onclick = (e) => {
                e.stopPropagation();

                // Close all other dropdowns
                document.querySelectorAll('.rumi-custom-select-trigger.active').forEach(t => {
                    if (t !== trigger) {
                        t.classList.remove('active');
                        t.nextElementSibling.classList.remove('active');
                    }
                });

                // Toggle this dropdown
                const isOpening = !trigger.classList.contains('active');
                trigger.classList.toggle('active');
                dropdown.classList.toggle('active');

                // Position dropdown using fixed positioning
                if (isOpening) {
                    const rect = trigger.getBoundingClientRect();
                    dropdown.style.top = `${rect.bottom + 4}px`;
                    dropdown.style.left = `${rect.left}px`;
                    dropdown.style.minWidth = `${rect.width}px`;
                }
            };

            container.appendChild(trigger);
            container.appendChild(dropdown);

            return container;
        }

        static closeAllDropdowns() {
            document.querySelectorAll('.rumi-custom-select-trigger.active').forEach(trigger => {
                trigger.classList.remove('active');
                trigger.nextElementSibling.classList.remove('active');
            });
        }

        static setupTableFiltersAndSorting(tableId, tableType, columnMap, allTickets) {
            const table = document.getElementById(tableId)?.closest('.rumi-table');
            if (!table) return;

            const thead = table.querySelector('thead');
            if (!thead) return;

            const headerRow = thead.querySelector('tr:first-child');
            if (!headerRow) return;

            // Add sortable class and click handlers to headers (3-state sorting)
            const headers = headerRow.querySelectorAll('th');
            headers.forEach((th, index) => {
                const columnName = columnMap[index];
                if (!columnName || columnName === 'note' || columnName === 'rowNumber') return;

                th.classList.add('sortable');
                th.style.cursor = 'pointer';
                th.dataset.column = columnName;

                // Remove old listeners by cloning
                const newTh = th.cloneNode(true);
                th.parentNode.replaceChild(newTh, th);

                newTh.onclick = () => {
                    const currentSort = this.tableSortState[tableType];

                    if (currentSort.column === columnName) {
                        // 3-state toggle: asc -> desc -> null
                        if (currentSort.direction === 'asc') {
                            currentSort.direction = 'desc';
                        } else if (currentSort.direction === 'desc') {
                            currentSort.direction = null;
                            currentSort.column = null;
                        }
                    } else {
                        // New column - start with asc
                        currentSort.column = columnName;
                        currentSort.direction = 'asc';
                    }

                    // Update header classes
                    headerRow.querySelectorAll('th').forEach(h => {
                        h.classList.remove('sorted-asc', 'sorted-desc');
                    });

                    if (currentSort.column === columnName && currentSort.direction) {
                        newTh.classList.add(currentSort.direction === 'asc' ? 'sorted-asc' : 'sorted-desc');
                    }

                    // Re-render the table
                    if (tableType === 'automatic') {
                        this.updateProcessedTicketsDisplay();
                    } else {
                        this.updateManualProcessedTicketsDisplay();
                    }
                };
            });

            // Remove existing filter row if present
            const existingFilterRow = thead.querySelector('.rumi-table-filter-row');
            if (existingFilterRow) {
                existingFilterRow.remove();
            }

            // Add filter row
            const filterRow = document.createElement('tr');
            filterRow.classList.add('rumi-table-filter-row');

            headers.forEach((th, index) => {
                const td = document.createElement('td');
                const columnName = columnMap[index];

                if (!columnName || columnName === 'note' || columnName === 'rowNumber') {
                    filterRow.appendChild(td);
                    return;
                }

                // Determine filter type based on column
                if (columnName === 'ticketId' || columnName === 'subject') {
                    // Text input for Ticket ID and Subject
                    const input = document.createElement('input');
                    input.type = 'text';
                    input.classList.add('rumi-table-filter-input');
                    input.classList.add(`rumi-table-filter-input-${columnName}`);
                    input.placeholder = 'Filter...';
                    input.value = this.tableFilters[tableType][columnName] || '';

                    input.oninput = (e) => {
                        const value = e.target.value.trim();
                        if (value) {
                            this.tableFilters[tableType][columnName] = value;
                        } else {
                            delete this.tableFilters[tableType][columnName];
                        }

                        clearTimeout(this.filterTimeout);
                        this.filterTimeout = setTimeout(() => {
                            if (tableType === 'automatic') {
                                this.updateProcessedTicketsDisplay();
                            } else {
                                this.updateManualProcessedTicketsDisplay();
                            }
                        }, 300);
                    };

                    td.appendChild(input);
                } else if (columnName === 'dryRun' || columnName === 'alreadyCorrect') {
                    // Static custom dropdown for Dry Run and Updated?
                    const options = ['All', 'yes', 'no'];
                    const currentValue = this.tableFilters[tableType][columnName] || '';
                    const displayValue = currentValue || 'All';

                    const dropdown = this.createCustomDropdown(options, displayValue, (value) => {
                        if (value) {
                            this.tableFilters[tableType][columnName] = value;
                        } else {
                            delete this.tableFilters[tableType][columnName];
                        }

                        if (tableType === 'automatic') {
                            this.updateProcessedTicketsDisplay();
                        } else {
                            this.updateManualProcessedTicketsDisplay();
                        }
                    });

                    td.appendChild(dropdown);
                } else if (columnName === 'timestamp') {
                    // Time filter with operator
                    const container = document.createElement('div');
                    container.classList.add('rumi-time-filter-container');

                    // Create custom dropdown for operator
                    const operatorOptions = ['=', '≥', '≤'];
                    const operatorMapping = { '=': 'at', '≥': 'after', '≤': 'before' };
                    const reverseMapping = { 'at': '=', 'after': '≥', 'before': '≤' };
                    const currentOperator = this.timeFilters[tableType]?.operator || 'at';
                    const displayOperator = reverseMapping[currentOperator];

                    let selectedOperator = currentOperator;

                    const operatorDropdown = this.createCustomDropdown(operatorOptions, displayOperator, (value) => {
                        selectedOperator = operatorMapping[value];
                        const time = timeInput.value;

                        if (time) {
                            this.timeFilters[tableType] = { operator: selectedOperator, time };

                            clearTimeout(this.filterTimeout);
                            this.filterTimeout = setTimeout(() => {
                                if (tableType === 'automatic') {
                                    this.updateProcessedTicketsDisplay();
                                } else {
                                    this.updateManualProcessedTicketsDisplay();
                                }
                            }, 300);
                        }
                    });

                    operatorDropdown.style.width = '60px';
                    operatorDropdown.style.minWidth = '60px';

                    const timeInput = document.createElement('input');
                    timeInput.type = 'time';
                    timeInput.classList.add('rumi-time-filter-time');

                    // Restore time value
                    if (this.timeFilters[tableType]?.time) {
                        timeInput.value = this.timeFilters[tableType].time;
                    }

                    timeInput.onchange = () => {
                        const time = timeInput.value;

                        if (time) {
                            this.timeFilters[tableType] = { operator: selectedOperator, time };
                        } else {
                            delete this.timeFilters[tableType];
                        }

                        clearTimeout(this.filterTimeout);
                        this.filterTimeout = setTimeout(() => {
                            if (tableType === 'automatic') {
                                this.updateProcessedTicketsDisplay();
                            } else {
                                this.updateManualProcessedTicketsDisplay();
                            }
                        }, 300);
                    };

                    container.appendChild(operatorDropdown);
                    container.appendChild(timeInput);
                    td.appendChild(container);
                } else if (['viewName', 'action', 'trigger', 'previousStatus', 'newStatus', 'previousGroupName', 'newGroupName'].includes(columnName)) {
                    // Dynamic custom dropdown based on existing values
                    const uniqueValues = this.getUniqueColumnValues(allTickets, columnName);
                    const options = ['All', ...uniqueValues];
                    const currentValue = this.tableFilters[tableType][columnName] || '';
                    const displayValue = currentValue || 'All';

                    const dropdown = this.createCustomDropdown(options, displayValue, (value) => {
                        if (value) {
                            this.tableFilters[tableType][columnName] = value;
                        } else {
                            delete this.tableFilters[tableType][columnName];
                        }

                        if (tableType === 'automatic') {
                            this.updateProcessedTicketsDisplay();
                        } else {
                            this.updateManualProcessedTicketsDisplay();
                        }
                    });

                    td.appendChild(dropdown);
                }

                filterRow.appendChild(td);
            });

            thead.appendChild(filterRow);
        }

        static setupAllTableFiltersAndSorting() {
            // Get all tickets for dynamic dropdown generation
            const autoTickets = RUMIStorage.getProcessedTickets();
            const manualTickets = RUMIStorage.getManualProcessedTickets();

            // Automatic processing tables
            const autoColumnMap = {
                0: 'rowNumber', // Row counter (not filterable)
                1: 'ticketId',
                2: 'subject',
                3: 'viewName',
                4: 'action',
                5: 'trigger',
                6: 'previousStatus',
                7: 'newStatus',
                8: 'previousGroupName',
                9: 'newGroupName',
                10: 'timestamp',
                11: 'dryRun',
                12: 'alreadyCorrect'
            };

            ['all', 'pending', 'solved', 'care', 'hala', 'casablanca'].forEach(type => {
                const typeTickets = type === 'all' ? autoTickets : autoTickets.filter(t => t.action === type);
                this.setupTableFiltersAndSorting(`rumi-table-${type}`, 'automatic', autoColumnMap, autoTickets);
            });

            // Manual processing tables
            const manualColumnMap = {
                0: 'rowNumber', // Row counter (not filterable)
                1: 'ticketId',
                2: 'subject',
                3: 'viewName',
                4: 'action',
                5: 'trigger',
                6: 'previousStatus',
                7: 'newStatus',
                8: 'previousGroupName',
                9: 'newGroupName',
                10: 'timestamp',
                11: 'dryRun',
                12: 'alreadyCorrect'
            };

            ['manual-all', 'manual-pending', 'manual-solved', 'manual-care', 'manual-hala', 'manual-casablanca', 'manual-unprocessed'].forEach(type => {
                const tableId = type === 'manual-all' ? 'rumi-manual-table-all' : `rumi-${type.replace('manual-', 'manual-table-')}`;
                this.setupTableFiltersAndSorting(tableId, 'manual', manualColumnMap, manualTickets);
            });
        }

        static truncate(str, maxLength) {
            if (!str) return 'N/A';
            if (str.length <= maxLength) return str;
            return str.substring(0, maxLength) + '...';
        }

        static renderLogs() {
            // Debounce log rendering since logs can update rapidly during monitoring
            if (this.logRenderScheduled) {
                return;
            }

            this.logRenderScheduled = true;
            requestAnimationFrame(() => {
                this.renderLogsImmediate();
                this.logRenderScheduled = false;
            });
        }

        static renderLogsImmediate() {
            const filter = document.getElementById('rumi-log-filter').value;
            const logs = RUMIStorage.getLogs();
            const container = document.getElementById('rumi-logs-container');

            // Check if filter changed - if so, do a full rebuild
            if (filter !== this.currentLogFilter) {
                this.currentLogFilter = filter;
                this.lastRenderedLogTimestamp = null; // Reset to rebuild all
                container.innerHTML = ''; // Clear container for rebuild
            }

            // Apply filter
            const filtered = filter === 'all'
                ? logs
                : logs.filter(log => log.level === filter);

            // Only render last 200 logs for performance (all logs still stored)
            const logsToRender = filtered.slice(-200);

            // Handle empty state
            if (filtered.length === 0) {
                if (container.children.length === 0 || container.querySelector('.rumi-loading')) {
                    container.innerHTML = '<div class="rumi-loading">No logs to display</div>';
                }
                this.lastRenderedLogTimestamp = null;
                return;
            }

            if (logsToRender.length === 0) {
                // All logs are filtered out by limit, but there are logs
                this.lastRenderedLogTimestamp = null;
                return;
            }

            // Remove "no logs" message if it exists
            const loadingMsg = container.querySelector('.rumi-loading');
            if (loadingMsg) {
                loadingMsg.remove();
            }

            // Check if user is scrolled near the top (within 50px threshold)
            const isAtTop = container.scrollTop <= 50;

            // Find new logs to render (logs after lastRenderedLogTimestamp)
            const newLogs = [];
            if (this.lastRenderedLogTimestamp === null) {
                // First render - add all logs
                newLogs.push(...logsToRender);
            } else {
                // Find logs that are newer than the last rendered timestamp
                for (let i = 0; i < logsToRender.length; i++) {
                    if (logsToRender[i].timestamp > this.lastRenderedLogTimestamp) {
                        newLogs.push(logsToRender[i]);
                    }
                }
            }

            // Only render if there are new logs
            if (newLogs.length > 0) {
                // Create document fragment for better performance
                const fragment = document.createDocumentFragment();

                // Newest logs should appear at the top, so we prepend them in reverse order
                for (let i = newLogs.length - 1; i >= 0; i--) {
                    const log = newLogs[i];
                    const logElement = this.createLogElement(log);
                    fragment.appendChild(logElement);
                }

                // Prepend all new logs at once (newest at top)
                if (container.firstChild) {
                    container.insertBefore(fragment, container.firstChild);
                } else {
                    container.appendChild(fragment);
                }

                // Update tracking with the timestamp of the newest log in logsToRender
                this.lastRenderedLogTimestamp = logsToRender[logsToRender.length - 1].timestamp;

                // Maintain rolling window of 200 logs - remove oldest logs from DOM if we exceed 200
                const logEntries = container.querySelectorAll('.rumi-log-entry');
                if (logEntries.length > 200) {
                    // Remove excess logs from the end (oldest logs)
                    for (let i = 200; i < logEntries.length; i++) {
                        logEntries[i].remove();
                    }
                }

                // Only auto-scroll to top if user was already at the top
                if (isAtTop) {
                    container.scrollTop = 0;
                }
            }
        }

        static createLogElement(log) {
            const div = document.createElement('div');
            div.className = `rumi-log-entry rumi-${log.level}`;

            const escapedMessage = this.escapeHtml(log.message);
            const metaKeys = Object.keys(log.meta);
            const metaHtml = metaKeys.length > 0
                ? `<div class="rumi-log-meta">${this.escapeHtml(JSON.stringify(log.meta))}</div>`
                : '';

            // Convert UTC timestamp to GMT+3 for display
            const logDate = new Date(log.timestamp);
            const gmt3Date = new Date(logDate.getTime() + (3 * 60 * 60 * 1000)); // Add 3 hours
            const displayTimestamp = gmt3Date.toISOString().replace('T', ' ').substring(0, 19);

            div.innerHTML = `
                <strong>${displayTimestamp}</strong> [${log.level.toUpperCase()}] ${log.module}: ${escapedMessage}
                ${metaHtml}
            `;

            return div;
        }

        static showToast(message, type = 'info') {
            const toast = document.createElement('div');
            toast.className = `rumi-toast rumi-toast-${type}`;
            toast.textContent = message;
            toast.style.cssText = `
                position: fixed;
                bottom: 20px;
                right: 20px;
                padding: 12px 20px;
                background: ${type === 'success' ? '#10B981' : type === 'error' ? '#EF4444' : type === 'warning' ? '#F59E0B' : '#2563EB'};
                color: white;
                border-radius: 6px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                z-index: 1000000;
                font-size: 14px;
                font-weight: 500;
                max-width: 400px;
                animation: rumi-toast-in 0.3s ease-out;
            `;

            document.body.appendChild(toast);

            setTimeout(() => {
                toast.style.animation = 'rumi-toast-out 0.3s ease-out';
                setTimeout(() => toast.remove(), 300);
            }, 4000);
        }

        static renderPinnedList() {
            const pinnedListContainer = document.getElementById('rumi-pinned-list');
            if (!pinnedListContainer) return;

            const blockedPins = RUMIStorage.getPinnedBlocked();
            const careRoutingPins = RUMIStorage.getPinnedCareRouting();

            // Combine all pins for display
            const allPins = [
                ...blockedPins.map(pin => ({ ...pin, type: 'blocked' })),
                ...careRoutingPins.map(pin => ({ ...pin, type: 'care_routing' }))
            ];

            if (allPins.length === 0) {
                pinnedListContainer.innerHTML = `
                    <div class="rumi-pinned-empty">
                        No pinned tickets
                    </div>
                `;
                return;
            }

            // Sort by timestamp (newest first)
            allPins.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

            pinnedListContainer.innerHTML = allPins.map(pin => {
                const ticketUrl = `https://gocareem.zendesk.com/agent/tickets/${pin.ticketId}`;
                const timestampDate = new Date(pin.timestamp);
                const timestampStr = timestampDate.toLocaleString();

                if (pin.type === 'blocked') {
                    return `
                        <div class="rumi-pinned-item" role="listitem">
                            <div class="rumi-pinned-item-header">
                                <span class="rumi-pinned-item-badge rumi-pinned-badge-blocked">BLOCKED</span>
                                <button class="rumi-pinned-item-remove"
                                        data-ticket-id="${pin.ticketId}"
                                        data-pin-type="blocked"
                                        aria-label="Remove blocked pin for ticket ${pin.ticketId}">
                                    Remove
                                </button>
                            </div>
                            <div class="rumi-pinned-item-info">
                                <div>
                                    Ticket: <a href="${ticketUrl}" target="_blank" class="rumi-pinned-item-link">${pin.ticketId}</a>
                                </div>
                                <div style="font-size:11px;">Pinned: ${timestampStr}</div>
                            </div>
                        </div>
                    `;
                } else {
                    // Care routing pin
                    const statusBadge = pin.status === 'active'
                        ? '<span class="rumi-pinned-item-badge rumi-pinned-badge-care-active">CARE ROUTING - ACTIVE</span>'
                        : '<span class="rumi-pinned-item-badge rumi-pinned-badge-care-changed">CARE ROUTING - CHANGED</span>';

                    const commentInfo = pin.status === 'active' && pin.lastCommentId
                        ? `<div style="font-size:11px;">Comment ID: ${pin.lastCommentId}</div>`
                        : '<div style="font-size:11px; color: var(--rumi-accent-yellow);">Comment changed - routing stopped</div>';

                    return `
                        <div class="rumi-pinned-item" role="listitem">
                            <div class="rumi-pinned-item-header">
                                ${statusBadge}
                                <button class="rumi-pinned-item-remove"
                                        data-ticket-id="${pin.ticketId}"
                                        data-pin-type="care_routing"
                                        aria-label="Remove care routing pin for ticket ${pin.ticketId}">
                                    Remove
                                </button>
                            </div>
                            <div class="rumi-pinned-item-info">
                                <div>
                                    Ticket: <a href="${ticketUrl}" target="_blank" class="rumi-pinned-item-link">${pin.ticketId}</a>
                                </div>
                                <div style="font-size:11px;">Pinned: ${timestampStr}</div>
                                ${commentInfo}
                            </div>
                        </div>
                    `;
                }
            }).join('');
        }

        static escapeHtml(text) {
            // Prevent XSS by escaping HTML entities in user-generated content
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        static setupExportDropdowns() {
            // Setup for automatic processing export
            const autoDropdown = document.getElementById('rumi-export-dropdown-auto');
            const autoBtn = document.getElementById('rumi-export-btn-auto');

            // Setup for manual processing export
            const manualDropdown = document.getElementById('rumi-export-dropdown-manual');
            const manualBtn = document.getElementById('rumi-export-btn-manual');

            // Toggle dropdown on button click
            autoBtn.onclick = (e) => {
                e.stopPropagation();
                autoDropdown.classList.toggle('active');
                manualDropdown.classList.remove('active');
            };

            manualBtn.onclick = (e) => {
                e.stopPropagation();
                manualDropdown.classList.toggle('active');
                autoDropdown.classList.remove('active');
            };

            // Close dropdowns when clicking outside
            document.addEventListener('click', () => {
                autoDropdown.classList.remove('active');
                manualDropdown.classList.remove('active');
            });

            // Handle export options
            document.querySelectorAll('.rumi-export-option').forEach(option => {
                option.onclick = (e) => {
                    e.stopPropagation();
                    const exportType = option.getAttribute('data-export-type');
                    const tab = option.getAttribute('data-tab');

                    if (exportType === 'csv') {
                        this.exportAsCSV(tab);
                    } else if (exportType === 'html') {
                        this.exportAsHTML(tab);
                    }

                    // Close dropdown
                    autoDropdown.classList.remove('active');
                    manualDropdown.classList.remove('active');
                };
            });
        }

        static exportAsCSV(tab) {
            try {
                const tickets = tab === 'auto'
                    ? RUMIStorage.getProcessedTickets()
                    : RUMIStorage.getManualProcessedTickets();

                if (tickets.length === 0) {
                    this.showToast('No tickets to export', 'warning');
                    return;
                }

                // CSV Headers
                const headers = [
                    'Ticket ID',
                    'Subject',
                    'View',
                    'Action',
                    'Trigger',
                    'Previous Status',
                    'New Status',
                    'Previous Group',
                    'New Group',
                    'Processed At',
                    'Dry Run',
                    'Updated?'
                ];

                // Create CSV content with UTF-8 BOM
                const BOM = '\uFEFF';
                let csvContent = BOM + headers.join(',') + '\n';

                tickets.forEach(ticket => {
                    // Format date without commas to prevent column splitting (convert UTC to GMT+3)
                    const processedDate = new Date(ticket.timestamp);
                    const gmt3Date = new Date(processedDate.getTime() + (3 * 60 * 60 * 1000)); // Add 3 hours
                    const formattedDate = gmt3Date.toISOString().replace('T', ' ').substring(0, 19);

                    const row = [
                        ticket.ticketId || '',
                        `"${(ticket.subject || 'N/A').replace(/"/g, '""')}"`,
                        `"${(ticket.viewName || 'N/A').replace(/"/g, '""')}"`,
                        ticket.action || '',
                        `"${(ticket.trigger || 'N/A').replace(/"/g, '""')}"`,
                        ticket.previousStatus || '',
                        ticket.newStatus || '',
                        `"${(ticket.previousGroupName || 'N/A').replace(/"/g, '""')}"`,
                        `"${(ticket.newGroupName || 'N/A').replace(/"/g, '""')}"`,
                        `"${formattedDate}"`,
                        ticket.dryRun ? 'YES' : 'NO',
                        ticket.alreadyCorrect ? 'YES' : 'NO'
                    ];
                    csvContent += row.join(',') + '\n';
                });

                // Download CSV with UTF-8 BOM
                const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                const link = document.createElement('a');
                const url = URL.createObjectURL(blob);
                const filename = `rumi-${tab}-processed-tickets-${new Date().toISOString().split('T')[0]}.csv`;

                link.setAttribute('href', url);
                link.setAttribute('download', filename);
                link.style.visibility = 'hidden';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);

                this.showToast(`Exported ${tickets.length} tickets as CSV`, 'success');
                RUMILogger.info('Export', `Exported ${tickets.length} tickets as CSV`, { tab });
            } catch (error) {
                this.showToast('Export failed: ' + error.message, 'error');
                RUMILogger.error('Export', 'CSV export failed', { error: error.message, tab });
            }
        }

        static exportAsHTML(tab) {
            try {
                const tickets = tab === 'auto'
                    ? RUMIStorage.getProcessedTickets()
                    : RUMIStorage.getManualProcessedTickets();

                if (tickets.length === 0) {
                    this.showToast('No tickets to export', 'warning');
                    return;
                }

                const workAreaId = tab === 'auto' ? 'rumi-work-area' : 'rumi-work-area-manual';
                const workArea = document.getElementById(workAreaId);

                if (!workArea) {
                    this.showToast('Work area not found', 'error');
                    return;
                }

                // Clone the work area to avoid modifying the original
                const clonedArea = workArea.cloneNode(true);

                // Get all styles from the page
                const styles = Array.from(document.styleSheets)
                    .map(styleSheet => {
                        try {
                            return Array.from(styleSheet.cssRules)
                                .map(rule => rule.cssText)
                                .join('\n');
                        } catch (e) {
                            return '';
                        }
                    })
                    .join('\n');

                // Serialize tickets data for JavaScript
                const ticketsJSON = JSON.stringify(tickets).replace(/</g, '\\u003c');

                // Create HTML document with interactive functionality
                const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>RUMI ${tab === 'auto' ? 'Automatic' : 'Manual'} Processing - Exported ${new Date().toLocaleString()}</title>
    <style>
        ${styles}

        body {
            margin: 0;
            padding: 20px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: var(--rumi-bg, #F5F6F7);
        }

        #${workAreaId} {
            max-width: 100%;
            margin: 0 auto;
            background: white;
            border-radius: 8px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }

        .rumi-export-header {
            background: white;
            padding: 20px;
            margin-bottom: 20px;
            border-radius: 8px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }

        .rumi-export-header h1 {
            margin: 0 0 10px 0;
            color: #2563EB;
        }

        .rumi-export-header p {
            margin: 5px 0;
            color: #6B7280;
        }
    </style>
</head>
<body>
    <div class="rumi-export-header">
        <h1>RUMI ${tab === 'auto' ? 'Automatic' : 'Manual'} Processing Export</h1>
        <p><strong>Exported:</strong> ${new Date().toLocaleString()}</p>
        <p><strong>Total Tickets:</strong> ${tickets.length}</p>
        <p><strong>Tab:</strong> ${tab === 'auto' ? 'Automatic Processing' : 'Manual Processing'}</p>
    </div>
    ${clonedArea.outerHTML}

    <script>
        // Data
        const allTickets = ${ticketsJSON};
        const isAutoTab = ${tab === 'auto'};

        // Tab switching functionality
        function setupTabs() {
            const tabButtons = document.querySelectorAll('.rumi-tab-btn');
            const tabPanels = document.querySelectorAll('.rumi-tab-panel');

            tabButtons.forEach(button => {
                button.addEventListener('click', () => {
                    const tabType = button.getAttribute('data-auto-tab') || button.getAttribute('data-manual-tab');

                    // Remove active class from all buttons and panels
                    tabButtons.forEach(btn => btn.classList.remove('active'));
                    tabPanels.forEach(panel => panel.classList.remove('active'));

                    // Add active class to clicked button
                    button.classList.add('active');

                    // Show corresponding panel
                    const targetPanel = document.getElementById(\`rumi-\${tabType === 'all' ? 'tab-all' : tabType.includes('manual') ? tabType.replace('manual-', 'manual-tab-') : 'tab-' + tabType}\`);
                    if (targetPanel) {
                        targetPanel.classList.add('active');
                    }
                });
            });
        }

        // Sorting functionality
        function setupSorting() {
            const tables = document.querySelectorAll('.rumi-table');

            tables.forEach(table => {
                const headers = table.querySelectorAll('th.sortable');

                headers.forEach((header, columnIndex) => {
                    header.addEventListener('click', () => {
                        const tbody = table.querySelector('tbody');
                        const rows = Array.from(tbody.querySelectorAll('tr:not(.rumi-table-filter-row)'));

                        // Determine sort direction
                        const isAsc = header.classList.contains('sorted-asc');

                        // Remove sorting classes from all headers
                        headers.forEach(h => {
                            h.classList.remove('sorted-asc', 'sorted-desc');
                        });

                        // Add appropriate class to current header
                        if (isAsc) {
                            header.classList.add('sorted-desc');
                        } else {
                            header.classList.add('sorted-asc');
                        }

                        // Sort rows
                        rows.sort((a, b) => {
                            const aText = a.cells[columnIndex].textContent.trim();
                            const bText = b.cells[columnIndex].textContent.trim();

                            // Try to parse as number
                            const aNum = parseFloat(aText);
                            const bNum = parseFloat(bText);

                            let comparison = 0;
                            if (!isNaN(aNum) && !isNaN(bNum)) {
                                comparison = aNum - bNum;
                            } else {
                                comparison = aText.localeCompare(bText);
                            }

                            return isAsc ? -comparison : comparison;
                        });

                        // Re-append rows in sorted order
                        const filterRow = tbody.querySelector('.rumi-table-filter-row');
                        rows.forEach(row => tbody.appendChild(row));

                        // Keep filter row at top if it exists
                        if (filterRow) {
                            tbody.insertBefore(filterRow, tbody.firstChild);
                        }
                    });
                });
            });
        }

        // Filtering functionality
        function setupFiltering() {
            const filterInputs = document.querySelectorAll('.rumi-table-filter-input');
            const filterSelects = document.querySelectorAll('.rumi-custom-select-trigger');

            function applyFilters(table) {
                const tbody = table.querySelector('tbody');
                const rows = tbody.querySelectorAll('tr:not(.rumi-table-filter-row)');
                const filterRow = tbody.querySelector('.rumi-table-filter-row');

                if (!filterRow) return;

                const filters = {};

                // Get text input filters
                filterRow.querySelectorAll('.rumi-table-filter-input').forEach((input, index) => {
                    if (input.value) {
                        filters[index] = input.value.toLowerCase();
                    }
                });

                // Get dropdown filters
                filterRow.querySelectorAll('.rumi-custom-select-trigger').forEach((trigger, index) => {
                    const value = trigger.textContent.trim();
                    if (value && value !== 'All') {
                        const cellIndex = Array.from(filterRow.children).indexOf(trigger.closest('td'));
                        filters[cellIndex] = value.toLowerCase();
                    }
                });

                // Apply filters to rows
                rows.forEach(row => {
                    let shouldShow = true;

                    for (const [columnIndex, filterValue] of Object.entries(filters)) {
                        const cellText = row.cells[columnIndex].textContent.toLowerCase();
                        if (!cellText.includes(filterValue)) {
                            shouldShow = false;
                            break;
                        }
                    }

                    row.style.display = shouldShow ? '' : 'none';
                });
            }

            // Setup text input filtering
            filterInputs.forEach(input => {
                const table = input.closest('table');
                input.addEventListener('input', () => applyFilters(table));
            });

            // Setup dropdown filtering
            filterSelects.forEach(trigger => {
                trigger.addEventListener('click', function(e) {
                    e.stopPropagation();
                    const parent = this.closest('.rumi-custom-select');
                    const dropdown = parent.querySelector('.rumi-custom-select-dropdown');

                    // Close other dropdowns
                    document.querySelectorAll('.rumi-custom-select-dropdown.active').forEach(d => {
                        if (d !== dropdown) d.classList.remove('active');
                    });
                    document.querySelectorAll('.rumi-custom-select-trigger.active').forEach(t => {
                        if (t !== this) t.classList.remove('active');
                    });

                    // Toggle current dropdown
                    dropdown.classList.toggle('active');
                    this.classList.toggle('active');
                });
            });

            // Setup dropdown options
            document.querySelectorAll('.rumi-custom-select-option').forEach(option => {
                option.addEventListener('click', function() {
                    const parent = this.closest('.rumi-custom-select');
                    const trigger = parent.querySelector('.rumi-custom-select-trigger');
                    const dropdown = parent.querySelector('.rumi-custom-select-dropdown');
                    const table = this.closest('table');

                    // Update trigger text
                    const arrow = trigger.querySelector('.rumi-custom-select-arrow');
                    trigger.textContent = this.textContent;
                    trigger.appendChild(arrow);

                    // Update selected state
                    parent.querySelectorAll('.rumi-custom-select-option').forEach(opt => {
                        opt.classList.remove('selected');
                    });
                    this.classList.add('selected');

                    // Close dropdown
                    dropdown.classList.remove('active');
                    trigger.classList.remove('active');

                    // Apply filters
                    applyFilters(table);
                });
            });

            // Close dropdowns when clicking outside
            document.addEventListener('click', () => {
                document.querySelectorAll('.rumi-custom-select-dropdown.active').forEach(d => {
                    d.classList.remove('active');
                });
                document.querySelectorAll('.rumi-custom-select-trigger.active').forEach(t => {
                    t.classList.remove('active');
                });
            });
        }

        // Initialize all functionality
        document.addEventListener('DOMContentLoaded', () => {
            setupTabs();
            setupSorting();
            setupFiltering();
        });
    </script>
</body>
</html>`;

                // Download HTML
                const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8;' });
                const link = document.createElement('a');
                const url = URL.createObjectURL(blob);
                const filename = `rumi-${tab}-interactive-table-${new Date().toISOString().split('T')[0]}.html`;

                link.setAttribute('href', url);
                link.setAttribute('download', filename);
                link.style.visibility = 'hidden';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);

                this.showToast('Exported interactive HTML table', 'success');
                RUMILogger.info('Export', `Exported ${tickets.length} tickets as HTML`, { tab });
            } catch (error) {
                this.showToast('Export failed: ' + error.message, 'error');
                RUMILogger.error('Export', 'HTML export failed', { error: error.message, tab });
            }
        }

        static renderSettingsTab(category = null, mode = 'automatic') {
            try {
                const container = document.getElementById('rumi-settings-content');
                if (!container) return;

                // If no category is selected, show category view
                if (!category) {
                    this.renderSettingsCategoryView();
                    return;
                }

                // Otherwise, show the specific category detail view
                if (category === 'actions-triggers') {
                    this.renderActionsTriggerSettings(mode);
                }

                RUMILogger.info('Settings', 'Settings tab rendered', { category, mode });
            } catch (error) {
                RUMILogger.error('Settings', 'Failed to render settings tab', { error: error.message });
            }
        }

        static renderSettingsCategoryView() {
            const container = document.getElementById('rumi-settings-content');
            if (!container) return;

            container.innerHTML = `
                <div class="rumi-settings-category-view">
                    <div class="rumi-settings-category-card" data-category="actions-triggers">
                        <div class="rumi-settings-category-icon">
                            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                            </svg>
                        </div>
                        <h3 class="rumi-settings-category-title">Actions and Triggers</h3>
                        <p class="rumi-settings-category-description">
                            Configure automatic and manual action types, trigger phrases, and routing settings for ticket automation.
                        </p>
                    </div>

                    <div class="rumi-settings-category-card" data-category="ui-settings">
                        <div class="rumi-settings-category-icon">
                            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="3" y="3" width="18" height="18" rx="2"/>
                                <path d="M9 3v18"/>
                            </svg>
                        </div>
                        <h3 class="rumi-settings-category-title">User Interface</h3>
                        <p class="rumi-settings-category-description">
                            Customize appearance with light and dark themes, and adjust display preferences.
                        </p>
                    </div>

                    <div class="rumi-settings-category-card" data-category="account-permissions">
                        <div class="rumi-settings-category-icon">
                            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                                <circle cx="12" cy="7" r="4"/>
                            </svg>
                        </div>
                        <h3 class="rumi-settings-category-title">Account & Permissions</h3>
                        <p class="rumi-settings-category-description">
                            View current user information, role, and account details.
                        </p>
                    </div>

                    <div class="rumi-settings-category-card" data-category="visual-rules">
                        <div class="rumi-settings-category-icon">
                            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="18" cy="5" r="3"/>
                                <circle cx="6" cy="12" r="3"/>
                                <circle cx="18" cy="19" r="3"/>
                                <path d="M8.59 13.51l6.83 3.98"/>
                                <path d="M15.41 6.51l-6.82 3.98"/>
                            </svg>
                        </div>
                        <h3 class="rumi-settings-category-title">Visual Rules</h3>
                        <p class="rumi-settings-category-description">
                            Interactive flowchart showing ticket processing rules, priority, and execution paths. Visualize how specific tickets are processed.
                        </p>
                    </div>
                </div>
            `;

            // Attach event listeners for category cards
            container.querySelectorAll('.rumi-settings-category-card').forEach(card => {
                card.onclick = () => {
                    const category = card.dataset.category;
                    if (category === 'actions-triggers') {
                        this.renderSettingsTab(category, 'automatic');
                    } else if (category === 'ui-settings') {
                        this.renderUISettings();
                    } else if (category === 'account-permissions') {
                        this.renderAccountPermissions();
                    } else if (category === 'visual-rules') {
                        this.renderVisualRules();
                    }
                };
            });

            RUMILogger.info('Settings', 'Settings category view rendered');
        }

        static renderActionsTriggerSettings(mode = 'automatic') {
            const container = document.getElementById('rumi-settings-content');
            if (!container) return;

            // Generate HTML for actions and triggers settings UI
            container.innerHTML = `
                <button class="rumi-settings-back-button" id="rumi-settings-back">
                    <span>←</span>
                    <span>Back to Settings</span>
                </button>

                <div class="rumi-settings-detail-view active">
                    <div class="rumi-settings-sub-tabs">
                        <button class="rumi-settings-sub-tab ${mode === 'automatic' ? 'active' : ''}" data-settings-mode="automatic">
                            Automatic Settings
                        </button>
                        <button class="rumi-settings-sub-tab ${mode === 'manual' ? 'active' : ''}" data-settings-mode="manual">
                            Manual Settings
                        </button>
                    </div>

                    <div id="rumi-settings-automatic" class="rumi-settings-sub-content ${mode === 'automatic' ? 'active' : ''}">
                        ${this.generateSettingsContent('automatic')}
                    </div>

                    <div id="rumi-settings-manual" class="rumi-settings-sub-content ${mode === 'manual' ? 'active' : ''}">
                        ${this.generateSettingsContent('manual')}
                    </div>
                </div>
            `;

            // Attach back button event listener
            const backButton = document.getElementById('rumi-settings-back');
            if (backButton) {
                backButton.onclick = () => {
                    this.renderSettingsTab();
                };
            }

            // Attach event listeners for settings sub-tabs
            container.querySelectorAll('.rumi-settings-sub-tab').forEach(btn => {
                btn.onclick = () => {
                    const newMode = btn.dataset.settingsMode;
                    container.querySelectorAll('.rumi-settings-sub-tab').forEach(b => b.classList.remove('active'));
                    container.querySelectorAll('.rumi-settings-sub-content').forEach(c => c.classList.remove('active'));
                    btn.classList.add('active');
                    document.getElementById(`rumi-settings-${newMode}`).classList.add('active');
                    RUMILogger.info('Settings', `Switched to ${newMode} settings`);
                };
            });

            // Attach event listeners for all toggles and buttons
            this.attachSettingsEventListeners('automatic');
            this.attachSettingsEventListeners('manual');

            RUMILogger.info('Settings', 'Actions and triggers settings rendered', { mode });
        }

        static renderUISettings() {
            const container = document.getElementById('rumi-settings-content');
            if (!container) return;

            const uiSettings = RUMIStorage.getUISettings();

            container.innerHTML = `
                <button class="rumi-settings-back-button" id="rumi-settings-back">
                    <span>←</span>
                    <span>Back to Settings</span>
                </button>

                <div class="rumi-settings-detail-view active">
                    <div class="rumi-settings-section">
                        <div class="rumi-settings-section-title">
                            <span>Appearance</span>
                        </div>

                        <div class="rumi-settings-item">
                            <div>
                                <div class="rumi-settings-item-label">Theme</div>
                                <div style="font-size: 12px; color: var(--rumi-text-secondary); margin-top: 4px;">
                                    Choose between light and dark interface themes
                                </div>
                            </div>
                            <select id="rumi-theme-select" class="rumi-select" style="margin-left: 0; min-width: 120px;">
                                <option value="light" ${uiSettings.theme === 'light' ? 'selected' : ''}>Light</option>
                                <option value="dark" ${uiSettings.theme === 'dark' ? 'selected' : ''}>Dark</option>
                            </select>
                        </div>
                    </div>
                </div>
            `;

            // Attach back button event listener
            const backButton = document.getElementById('rumi-settings-back');
            if (backButton) {
                backButton.onclick = () => {
                    this.renderSettingsTab();
                };
            }

            // Attach theme change listener
            const themeSelect = document.getElementById('rumi-theme-select');
            if (themeSelect) {
                themeSelect.onchange = (e) => {
                    const newTheme = e.target.value;
                    uiSettings.theme = newTheme;
                    RUMIStorage.setUISettings(uiSettings);
                    this.applyTheme(newTheme);
                    this.showToast(`Theme changed to ${newTheme}`, 'success');
                    RUMILogger.info('Settings', 'Theme changed', { theme: newTheme });
                };
            }

            RUMILogger.info('Settings', 'UI settings rendered');
        }

        static async renderAccountPermissions() {
            const container = document.getElementById('rumi-settings-content');
            if (!container) return;

            // Show loading state
            container.innerHTML = `
                <button class="rumi-settings-back-button" id="rumi-settings-back">
                    <span>←</span>
                    <span>Back to Settings</span>
                </button>

                <div class="rumi-settings-detail-view active">
                    <div class="rumi-settings-section">
                        <div class="rumi-settings-section-title">
                            <span>Account Information</span>
                        </div>
                        <div class="rumi-loading">Loading user information...</div>
                    </div>
                </div>
            `;

            // Attach back button event listener
            let backButton = document.getElementById('rumi-settings-back');
            if (backButton) {
                backButton.onclick = () => {
                    this.renderSettingsTab();
                };
            }

            try {
                // Fetch current user information
                let currentUser = RUMIStorage.getCurrentUser();

                // If not cached or cache is old, fetch fresh data
                if (!currentUser || !currentUser.lastFetched || (Date.now() - currentUser.lastFetched > 3600000)) {
                    const userData = await RUMIAPIManager.get('/api/v2/users/me.json');
                    currentUser = {
                        id: userData.user.id,
                        name: userData.user.name,
                        role: userData.user.role,
                        lastFetched: Date.now()
                    };
                    RUMIStorage.setCurrentUser(currentUser);
                }

                // Render with user data
                container.innerHTML = `
                    <button class="rumi-settings-back-button" id="rumi-settings-back">
                        <span>←</span>
                        <span>Back to Settings</span>
                    </button>

                    <div class="rumi-settings-detail-view active">
                        <div class="rumi-settings-section">
                            <div class="rumi-settings-section-title">
                                <span>Account Information</span>
                            </div>

                            <div class="rumi-settings-item">
                                <div>
                                    <div class="rumi-settings-item-label">User ID</div>
                                    <div style="font-size: 12px; color: var(--rumi-text-secondary); margin-top: 4px;">
                                        Your unique Zendesk user identifier
                                    </div>
                                </div>
                                <div style="font-family: monospace; font-size: 14px; color: var(--rumi-accent-blue);">
                                    ${currentUser.id}
                                </div>
                            </div>

                            <div class="rumi-settings-item">
                                <div>
                                    <div class="rumi-settings-item-label">User Name</div>
                                    <div style="font-size: 12px; color: var(--rumi-text-secondary); margin-top: 4px;">
                                        Your display name in Zendesk
                                    </div>
                                </div>
                                <div style="font-size: 14px; font-weight: 500;">
                                    ${this.escapeHtml(currentUser.name)}
                                </div>
                            </div>

                            <div class="rumi-settings-item">
                                <div>
                                    <div class="rumi-settings-item-label">User Role</div>
                                    <div style="font-size: 12px; color: var(--rumi-text-secondary); margin-top: 4px;">
                                        Your permission level in Zendesk
                                    </div>
                                </div>
                                <div class="rumi-badge ${currentUser.role === 'admin' ? 'rumi-badge-care' : currentUser.role === 'agent' ? 'rumi-badge-solved' : 'rumi-badge-pending'}">
                                    ${this.escapeHtml(currentUser.role).toUpperCase()}
                                </div>
                            </div>

                            <div style="margin-top: 16px; padding: 12px; background: var(--rumi-bg); border-radius: 6px; font-size: 12px; color: var(--rumi-text-secondary);">
                                <strong>Note:</strong> User information is cached for 1 hour. Refresh the page to update if changes were made.
                            </div>
                        </div>
                    </div>
                `;

                // Re-attach back button listener
                backButton = document.getElementById('rumi-settings-back');
                if (backButton) {
                    backButton.onclick = () => {
                        this.renderSettingsTab();
                    };
                }

                RUMILogger.info('Settings', 'Account permissions rendered', { userId: currentUser.id });

            } catch (error) {
                RUMILogger.error('Settings', 'Failed to fetch user information', { error: error.message });

                container.innerHTML = `
                    <button class="rumi-settings-back-button" id="rumi-settings-back">
                        <span>←</span>
                        <span>Back to Settings</span>
                    </button>

                    <div class="rumi-settings-detail-view active">
                        <div class="rumi-settings-section">
                            <div class="rumi-settings-section-title">
                                <span>Account Information</span>
                            </div>
                            <div class="rumi-error-message">
                                Failed to load user information. Please try again later.
                            </div>
                        </div>
                    </div>
                `;

                // Re-attach back button listener
                backButton = document.getElementById('rumi-settings-back');
                if (backButton) {
                    backButton.onclick = () => {
                        this.renderSettingsTab();
                    };
                }
            }
        }

        static renderVisualRules() {
            const container = document.getElementById('rumi-settings-content');
            if (!container) return;

            container.innerHTML = `
                <button class="rumi-settings-back-button" id="rumi-settings-back">
                    <span>←</span>
                    <span>Back to Settings</span>
                </button>

                <div class="rumi-visual-rules-container">
                    <div class="rumi-visual-rules-header">
                        <div class="rumi-visual-rules-controls">
                            <input
                                type="text"
                                id="rumi-visual-rules-ticket-input"
                                class="rumi-visual-rules-ticket-input"
                                placeholder="Enter ticket ID..."
                                aria-label="Ticket ID for visualization"
                            />
                            <button class="rumi-btn-sm" id="rumi-visual-rules-visualize-btn">
                                Visualize Ticket
                            </button>
                            <button class="rumi-btn-sm" id="rumi-visual-rules-clear-btn">
                                Clear Visualization
                            </button>
                            <button class="rumi-btn-sm" id="rumi-visual-rules-refresh-btn">
                                Refresh
                            </button>
                        </div>
                    </div>

                    <div class="rumi-visual-rules-canvas-wrapper" id="rumi-visual-rules-canvas-wrapper">
                        <div class="rumi-visual-rules-loading" id="rumi-visual-rules-loading">
                            <div class="rumi-visual-rules-loading-spinner"></div>
                            <div>Generating flowchart...</div>
                        </div>
                        <canvas id="rumi-visual-rules-canvas" class="rumi-visual-rules-canvas"></canvas>

                        <div class="rumi-visual-rules-legend" id="rumi-visual-rules-legend">
                            <div class="rumi-visual-rules-legend-title">Legend</div>
                            <div class="rumi-visual-rules-legend-item">
                                <div class="rumi-visual-rules-legend-color" style="background: #9CA3AF;"></div>
                                <span>Entry Point</span>
                            </div>
                            <div class="rumi-visual-rules-legend-item">
                                <div class="rumi-visual-rules-legend-color" style="background: #EF4444;"></div>
                                <span>Priority Check</span>
                            </div>
                            <div class="rumi-visual-rules-legend-item">
                                <div class="rumi-visual-rules-legend-color" style="background: #8B5CF6;"></div>
                                <span>Tag Routing</span>
                            </div>
                            <div class="rumi-visual-rules-legend-item">
                                <div class="rumi-visual-rules-legend-color" style="background: #10B981;"></div>
                                <span>Comment Action</span>
                            </div>
                            <div class="rumi-visual-rules-legend-item">
                                <div class="rumi-visual-rules-legend-color" style="background: #F59E0B;"></div>
                                <span>Subject Check</span>
                            </div>
                            <div class="rumi-visual-rules-legend-item">
                                <div class="rumi-visual-rules-legend-color" style="background: #DC2626;"></div>
                                <span>Blocking Rule</span>
                            </div>
                            <div class="rumi-visual-rules-legend-item">
                                <div class="rumi-visual-rules-legend-color" style="background: #3B82F6;"></div>
                                <span>Action/Outcome</span>
                            </div>
                            <div class="rumi-visual-rules-legend-item">
                                <div class="rumi-visual-rules-legend-color" style="background: #D1D5DB; opacity: 0.6;"></div>
                                <span>Disabled Rule</span>
                            </div>
                            <div class="rumi-visual-rules-legend-toggle" id="rumi-visual-rules-legend-toggle">
                                Collapse
                            </div>
                        </div>

                        <div class="rumi-visual-rules-zoom-controls">
                            <button
                                class="rumi-visual-rules-zoom-btn"
                                id="rumi-visual-rules-zoom-in"
                                aria-label="Zoom in"
                                title="Zoom in"
                            >+</button>
                            <button
                                class="rumi-visual-rules-zoom-btn"
                                id="rumi-visual-rules-zoom-out"
                                aria-label="Zoom out"
                                title="Zoom out"
                            >−</button>
                            <button
                                class="rumi-visual-rules-zoom-btn"
                                id="rumi-visual-rules-fit"
                                aria-label="Fit to screen"
                                title="Fit to screen"
                                style="font-size: 14px;"
                            >⊡</button>
                            <button
                                class="rumi-visual-rules-zoom-btn"
                                id="rumi-visual-rules-reset"
                                aria-label="Reset view"
                                title="Reset view"
                                style="font-size: 14px;"
                            >⟲</button>
                        </div>
                    </div>
                </div>
            `;

            // Attach back button listener
            const backButton = document.getElementById('rumi-settings-back');
            if (backButton) {
                backButton.onclick = () => {
                    this.renderSettingsTab();
                };
            }

            // Initialize visual rules
            setTimeout(() => {
                RUMIVisualRules.initialize();
            }, 100);

            RUMILogger.info('Settings', 'Visual rules opened');
        }

        static applyTheme(theme) {
            const root = document.getElementById('rumi-root');
            if (root) {
                root.setAttribute('data-theme', theme);
                RUMILogger.info('UI', 'Theme applied', { theme });
            }
        }

        static generateSettingsContent(mode) {
            const settings = mode === 'automatic' ? RUMIStorage.getAutomaticSettings() : RUMIStorage.getManualSettings();

            return `
                <!-- Action Types Section -->
                <div class="rumi-settings-section">
                    <div class="rumi-settings-section-title">
                        <span>Action Types</span>
                        <div class="rumi-settings-controls">
                            <button class="rumi-btn-sm" data-action="select-all" data-section="actionTypes" data-mode="${mode}">
                                ${this.allItemsSelected(Object.values(settings.actionTypes)) ? 'Unselect All' : 'Select All'}
                            </button>
                            <button class="rumi-btn-sm" data-action="invert" data-section="actionTypes" data-mode="${mode}">
                                Invert Selection
                            </button>
                        </div>
                    </div>
                    ${this.generateActionTypeToggles(settings.actionTypes, mode)}
                </div>

                <!-- Pending Triggers Section -->
                <div class="rumi-settings-section">
                    <div class="rumi-settings-section-title">
                        <span>Pending Trigger Phrases</span>
                        <div class="rumi-settings-controls">
                            <button class="rumi-btn-sm" data-action="select-all" data-section="pending" data-mode="${mode}">
                                ${this.allItemsSelected(Object.values(settings.triggerPhrases.pending)) ? 'Unselect All' : 'Select All'}
                            </button>
                            <button class="rumi-btn-sm" data-action="invert" data-section="pending" data-mode="${mode}">
                                Invert Selection
                            </button>
                        </div>
                    </div>
                    ${this.generateTriggerPhraseToggles(settings.triggerPhrases.pending, 'pending', mode)}
                </div>

                <!-- Solved Triggers Section -->
                <div class="rumi-settings-section">
                    <div class="rumi-settings-section-title">
                        <span>Solved Trigger Phrases</span>
                        <div class="rumi-settings-controls">
                            <button class="rumi-btn-sm" data-action="select-all" data-section="solved" data-mode="${mode}">
                                ${this.allItemsSelected(Object.values(settings.triggerPhrases.solved)) ? 'Unselect All' : 'Select All'}
                            </button>
                            <button class="rumi-btn-sm" data-action="invert" data-section="solved" data-mode="${mode}">
                                Invert Selection
                            </button>
                        </div>
                    </div>
                    ${this.generateTriggerPhraseToggles(settings.triggerPhrases.solved, 'solved', mode)}
                </div>

                <!-- Care Routing Phrases Section -->
                <div class="rumi-settings-section">
                    <div class="rumi-settings-section-title">
                        <span>Care Routing Phrases</span>
                        <div class="rumi-settings-controls">
                            <button class="rumi-btn-sm" data-action="select-all" data-section="careRouting" data-mode="${mode}">
                                ${this.allItemsSelected(Object.values(settings.triggerPhrases.careRouting)) ? 'Unselect All' : 'Select All'}
                            </button>
                            <button class="rumi-btn-sm" data-action="invert" data-section="careRouting" data-mode="${mode}">
                                Invert Selection
                            </button>
                        </div>
                    </div>
                    ${this.generateTriggerPhraseToggles(settings.triggerPhrases.careRouting, 'careRouting', mode)}
                </div>
            `;
        }

        static allItemsSelected(items) {
            return items.every(item => item === true);
        }

        static generateActionTypeToggles(actionTypes, mode) {
            const actionTypeNames = {
                solved: 'Solved',
                pending: 'Pending',
                care: 'Care',
                rta: 'RTA/HALA',
                casablanca: 'Casablanca'
            };

            return Object.entries(actionTypes).map(([key, enabled]) => `
                <div class="rumi-settings-item">
                    <span class="rumi-settings-item-label">${this.escapeHtml(actionTypeNames[key] || key)}</span>
                    <label class="rumi-toggle-switch">
                        <input type="checkbox"
                               data-type="actionType"
                               data-key="${key}"
                               data-mode="${mode}"
                               ${enabled ? 'checked' : ''}
                               aria-label="Toggle ${actionTypeNames[key] || key}">
                        <span class="rumi-toggle-slider"></span>
                    </label>
                </div>
            `).join('');
        }

        static generateTriggerPhraseToggles(phrases, category, mode) {
            return Object.entries(phrases).map(([phrase, enabled]) => `
                <div class="rumi-settings-item">
                    <span class="rumi-settings-item-label">${this.escapeHtml(phrase)}</span>
                    <label class="rumi-toggle-switch">
                        <input type="checkbox"
                               data-type="triggerPhrase"
                               data-category="${category}"
                               data-phrase="${this.escapeHtml(phrase)}"
                               data-mode="${mode}"
                               ${enabled ? 'checked' : ''}
                               aria-label="Toggle phrase: ${this.escapeHtml(phrase)}">
                        <span class="rumi-toggle-slider"></span>
                    </label>
                </div>
            `).join('');
        }

        static attachSettingsEventListeners(mode) {
            const container = document.getElementById('rumi-settings-content');
            if (!container) return;

            // Action type toggles
            container.querySelectorAll(`input[data-type="actionType"][data-mode="${mode}"]`).forEach(toggle => {
                toggle.onchange = (e) => {
                    const key = e.target.dataset.key;
                    const enabled = e.target.checked;
                    const settings = mode === 'automatic' ? RUMIStorage.getAutomaticSettings() : RUMIStorage.getManualSettings();
                    settings.actionTypes[key] = enabled;
                    mode === 'automatic' ? RUMIStorage.setAutomaticSettings(settings) : RUMIStorage.setManualSettings(settings);
                    RUMILogger.info('Settings', `Action type ${key} ${enabled ? 'enabled' : 'disabled'}`, { mode, key, enabled });
                    this.showToast(`${key} action type ${enabled ? 'enabled' : 'disabled'}`, 'success');

                    // Update button text for this section
                    this.updateSectionButtonText(mode, 'actionTypes', settings);
                };
            });

            // Trigger phrase toggles
            container.querySelectorAll(`input[data-type="triggerPhrase"][data-mode="${mode}"]`).forEach(toggle => {
                toggle.onchange = (e) => {
                    const category = e.target.dataset.category;
                    const phrase = e.target.dataset.phrase;
                    const enabled = e.target.checked;
                    const settings = mode === 'automatic' ? RUMIStorage.getAutomaticSettings() : RUMIStorage.getManualSettings();
                    settings.triggerPhrases[category][phrase] = enabled;
                    mode === 'automatic' ? RUMIStorage.setAutomaticSettings(settings) : RUMIStorage.setManualSettings(settings);
                    RUMILogger.info('Settings', `Trigger phrase ${enabled ? 'enabled' : 'disabled'}`, { mode, category, phrase: phrase.substring(0, 500), enabled });

                    // Update button text for this section
                    this.updateSectionButtonText(mode, category, settings);
                };
            });

            // Bulk action buttons
            container.querySelectorAll(`button[data-mode="${mode}"]`).forEach(btn => {
                btn.onclick = () => {
                    const action = btn.dataset.action;
                    const section = btn.dataset.section;
                    this.handleBulkAction(action, section, mode);
                };
            });
        }

        static updateSectionButtonText(mode, section, settings) {
            // Find the button for this section and mode
            const container = document.getElementById('rumi-settings-content');
            if (!container) return;

            const button = container.querySelector(`button[data-action="select-all"][data-section="${section}"][data-mode="${mode}"]`);
            if (!button) return;

            // Determine if all items are selected
            let allSelected = false;
            if (section === 'actionTypes') {
                allSelected = this.allItemsSelected(Object.values(settings.actionTypes));
            } else {
                allSelected = this.allItemsSelected(Object.values(settings.triggerPhrases[section]));
            }

            // Update button text
            button.textContent = allSelected ? 'Unselect All' : 'Select All';
        }

        static handleBulkAction(action, section, mode) {
            try {
                const settings = mode === 'automatic' ? RUMIStorage.getAutomaticSettings() : RUMIStorage.getManualSettings();

                if (section === 'actionTypes') {
                    const currentValues = Object.values(settings.actionTypes);
                    const allSelected = currentValues.every(v => v === true);

                    if (action === 'select-all') {
                        const newValue = !allSelected;
                        Object.keys(settings.actionTypes).forEach(key => {
                            settings.actionTypes[key] = newValue;
                        });
                    } else if (action === 'invert') {
                        Object.keys(settings.actionTypes).forEach(key => {
                            settings.actionTypes[key] = !settings.actionTypes[key];
                        });
                    }
                } else {
                    // Trigger phrases section
                    const currentValues = Object.values(settings.triggerPhrases[section]);
                    const allSelected = currentValues.every(v => v === true);

                    if (action === 'select-all') {
                        const newValue = !allSelected;
                        Object.keys(settings.triggerPhrases[section]).forEach(key => {
                            settings.triggerPhrases[section][key] = newValue;
                        });
                    } else if (action === 'invert') {
                        Object.keys(settings.triggerPhrases[section]).forEach(key => {
                            settings.triggerPhrases[section][key] = !settings.triggerPhrases[section][key];
                        });
                    }
                }

                mode === 'automatic' ? RUMIStorage.setAutomaticSettings(settings) : RUMIStorage.setManualSettings(settings);
                this.renderActionsTriggerSettings(mode);
                this.showToast(`${action === 'select-all' ? 'Selection toggled' : 'Selection inverted'} for ${section}`, 'success');
                RUMILogger.info('Settings', `Bulk action performed`, { action, section, mode });
            } catch (error) {
                RUMILogger.error('Settings', 'Failed to handle bulk action', { error: error.message, action, section, mode });
            }
        }

        static downloadAllLogs() {
            // Download all stored logs as a JSON file
            const logs = RUMIStorage.getLogs();
            const dataStr = JSON.stringify(logs, null, 2);
            const dataBlob = new Blob([dataStr], { type: 'application/json' });
            const url = URL.createObjectURL(dataBlob);

            const link = document.createElement('a');
            link.href = url;
            link.download = `rumi-logs-${new Date().toISOString().replace(/:/g, '-')}.json`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);

            this.showToast(`Downloaded ${logs.length} logs`, 'success');
            RUMILogger.info('UI', 'All logs downloaded', { logCount: logs.length });
        }

        static async getViewName(viewId) {
            // First check the cache
            const cachedName = this.viewIdToNameMap.get(String(viewId));
            if (cachedName) {
                return cachedName;
            }

            // If not in cache, fetch from API
            try {
                const data = await RUMIAPIManager.get(`/api/v2/views/${viewId}.json`);
                const viewName = data.view?.title || `View ${viewId}`;
                // Cache it for future use
                this.viewIdToNameMap.set(String(viewId), viewName);
                return viewName;
            } catch (error) {
                RUMILogger.warn('UI', `Failed to fetch view name for ${viewId}`, { error: error.message });
                return `View ${viewId}`;
            }
        }
    }

    // ============================================================================
    // VISUAL RULES ENGINE
    // ============================================================================

    class RUMIVisualRules {
        static canvas = null;
        static ctx = null;
        static nodes = [];
        static connections = [];
        static zoom = 1;
        static panX = 0;
        static panY = 0;
        static isDragging = false;
        static dragStartX = 0;
        static dragStartY = 0;
        static selectedNode = null;
        static hoveredNode = null;
        static visualizingTicket = null;
        static highlightedPath = [];

        static initialize() {
            try {
                this.canvas = document.getElementById('rumi-visual-rules-canvas');
                if (!this.canvas) {
                    RUMILogger.error('VisualRules', 'Canvas element not found');
                    return;
                }

                this.ctx = this.canvas.getContext('2d');
                this.resizeCanvas();

                // Don't build flowchart initially - only when visualizing a ticket
                this.nodes = [];
                this.connections = [];
                this.visualizingTicket = null;

                // Attach event listeners
                this.attachEventListeners();

                // Show initial prompt
                this.render();

                // Hide loading indicator
                const loading = document.getElementById('rumi-visual-rules-loading');
                if (loading) loading.style.display = 'none';

                RUMILogger.info('VisualRules', 'Visual rules initialized - ready for ticket visualization');
            } catch (error) {
                RUMILogger.error('VisualRules', 'Failed to initialize visual rules', { error: error.message });
                this.showError('Failed to initialize. Please try refreshing.');
            }
        }

        static resizeCanvas() {
            const wrapper = document.getElementById('rumi-visual-rules-canvas-wrapper');
            if (!wrapper || !this.canvas) return;

            const rect = wrapper.getBoundingClientRect();
            this.canvas.width = rect.width;
            this.canvas.height = rect.height;
        }

        static addNode(node) {
            this.nodes.push(node);
        }

        static addConnection(fromId, toId, label = '') {
            this.connections.push({ from: fromId, to: toId, label });
        }

        static async buildTicketPath(ticket, comments) {
            // Build COMPLETE flowchart showing EVERY decision point and edge case
            // Uses ACTUAL processor logic to ensure 100% accuracy
            const ticketId = ticket.id;

            // Load actual settings for accurate trigger checking
            const settings = RUMIStorage.getAutomaticSettings();

            let xPos = 150;
            const columnSpacing = 280;
            const nodeWidth = 200;
            const nodeHeight = 65;
            let yPos = 200;
            const rowHeight = 100;

            // ENTRY NODE - Show ticket details
            const statusEmoji = ticket.status === 'closed' ? '🔒' :
                               ticket.status === 'pending' ? '⏱' :
                               ticket.status === 'solved' ? '✓' :
                               ticket.status === 'open' ? '📂' : '📄';

            this.addNode({
                id: 'start',
                label: `${statusEmoji} Ticket #${ticketId}`,
                type: 'entry',
                x: xPos,
                y: yPos,
                width: nodeWidth,
                height: nodeHeight,
                description: `Status: ${ticket.status}\nSubject: ${ticket.subject ? ticket.subject.substring(0, 500) + '...' : 'No subject'}`
            });

            let lastNodeId = 'start';
            let currentRow = 0;

            // PRIORITY 1: Check blocked pin
            const blockedPins = RUMIStorage.getPinnedBlocked() || [];
            const isBlocked = blockedPins.some(p => String(p.ticketId) === String(ticketId));

            this.addNode({
                id: 'check-blocked',
                label: '① Blocked Pin?',
                type: isBlocked ? 'priority' : 'priority',
                x: xPos,
                y: yPos + (currentRow * rowHeight),
                width: nodeWidth,
                height: nodeHeight,
                description: isBlocked ? '● Found in blocked pins list' : '○ Not in blocked pins list',
                enabled: true
            });
            this.addConnection(lastNodeId, 'check-blocked', 'Priority 1');

            if (isBlocked) {
                xPos += columnSpacing;
                this.addNode({
                    id: 'action-skip',
                    label: '⊘ SKIP',
                    type: 'action',
                    x: xPos,
                    y: yPos + (currentRow * rowHeight),
                    width: nodeWidth,
                    height: nodeHeight,
                    description: 'REASON: Ticket is blocked\nACTION: No processing\nRULE: Highest priority - overrides all'
                });
                this.addConnection('check-blocked', 'action-skip', 'BLOCKED');
                return;
            }
            lastNodeId = 'check-blocked';
            currentRow++;

            // PRIORITY 2: Check care routing pin
            const careRoutingPins = RUMIStorage.getPinnedCareRouting() || [];
            const isCarePinned = careRoutingPins.some(p => String(p.ticketId) === String(ticketId) && p.status === 'active');

            this.addNode({
                id: 'check-care-pin',
                label: '② Care Pin?',
                type: 'priority',
                x: xPos,
                y: yPos + (currentRow * rowHeight),
                width: nodeWidth,
                height: nodeHeight,
                description: isCarePinned ? '● Pinned for Care routing' : '○ Not Care pinned',
                enabled: true
            });
            this.addConnection(lastNodeId, 'check-care-pin', 'Not blocked');

            if (isCarePinned) {
                xPos += columnSpacing;
                this.addNode({
                    id: 'action-care-pin',
                    label: '→ ROUTE TO CARE',
                    type: 'action',
                    x: xPos,
                    y: yPos + (currentRow * rowHeight),
                    width: nodeWidth,
                    height: nodeHeight,
                    description: 'REASON: Care routing pin active\nACTION: group_id = 20705088\nRULE: Priority 2'
                });
                this.addConnection('check-care-pin', 'action-care-pin', 'PINNED');
                return;
            }
            lastNodeId = 'check-care-pin';
            currentRow++;

            // PRIORITY 3: Check closed status
            const isClosed = ticket.status === 'closed';
            this.addNode({
                id: 'check-closed',
                label: '③ Closed?',
                type: 'priority',
                x: xPos,
                y: yPos + (currentRow * rowHeight),
                width: nodeWidth,
                height: nodeHeight,
                description: isClosed ? `● Status: ${ticket.status}` : `○ Status: ${ticket.status}`,
                enabled: true
            });
            this.addConnection(lastNodeId, 'check-closed', 'Not pinned');

            if (isClosed) {
                xPos += columnSpacing;
                this.addNode({
                    id: 'action-dry-run',
                    label: '⚠ DRY RUN',
                    type: 'action',
                    x: xPos,
                    y: yPos + (currentRow * rowHeight),
                    width: nodeWidth,
                    height: nodeHeight,
                    description: 'REASON: Ticket is closed\nACTION: Process in dry-run mode\nRULE: Closed tickets not modified'
                });
                this.addConnection('check-closed', 'action-dry-run', 'CLOSED');
                return;
            }
            lastNodeId = 'check-closed';
            currentRow++;

            // ============================================================================
            // COMMENT ANALYSIS PHASE - Determine which comment to check for triggers
            // ============================================================================

            let latestCommenter = 'none';
            let commentToCheckInfo = 'No comments';
            let globalCommentToCheck = null;

            if (comments.length > 0) {
                const latestComment = comments[comments.length - 1];
                const latestAuthor = await RUMIProcessor.getUserRole(latestComment.author_id);

                if (latestAuthor.isEndUser) {
                    latestCommenter = 'END-USER';
                    // Trace back to find first CAREEM_CARE_ID comment (for pending/solved triggers)
                    globalCommentToCheck = await RUMIProcessor.findCommentToCheck(comments);
                    if (globalCommentToCheck) {
                        const commentIndex = comments.findIndex(c => c.id === globalCommentToCheck.id);
                        const commentType = globalCommentToCheck.public ? 'Public' : 'Internal';
                        commentToCheckInfo = `Traced back to Comment #${commentIndex + 1} (${commentType}) for Pending/Solved`;
                    } else {
                        commentToCheckInfo = 'Traced back: No CAREEM_CARE_ID found in last 50';
                    }
                } else if (latestComment.author_id.toString() === CONFIG.CAREEM_CARE_ID) {
                    latestCommenter = 'CAREEM_CARE_ID';
                    globalCommentToCheck = latestComment;
                    const commentType = globalCommentToCheck.public ? 'Public' : 'Internal';
                    commentToCheckInfo = `Using latest (${commentType} comment)`;
                } else {
                    latestCommenter = 'OTHER AGENT';
                    commentToCheckInfo = 'No action (not end-user or CAREEM_CARE_ID)';
                }
            }

            this.addNode({
                id: 'comment-analysis',
                label: '◈ COMMENT ANALYSIS',
                type: 'info',
                x: xPos,
                y: yPos + (currentRow * rowHeight),
                width: nodeWidth,
                height: nodeHeight,
                description: `Latest commenter: ${latestCommenter}\n${commentToCheckInfo}\n\nNOTE: Care routing = LATEST comment only\nPending/Solved = Uses trace-back`,
                enabled: true
            });
            this.addConnection(lastNodeId, 'comment-analysis', 'Analyze comments');
            lastNodeId = 'comment-analysis';
            currentRow++;

            // ============================================================================
            // PRIORITY 4: Check #notsafety / care routing phrases (LATEST COMMENT ONLY)
            // ============================================================================
            let carePhrase = null;
            let careCommentDescription = '';
            
            // SOLID RULE: Care routing ONLY checks latest comment (no trace-back)
            // This is different from pending/solved which use trace-back logic
            if (comments.length > 0) {
                const latestComment = comments[comments.length - 1];
                const careTriggerResult = await RUMIProcessor.checkCommentForTriggers(latestComment, settings);

                if (careTriggerResult && careTriggerResult.type === 'care') {
                    carePhrase = careTriggerResult.trigger;
                    careCommentDescription = `✓ Found in LATEST comment: ${careTriggerResult.trigger}`;
                } else {
                    careCommentDescription = '✗ No Care routing triggers in LATEST comment (no trace-back for routing)';
                }
            } else {
                careCommentDescription = 'No comments';
            }

            this.addNode({
                id: 'check-notsafety',
                label: '④ #notsafety?',
                type: 'blocking',
                x: xPos,
                y: yPos + (currentRow * rowHeight),
                width: nodeWidth,
                height: nodeHeight,
                description: carePhrase ?
                    `● Found: "${carePhrase.substring(0, 40)}..."${careCommentDescription}` :
                    '○ No Care routing phrases\n(Used trace-back logic)',
                enabled: true
            });
            this.addConnection(lastNodeId, 'check-notsafety', 'Not closed');

            if (carePhrase) {
                xPos += columnSpacing;
                this.addNode({
                    id: 'action-care-phrase',
                    label: '→ ROUTE TO CARE',
                    type: 'action',
                    x: xPos,
                    y: yPos + (currentRow * rowHeight),
                    width: nodeWidth,
                    height: nodeHeight,
                    description: `REASON: Care phrase matched\nPHRASE: "${carePhrase.substring(0, 30)}..."\nACTION: group_id = 20705088\nRULE: Trace-back + preceding check`
                });
                this.addConnection('check-notsafety', 'action-care-phrase', 'MATCHED');
                return;
            }
            lastNodeId = 'check-notsafety';
            currentRow++;

            // PRIORITY 5: Check Hala tag
            const hasHalaTag = ticket.tags && ticket.tags.includes('ghc_provider_hala-rides');
            this.addNode({
                id: 'check-hala',
                label: '⑤ Hala Tag?',
                type: 'tag-routing',
                x: xPos,
                y: yPos + (currentRow * rowHeight),
                width: nodeWidth,
                height: nodeHeight,
                description: hasHalaTag ? '● Tag: ghc_provider_hala-rides' : '○ No Hala tag',
                enabled: true
            });
            this.addConnection(lastNodeId, 'check-hala', 'No Care phrase');

            if (hasHalaTag) {
                xPos += columnSpacing;
                this.addNode({
                    id: 'action-hala',
                    label: '→ ROUTE TO HALA',
                    type: 'action',
                    x: xPos,
                    y: yPos + (currentRow * rowHeight),
                    width: nodeWidth,
                    height: nodeHeight,
                    description: 'REASON: Hala tag present\nTAG: ghc_provider_hala-rides\nACTION: group_id = 360003368353\nRULE: Tag-based routing'
                });
                this.addConnection('check-hala', 'action-hala', 'HAS TAG');
                return;
            }
            lastNodeId = 'check-hala';
            currentRow++;

            // PRIORITY 6: Check Casablanca tag
            const hasCasablancaTag = ticket.tags && ticket.tags.includes('casablanca');
            this.addNode({
                id: 'check-casablanca',
                label: '⑥ Casablanca Tag?',
                type: 'tag-routing',
                x: xPos,
                y: yPos + (currentRow * rowHeight),
                width: nodeWidth,
                height: nodeHeight,
                description: hasCasablancaTag ? '● Tag: casablanca' : '○ No Casablanca tag',
                enabled: true
            });
            this.addConnection(lastNodeId, 'check-casablanca', 'No Hala tag');

            if (hasCasablancaTag) {
                xPos += columnSpacing;
                this.addNode({
                    id: 'action-casablanca',
                    label: '→ ROUTE TO CASABLANCA',
                    type: 'action',
                    x: xPos,
                    y: yPos + (currentRow * rowHeight),
                    width: nodeWidth + 20,
                    height: nodeHeight,
                    description: 'REASON: Casablanca tag present\nTAG: casablanca\nACTION: group_id = 360011852054\nRULE: Tag-based routing'
                });
                this.addConnection('check-casablanca', 'action-casablanca', 'HAS TAG');
                return;
            }
            lastNodeId = 'check-casablanca';
            currentRow++;

            // PRIORITY 7: Check subject-based Care routing (noActivityDetails)
            const hasNoActivitySubject = ticket.subject &&
                                        ticket.subject.toLowerCase().includes('noActivityDetails available');
            const isNew = ticket.status === 'new';
            const hasPrivateComments = comments.some(c => c.public === false);
            const subjectCareTriggers = hasNoActivitySubject && isNew && !hasPrivateComments;

            this.addNode({
                id: 'check-subject-care',
                label: '⑦ No Activity Subject?',
                type: 'subject',
                x: xPos,
                y: yPos + (currentRow * rowHeight),
                width: nodeWidth,
                height: nodeHeight,
                description: subjectCareTriggers ?
                    '● Subject match + status new + no private comments' :
                    `○ Subject: ${hasNoActivitySubject ? 'Match' : 'No match'}\nStatus: ${ticket.status}\nPrivate comments: ${hasPrivateComments ? 'Yes' : 'No'}`,
                enabled: true
            });
            this.addConnection(lastNodeId, 'check-subject-care', 'No Casablanca');

            if (subjectCareTriggers) {
                xPos += columnSpacing;
                this.addNode({
                    id: 'action-subject-care',
                    label: '→ ROUTE TO CARE',
                    type: 'action',
                    x: xPos,
                    y: yPos + (currentRow * rowHeight),
                    width: nodeWidth,
                    height: nodeHeight,
                    description: 'REASON: Subject-based routing\nSUBJECT: "noActivityDetails..."\nACTION: group_id = 20705088, status = open\nRULE: New tickets without private comments'
                });
                this.addConnection('check-subject-care', 'action-subject-care', 'ALL CONDITIONS MET');
                return;
            }
            lastNodeId = 'check-subject-care';
            currentRow++;

            // PRIORITY 8: Check IRT concern
            let hasIRTConcern = false;
            const isCareemCare = ticket.requester_id && ticket.requester_id.toString() === CONFIG.CAREEM_CARE_ID;
            if (isCareemCare) {
                for (const comment of comments) {
                    const normalized = RUMICommentProcessor.normalizeForMatching(comment.html_body);
                    if (normalized.includes('irt concern has been handled')) {
                        hasIRTConcern = true;
                        break;
                    }
                }
            }

            this.addNode({
                id: 'check-irt',
                label: '⑧ IRT Concern?',
                type: 'subject',
                x: xPos,
                y: yPos + (currentRow * rowHeight),
                width: nodeWidth,
                height: nodeHeight,
                description: hasIRTConcern ?
                    '● IRT concern comment found' :
                    `○ Requester: ${isCareemCare ? 'Careem Care (checking...)' : 'Not Careem Care'}\nIRT phrase: ${isCareemCare ? 'Not found' : 'N/A'}`,
                enabled: true
            });
            this.addConnection(lastNodeId, 'check-irt', 'No subject match');

            if (hasIRTConcern) {
                xPos += columnSpacing;
                this.addNode({
                    id: 'action-irt-care',
                    label: '→ ROUTE TO CARE',
                    type: 'action',
                    x: xPos,
                    y: yPos + (currentRow * rowHeight),
                    width: nodeWidth,
                    height: nodeHeight,
                    description: 'REASON: IRT concern handled\nREQUESTER: Careem Care Agent\nACTION: group_id = 20705088\nRULE: IRT concern routing'
                });
                this.addConnection('check-irt', 'action-irt-care', 'IRT FOUND');
                return;
            }
            lastNodeId = 'check-irt';
            currentRow++;

            // ============================================================================
            // PRIORITY 9: Escalation Response Rule (using ACTUAL processor logic)
            // ============================================================================
            const escalationResult = await RUMIProcessor.evaluateEscalationResponseRules(ticket, comments, settings, null);
            const hasEscalationResponse = escalationResult.action === 'pending';
            let escalationDescription = hasEscalationResponse ?
                `● User/RFR replied after internal ESCALATED phrase\nTrigger: ${escalationResult.trigger}` :
                '○ No escalation response detected';

            this.addNode({
                id: 'check-escalation',
                label: '⑨ Escalation Response?',
                type: 'escalation',
                x: xPos,
                y: yPos + (currentRow * rowHeight),
                width: nodeWidth,
                height: nodeHeight,
                description: `Check: ESCALATED_BUT_NO_RESPONSE\n${escalationDescription}`,
                enabled: true
            });
            this.addConnection(lastNodeId, 'check-escalation', 'No IRT');

            if (hasEscalationResponse) {
                xPos += columnSpacing;
                this.addNode({
                    id: 'action-escalation-pending',
                    label: '⏱ SET PENDING',
                    type: 'action',
                    x: xPos,
                    y: yPos + (currentRow * rowHeight),
                    width: nodeWidth,
                    height: nodeHeight,
                    description: 'REASON: User/RFR responded after escalation\nTRIGGER: ESCALATED_BUT_NO_RESPONSE\nACTION: status = pending, assignee = Careem Care\nRULE: Escalation response handling'
                });
                this.addConnection('check-escalation', 'action-escalation-pending', 'RESPONDED');
                return;
            }
            lastNodeId = 'check-escalation';
            currentRow++;

            // ============================================================================
            // PRIORITY 10: Check pending triggers (using ACTUAL processor logic)
            // ============================================================================
            const pendingResult = await RUMIProcessor.evaluatePendingRules(ticket, comments, settings, null);
            const hasPending = pendingResult.action === 'pending';
            let pendingPhrase = hasPending ? pendingResult.trigger : null;
            let pendingCommentDescription = hasPending ?
                `Trigger: ${pendingResult.trigger}` :
                'No pending trigger phrases found';

            this.addNode({
                id: 'check-pending',
                label: '⑩ Pending Trigger?',
                type: 'comment-action',
                x: xPos,
                y: yPos + (currentRow * rowHeight),
                width: nodeWidth,
                height: nodeHeight,
                description: pendingPhrase ?
                    `● Found: "${pendingPhrase.substring(0, 35)}..."${pendingCommentDescription}` :
                    '○ No pending trigger phrases\n(Used trace-back + preceding check)',
                enabled: true
            });
            this.addConnection(lastNodeId, 'check-pending', 'No escalation');

            if (pendingPhrase) {
                xPos += columnSpacing;
                this.addNode({
                    id: 'action-pending',
                    label: '⏱ SET PENDING',
                    type: 'action',
                    x: xPos,
                    y: yPos + (currentRow * rowHeight),
                    width: nodeWidth,
                    height: nodeHeight,
                    description: `REASON: Pending phrase matched\nPHRASE: "${pendingPhrase.substring(0, 30)}..."\nACTION: status = pending, assignee = Careem Care\nRULE: Trace-back + preceding check`
                });
                this.addConnection('check-pending', 'action-pending', 'MATCHED');
                return;
            }
            lastNodeId = 'check-pending';
            currentRow++;

            // ============================================================================
            // PRIORITY 11: Check solved triggers (using ACTUAL processor logic)
            // ============================================================================
            const solvedResult = await RUMIProcessor.evaluateSolvedRules(ticket, comments, settings);
            const hasSolved = solvedResult.action === 'solved';
            let solvedPhrase = hasSolved ? solvedResult.trigger : null;
            let solvedCommentDescription = hasSolved ?
                `Trigger: ${solvedResult.trigger}` :
                'No solved trigger phrases found';

            this.addNode({
                id: 'check-solved',
                label: '⑪ Solved Trigger?',
                type: 'comment-action',
                x: xPos,
                y: yPos + (currentRow * rowHeight),
                width: nodeWidth,
                height: nodeHeight,
                description: solvedPhrase ?
                    `● Found: "${solvedPhrase.substring(0, 35)}..."${solvedCommentDescription}` :
                    '○ No solved trigger phrases\n(Used trace-back + preceding check)',
                enabled: true
            });
            this.addConnection(lastNodeId, 'check-solved', 'No pending');

            if (solvedPhrase) {
                xPos += columnSpacing;
                this.addNode({
                    id: 'action-solved',
                    label: '✓ SET SOLVED',
                    type: 'action',
                    x: xPos,
                    y: yPos + (currentRow * rowHeight),
                    width: nodeWidth,
                    height: nodeHeight,
                    description: `REASON: Solved phrase matched\nPHRASE: "${solvedPhrase.substring(0, 30)}..."\nACTION: status = solved, assignee = current user\nRULE: Trace-back + preceding check`
                });
                this.addConnection('check-solved', 'action-solved', 'MATCHED');
                return;
            }
            lastNodeId = 'check-solved';
            currentRow++;

            // ============================================================================
            // No action - all checks failed
            // ============================================================================
            xPos += columnSpacing;
            this.addNode({
                id: 'action-none',
                label: '○ NO ACTION',
                type: 'action',
                x: xPos,
                y: yPos + (currentRow * rowHeight),
                width: nodeWidth,
                height: nodeHeight,
                description: 'REASON: No rules matched\nCHECKS: All 11 priority checks passed\nACTION: None - ticket unchanged\nRULE: Default fallthrough'
            });
            this.addConnection(lastNodeId, 'action-none', 'No solved');
        }

        static render() {
            if (!this.ctx) return;

            // Clear canvas
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

            // If no ticket is being visualized, show placeholder
            if (!this.visualizingTicket || this.nodes.length === 0) {
                this.drawPlaceholder();
                return;
            }

            // Apply transformations
            this.ctx.save();
            this.ctx.translate(this.panX, this.panY);
            this.ctx.scale(this.zoom, this.zoom);

            // Draw connections first (behind nodes)
            this.drawConnections();

            // Draw nodes
            this.drawNodes();

            this.ctx.restore();
        }

        static drawPlaceholder() {
            const theme = document.getElementById('rumi-root')?.getAttribute('data-theme') || 'light';
            const textColor = theme === 'dark' ? '#F9FAFB' : '#111827';
            const secondaryColor = theme === 'dark' ? '#D1D5DB' : '#6B7280';

            this.ctx.fillStyle = textColor;
            this.ctx.font = '24px -apple-system, sans-serif';
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';

            const centerX = this.canvas.width / 2;
            const centerY = this.canvas.height / 2;

            // Main message
            this.ctx.fillText('Enter a Ticket ID to Visualize Processing Path', centerX, centerY - 40);

            // Secondary instructions
            this.ctx.fillStyle = secondaryColor;
            this.ctx.font = '16px -apple-system, sans-serif';
            this.ctx.fillText('Type a ticket ID above and click "Visualize Ticket"', centerX, centerY + 10);
            this.ctx.fillText('to see exactly how that ticket would be processed', centerX, centerY + 35);

            // Icon
            this.ctx.font = '48px -apple-system, sans-serif';
            this.ctx.fillText('◆', centerX, centerY - 100);
        }

        static drawConnections() {
            const theme = document.getElementById('rumi-root')?.getAttribute('data-theme') || 'light';
            const lineColor = theme === 'dark' ? '#9CA3AF' : '#6B7280';
            const highlightColor = '#3B82F6';

            this.connections.forEach(conn => {
                const fromNode = this.nodes.find(n => n.id === conn.from);
                const toNode = this.nodes.find(n => n.id === conn.to);

                if (!fromNode || !toNode) return;

                // Check if this connection is part of highlighted path
                const isHighlighted = this.highlightedPath.some(
                    path => path.from === conn.from && path.to === conn.to
                );

                this.ctx.strokeStyle = isHighlighted ? highlightColor : lineColor;
                this.ctx.lineWidth = isHighlighted ? 3 : 2;
                this.ctx.setLineDash(isHighlighted ? [] : []);

                // Draw connection with right-angled lines for clean lane-based flow
                this.ctx.beginPath();
                const fromX = fromNode.x + fromNode.width / 2;
                const fromY = fromNode.y;
                const toX = toNode.x - toNode.width / 2;
                const toY = toNode.y;

                // Horizontal connection in the same lane
                if (Math.abs(fromY - toY) < 5) {
                    this.ctx.moveTo(fromX, fromY);
                    this.ctx.lineTo(toX, toY);
                } else {
                    // Stepped connection for different lanes
                    const midX = fromX + (toX - fromX) / 2;
                    this.ctx.moveTo(fromX, fromY);
                    this.ctx.lineTo(midX, fromY);
                    this.ctx.lineTo(midX, toY);
                    this.ctx.lineTo(toX, toY);
                }

                this.ctx.stroke();

                // Draw arrow pointing left (into the node)
                this.drawArrow(toX, toY, isHighlighted ? highlightColor : lineColor);

                // Draw label if exists - position it near the start of the arrow
                if (conn.label) {
                    this.ctx.fillStyle = theme === 'dark' ? '#F9FAFB' : '#111827';
                    this.ctx.font = 'bold 11px -apple-system, sans-serif';
                    this.ctx.textAlign = 'center';
                    this.ctx.textBaseline = 'middle';

                    // Position label near the connection line
                    const labelX = fromX + (toX - fromX) * 0.7;
                    const labelY = Math.abs(fromY - toY) < 5 ? fromY - 12 : (fromY + toY) / 2;

                    // Background for label readability
                    const labelWidth = this.ctx.measureText(conn.label).width + 8;
                    this.ctx.fillStyle = theme === 'dark' ? 'rgba(17, 24, 39, 0.9)' : 'rgba(255, 255, 255, 0.9)';
                    this.ctx.fillRect(labelX - labelWidth / 2, labelY - 8, labelWidth, 16);

                    // Draw label text
                    this.ctx.fillStyle = isHighlighted ? highlightColor : (theme === 'dark' ? '#F9FAFB' : '#111827');
                    this.ctx.fillText(conn.label, labelX, labelY);
                }
            });
        }

        static drawArrow(x, y, color) {
            const arrowSize = 10;
            this.ctx.fillStyle = color;
            this.ctx.beginPath();
            // Arrow pointing left (into the node from the right)
            this.ctx.moveTo(x, y);
            this.ctx.lineTo(x + arrowSize, y - arrowSize / 2);
            this.ctx.lineTo(x + arrowSize, y + arrowSize / 2);
            this.ctx.closePath();
            this.ctx.fill();
        }

        static drawNodes() {
            const theme = document.getElementById('rumi-root')?.getAttribute('data-theme') || 'light';
            const textColor = theme === 'dark' ? '#F9FAFB' : '#111827';
            const borderColor = theme === 'dark' ? '#374151' : '#E6E9EB';

            this.nodes.forEach(node => {
                const isHovered = this.hoveredNode === node.id;
                const isSelected = this.selectedNode === node.id;
                const isInPath = this.highlightedPath.some(p => p.from === node.id || p.to === node.id);

                // Determine node color based on type and state
                let nodeColor = this.getNodeColor(node.type, theme);
                if (node.enabled === false) {
                    nodeColor = theme === 'dark' ? '#4B5563' : '#D1D5DB';
                }

                // Draw node background
                this.ctx.fillStyle = nodeColor;
                this.ctx.strokeStyle = isSelected || isInPath ? '#3B82F6' : borderColor;
                this.ctx.lineWidth = isSelected || isInPath ? 3 : 2;

                const x = node.x - node.width / 2;
                const y = node.y - node.height / 2;

                this.ctx.beginPath();
                this.roundRect(x, y, node.width, node.height, 8);
                this.ctx.fill();
                this.ctx.stroke();

                // Draw node label
                this.ctx.fillStyle = textColor;
                this.ctx.font = `600 ${node.type === 'entry' ? '14px' : '12px'} -apple-system, sans-serif`;
                this.ctx.textAlign = 'center';
                this.ctx.textBaseline = 'middle';

                // Text wrapping for long labels
                const maxWidth = node.width - 20;
                const words = node.label.split(' ');
                let line = '';
                let lines = [];

                words.forEach(word => {
                    const testLine = line + word + ' ';
                    const metrics = this.ctx.measureText(testLine);
                    if (metrics.width > maxWidth && line !== '') {
                        lines.push(line);
                        line = word + ' ';
                    } else {
                        line = testLine;
                    }
                });
                lines.push(line);

                const lineHeight = 16;
                const startY = node.y - (lines.length * lineHeight) / 2 + lineHeight / 2;
                lines.forEach((line, i) => {
                    this.ctx.fillText(line.trim(), node.x, startY + i * lineHeight);
                });

                // Draw hover indicator
                if (isHovered) {
                    this.ctx.strokeStyle = '#3B82F6';
                    this.ctx.lineWidth = 2;
                    this.ctx.setLineDash([5, 5]);
                    this.ctx.beginPath();
                    this.roundRect(x - 4, y - 4, node.width + 8, node.height + 8, 10);
                    this.ctx.stroke();
                    this.ctx.setLineDash([]);
                }
            });
        }

        static roundRect(x, y, width, height, radius) {
            this.ctx.moveTo(x + radius, y);
            this.ctx.lineTo(x + width - radius, y);
            this.ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
            this.ctx.lineTo(x + width, y + height - radius);
            this.ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
            this.ctx.lineTo(x + radius, y + height);
            this.ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
            this.ctx.lineTo(x, y + radius);
            this.ctx.quadraticCurveTo(x, y, x + radius, y);
            this.ctx.closePath();
        }

        static getNodeColor(type, theme) {
            const colors = {
                'entry': theme === 'dark' ? '#6B7280' : '#9CA3AF',
                'priority': '#EF4444',
                'tag-routing': theme === 'dark' ? '#A78BFA' : '#8B5CF6',
                'comment-action': theme === 'dark' ? '#34D399' : '#10B981',
                'subject': theme === 'dark' ? '#FBBF24' : '#F59E0B',
                'blocking': theme === 'dark' ? '#F87171' : '#DC2626',
                'info': theme === 'dark' ? '#3B82F6' : '#60A5FA',
                'escalation': theme === 'dark' ? '#F472B6' : '#EC4899',
                'action': theme === 'dark' ? '#60A5FA' : '#3B82F6'
            };
            return colors[type] || '#9CA3AF';
        }

        static attachEventListeners() {
            // Zoom controls
            document.getElementById('rumi-visual-rules-zoom-in')?.addEventListener('click', () => this.zoomIn());
            document.getElementById('rumi-visual-rules-zoom-out')?.addEventListener('click', () => this.zoomOut());
            document.getElementById('rumi-visual-rules-fit')?.addEventListener('click', () => this.fitToScreen());
            document.getElementById('rumi-visual-rules-reset')?.addEventListener('click', () => this.resetView());

            // Ticket visualization controls
            document.getElementById('rumi-visual-rules-visualize-btn')?.addEventListener('click', () => this.visualizeTicket());
            document.getElementById('rumi-visual-rules-clear-btn')?.addEventListener('click', () => this.clearVisualization());
            document.getElementById('rumi-visual-rules-refresh-btn')?.addEventListener('click', () => this.refresh());

            // Ticket input - Enter key support
            const ticketInput = document.getElementById('rumi-visual-rules-ticket-input');
            if (ticketInput) {
                ticketInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        this.visualizeTicket();
                    }
                });
            }

            // Legend toggle
            document.getElementById('rumi-visual-rules-legend-toggle')?.addEventListener('click', () => this.toggleLegend());

            // Canvas interactions
            if (this.canvas) {
                this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
                this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
                this.canvas.addEventListener('mouseup', () => this.handleMouseUp());
                this.canvas.addEventListener('mouseleave', () => this.handleMouseUp());
                this.canvas.addEventListener('wheel', (e) => this.handleWheel(e));
                this.canvas.addEventListener('click', (e) => this.handleClick(e));
            }

            // Window resize
            window.addEventListener('resize', () => {
                this.resizeCanvas();
                this.render();
            });

            // Keyboard navigation
            document.addEventListener('keydown', (e) => this.handleKeyDown(e));
        }

        static handleMouseDown(e) {
            this.isDragging = true;
            this.dragStartX = e.clientX - this.panX;
            this.dragStartY = e.clientY - this.panY;
            this.canvas.classList.add('panning');
        }

        static handleMouseMove(e) {
            if (this.isDragging) {
                this.panX = e.clientX - this.dragStartX;
                this.panY = e.clientY - this.dragStartY;
                this.render();
            } else {
                // Check for node hover
                const rect = this.canvas.getBoundingClientRect();
                const mouseX = (e.clientX - rect.left - this.panX) / this.zoom;
                const mouseY = (e.clientY - rect.top - this.panY) / this.zoom;

                const hoveredNode = this.getNodeAt(mouseX, mouseY);
                if (hoveredNode !== this.hoveredNode) {
                    this.hoveredNode = hoveredNode;
                    this.render();

                    if (hoveredNode) {
                        const node = this.nodes.find(n => n.id === hoveredNode);
                        this.showTooltip(e.clientX, e.clientY, node);
                    } else {
                        this.hideTooltip();
                    }
                }
            }
        }

        static handleMouseUp() {
            this.isDragging = false;
            this.canvas.classList.remove('panning');
        }

        static handleWheel(e) {
            e.preventDefault();
            const delta = e.deltaY > 0 ? 0.9 : 1.1;
            const newZoom = this.zoom * delta;

            if (newZoom >= 0.3 && newZoom <= 3) {
                const rect = this.canvas.getBoundingClientRect();
                const mouseX = e.clientX - rect.left;
                const mouseY = e.clientY - rect.top;

                this.panX = mouseX - (mouseX - this.panX) * (newZoom / this.zoom);
                this.panY = mouseY - (mouseY - this.panY) * (newZoom / this.zoom);
                this.zoom = newZoom;

                this.render();
            }
        }

        static handleClick(e) {
            const rect = this.canvas.getBoundingClientRect();
            const mouseX = (e.clientX - rect.left - this.panX) / this.zoom;
            const mouseY = (e.clientY - rect.top - this.panY) / this.zoom;

            const clickedNode = this.getNodeAt(mouseX, mouseY);
            if (clickedNode) {
                this.selectedNode = clickedNode;
                this.render();
                RUMILogger.info('VisualRules', 'Node selected', { nodeId: clickedNode });
            } else {
                this.selectedNode = null;
                this.render();
            }
        }

        static handleKeyDown(e) {
            // Only handle if visual rules is active
            if (!document.querySelector('.rumi-visual-rules-container')) return;

            switch (e.key) {
                case '+':
                case '=':
                    this.zoomIn();
                    break;
                case '-':
                case '_':
                    this.zoomOut();
                    break;
                case '0':
                    this.resetView();
                    break;
                case 'f':
                case 'F':
                    this.fitToScreen();
                    break;
                case 'Escape':
                    this.clearVisualization();
                    break;
            }
        }

        static getNodeAt(x, y) {
            for (let i = this.nodes.length - 1; i >= 0; i--) {
                const node = this.nodes[i];
                const halfWidth = node.width / 2;
                const halfHeight = node.height / 2;

                if (x >= node.x - halfWidth && x <= node.x + halfWidth &&
                    y >= node.y - halfHeight && y <= node.y + halfHeight) {
                    return node.id;
                }
            }
            return null;
        }

        static showTooltip(x, y, node) {
            if (!node) return;

            let tooltip = document.getElementById('rumi-visual-rules-tooltip');
            if (!tooltip) {
                tooltip = document.createElement('div');
                tooltip.id = 'rumi-visual-rules-tooltip';
                tooltip.className = 'rumi-visual-rules-tooltip';
                document.body.appendChild(tooltip);
            }

            tooltip.innerHTML = `
                <div class="rumi-visual-rules-tooltip-title">${RUMIUI.escapeHtml(node.label)}</div>
                <div class="rumi-visual-rules-tooltip-description">${RUMIUI.escapeHtml(node.description || '')}</div>
                ${node.enabled === false ? '<div class="rumi-visual-rules-tooltip-description" style="color: var(--rumi-accent-red); margin-top: 6px;">⚠ Disabled in settings</div>' : ''}
            `;

            tooltip.style.left = `${x + 10}px`;
            tooltip.style.top = `${y + 10}px`;
            tooltip.style.display = 'block';
        }

        static hideTooltip() {
            const tooltip = document.getElementById('rumi-visual-rules-tooltip');
            if (tooltip) {
                tooltip.style.display = 'none';
            }
        }

        static zoomIn() {
            if (this.zoom < 3) {
                this.zoom *= 1.2;
                this.render();
                RUMILogger.debug('VisualRules', 'Zoomed in', { zoom: this.zoom });
            }
        }

        static zoomOut() {
            if (this.zoom > 0.3) {
                this.zoom *= 0.8;
                this.render();
                RUMILogger.debug('VisualRules', 'Zoomed out', { zoom: this.zoom });
            }
        }

        static fitToScreen() {
            // Calculate bounding box of all nodes
            if (this.nodes.length === 0) return;

            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

            this.nodes.forEach(node => {
                minX = Math.min(minX, node.x - node.width / 2);
                maxX = Math.max(maxX, node.x + node.width / 2);
                minY = Math.min(minY, node.y - node.height / 2);
                maxY = Math.max(maxY, node.y + node.height / 2);
            });

            const contentWidth = maxX - minX;
            const contentHeight = maxY - minY;
            const padding = 50;

            const scaleX = (this.canvas.width - padding * 2) / contentWidth;
            const scaleY = (this.canvas.height - padding * 2) / contentHeight;
            this.zoom = Math.min(scaleX, scaleY, 1);

            const centerX = (minX + maxX) / 2;
            const centerY = (minY + maxY) / 2;

            this.panX = this.canvas.width / 2 - centerX * this.zoom;
            this.panY = this.canvas.height / 2 - centerY * this.zoom;

            this.render();
            RUMILogger.info('VisualRules', 'Fit to screen');
        }

        static resetView() {
            this.zoom = 1;
            this.panX = 0;
            this.panY = 0;
            this.render();
            RUMILogger.info('VisualRules', 'View reset');
        }

        static toggleLegend() {
            const legend = document.getElementById('rumi-visual-rules-legend');
            const toggle = document.getElementById('rumi-visual-rules-legend-toggle');
            if (legend && toggle) {
                legend.classList.toggle('collapsed');
                toggle.textContent = legend.classList.contains('collapsed') ? 'Expand' : 'Collapse';
            }
        }

        static async visualizeTicket() {
            const ticketInput = document.getElementById('rumi-visual-rules-ticket-input');
            if (!ticketInput) return;

            const ticketId = ticketInput.value.trim();
            if (!ticketId) {
                RUMIUI.showToast('Please enter a ticket ID', 'error');
                return;
            }

            try {
                RUMILogger.info('VisualRules', 'Ticket visualization requested', { ticketId });
                RUMIUI.showToast('Fetching ticket data...', 'info');

                // Fetch ticket data
                const ticketData = await RUMIAPIManager.get(`/api/v2/tickets/${ticketId}.json`);
                const commentsData = await RUMIAPIManager.get(`/api/v2/tickets/${ticketId}/comments.json`);

                const ticket = ticketData.ticket;
                const comments = commentsData.comments || [];

                // Clear and prepare for visualization
                this.nodes = [];
                this.connections = [];
                this.highlightedPath = [];
                this.visualizingTicket = ticketId;

                // Build only the path for this specific ticket
                await this.buildTicketPath(ticket, comments);

                // Render the flowchart
                this.render();

                // Fit to screen for optimal view
                setTimeout(() => {
                    this.fitToScreen();
                }, 50);

                // Determine the result
                const lastNode = this.nodes[this.nodes.length - 1];
                let result = 'unknown';
                if (lastNode.id.startsWith('action-')) {
                    result = lastNode.label;
                }

                RUMIUI.showToast(`Ticket #${ticketId} visualized: ${result}`, 'success');
                RUMILogger.info('VisualRules', 'Ticket visualization completed', {
                    ticketId,
                    nodeCount: this.nodes.length,
                    result
                });

            } catch (error) {
                RUMILogger.error('VisualRules', 'Failed to visualize ticket', { ticketId, error: error.message });
                RUMIUI.showToast('Failed to fetch ticket data. Check ticket ID.', 'error');
                this.clearVisualization();
            }
        }

        static clearVisualization() {
            this.highlightedPath = [];
            this.visualizingTicket = null;
            this.selectedNode = null;
            this.nodes = [];
            this.connections = [];
            this.zoom = 1;
            this.panX = 0;
            this.panY = 0;
            const ticketInput = document.getElementById('rumi-visual-rules-ticket-input');
            if (ticketInput) ticketInput.value = '';
            this.render();
            RUMIUI.showToast('Visualization cleared', 'info');
            RUMILogger.info('VisualRules', 'Ticket visualization cleared');
        }

        static refresh() {
            this.clearVisualization();
            RUMIUI.showToast('View reset', 'success');
            RUMILogger.info('VisualRules', 'View reset');
        }

        static showError(message) {
            const wrapper = document.getElementById('rumi-visual-rules-canvas-wrapper');
            if (wrapper) {
                const loading = document.getElementById('rumi-visual-rules-loading');
                if (loading) loading.style.display = 'none';

                const errorDiv = document.createElement('div');
                errorDiv.className = 'rumi-visual-rules-error';
                errorDiv.textContent = message;
                wrapper.appendChild(errorDiv);
            }
        }
    }

    // ============================================================================
    // INITIALIZATION
    // ============================================================================

    function hideZendeskUI() {
        try {
            // We need full control over the interface, so hide Zendesk's default UI
            // without actually removing it (safer for page scripts that may reference these elements)
            const selectors = ['#root', 'body > .app', 'body > main', '[data-garden-id="chrome"]'];
            selectors.forEach(sel => {
                document.querySelectorAll(sel).forEach(el => {
                    if (el.id !== 'rumi-root') {
                        el.style.display = 'none';
                    }
                });
            });
        } catch (error) {
            RUMILogger.error('INIT', 'Failed to hide Zendesk UI', { error: error.message });
        }
    }

    function injectStyles() {
        try {
            const styleEl = document.createElement('style');
            styleEl.textContent = CSS_STYLES;
            document.head.appendChild(styleEl);
        } catch (error) {
            RUMILogger.error('INIT', 'Failed to inject styles', { error: error.message });
        }
    }

    function injectHTML() {
        try {
            const container = document.createElement('div');
            container.innerHTML = HTML_TEMPLATE;
            document.body.appendChild(container.firstElementChild);
        } catch (error) {
            RUMILogger.error('INIT', 'Failed to inject HTML', { error: error.message });
        }
    }

    async function initRUMI() {
        try {
            RUMILogger.info('INIT', 'Phase 2 initialization starting');

            hideZendeskUI();
            injectStyles();
            injectHTML();

            await RUMIAPIManager.init();
            await RUMIProcessor.init();
            await RUMIUI.init();

            // Expose RUMIUI to window for inline event handlers
            window.RUMIUI = RUMIUI;

            RUMILogger.info('INIT', 'Phase 2 ready - monitoring and processing enabled');
        } catch (error) {
            // If initialization fails, log it but don't crash - user might be able to refresh
            RUMILogger.error('INIT', 'Failed to initialize', { error: error.message });
            alert('RUMI initialization failed. Please refresh the page or check console for details.');
        }
    }

    // Script may load before DOM is ready, or after - handle both cases
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initRUMI);
    } else {
        initRUMI();
    }

})();
