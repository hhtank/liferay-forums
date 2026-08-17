// SPDX-License-Identifier: LGPL-2.1-or-later
package com.liferay.demo.forums.config;

import java.util.concurrent.ThreadPoolExecutor;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

/**
 * Pool that runs the notification fan-out after the object-action response has
 * already been returned.
 *
 * <p>Deliberately a plain executor bean rather than {@code @EnableAsync} plus
 * {@code @Async}: the work is submitted from the same bean that owns the
 * endpoint, and {@code @Async} is proxy-based, so self-invocation would silently
 * run it inline and undo the whole change with no visible symptom.</p>
 */
@Configuration
public class ForumNotificationAsyncConfig {

	private static final Logger _log = LoggerFactory.getLogger(ForumNotificationAsyncConfig.class);

	@Bean
	public ThreadPoolTaskExecutor forumNotificationExecutor(
		@Value("${forums.notification.async.core.size:2}") int coreSize,
		@Value("${forums.notification.async.max.size:8}") int maxSize,
		@Value("${forums.notification.async.queue.capacity:100}") int queueCapacity,
		@Value("${forums.notification.async.await.termination.seconds:10}")
			int awaitTerminationSeconds) {

		ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();

		executor.setCorePoolSize(coreSize);
		executor.setMaxPoolSize(maxSize);

		// Each queued task retains the whole object-action payload (the entry DTO,
		// plus originalObjectEntry on the update path), and the container is
		// allotted 512 MB, so the queue is kept short on purpose.

		executor.setQueueCapacity(queueCapacity);

		executor.setThreadNamePrefix("forum-notify-");

		// Overflow runs on the calling thread: under overload the object action
		// blocks exactly as it did before this pool existed, which is slow but
		// never drops a notification. It also backpressures the producer, so the
		// queue cannot grow deep enough for the forwarded JWT to go stale.

		executor.setRejectedExecutionHandler(
			new ThreadPoolExecutor.CallerRunsPolicy());

		// Drain on SIGTERM so a rolling deploy finishes queued fan-outs. Kept well
		// inside the default 30s SIGTERM->SIGKILL window; a kill still loses them.

		executor.setWaitForTasksToCompleteOnShutdown(true);
		executor.setAwaitTerminationSeconds(awaitTerminationSeconds);

		_log.info(
			"Forum notification executor: core={}, max={}, queue={}", coreSize,
			maxSize, queueCapacity);

		return executor;
	}

}
