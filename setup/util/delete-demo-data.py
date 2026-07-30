#!/usr/bin/env python3

# SPDX-License-Identifier: LGPL-2.1-or-later
"""
Delete all demo forum data via the Liferay DXP Headless API.

Steps:
  1. Delete all Forum Stats User entries.
  2. Delete all Forum Message entries (votes auto-deleted via cascade).
  3. Delete all Forum Thread entries.
  4. Delete all Forum Category entries.

Usage:
    python3 delete-demo-data.py <siteId> [BASE_URL] [--email EMAIL] [--password PASSWORD]

Defaults:
    BASE_URL: http://localhost:8080
    EMAIL:    test@liferay.com
    PASSWORD: test
"""

import argparse
import base64
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests

MAX_WORKERS = 10


def make_session(email, password):
    s = requests.Session()
    s.headers.update({
        "Authorization": "Basic " + base64.b64encode(f"{email}:{password}".encode()).decode(),
        "Accept": "application/json",
    })
    return s


def fetch_all_ids(session, base, path):
    ids = []
    page = 1
    while True:
        resp = session.get(f"{base}{path}", params={"page": page, "pageSize": 100})
        if not resp.ok:
            print(f"  ❌ Failed to list {path}: {resp.status_code}")
            break
        body = resp.json()
        ids.extend(item["id"] for item in body.get("items", []))
        if len(ids) >= body.get("totalCount", 0):
            break
        page += 1
    return ids


def delete_collection(session, base, list_path, delete_path, label):
    print(f"\n═══ Deleting {label} ═══")
    ids = fetch_all_ids(session, base, list_path)
    if not ids:
        print(f"  No {label} found.")
        return

    def _delete(item_id):
        resp = session.delete(f"{base}{delete_path}/{item_id}")
        return item_id, resp.status_code

    # A 404 means the entry is already gone — expected when a relationship
    # cascade removed it before the loop reached it (e.g. a subcategory deleted
    # along with its parent category). Treat it as success, not a failure.
    def _ok(status):
        return status < 300 or status == 404

    # Pass 1: parallel
    print(f"  Found {len(ids)} to delete ({MAX_WORKERS} parallel workers)...")
    failed = []
    deleted = 0
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        for item_id, status in executor.map(_delete, ids):
            if _ok(status):
                deleted += 1
            else:
                failed.append(item_id)

    # Pass 2: serial retry for anything the server 500'd on
    if failed:
        print(f"  Retrying {len(failed)} failed deletes serially...")
        still_failed = []
        for item_id in failed:
            _, status = _delete(item_id)
            if _ok(status):
                deleted += 1
            else:
                still_failed.append((item_id, status))
        failed = still_failed

    print(f"  Deleted {deleted}/{len(ids)} {label}.")
    for item_id, status in failed:
        print(f"  ❌ Failed to delete {item_id}: {status}")


def main():
    parser = argparse.ArgumentParser(
        description="Delete all demo forum data via the Liferay Headless API.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("site_id", help="Site (group) ID to scope all entries to")
    parser.add_argument("base_url", nargs="?", default="http://localhost:8080",
                        help="Liferay portal base URL")
    parser.add_argument("--email", default="test@liferay.com", help="Admin email address")
    parser.add_argument("--password", default="test", help="Admin password")
    args = parser.parse_args()

    base = args.base_url.rstrip("/")
    site_id = args.site_id

    print(f"Target: {base}  Site ID: {site_id}")

    session = make_session(args.email, args.password)
    delete_collection(session, base, f"/o/c/forumstatsusers/scopes/{site_id}", "/o/c/forumstatsusers", "Forum Stats Users")
    delete_collection(session, base, f"/o/c/forummessages/scopes/{site_id}",    "/o/c/forummessages",    "Forum Messages")
    delete_collection(session, base, f"/o/c/forumthreads/scopes/{site_id}",   "/o/c/forumthreads",   "Forum Threads")
    delete_collection(session, base, f"/o/c/forumcategories/scopes/{site_id}", "/o/c/forumcategories", "Forum Categories")

    print("\n✅ Demo data deletion complete.")


if __name__ == "__main__":
    main()
