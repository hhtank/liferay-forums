// SPDX-License-Identifier: LGPL-2.1-or-later
package com.liferay.demo.forums.service;

import com.liferay.demo.forums.client.LiferayApiClient;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

import java.util.ArrayList;
import java.util.List;

import org.json.JSONArray;
import org.json.JSONObject;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * Reads thread subscribers from the ForumSubscription custom object.
 *
 * <p>The fragments own the subscription rows (created/deleted through
 * {@code /o/c/forumsubscriptions}), so no portal-side module is involved.</p>
 *
 * @author Neil Griffin
 */
@Service
public class SubscriptionService {

	private static final Logger _log = LoggerFactory.getLogger(SubscriptionService.class);

	/**
	 * Returns the user ids subscribed to the given ForumThread entry.
	 *
	 * @param threadId  the ForumThread whose subscribers to fetch
	 * @param siteId    scope the watch rows live in; ForumSubscription is site-scoped,
	 *                  so the unscoped collection endpoint returns 409
	 * @param authToken OAuth2 bearer token (JWT); falls back to Basic Auth
	 * @return subscriber user ids; never {@code null}
	 */
	public List<Long> getSubscriberUserIds(
		long threadId, long siteId, String authToken) {

		List<Long> userIds = new ArrayList<>();

		if (siteId <= 0L) {
			_log.warn("Cannot read subscriptions without a site scope");

			return userIds;
		}

		// Relationship fields compare as strings, so the id must be quoted.

		// Spaces must be %20: Liferay's OData parser does not read "+" as a
		// space, and URLEncoder emits "+".
		String filter = _encodeFilter(
			"r_threadSubscriptions_c_forumThreadId eq '" + threadId + "'");

		int page = 1;

		while (true) {
			String response;

			try {
				response = _liferayApiClient.get(
					"/o/c/forumsubscriptions/scopes/" + siteId +
						"?fields=subscriberUserId&pageSize=" + _PAGE_SIZE +
							"&page=" + page + "&filter=" + filter,
					authToken);
			}
			catch (Exception exception) {
				_log.error(
					"Failed to fetch subscriptions for threadId={}: {}", threadId,
					exception.getMessage());

				break;
			}

			JSONObject json = new JSONObject(response);
			JSONArray items = json.optJSONArray("items");

			if ((items == null) || items.isEmpty()) {
				break;
			}

			for (int i = 0; i < items.length(); i++) {
				long userId = items.getJSONObject(i).optLong("subscriberUserId", 0L);

				if (userId > 0L) {
					userIds.add(userId);
				}
			}

			if (page >= json.optLong("lastPage", 1)) {
				break;
			}

			page++;
		}

		_log.debug("Found {} subscriber(s) for threadId={}", userIds.size(), threadId);

		return userIds;
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

	private static final int _PAGE_SIZE = 100;

	@Autowired
	private LiferayApiClient _liferayApiClient;

}
