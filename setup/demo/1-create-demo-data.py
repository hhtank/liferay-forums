#!/usr/bin/env python3

# SPDX-License-Identifier: LGPL-2.1-or-later
"""
Create demo forum data via the Liferay DXP Headless API.

Steps:
  1. Ensure the four default Forum Categories exist (by ERC).
  2. Create demo user accounts and assign "Site Member" role.
  3. Register each demo user as a ForumStatsUser (drives the hero member count).
  4. Create Forum Threads (with keywords) across categories.
  5. Create Forum Messages on each message by *different* users.

Data files are read from the data/ subdirectory:
  - data/categories.json
  - data/users.json
  - data/messages.json
  - data/replies.json

Usage:
    python3 create-demo-data.py [BASE_URL] [siteId] [--email EMAIL] [--password PASSWORD]

If siteId is omitted, it is resolved by querying headless-admin-site for the
site whose external reference code is "L_FORUMS".

Defaults:
    BASE_URL: http://localhost:8080
    EMAIL:    test@liferay.com
    PASSWORD: test
"""

import argparse
import base64
import json
import os
import random
import sys
from datetime import datetime, timedelta, timezone
from concurrent.futures import ThreadPoolExecutor

import requests

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(SCRIPT_DIR, "data")
PHOTOS_DIR = os.path.join(SCRIPT_DIR, "profile-photos")
MAX_WORKERS = 8        # parallel message units
MAX_REPLY_WORKERS = 3  # parallel replies within a message (lower to avoid server 500s)
DATE_RANGE_DAYS = 365  # spread message dates across the last N days


def load_json(filename):
    with open(os.path.join(DATA_DIR, filename), encoding="utf-8") as f:
        return json.load(f)


DEFAULT_CATEGORIES = load_json("categories.json")
DEMO_USERS = load_json("users.json")
DEMO_MESSAGES = load_json("messages.json")
REPLY_POOL = load_json("replies.json")

DEMO_USER_PASSWORD = "test"
FORUMS_SITE_ERC = "L_FORUMS"  # ERC of the Forums site, used to auto-resolve siteId


def _generate_message_dates(messages):
    """Assign a displayDate to each message, spread across the past DATE_RANGE_DAYS.

    Messages are sorted chronologically: first message is oldest, last is newest.
    Returns a list of datetime objects (one per message) in ascending order."""
    now = datetime.now(timezone.utc)
    earliest = now - timedelta(days=DATE_RANGE_DAYS)
    total_seconds = int((now - earliest).total_seconds())
    count = len(messages)

    # Pick random offsets, sort them so earlier messages get earlier dates
    offsets = sorted(random.sample(range(total_seconds), count))
    return [earliest + timedelta(seconds=s) for s in offsets]


def _generate_reply_dates(message_date, reply_count):
    """Generate ascending reply dates after the message date.

    Each reply is 1–48 hours after the previous one, giving a natural
    conversation cadence.  The OP reply (index 0) is the first entry."""
    dates = []
    cursor = message_date
    for _ in range(reply_count):
        gap = timedelta(hours=random.uniform(1, 48))
        cursor = cursor + gap
        dates.append(cursor)
    return dates


def _fmt_date(dt):
    """Format a datetime for the Liferay Headless REST API (ISO 8601 / UTC)."""
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")



def resolve_site_id(session, base, erc=FORUMS_SITE_ERC):
    """Resolve the site (group) ID by ERC via headless-admin-site.

    headless-admin-site v1.0 has no by-external-reference-code endpoint, and its
    /sites listing ignores an OData filter on externalReferenceCode, so we list
    the sites and match the ERC client-side. Returns the numeric id or None."""
    url = f"{base}/o/headless-admin-site/v1.0/sites"
    try:
        resp = session.get(url, params={"pageSize": 200}, timeout=30)
    except requests.RequestException as exc:
        print(f"  ❌ Request failed while resolving site ID: {exc}")
        return None

    body = _json(resp)
    if not resp.ok or not body:
        print(f"  ❌ Could not list sites: {resp.status_code} — {body}")
        return None

    for site in body.get("items", []):
        if site.get("externalReferenceCode") == erc:
            return site.get("id")

    print(f"  ❌ No site found with ERC '{erc}' among {body.get('totalCount', 0)} sites")
    return None


def make_session(email, password):
    s = requests.Session()
    s.headers.update({
        "Authorization": "Basic " + base64.b64encode(f"{email}:{password}".encode()).decode(),
        "Accept": "application/json",
    })
    return s


def _json(resp):
    return resp.json() if resp.content else None





# ─── Step 1: Ensure categories ────────────────────────────────────────────

CATEGORY_PARENT_FK = "r_categorySubcategories_c_forumCategoryId"


def ensure_categories(session, base, site_id):
    print("\n═══ Step 1: Ensuring default categories exist ═══")
    cat_map = {}

    # Two passes so a subcategory's parent id is always resolvable. Structure is
    # capped at one level (see MAX_DEPTH in the forums-categories-admin
    # fragment), so a parent pass followed by a child pass is sufficient — a
    # subcategory may never itself be a parent.
    parents = [c for c in DEFAULT_CATEGORIES if not c.get("parentErc")]
    children = [c for c in DEFAULT_CATEGORIES if c.get("parentErc")]

    for cat in parents + children:
        erc = cat["erc"]
        url = f"{base}/o/c/forumcategories/scopes/{site_id}/by-external-reference-code/{erc}"

        parent_erc = cat.get("parentErc")
        parent_id = cat_map.get(parent_erc) if parent_erc else None
        if parent_erc and not parent_id:
            print(f"  ⚠️  Skipping {cat['categoryName']}: parent {parent_erc} was not created")
            continue

        label = f"{cat['categoryName']} (under {parent_erc})" if parent_erc else cat["categoryName"]

        resp = session.get(url)
        body = _json(resp)
        if resp.ok and body and body.get("id"):
            cat_map[erc] = body["id"]
            print(f"  ✅ Exists: {label} (id={body['id']})")
            continue

        payload = {
            "externalReferenceCode": erc,
            "categoryName": cat["categoryName"],
            "categoryName_i18n": {"en_US": cat["categoryName"]},
            "categoryDescription": cat["categoryDescription"],
        }
        if parent_id:
            payload[CATEGORY_PARENT_FK] = parent_id

        resp2 = session.put(url, json=payload)
        body2 = _json(resp2)
        if resp2.ok and body2 and body2.get("id"):
            cat_map[erc] = body2["id"]
            print(f"  ✅ Created: {label} (id={body2['id']})")
            continue

        resp3 = session.post(f"{base}/o/c/forumcategories/scopes/{site_id}", json=payload)
        body3 = _json(resp3)
        if resp3.ok and body3 and body3.get("id"):
            cat_map[erc] = body3["id"]
            print(f"  ✅ Created (POST): {label} (id={body3['id']})")
        else:
            print(f"  ❌ Failed to create {label}: {resp3.status_code} — {body3}")

    return cat_map


# ─── Step 2: Create demo users ────────────────────────────────────────────

def ensure_users(admin_session, base, site_id):
    print("\n═══ Step 2: Creating demo users ═══")

    def _find_by_screen_name(screen_name):
        resp = admin_session.get(
            f"{base}/o/headless-admin-user/v1.0/user-accounts",
            params={"filter": f"alternateName eq '{screen_name}'"},
        )
        body = _json(resp)
        if resp.ok and body and body.get("totalCount", 0) > 0:
            return body["items"][0]
        return None

    def create_or_find(u):
        # alternateName (screen name) is reliably filterable; emailAddress is not
        user = _find_by_screen_name(u["screenName"])
        if user:
            print(f"  ✅ Exists: {u['givenName']} {u['familyName']} (id={user['id']})")
            return user
        payload = {
            "alternateName": u["screenName"],
            "emailAddress": u["emailAddress"],
            "givenName": u["givenName"],
            "familyName": u["familyName"],
            "password": DEMO_USER_PASSWORD,
        }
        resp2 = admin_session.post(f"{base}/o/headless-admin-user/v1.0/user-accounts", json=payload)
        body2 = _json(resp2)
        if resp2.ok and body2 and body2.get("id"):
            print(f"  ✅ Created: {u['givenName']} {u['familyName']} (id={body2['id']})")
            return body2
        if resp2.status_code == 409:
            # Already exists — the initial filter missed it (e.g. index lag); re-query
            user = _find_by_screen_name(u["screenName"])
            if user:
                print(f"  ✅ Exists: {u['givenName']} {u['familyName']} (id={user['id']})")
                return user
        print(f"  ❌ Failed: {u['emailAddress']}: {resp2.status_code}")
        return None

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        users = [u for u in executor.map(create_or_find, DEMO_USERS) if u]

    print("\n  Assigning Site Member role...")

    def assign_role(user):
        uid = user["id"]
        name = f"{user.get('givenName', '')} {user.get('familyName', '')}".strip()
        resp = admin_session.post(
            f"{base}/o/headless-admin-user/v1.0/sites/{site_id}/user-accounts/{uid}"
        )
        if resp.status_code < 300 or resp.status_code in (204, 409):
            print(f"    ✅ Site Member: {name} (id={uid})")
        else:
            resp2 = admin_session.post(
                f"{base}/api/jsonws/user/add-group-users?groupId={site_id}&userIds={uid}"
            )
            if resp2.ok:
                print(f"    ✅ Site Member (alt): {name} (id={uid})")
            else:
                print(f"    ⚠️  Could not assign Site Member for user {uid}: {resp.status_code}")

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        list(executor.map(assign_role, users))

    print("\n  Uploading profile photos...")

    def upload_photo(user):
        given = user.get("givenName", "").lower()
        family = user.get("familyName", "").lower()
        uid = user["id"]
        name = f"{user.get('givenName', '')} {user.get('familyName', '')}".strip()
        photo_path = os.path.join(PHOTOS_DIR, f"{given}-{family}.png")
        if not os.path.isfile(photo_path):
            print(f"    ⚠️  No photo for {name} ({given}-{family}.png) — skipping")
            return
        with open(photo_path, "rb") as f:
            files = {"image": (os.path.basename(photo_path), f, "image/png")}
            resp = admin_session.post(
                f"{base}/o/headless-admin-user/v1.0/user-accounts/{uid}/image",
                files=files,
                headers={"Accept": "*/*"},
            )
        if resp.status_code < 300:
            print(f"    ✅ Photo: {name} (id={uid})")
        else:
            print(f"    ❌ Photo failed for {name}: {resp.status_code}")

    for user in users:
        upload_photo(user)

    return users


# ─── Step 3: Register demo users as Forum Stats Users ────────────────────

def ensure_forum_stats_users(admin_session, base, site_id, users):
    """Create a ForumStatsUser entry for each demo user so the forums-hero
    participant count is non-zero. Skips users that already have an entry."""
    print("\n═══ Step 3: Registering demo users as Forum Stats Users ═══")

    def register(user):
        uid = user["id"]
        name = f"{user.get('givenName', '')} {user.get('familyName', '')}".strip()
        resp = admin_session.get(
            f"{base}/o/c/forumstatsusers/scopes/{site_id}",
            params={"filter": f"statsUserId eq {uid}", "pageSize": 1},
        )
        body = _json(resp)
        if resp.ok and body and body.get("totalCount", 0) > 0:
            print(f"  ✅ Already registered: {name} (userId={uid})")
            return False
        resp2 = admin_session.post(
            f"{base}/o/c/forumstatsusers/scopes/{site_id}",
            json={"statsUserId": uid},
        )
        if resp2.ok:
            print(f"  ✅ Registered: {name} (userId={uid})")
            return True
        print(f"  ❌ Failed to register {name} (userId={uid}): {resp2.status_code} — {_json(resp2)}")
        return False

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        results = list(executor.map(register, users))

    print(f"\n  ✅ Forum Stats Users registered: {sum(results)} new entries.")


# ─── Steps 4 & 5: Create messages and replies ──────────────────────────────

def _fetch_existing_thread_titles(admin_session, base, site_id):
    """Return the set of ForumThread titles that already exist, so re-runs skip
    threads created by a previous run instead of duplicating them.

    Pre-fetched once (not per-thread): an OData `eq` filter on the localized
    messageTitle field does not match reliably, and the previous per-message
    guard filtered on `messageTitle`, a field that does not exist on
    ForumMessage at all -- so it always errored and never skipped anything."""
    titles = set()
    page = 1
    while True:
        resp = admin_session.get(
            f"{base}/o/c/forumthreads/scopes/{site_id}",
            params={"page": page, "pageSize": 100, "fields": "messageTitle"},
        )
        body = _json(resp)
        if not resp.ok or not body:
            break
        for item in body.get("items", []):
            title = item.get("messageTitle")
            if title:
                titles.add(title)
        if page >= body.get("lastPage", 1):
            break
        page += 1
    return titles


def _process_message(idx, total, msg_def, msg_date, cat_map, user_sessions, admin_session, base, site_id, existing_titles):
    cat_erc = msg_def["category"]
    title = msg_def["title"]
    body_html = msg_def["body"]
    keywords = msg_def["keywords"]
    is_question = msg_def.get("question", False)
    priority = msg_def.get("priority", 0)  # MB parity: Urgent 3 / Sticky 2 / Announcement 1 / none 0
    author_screen = msg_def.get("author", "")

    cat_id = cat_map.get(cat_erc)
    if not cat_id:
        print(f"  ⚠️  Skipping '{title}' — category {cat_erc} not found")
        return 0, 0

    author_session = admin_session  # demo users lack Add permission on the Forum Objects (perms not set via site-initializer JSON)

    # Skip if this thread already exists — keeps the script re-runnable without
    # duplicating. Membership is checked against a set pre-fetched once (see
    # _fetch_existing_thread_titles); a per-thread OData filter is unreliable
    # for the localized messageTitle field.
    if title in existing_titles:
        print(f"  ⏭  [{idx+1}/{total}] Skipping '{title}' — already exists")
        return 0, 0

    # Pre-compute reply dates: OP reply + community replies
    replies_def = msg_def.get("replies", [])
    reply_dates = _generate_reply_dates(msg_date, 1 + len(replies_def))
    op_reply_date = reply_dates[0]
    community_reply_dates = reply_dates[1:]

    resp = author_session.post(
        f"{base}/o/c/forumthreads/scopes/{site_id}",
        json={
            "messageTitle": title,
            "messageTitle_i18n": {"en_US": title},
            "r_categoryThreads_c_forumCategoryId": cat_id,
            "question": is_question,
            "keywords": keywords,
            "priority": priority,
            "viewCount": random.randint(5, 320),
            "displayDate": _fmt_date(msg_date),
        },
    )
    body = _json(resp)
    if not resp.ok or not body or not body.get("id"):
        print(f"  ❌ [{idx+1}/{total}] Failed to create '{title}': {resp.status_code}")
        return 0, 0

    msg_id = body["id"]
    print(f"  ✅ [{idx+1}/{total}] {title}  (id={msg_id}, author={author_screen}, date={_fmt_date(msg_date)})")

    # OP reply (message body posted as the first reply)
    author_session.post(
        f"{base}/o/c/forummessages/scopes/{site_id}",
        json={
            "r_threadMessages_c_forumThreadId": msg_id,
            "r_categoryMessages_c_forumCategoryId": cat_id,
            "subject": title,
            "subject_i18n": {"en_US": title},
            "body": body_html,
            "format": "html",
            "displayDate": _fmt_date(op_reply_date),
        },
    )

    if not replies_def:
        return 0, 0

    # Create replies sequentially to preserve ascending date order
    total_replies = 0
    total_votes = 0

    for pos, (reply_def, reply_date) in enumerate(zip(replies_def, community_reply_dates)):
        reply_idx = reply_def.get("replyIndex", 0)
        reply_body = REPLY_POOL[reply_idx] if reply_idx < len(REPLY_POOL) else REPLY_POOL[0]
        reply_session = admin_session  # see comment above on author_session
        # Each reply needs a unique subject so Liferay generates a distinct urltitle.
        subject = f"Re: {title} ({pos + 1})"[:75]

        resp = reply_session.post(
            f"{base}/o/c/forummessages/scopes/{site_id}",
            json={
                "r_threadMessages_c_forumThreadId": msg_id,
                "r_categoryMessages_c_forumCategoryId": cat_id,
                "subject": subject,
                "subject_i18n": {"en_US": subject},
                "body": reply_body,
                "format": "html",
                "answer": reply_def.get("answer", False),
                "displayDate": _fmt_date(reply_date),
            },
        )
        resp_body = _json(resp)
        if not resp.ok or not resp_body or not resp_body.get("id"):
            print(f"    ⚠️  Reply failed on '{title}': {resp.status_code}")
            # Retry once
            resp = reply_session.post(
                f"{base}/o/c/forummessages/scopes/{site_id}",
                json={
                    "r_threadMessages_c_forumThreadId": msg_id,
                    "r_categoryMessages_c_forumCategoryId": cat_id,
                    "subject": subject,
                    "subject_i18n": {"en_US": subject},
                    "body": reply_body,
                    "format": "html",
                    "answer": reply_def.get("answer", False),
                    "displayDate": _fmt_date(reply_date),
                },
            )
            resp_body = _json(resp)
            if not resp.ok or not resp_body or not resp_body.get("id"):
                print(f"    ❌  Reply retry failed on '{title}': {resp.status_code}")
                continue

        reply_id = resp_body["id"]
        total_replies += 1
        upvotes = reply_def.get("upvotes", 0)
        downvotes = reply_def.get("downvotes", 0)

        for vote_value, count in ((1, upvotes), (-1, downvotes)):
            for _ in range(count):
                vr = admin_session.post(
                    f"{base}/o/c/forumvotes/scopes/{site_id}",
                    json={"r_messageVotes_c_forumMessageId": reply_id, "voteValue": vote_value},
                )
                if vr.ok:
                    total_votes += 1

        net = upvotes - downvotes
        if net != 0:
            admin_session.patch(f"{base}/o/c/forummessages/{reply_id}", json={"voteScore": net})

    return total_replies, total_votes


def create_messages_and_replies(admin_session, user_sessions, base, site_id, cat_map):
    print("\n═══ Step 4: Creating Forum Threads ═══")
    total = len(DEMO_MESSAGES)

    # Generate chronologically sorted dates for all messages
    message_dates = _generate_message_dates(DEMO_MESSAGES)
    print(f"  Date range: {_fmt_date(message_dates[0])} → {_fmt_date(message_dates[-1])}")

    # Pre-fetch existing thread titles once so re-runs skip (not duplicate) them.
    existing_titles = _fetch_existing_thread_titles(admin_session, base, site_id)
    if existing_titles:
        print(f"  Found {len(existing_titles)} existing threads — they will be skipped.")

    def task(args):
        idx, (msg_def, msg_date) = args
        return _process_message(idx, total, msg_def, msg_date, cat_map, user_sessions, admin_session, base, site_id, existing_titles)

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        results = list(executor.map(task, enumerate(zip(DEMO_MESSAGES, message_dates))))

    total_replies = sum(r[0] for r in results)
    total_votes = sum(r[1] for r in results)
    print(f"\n  ✅ Created {total_replies} replies and {total_votes} votes.")


# ─── Main ─────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Create demo forum data via the Liferay Headless API.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("base_url", nargs="?", default="http://localhost:8080",
                        help="Liferay portal base URL")
    parser.add_argument("site_id", nargs="?",
                        help=f"Site (group) ID to scope all entries to "
                             f"(default: resolved by ERC '{FORUMS_SITE_ERC}')")
    parser.add_argument("--email", default="test@liferay.com", help="Admin email address")
    parser.add_argument("--password", default="test", help="Admin password")
    args = parser.parse_args()

    base = args.base_url.rstrip("/")
    site_id = args.site_id

    admin_session = make_session(args.email, args.password)

    if not site_id:
        print(f"No siteId given — resolving via headless-admin-site (ERC '{FORUMS_SITE_ERC}')...")
        site_id = resolve_site_id(admin_session, base)
        if not site_id:
            print(f"\n❌ Could not resolve a site ID for ERC '{FORUMS_SITE_ERC}'. Aborting.")
            sys.exit(1)
        print(f"  ✅ Resolved site ID: {site_id}")

    print(f"Target: {base}  Site ID: {site_id}")

    cat_map = ensure_categories(admin_session, base, site_id)
    if not cat_map:
        print("\n❌ No categories could be created. Aborting.")
        sys.exit(1)

    users = ensure_users(admin_session, base, site_id)
    if not users:
        print("\n❌ No users could be created. Aborting.")
        sys.exit(1)

    # Per-user sessions keyed by screen name — each holds a persistent
    # HTTP connection so parallelism and connection reuse are preserved.
    user_sessions = {}
    for u in users:
        screen_name = u.get("alternateName", "")
        email = u.get("emailAddress", "")
        if screen_name and email:
            user_sessions[screen_name] = make_session(email, DEMO_USER_PASSWORD)
    print(f"\n  ✅ Created {len(user_sessions)} per-user sessions.")

    ensure_forum_stats_users(admin_session, base, site_id, users)
    create_messages_and_replies(admin_session, user_sessions, base, site_id, cat_map)

    print("\n🎉 Demo data creation complete!")


if __name__ == "__main__":
    main()
