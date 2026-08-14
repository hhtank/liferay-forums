// SPDX-License-Identifier: LGPL-2.1-or-later
package com.liferay.demo.forums.service;

import com.liferay.demo.forums.client.LiferayApiClient;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

import org.json.JSONArray;
import org.json.JSONObject;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * Resolves user mentions embedded in a forum post body.
 *
 * <h3>How mentions are stored</h3>
 * <p>The message composer inserts a mention in the platform's OOTB shape: the
 * visible {@code @screenName} token, wrapped in a
 * {@code <span class="lfr-ac-content">} by CKEditor 4 or emitted as a bare text
 * token by CKEditor 5 (which drops unknown spans on serialization). The visible
 * token is the reliable channel across editor versions, so handles are parsed
 * with a boundary-anchored {@code @screenName} regex rather than from a class or
 * data attribute — mirroring the platform's own {@code DefaultMentionsMatcher}.</p>
 *
 * <p>The screen name (rather than the numeric user id) is the durable channel
 * because it is a filterable/indexed field: mentions resolve to email addresses
 * with a single site-scoped OData query, and — because that query is scoped to
 * the site — a handle for a non-member simply does not match and is dropped. A
 * crafted body therefore cannot notify or probe users outside the site.</p>
 */
@Service
public class MentionService {

	private static final Logger _log = LoggerFactory.getLogger(MentionService.class);

	/* Match the visible "@screenName" token, whether it sits in plain text or
	   inside a tag such as the OOTB <span class="lfr-ac-content">. The token
	   must be preceded by start-of-input, whitespace, "]" or ">" (so "@" that
	   follows other text -- e.g. an email address -- is not treated as a
	   mention). "@" may also appear HTML-encoded as "&#64;".

	   The screen name is captured as dot/hyphen-separated word segments
	   (\w+(?:[.\-]\w+)*), which stops on its own at the first non-screen-name
	   character. This deliberately does NOT require a trailing boundary: unlike
	   the platform's DefaultMentionsMatcher -- whose mentions are always tag-
	   wrapped, so the next character is always "<" -- our CKEditor 5 mentions
	   are BARE text tokens that may be butted directly against punctuation
	   (e.g. "@ravi.patel: hello"). The segment structure also avoids swallowing
	   a trailing "." or "-" (e.g. a sentence-ending "@ravi.patel." yields
	   "ravi.patel", not "ravi.patel."). */
	private static final Pattern _MENTION_PATTERN = Pattern.compile(
		"(?:^|[\\s\\]>])(?:@|&#64;)(\\w+(?:[.\\-]\\w+)*)");

	/**
	 * Extracts the distinct screen names mentioned in the given (raw HTML) body.
	 * Insertion order is preserved.
	 *
	 * @param bodyHtml the raw HTML body of the forum message
	 * @return the mentioned screen names, lowercased; never {@code null}
	 */
	public Set<String> extractMentionedScreenNames(String bodyHtml) {
		Set<String> screenNames = new LinkedHashSet<>();

		if ((bodyHtml == null) || bodyHtml.isBlank()) {
			return screenNames;
		}

		Matcher matcher = _MENTION_PATTERN.matcher(bodyHtml);

		while (matcher.find()) {
			String screenName = matcher.group(1);

			if (!screenName.isBlank()) {
				screenNames.add(screenName.toLowerCase());
			}
		}

		return screenNames;
	}

	/**
	 * Resolves mentioned screen names to user ids <em>strictly against the
	 * members of the given site</em>.
	 *
	 * <p>Only members of {@code siteId} can be mentioned and notified. A
	 * mentioned screen name that is not a member of the site — for example a
	 * handle injected into the post body via the REST API, since the composer's
	 * site-scoped picker is only a client-side convenience — does not match the
	 * site-scoped query and is dropped. The company-wide user-account endpoint
	 * is deliberately <em>not</em> consulted, so a crafted body cannot notify or
	 * probe users outside the site.</p>
	 *
	 * @param screenNames the mentioned screen names (lowercased)
	 * @param siteId      the group id of the site the post belongs to; when
	 *                    {@code <= 0} no mentions are resolved (fail closed)
	 * @param authToken   OAuth2 bearer token (JWT) for the API call
	 * @return the resolvable, site-member mentioned user ids; never {@code null}
	 */
	public List<Long> resolveMentions(
		Set<String> screenNames, long siteId, String authToken) {

		List<Long> mentioned = new ArrayList<>();

		if ((screenNames == null) || screenNames.isEmpty()) {
			return mentioned;
		}

		if (siteId <= 0) {
			_log.warn(
				"Refusing to resolve {} mention(s) without a site scope",
				screenNames.size());

			return mentioned;
		}

		// Single site-scoped query on the indexed alternateName field. Non-members
		// never appear in this listing, so they cannot be resolved.

		String filter = screenNames.stream()
			.map(screenName -> "alternateName eq '" + _escape(screenName) + "'")
			.collect(Collectors.joining(" or "));

		try {
			String response = _liferayApiClient.get(
				"/o/headless-admin-user/v1.0/sites/" + siteId +
					"/user-accounts?fields=id&pageSize=" + screenNames.size() +
						"&filter=" +
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

					if (userId > 0L) {
						mentioned.add(userId);
					}
				}
			}
		}
		catch (Exception exception) {
			_log.warn(
				"Failed to resolve mentions for siteId={}: {}", siteId,
				exception.getMessage());

			return mentioned;
		}

		_log.debug(
			"Resolved {} of {} mentioned screen name(s) within siteId={}",
			mentioned.size(), screenNames.size(), siteId);

		return mentioned;
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

	/* Double single quotes per OData string escaping. */
	private String _escape(String value) {
		return value.replace("'", "''");
	}

	@Autowired
	private LiferayApiClient _liferayApiClient;

}
