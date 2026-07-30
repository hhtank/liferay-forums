// SPDX-License-Identifier: LGPL-2.1-or-later

/* The New Discussion button is revealed only for users who may create a
   thread. Mirrors the forums-message-list ask button: the forumthreads
   collection actions must be read client-side, as the viewing user. */
var askBtn = fragmentElement.querySelector('#forumsHeroAskBtn');

if (askBtn) {
	Liferay.Util.fetch(Liferay.ThemeDisplay.getPortalURL() + '/o/c/forumthreads/scopes/'
		+ Liferay.ThemeDisplay.getScopeGroupId() + '?page=1&pageSize=1', {
		headers: {
			'Accept': 'application/json',
			'Content-Type': 'application/json'
		},
		method: 'GET'
	})
	.then(function(r) { return r.json(); })
	.then(function(data) {
		if (data && data.actions && (data.actions['post'] || data.actions['create'])) {
			askBtn.style.display = '';
		}
	})
	.catch(function() {});
}

var topPosters = fragmentElement.querySelector('#forumsHeroTopPosters');

/* No container means Top Posters is disabled, so no requests are made. */
if (topPosters) {
	var portalURL = Liferay.ThemeDisplay.getPortalURL();
	var scopeGroupId = Liferay.ThemeDisplay.getScopeGroupId();
	var headers = {
		'Accept': 'application/json',
		'Content-Type': 'application/json'
	};

	var postersCount = parseInt(topPosters.dataset.postersCount || '3', 10) || 3;
	var showRank = topPosters.dataset.showRank !== 'false';

	/* Placeholder text is light on the blue backdrop, muted on white. */
	var mutedClass = topPosters.dataset.onDark === 'true' ? 'text-white-50' : 'text-secondary';

	var leaderboard = topPosters.querySelector('#forumsHeroLeaderboard');

	/* Rank ladder cached after first fetch, sorted descending by minPosts. */
	var rankLadder = null;

	function displayName(creator) {
		if (!creator) return '';
		var given = creator.givenName || '';
		var family = creator.familyName || '';
		return (family && family !== 'User') ? (given + ' ' + family) : (given || creator.name || '');
	}

	function avatarInitial(name) {
		return (name || '?').trim().charAt(0).toUpperCase() || '?';
	}

	/* Stable avatar color from the Clay sticker-outline-0..9 palette. */
	function avatarColorClass(creator) {
		var key = String((creator && (creator.id || creator.name)) || '');
		var sum = 0;
		for (var i = 0; i < key.length; i++) sum += key.charCodeAt(i);
		return 'sticker-outline-' + (sum % 10);
	}

	function renderAvatar(creator) {
		var name = displayName(creator);
		if (creator && creator.image) {
			return '<span class="sticker sticker-circle sticker-lg"><span class="sticker-overlay"><img class="sticker-img" src="' + Liferay.Util.escapeHTML(creator.image) + '" alt="' + Liferay.Util.escapeHTML(name) + '"></span></span>';
		}
		return '<span class="sticker sticker-circle sticker-lg ' + avatarColorClass(creator) + '"><span class="sticker-overlay">' + Liferay.Util.escapeHTML(avatarInitial(name)) + '</span></span>';
	}

	function ensureRankLadder(callback) {
		/* Skip the ranks request entirely when ranks are hidden. */
		if (!showRank || rankLadder) { callback(); return; }
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

	function rankLabel(count) {
		if (!rankLadder) return '';
		for (var i = 0; i < rankLadder.length; i++) {
			if (count >= rankLadder[i].minPosts) return rankLadder[i].label;
		}
		return '';
	}

	function postsText(count) {
		var tmpl = count === 1
			? (topPosters.dataset.labelXPost || '{0} post')
			: (topPosters.dataset.labelXPosts || '{0} posts');
		return tmpl.replace('{0}', count);
	}

	function loadLeaderboard() {
		ensureRankLadder(function() {
			Liferay.Util.fetch(portalURL + '/o/c/forumstatsusers/scopes/' + scopeGroupId
				+ '?sort=messageCount:desc&page=1&pageSize=' + postersCount, {
				headers: headers,
				method: 'GET'
			})
			.then(function(r) { return r.json(); })
			.then(function(data) {
				var items = (data && data.items) || [];

				if (items.length === 0) {
					leaderboard.innerHTML = '<li class="forums-hero__empty ' + mutedClass + ' text-center py-3">'
						+ (topPosters.dataset.labelNoPosters || 'No top posters yet.') + '</li>';
					return;
				}

				var html = '';
				items.forEach(function(stats, idx) {
					var creator = stats.creator || {};
					var name = displayName(creator) || (topPosters.dataset.labelUnknown || 'Unknown');
					var count = stats.messageCount || 0;
					var rank = showRank ? rankLabel(count) : '';
					html += '<li class="forums-hero__card card">'
						+ '<span class="forums-hero__position text-secondary">' + (idx + 1) + '</span>'
						+ renderAvatar(creator)
						+ '<span class="forums-hero__poster-name text-dark font-weight-semi-bold d-block">' + Liferay.Util.escapeHTML(name) + '</span>'
						+ (rank ? '<span class="forums-hero__poster-rank text-secondary small d-block">' + Liferay.Util.escapeHTML(rank) + '</span>' : '')
						+ '<span class="forums-hero__poster-count text-secondary small d-block">' + postsText(count) + '</span>'
						+ '</li>';
				});
				leaderboard.innerHTML = html;
			})
			.catch(function(err) {
				leaderboard.innerHTML = '<li class="forums-hero__empty text-white-50 text-center py-3">'
					+ (topPosters.dataset.labelUnableToLoad || 'Unable to load statistics.') + '</li>';
				console.error('ForumsHero top posters error:', err);
			});
		});
	}

	loadLeaderboard();
}
