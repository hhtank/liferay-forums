// SPDX-License-Identifier: LGPL-2.1-or-later
package com.liferay.demo.forums.controller;

import com.liferay.client.extension.util.spring.boot3.BaseRestController;
import com.liferay.demo.forums.service.ForumNotificationService;
import com.liferay.demo.forums.service.MentionService;
import com.liferay.demo.forums.service.SubscriptionService;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

import org.apache.commons.logging.Log;
import org.apache.commons.logging.LogFactory;

import org.json.JSONObject;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * Object Action Client Extension handlers for forum notifications.
 *
 * <p>Two endpoints are registered in {@code client-extension.yaml}:</p>
 * <ul>
 *   <li>{@code /object-action/new-reply} — a {@code ForumMessage} entry was
 *       created. Notifies the parent thread's subscribers plus anyone
 *       @mentioned in the body.</li>
 *   <li>{@code /object-action/updated-reply} — a {@code ForumMessage} entry was
 *       edited. Notifies only the mentions the edit added.</li>
 * </ul>
 *
 * <p>Delivery is not performed here: recipients are written as ForumNotification
 * entries, whose Notification Object Actions send the email and the in-portal
 * notification.</p>
 *
 * <p>Both endpoints acknowledge immediately and fan out on
 * {@code forumNotificationExecutor}. Liferay calls an object action
 * synchronously and waits, so doing the fan-out inline put every subscriber
 * lookup, notification write and purge inside the poster's "Posting..." spinner.
 * Nothing here reads the entry that triggered the action — the title comes from
 * the parent ForumThread and the display URL from the payload — so there is no
 * commit ordering to respect.</p>
 *
 * @author Neil Griffin
 */
@RestController
public class ForumNotificationController extends BaseRestController {

	/**
	 * Handles a new ForumMessage being created.
	 */
	@PostMapping("/object-action/new-reply")
	public ResponseEntity<String> onNewReply(
			@AuthenticationPrincipal Jwt jwt, @RequestBody String json)
		throws Exception {

		String authToken = _authToken(jwt);

		if (jwt != null) {
			log(jwt, _log, json);
		}
		else {
			_log.info(json);
		}

		_forumNotificationExecutor.execute(
			() -> _fanOut("new-reply", () -> _processNewReply(json, authToken)));

		return new ResponseEntity<>(json, HttpStatus.OK);
	}

	/**
	 * Handles an existing ForumMessage being edited. Only mentions <em>added by
	 * the edit</em> are notified; subscribers are never re-notified.
	 */
	@PostMapping("/object-action/updated-reply")
	public ResponseEntity<String> onUpdatedReply(
			@AuthenticationPrincipal Jwt jwt, @RequestBody String json)
		throws Exception {

		String authToken = _authToken(jwt);

		if (jwt != null) {
			log(jwt, _log, json);
		}
		else {
			_log.info(json);
		}

		_forumNotificationExecutor.execute(
			() -> _fanOut(
				"updated-reply", () -> _processUpdatedReply(json, authToken)));

		return new ResponseEntity<>(json, HttpStatus.OK);
	}

	/**
	 * Runs a fan-out off the request thread. Nothing observes these tasks — the
	 * object action was answered before this ran — so a failure that escapes here
	 * is invisible everywhere else, and the elapsed line is the only evidence the
	 * work happened at all.
	 */
	private void _fanOut(String handler, Runnable task) {
		long start = System.currentTimeMillis();

		try {
			task.run();
		}
		catch (Throwable throwable) {
			_log.error(
				"Unhandled failure in " + handler + " fan-out", throwable);
		}
		finally {
			_log.info(
				handler + " fan-out finished in " +
					(System.currentTimeMillis() - start) + " ms");
		}
	}

	private void _processNewReply(String json, String authToken) {
		JSONObject payload = new JSONObject(json);

		JSONObject objectEntry = payload.optJSONObject("objectEntry");
		JSONObject values = (objectEntry != null) ? objectEntry.optJSONObject("values") : null;

		long threadId = 0L;
		String replyBody = "";
		String rawReplyBody = "";

		if (values != null) {
			threadId = values.optLong("r_threadMessages_c_forumThreadId", 0L);
			rawReplyBody = values.optString("body", "");
			replyBody = _stripHtml(rawReplyBody);
		}

		if (threadId == 0L) {
			_log.warn("onNewReply: missing r_threadMessages_c_forumThreadId in payload");

			return;
		}

		JSONObject dto = payload.optJSONObject("objectEntryDTOForumMessage");
		JSONObject creator = (dto != null) ? dto.optJSONObject("creator") : null;

		String replyAuthor = _resolveAuthorName(creator);
		long authorUserId = _resolveCreatorUserId(creator);

		// ForumSubscription is site-scoped, so the scope is needed before the subscriber
		// query. The object-action payload normally carries it, so this costs no
		// extra call.

		JSONObject site = null;
		long siteId = _resolveSiteId(dto, null);

		if (siteId <= 0L) {
			site = _fetchSite(dto, authToken);
			siteId = _resolveSiteId(dto, site);
		}

		List<Long> subscribers = _subscriptionService.getSubscriberUserIds(
			threadId, siteId, authToken);

		subscribers.removeIf(userId -> userId == authorUserId);

		// Mention parsing is a local regex, so do it before any REST call: with
		// neither subscribers nor mentions there is nothing left to look up.

		Set<String> mentionedScreenNames = _extractCappedMentions(rawReplyBody);

		if (subscribers.isEmpty() && mentionedScreenNames.isEmpty()) {
			return;
		}

		String messageTitle = _fetchMessageTitle(threadId, authToken);

		if (messageTitle == null) {
			_log.warn("onNewReply: could not fetch title for threadId=" + threadId);

			messageTitle = "Forum Discussion";
		}

		if (site == null) {
			site = _fetchSite(dto, authToken);
		}

		String url = _constructDisplayPageUrl(payload, dto, site, authToken);

		_log.info("Constructed Display Page URL for Reply: " + url);

		_forumNotificationService.notifyAll(
			subscribers, siteId, "Re: " + messageTitle,
			replyAuthor + " posted a new reply to \"" + messageTitle + "\": " +
				_truncate(replyBody, 300),
			url, authToken);

		// Subscribers already notified above are excluded so a subscriber who is
		// also mentioned is not pinged twice.

		_notifyMentions(
			mentionedScreenNames, messageTitle, replyAuthor, replyBody, url,
			subscribers, authorUserId, siteId, authToken);
	}

	private void _processUpdatedReply(String json, String authToken) {
		JSONObject payload = new JSONObject(json);

		JSONObject objectEntry = payload.optJSONObject("objectEntry");
		JSONObject values = (objectEntry != null) ? objectEntry.optJSONObject("values") : null;

		JSONObject originalObjectEntry = payload.optJSONObject("originalObjectEntry");
		JSONObject originalValues = (originalObjectEntry != null) ?
			originalObjectEntry.optJSONObject("values") : null;

		long threadId = 0L;
		String rawReplyBody = "";
		String rawOriginalBody = "";

		if (values != null) {
			threadId = values.optLong("r_threadMessages_c_forumThreadId", 0L);
			rawReplyBody = values.optString("body", "");
		}

		if (originalValues != null) {
			rawOriginalBody = originalValues.optString("body", "");
		}

		if (threadId == 0L) {
			_log.warn("onUpdatedReply: missing r_threadMessages_c_forumThreadId in payload");

			return;
		}

		// Diff the new body's mentions against the prior body's, so an
		// already-mentioned user is never re-pinged.

		Set<String> addedMentions =
			_mentionService.extractMentionedScreenNames(rawReplyBody);

		addedMentions.removeAll(
			_mentionService.extractMentionedScreenNames(rawOriginalBody));

		addedMentions = _capMentions(addedMentions);

		if (addedMentions.isEmpty()) {
			return;
		}

		JSONObject dto = payload.optJSONObject("objectEntryDTOForumMessage");
		JSONObject creator = (dto != null) ? dto.optJSONObject("creator") : null;

		String replyAuthor = _resolveAuthorName(creator);
		long authorUserId = _resolveCreatorUserId(creator);
		String replyBody = _stripHtml(rawReplyBody);

		String messageTitle = _fetchMessageTitle(threadId, authToken);

		if (messageTitle == null) {
			messageTitle = "Forum Discussion";
		}

		JSONObject site = _fetchSite(dto, authToken);

		String url = _constructDisplayPageUrl(payload, dto, site, authToken);
		long siteId = _resolveSiteId(dto, site);

		_log.info("Constructed Display Page URL for Edited Reply: " + url);

		_notifyMentions(
			addedMentions, messageTitle, replyAuthor, replyBody, url, List.of(),
			authorUserId, siteId, authToken);
	}

	/**
	 * Extracts the @mention screen names from a post body, capped at
	 * {@code _MAX_MENTIONS} so a crafted body cannot be used to spam. Insertion
	 * order is preserved, so the first mentions in the body win.
	 */
	private Set<String> _extractCappedMentions(String rawBody) {
		return _capMentions(_mentionService.extractMentionedScreenNames(rawBody));
	}

	private Set<String> _capMentions(Set<String> mentionedScreenNames) {
		if (mentionedScreenNames.size() > _MAX_MENTIONS) {
			_log.warn(
				"Post mentions " + mentionedScreenNames.size() +
					" users; honoring only the first " + _MAX_MENTIONS);

			return mentionedScreenNames.stream()
				.limit(_MAX_MENTIONS)
				.collect(Collectors.toCollection(LinkedHashSet::new));
		}

		return mentionedScreenNames;
	}

	/**
	 * Notifies users @mentioned in a post, excluding the author and anyone in
	 * {@code alreadyNotified}.
	 */
	private void _notifyMentions(
		Set<String> mentionedScreenNames, String messageTitle, String author,
		String bodyPreview, String url, List<Long> alreadyNotified,
		long authorUserId, long siteId, String authToken) {

		if (mentionedScreenNames.isEmpty()) {
			return;
		}

		List<Long> mentioned = _mentionService.resolveMentions(
			mentionedScreenNames, siteId, authToken);

		List<Long> recipients = new ArrayList<>();

		for (Long userId : mentioned) {
			if (alreadyNotified.contains(userId)) {
				continue;
			}

			if ((authorUserId > 0) && (userId == authorUserId)) {
				continue;
			}

			recipients.add(userId);
		}

		if (recipients.isEmpty()) {
			return;
		}

		_forumNotificationService.notifyAll(
			recipients, siteId, author + " mentioned you in: " + messageTitle,
			author + " mentioned you in \"" + messageTitle + "\": " +
				_truncate(bodyPreview, 300),
			url, authToken);
	}

	/**
	 * The bearer token to forward, or {@code null} when the action arrived
	 * without one (a plain webhook). {@code LiferayApiClient} then falls back
	 * to the configured Basic Auth credentials.
	 */
	private String _authToken(Jwt jwt) {
		if (jwt == null) {
			return null;
		}

		return jwt.getTokenValue();
	}

	private String _fetchMessageTitle(long threadId, String authToken) {
		try {
			String response = _liferayApiClient.get(
				"/o/c/forumthreads/" + threadId + "?fields=messageTitle",
				authToken);

			return new JSONObject(response).optString("messageTitle", null);
		}
		catch (Exception e) {
			_log.error("Failed to fetch ForumThread title for id=" + threadId + ": " + e.getMessage());

			return null;
		}
	}

	private String _resolveAuthorName(JSONObject creator) {
		if (creator != null) {
			String given = creator.optString("givenName", "");
			String family = creator.optString("familyName", "");

			if (!family.isBlank() && !"User".equals(family)) {
				return (given + " " + family).trim();
			}

			if (!given.isBlank()) {
				return given;
			}

			String name = creator.optString("name", "");

			if (!name.isBlank()) {
				return name;
			}
		}

		return "A community member";
	}

	private long _resolveCreatorUserId(JSONObject creator) {
		if (creator != null) {
			return creator.optLong("id", 0L);
		}

		return 0L;
	}

	/**
	 * Percent-encodes a value interpolated into a request path. {@code URLEncoder}
	 * targets query strings and emits "+" for a space, which is not a space in a
	 * path.
	 */
	private String _encodePathSegment(String value) {
		return URLEncoder.encode(
			value, StandardCharsets.UTF_8
		).replace(
			"+", "%20"
		);
	}

	private String _stripHtml(String html) {
		if ((html == null) || html.isBlank()) {
			return "";
		}

		return html.replaceAll("<[^>]+>", " ").replaceAll("\\s{2,}", " ").trim();
	}

	private String _truncate(String text, int maxLength) {
		if (text == null) {
			return "";
		}

		if (text.length() <= maxLength) {
			return text;
		}

		return text.substring(0, maxLength) + "...";
	}

	/**
	 * Fetches the entry's site once (id + friendly URL path) so the display page
	 * URL and the mention site scope share a single lookup.
	 */
	private JSONObject _fetchSite(JSONObject dto, String authToken) {
		if (dto == null) {
			return null;
		}

		JSONObject systemProperties = dto.optJSONObject("systemProperties");
		JSONObject scope = (systemProperties != null) ?
			systemProperties.optJSONObject("scope") : null;

		if (scope == null) {
			return null;
		}

		String siteErc = scope.optString("externalReferenceCode", "");

		if (siteErc.isBlank()) {
			return null;
		}

		// LiferayApiClient runs with URI encoding disabled so pre-encoded OData
		// filters survive, which leaves interpolated segments like this one to
		// encode themselves.

		try {
			String siteResponse = _liferayApiClient.get(
				"/o/headless-admin-site/v1.0/sites/" +
					_encodePathSegment(siteErc) + "?fields=id,friendlyUrlPath",
				authToken);

			return new JSONObject(siteResponse);
		}
		catch (Exception exception) {
			_log.warn(
				"Could not fetch site for ERC " + siteErc + ": " +
					exception.getMessage());

			return null;
		}
	}

	/**
	 * Resolves the group id of the site a post belongs to, preferring the
	 * payload's numeric scope id over the already-fetched site. Returns
	 * {@code 0} when unknown, so mention resolution fails closed.
	 */
	private long _resolveSiteId(JSONObject dto, JSONObject site) {
		if (dto != null) {
			JSONObject systemProperties = dto.optJSONObject("systemProperties");
			JSONObject scope = (systemProperties != null) ?
				systemProperties.optJSONObject("scope") : null;

			if (scope != null) {
				long scopeId = scope.optLong("id", 0L);

				if (scopeId > 0L) {
					return scopeId;
				}
			}
		}

		return (site != null) ? site.optLong("id", 0L) : 0L;
	}

	private String _constructDisplayPageUrl(
		JSONObject payload, JSONObject dto, JSONObject site, String authToken) {

		if (payload == null || dto == null) {
			return "";
		}

		// Fall back to the site home rather than a dead link when the
		// entry-specific parts cannot be resolved.

		String siteFriendlyUrl = (site != null) ?
			site.optString("friendlyUrlPath", "") : "";
		String siteFallbackUrl = siteFriendlyUrl.isBlank() ?
			"" : "/web" + siteFriendlyUrl;

		try {
			long objectDefinitionId = payload.optLong("objectDefinitionId", 0L);
			String entryFriendlyUrl = dto.optString("friendlyUrlPath", "");

			if (siteFriendlyUrl.isBlank() || objectDefinitionId == 0L || entryFriendlyUrl.isBlank()) {
				_log.warn("Cannot construct display page URL; falling back to site URL.");
				return siteFallbackUrl;
			}

			String objDefResponse = _liferayApiClient.get(
				"/o/object-admin/v1.0/object-definitions/" + objectDefinitionId + "?fields=friendlyURLSeparator", authToken);
			String urlSeparator = new JSONObject(objDefResponse).optString("friendlyURLSeparator", "");

			if (urlSeparator.isBlank()) {
				return siteFallbackUrl;
			}

			return "/web" + siteFriendlyUrl + "/" + urlSeparator + "/" + entryFriendlyUrl;
		}
		catch (Exception e) {
			_log.error("Failed to construct display page URL: " + e.getMessage());
			return siteFallbackUrl;
		}
	}

	@Autowired
	private com.liferay.demo.forums.client.LiferayApiClient _liferayApiClient;

	@Autowired
	private ForumNotificationService _forumNotificationService;

	@Autowired
	private MentionService _mentionService;

	@Autowired
	private SubscriptionService _subscriptionService;

	/* Named explicitly: Spring Boot also auto-configures a ThreadPoolTaskExecutor
	   ("applicationTaskExecutor"). It backs off while this is the only Executor
	   bean, but by-type injection would break the moment anything else adds one,
	   and the leading underscore stops the by-name tiebreak from resolving it. */
	@Autowired
	@Qualifier("forumNotificationExecutor")
	private ThreadPoolTaskExecutor _forumNotificationExecutor;

	private static final int _MAX_MENTIONS = 25;

	private static final Log _log = LogFactory.getLog(ForumNotificationController.class);

}
