#!/usr/bin/env bash
#
# verify-rename.sh — asserts the ForumMessage->ForumThread / ForumReply->ForumMessage
# / ForumMessageFlag->ForumThreadFlag rename left ZERO stale tokens.
#
# Run from anywhere; it scans the liferay-forums tree (minus build/generated dirs).
# Exits 0 if clean, 1 if any stale token or missing/extra file is found.
#
# NOTE on the swap: because ForumReply was renamed *to* ForumMessage, the literals
# "ForumMessage", "FORUM-MESSAGE", "forummessages", "c_forummessage", "categoryMessages",
# etc. are now VALID (they name the former-reply object). This script therefore cannot
# assert those absent. It asserts the *retired* identifiers (everything *Reply*, the old
# *Flag*, and the old relationship names) are gone, and that the new ones are present.

set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
EXCLUDES=(--exclude-dir=build --exclude-dir=dist --exclude-dir=node_modules
          --exclude-dir=.git --exclude-dir=.gradle --exclude-dir=.settings
          --exclude-dir=bin --exclude-dir=tmp --exclude=verify-rename.sh)

fail=0

# ----------------------------------------------------------------------------
# 1. RETIRED tokens — must have ZERO occurrences anywhere.
# ----------------------------------------------------------------------------
RETIRED=(
  # PascalCase object names / DTO keys / DB tables
  "ForumReply" "ForumMessageFlag" "C_ForumReply" "C_ForumMessageFlag"
  "objectEntryDTOForumReply"
  # ERCs
  "FORUM-REPLY" "FORUM-MESSAGE-FLAG"
  # REST endpoint / scope (lowercase) — 'forumreply' is NOT a substring of 'forumreplies'
  "forumreplies" "forumreply" "c_forumreply"
  # relationship names (bare)
  "categoryReplies" "messageReplies" "messageFlags" "messageSuspiciousActivities" "replyVotes"
  # relationship ERCs
  "REL-CATEGORY-REPLIES" "REL-MESSAGE-REPLIES" "REL-MESSAGE-FLAGS"
  "REL-MESSAGE-SUSPICIOUS-ACTIVITIES" "REL-REPLY-VOTES"
  # foreign-key tokens (full)
  "r_messageReplies_c_forumMessageId" "r_categoryReplies_c_forumCategoryId"
  "r_replyVotes_c_forumReplyId" "r_messageSuspiciousActivities_c_forumMessageId"
  # auto primary-key field of the retired object name
  "forumReplyId"
)

echo "== Checking retired tokens are GONE =="
for tok in "${RETIRED[@]}"; do
  hits=$(grep -rIFn "${EXCLUDES[@]}" -- "$tok" "$ROOT" 2>/dev/null)
  if [ -n "$hits" ]; then
    echo "  ✗ STALE: '$tok' still present:"
    echo "$hits" | sed 's/^/      /'
    fail=1
  else
    echo "  ✓ $tok"
  fi
done

# ----------------------------------------------------------------------------
# 2. NEW tokens — must appear at least once (catches a totally failed rename).
# ----------------------------------------------------------------------------
REQUIRED=(
  "ForumThread" "ForumThreadFlag" "FORUM-THREAD" "FORUM-THREAD-FLAG"
  "forumthreads" "c_forumthread" "objectEntryDTOForumThread"
  "categoryThreads" "threadMessages" "REL-CATEGORY-THREADS" "REL-THREAD-MESSAGES"
  "r_threadMessages_c_forumThreadId" "r_categoryThreads_c_forumCategoryId"
  "r_messageVotes_c_forumMessageId"
)

echo ""
echo "== Checking new tokens are PRESENT =="
for tok in "${REQUIRED[@]}"; do
  if grep -rIFl "${EXCLUDES[@]}" -- "$tok" "$ROOT" >/dev/null 2>&1; then
    echo "  ✓ $tok"
  else
    echo "  ✗ MISSING expected token: '$tok'"
    fail=1
  fi
done

# ----------------------------------------------------------------------------
# 3. File-system layout — renamed files exist, old names are gone.
# ----------------------------------------------------------------------------
SI="$ROOT/client-extensions/forums-site-initializer/site-initializer"
MUST_EXIST=(
  "$SI/object-definitions/forum-thread.object-definition.json"
  "$SI/object-definitions/forum-thread-flag.object-definition.json"
  "$SI/object-definitions/forum-message.object-definition.json"
  "$SI/object-relationships/forum-category-category-threads.object-relationship.json"
  "$SI/object-relationships/forum-category-category-messages.object-relationship.json"
  "$SI/object-relationships/forum-category-category-subcategories.object-relationship.json"
  "$SI/object-relationships/forum-thread-thread-messages.object-relationship.json"
  "$SI/object-relationships/forum-thread-thread-flags.object-relationship.json"
  "$SI/object-relationships/forum-thread-thread-suspicious-activities.object-relationship.json"
  "$SI/object-relationships/forum-message-message-votes.object-relationship.json"
  "$SI/layout-page-templates/display-page-templates/forum-thread"
  "$SI/layout-page-templates/display-page-templates/forum-message"
)
MUST_NOT_EXIST=(
  "$SI/object-definitions/forum-reply.object-definition.json"
  "$SI/object-definitions/forum-message-flag.object-definition.json"
  "$SI/object-relationships/forum-message-message-replies.object-relationship.json"
  "$SI/object-relationships/forum-message-message-flags.object-relationship.json"
  "$SI/object-relationships/forum-message-message-suspicious-activities.object-relationship.json"
  "$SI/object-relationships/forum-reply-reply-votes.object-relationship.json"
  "$SI/object-relationships/forum-category-category-replies.object-relationship.json"
  "$SI/layout-page-templates/display-page-templates/forum-reply"
)

echo ""
echo "== Checking file-system layout =="
for p in "${MUST_EXIST[@]}"; do
  if [ -e "$p" ]; then echo "  ✓ exists: ${p#$ROOT/}"; else echo "  ✗ MISSING: ${p#$ROOT/}"; fail=1; fi
done
for p in "${MUST_NOT_EXIST[@]}"; do
  if [ ! -e "$p" ]; then echo "  ✓ gone:   ${p#$ROOT/}"; else echo "  ✗ STILL PRESENT: ${p#$ROOT/}"; fail=1; fi
done

echo ""
if [ "$fail" -eq 0 ]; then
  echo "RESULT: ✅ PASS — no stale tokens, new tokens present, layout correct."
else
  echo "RESULT: ❌ FAIL — see ✗ lines above."
fi
exit $fail
