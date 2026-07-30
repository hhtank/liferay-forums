// SPDX-License-Identifier: LGPL-2.1-or-later

package com.liferay.forum.stats.internal.model.listener;

import com.liferay.object.model.ObjectDefinition;
import com.liferay.object.model.ObjectEntry;
import com.liferay.object.service.ObjectDefinitionLocalService;
import com.liferay.object.service.ObjectEntryLocalService;
import com.liferay.portal.kernel.dao.orm.DynamicQuery;
import com.liferay.portal.kernel.dao.orm.RestrictionsFactoryUtil;
import com.liferay.portal.kernel.exception.ModelListenerException;
import com.liferay.portal.kernel.log.Log;
import com.liferay.portal.kernel.log.LogFactoryUtil;
import com.liferay.portal.kernel.model.BaseModelListener;
import com.liferay.portal.kernel.model.ModelListener;
import com.liferay.portal.kernel.service.ServiceContext;
import com.liferay.portal.kernel.service.UserLocalService;
import com.liferay.portal.kernel.util.LocaleUtil;

import java.io.Serializable;

import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Reference;

/**
 * Maintains {@code ForumStatsUser.messageCount} (and {@code lastPostDate}) for
 * the poster whenever a {@code ForumMessage} entry is created. See LPD-99219.
 *
 * <p>This runs in-JVM as a model listener, so it counts every ForumMessage
 * creation path (composer, REST, script, import) with no dependency on the
 * optional forums-microservice and nothing to wire in the site-initializer (so
 * it can never block object/site creation). It replaces the composer's former
 * client-side PATCH, which only counted messages posted through the UI.</p>
 */
@Component(service = ModelListener.class)
public class ForumMessageStatsModelListener
	extends BaseModelListener<ObjectEntry> {

	@Override
	public void onAfterCreate(ObjectEntry objectEntry)
		throws ModelListenerException {

		try {
			long companyId = objectEntry.getCompanyId();

			ObjectDefinition forumMessageObjectDefinition =
				_objectDefinitionLocalService.
					fetchObjectDefinitionByExternalReferenceCode(
						_FORUM_MESSAGE_ERC, companyId);

			if (forumMessageObjectDefinition == null) {
				return;
			}

			// Only react to ForumMessage entries; ignore all other objects,
			// including the ForumStatsUser writes made below.

			if (objectEntry.getObjectDefinitionId() !=
					forumMessageObjectDefinition.getObjectDefinitionId()) {

				return;
			}

			_incrementMessageCount(
				companyId, objectEntry.getGroupId(), objectEntry.getUserId());
		}
		catch (Exception exception) {

			// Best-effort: maintaining the count must never break posting.

			_log.warn(
				"Unable to increment ForumStatsUser messageCount for object " +
					"entry " + objectEntry.getObjectEntryId(),
				exception);
		}
	}

	private ObjectEntry _fetchStatsObjectEntry(
			long groupId, long statsObjectDefinitionId, long userId)
		throws Exception {

		DynamicQuery dynamicQuery = _objectEntryLocalService.dynamicQuery();

		dynamicQuery.add(
			RestrictionsFactoryUtil.eq(
				"objectDefinitionId", statsObjectDefinitionId));
		dynamicQuery.add(RestrictionsFactoryUtil.eq("groupId", groupId));

		List<ObjectEntry> statsObjectEntries =
			_objectEntryLocalService.dynamicQuery(dynamicQuery);

		for (ObjectEntry statsObjectEntry : statsObjectEntries) {
			Map<String, Serializable> values =
				_objectEntryLocalService.getValues(
					statsObjectEntry.getObjectEntryId());

			Serializable statsUserId = values.get("statsUserId");

			if ((statsUserId instanceof Number) &&
				(((Number)statsUserId).longValue() == userId)) {

				return statsObjectEntry;
			}
		}

		return null;
	}

	private void _incrementMessageCount(
			long companyId, long groupId, long userId)
		throws Exception {

		if ((userId <= 0) || (groupId <= 0)) {
			return;
		}

		ObjectDefinition statsObjectDefinition =
			_objectDefinitionLocalService.
				getObjectDefinitionByExternalReferenceCode(
					_FORUM_STATS_USER_ERC, companyId);

		long statsObjectDefinitionId =
			statsObjectDefinition.getObjectDefinitionId();

		ObjectEntry statsObjectEntry = _fetchStatsObjectEntry(
			groupId, statsObjectDefinitionId, userId);

		ServiceContext serviceContext = new ServiceContext();

		serviceContext.setCompanyId(companyId);
		serviceContext.setScopeGroupId(groupId);

		Date lastPostDate = new Date();

		if (statsObjectEntry != null) {
			Map<String, Serializable> values =
				_objectEntryLocalService.getValues(
					statsObjectEntry.getObjectEntryId());

			int messageCount = _toInt(values.get("messageCount"));

			Map<String, Serializable> newValues = new HashMap<>();

			newValues.put("statsUserId", userId);
			newValues.put("messageCount", messageCount + 1);
			newValues.put("lastPostDate", lastPostDate);

			_objectEntryLocalService.updateObjectEntry(
				statsObjectEntry.getUserId(),
				statsObjectEntry.getObjectEntryId(), 0L, newValues,
				serviceContext);
		}
		else {
			Map<String, Serializable> newValues = new HashMap<>();

			newValues.put("statsUserId", userId);
			newValues.put("messageCount", 1);
			newValues.put("lastPostDate", lastPostDate);

			// The guest user is the technical creator so no per-user
			// site-membership validation is needed; the forum member is stored
			// in the statsUserId field.

			_objectEntryLocalService.addObjectEntry(
				groupId, _userLocalService.getGuestUserId(companyId),
				statsObjectDefinitionId, 0L,
				LocaleUtil.toLanguageId(LocaleUtil.getDefault()), newValues,
				serviceContext);
		}
	}

	private int _toInt(Serializable value) {
		if (value instanceof Number) {
			return ((Number)value).intValue();
		}

		return 0;
	}

	private static final String _FORUM_MESSAGE_ERC = "FORUM-MESSAGE";

	private static final String _FORUM_STATS_USER_ERC = "FORUM-STATS-USER";

	private static final Log _log = LogFactoryUtil.getLog(
		ForumMessageStatsModelListener.class);

	@Reference
	private ObjectDefinitionLocalService _objectDefinitionLocalService;

	@Reference
	private ObjectEntryLocalService _objectEntryLocalService;

	@Reference
	private UserLocalService _userLocalService;

}
