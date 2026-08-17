// SPDX-License-Identifier: LGPL-2.1-or-later
package com.liferay.demo.forums.service;

import com.liferay.demo.forums.client.LiferayApiClient;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

import org.json.JSONArray;
import org.json.JSONObject;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * Delivers forum notifications by creating ForumNotification object entries.
 *
 * <p>Two Notification Object Actions on {@code ForumNotification}'s
 * <em>On After Add</em> trigger do the actual delivery — one email, one
 * in-portal — from the notification templates shipped by the site initializer.
 * This service only writes the per-recipient row.</p>
 */
@Service
public class ForumNotificationService {

	private static final Logger _log = LoggerFactory.getLogger(ForumNotificationService.class);

	/**
	 * Creates one ForumNotification entry per recipient.
	 *
	 * @param recipientUserIds users to notify
	 * @param siteId           group id the entries are scoped to
	 * @param subject          notification subject (email subject and bell title)
	 * @param body             one-line notification body
	 * @param url              site-relative link to the discussion
	 * @param authToken        OAuth2 bearer token (JWT)
	 */
	public void notifyAll(
		List<Long> recipientUserIds, long siteId, String subject, String body,
		String url, String authToken) {

		if (recipientUserIds.isEmpty()) {
			return;
		}

		if (siteId <= 0L) {
			_log.warn("Cannot send forum notifications without a site scope");

			return;
		}

		// The email template addresses the recipient by term, so the row must
		// carry the address; a user id does not resolve to one.

		Map<Long, String> emailAddresses = _resolveEmailAddresses(
			recipientUserIds, authToken);

		String path = "/o/c/forumnotifications/scopes/" + siteId;
		String fullUrl = _siteBaseUrl + url;

		long successCount = Flux.fromIterable(recipientUserIds)
			.flatMap(
				userId -> _liferayApiClient.postAsync(
					path, authToken,
					_toPayload(
						userId, emailAddresses.get(userId), subject, body,
						fullUrl)
				).flatMap(
					response -> _purge(response, authToken)
				).onErrorResume(
					throwable -> {
						_log.error(
							"Failed to notify user {}: {}", userId,
							throwable.getMessage());

						return Mono.empty();
					}
				),
				_MAX_SEND_CONCURRENCY)
			.count()
			.blockOptional()
			.orElse(0L);

		// The fan-out runs after the object action has been answered, so Liferay
		// logs success either way. Losing every recipient has to be loud here or
		// it is recorded nowhere.

		if (successCount == 0) {
			_log.error(
				"Forum notification reached none of {} recipient(s): subject=\"{}\"",
				recipientUserIds.size(), subject);
		}
		else {
			_log.info(
				"Forum notification sent to {}/{} recipient(s): subject=\"{}\"",
				successCount, recipientUserIds.size(), subject);
		}
	}

	/**
	 * Deletes the entry once its actions have run, so the object does not
	 * accumulate rows or expose delivered notifications to other users.
	 */
	private Mono<Long> _purge(String response, String authToken) {
		long entryId = new JSONObject(response).optLong("id", 0L);

		if (!_purgeEnabled || (entryId <= 0L)) {
			return Mono.just(entryId);
		}

		return _liferayApiClient.deleteAsync(
			"/o/c/forumnotifications/" + entryId, authToken
		).thenReturn(
			entryId
		).onErrorResume(
			throwable -> {
				_log.warn(
					"Could not purge forum notification {}: {}", entryId,
					throwable.getMessage());

				return Mono.just(entryId);
			}
		);
	}

	private String _toPayload(
		long recipientUserId, String emailAddress, String subject, String body,
		String url) {

		JSONObject payload = new JSONObject();

		payload.put("notificationBody", body);
		payload.put("notificationSubject", subject);
		payload.put("notificationUrl", url);
		payload.put("recipientUserId", recipientUserId);

		if ((emailAddress != null) && !emailAddress.isBlank()) {
			payload.put("recipientEmailAddress", emailAddress);
		}

		return payload.toString();
	}

	/**
	 * Resolves user ids to email addresses. Users that do not resolve simply get
	 * no email; their in-portal notification still fires.
	 *
	 * <p>The lookup is chunked because the filter carries one {@code or} clause
	 * per id and subscriber lists are unbounded. A single query for a few hundred
	 * subscribers builds a URI long enough to be rejected, and since the failure
	 * is swallowed that would silently drop the email for <em>every</em>
	 * recipient at once.</p>
	 */
	private Map<Long, String> _resolveEmailAddresses(
		List<Long> userIds, String authToken) {

		Map<Long, String> emailAddresses = new HashMap<>();

		for (int start = 0; start < userIds.size();
				start += _EMAIL_LOOKUP_BATCH_SIZE) {

			_resolveEmailAddresses(
				userIds.subList(
					start,
					Math.min(
						start + _EMAIL_LOOKUP_BATCH_SIZE, userIds.size())),
				emailAddresses, authToken);
		}

		return emailAddresses;
	}

	private void _resolveEmailAddresses(
		List<Long> userIds, Map<Long, String> emailAddresses,
		String authToken) {

		// The id must be quoted; unquoted it is rejected as an incompatible type.

		String filter = userIds.stream()
			.map(userId -> "id eq '" + userId + "'")
			.collect(Collectors.joining(" or "));

		try {
			String response = _liferayApiClient.get(
				"/o/headless-admin-user/v1.0/user-accounts?fields=id," +
					"emailAddress&pageSize=" + userIds.size() + "&filter=" +
						_encodeFilter(filter),
				authToken);

			JSONArray items = new JSONObject(response).optJSONArray("items");

			if (items != null) {
				for (int i = 0; i < items.length(); i++) {
					JSONObject item = items.optJSONObject(i);

					if (item == null) {
						continue;
					}

					long userId = item.optLong("id", 0L);
					String emailAddress = item.optString("emailAddress", "");

					if ((userId > 0L) && !emailAddress.isBlank()) {
						emailAddresses.put(userId, emailAddress);
					}
				}
			}
		}
		catch (Exception exception) {
			_log.warn(
				"Could not resolve recipient email addresses: {}",
				exception.getMessage());
		}
	}

	/**
	 * URL-encodes an OData filter. {@code URLEncoder} emits "+" for spaces,
	 * which Liferay's filter parser rejects, so they are sent as %20.
	 */
	private String _encodeFilter(String filter) {
		return URLEncoder.encode(
			filter, StandardCharsets.UTF_8
		).replace(
			"+", "%20"
		);
	}

	private static final int _EMAIL_LOOKUP_BATCH_SIZE = 50;

	private static final int _MAX_SEND_CONCURRENCY = 8;

	@Autowired
	private LiferayApiClient _liferayApiClient;

	/* Set to false if the environment executes object actions asynchronously. */
	@Value("${forums.notification.purge:true}")
	private boolean _purgeEnabled;

	@Value("${forums.site.base.url:https://www.example.xyz}")
	private String _siteBaseUrl;

}
