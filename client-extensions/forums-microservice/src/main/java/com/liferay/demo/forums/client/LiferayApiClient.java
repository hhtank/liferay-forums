// SPDX-License-Identifier: LGPL-2.1-or-later
package com.liferay.demo.forums.client;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.util.DefaultUriBuilderFactory;
import org.springframework.web.reactive.function.client.WebClientResponseException;

import reactor.core.publisher.Mono;

/**
 * HTTP client for communicating with a Liferay DXP headless API instance.
 *
 * <p>Plain POJO (no {@code @Component}) so multiple instances can be created
 * per target environment.  Bean wiring is in
 * {@link com.liferay.demo.forums.config.LiferayApiClientConfig}.</p>
 *
 * @author Neil Griffin
 */
public class LiferayApiClient {

	private static final Logger _log = LoggerFactory.getLogger(LiferayApiClient.class);

	private final String _baseUrl;
	private final String _user;
	private final String _password;
	private final WebClient _webClient;

	public LiferayApiClient(String baseUrl, String user, String password) {
		_baseUrl = baseUrl;
		_user = user;
		_password = password;

		// Callers pass fully-encoded paths (OData filters contain %20 and %27).
		// The default encoding mode would escape the "%" again, so URIs are taken
		// as-is.

		DefaultUriBuilderFactory uriBuilderFactory = new DefaultUriBuilderFactory(
			baseUrl);

		uriBuilderFactory.setEncodingMode(
			DefaultUriBuilderFactory.EncodingMode.NONE);

		_webClient = WebClient.builder()
			.baseUrl(baseUrl)
			.uriBuilderFactory(uriBuilderFactory)
			.defaultHeader(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
			.build();
	}

	public String getBaseUrl() {
		return _baseUrl;
	}

	public String get(String path, String authToken) {
		_log.debug("GET {}", path);

		try {
			return _webClient.get()
				.uri(path)
				.headers(h -> _setAuthHeader(h, authToken))
				.retrieve()
				.bodyToMono(String.class)
				.block();
		}
		catch (WebClientResponseException e) {
			if (e.getStatusCode().value() == 404) {
				_log.debug("GET {} → 404 NOT_FOUND", path);
			}
			else {
				_log.error("GET {} failed: {} {}", path, e.getStatusCode(), e.getResponseBodyAsString());
			}

			throw e;
		}
	}

	public String post(String path, String authToken, Object jsonBody) {
		_log.debug("POST {}", path);

		try {
			return _webClient.post()
				.uri(path)
				.headers(h -> _setAuthHeader(h, authToken))
				.bodyValue(jsonBody)
				.retrieve()
				.bodyToMono(String.class)
				.block();
		}
		catch (WebClientResponseException e) {
			_log.error("POST {} failed: {} {}", path, e.getStatusCode(), e.getResponseBodyAsString());

			throw e;
		}
	}

	/**
	 * Non-blocking variant of {@link #post}, for callers that fan out many
	 * requests concurrently and await them together. The returned {@link Mono}
	 * is cold — nothing is sent until it is subscribed.
	 */
	public Mono<String> postAsync(String path, String authToken, Object jsonBody) {
		return _webClient.post()
			.uri(path)
			.headers(h -> _setAuthHeader(h, authToken))
			.bodyValue(jsonBody)
			.retrieve()
			.bodyToMono(String.class);
	}

	/**
	 * Non-blocking DELETE. Cold — nothing is sent until subscribed.
	 */
	public Mono<Void> deleteAsync(String path, String authToken) {
		return _webClient.delete()
			.uri(path)
			.headers(h -> _setAuthHeader(h, authToken))
			.retrieve()
			.bodyToMono(Void.class);
	}

	private void _setAuthHeader(HttpHeaders headers, String authToken) {
		if ((authToken != null) && !authToken.isBlank()) {
			headers.setBearerAuth(authToken);
		}
		else if ((_user != null) && !_user.isBlank() && (_password != null) && !_password.isBlank()) {
			headers.setBasicAuth(_user, _password);
		}
		else {
			_log.warn("No authentication credentials provided for request.");
		}
	}

}
