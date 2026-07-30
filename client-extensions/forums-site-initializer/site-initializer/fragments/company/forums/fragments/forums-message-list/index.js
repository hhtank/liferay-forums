// SPDX-License-Identifier: LGPL-2.1-or-later
var messageList = fragmentElement.querySelector('#forumsMessageList');

if (messageList) {
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
	var headers = {
		'Accept': 'application/json',
		'Content-Type': 'application/json'
	};
	var clayIconsUrl = Liferay.ThemeDisplay.getPathThemeImages() + '/clay/icons.svg';

	/* Point first breadcrumb crumb ("Forums") at the configured community home */
	var homeCrumb = messageList.querySelector('#forumsMessageListBreadcrumbHome');
	if (homeCrumb) {
		homeCrumb.href = sitePrefix + ((typeof configuration !== 'undefined' && configuration.communityURL) ? configuration.communityURL : '/forums');
	}

	/* State */
	var currentSort = 'dateCreated:desc';
	var currentPage = 1;
	var pageSize = 20;
	var categoryId = null;
	var searchQuery = '';
	var currentUserId = Liferay.ThemeDisplay.getUserId();
	var isBanned = false;

	/* DOM refs */
	var cardsContainer = messageList.querySelector('#forumsMessageListCards');
	var loadingEl = messageList.querySelector('#forumsMessageListLoading');
	var skeletonHTML = loadingEl ? loadingEl.innerHTML : '';
	var skeletonStart = 0;
	var SKELETON_MIN_MS = 400;
	var paginationNav = messageList.querySelector('#forumsMessageListPagination');
	var paginationUl = messageList.querySelector('#forumsMessageListPaginationUl');
	var headingEl = messageList.querySelector('#forumsMessageListHeading');
	var breadcrumbName = messageList.querySelector('#forumsMessageListCategoryName');
	var searchInput = messageList.querySelector('#forumsMessageListSearchInput');
	var searchBtn = messageList.querySelector('#forumsMessageListSearchBtn');
	var tabLinks = messageList.querySelectorAll('#forumsMessageListTabs .nav-link');
	var askBtn = messageList.querySelector('#forumsMessageListAskBtn');
	var newDiscussionBaseUrl = askBtn ? askBtn.getAttribute('href') : '';
	var categoryFilter = messageList.querySelector('#forumsMessageListCategoryFilter');
	var showingEl = messageList.querySelector('#forumsMessageListShowing');
	var breadcrumbOl = messageList.querySelector('#forumsMessageListBreadcrumb');
	var subcatsContainer = messageList.querySelector('#forumsMessageListSubcategories');
	var subcatsRow = messageList.querySelector('#forumsMessageListSubcategoriesRow');

	/* FK exposed by the ForumCategory self-relationship (0 / absent = top-level) */
	var PARENT_FK = 'r_categorySubcategories_c_forumCategoryId';

	/* Subcategories are capped at ONE level — see MAX_DEPTH in
	   forums-categories-admin. Kept as a constant, never a setting. */
	var MAX_DEPTH = 1;
	var categoryTree = null;

	/* Read URL params */
	var urlParams = new URLSearchParams(window.location.search);
	categoryId = urlParams.get('categoryId');
	searchQuery = urlParams.get('q') || '';
	if (searchInput && searchQuery) searchInput.value = searchQuery;

	/* Icons */
	var checkIcon = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.6 0 0 3.6 0 8s3.6 8 8 8 8-3.6 8-8-3.6-8-8-8zm3.7 6.3l-4 4c-.2.2-.4.3-.7.3s-.5-.1-.7-.3l-2-2c-.4-.4-.4-1 0-1.4s1-.4 1.4 0L7 8.2l3.3-3.3c.4-.4 1-.4 1.4 0s.4 1 0 1.4z"/></svg>';
	var replyIcon = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M14 1H2C.9 1 0 1.9 0 3v7c0 1.1.9 2 2 2h3l3 3 3-3h3c1.1 0 2-.9 2-2V3c0-1.1-.9-2-2-2zm0 9H2V3h12v7z"/></svg>';
	var clockIcon = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.6 0 0 3.6 0 8s3.6 8 8 8 8-3.6 8-8-3.6-8-8-8zm0 14c-3.3 0-6-2.7-6-6s2.7-6 6-6 6 2.7 6 6-2.7 6-6 6z"/><path d="M9 4H7v5l3.5 2.1.5-.9L9 8.5z"/></svg>';
	var eyeIcon = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 3C3.58 3 0 8 0 8s3.58 5 8 5 8-5 8-5-3.58-5-8-5zm0 8.5c-1.93 0-3.5-1.57-3.5-3.5S6.07 4.5 8 4.5 11.5 6.07 11.5 8 9.93 11.5 8 11.5z"/><circle cx="8" cy="8" r="2"/></svg>';

	/* Utility: relative time */
	function timeAgo(dateStr) {
		if (!dateStr) return '';
		var now = Date.now();
		var then = new Date(dateStr).getTime();
		var diff = Math.floor((now - then) / 1000);
		if (diff < 60) return messageList.dataset.labelJustNow || 'just now';
		if (diff < 3600) return (messageList.dataset.labelXMinutesAgo || '{0}m ago').replace('{0}', Math.floor(diff / 60));
		if (diff < 86400) return (messageList.dataset.labelXHoursAgo || '{0}h ago').replace('{0}', Math.floor(diff / 3600));
		if (diff < 2592000) return (messageList.dataset.labelXDaysAgo || '{0}d ago').replace('{0}', Math.floor(diff / 86400));
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

	/* Utility: avatar initial */
	function avatarInitial(name) {
		if (!name) return '?';
		return name.charAt(0).toUpperCase();
	}

	/* Utility: stable avatar color from the Clay sticker-outline-0..9 palette */
	function avatarColorClass(creator) {
		var key = String((creator && (creator.id || creator.name)) || '');
		var n = 0;
		for (var i = 0; i < key.length; i++) { n = (n + key.charCodeAt(i)) % 10; }
		return 'sticker-outline-' + n;
	}

	function displayName(creator) {
		if (!creator) return '';
		var given = creator.givenName || '';
		var family = creator.familyName || '';
		return (family && family !== 'User') ? (given + ' ' + family) : (given || creator.name || '');
	}

	/* Gamification (Phase 3, Step A): show each thread author's rank title
	   beneath their avatar. rankLadder is the ForumRank ladder sorted
	   descending by minPosts (fetched once); statsUserMap caches userId ->
	   messageCount. Rank is computed client-side; no post count is shown here
	   (the raw count is left to the message-detail cards). */
	var rankLadder = null;
	var statsUserMap = {};

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

	function rankLabel(count) {
		if (!rankLadder) return '';
		for (var i = 0; i < rankLadder.length; i++) {
			if (count >= rankLadder[i].minPosts) return rankLadder[i].label;
		}
		return '';
	}

	/* Fill the rank placeholder under each thread author's avatar. Rank-only:
	   no post count. Placeholders with an empty rank stay hidden. */
	function fillAuthorRanks() {
		var els = cardsContainer.querySelectorAll('[data-forums-rank-user]');
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
					if (!rank) return;
					el.textContent = rank;
					el.style.display = '';
				});
			});
		});
	}

	/* Thread priority badge (Message Boards parity: Urgent|bolt|3.0,
	   Sticky|pin|2.0, Announcement|comments|1.0). Values <= 0, missing, or
	   unknown render nothing, matching MBUtil.getThreadPriority. */
	var PRIORITY_LEVELS = {
		3: { icon: 'bolt', labelKey: 'labelUrgent', fallback: 'Urgent', textClass: 'text-danger' },
		2: { icon: 'pin', labelKey: 'labelSticky', fallback: 'Sticky', textClass: 'text-warning' },
		1: { icon: 'comments', labelKey: 'labelAnnouncement', fallback: 'Announcement', textClass: 'text-info' }
	};

	function priorityBadge(priority, dataset) {
		var level = PRIORITY_LEVELS[Math.round(parseFloat(priority)) || 0];
		if (!level) return '';
		var label = dataset[level.labelKey] || level.fallback;
		return '<span class="forums-message-card__solved ' + level.textClass + ' ml-3 small">'
			+ '<svg class="lexicon-icon lexicon-icon-' + level.icon + '" role="presentation"><use href="' + clayIconsUrl + '#' + level.icon + '"></use></svg> '
			+ Liferay.Util.escapeHTML(label) + '</span>';
	}

	/* --- Category hierarchy -------------------------------------------- */

	function getParentId(cat) {
		return Number(cat[PARENT_FK]) || 0;
	}

	/* Link to another category on this same page */
	function categoryHref(id) {
		return window.location.pathname + '?categoryId=' + id;
	}

	/* Build {byId, childrenOf} from a flat list. Anything deeper than
	   MAX_DEPTH — only reachable by writing the FK directly through the REST
	   API — is normalized to top-level so it still renders somewhere. */
	function buildTree(items) {
		var byId = {};
		items.forEach(function(cat) { byId[cat.id] = cat; });

		var depthOf = {};
		items.forEach(function(cat) {
			var depth = 0;
			var pid = getParentId(cat);
			var guard = 0;
			while (pid && byId[pid] && guard < 50) {
				depth++;
				pid = getParentId(byId[pid]);
				guard++;
			}
			depthOf[cat.id] = depth;
		});

		var childrenOf = {};
		items.forEach(function(cat) {
			var pid = getParentId(cat);
			if (!pid || !byId[pid] || depthOf[cat.id] > MAX_DEPTH) pid = 0;
			(childrenOf[pid] = childrenOf[pid] || []).push(cat);
		});

		return { byId: byId, childrenOf: childrenOf, depthOf: depthOf };
	}

	/* Rebuild the breadcrumb as Forums > [Parent >] Current.
	   With the one-level cap this is at most three crumbs. */
	function buildBreadcrumb(tree) {
		if (!breadcrumbName) return;

		var allLabel = messageList.dataset.labelAllCategories || messageList.dataset.labelAllMessages || 'All Messages';
		var activeLi = breadcrumbName.closest('li');

		/* Drop ancestor crumbs from a previous render */
		if (breadcrumbOl) {
			breadcrumbOl.querySelectorAll('.forums-breadcrumb-ancestor').forEach(function(el) { el.remove(); });
		}

		var current = categoryId ? tree.byId[categoryId] : null;
		var name = current
			? (current.categoryName || messageList.dataset.labelCategory || 'Category')
			: allLabel;

		breadcrumbName.textContent = name;
		if (headingEl) headingEl.textContent = name;

		if (!current || !activeLi || !breadcrumbOl) return;

		/* Walk up the parent chain (cycle-guarded; at most one hop when capped) */
		var ancestors = [];
		var pid = getParentId(current);
		var guard = 0;
		while (pid && tree.byId[pid] && guard < 50) {
			ancestors.unshift(tree.byId[pid]);
			pid = getParentId(tree.byId[pid]);
			guard++;
		}

		ancestors.forEach(function(anc) {
			var li = document.createElement('li');
			li.className = 'breadcrumb-item forums-breadcrumb-ancestor';
			var a = document.createElement('a');
			a.className = 'breadcrumb-link';
			a.href = categoryHref(anc.id);
			a.textContent = anc.categoryName || '';
			li.appendChild(a);
			breadcrumbOl.insertBefore(li, activeLi);
		});
	}

	/* Fill the filter dropdown with an indented two-tier category tree */
	function populateCategoryFilter(tree) {
		if (!categoryFilter) return;
		(tree.childrenOf[0] || []).forEach(function(cat) {
			categoryFilter.appendChild(categoryOption(cat, 0));
			(tree.childrenOf[cat.id] || []).forEach(function(child) {
				categoryFilter.appendChild(categoryOption(child, 1));
			});
		});
	}

	function categoryOption(cat, depth) {
		var opt = document.createElement('option');
		opt.value = cat.id;
		opt.textContent = (depth > 0 ? '— ' : '') + (cat.categoryName || '');
		if (String(cat.id) === String(categoryId)) opt.selected = true;
		return opt;
	}

	/* Render the current category's subcategories as navigable cards.
	   A parent lists only its OWN topics, so these cards are the way into
	   subcategory content — hidden entirely when there are none, which keeps
	   a flat forum looking exactly as it did before. */
	function renderSubcategories(tree) {
		if (!subcatsContainer || !subcatsRow) return;
		subcatsRow.innerHTML = '';

		var children = categoryId ? (tree.childrenOf[categoryId] || []) : [];
		if (children.length === 0) {
			subcatsContainer.style.display = 'none';
			return;
		}

		children.forEach(function(cat) {
			var col = document.createElement('div');
			col.className = 'col-sm-6 col-lg-4 mb-3';

			var card = document.createElement('a');
			card.href = categoryHref(cat.id);
			card.className = 'card card-interactive card-interactive-secondary h-100 text-decoration-none';

			var body = document.createElement('div');
			body.className = 'card-body';

			var title = document.createElement('div');
			title.className = 'card-title font-weight-semi-bold mb-1';
			title.textContent = cat.categoryName || '';
			body.appendChild(title);

			if (cat.categoryDescription) {
				var desc = document.createElement('p');
				desc.className = 'card-text text-secondary small mb-0';
				desc.textContent = cat.categoryDescription;
				body.appendChild(desc);
			}

			card.appendChild(body);
			col.appendChild(card);
			subcatsRow.appendChild(col);
		});

		subcatsContainer.style.display = '';
	}

	/* One fetch drives the breadcrumb, the filter dropdown and the
	   subcategory cards. */
	Liferay.Util.fetch(portalURL + '/o/c/forumcategories/scopes/' + scopeGroupId + '?pageSize=200&sort=categoryName:asc', {
		headers: headers,
		method: 'GET'
	})
	.then(function(r) { return r.json(); })
	.then(function(data) {
		categoryTree = buildTree(data.items || []);

		buildBreadcrumb(categoryTree);
		populateCategoryFilter(categoryTree);
		renderSubcategories(categoryTree);
	})
	.catch(function() {});

	if (categoryFilter) {
		categoryFilter.addEventListener('change', function() {
			categoryId = this.value || null;
			currentPage = 1;

			var params = new URLSearchParams(window.location.search);
			if (categoryId) {
				params.set('categoryId', categoryId);
			}
			else {
				params.delete('categoryId');
			}
			history.pushState(null, '', window.location.pathname + (params.toString() ? '?' + params.toString() : ''));

			if (categoryTree) {
				buildBreadcrumb(categoryTree);
				renderSubcategories(categoryTree);
			}

			loadMessages();
		});
	}

	/* Load messages */
	function loadMessages() {
		cardsContainer.querySelectorAll('.forums-message-card').forEach(function(el) { el.remove(); });
		cardsContainer.querySelectorAll('.forums-message-list__empty').forEach(function(el) { el.remove(); });
		if (paginationNav) paginationNav.style.display = 'none';
		if (showingEl) showingEl.style.display = 'none';

		if (loadingEl) {
			loadingEl.classList.remove('forums-skeleton--fade-out');
			loadingEl.innerHTML = skeletonHTML;
			loadingEl.style.display = '';
			loadingEl.setAttribute('aria-busy', 'true');
			skeletonStart = Date.now();
		}

		var filterParts = [];
		if (categoryId) {
			filterParts.push('r_categoryThreads_c_forumCategoryId eq \'' + categoryId + '\'');
		}

		/* Prioritized threads always sort on top (MB orders every listing by
		   priority DESC, lastPostDate DESC). Search results are the exception:
		   the priority field is not search-indexed, so — as in MB — search-driven
		   listings keep the plain tab sort. */
		var effectiveSort = searchQuery ? currentSort : 'priority:desc,' + currentSort;

		var url = portalURL + '/o/c/forumthreads/scopes/' + scopeGroupId + '?page=' + currentPage
			+ '&pageSize=' + pageSize
			+ '&sort=' + effectiveSort;

		if (filterParts.length > 0) {
			url += '&filter=' + encodeURIComponent(filterParts.join(' and '));
		}

		if (searchQuery) {
			url += '&search=' + encodeURIComponent(searchQuery);
		}

		Liferay.Util.fetch(url, { headers: headers, method: 'GET' })
		.then(function(r) { return r.json(); })
		.then(function(data) {
			hideSkeleton();

			if (askBtn) {
				if (!isBanned && data.actions && (data.actions['post'] || data.actions['create'])) {
					askBtn.style.display = '';

					/* Carry the current category into New Discussion so the
					   composer preselects it — no manual category pick when
					   posting from within a category. */
					askBtn.href = categoryId
						? newDiscussionBaseUrl + '?categoryId=' + encodeURIComponent(categoryId)
						: newDiscussionBaseUrl;
				} else {
					askBtn.style.display = 'none';
				}
			}

			var items = data.items || [];
			var totalCount = data.totalCount || 0;
			var lastPage = data.lastPage || 1;

			if (items.length === 0) {
				cardsContainer.innerHTML = '<div class="forums-message-list__empty text-secondary text-center py-5">' + (messageList.dataset.labelNoMessages || 'No messages found.') + '</div>';
				return;
			}

			/* Fetch replies and activities separately to avoid JOIN-based pagination overlap */
			var messageIds = items.map(function(t) { return t.id; });
			var repliesFilter = messageIds.map(function(id) {
				return 'r_threadMessages_c_forumThreadId eq \'' + id + '\'';
			}).join(' or ');
			var activitiesFilter = messageIds.map(function(id) {
				return 'r_threadSuspiciousActivities_c_forumThreadId eq \'' + id + '\'';
			}).join(' or ');

			return Promise.all([
				Liferay.Util.fetch(
					portalURL + '/o/c/forummessages/scopes/' + scopeGroupId
						+ '?filter=' + encodeURIComponent(repliesFilter)
						+ '&pageSize=500&sort=dateCreated:asc',
					{ headers: headers, method: 'GET' }
				).then(function(r) { return r.json(); }).catch(function() { return { items: [] }; }),
				Liferay.Util.fetch(
					portalURL + '/o/c/forumsuspiciousactivities/scopes/' + scopeGroupId
						+ '?filter=' + encodeURIComponent(activitiesFilter)
						+ '&pageSize=500',
					{ headers: headers, method: 'GET' }
				).then(function(r) { return r.json(); }).catch(function() { return { items: [] }; })
			]).then(function(results) {
				var repliesByMessage = {};
				(results[0].items || []).forEach(function(reply) {
					var tid = reply.r_threadMessages_c_forumThreadId;
					if (!repliesByMessage[tid]) repliesByMessage[tid] = [];
					repliesByMessage[tid].push(reply);
				});
				var activitiesByMessage = {};
				(results[1].items || []).forEach(function(activity) {
					var tid = activity.r_threadSuspiciousActivities_c_forumThreadId;
					if (!activitiesByMessage[tid]) activitiesByMessage[tid] = [];
					activitiesByMessage[tid].push(activity);
				});
				items.forEach(function(msg) {
					msg.threadMessages = repliesByMessage[msg.id] || [];
					msg.threadSuspiciousActivities = activitiesByMessage[msg.id] || [];
				});

			var html = '';
			var missingDisplayPage = false;
			items.forEach(function(msg) {
				if (isBanned && msg.actions) {
					msg.actions = {};
				}
				var title = msg.messageTitle || messageList.dataset.labelUntitledMessage || 'Untitled Message';
				var messageId = msg.id || '';
				var creatorName = displayName(msg.creator) || messageList.dataset.labelUnknown || 'Unknown';
				var creatorImage = (msg.creator && msg.creator.image) || '';
				var dateStr = msg.dateCreated || '';
				var messages = msg.threadMessages || [];
				var replyCount = messages.length > 0 ? messages.length - 1 : 0;
				var hasSolution = false;

				for (var i = 0; i < messages.length; i++) {
					if (messages[i].answer === true) {
						hasSolution = true;
						break;
					}
				}

				var isFlagged = false;
				var suspiciousActivities = msg.threadSuspiciousActivities || [];
				for (var s = 0; s < suspiciousActivities.length; s++) {
					if (suspiciousActivities[s].validated === true) {
						isFlagged = true;
						break;
					}
				}

				/* Get first message body as preview */
				var preview = '';
				if (messages.length > 0 && messages[0].body) {
					var tmp = document.createElement('div');
					tmp.innerHTML = messages[0].body;
					preview = tmp.textContent || tmp.innerText || '';
					if (preview.length > 160) preview = preview.substring(0, 160) + '...';
				}

				/* Avatar (Clay sticker). Image stickers use `sticker-user-icon`
				   (white bg + subtle gray ring); initial-based stickers use
				   the colored `sticker-outline-N` palette. */
				var avatarHtml;
				if (creatorImage) {
					avatarHtml = '<span class="sticker sticker-circle sticker-lg"><span class="sticker-overlay"><img class="sticker-img" src="' + Liferay.Util.escapeHTML(creatorImage) + '" alt="' + Liferay.Util.escapeHTML(creatorName) + '"></span></span>';
				} else {
					avatarHtml = '<span class="sticker sticker-circle sticker-lg ' + avatarColorClass(msg.creator) + '"><span class="sticker-overlay">' + avatarInitial(creatorName) + '</span></span>';
				}

				/* Solved badge */
				var solvedBadge = '';
				if (msg.question && hasSolution) {
					var solvedText = messageList.dataset.labelSolved || 'Solved';
					solvedBadge = '<span class="forums-message-card__solved text-success font-weight-semi-bold ml-3 small">' + checkIcon + ' ' + solvedText + '</span>';
				}

				var priorityBadgeHtml = priorityBadge(msg.priority, messageList.dataset);

				var siteSlug = (msg.scopeKey || '').toLowerCase().replace(/ /g, '-');
				var topicHref = msg.friendlyUrlPath
					? sitePrefix + '/c_forumthread/' + msg.friendlyUrlPath
					: null;
				if (!topicHref) missingDisplayPage = true;

				var flaggedBadge = '';
				if (isFlagged) {
					var flaggedText = messageList.dataset.labelFlagged || 'Flagged';
					flaggedBadge = '<span class="forums-message-card__solved text-danger ml-3 small"><svg class="lexicon-icon lexicon-icon-warning-full" role="presentation" viewBox="0 0 16 16" fill="currentColor"><path d="M16 14.5L8 1 0 14.5h16zM8 13c-.6 0-1-.4-1-1s.4-1 1-1 1 .4 1 1-.4 1-1 1zm1-3H7V6h2v4z"/></svg> ' + flaggedText + '</span>';
				}

				html += '<div class="card forums-message-card">'
					+ '<div class="card-body">'
					+ '<div class="autofit-row">'
					+ '<div class="autofit-col forums-message-card__avatar-col">'
					+ avatarHtml
					+ '<div class="forums-message-card__username text-secondary text-truncate">' + Liferay.Util.escapeHTML(creatorName) + '</div>'
					+ (msg.creator && msg.creator.id
						? '<span class="d-block text-secondary small forums-message-card__rank" data-forums-rank-user="' + msg.creator.id + '" style="display:none"></span>'
						: '')
					+ '</div>'
					+ '<div class="autofit-col autofit-col-expand forums-message-card__content">'
					+ '<h5 class="card-title forums-message-card__title">'
					+ (topicHref ? '<a href="' + topicHref + '">' + Liferay.Util.escapeHTML(title) + '</a>' : '<span>' + Liferay.Util.escapeHTML(title) + '</span>')
					+ priorityBadgeHtml
					+ solvedBadge
					+ flaggedBadge
					+ '</h5>'
					+ '<p class="forums-message-card__preview text-secondary">' + Liferay.Util.escapeHTML(preview) + '</p>'
					+ (function() {
						var messageTags = msg.keywords || [];
						if (messageTags.length === 0) return '';
						var tHtml = '<div class="forums-message-card__tags">';
						messageTags.forEach(function(tag) {
							tHtml += '<span class="label label-lg forums-message-card__tag"><span class="label-item label-item-expand">' + Liferay.Util.escapeHTML(tag) + '</span></span>';
						});
						tHtml += '</div>';
						return tHtml;
					})()
					+ '<div class="forums-message-card__meta text-secondary small">'
					+ '<span class="forums-message-card__meta-item">' + clockIcon + ' <time datetime="' + dateStr + '" title="' + fullDateTime(dateStr) + '" aria-label="' + fullDateTime(dateStr) + '">' + timeAgo(dateStr) + '</time></span>'
					+ '<span class="forums-message-card__meta-item">' + replyIcon + ' ' + (replyCount === 1 ? (messageList.dataset.labelXReply || '{0} comment').replace('{0}', replyCount) : (messageList.dataset.labelXReplies || '{0} comments').replace('{0}', replyCount)) + '</span>'
					+ '<span class="forums-message-card__meta-item">' + eyeIcon + ' ' + (msg.viewCount || 0) + '</span>'
					+ (msg.actions && msg.actions['delete']
						? '<span class="forums-message-card__meta-item ml-auto"><button class="btn btn-monospaced btn-sm btn-outline-danger forums-list-delete-btn" data-delete-url="' + msg.actions['delete'].href + '" title="' + (messageList.dataset.labelDelete || 'Delete') + '" aria-label="' + (messageList.dataset.labelDelete || 'Delete') + '"><svg class="lexicon-icon lexicon-icon-trash" role="presentation"><use href="' + clayIconsUrl + '#trash"></use></svg></button></span>'
						: '')
					+ '</div>'
					+ '</div>'
					+ '</div>'
					+ '</div>'
					+ '</div>';
			});

			cardsContainer.innerHTML = html;
			attachDeleteHandlers();

			/* Fill each thread author's rank title now that the cards exist. */
			fillAuthorRanks();

			if (missingDisplayPage && Liferay.Util && Liferay.Util.openToast) {
				Liferay.Util.openToast({
					message: messageList.dataset.labelDisplayPageNotConfigured || 'Display page is not configured for one or more messages.',
					type: 'danger'
				});
			}

			/* Showing x-y of total */
			if (showingEl && totalCount > 0) {
				var startItem = (currentPage - 1) * pageSize + 1;
				var endItem = Math.min(currentPage * pageSize, totalCount);
				var showingLabel = (messageList.dataset.labelShowing || 'Showing {0} of {1} Items')
					.replace('{0}', startItem + '-' + endItem).replace('{1}', totalCount);
				showingEl.textContent = showingLabel;
				showingEl.style.display = '';
			}

			/* Pagination */
			if (lastPage > 1 && paginationNav && paginationUl) {
				paginationNav.style.display = '';
				var pagHtml = '';

				pagHtml += '<li class="page-item' + (currentPage <= 1 ? ' disabled' : '') + '">'
					+ '<a class="page-link" href="#" data-page="' + (currentPage - 1) + '">&laquo;</a></li>';

				var delta = 2;
				var pageNumbers = [1];
				var rangeStart = Math.max(2, currentPage - delta);
				var rangeEnd = Math.min(lastPage - 1, currentPage + delta);

				if (rangeStart > 2) pageNumbers.push('ellipsis');
				for (var p = rangeStart; p <= rangeEnd; p++) pageNumbers.push(p);
				if (rangeEnd < lastPage - 1) pageNumbers.push('ellipsis');
				pageNumbers.push(lastPage);

				pageNumbers.forEach(function(p) {
					if (p === 'ellipsis') {
						pagHtml += '<li class="page-item disabled"><span class="page-link">&hellip;</span></li>';
					} else {
						pagHtml += '<li class="page-item' + (p === currentPage ? ' active' : '') + '">'
							+ '<a class="page-link" href="#" data-page="' + p + '">' + p + '</a></li>';
					}
				});

				pagHtml += '<li class="page-item' + (currentPage >= lastPage ? ' disabled' : '') + '">'
					+ '<a class="page-link" href="#" data-page="' + (currentPage + 1) + '">&raquo;</a></li>';

				paginationUl.innerHTML = pagHtml;

				paginationUl.querySelectorAll('.page-link').forEach(function(link) {
					link.addEventListener('click', function(e) {
						e.preventDefault();
						var p = parseInt(this.getAttribute('data-page'));
						if (p >= 1 && p <= lastPage) {
							currentPage = p;
							loadMessages();
							messageList.scrollIntoView({ behavior: 'smooth' });
						}
					});
				});
			}
			}); /* close Promise.all().then() */
		})
		.catch(function(err) {
			hideSkeleton();
			cardsContainer.innerHTML = '<div class="forums-message-list__empty text-secondary text-center py-5">' + (messageList.dataset.labelUnableToLoad || 'Unable to load messages.') + '</div>';
			console.error('ForumsMessageList error:', err);
		});
	}

	function hideSkeleton() {
		if (!loadingEl) return;
		var elapsed = Date.now() - skeletonStart;
		var remaining = Math.max(0, SKELETON_MIN_MS - elapsed);
		setTimeout(function() {
			loadingEl.classList.add('forums-skeleton--fade-out');
			setTimeout(function() {
				loadingEl.style.display = 'none';
				loadingEl.removeAttribute('aria-busy');
				loadingEl.classList.remove('forums-skeleton--fade-out');
			}, 250);
		}, remaining);
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

			modal.innerHTML = '<div class="modal-dialog modal-dialog-sm modal-dialog-centered modal-danger">' +
				'<div class="modal-content">' +
				'<div class="modal-header">' +
				'<h1 class="modal-title" tabindex="-1">' +
				'<div class="modal-title-indicator">' +
				'<svg class="lexicon-icon lexicon-icon-exclamation-full" role="presentation">' +
				'<use href="' + clayIconsUrl + '#exclamation-full"></use>' +
				'</svg>' +
				'</div>' +
				'<span id="forumsDeleteModalHeading"></span>' +
				'</h1>' +
				'<button class="close btn btn-unstyled forums-delete-modal-close" type="button" aria-label="Close">' +
				'<svg class="lexicon-icon lexicon-icon-times" role="presentation">' +
				'<use href="' + clayIconsUrl + '#times"></use>' +
				'</svg>' +
				'</button>' +
				'</div>' +
				'<div class="modal-body">' +
				'<div class="liferay-modal-body" id="forumsDeleteModalBody"></div>' +
				'</div>' +
				'<div class="modal-footer">' +
				'<div class="modal-item-last">' +
				'<div class="btn-group-spaced" role="group">' +
				'<button class="btn btn-secondary forums-delete-modal-close" type="button">' + (messageList.dataset.labelCancel || 'Cancel') + '</button>' +
				'<button class="btn btn-danger" type="button" id="forumsDeleteModalConfirmBtn">' + (messageList.dataset.labelDelete || 'Delete') + '</button>' +
				'</div>' +
				'</div>' +
				'</div>' +
				'</div>' +
				'</div>';
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

	function attachDeleteHandlers() {
		messageList.querySelectorAll('.forums-list-delete-btn').forEach(function(btn) {
			btn.addEventListener('click', function(e) {
				e.preventDefault();
				e.stopPropagation();
				
				var title = messageList.dataset.labelDeleteTopic || 'Delete Topic';
				var confirmMsg = messageList.dataset.labelConfirmDeleteTopic || 'Deleting a topic is an action impossible to revert. All the replies in the topic will be removed and it will not be possible to recover them.';
				
				var deleteUrl = this.getAttribute('data-delete-url');
				var card = this.closest('.forums-message-card');

				showDeleteModal(title, confirmMsg, function() {
					Liferay.Util.fetch(deleteUrl, {
						headers: headers,
						method: 'DELETE'
					})
					.then(function(r) {
						if (r.ok) {
							if (card) {
								card.style.opacity = '0.5';
								setTimeout(function() { card.remove(); }, 300);
							}
							setTimeout(loadMessages, 1500);
						} else {
							console.error('Failed to delete topic');
						}
					})
					.catch(function(err) { console.error('Delete topic error:', err); });
				});
			});
		});
	}

	/* Tab click handlers */
	tabLinks.forEach(function(tab) {
		tab.addEventListener('click', function(e) {
			e.preventDefault();
			tabLinks.forEach(function(t) {
				t.classList.remove('active');
				t.setAttribute('aria-selected', 'false');
			});
			this.classList.add('active');
			this.setAttribute('aria-selected', 'true');
			currentSort = this.getAttribute('data-sort');
			currentPage = 1;
			loadMessages();
		});
	});

	/* Search handler */
	function doSearch() {
		searchQuery = searchInput ? searchInput.value.trim() : '';
		currentPage = 1;
		loadMessages();
	}

	if (searchBtn) {
		searchBtn.addEventListener('click', doSearch);
	}

	if (searchInput) {
		searchInput.addEventListener('keypress', function(e) {
			if (e.key === 'Enter') {
				e.preventDefault();
				doSearch();
			}
		});
	}

	/* Initial load */
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
			loadMessages();
		})
		.catch(function(err) {
			console.error('Error checking ban status', err);
			loadMessages();
		});
	} else {
		loadMessages();
	}
}
