# Liferay Forums

This Liferay Workspace project is a Fragments and Liferay Objects based replacement for the legacy Message Boards / Questions widgets which are deprecated.

---

## Table of Contents

- [Screenshots](#screenshots)
- [Setup](#setup)
- [Required Feature Flags](#required-feature-flags)
- [Fragments](#fragments)
  - [UI Style: Standard and Flat](#ui-style-standard-and-flat)
- [Category Hierarchy](#category-hierarchy)
  - [Why the One-Level Cap Is a Constant, Not a Setting](#why-the-one-level-cap-is-a-constant-not-a-setting)
  - [The Cap Is UI-Enforced](#the-cap-is-ui-enforced)
- [Thread Priorities](#thread-priorities)
- [User Mentions](#user-mentions)
- [Page Layout and Fragment Placement](#page-layout-and-fragment-placement)
- [Display Page Templates](#display-page-templates)
- [Demo Data](#demo-data)
- [Utilities](#utilities)
- [Forum Subscription Notifications: Filling a DXP Feature Gap](#forum-subscription-notifications-filling-a-dxp-feature-gap)
  - [The Feature Gap](#the-feature-gap)
  - [Forums Microservice (Client Extension)](#forums-microservice-client-extension)
  - [Forum Subscriptions RESTBuilder OSGi Module (`forum-subscriptions`)](#forum-subscriptions-restbuilder-osgi-module-forum-subscriptions)
- [Known Limitations](#known-limitations)
  - [View Count Not Incremented for Guest Users](#view-count-not-incremented-for-guest-users)
  - [Ban Enforcement Is UI-Only](#ban-enforcement-is-ui-only)
  - [Thread Priority Permission Is UI-Only](#thread-priority-permission-is-ui-only)
  - ["Top Replies" Implemented as "Recent Activity"](#top-replies-implemented-as-recent-activity)

---

## Screenshots

<table>
  <tr>
    <td align="center"><strong>Forums Home</strong></td>
    <td align="center"><strong>Message List</strong></td>
    <td align="center"><strong>Message Detail</strong></td>
  </tr>
  <tr>
    <td><a href="screenshots/screenshot-forums.png"><img src="screenshots/screenshot-forums.png" width="260" alt="Forums home page"></a></td>
    <td><a href="screenshots/screenshot-message-list.png"><img src="screenshots/screenshot-message-list.png" width="260" alt="Message list view"></a></td>
    <td><a href="screenshots/screenshot-message-detail.png"><img src="screenshots/screenshot-message-detail.png" width="260" alt="Message detail view"></a></td>
  </tr>
</table>

---

## Setup

The main artifact of this project is a Liferay site initializer. Before building it, the following lines in `client-extensions/forums-site-initializer/client-extension.yaml` should be changed in order to specify the site where things should be created:

```yaml
    siteExternalReferenceCode: FORUMS
    siteName: Forums
```

You can then build it using the standard Liferay Workspace wrapper commands (e.g., `./gw build`) and deploy it by copying the resulting artifact to `$LIFERAY_HOME/deploy`.

The required Object permissions and Service Access Policy are applied automatically by the site initializer on deployment -- no manual setup step is needed.

| File | Description |
| :--- | :--- |
| [resource-permissions.json](client-extensions/forums-site-initializer/site-initializer/resource-permissions.json) | Grants the required Object permissions declaratively: `VIEW` on every forum Object to the **Guest** and **Site Member** roles, and `ADD_OBJECT_ENTRY` to the **User** role on the writable objects. This file exists because Liferay Objects has no equivalent to the `<resource-action-mapping>` XML descriptor used by Service Builder to define default permissions -- Object permissions must be configured explicitly. The site initializer resolves the `[$OBJECT_DEFINITION_CLASS_NAME:...$]` and `[$OBJECT_DEFINITION_ID:...$]` placeholders at deploy time. |
| [sap-entries.json](client-extensions/forums-site-initializer/site-initializer/sap-entries.json) | Declares the `FORUM_GUEST_ACCESS` Service Access Policy so that non-authenticated (Guest) users can invoke the Object REST APIs in order to see forum messages and replies. |

> **Security note -- how Guest access is actually bounded.** The SAP signature (`ObjectEntryResourceImpl#get*`) opens the unauthenticated GET invocation path for **every** custom Object, not just the forum objects, because all Objects share the single `ObjectEntryResourceImpl` REST class -- there is no way to scope a SAP signature to one Object. What actually restricts Guest to *only* the forum data is the second gate: each request re-checks the `VIEW` permission against the specific Object, and `resource-permissions.json` grants Guest `VIEW` on the forum objects only. **The per-object boundary is enforced by permissions, not by the SAP.** Consequently: **never grant the Guest role `VIEW` on any custom Object you do not intend to expose anonymously** -- with this SAP active, such an object becomes readable without authentication immediately, and the SAP will not stop it.

---

## Required Feature Flags

The following **Release** feature flags must be enabled before deploying.

| Ticket | Description |
| :--- | :--- |
| LPD-17564 | CMS |
| LPD-34594 | Root Object Definitions |
| LPD-11235 | Enhanced Rich Text Editor |

> **`LPD-17564` is required for the demo data, not just deployment.** It gates ObjectEntry `displayDate`/`expirationDate` persistence (with `LPD-34594` as its dependency). If it is disabled, the `displayDate` posted in Step 1 is silently dropped — so the Step 3 date backfill has nothing to copy and every entry keeps its import timestamp.

---

## Fragments

| Fragment Name | Folder | Description |
| :--- | :--- | :--- |
| **Forums Categories Admin** | [forums-categories-admin](fragments/forums-categories-admin) | Administration interface for managing forum categories, including assigning a parent to create a subcategory. |
| **Forums Category Grid** | [forums-category-grid](fragments/forums-category-grid) | Displays the top-level forum categories in a grid layout, badging those that contain subcategories. |
| **Forums Hero** | [forums-hero](fragments/forums-hero) | Top banner for the forums featuring statistics (like member count) and quick actions. |
| **Forums Moderation** | [forums-moderation](fragments/forums-moderation) | Tools for moderating forum content. |
| **Forums Message Composer** | [forums-message-composer](fragments/forums-message-composer) | Modal composer for creating and editing forum messages and replies. |
| **Forums Related Topics** | [forums-related-topics](fragments/forums-related-topics) | Displays a list of topics related to the currently viewed message. |
| **Forums Message Detail** | [forums-message-detail](fragments/forums-message-detail) | Detailed view of a single forum message, including its replies and engagement metrics. |
| **Forums Message List** | [forums-message-list](fragments/forums-message-list) | Lists forum messages, typically used for main category views or recent activity. |

### UI Style

The forums fragments ship a single, **style-neutral** look. Color values reference Classic / Lexicon Style Book tokens with a literal hex fallback, e.g. `var(--primary, #0b5fff)` -- the Style Book token wins when the active theme (or a Style Book) defines it, otherwise the hex is used. The fragments deliberately do **not** use Dialect tokens (`--color-*`): the visual identity belongs to the theme / Style Book, so customers re-skin the forum by editing Style Book tokens or layering a theme CSS client extension, never by touching the fragments.

---

## Category Hierarchy

Categories support **one optional level of subcategories**. Structure is opt-in rather than a mode: a community that never assigns a parent gets a flat forum and renders exactly as it did before this feature; a community that wants navigable structure creates one level. There is no setting to turn on.

- **Storage** — a self-referential `ForumCategory` -> `ForumCategory` Object relationship (`categorySubcategories`, `deletionType: cascade`) exposes the FK field `r_categorySubcategories_c_forumCategoryId` on the child. Absent or `0` means top-level. This replaces the unused `parentCategoryId` scalar field, so there is a single source of truth.
- **Authoring** — the Categories Admin fragment offers a **Parent Category** select that lists **only top-level categories**, and a category that already has subcategories cannot itself be given a parent. Those two rules are what make a third level unreachable through the UI.
- **Browsing** — the Category Grid shows only top-level categories, badging those with children (`{0} Subcategories`). Drilling in shows that category's subcategories as cards above its topic list, and the breadcrumb becomes `Forums > Category > Subcategory` — at most three crumbs.
- **Topic scope** — a parent lists only the topics assigned **directly** to it; subcategory topics live under the subcategory. This matches Message Boards. Posting into a parent stays valid, so a parent is never a dead end, and the Message Composer's category select shows subcategories indented under their parent.
- **Deletion** — because the relationship cascades, deleting a parent also deletes its subcategories and all of their topics. The admin delete dialog names the subcategory count before confirming.

### Why the One-Level Cap Is a Constant, Not a Setting

The cap lives in source as `MAX_DEPTH = 1` in the fragment JavaScript and is deliberately **not** configurable. Unbounded nesting is the failure mode this feature exists to avoid — legacy Message Boards allows arbitrarily deep `parentCategoryId` chains, and even Discourse caps nesting at one subcategory level by default. The moment a "max depth" option exists, someone sets it to 5 and the problem returns as a supported feature. The guiding rule: **categories cut where permissions and audiences cut; tags handle topics.**

Depth beyond one level is also unnecessary here, because Forums Objects are **site-scoped** — the effective navigational depth a customer already gets is Site -> Category -> Subcategory.

### The Cap Is UI-Enforced

The one-level cap is enforced in the authoring UI only. A direct `POST /o/c/forumcategories` that sets the parent FK to a category that is already a subcategory **will succeed** and create a third level.

This is the same class of gap as [Ban Enforcement Is UI-Only](#ban-enforcement-is-ui-only), and for the same reason: Object Validation rules use the Expression Builder, which can only see the entry's own field values and **cannot query other Object collections** — so a validation rule cannot check whether the selected parent itself has a parent. Object Actions fire only after the entry is committed, and Groovy script actions are unavailable on Liferay SaaS. Hardening would require a Microservice Client Extension registered as an `On After Add` / `On After Update` webhook that detects a too-deep entry and reparents or removes it, exactly as described for ban enforcement.

The fragments degrade safely if such data exists: any category deeper than one level is normalized to top-level for display rather than being hidden, and every parent-chain walk is cycle-guarded.

---

## Thread Priorities

Mirrors the legacy Message Boards thread-priority feature (`message.boards.thread.priorities=Urgent|bolt|3.0, Sticky|pin|2.0, Announcement|comments|1.0` in portal.properties):

- **Storage** — the `ForumThread` Object already carries a numeric `priority` field. The fragments use the same discrete levels as Message Boards: **Urgent (3)**, **Sticky (2)**, **Announcement (1)**, none (0).
- **Setting a priority** — the Message Composer shows a **Priority** select when creating or editing a topic (never on replies). The select is only offered to moderator-level users, detected the same way the Moderation page detects moderators: the HATEOAS `create` action on the `ForumBan` collection, which regular users are never granted. This mirrors Message Boards, where the priority select is gated by the `UPDATE_THREAD_PRIORITY` permission granted to moderators. When a non-privileged author edits their topic, the `priority` field is omitted from the PATCH so the current value is preserved.
- **Ordering** — the Message List sorts every listing by `priority:desc` before the active tab's sort (`dateCreated` / `lastPostDate`), so prioritized threads pin to the top — exactly how `MBThread`'s default order (`priority DESC, lastPostDate DESC`) works. Search results are the exception: the `priority` field is not search-indexed, so search-driven listings keep the plain tab sort — also matching Message Boards, where priority ordering exists only in DB-backed listings.
- **Display** — threads with a priority > 0 show a colored badge (Clay icon + localized name: `bolt`/Urgent, `pin`/Sticky, `comments`/Announcement) next to the title in the Message List and on the Message Detail page, following the Message Boards convention of rendering the priority icon next to the subject.

> **Existing sites:** threads created before this feature have no `priority` value at all. NULL ordering in a descending sort is database-specific (PostgreSQL sorts NULLs first), so run [backfill-thread-priority.py](setup/util/backfill-thread-priority.py) once to normalize them to `0`.

---

## User Mentions

Users can @mention each other in a topic or reply body, similar to the legacy Message Boards mention support:

- **Composing** — typing `@` in the body editor opens a caret-anchored dropdown of users, searched live via `GET /o/headless-admin-user/v1.0/sites/{siteId}/user-accounts`. The search is scoped to **members of the current site** (not the whole company) and requests only the fields the picker renders (`fields=id,givenName,familyName,name,alternateName,image`) for smaller, faster responses — the email address is deliberately not fetched here, since the microservice resolves it server-side from the mentioned user's screen name. Matching uses an OData prefix `filter` (`startswith(...)` across `name`, `givenName`, `familyName`, and `alternateName`, i.e. the display-name fields and the screen name), so partial input matches the start of any of those fields (e.g. "jo" → "John", "do" → "Doe"). `startswith` maps to a prefix wildcard (`q*`) that the search index resolves efficiently — unlike `contains`'s leading wildcard (`*q*`), which forces a term-dictionary scan — while still fitting type-ahead, where users type names/handles from the start. (OData function names are lowercase and case-sensitive — it must be `startswith`, not `startsWith`.) The query is lowercased to match the lowercased `*_sortable` index fields these OData fields map to. Email is intentionally excluded from matching so the picker can't be used to probe users by email address. Arrow keys / Enter (or a click) select one. The picker works with both the legacy CKEditor 4 and CKEditor 5 (the LPD-11235 flag decides which the server renders): caret detection uses the browser Selection API, while insertion uses each editor's own API (`model.insertContent` for CKEditor 5, `insertHtml` for CKEditor 4).
- **Storage** — a mention is stored as an anchor whose href carries the mentioned user's screen name: `<a class="forums-mention" href="#mention-{screenName}">@Jane Doe</a>`. The href fragment is the reliable channel across editor versions — CKEditor 5's schema may strip `class`/`data-*` attributes on serialization, but the anchor href survives — so downstream parsing keys off the `#mention-{screenName}` pattern rather than a data attribute. The screen name (rather than the numeric id) is used because it is a filterable/indexed field, which lets the microservice resolve mentions with a single site-scoped query.
- **Display** — because bodies are injected as HTML, mentions render automatically as highlighted, non-navigating chips in the Message Detail view (the `#mention-` href is neutralized with `preventDefault`).
- **Notification** — mentioning a user notifies them by **email and in-portal bell notification**, reusing the same [Forums Microservice](#forums-microservice-client-extension) path as subscriptions. The microservice's `MentionService` parses the `#mention-{screenName}` handles from the posted body and resolves them with a single `GET /o/headless-admin-user/v1.0/sites/{siteId}/user-accounts` query filtered on `alternateName`, **scoped to members of the post's site**. Because the query is site-scoped, a handle for a non-member (e.g. one injected into the body via the REST API) does not match and is dropped, so a crafted body cannot notify or probe users outside the site. The author and anyone already notified as a topic subscriber are excluded before sending; for a new topic's opening post, the parent category's subscribers (already notified of the topic by the new-message action) are excluded too, so a category subscriber who is also @mentioned is not notified twice. Editing a post also delivers mentions: an On After Update action diffs the edited body's mentions against the prior body's, so a newly-added `@mention` notifies that user while everyone already mentioned is left alone. As with subscription notifications, this requires the microservice and the [`forum-subscriptions`](#forum-subscriptions-restbuilder-osgi-module-forum-subscriptions) module to be running — see [The Feature Gap](#the-feature-gap).

> **Mention search requires `User` view permission:** the picker calls `GET /o/headless-admin-user/v1.0/sites/{siteId}/user-accounts`, which runs a *permission-filtered* user search — the `siteId` only narrows the results, it does not by itself grant visibility. The controlling permission is **`View` on the `com.liferay.portal.kernel.model.User` resource** (checked at company scope). A caller without it sees only themselves (and users in organizations they manage, via `UserSearchPermissionFilterContributor`), so the dropdown shows "No users found" — being a member of the same site is **not** sufficient on its own. To enable mentions for all members, grant a Regular Role they hold the `User → View` permission (Control Panel → Roles → *[role]* → Define Permissions → Users and Organizations → User → View).
>
> Note this `User` view grant is **company-scoped, not per-site** — Liferay has no built-in "only see users of my own sites" permission for this endpoint. It lets members search all users in the company (the endpoint then narrows the *returned* results to the current site). If that is too broad, front the search with a custom microservice endpoint that runs with service credentials and returns only site members — the same pattern used for [subscriber discovery](#forum-subscriptions-restbuilder-osgi-module-forum-subscriptions).
>
> **Workaround — scope visibility via an Organization:** `UserSearchPermissionFilterContributor` also grants a caller visibility of users in any **Organization** where they hold the `MANAGE_USERS` permission. So instead of the company-wide `User → View` grant, you can assign the forum's users to a dedicated Organization and grant members `MANAGE_USERS` on it (Control Panel → Roles → *[role]* → Define Permissions → Users and Organizations → Organization → Manage Users). Members can then search/mention exactly the users in that Organization — visibility scoped to the group rather than the whole company. The trade-off is that `MANAGE_USERS` is a management-level permission (it also allows administering those user accounts), so grant it only where that is acceptable.

---

## Page Layout and Fragment Placement

The forums application is assembled using a combination of standard pages and Display Page Templates. The site initializer creates the standard pages described below automatically — they are defined in `site-initializer/layouts/`. The layout diagrams serve as a preview of how the fragments are arranged on those auto-created pages.

```
/
├── Forum Categories Admin   (hidden from navigation) †
├── Forums                   (visible)
├── Forums Messages          (hidden from navigation)
└── Forums Moderation        (hidden from navigation) †
```

† Must be ***manually restricted to Site Administrator*** by the Site Administrator after import, as page permissions cannot be set in a site initializer.

### Page: Forums
*Friendly URL: `/forums` — Main entry point for the forums.*
```
┌─────────────────────────────────────────────────────────────────┐
│  forums-hero                                                    │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  drop-zone → Search Bar widget                            │  │
│  └───────────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│  forums-category-grid                                           │
└─────────────────────────────────────────────────────────────────┘
```

> The **Search Bar** widget is automatically present in the `forums-hero` drop-zone. ***Edit its configuration*** to specify the destination search page friendly URL (e.g. `/search`) and any other relevant search settings (scope, placeholder text, etc.).

### Page: Forums Messages
*Friendly URL: `/forums-messages` — Hide from page navigation.*
```
┌─────────────────────────────────────────────────────────────────┐
│  forums-message-list                                            │
├─────────────────────────────────────────────────────────────────┤
│  forums-message-composer                                        │
└─────────────────────────────────────────────────────────────────┘
```

### Page: Forum Categories Admin
*Friendly URL: `/forum-categories-admin` — Restrict access to the Administrator role.*
```
┌─────────────────────────────────────────────────────────────────┐
│  forums-categories-admin                                        │
└─────────────────────────────────────────────────────────────────┘
```

### Page: Forums Moderation
*Friendly URL: `/forums-moderation` — Restrict access to the Administrator role.*
```
┌─────────────────────────────────────────────────────────────────┐
│  forums-moderation                                              │
└─────────────────────────────────────────────────────────────────┘
```

---

## Display Page Templates

The site initializer creates two Display Page Templates automatically — one mapped to `ForumThread`, one mapped to `ForumMessage`. Both use the identical fragment arrangement described below and are defined in `site-initializer/layout-page-templates/display-page-templates/`.

> **How Object Definition resolution works:** Liferay's raw Display Page Template export bakes in a volatile internal ID suffix (e.g. `com.liferay.object.model.ObjectDefinition#A0Z2`) as the `contentType.className`, which breaks on re-import whenever Object Definitions are recreated. The site initializer avoids this by using `BundleSiteInitializer`'s token replacement system. When Object Definitions are created during initialization, the method `_replaceObjectDefinitionValues` registers tokens like `OBJECT_DEFINITION_CLASS_NAME:ForumThread` → `com.liferay.object.model.ObjectDefinition#xxxx`. The `display-page-template.json` uses these tokens:
> ```json
> {"contentType": {"className": "[$OBJECT_DEFINITION_CLASS_NAME:ForumThread$]"}, "name": "Forum Thread"}
> ```
> The `[$...$]` tokens are resolved at runtime before the layout importer processes the file, so the correct `className` (including its instance-specific `#suffix`) is always injected.

### Layout

Both Display Page Templates share the same structure:

```
┌─────────────────────────────────────────────────────────────────┐
│  Container                                                      │
│  ┌───────────────────────────────────────┬───────────────────┐  │
│  │  Column — 75%                         │  Column — 25%     │  │
│  │                                       │                   │  │
│  │  ┌─────────────────────────────────┐  │  ┌─────────────┐  │  │
│  │  │  forums-message-detail          │  │  │   forums-   │  │  │
│  │  └─────────────────────────────────┘  │  │  related-   │  │  │
│  │  ┌─────────────────────────────────┐  │  │   topics    │  │  │
│  │  │  forums-message-composer        │  │  └─────────────┘  │  │
│  │  └─────────────────────────────────┘  │                   │  │
│  └───────────────────────────────────────┴───────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

Inside the Container, a **2-column Grid** with a **75% / 25%** split:
- **Left column:** `forums-message-detail`, then `forums-message-composer`
- **Right column:** `forums-related-topics`

> **Important:** `forums-message-composer` must be present in every Display Page Template. Without it, users have no way to edit or reply to a message, because the composer modal is the sole entry point for both actions.

### ERC Field Mapping

The `forums-message-detail` and `forums-related-topics` fragments each contain hidden `div` elements that appear as mappable fields in the page editor but are not rendered to end-users at runtime. The site initializer's `page-definition.json` files pre-configure these mappings.

```html
<!-- Exposed as mappable fields in the Content Page Editor; hidden at runtime -->
<div id="forumsDetailERC"      data-lfr-editable-id="forumsDetailERC"      data-lfr-editable-type="text" style="display:none;">Mappable Message ERC</div>
<div id="forumsDetailReplyERC" data-lfr-editable-id="forumsDetailReplyERC" data-lfr-editable-type="text" style="display:none;">Mappable Reply ERC</div>
```

Each field is mapped to `ObjectEntry_externalReferenceCode` from the `DisplayPageItem` context, but only in the DPT that corresponds to its object type:

| Field | Forum Thread DPT | Forum Message DPT |
| :--- | :--- | :--- |
| **Mappable Message ERC** | Map to `ForumThread → externalReferenceCode` | Leave unmapped |
| **Mappable Reply ERC** | Leave unmapped | Map to `ForumMessage → externalReferenceCode` |

---

## Demo Data

The `setup/demo/` directory contains scripts for populating a development environment with forum content. The scripts are numbered and **must be run in numeric order** — later steps depend on earlier ones (notably, the Step 4 stats backfill depends on authorship already being reassigned in Step 2).

### Step 1 — Create demo data

```bash
python3 setup/demo/1-create-demo-data.py <siteId> [BASE_URL] [--email EMAIL] [--password PASSWORD]
```

Creates the four default top-level Forum Categories plus two subcategories under **Technical Help** (by ERC if they do not already exist), a set of demo user accounts assigned the Site Member role with profile photos, Forum Threads with keywords distributed across those categories, and replies to each message. Categories are created in two passes — parents first, then children — so each subcategory's parent id is resolvable. All content is created as the admin user; authorship is corrected in Step 2.

| Argument | Default | Description |
| :--- | :--- | :--- |
| `siteId` | *(required)* | Site (group) ID to scope all entries to |
| `BASE_URL` | `http://localhost:8080` | Liferay portal base URL |
| `--email` | `test@liferay.com` | Admin account email |
| `--password` | `test` | Admin account password |

### Step 2 — Reassign authors

Run [2-reassign-authors.groovy](setup/demo/2-reassign-authors.groovy) via **Control Panel → Server Administration → Script** (language: Groovy).

Step 1 creates every entry as the admin user. This step reassigns each `ForumThread` and `ForumMessage` to the author declared in `messages.json` (threads matched by `messageTitle`; messages ordered by `createDate`). **It must run before Step 4** — the stats backfill counts distinct entry owners, so if authorship has not been reassigned it finds only the admin user.

### Step 3 — Backfill create dates

Run [3-backfill-create-dates.groovy](setup/demo/3-backfill-create-dates.groovy) via **Control Panel → Server Administration → Script** (language: Groovy).

Copies the `displayDate` values (set by Step 1) into the `createDate` and `modifiedDate` columns on the `ObjectEntry` table for `ForumThread` and `ForumMessage` entries (definitions resolved by external reference code). This ensures that the entries appear with realistic chronological dates rather than all sharing the same import timestamp. This depends on the `LPD-17564` feature flag (see [Required Feature Flags](#required-feature-flags)) — with it disabled, Step 1's `displayDate` was never stored and this step updates 0 rows. After running, flush caches and rebuild indexes:

1. **Control Panel → Server Administration → Resources**
   - Clear content cached by this VM.
   - Clear content cached across the cluster.
   - Clear the database cache.
2. **Control Panel → Search → Index Actions**
   - Reindex all search indexes.

### Step 4 — Backfill Forum Stats Users

Run [4-backfill-forum-stats-users.groovy](setup/demo/4-backfill-forum-stats-users.groovy) via **Control Panel → Server Administration → Script** (language: Groovy).

Backfills `ForumStatsUser` records for every user who has posted a thread or message. Without these records, the `forums-hero` fragment displays 0 Members. **Run this after Step 2** (author reassignment), otherwise it records only the admin user. If re-running, first clear existing records with `setup/util/delete-forum-stats-users.py` to avoid duplicates.

---

## Utilities

The `setup/util/` directory contains cleanup and teardown scripts.

| File | Description |
| :--- | :--- |
| [delete-demo-data.py](setup/util/delete-demo-data.py) | Deletes all Forum Stats User, Forum Message, Forum Thread, and Forum Category entries for a given site. Forum Votes are removed automatically via cascade. Demo user accounts are left in place. Usage: `python3 setup/util/delete-demo-data.py <siteId> [BASE_URL] [--email EMAIL] [--password PASSWORD]` |
| [delete-forum-stats-users.py](setup/util/delete-forum-stats-users.py) | Deletes all `ForumStatsUser` entries via the Objects REST API. Run this before re-executing Step 4 to ensure no duplicate records. Accepts an optional `--scope` argument (site `groupId` or friendly URL); if omitted the script auto-detects the correct scope. Usage: `python3 setup/util/delete-forum-stats-users.py [BASE_URL] [--scope SCOPE] [--email EMAIL] [--password PASSWORD]` |
| [delete-forum-object-definitions.py](setup/util/delete-forum-object-definitions.py) | Deletes all Object definitions whose name starts with `Forum` via the Object Admin REST API. Useful for fully resetting a dev environment. |
| [backfill-thread-priority.py](setup/util/backfill-thread-priority.py) | Sets `priority: 0` on every Forum Thread that has no priority value. Run once on sites whose threads were created before the [Thread Priorities](#thread-priorities) feature, so the `priority:desc` sort behaves deterministically on every database. Usage: `python3 setup/util/backfill-thread-priority.py <siteId> [BASE_URL] [--email EMAIL] [--password PASSWORD]` |

---

## Forum Subscription Notifications: Filling a DXP Feature Gap

Email and in-portal notifications for forum subscriptions look like a basic feature, but they **cannot be built on Liferay DXP's published APIs alone**. The platform records that a user has subscribed to a topic, yet it gives an off-portal integration no supported way to act on those subscriptions. This is a genuine gap in DXP — not a shortcoming of this project — and it is the reason two of the artifacts here exist purely as a workaround.

The two components below are a cooperating pair that together close the gap:

- the [Forums Microservice](#forums-microservice-client-extension) — a Spring Boot Client Extension that orchestrates and delivers the notifications; and
- the [`forum-subscriptions` REST Builder module](#forum-subscriptions-restbuilder-osgi-module-forum-subscriptions) — a portal-side module that supplies the headless endpoints the microservice needs but DXP does not publish.

Read [The Feature Gap](#the-feature-gap) first for *why* this workaround is necessary; the two component sections that follow describe *how* it is implemented.

### The Feature Gap

When building the microservice to deliver email/in-portal notifications to forum subscribers — specifically, notifying everyone subscribed to a topic when a new reply or topic is posted — research surfaced two hard limitations in Liferay's *published* headless APIs:

**1. No endpoint returns who is subscribed to a resource.** Liferay's headless REST APIs have no endpoint that returns which users are subscribed to a given Object entry (or the Message Boards thread equivalent). The only subscription endpoints in `headless-admin-user` are scoped to the *calling* user: `GET /o/headless-admin-user/v1.0/my-user-account/subscriptions` returns only the authenticated caller's own subscriptions. There is no admin-facing endpoint that lists *all* subscribers for a resource. The underlying data lives in `SubscriptionLocalService` but is not exposed through any published REST API — so the microservice has no platform way to learn *whom* to notify.

**2. No off-portal way to create in-portal notifications.** Creating an in-portal (bell-panel) notification requires the internal `UserNotificationEventLocalService`, which a microservice running outside the portal JVM cannot invoke directly.

Two workarounds were considered for the subscriber-discovery problem:

**Workaround 1 -- "Forum Subscription" Object (Not implemented -- see Workaround 2 instead)**

Introduce a new `ForumSubscription` Liferay Object with fields for `subscriberUserId`, `messageERC` (the subscribed topic), and `siteId`. When a user subscribes or unsubscribes, the fragment calls `POST` / `DELETE` on `/o/c/forumsubscriptions/` to maintain the record. The Spring Boot microservice (triggered by an Object Action on `ForumMessage → On After Add`) then queries `GET /o/c/forumsubscriptions/?filter=messageERC eq '{erc}'` to obtain the full subscriber list and fans out the notifications. This is entirely within the Objects + headless stack and requires no portal-side code changes, but it means subscription state is owned by a custom Object rather than Liferay's native subscription infrastructure, and the two can drift if users subscribe through any other surface (e.g., via the legacy Message Boards portlet).

**Workaround 2 -- REST Builder Endpoints (Implemented)**

Use Liferay's **REST Builder** code-generation tool (an OSGi module deployed to the portal) to generate a custom headless API that delegates to `SubscriptionLocalService`. A thin `GET /o/forum-subscriptions/v1.0/threads/{threadId}/subscribers` endpoint can call `SubscriptionLocalServiceUtil.getSubscriptions(companyId, ForumThread.class.getName(), threadId)` server-side and return the subscriber user IDs or email addresses. The Spring Boot microservice then calls this custom endpoint instead of the missing platform one, keeping subscription state in Liferay's native store with no sync concerns. The trade-off is that REST Builder modules are traditional OSGi artifacts — not Client Extensions — so they cannot be deployed on Liferay SaaS and require a self-hosted or PaaS environment.

**This project includes Workaround 2.** The [`forum-subscriptions` module](#forum-subscriptions-restbuilder-osgi-module-forum-subscriptions) delegates to `SubscriptionLocalService`, so subscription state stays in Liferay's native store with no drift; the same module also adds the batch web-notification endpoint that solves limitation 2. The only cost is the SaaS restriction noted above — which is precisely why this whole capability is framed as filling a gap rather than as a first-class feature.

### Forums Microservice (Client Extension)

The [`forums-microservice`](client-extensions/forums-microservice) is a Spring Boot Client Extension that delivers **email and in-portal notifications** to forum subscribers when new content is posted. It is the server-side realization of *Workaround 2* described under [The Feature Gap](#the-feature-gap): it queries the custom `forum-subscriptions` REST Builder module to discover a topic's (or category's) subscribers, then fans out notifications.

Liferay invokes it through three **Object Action** webhooks, each secured by a signed OAuth2 JWT that the Spring Boot OAuth2 resource server validates against the DXP's JWKS endpoint:

| Object Action | Endpoint | Trigger | Notifies |
| :--- | :--- | :--- | :--- |
| New Reply | `POST /object-action/new-reply` | A `ForumMessage` is created (On After Add) | Subscribers of the parent `ForumThread` (excluding the reply author), plus users @mentioned in the body |
| New Message | `POST /object-action/new-message` | A root `ForumThread` (topic) is created (On After Add) | Subscribers of the parent `ForumCategory` (excluding the topic author) |
| Updated Reply | `POST /object-action/updated-reply` | A `ForumMessage` is updated (On After Update) | Only users @mentioned by the edit — mentions already present before the edit are diffed out (using the payload's `originalObjectEntry`), so no one is re-pinged; subscribers are not re-notified |

A `GET /ready` endpoint serves as the unauthenticated readiness/liveness probe. The service listens on port **58082**.

Email is delivered through Liferay's notification-queue REST API (`/o/notification/v1.0/notification-queue-entries`) and in-portal notifications through the custom `forum-subscriptions` module — there is no direct SMTP.

> **Dependency:** the microservice cannot work on its own. It relies on the custom [`forum-subscriptions` REST Builder module](#forum-subscriptions-restbuilder-osgi-module-forum-subscriptions) for two capabilities missing from Liferay's published headless APIs: **subscriber discovery** (`GET /messages/{messageId}/subscribers`) and **batch in-portal notifications** (`POST /web-notifications`). See that section for what each endpoint does, why the platform forces a custom module, and the SaaS caveat.

#### Building & deploying

The microservice builds and deploys independently from the `liferay-forums` workspace:

```bash
cd client-extensions/forums-microservice
blade gw clean build && lcp deploy --extension dist/*.zip
```

#### Running locally

A convenience script builds the bootJar and runs the service against a local (or remote) Liferay, loading environment variables from a `.env` file:

```bash
cd client-extensions/forums-microservice
cp .env.example .env   # then edit values
./run-local.sh         # add --skip-build to restart from an existing jar
```

`run-local.sh` also synthesizes the LXC "configtree" metadata locally (from `LIFERAY_DXP_HOST` / `LIFERAY_DXP_PROTOCOL`) that Liferay PaaS would otherwise mount, so JWT validation points at the right DXP instance. The `.env` file holds secrets and is gitignored; [`.env.example`](client-extensions/forums-microservice/.env.example) is the committed template.

#### Environment variables

| Variable | Required | Default | Description |
| :--- | :--- | :--- | :--- |
| `LIFERAY_BASE_URL` | No | `http://localhost:8080` | Base URL of the Liferay instance. Used both to locate the OAuth2 JWKS endpoint for JWT validation and as the target for headless API callbacks (subscriber lookup, message-title fetch, notification-queue POST, display-page URL construction). |
| `LIFERAY_DXP_HOST` | No | `localhost:8080` | DXP host written into the local LXC configtree by `run-local.sh` (local dev only). Must match the instance that issues the object-action JWTs. On PaaS this is provided by the platform. |
| `LIFERAY_DXP_PROTOCOL` | No | `http` | Protocol (`http`/`https`) paired with `LIFERAY_DXP_HOST` for the local configtree. |
| `LIFERAY_HEADLESS_API_USER` | No | `test@liferay.com` | Basic Auth username used **only** as a fallback when no JWT is forwarded on a call (e.g. manual/local testing). Normally the incoming object-action JWT is forwarded as a Bearer token. |
| `LIFERAY_HEADLESS_API_PASSWORD` | No | `test` | Basic Auth password for the fallback above. |
| `FORUMS_EMAIL_FROM` | No | `forums-noreply@example.xyz` | From address on outbound notification emails. |
| `FORUMS_EMAIL_FROM_NAME` | No | `Community Forums` | From display name on outbound notification emails. |
| `FORUMS_SITE_BASE_URL` | No | `https://www.example.xyz` | Base URL prepended to the site-relative display-page path in email/web notifications, so links resolve to the deployed site. |

The OAuth user-agent application (ERC `liferay-forumsmicroservice-oauth-application-user-agent`) and the two object actions are declared in [`client-extension.yaml`](client-extensions/forums-microservice/client-extension.yaml); the remaining settings live in [`application-default.properties`](client-extensions/forums-microservice/src/main/resources/application-default.properties).

### Forum Subscriptions RESTBuilder OSGi Module (`forum-subscriptions`)

[`modules/forum-subscriptions`](modules/forum-subscriptions) is a custom **REST Builder** OSGi module that publishes the small headless API the [Forums Microservice](#forums-microservice-client-extension) depends on. It exists to fill the two gaps in Liferay's *published* headless APIs detailed under [The Feature Gap](#the-feature-gap):

1. **Subscriber discovery.** When users subscribe to a topic, Liferay records it in its internal `Subscription` table via the built-in Object subscribe/unsubscribe HATEOAS actions — but **no published REST endpoint returns the list of users subscribed to a given Object entry**. The only headless subscription endpoint, `my-user-account/subscriptions`, is scoped to the *calling* user. So the microservice has no platform way to learn *whom* to notify.
2. **Web (in-portal) notifications.** Creating an in-portal (bell-panel) notification requires the internal `UserNotificationEventLocalService`, which an off-portal microservice cannot invoke directly.

The module is generated and structured like Liferay's own headless modules, as four sub-modules:

| Sub-module | Role |
| :--- | :--- |
| `headless-forum-subscriptions-api` | DTOs (`Subscriber`, `WebNotification`) and resource interfaces. |
| `headless-forum-subscriptions-impl` | The OSGi runtime: JAX-RS application, resource implementations, and the notification handler. The only hand-written logic lives here. |
| `headless-forum-subscriptions-client` | Generated Java client JAR (`com.liferay.headless.forum.subscriptions.client`). |
| `headless-forum-subscriptions-test` | Generated integration-test scaffolding. |

All endpoints live under the base URI **`/o/forum-subscriptions/v1.0`** and are guarded by the OAuth2 scope **`Liferay.Forum.Subscriptions.everything`** — the same scope the microservice's user-agent application requests.

#### Endpoints

| Method & path | Backing platform service | Purpose |
| :--- | :--- | :--- |
| `GET /messages/{messageId}/subscribers` | `SubscriptionLocalService` | Returns `{userId, emailAddress}` for every user subscribed to the `ForumThread` with the given ID. |
| `POST /web-notifications` | `UserNotificationEventLocalService` | Creates an in-portal notification (`subject` / `body` / `url`) for a batch of `userIds`. |

`SubscriberResourceImpl` resolves the `ForumThread` object definition by ERC (`FORUM-THREAD`) to obtain its internal class name, then calls `SubscriptionLocalService.getSubscriptions(companyId, className, messageId)` — the exact server-side call the missing headless endpoint would have made — and maps each `Subscription`'s user to an email address.

`WebNotificationResourceImpl` fans the request out to `UserNotificationEventLocalService.sendUserNotificationEvents(...)` once per user ID under the portlet name `LiferayForums`. A companion `ForumUserNotificationHandler` (registered for that same portlet name) interprets those events into the clickable entries that appear in the user's notification (bell) panel.

#### Permissions & access

Access is gated by the **`Liferay.Forum.Subscriptions.everything` OAuth2 scope** — only a token carrying that scope (i.e. the microservice's user-agent application) can reach the endpoints. The resource implementations then call Liferay *LocalServices* (`SubscriptionLocalService`, `UserLocalService`, `UserNotificationEventLocalService`), which run below the permission layer, so within that scope the microservice can read any topic's subscriber list and notify any user — exactly the back-end-service behavior it needs. Treat the scope as sensitive: anything holding a token with it can enumerate subscriber email addresses and push notifications to arbitrary users, so grant it only to the microservice's user-agent app — never to end-user-facing roles.

> The `LiberalPermissionChecker` in the generated `*ResourceFactoryImpl` is standard Liferay REST Builder boilerplate for the framework's optional permission-bypass path. It is **not** engaged here: the builder defaults to `checkPermissions = true` and nothing in this module opts out, so requests run with the caller's real permission checker.

> **SaaS caveat:** because this is a traditional OSGi artifact rather than a Client Extension, it requires a self-hosted or PaaS environment and **cannot be deployed on Liferay SaaS** — the underlying reason this whole approach is framed as a workaround. See [The Feature Gap](#the-feature-gap).

---

## Known Limitations

### View Count Not Incremented for Guest Users

The `forums-message-detail` fragment PATCHes the `viewCount` field on `ForumThread` objects only for authenticated users. Guest views are silently skipped because the Liferay Object REST API returns `403 Forbidden` for unauthenticated PATCH requests.

**Option:** Grant the Guest role `update` permission on ForumThread objects via the Object's permissions configuration. However, the preferred solution is a dedicated endpoint in a Spring Boot Client Extension that accepts a `messageId` and increments `viewCount` with its own service credentials — keeping the Object's permissions locked down.

### Ban Enforcement Is UI-Only

When a user is banned (a `ForumBan` Object entry exists for their user ID in the site scope), the fragments detect this at page load by querying `GET /o/c/forumbans/scopes/{groupId}?filter=banUserId eq {userId}`. If a ban is found, the UI is locked down: the submit button is disabled, compose buttons are hidden, and an inline warning is shown. This is purely client-side — the REST endpoints that create and update content (`POST /o/c/forumthreads/`, `POST /o/c/forummessages/`, `PATCH /o/c/forumthreads/{id}`, `PATCH /o/c/forummessages/{id}`) have no knowledge of the `ForumBan` collection and will accept requests from a banned user if called directly.

**Why the legacy portlets don't have this gap:** The legacy Message Boards portlets enforce bans at the Liferay permission framework layer (`MBPortletResourcePermissionLogic`), which calls `MBBanLocalService.hasBan()` on every permission check regardless of the calling path (web UI, REST API, or direct service invocation). Custom Liferay Objects have no equivalent hook into that permission logic.

**Why this can't be fixed with built-in Object features:** Object Actions all fire after the entry is already committed (there is no pre-create trigger that can abort creation). Object Validation rules use the Expression Builder, which is limited to the entry's own field values and cannot query other Object collections or access current user context. Groovy script actions — which could perform the check — are not available on Liferay SaaS.

**The only realistic server-side option: Microservice Client Extension**

A Spring Boot Microservice Client Extension can be registered as an Object Action webhook on both `ForumThread` and `ForumMessage`, triggered on the `On After Add` event. It would:

1. Receive the Object Action payload, which includes the `creatorId` (the user ID of the entry author) and the `groupId` (site scope).
2. Call `GET /o/c/forumbans/scopes/{groupId}?filter=banUserId eq {creatorId}&pageSize=1` using service credentials to check for a ban record.
3. If a ban record exists, immediately call `DELETE /o/c/forumthreads/{entryId}` or `DELETE /o/c/forummessages/{entryId}` to remove the entry.

There is an unavoidable brief window (milliseconds to low seconds depending on load) between the entry being created and the microservice deleting it. In practice this is acceptable given that banning is rare and the moderation fragment provides a backstop for any content that appears during that window.

### Thread Priority Permission Is UI-Only

The [Thread Priorities](#thread-priorities) select in the composer is only shown to moderator-level users (detected via the HATEOAS `create` action on the `ForumBan` collection), and a non-privileged edit omits the `priority` field from the PATCH. However — like ban enforcement — this is purely client-side: `PATCH /o/c/forumthreads/{id}` accepts a `priority` value from anyone with UPDATE permission on the thread, which includes the thread's author (Objects grant owners UPDATE by default). The legacy Message Boards close this gap server-side by resetting any incoming priority when the caller lacks the `UPDATE_THREAD_PRIORITY` permission (`MBMessageServiceImpl`); custom Liferay Objects have no equivalent hook. The same microservice-webhook approach described under [Ban Enforcement Is UI-Only](#ban-enforcement-is-ui-only) could be used to revert unauthorized priority changes if server-side enforcement is required.

### "Top Replies" Implemented as "Recent Activity"

The "Recent Activity" tab (formerly "Top Replies") sorts messages using `lastPostDate:desc`. This functions as a "Recently Active" feed rather than filtering for the highest volume of total replies. A new message with 1 reply will surface above an older message with 100 replies.

**Option:** If a true "Top Replied" filter is desired, the sorting criteria must be changed to target a `replyCount` metric. The Liferay Object definition would need an aggregated integer field for total replies that can be passed to the OData `sort` parameter (e.g., `sort=replyCount:desc`), or rely on a Client Extension to dynamically aggregate and sort this information.
