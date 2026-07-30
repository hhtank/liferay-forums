// SPDX-License-Identifier: LGPL-2.1-or-later
var messageDetail = fragmentElement.querySelector('#forumsMessageDetail');

if (messageDetail) {
	var portalURL = Liferay.ThemeDisplay.getPortalURL();
	var scopeGroupId = Liferay.ThemeDisplay.getScopeGroupId();
	var pathFriendlyURLPublic = Liferay.ThemeDisplay.getPathFriendlyURLPublic();
	var sitePrefix = '';
	if (pathFriendlyURLPublic) {
		var pubPath = pathFriendlyURLPublic + '/';
		if (window.location.pathname.indexOf(pubPath) === 0) {
			var rest = window.location.pathname.substring(pubPath.length);
			var slugEnd = rest.indexOf('/');
			var siteSlug = slugEnd === -1 ? rest : rest.substring(0, slugEnd);
			sitePrefix = pathFriendlyURLPublic + '/' + siteSlug;
		}
	}
	var currentUserId = Liferay.ThemeDisplay.getUserId();

	/* Mentions render in the OOTB shape -- a "@screenName" token in a
	   <span class="lfr-ac-content"> (or a bare text token from CKEditor 5).
	   Neither navigates, so no click handling is needed. */

	var headers = {
		'Accept': 'application/json',
		'Content-Type': 'application/json'
	};
	var clayIconsUrl = Liferay.ThemeDisplay.getPathThemeImages() + '/clay/icons.svg';

	/* DOM refs */
	var titleEl = messageDetail.querySelector('#forumsDetailTitle');
	var loadingEl = messageDetail.querySelector('#forumsDetailLoading');
	var opSection = messageDetail.querySelector('#forumsDetailOP');
	var opBody = messageDetail.querySelector('#forumsDetailOPBody');
	var opAttachments = messageDetail.querySelector('#forumsDetailOPAttachments');
	var opAvatar = messageDetail.querySelector('#forumsDetailOPAvatar');
	var opAuthor = messageDetail.querySelector('#forumsDetailOPAuthor');
	var opDate = messageDetail.querySelector('#forumsDetailOPDate');
	var opTags = messageDetail.querySelector('#forumsDetailOPTags');
	var solvedBanner = messageDetail.querySelector('#forumsDetailSolvedBanner');
	var solutionSection = messageDetail.querySelector('#forumsDetailSolutionSection');
	var solutionCards = messageDetail.querySelector('#forumsDetailSolutionCards');
	var repliesSection = messageDetail.querySelector('#forumsDetailRepliesSection');
	var replyCards = messageDetail.querySelector('#forumsDetailReplyCards');
	var replyCountEl = messageDetail.querySelector('#forumsDetailReplyCount');
	var replyBtn = messageDetail.querySelector('#forumsDetailReplyBtn');
	var flagBtn = messageDetail.querySelector('#forumsDetailFlagBtn');
	/* HATEOAS: hide write-action buttons by default; show after API confirms permission */
	if (replyBtn) {
		replyBtn.style.display = 'none';
		replyBtn.setAttribute('title', messageDetail.dataset.labelComment || 'Comment');
		replyBtn.setAttribute('aria-label', messageDetail.dataset.labelComment || 'Comment');
	}
	if (flagBtn) flagBtn.style.display = 'none';

	/* "View the Solution" scrolls the accepted-solution card into view and
	   flashes its highlight, rather than jumping to the top of the solution
	   section. */
	var viewSolutionLink = messageDetail.querySelector('#forumsDetailViewSolution');
	if (viewSolutionLink) {
		viewSolutionLink.addEventListener('click', function(e) {
			e.preventDefault();
			var solutionCard = messageDetail.querySelector('.forums-message-detail__reply-card--solution');
			if (!solutionCard) return;
			/* Scroll the card near the top of the viewport. When an admin is
			   signed in, the fixed Control Menu (.control-menu-container) sits
			   at the top z-order, so offset the scroll by its height to keep the
			   card from being hidden behind it. */
			var controlMenu = document.querySelector('.control-menu-container');
			var offset = (controlMenu ? controlMenu.offsetHeight : 0) + 12;
			var top = solutionCard.getBoundingClientRect().top + window.pageYOffset - offset;
			window.scrollTo({ top: top, behavior: 'smooth' });
			/* Remove + reflow + re-add so the flash replays on every click. */
			solutionCard.classList.remove('forums-message-detail__reply-card--targeted');
			void solutionCard.offsetWidth;
			solutionCard.classList.add('forums-message-detail__reply-card--targeted');
		});
	}

	var breadcrumbCategory = messageDetail.querySelector('#forumsDetailBreadcrumbCategory');
	var breadcrumbMessage = messageDetail.querySelector('#forumsDetailBreadcrumbMessage');
	var allTopicsLink = messageDetail.querySelector('#forumsDetailAllTopics');
	var categoryLink = messageDetail.querySelector('#forumsDetailCategoryLink');

	if (allTopicsLink) {
		allTopicsLink.href = sitePrefix + ((typeof configuration !== 'undefined' && configuration.communityURL) ? configuration.communityURL : '/forums');
	}

	// Point the first breadcrumb crumb ("Forums") at the configured community home
	var communityBreadcrumb = messageDetail.querySelector('#forumsDetailBreadcrumb li:first-child a');
	if (communityBreadcrumb) {
		communityBreadcrumb.href = sitePrefix + ((typeof configuration !== 'undefined' && configuration.communityURL) ? configuration.communityURL : '/forums');
	}
	var replyPaginationNav = messageDetail.querySelector('#forumsDetailReplyPagination');
	var replyPaginationUl = messageDetail.querySelector('#forumsDetailReplyPaginationUl');

	/* URL params */
	var urlParams = new URLSearchParams(window.location.search);
	var messageId = urlParams.get('messageId');

	/* Options Dropdown Vanilla JS Fallback */
	var optionsBtn = messageDetail.querySelector('#forumsDetailOptions');
	if (optionsBtn && Liferay.ThemeDisplay.isSignedIn()) {
		var optionsDropdown = messageDetail.querySelector('#forumsDetailOptionsDropdown');
		if (optionsDropdown) optionsDropdown.style.display = '';
		var optionsMenu = optionsBtn.nextElementSibling;
		optionsBtn.addEventListener('click', function(e) {
			e.preventDefault();
			if (optionsMenu) {
				var expanded = optionsMenu.classList.toggle('show');
				optionsBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
			}
		});
		document.addEventListener('click', function(e) {
			if (optionsMenu && !optionsBtn.contains(e.target) && !optionsMenu.contains(e.target)) {
				optionsMenu.classList.remove('show');
				optionsBtn.setAttribute('aria-expanded', 'false');
			}
		});
		document.addEventListener('keydown', function(e) {
			if (e.key === 'Escape' && optionsMenu && optionsMenu.classList.contains('show')) {
				optionsMenu.classList.remove('show');
				optionsBtn.setAttribute('aria-expanded', 'false');
				optionsBtn.focus();
			}
		});
	}

	/* Reply options dropdown vanilla JS fallback (delegated: reply cards are
	   re-rendered on pagination, so we bind once on the fragment root). The menu
	   is positioned `fixed` while open so an ancestor's overflow:hidden (the page
	   / section wrapper) cannot clip it. */
	function closeReplyOptionMenus(except) {
		messageDetail.querySelectorAll('.forums-message-detail__reply-options .dropdown-menu.show').forEach(function (menu) {
			if (menu === except) return;
			menu.classList.remove('show');
			menu.style.position = '';
			menu.style.top = '';
			menu.style.left = '';
			menu.style.right = '';
			menu.style.zIndex = '';
			var toggle = menu.previousElementSibling;
			if (toggle) toggle.setAttribute('aria-expanded', 'false');
		});
	}
	messageDetail.addEventListener('click', function (e) {
		var toggle = e.target.closest('[id^="forumsReplyOptions_"]');
		if (!toggle) return;
		e.preventDefault();
		var menu = toggle.nextElementSibling;
		if (!menu || !menu.classList.contains('dropdown-menu')) return;
		var willOpen = !menu.classList.contains('show');
		closeReplyOptionMenus(menu);
		if (willOpen) {
			var rect = toggle.getBoundingClientRect();
			menu.style.position = 'fixed';
			menu.style.top = Math.round(rect.bottom + 2) + 'px';
			menu.style.left = 'auto';
			menu.style.right = Math.round(window.innerWidth - rect.right) + 'px';
			menu.style.zIndex = '1050';
		}
		menu.classList.toggle('show', willOpen);
		toggle.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
	});
	document.addEventListener('click', function (e) {
		if (!e.target.closest('.forums-message-detail__reply-options')) closeReplyOptionMenus(null);
	});
	document.addEventListener('keydown', function (e) {
		if (e.key === 'Escape') closeReplyOptionMenus(null);
	});
	window.addEventListener('scroll', function () { closeReplyOptionMenus(null); }, true);
	window.addEventListener('resize', function () { closeReplyOptionMenus(null); });

	function runMessageDetail(resolvedMessageId, replyId) {
	messageId = resolvedMessageId;
	var targetReplyId = replyId || null;
	var skeletonShownAt = Date.now();
	if (!messageId) {
		if (loadingEl) loadingEl.innerHTML = '<div class="forums-message-list__empty text-secondary text-center py-5">' + (messageDetail.dataset.labelNoMessage || 'No message selected.') + '</div>';
		return;
	}

	var replyPageSize = 10;
	var currentReplyPage = 1;
	var newViewCount = 0;
	var isBanned = false;

	/* Utility functions */
	function indentHtmlText(text) {
		var voidTag = /^<(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)(\s|>|\/)/i;
		var pad = '  ';
		var indent = 0;
		return text.split('\n').map(function(line) {
			line = line.trim();
			if (!line) return '';
			var isClosing = /^<\//.test(line);
			var isOpening = /^<[^\/!?]/.test(line);
			var isSelfClose = /\/\s*>$/.test(line) || voidTag.test(line);
			var hasInlineClose = isOpening && !isSelfClose && /<\/[^>]+>\s*$/.test(line);
			if (isClosing) indent = Math.max(0, indent - 1);
			var result = pad.repeat(indent) + line;
			if (isOpening && !isSelfClose && !hasInlineClose) indent++;
			return result;
		}).join('\n');
	}

	function formatMarkupCodeBlocks(container) {
		container.querySelectorAll('pre code').forEach(function(codeEl) {
			var text = codeEl.textContent;
			if (text.indexOf('\n') === -1 && text.indexOf('> <') !== -1) {
				text = text.replace(/>\s+</g, '>\n<');
				text = indentHtmlText(text);
				codeEl.textContent = text;
			}
		});
	}

	function timeAgo(dateStr) {
		if (!dateStr) return '';
		var now = Date.now();
		var then = new Date(dateStr).getTime();
		var diff = Math.floor((now - then) / 1000);
		if (diff < 60) return messageDetail.dataset.labelJustNow || 'just now';
		if (diff < 3600) return (messageDetail.dataset.labelXMinutesAgo || '{0}m ago').replace('{0}', Math.floor(diff / 60));
		if (diff < 86400) return (messageDetail.dataset.labelXHoursAgo || '{0}h ago').replace('{0}', Math.floor(diff / 3600));
		if (diff < 2592000) return (messageDetail.dataset.labelXDaysAgo || '{0}d ago').replace('{0}', Math.floor(diff / 86400));
		return new Date(dateStr).toLocaleDateString();
	}

	/* Full localized date + time (browser locale), e.g. "05/30/2026, 02:34:56 PM"
	   for en-US. Shown as the title tooltip and the screen-reader label on a
	   relative date. */
	function fullDateTime(dateStr) {
		if (!dateStr) return '';
		return new Date(dateStr).toLocaleString(undefined, {
			year: 'numeric', month: '2-digit', day: '2-digit',
			hour: '2-digit', minute: '2-digit', second: '2-digit'
		});
	}

	function avatarInitial(name) {
		if (!name) return '?';
		return name.charAt(0).toUpperCase();
	}

	function displayName(creator) {
		if (!creator) return '';
		var given = creator.givenName || '';
		var family = creator.familyName || '';
		return (family && family !== 'User') ? (given + ' ' + family) : (given || creator.name || '');
	}

	/* Stable avatar color from the Clay sticker-outline-0..9 palette */
	function avatarColorClass(creator) {
		var key = String((creator && (creator.id || creator.name)) || '');
		var n = 0;
		for (var i = 0; i < key.length; i++) { n = (n + key.charCodeAt(i)) % 10; }
		return 'sticker-outline-' + n;
	}

	function renderAvatar(creator, size) {
		var sizeClass = size === 'sm' ? 'sticker-sm' : 'sticker-lg';
		var baseCls = 'sticker sticker-circle ' + sizeClass;
		if (creator && creator.image) {
			return '<span class="' + baseCls + '"><span class="sticker-overlay"><img class="sticker-img" src="' + Liferay.Util.escapeHTML(creator.image) + '" alt="' + Liferay.Util.escapeHTML(displayName(creator)) + '"></span></span>';
		}
		var name = displayName(creator);
		return '<span class="' + baseCls + ' ' + avatarColorClass(creator) + '"><span class="sticker-overlay">' + avatarInitial(name) + '</span></span>';
	}

	/* Vote state: maps messageId -> { voteId, voteValue } for current user */
	var userVoteMap = {};

	/* Gamification state (Phase 3b). rankLadder is the ForumRank ladder sorted
	   descending by minPosts, fetched once and cached. statsUserMap maps a
	   userId -> that user's ForumStatsUser.messageCount. Both feed the rank +
	   post-count shown on author cards; rank is computed client-side since no
	   server-side rank field/action is used. */
	var rankLadder = null;
	var statsUserMap = {};

	/* Fetch the ForumRank ladder once, sorted so the highest threshold comes
	   first (rankLabel walks it top-down). Failures degrade to an empty ladder
	   -> no rank shown, post count still renders. */
	function ensureRankLadder(callback) {
		if (rankLadder) { callback(); return; }
		Liferay.Util.fetch(portalURL + '/o/c/forumranks/scopes/' + scopeGroupId + '?pageSize=100&sort=minPosts:desc', {
			headers: headers,
			method: 'GET'
		})
		.then(function(r) { return r.json(); })
		.then(function(data) {
			var items = (data && data.items) || [];
			rankLadder = items.map(function(it) {
				return { minPosts: it.minPosts || 0, label: it.label || '' };
			});
			rankLadder.sort(function(a, b) { return b.minPosts - a.minPosts; });
			callback();
		})
		.catch(function() { rankLadder = []; callback(); });
	}

	/* Batch-fetch ForumStatsUser rows for the given user ids, caching each
	   messageCount. Ids already cached (including queried-but-absent, stored as
	   0) are skipped so repeated renders don't refetch. */
	function fetchForumStats(userIds, callback) {
		var pending = userIds.filter(function(id) { return !(id in statsUserMap); });
		if (!pending.length) { callback(); return; }
		var filter = pending.map(function(id) { return 'statsUserId eq ' + id; }).join(' or ');
		Liferay.Util.fetch(portalURL + '/o/c/forumstatsusers/scopes/' + scopeGroupId + '?pageSize=200&filter=' + encodeURIComponent(filter), {
			headers: headers,
			method: 'GET'
		})
		.then(function(r) { return r.json(); })
		.then(function(data) {
			var items = (data && data.items) || [];
			items.forEach(function(it) { statsUserMap[it.statsUserId] = it.messageCount || 0; });
			pending.forEach(function(id) { if (!(id in statsUserMap)) statsUserMap[id] = 0; });
			callback();
		})
		.catch(function() { callback(); });
	}

	/* Highest rank whose threshold the post count meets (ladder is descending). */
	function rankLabel(count) {
		if (!rankLadder) return '';
		for (var i = 0; i < rankLadder.length; i++) {
			if (count >= rankLadder[i].minPosts) return rankLadder[i].label;
		}
		return '';
	}

	/* After cards render, fill every rank placeholder (OP + solutions + replies)
	   with "<rank> · <n> posts". Placeholders carry data-forums-rank-user with
	   the author's userId. */
	function fillAuthorRanks() {
		var els = messageDetail.querySelectorAll('[data-forums-rank-user]');
		if (!els.length) return;
		var ids = [];
		var seen = {};
		els.forEach(function(el) {
			var id = el.getAttribute('data-forums-rank-user');
			if (id && !seen[id]) { seen[id] = true; ids.push(id); }
		});
		ensureRankLadder(function() {
			fetchForumStats(ids, function() {
				els.forEach(function(el) {
					var id = el.getAttribute('data-forums-rank-user');
					var count = statsUserMap[id];
					if (count == null) return;
					var rank = rankLabel(count);
					var tmpl = count === 1
						? (messageDetail.dataset.labelXPost || '{0} post')
						: (messageDetail.dataset.labelXPosts || '{0} posts');
					var posts = tmpl.replace('{0}', count);
					el.textContent = (rank ? rank + ' · ' : '') + posts;
					el.style.display = '';
				});
			});
		});
	}
	var opCreatorId = null; /* Track message owner for Mark as Answer */
	var opAuthorName = ''; /* Display name of the OP, used in the "Answer selected by" annotation on the accepted reply */
	var currentAnswerId = null; /* Track currently accepted answer message ID */
	var messageDeleteUrl = null; /* Track HATEOAS URL to delete the whole message */
	var canUpdateMessage = false; /* HATEOAS: set true when ForumThreads API exposes update action for this message */
	var canVote = false; /* HATEOAS: set true when ForumVotes API exposes create action */
	var canReply = false; /* HATEOAS: set true when ForumReplies API exposes create action */
	var isMessageQuestion = false; /* Track if the message was marked as a question */
	var messageCategoryFK = null;
	var messageTitleText = '';
	var messagePriority = 0; /* Thread priority (MB parity: Urgent 3 / Sticky 2 / Announcement 1) */
	var messageTagsArray = [];

	/* Thread priority badge (Message Boards parity: Urgent|bolt|3.0,
	   Sticky|pin|2.0, Announcement|comments|1.0). Values <= 0, missing, or
	   unknown render nothing, matching MBUtil.getThreadPriority. */
	var PRIORITY_LEVELS = {
		3: { icon: 'bolt', labelKey: 'labelUrgent', fallback: 'Urgent', textClass: 'text-danger' },
		2: { icon: 'pin', labelKey: 'labelSticky', fallback: 'Sticky', textClass: 'text-warning' },
		1: { icon: 'comments', labelKey: 'labelAnnouncement', fallback: 'Announcement', textClass: 'text-info' }
	};

	function priorityBadge(priority) {
		var level = PRIORITY_LEVELS[Math.round(parseFloat(priority)) || 0];
		if (!level) return '';
		var label = Liferay.Util.escapeHTML(messageDetail.dataset[level.labelKey] || level.fallback);
		return '<span class="forums-message-detail__priority-badge ' + level.textClass + '">'
			+ '<svg class="lexicon-icon lexicon-icon-' + level.icon + '" role="presentation"><use href="' + clayIconsUrl + '#' + level.icon + '"></use></svg> '
			+ label + '</span>';
	}
	var replyMessagesMap = {};
	var existingFlagId = null; /* Track if the current user already flagged this message */

	function renderReplyCard(msg, isSolution, depth) {
		depth = depth || 0;
		var creator = msg.creator || {};
		var name = displayName(creator) || messageDetail.dataset.labelUnknown || 'Unknown';
		var body = msg.body || '';
		var dateFull = fullDateTime(msg.dateCreated);
		var date = '<time datetime="' + msg.dateCreated + '" title="' + dateFull + '" aria-label="' + dateFull + '">' + timeAgo(msg.dateCreated) + '</time>';
		var score = msg.voteScore || 0;
		var solClass = isSolution ? ' forums-message-detail__reply-card--solution' : '';
		var depthStyle = depth > 0 ? ' style="margin-left:' + (depth * 2.5) + 'rem"' : '';
		var userVote = userVoteMap[msg.id];
		var upActive = userVote && userVote.voteValue === 1 ? ' active' : '';
		var downActive = userVote && userVote.voteValue === -1 ? ' active' : '';
		var isUpPressed = userVote && userVote.voteValue === 1 ? 'true' : 'false';
		var isDownPressed = userVote && userVote.voteValue === -1 ? 'true' : 'false';
		var upIcon = userVote && userVote.voteValue === 1 ? 'thumbs-up-full' : 'thumbs-up';
		var downIcon = userVote && userVote.voteValue === -1 ? 'thumbs-down-full' : 'thumbs-down';

		var hasEditAction = !!(msg.actions && (msg.actions['update'] || msg.actions['patch'] || msg.actions['PUT']));
		var hasDeleteAction = !!(msg.actions && msg.actions['delete']);
		var hasOptions = hasEditAction || hasDeleteAction;
		var optionsLabel = messageDetail.dataset.labelOptions || 'Options';
		/* Lock the accepted answer: once one reply is marked, only that reply
		   keeps the toggle (so it can be unmarked). Hide the button on all
		   other replies — the user must unmark the current accepted answer
		   first before they can mark a different one. */
		var hasAcceptedAnswer = currentAnswerId != null;
		var canMarkAnswer = isMessageQuestion
			&& (canUpdateMessage || (opCreatorId && String(opCreatorId) === String(currentUserId)))
			&& depth === 0
			&& (!hasAcceptedAnswer || isSolution);
		var isAuthor = opCreatorId && String(creator.id) === String(opCreatorId);

		return `<div class="forums-message-detail__reply-card${solClass}" data-message-id="${msg.id}"${depthStyle}>
			<div class="autofit-row forums-message-detail__reply-layout">
				<div class="autofit-col mr-2">
					${renderAvatar(creator, 'sm')}
				</div>
				<div class="autofit-col autofit-col-expand forums-message-detail__reply-content">
					<div class="forums-message-detail__reply-header">
						<span class="text-dark font-weight-bold">${Liferay.Util.escapeHTML(name)}</span>
						${isAuthor ? `<span class="label forums-message-detail__author-badge">${messageDetail.dataset.labelAuthor || 'Author'}</span>` : ''}
						<span class="text-secondary small">${date}</span>
						${creator.id ? `<span class="text-secondary small forums-message-detail__rank" data-forums-rank-user="${creator.id}" style="display:none"></span>` : ''}
						${isSolution ? (function() {
							var tmpl = messageDetail.dataset.labelAnswerSelectedBy || 'Answer selected by {0}';
							var parts = tmpl.split('{0}');
							return `<span class="small forums-message-detail__answer-selected-by"><svg class="lexicon-icon lexicon-icon-check-circle-full" role="presentation"><use href="${clayIconsUrl}#check-circle-full"></use></svg>${Liferay.Util.escapeHTML(parts[0] || '')}<span class="forums-message-detail__answer-selected-by-name">${Liferay.Util.escapeHTML(opAuthorName)}</span>${Liferay.Util.escapeHTML(parts[1] || '')}</span>`;
						})() : ''}
					</div>
					<div class="forums-message-detail__reply-body">${body}</div>
					${renderAttachments(msg)}
					<div class="forums-message-detail__reply-actions">
						${canReply ? `<button class="btn btn-outline-primary btn-sm" type="button" data-forums-compose data-forums-reply data-forums-message-id="${msg.r_threadMessages_c_forumThreadId}" data-forums-parent-id="${msg.id}">${messageDetail.dataset.labelReply || 'Reply'}</button>` : ''}
						${hasOptions ? `<div class="dropdown forums-message-detail__reply-options">
							<button class="btn btn-monospaced btn-sm btn-outline-borderless btn-outline-secondary dropdown-toggle" type="button" id="forumsReplyOptions_${msg.id}" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false" aria-label="${optionsLabel}" title="${optionsLabel}">
								<svg class="lexicon-icon lexicon-icon-ellipsis-v" role="presentation"><use href="${clayIconsUrl}#ellipsis-v"></use></svg>
							</button>
							<div class="dropdown-menu dropdown-menu-right" aria-labelledby="forumsReplyOptions_${msg.id}">
								${hasEditAction ? `<a class="dropdown-item forums-edit-reply-btn" href="#" data-message-id="${msg.id}">${messageDetail.dataset.labelEditReply || 'Edit Reply'}</a>` : ''}
								${hasDeleteAction ? `<a class="dropdown-item text-danger forums-delete-btn" href="#" data-delete-url="${msg.actions['delete'].href}">${messageDetail.dataset.labelDeleteReply || 'Delete Reply'}</a>` : ''}
							</div>
						</div>` : ''}
						<div class="align-items-center d-inline-flex text-secondary forums-vote" data-message-id="${msg.id}">
							<button class="btn-thumbs-up btn btn-monospaced btn-outline-borderless btn-sm btn-outline-secondary forums-vote__btn forums-vote__btn--up${upActive}" type="button" aria-pressed="${isUpPressed}"${canVote ? ` data-vote-dir="up" data-message-id="${msg.id}"` : ' disabled'} title="${messageDetail.dataset.labelUpvote || 'Upvote'}">
								<svg class="lexicon-icon lexicon-icon-${upIcon}" role="presentation"><use href="${clayIconsUrl}#${upIcon}"></use></svg>
							</button>
							<span class="font-weight-bold p-1 forums-vote__score" data-vote-score="${msg.id}">${score}</span>
							<button class="btn-thumbs-down btn btn-monospaced btn-outline-borderless btn-sm btn-outline-secondary forums-vote__btn forums-vote__btn--down${downActive}" type="button" aria-pressed="${isDownPressed}"${canVote ? ` data-vote-dir="down" data-message-id="${msg.id}"` : ' disabled'} title="${messageDetail.dataset.labelDownvote || 'Downvote'}">
								<svg class="lexicon-icon lexicon-icon-${downIcon}" role="presentation"><use href="${clayIconsUrl}#${downIcon}"></use></svg>
							</button>
						</div>
						${canMarkAnswer ? `<button class="btn btn-sm ${isSolution ? 'btn-success' : 'btn-outline-secondary'} forums-answer-btn" data-answer-message-id="${msg.id}" data-is-answer="${isSolution ? 'true' : 'false'}">${isSolution ? `&#10003; ${messageDetail.dataset.labelAccepted || 'Accepted'}` : (messageDetail.dataset.labelMarkAsAnswer || 'Mark as Answer')}</button>` : ''}
					</div>
				</div>
			</div>
		</div>`;
	}

	/* Attachments embedded on a message via the messageAttachments relationship
	   nested field. Liferay returns them under the relationship-name key as either a
	   bare array or an {items:[...]} envelope; tolerate both. */
	function attachmentsOf(msg) {
		var value = msg && msg.messageAttachments;
		if (!value) return [];
		if (Array.isArray(value)) return value;
		return value.items || [];
	}

	/* The chip markup for one message's attachments. canManage adds a remove (×)
	   control (shown to the author only; deletion is also enforced server-side).
	   Returns '' when the message has no files. */
	function renderAttachments(msg) {
		var files = attachmentsOf(msg);
		if (!files.length) return '';
		/* Read-only view: download chips only. Removing an attachment is done from
		   the Edit dialog (forums-message-composer), alongside the rest of the post. */
		var chips = files.map(function(att) {
			var file = att.file || {};
			var name = file.name || (file.link && file.link.label) || (messageDetail.dataset.labelDownload || 'Download');
			var safeName = Liferay.Util.escapeHTML(name);
			return '<span class="forums-message-detail__attachment" data-attachment-id="' + att.id + '">' +
				'<button type="button" class="btn btn-outline-secondary btn-sm forums-attachment-download" data-attachment-id="' + att.id + '" data-attachment-name="' + safeName + '" title="' + safeName + '">' +
					'<svg class="lexicon-icon lexicon-icon-paperclip" role="presentation"><use href="' + clayIconsUrl + '#paperclip"></use></svg>' +
					'<span class="forums-message-detail__attachment-name">' + safeName + '</span>' +
				'</button>' +
			'</span>';
		}).join('');
		return '<div class="forums-message-detail__attachments">' + chips + '</div>';
	}

	/* Sort messages: accepted answers first, then by voteScore desc, then dateCreated asc */
	function sortByVoteScore(messages) {
		return messages.slice().sort(function(a, b) {
			/* Accepted answers first */
			var aAnswer = isMessageQuestion && a.answer === true ? 1 : 0;
			var bAnswer = isMessageQuestion && b.answer === true ? 1 : 0;
			if (bAnswer !== aAnswer) return bAnswer - aAnswer;
			/* Higher score first */
			var aScore = a.voteScore || 0;
			var bScore = b.voteScore || 0;
			if (bScore !== aScore) return bScore - aScore;
			/* Older first as tiebreaker */
			return new Date(a.dateCreated) - new Date(b.dateCreated);
		});
	}

	/* Build a tree from flat messages using parentMessageId */
	function buildMessageTree(messages, opId) {
		var childrenMap = {};
		var topLevel = [];
		var messageIds = {};

		messages.forEach(function(msg) {
			messageIds[msg.id] = true;
		});

		messages.forEach(function(msg) {
			var parentId = msg.parentMessageId || 0;
			
			/* If a message's parent is missing (e.g. deleted or on a different page), treat it as top-level */
			if (parentId !== 0 && parentId !== opId && !messageIds[parentId]) {
				parentId = opId;
			}
			
			if (!childrenMap[parentId]) childrenMap[parentId] = [];
			childrenMap[parentId].push(msg);
		});

		/* Top-level replies: parentMessageId is 0 or equals the OP id */
		topLevel = (childrenMap[0] || []).concat(childrenMap[opId] || []);

		/* Remove duplicates (if opId is 0, both keys point to same array) */
		if (opId === 0) {
			topLevel = childrenMap[0] || [];
		}

		/* Sort top-level replies by score */
		topLevel = sortByVoteScore(topLevel);

		function renderTree(msgList, depth) {
			var html = '';
			msgList.forEach(function(msg) {
				html += renderReplyCard(msg, isMessageQuestion && msg.answer === true, depth);
				var children = childrenMap[msg.id];
				if (children && children.length > 0) {
					html += renderTree(sortByVoteScore(children), depth + 1);
				}
			});
			return html;
		}

		return renderTree(topLevel, 0);
	}

	/* Fetch current user's votes for all messages in this message */
	function fetchUserVotes(messageIds, callback) {
		if (!messageIds || messageIds.length === 0) { callback(); return; }
		if (!Liferay.ThemeDisplay.isSignedIn()) { callback(); return; }
		/* Filter by current user's ID to only get this user's votes */
		var filterParam = encodeURIComponent('creatorId eq ' + currentUserId);
		Liferay.Util.fetch(portalURL + '/o/c/forumvotes/scopes/' + scopeGroupId + '?filter=' + filterParam + '&pageSize=200', {
			headers: headers,
			method: 'GET'
		})
		.then(function(r) { return r.json(); })
		.then(function(data) {
			/* HATEOAS: check if this user can create votes */
			if (!isBanned && data.actions && (data.actions['POST'] || data.actions['post'] || data.actions['create'])) {
				canVote = true;
			} else if (!isBanned && canReply) {
				/* Fallback: if HATEOAS is missing from the filtered votes endpoint but the user can reply, allow voting */
				canVote = true;
			}
			var items = data.items || [];
			userVoteMap = {};
			var messageIdSet = {};
			messageIds.forEach(function(id) { messageIdSet[id] = true; });
			items.forEach(function(vote) {
				var msgId = vote.r_messageVotes_c_forumMessageId;
				if (msgId && messageIdSet[msgId]) {
					userVoteMap[msgId] = { voteId: vote.id, voteValue: vote.voteValue };
				}
			});
			callback();
		})
		.catch(function() { callback(); });
	}

	/* Handle upvote/downvote click */
	function handleVote(messageId, direction) {
		if (!canVote) return;
		var voteValue = direction === 'up' ? 1 : -1;
		var existing = userVoteMap[messageId];

		if (existing) {
			if (existing.voteValue === voteValue) {
				/* Same direction: remove the vote (toggle off) */
				Liferay.Util.fetch(portalURL + '/o/c/forumvotes/' + existing.voteId, {
					headers: headers,
					method: 'DELETE'
				})
				.then(function() {
					delete userVoteMap[messageId];
					updateVoteScore(messageId, -voteValue);
				})
				.catch(function(err) { console.error('Vote delete error:', err); });
			} else {
				/* Opposite direction: delete old, create new */
				Liferay.Util.fetch(portalURL + '/o/c/forumvotes/' + existing.voteId, {
					headers: headers,
					method: 'DELETE'
				})
				.then(function() {
					return createVote(messageId, voteValue);
				})
				.then(function() {
					/* Score swings by 2: removed old + added new */
					updateVoteScore(messageId, voteValue * 2);
				})
				.catch(function(err) { console.error('Vote switch error:', err); });
			}
		} else {
			/* No existing vote: create new */
			createVote(messageId, voteValue)
			.then(function() {
				updateVoteScore(messageId, voteValue);
			})
			.catch(function(err) { console.error('Vote create error:', err); });
		}
	}

	function createVote(messageId, voteValue) {
		return Liferay.Util.fetch(portalURL + '/o/c/forumvotes/scopes/' + scopeGroupId, {
			headers: headers,
			method: 'POST',
			body: JSON.stringify({
				voteValue: voteValue,
				r_messageVotes_c_forumMessageId: messageId
			})
		})
		.then(function(r) { return r.json(); })
		.then(function(vote) {
			userVoteMap[messageId] = { voteId: vote.id, voteValue: voteValue };
		});
	}

	function updateVoteScore(messageId, delta) {
		/* Update the score in the DOM */
		var scoreEl = messageDetail.querySelector('[data-vote-score="' + messageId + '"]');
		if (scoreEl) {
			var current = parseInt(scoreEl.textContent) || 0;
			var newScore = current + delta;
			scoreEl.textContent = newScore;
		}

		/* Update button active states and icons */
		var voteContainer = messageDetail.querySelector('.forums-vote[data-message-id="' + messageId + '"]');
		if (voteContainer) {
			var upBtn = voteContainer.querySelector('.forums-vote__btn--up');
			var downBtn = voteContainer.querySelector('.forums-vote__btn--down');
			var userVote = userVoteMap[messageId];
			var isUp = !!(userVote && userVote.voteValue === 1);
			var isDown = !!(userVote && userVote.voteValue === -1);
			
			if (upBtn) {
				upBtn.classList.toggle('active', isUp);
				upBtn.setAttribute('aria-pressed', isUp ? 'true' : 'false');
				var upSvg = upBtn.querySelector('use');
				if (upSvg) upSvg.setAttribute('href', clayIconsUrl + '#' + (isUp ? 'thumbs-up-full' : 'thumbs-up'));
			}
			if (downBtn) {
				downBtn.classList.toggle('active', isDown);
				downBtn.setAttribute('aria-pressed', isDown ? 'true' : 'false');
				var downSvg = downBtn.querySelector('use');
				if (downSvg) downSvg.setAttribute('href', clayIconsUrl + '#' + (isDown ? 'thumbs-down-full' : 'thumbs-down'));
			}
		}

		/* Also PATCH the ForumMessage to persist the denormalized score */
		if (scoreEl) {
			var persistedScore = parseInt(scoreEl.textContent) || 0;
			Liferay.Util.fetch(portalURL + '/o/c/forummessages/' + messageId, {
				headers: headers,
				method: 'PATCH',
				body: JSON.stringify({ voteScore: persistedScore })
			}).catch(function(err) { console.error('Score persist error:', err); });
		}
	}

	/* Attach vote click handlers after rendering */
	function attachVoteHandlers() {
		messageDetail.querySelectorAll('.forums-vote__btn').forEach(function(btn) {
			btn.addEventListener('click', function(e) {
				e.preventDefault();
				var msgId = this.getAttribute('data-message-id');
				var dir = this.getAttribute('data-vote-dir');
				if (msgId && dir) handleVote(parseInt(msgId), dir);
			});
		});
	}

	/* Mark / Unmark as Answer */
	function handleMarkAnswer(messageId, isCurrentlyAnswer) {
		if (isCurrentlyAnswer) {
			/* Unmark this answer */
			Liferay.Util.fetch(portalURL + '/o/c/forummessages/' + messageId, {
				headers: headers,
				method: 'PATCH',
				body: JSON.stringify({ answer: false })
			})
			.then(function(r) {
				if (r.ok) {
					currentAnswerId = null;
					setTimeout(loadMessages, 1500);
				}
			})
			.catch(function(err) { console.error('Unmark answer error:', err); });
		} else {
			/* If another answer exists, unmark it first */
			var chain = Promise.resolve();
			if (currentAnswerId && currentAnswerId !== messageId) {
				chain = Liferay.Util.fetch(portalURL + '/o/c/forummessages/' + currentAnswerId, {
					headers: headers,
					method: 'PATCH',
					body: JSON.stringify({ answer: false })
				});
			}
			chain.then(function() {
				return Liferay.Util.fetch(portalURL + '/o/c/forummessages/' + messageId, {
					headers: headers,
					method: 'PATCH',
					body: JSON.stringify({ answer: true })
				});
			})
			.then(function(r) {
				if (r.ok) {
					currentAnswerId = messageId;
					setTimeout(loadMessages, 1500);
				}
			})
			.catch(function(err) { console.error('Mark answer error:', err); });
		}
	}

	function attachAnswerHandlers() {
		messageDetail.querySelectorAll('.forums-answer-btn').forEach(function(btn) {
			btn.addEventListener('click', function(e) {
				e.preventDefault();
				var msgId = parseInt(this.getAttribute('data-answer-message-id'));
				var isAnswer = this.getAttribute('data-is-answer') === 'true';
				
				this.style.opacity = '0.5';
				this.style.pointerEvents = 'none';
				
				handleMarkAnswer(msgId, isAnswer);
			});
		});
	}

	/* Delete Modal Setup */
	var deleteModalObj = null;

	function showDeleteModal(title, message, onConfirm) {
		var modal = document.getElementById('forumsDeleteModal');
		if (!modal) {
			modal = document.createElement('div');
			modal.id = 'forumsDeleteModal';
			modal.className = 'modal';
			modal.style.backgroundColor = 'rgba(0,0,0,0.5)';
			modal.style.zIndex = '1050';
			modal.setAttribute('tabindex', '-1');
			modal.setAttribute('role', 'dialog');
			modal.setAttribute('aria-modal', 'true');
			modal.setAttribute('aria-labelledby', 'forumsDeleteModalHeading');

			modal.innerHTML = `
			<div class="modal-dialog modal-dialog-sm modal-dialog-centered modal-danger">
				<div class="modal-content">
					<div class="modal-header">
						<h1 class="modal-title" tabindex="-1">
							<div class="modal-title-indicator">
								<svg class="lexicon-icon lexicon-icon-exclamation-full" role="presentation">
									<use href="${clayIconsUrl}#exclamation-full"></use>
								</svg>
							</div>
							<span id="forumsDeleteModalHeading"></span>
						</h1>
						<button class="close btn btn-unstyled forums-delete-modal-close" type="button" aria-label="Close">
							<svg class="lexicon-icon lexicon-icon-times" role="presentation">
								<use href="${clayIconsUrl}#times"></use>
							</svg>
						</button>
					</div>
					<div class="modal-body">
						<div class="liferay-modal-body" id="forumsDeleteModalBody"></div>
					</div>
					<div class="modal-footer">
						<div class="modal-item-last">
							<div class="btn-group-spaced" role="group">
								<button class="btn btn-secondary forums-delete-modal-close" type="button">${messageDetail.dataset.labelCancel || 'Cancel'}</button>
								<button class="btn btn-danger" type="button" id="forumsDeleteModalConfirmBtn">${messageDetail.dataset.labelDelete || 'Delete'}</button>
							</div>
						</div>
					</div>
				</div>
			</div>`;
			document.body.appendChild(modal);

			modal.querySelectorAll('.forums-delete-modal-close').forEach(function(btn) {
				btn.addEventListener('click', function() {
					modal.style.display = 'none';
					modal.classList.remove('show');
					if (deleteModalObj && deleteModalObj.onCancel) {
						deleteModalObj.onCancel();
					}
				});
			});

			modal.querySelector('#forumsDeleteModalConfirmBtn').addEventListener('click', function() {
				modal.style.display = 'none';
				modal.classList.remove('show');
				if (deleteModalObj && deleteModalObj.onConfirm) {
					deleteModalObj.onConfirm();
				}
			});
		}

		modal.querySelector('#forumsDeleteModalHeading').textContent = title;
		modal.querySelector('#forumsDeleteModalBody').textContent = message;
		
		deleteModalObj = {
			onConfirm: onConfirm,
			onCancel: null
		};

		modal.style.display = 'block';
		setTimeout(function() {
			modal.classList.add('show');
		}, 10);
	}

	/* Delete Reply */
	function attachDeleteHandlers() {
		messageDetail.querySelectorAll('.forums-delete-btn').forEach(function(btn) {
			btn.addEventListener('click', function(e) {
				e.preventDefault();
				var isReply = this.closest('.forums-message-detail__reply-card');
				var title = isReply ? (messageDetail.dataset.labelDeleteReply || 'Delete Reply') : (messageDetail.dataset.labelDeleteTopic || 'Delete Topic');
				var confirmMsg = isReply ? (messageDetail.dataset.labelConfirmDeleteReply || 'Deleting a reply is an action impossible to revert. It will not be possible to recover it.') : (messageDetail.dataset.labelConfirmDeleteTopic || 'Deleting a topic is an action impossible to revert. All the replies in the topic will be removed and it will not be possible to recover them.');
				
				var deleteUrl = this.getAttribute('data-delete-url');
				var btnEl = this;
				
				showDeleteModal(title, confirmMsg, function() {
					Liferay.Util.fetch(deleteUrl, {
						headers: headers,
						method: 'DELETE'
					})
					.then(function(r) {
						if (r.ok) {
							/* Optimistically remove the card from the DOM */
							var card = btnEl.closest('.forums-message-detail__reply-card');
							if (card) {
								card.style.opacity = '0.5';
								setTimeout(function() { card.remove(); }, 300);
								/* Delay the reload to allow the backend search index to catch up */
								setTimeout(loadMessages, 1500);
							} else {
								/* This is the Original Post being deleted — navigate back to the message list */
								var opSection = messageDetail.querySelector('#forumsDetailOP');
								if (opSection) opSection.style.opacity = '0.5';
								var breadcrumbCatEl = messageDetail.querySelector('#forumsDetailBreadcrumbCategory');
								var messagesBase = sitePrefix + ((typeof configuration !== 'undefined' && configuration.messagesURL) ? configuration.messagesURL : '/forums-messages');
								var targetHref = (breadcrumbCatEl && breadcrumbCatEl.href) ? breadcrumbCatEl.href
									: (messageCategoryFK ? messagesBase + '?categoryId=' + messageCategoryFK : messagesBase);
								setTimeout(function() {
									window.location.href = targetHref;
								}, 1500);
							}
						} else {
							console.error('Failed to delete message');
						}
					})
					.catch(function(err) { console.error('Delete message error:', err); });
				});
			});
		});
	}

	function attachEditReplyHandlers() {
		messageDetail.querySelectorAll('.forums-edit-reply-btn').forEach(function(btn) {
			btn.addEventListener('click', function(e) {
				e.preventDefault();
				var msgId = parseInt(this.getAttribute('data-message-id'));
				var msg = replyMessagesMap[msgId];
				if (msg && window.forumsOpenComposeModal) {
					window.forumsOpenComposeModal({
						editMode: true,
						isOp: false,
						messageId: msg.id,
						body: msg.body
					});
				}
			});
		});
	}

	/* Download an attachment's bytes and save them client-side. The file's own
	   /documents link may be permission-gated, so instead we fetch the content as
	   base64 through object REST (gated by the row's VIEW, which every site member
	   has) and build a Blob. */
	function downloadAttachment(attachmentId, name) {
		Liferay.Util.fetch(portalURL + '/o/c/forummessageattachments/' + attachmentId + '?nestedFields=file.fileBase64', {
			headers: headers,
			method: 'GET'
		})
		.then(function(r) { return r.json(); })
		.then(function(row) {
			var fileValue = (row && row.file) || {};
			var base64 = fileValue.fileBase64;
			if (!base64) throw new Error('no file content');
			var bytes = atob(base64);
			var array = new Uint8Array(bytes.length);
			for (var i = 0; i < bytes.length; i++) {
				array[i] = bytes.charCodeAt(i);
			}
			var blob = new Blob([array], { type: fileValue.mimeType || 'application/octet-stream' });
			var objectUrl = URL.createObjectURL(blob);
			var anchor = document.createElement('a');
			anchor.href = objectUrl;
			anchor.download = fileValue.name || name;
			document.body.appendChild(anchor);
			anchor.click();
			anchor.remove();
			URL.revokeObjectURL(objectUrl);
		})
		.catch(function(err) {
			console.error('Download attachment error:', err);
			if (Liferay.Util && Liferay.Util.openToast) {
				Liferay.Util.openToast({
					message: messageDetail.dataset.labelCouldNotDownloadFile || 'Could not download the file. Please try again.',
					type: 'danger'
				});
			}
		});
	}

	/* Wire the download control on attachment chips (available to any member).
	   Removing an attachment lives in the Edit dialog, not this read-only view. */
	function attachAttachmentHandlers() {
		messageDetail.querySelectorAll('.forums-attachment-download').forEach(function(btn) {
			btn.addEventListener('click', function(e) {
				e.preventDefault();
				downloadAttachment(this.getAttribute('data-attachment-id'), this.getAttribute('data-attachment-name'));
			});
		});
	}

	/* Load message data */
	function initMessageDetail() {
		if (isBanned) {
			var bannedBanner = document.createElement('div');
			bannedBanner.className = 'alert alert-danger mt-3';
			bannedBanner.setAttribute('role', 'alert');
			bannedBanner.innerHTML = `<span class="alert-indicator"><svg class="lexicon-icon lexicon-icon-warning-full" role="presentation" viewBox="0 0 16 16" fill="currentColor"><path d="M16 14.5L8 1 0 14.5h16zM8 13c-.6 0-1-.4-1-1s.4-1 1-1 1 .4 1 1-.4 1-1 1zm1-3H7V6h2v4z"/></svg></span><strong class="lead">${messageDetail.dataset.labelBanned || 'Banned'}: </strong>${messageDetail.dataset.labelBannedWarning || 'Your account has been banned from participating in the forums.'}`;
			
			var titleRow = messageDetail.querySelector('.forums-message-detail__title-row');
			if (titleRow) {
				titleRow.parentNode.insertBefore(bannedBanner, titleRow);
			}
		}

		Liferay.Util.fetch(portalURL + '/o/c/forumthreads/' + messageId + '?nestedFields=threadSuspiciousActivities', {
			headers: headers,
			method: 'GET'
		})
	.then(function(r) { return r.json(); })
	.then(function(msg) {
		if (isBanned) {
			if (msg.actions) msg.actions = {};
			if (optionsBtn) optionsBtn.style.display = 'none';
		}
		
		if (msg.actions && msg.actions['delete']) {
			messageDeleteUrl = msg.actions['delete'].href;
		}
		if (msg.actions && (msg.actions['update'] || msg.actions['patch'] || msg.actions['PUT'])) {
			canUpdateMessage = true;
		}

		var subscribeBtn = messageDetail.querySelector('#forumsDetailSubscribeBtn');
		var currentSubscribeUrl = null;
		var isSubscribed = false;

		if (subscribeBtn && msg.actions && !isBanned) {
			if (msg.actions['unsubscribe']) {
				currentSubscribeUrl = msg.actions['unsubscribe'].href;
				isSubscribed = true;
			} else if (msg.actions['subscribe']) {
				currentSubscribeUrl = msg.actions['subscribe'].href;
				isSubscribed = false;
			}

			if (currentSubscribeUrl) {
				subscribeBtn.textContent = isSubscribed 
					? (messageDetail.dataset.labelUnsubscribe || 'Unsubscribe')
					: (messageDetail.dataset.labelSubscribe || 'Subscribe');
				subscribeBtn.style.display = '';

				var newSubBtn = subscribeBtn.cloneNode(true);
				subscribeBtn.parentNode.replaceChild(newSubBtn, subscribeBtn);
				subscribeBtn = newSubBtn;
				
				subscribeBtn.addEventListener('click', function(e) {
					e.preventDefault();
					var btn = this;
					btn.style.opacity = '0.5';
					btn.style.pointerEvents = 'none';
					
					Liferay.Util.fetch(currentSubscribeUrl, {
						headers: headers,
						method: 'POST'
					})
					.then(function(r) {
						if (r.ok) {
							isSubscribed = !isSubscribed;
							currentSubscribeUrl = isSubscribed 
								? currentSubscribeUrl.replace('/subscribe', '/unsubscribe')
								: currentSubscribeUrl.replace('/unsubscribe', '/subscribe');
								
							btn.textContent = isSubscribed 
								? (messageDetail.dataset.labelUnsubscribe || 'Unsubscribe')
								: (messageDetail.dataset.labelSubscribe || 'Subscribe');
							
							var optionsMenu = btn.closest('.dropdown-menu');
							if (optionsMenu) optionsMenu.classList.remove('show');
							
							if (Liferay.Util && Liferay.Util.openToast) {
								var toastMsg = isSubscribed 
									? (messageDetail.dataset.labelSubscribedToast || 'You have been subscribed to this message.') 
									: (messageDetail.dataset.labelUnsubscribedToast || 'You have been unsubscribed from this message.');
								Liferay.Util.openToast({
									message: toastMsg,
									title: messageDetail.dataset.labelSuccess || 'Success',
									type: 'success'
								});
							}
						}
					})
					.catch(function(err) { console.error('Subscription error:', err); })
					.finally(function() {
						btn.style.opacity = '1';
						btn.style.pointerEvents = '';
					});
				});
			}
		}

		/* Increment viewCount via REST PATCH (unique per session) */
		var currentViewCount = msg.viewCount;
		currentViewCount = currentViewCount || 0;
		var viewStorageKey = 'forums_viewed_' + currentUserId + '_' + messageId;
		var alreadyViewed = false;
		try { alreadyViewed = !!sessionStorage.getItem(viewStorageKey); } catch(e) {}

		if (!alreadyViewed && Liferay.ThemeDisplay.isSignedIn()) {
			newViewCount = currentViewCount + 1;
			Liferay.Util.fetch(portalURL + '/o/c/forumthreads/' + messageId, {
				method: 'PATCH',
				headers: headers,
				body: JSON.stringify({ viewCount: newViewCount })
			}).then(function(r) {
				return r.json().then(function(body) {
					if (r.ok) {
						try { sessionStorage.setItem(viewStorageKey, '1'); } catch(e) {}
					} else {
						console.error('View count update failed:', r.status, body);
					}
				});
			}).catch(function(err) { console.error('View count update error:', err); });
		} else {
			newViewCount = currentViewCount;
		}

		isMessageQuestion = msg.question === true;

		var isFlagged = false;
		var suspiciousActivities = msg.threadSuspiciousActivities || [];
		for (var s = 0; s < suspiciousActivities.length; s++) {
			if (suspiciousActivities[s].validated === true) {
				isFlagged = true;
				break;
			}
		}

		if (isFlagged) {
			var flaggedBanner = messageDetail.querySelector('#forumsDetailFlaggedBanner');
			if (!flaggedBanner) {
				flaggedBanner = document.createElement('div');
				flaggedBanner.id = 'forumsDetailFlaggedBanner';
				flaggedBanner.className = 'alert alert-danger mt-3';
				flaggedBanner.setAttribute('role', 'alert');
				flaggedBanner.innerHTML = `<span class="alert-indicator"><svg class="lexicon-icon lexicon-icon-warning-full" role="presentation" viewBox="0 0 16 16" fill="currentColor"><path d="M16 14.5L8 1 0 14.5h16zM8 13c-.6 0-1-.4-1-1s.4-1 1-1 1 .4 1 1-.4 1-1 1zm1-3H7V6h2v4z"/></svg></span><strong class="lead">${messageDetail.dataset.labelFlagged || 'Flagged'}: </strong>${messageDetail.dataset.labelFlaggedWarning || 'This message has been flagged and validated by moderators as inappropriate content.'}`;
				
				var titleRow = messageDetail.querySelector('.forums-message-detail__title-row');
				if (titleRow) {
					titleRow.parentNode.insertBefore(flaggedBanner, titleRow.nextSibling);
				}
			} else {
				flaggedBanner.style.display = '';
			}
		}

		messageTitleText = msg.messageTitle || messageDetail.dataset.labelUntitledMessage || 'Untitled Message';
		messageCategoryFK = msg.r_categoryThreads_c_forumCategoryId;
		messagePriority = msg.priority || 0;
		messageTagsArray = msg.keywords || [];
		var title = messageTitleText;
		var categoryFK = messageCategoryFK;

		if (titleEl) {
			titleEl.textContent = title;
			var priorityBadgeHtml = priorityBadge(messagePriority);
			if (priorityBadgeHtml) titleEl.insertAdjacentHTML('beforeend', priorityBadgeHtml);
		}
		if (breadcrumbMessage) breadcrumbMessage.textContent = title;

		/* Fetch category for breadcrumb */
		if (categoryFK) {
			Liferay.Util.fetch(portalURL + '/o/c/forumcategories/' + categoryFK, {
				headers: headers,
				method: 'GET'
			})
			.then(function(r) { return r.json(); })
			.then(function(cat) {
				var catName = cat.categoryName || messageDetail.dataset.labelCategory || 'Category';
				var messagesHref = sitePrefix + ((typeof configuration !== 'undefined' && configuration.messagesURL) ? configuration.messagesURL : '/forums-messages');
				var catURL = messagesHref + '?categoryId=' + categoryFK;

				if (breadcrumbCategory) {
					breadcrumbCategory.textContent = catName;
					breadcrumbCategory.href = catURL;
				}

				/* Also populate the bottom category link */
				if (categoryLink) {
					var labelText = (messageDetail.dataset.labelBackToX || 'Back to {0}').replace('{0}', catName);
					categoryLink.textContent = labelText;
					categoryLink.href = catURL;
					categoryLink.style.display = '';
				}
			})
			.catch(function() {});
		}

		/* Check if the current user has already flagged this message (dedup) */
		if (flagBtn && currentUserId) {
			Liferay.Util.fetch(portalURL + '/o/c/forumsuspiciousactivities/scopes/' + scopeGroupId + '?filter='
				+ encodeURIComponent('creatorId eq ' + currentUserId + ' and suspiciousMessageId eq ' + messageId)
				+ '&pageSize=1', {
				headers: headers,
				method: 'GET'
			})
			.then(function(r) { return r.json(); })
			.then(function(data) {
				var items = data.items || [];
				if (items.length > 0) {
					existingFlagId = items[0].id;
					flagBtn.textContent = messageDetail.dataset.labelFlagged || 'Flagged';
					flagBtn.classList.add('disabled');
					flagBtn.disabled = true;
				}
			})
			.catch(function(err) { console.error('Flag dedup check error:', err); });
		}

		/* Fetch messages for this message */
		loadMessages();
	})
	.catch(function(err) {
		if (loadingEl) loadingEl.innerHTML = '<div class="forums-message-list__empty text-secondary text-center py-5">' + (messageDetail.dataset.labelUnableToLoadMessage || 'Unable to load message.') + '</div>';
		console.error('ForumsMessageDetail error:', err);
	});
	}

	/* Load messages */
	function loadMessages() {
		/* Re-show skeleton during pagination / refresh reloads */
		if (loadingEl) {
			loadingEl.classList.remove('forums-skeleton--fade-out');
			loadingEl.style.display = '';
			loadingEl.setAttribute('aria-busy', 'true');
			skeletonShownAt = Date.now();
		}

		Liferay.Util.fetch(portalURL + '/o/c/forummessages/scopes/' + scopeGroupId + '?filter='
			+ encodeURIComponent('r_threadMessages_c_forumThreadId eq \'' + messageId + '\'')
			+ '&sort=dateCreated:asc&page=' + currentReplyPage
			+ '&pageSize=' + replyPageSize
			+ '&nestedFields=messageAttachments', {
			headers: headers,
			method: 'GET'
		})
		.then(function(r) { return r.json(); })
		.then(function(data) {

			var messages = data.items || [];
			var totalCount = data.totalCount || 0;
			var lastPage = data.lastPage || 1;

			if (messages.length === 0) {
				if (loadingEl) { loadingEl.style.display = 'none'; loadingEl.removeAttribute('aria-busy'); }
				return;
			}
			
			if (isBanned) {
				messages.forEach(function(msg) {
					msg.actions = {};
				});
			}

			/* HATEOAS: check if this user can create messages (reply) */
			if (!isBanned && data.actions && (data.actions['POST'] || data.actions['post'] || data.actions['create'])) {
				canReply = true;
				if (replyBtn) replyBtn.style.display = '';
				if (flagBtn) flagBtn.style.display = '';
			}

			/* Fetch user votes FIRST, then render everything */
			var allMsgIds = messages.map(function(m) { return m.id; });
			fetchUserVotes(allMsgIds, function() {

			/* Clear existing DOM structures to prevent artifacts */
			if (solutionCards) solutionCards.innerHTML = '';
			if (replyCards) replyCards.innerHTML = '';
			if (solvedBanner) solvedBanner.style.display = 'none';
			if (solutionSection) solutionSection.style.display = 'none';
			if (repliesSection) repliesSection.style.display = 'none';

			/* Separate OP from replies */
			var opMsg = null;
			var replyMessages = [];

			messages.forEach(function(msg, idx) {
				replyMessagesMap[msg.id] = msg;
				if (currentReplyPage === 1 && idx === 0) {
					opMsg = msg;
				} else {
					replyMessages.push(msg);
				}
			});

			/* Render Original Post */
			if (opMsg) {
				var creator = opMsg.creator || {};
				opCreatorId = creator.id || null;
				opAuthorName = displayName(creator) || messageDetail.dataset.labelUnknown || 'Unknown';
				if (opBody) {
					opBody.innerHTML = opMsg.body || '';
					formatMarkupCodeBlocks(opBody);
				}
				if (opAttachments) {
					opAttachments.innerHTML = renderAttachments(opMsg);
				}
				if (opAvatar) {
					var opAvatarCls = 'sticker sticker-circle sticker-lg';
					if (creator.image) {
						opAvatar.className = opAvatarCls;
						opAvatar.innerHTML = '<span class="sticker-overlay"><img class="sticker-img" src="' + Liferay.Util.escapeHTML(creator.image) + '" alt="' + Liferay.Util.escapeHTML(displayName(creator)) + '"></span>';
					} else {
						opAvatar.className = opAvatarCls + ' ' + avatarColorClass(creator);
						opAvatar.innerHTML = '<span class="sticker-overlay">' + Liferay.Util.escapeHTML(avatarInitial(displayName(creator))) + '</span>';
					}
				}
				if (opAuthor) opAuthor.textContent = displayName(creator) || messageDetail.dataset.labelUnknown || 'Unknown';
				/* Tag the OP rank placeholder with the author's id so fillAuthorRanks
				   populates it alongside the reply cards. */
				var opRankEl = messageDetail.querySelector('#forumsDetailOPRank');
				if (opRankEl) {
					if (creator.id) {
						opRankEl.setAttribute('data-forums-rank-user', creator.id);
					}
					else {
						opRankEl.removeAttribute('data-forums-rank-user');
						opRankEl.style.display = 'none';
					}
				}
				if (opDate) {
					opDate.textContent = timeAgo(opMsg.dateCreated);
					var opDateFull = fullDateTime(opMsg.dateCreated);
					opDate.title = opDateFull;
					opDate.setAttribute('aria-label', opDateFull);
				}
				/* Render OP Tags */
				if (opTags && messageTagsArray.length > 0) {
					var tagsHtml = messageTagsArray.map(function(tag) {
						return `<span class="label label-lg forums-message-detail__tag"><span class="label-item label-item-expand">${Liferay.Util.escapeHTML(tag)}</span></span>`;
					}).join('');
					opTags.innerHTML = tagsHtml;
					opTags.style.display = '';
				}

				if (opSection) opSection.style.display = '';

				var authorInfoEl = messageDetail.querySelector('#forumsDetailAuthorInfo');
				if (authorInfoEl) authorInfoEl.style.display = '';

				/* Render OP vote buttons */
				var opVoteEl = messageDetail.querySelector('#forumsDetailOPVote');
				if (opVoteEl) {
					var opScore = opMsg.voteScore || 0;
					var opUserVote = userVoteMap[opMsg.id];
					var opUpActive = opUserVote && opUserVote.voteValue === 1 ? ' active' : '';
					var opDownActive = opUserVote && opUserVote.voteValue === -1 ? ' active' : '';
					var opIsUpPressed = opUserVote && opUserVote.voteValue === 1 ? 'true' : 'false';
					var opIsDownPressed = opUserVote && opUserVote.voteValue === -1 ? 'true' : 'false';
					var opUpIcon = opUserVote && opUserVote.voteValue === 1 ? 'thumbs-up-full' : 'thumbs-up';
					var opDownIcon = opUserVote && opUserVote.voteValue === -1 ? 'thumbs-down-full' : 'thumbs-down';
					
					opVoteEl.className = 'align-items-center d-inline-flex justify-content-center text-secondary forums-vote';
					opVoteEl.setAttribute('data-message-id', opMsg.id);
					var upvoteTitle = messageDetail.dataset.labelUpvote || 'Upvote';
					var downvoteTitle = messageDetail.dataset.labelDownvote || 'Downvote';
					opVoteEl.innerHTML = `
						<button class="btn-thumbs-up btn btn-monospaced btn-outline-borderless btn-outline-secondary forums-vote__btn forums-vote__btn--up${opUpActive}" type="button" aria-pressed="${opIsUpPressed}"${canVote ? ` data-vote-dir="up" data-message-id="${opMsg.id}"` : ' disabled'} title="${upvoteTitle}">
							<svg class="lexicon-icon lexicon-icon-${opUpIcon}" role="presentation"><use href="${clayIconsUrl}#${opUpIcon}"></use></svg>
						</button>
						<span class="font-weight-bold mx-2 forums-vote__score" data-vote-score="${opMsg.id}">${opScore}</span>
						<button class="btn-thumbs-down btn btn-monospaced btn-outline-borderless btn-outline-secondary forums-vote__btn forums-vote__btn--down${opDownActive}" type="button" aria-pressed="${opIsDownPressed}"${canVote ? ` data-vote-dir="down" data-message-id="${opMsg.id}"` : ' disabled'} title="${downvoteTitle}">
							<svg class="lexicon-icon lexicon-icon-${opDownIcon}" role="presentation"><use href="${clayIconsUrl}#${opDownIcon}"></use></svg>
						</button>`;
				}

				/* Wire up OP Edit / Delete dropdown items if permitted (HATEOAS).
				   The buttons live in the options dropdown next to the title;
				   here we just toggle their visibility and (re)attach handlers. */
				var dropdownEditBtn = messageDetail.querySelector('#forumsDetailEditBtn');
				if (dropdownEditBtn && canUpdateMessage) {
					dropdownEditBtn.style.display = '';
					/* Clone to clear any prior click handler from previous loadMessages. */
					var newDropdownEditBtn = dropdownEditBtn.cloneNode(true);
					dropdownEditBtn.parentNode.replaceChild(newDropdownEditBtn, dropdownEditBtn);
					newDropdownEditBtn.addEventListener('click', function(e) {
						e.preventDefault();
						if (window.forumsOpenComposeModal) {
							window.forumsOpenComposeModal({
								editMode: true,
								isOp: true,
								threadId: messageId,
								messageId: opMsg.id,
								categoryId: messageCategoryFK,
								subject: messageTitleText,
								body: opMsg.body,
								isQuestion: isMessageQuestion,
								priority: messagePriority,
								tags: messageTagsArray
							});
						}
					});
				}

				var dropdownDeleteBtn = messageDetail.querySelector('#forumsDetailDeleteBtn');
				if (dropdownDeleteBtn && messageDeleteUrl) {
					/* Clone to clear any prior click handler from previous loadMessages
					   (attachDeleteHandlers() re-binds on the new node below). */
					var newDropdownDeleteBtn = dropdownDeleteBtn.cloneNode(true);
					newDropdownDeleteBtn.setAttribute('data-delete-url', messageDeleteUrl);
					newDropdownDeleteBtn.style.display = '';
					dropdownDeleteBtn.parentNode.replaceChild(newDropdownDeleteBtn, dropdownDeleteBtn);
					/* The click handler is attached by the shared attachDeleteHandlers()
					   call below because the element carries .forums-delete-btn. */
				}

				/* Render OP Toggle Question button if permitted (HATEOAS) */
				var toggleQuestionBtn = messageDetail.querySelector('#forumsDetailToggleQuestionBtn');
				if (toggleQuestionBtn && !isBanned && (canUpdateMessage || (opCreatorId && String(opCreatorId) === String(currentUserId)))) {
					toggleQuestionBtn.textContent = isMessageQuestion 
						? (messageDetail.dataset.labelConvertToMessage || 'Convert to Discussion')
						: (messageDetail.dataset.labelConvertToQuestion || 'Convert to Question');
					toggleQuestionBtn.style.display = '';
					
					var newBtn = toggleQuestionBtn.cloneNode(true);
					toggleQuestionBtn.parentNode.replaceChild(newBtn, toggleQuestionBtn);
					
					newBtn.addEventListener('click', function(e) {
						e.preventDefault();
						var newStatus = !isMessageQuestion;

						/* When demoting a question to a discussion, first fetch every
						   reply marked as answer (across all pages) and clear the flag
						   on each. Discussions don't have solutions, so leaving
						   `answer: true` rows behind would be stale. */
						var preWork = newStatus
							? Promise.resolve()
							: Liferay.Util.fetch(portalURL + '/o/c/forummessages/scopes/' + scopeGroupId
									+ '?filter=' + encodeURIComponent('r_threadMessages_c_forumThreadId eq \'' + messageId + '\' and answer eq true')
									+ '&fields=id&pageSize=100', {
									headers: headers,
									method: 'GET'
								})
								.then(function(r) { return r.json(); })
								.then(function(data) {
									var items = (data && data.items) || [];
									return Promise.all(items.map(function(reply) {
										return Liferay.Util.fetch(portalURL + '/o/c/forummessages/' + reply.id, {
											headers: headers,
											method: 'PATCH',
											body: JSON.stringify({ answer: false })
										});
									}));
								});

						preWork
							.then(function() {
								return Liferay.Util.fetch(portalURL + '/o/c/forumthreads/' + messageId, {
									headers: headers,
									method: 'PATCH',
									body: JSON.stringify({ question: newStatus })
								});
							})
							.then(function(r) {
								if (r.ok) {
									isMessageQuestion = newStatus;
									if (!newStatus) currentAnswerId = null;
									loadMessages();
								}
							})
							.catch(function(err) { console.error('Error toggling question status', err); });
					});
				}
			}

			/* Separate solutions from regular replies. Reset the tracked
			   accepted-answer id first so a stale value from a previous load
			   doesn't leak into the "Mark as Answer" button visibility. */
			var solutions = [];
			var regularReplies = [];
			currentAnswerId = null;
			replyMessages.forEach(function(msg) {
				if (isMessageQuestion && msg.answer === true) {
					solutions.push(msg);
					currentAnswerId = msg.id;
				} else {
					regularReplies.push(msg);
				}
			});

			/* Render Solved banner + solution cards */
			if (solutions.length > 0) {
				if (solvedBanner) solvedBanner.style.display = '';
				if (solutionSection) solutionSection.style.display = '';

				var solHtml = '';
				solutions.forEach(function(sol) {
					solHtml += renderReplyCard(sol, true, 0);
				});
				if (solutionCards) {
					solutionCards.innerHTML = solHtml;
					formatMarkupCodeBlocks(solutionCards);
				}
			}

			/* Render regular replies as a messageed tree */
			var regularReplyCount = totalCount - 1 - solutions.length;
			if (regularReplyCount < 0) regularReplyCount = 0;

			if (regularReplies.length > 0 || regularReplyCount > 0) {
				if (repliesSection) repliesSection.style.display = '';
				if (replyCountEl) {
					var tmpl = regularReplyCount === 1
						? (messageDetail.dataset.labelXReply || '{0} reply')
						: (messageDetail.dataset.labelXReplies || '{0} replies');
					replyCountEl.textContent = tmpl.replace('{0}', regularReplyCount);
				}

				var opId = opMsg ? opMsg.id : 0;
				var repHtml = buildMessageTree(regularReplies, opId);
				if (replyCards) {
					replyCards.innerHTML = repHtml;
					formatMarkupCodeBlocks(replyCards);
				}
			}

			/* Attach all handlers after rendering */
			attachVoteHandlers();
			attachAnswerHandlers();
			attachDeleteHandlers();
			attachEditReplyHandlers();
			attachAttachmentHandlers();

			/* Populate rank + post count on the OP and every reply card now that
			   all placeholders are in the DOM. */
			fillAuthorRanks();

			/* Hide skeleton after render, with a minimum display time to prevent flash */
			if (loadingEl) {
				var elapsed = Date.now() - skeletonShownAt;
				var minDisplayMs = 600;
				var remainingMs = Math.max(0, minDisplayMs - elapsed);
				setTimeout(function() {
					loadingEl.classList.add('forums-skeleton--fade-out');
					setTimeout(function() {
						loadingEl.style.display = 'none';
						loadingEl.removeAttribute('aria-busy');
						loadingEl.classList.remove('forums-skeleton--fade-out');
					}, 250);
				}, remainingMs);
			}

			/* Scroll to a specific reply when the fragment is on a Forum Message Display Page */
			if (targetReplyId) {
				var targetCard = messageDetail.querySelector('.forums-message-detail__reply-card[data-message-id="' + targetReplyId + '"]');
				if (targetCard) {
					setTimeout(function() {
						targetCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
						targetCard.classList.add('forums-message-detail__reply-card--targeted');
					}, 200);
				}
			}

			/* Reply pagination */
			if (lastPage > 1 && replyPaginationNav && replyPaginationUl) {
				replyPaginationNav.style.display = '';
				var pageNums = [];
				for (var p = 1; p <= lastPage && p <= 10; p++) pageNums.push(p);

				var pagHtml = `<li class="page-item${currentReplyPage <= 1 ? ' disabled' : ''}"><a class="page-link" href="#" data-page="${currentReplyPage - 1}">&laquo;</a></li>`
					+ pageNums.map(function(p) {
						return `<li class="page-item${p === currentReplyPage ? ' active' : ''}"><a class="page-link" href="#" data-page="${p}">${p}</a></li>`;
					}).join('')
					+ `<li class="page-item${currentReplyPage >= lastPage ? ' disabled' : ''}"><a class="page-link" href="#" data-page="${currentReplyPage + 1}">&raquo;</a></li>`;

				replyPaginationUl.innerHTML = pagHtml;

				replyPaginationUl.querySelectorAll('.page-link').forEach(function(link) {
					link.addEventListener('click', function(e) {
						e.preventDefault();
						var p = parseInt(this.getAttribute('data-page'));
						if (p >= 1) {
							currentReplyPage = p;
							loadMessages();
							repliesSection.scrollIntoView({ behavior: 'smooth' });
						}
					});
				});
			}

			}); /* end fetchUserVotes callback */
		})
		.catch(function(err) {
			if (loadingEl) loadingEl.innerHTML = '<div class="forums-message-list__empty text-secondary text-center py-5">' + (messageDetail.dataset.labelUnableToLoadMessages || 'Unable to load messages.') + '</div>';
			console.error('ForumsMessageDetail messages error:', err);
		});
	}

	/* Report Inappropriate Content Modal */
	var reportModalObj = null;

	function showReportModal(onSubmit) {
		var modal = document.getElementById('forumsReportModal');
		if (!modal) {
			modal = document.createElement('div');
			modal.id = 'forumsReportModal';
			modal.className = 'modal';
			modal.style.backgroundColor = 'rgba(0,0,0,0.5)';
			modal.style.zIndex = '1050';
			modal.setAttribute('tabindex', '-1');
			modal.setAttribute('role', 'dialog');
			modal.setAttribute('aria-modal', 'true');
			modal.setAttribute('aria-labelledby', 'forumsReportModalHeading');

			var reasonOptions = [
				{ value: 'spam', label: messageDetail.dataset.labelSpam || 'Spam' },
				{ value: 'harmful-dangerous-acts', label: messageDetail.dataset.labelHarmfulDangerousActs || 'Harmful Dangerous Acts' },
				{ value: 'harassment-bullying', label: messageDetail.dataset.labelHarassmentBullying || 'Harassment or Bullying' },
				{ value: 'nudity-sexual-content', label: messageDetail.dataset.labelNuditySexualContent || 'Nudity or Sexual Content' },
				{ value: 'other', label: messageDetail.dataset.labelOther || 'Other' }
			];

			var optionsHtml = reasonOptions.map(function(opt) {
				return `<option value="${Liferay.Util.escapeHTML(opt.value)}">${Liferay.Util.escapeHTML(opt.label)}</option>`;
			}).join('');

			modal.innerHTML = `
				<div class="modal-dialog modal-dialog-centered">
					<div class="modal-content">
						<div class="modal-header">
							<h1 class="modal-title" id="forumsReportModalHeading" tabindex="-1">${Liferay.Util.escapeHTML(messageDetail.dataset.labelReportInappropriateContent || 'Report Inappropriate Content')}</h1>
							<button class="close btn btn-unstyled forums-report-modal-close" type="button" aria-label="Close">
								<svg class="lexicon-icon lexicon-icon-times" role="presentation">
									<use href="${clayIconsUrl}#times"></use>
								</svg>
							</button>
						</div>
						<div class="modal-body">
							<p class="text-secondary">${Liferay.Util.escapeHTML(messageDetail.dataset.labelReportDescription || 'You are about to report a violation of our Terms of Use. All reports are strictly confidential.')}</p>
							<div class="form-group">
								<label for="forumsReportReason" class="font-weight-bold">${Liferay.Util.escapeHTML(messageDetail.dataset.labelReasonForReport || 'Reason for the Report')}</label>
								<select class="form-control" id="forumsReportReason">
									${optionsHtml}
								</select>
							</div>
						</div>
						<div class="modal-footer">
							<div class="modal-item-last">
								<div class="btn-group-spaced" role="group">
									<button class="btn btn-secondary forums-report-modal-close" type="button">${Liferay.Util.escapeHTML(messageDetail.dataset.labelCancel || 'Cancel')}</button>
									<button class="btn btn-primary" type="button" id="forumsReportModalSubmitBtn">${Liferay.Util.escapeHTML(messageDetail.dataset.labelReport || 'Report')}</button>
								</div>
							</div>
						</div>
					</div>
				</div>`;
			document.body.appendChild(modal);

			modal.querySelectorAll('.forums-report-modal-close').forEach(function(btn) {
				btn.addEventListener('click', function() {
					modal.style.display = 'none';
					modal.classList.remove('show');
				});
			});

			modal.querySelector('#forumsReportModalSubmitBtn').addEventListener('click', function() {
				var reason = modal.querySelector('#forumsReportReason').value;
				var submitBtn = this;
				submitBtn.disabled = true;
				submitBtn.textContent = '...';

				if (reportModalObj && reportModalObj.onSubmit) {
					reportModalObj.onSubmit(reason, function() {
						modal.style.display = 'none';
						modal.classList.remove('show');
						submitBtn.disabled = false;
						submitBtn.textContent = messageDetail.dataset.labelReport || 'Report';
					}, function() {
						submitBtn.disabled = false;
						submitBtn.textContent = messageDetail.dataset.labelReport || 'Report';
					});
				}
			});
		}

		/* Reset dropdown to first option each time the modal is opened */
		var selectEl = modal.querySelector('#forumsReportReason');
		if (selectEl) selectEl.selectedIndex = 0;

		reportModalObj = { onSubmit: onSubmit };

		modal.style.display = 'block';
		setTimeout(function() {
			modal.classList.add('show');
		}, 10);
	}

	/* Flag message handler */
	if (flagBtn) {
		flagBtn.addEventListener('click', function(e) {
			e.preventDefault();
			/* Already flagged – do nothing */
			if (flagBtn.disabled) return;
			/* Close the options dropdown */
			var optionsMenu = flagBtn.closest('.dropdown-menu');
			if (optionsMenu) optionsMenu.classList.remove('show');

			showReportModal(function(reason, onSuccess, onError) {
				/* addOrUpdate pattern: PATCH if a flag exists, POST if not */
				var flagUrl, flagMethod, flagBody;
				if (existingFlagId) {
					flagUrl = portalURL + '/o/c/forumsuspiciousactivities/' + existingFlagId;
					flagMethod = 'PATCH';
					flagBody = JSON.stringify({ reason: reason });
				} else {
					flagUrl = portalURL + '/o/c/forumsuspiciousactivities/scopes/' + scopeGroupId;
					flagMethod = 'POST';
					flagBody = JSON.stringify({
						reason: reason,
						suspiciousMessageId: parseInt(messageId),
						r_threadSuspiciousActivities_c_forumThreadId: parseInt(messageId)
					});
				}

				Liferay.Util.fetch(flagUrl, {
					headers: headers,
					method: flagMethod,
					body: flagBody
				})
				.then(function(r) {
					if (r.ok) {
						return r.json().then(function(body) {
							existingFlagId = body.id;
							onSuccess();
							flagBtn.textContent = messageDetail.dataset.labelFlagged || 'Flagged';
							flagBtn.classList.add('disabled');
							flagBtn.disabled = true;
							/* Standard Liferay toast feedback */
							if (Liferay.Util && Liferay.Util.openToast) {
								Liferay.Util.openToast({
									message: messageDetail.dataset.labelReportSubmitted || 'Thank you! Your report has been submitted.',
									type: 'success'
								});
							}
						});
					} else {
						onError();
						console.error('Report submission failed');
					}
				})
				.catch(function(err) {
					onError();
					console.error('Report error:', err);
				});
			});
		});
	}

	/* Reply button - open compose modal in reply mode */
	if (replyBtn) {
		replyBtn.addEventListener('click', function() {
			if (typeof window.forumsOpenComposeModal === 'function') {
				window.forumsOpenComposeModal({ messageId: messageId });
			} else {
				alert(messageDetail.dataset.labelReplyFormNotFound || 'Reply form not found on this page. Please add the forums-message-composer fragment.');
			}
		});
	}

	if (Liferay.ThemeDisplay.isSignedIn()) {
		Liferay.Util.fetch(portalURL + '/o/c/forumbans/scopes/' + scopeGroupId + '?filter=' + encodeURIComponent('banUserId eq ' + currentUserId) + '&pageSize=1', {
			headers: headers,
			method: 'GET'
		})
		.then(function(r) { return r.json(); })
		.then(function(data) {
			if (data.items && data.items.length > 0) {
				isBanned = true;
			}
			initMessageDetail();
		})
		.catch(function(err) {
			console.error('Error checking ban status', err);
			initMessageDetail();
		});
	} else {
		initMessageDetail();
	}
	
	} // end runMessageDetail

	/* Resolve messageId: ?messageId param → mapped reply ERC → mapped message ERC → URL path slug */
	if (messageId) {
		runMessageDetail(messageId, null);
	} else {
		/* Reply ERC takes priority — set when this fragment is on a Forum Message Display Page */
		var replyErcEl = messageDetail.querySelector('#forumsDetailReplyERC');
		var replyErc = replyErcEl ? replyErcEl.textContent.trim() : null;
		if (replyErc === 'Mappable Reply ERC') replyErc = null;

		if (replyErc) {
			Liferay.Util.fetch(portalURL + '/o/c/forummessages/scopes/' + scopeGroupId + '/by-external-reference-code/' + encodeURIComponent(replyErc), {
				headers: headers,
				method: 'GET'
			})
			.then(function(r) {
				if (!r.ok) throw new Error('Not found');
				return r.json();
			})
			.then(function(reply) {
				var parentMessageId = reply.r_threadMessages_c_forumThreadId;
				runMessageDetail(parentMessageId ? String(parentMessageId) : null, reply.id ? String(reply.id) : null);
			})
			.catch(function() { runMessageDetail(null, null); });
		} else {
			var ercEl = messageDetail.querySelector('#forumsDetailERC');
			var erc = ercEl ? ercEl.textContent.trim() : null;
			if (erc === 'Mappable Message ERC') erc = null;

			if (!erc) {
				if (loadingEl) loadingEl.innerHTML = '<div class="forums-message-list__empty text-secondary text-center py-5">' + (messageDetail.dataset.labelErcNotMapped || 'Message ERC is not mapped.') + '</div>';
			} else {
				Liferay.Util.fetch(portalURL + '/o/c/forumthreads/scopes/' + scopeGroupId + '/by-external-reference-code/' + encodeURIComponent(erc), {
					headers: headers,
					method: 'GET'
				})
				.then(function(r) {
					if (!r.ok) throw new Error('Not found');
					return r.json();
				})
				.then(function(data) {
					runMessageDetail(data.id ? String(data.id) : null, null);
				})
				.catch(function() { runMessageDetail(null, null); });
			}
		}
	}
}