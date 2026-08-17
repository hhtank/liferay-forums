# Liferay Forums

This Liferay Workspace project is a Fragments and Liferay Objects based replacement for the legacy Message Boards / Questions widgets which are deprecated.

---

## Table of Contents

- [Screenshots](#screenshots)
- [Setup](#setup)
- [Initializing a New Instance](#initializing-a-new-instance)
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
  - [Notification Templates &amp; Object Actions](#notification-templates--object-actions)
- [Known Limitations](#known-limitations)
  - [View Count Not Incremented for Guest Users](#view-count-not-incremented-for-guest-users)
  - [Ban Enforcement Is UI-Only](#ban-enforcement-is-ui-only)
  - [Thread Priority Permission Is UI-Only](#thread-priority-permission-is-ui-only)
  - ["Top Replies" Implemented as "Recent Activity"](#top-replies-implemented-as-recent-activity)
  - [The Site Initializer Caps Out at 12 Object Definitions](#the-site-initializer-caps-out-at-12-object-definitions)
  - [The Bell Notification Is Not Clickable](#the-bell-notification-is-not-clickable)
  - [HSQLDB Produces Misleading Failures](#hsqldb-produces-misleading-failures)
  - [`forum-stats` Is Not SaaS-Installable](#forum-stats-is-not-saas-installable)

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

## Initializing a New Instance

Run these in order. Steps 1–5 are order-dependent: the feature flags gate Object capabilities the initializer relies on, so enabling them *after* creating the site leaves it half-configured.

| # | Step | Where |
| :-- | :--- | :--- |
| 1 | Enable the [feature flags](#required-feature-flags) `LPD-17564`, `LPD-34594`, `LPD-11235` | both |
| 2 | Set `siteExternalReferenceCode` / `siteName` in [`client-extension.yaml`](client-extensions/forums-site-initializer/client-extension.yaml) — see [Setup](#setup) | both |
| 3 | `./gw build`, then copy `forums-site-initializer.zip` to `$LIFERAY_HOME/deploy` | both |
| 4 | Deploy the [Forums Microservice](#forums-microservice-client-extension) — `lcp deploy` on PaaS, or copy `forums-microservice.zip` to `$LIFERAY_HOME/deploy` locally | both |
| 5 | Create the site, choosing the **Forums** site initializer | both |
| 6 | Start the microservice: `cd client-extensions/forums-microservice && ./run-local.sh` | local |
| 7 | [Replace the two imported `ForumMessage` actions with webhooks](#binding-the-object-actions-locally) | local |
| 8 | [Demo data](#demo-data) scripts 1–5, in numeric order | optional |

> **Skipping step 4 fails silently.** Without the microservice client extension nothing calls the notification handlers: replies are created normally, no error is logged, and no notification is ever sent. The object definitions, notification templates and all four object actions arrive automatically from the site initializer — only the webhook swap in step 7 is manual, and only on a local bundle.

> **Redeploying over an older install?** The steps above assume a fresh site. An environment built before the Objects switch carries hand-made object actions that the site initializer will not replace — see [Upgrading an environment built before the Objects switch](#upgrading-an-environment-built-before-the-objects-switch).

To confirm the pipeline end to end: subscribe to a thread, reply to it **as a different user** (the author is always excluded), then check `GET /o/notification/v1.0/notification-queue-entries` — it should gain two rows for that subject, one `type=email` and one `type=userNotification`. **Four** rows means a duplicate action survived the upgrade.

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
- **Notification** — mentioning a user notifies them by **email and in-portal bell notification**, reusing the same [Forums Microservice](#forums-microservice-client-extension) path as subscriptions. The microservice's `MentionService` parses the `#mention-{screenName}` handles from the posted body and resolves them with a single `GET /o/headless-admin-user/v1.0/sites/{siteId}/user-accounts` query filtered on `alternateName`, **scoped to members of the post's site**. Because the query is site-scoped, a handle for a non-member (e.g. one injected into the body via the REST API) does not match and is dropped, so a crafted body cannot notify or probe users outside the site. The author and anyone already notified as a topic subscriber are excluded before sending. Editing a post also delivers mentions: an On After Update action diffs the edited body's mentions against the prior body's, so a newly-added `@mention` notifies that user while everyone already mentioned is left alone. Mentions are delivered through the same `ForumNotification` object as subscriptions, so this requires the microservice to be running — see [The Feature Gap](#the-feature-gap).

> **Mention search requires `User` view permission:** the picker calls `GET /o/headless-admin-user/v1.0/sites/{siteId}/user-accounts`, which runs a *permission-filtered* user search — the `siteId` only narrows the results, it does not by itself grant visibility. The controlling permission is **`View` on the `com.liferay.portal.kernel.model.User` resource** (checked at company scope). A caller without it sees only themselves (and users in organizations they manage, via `UserSearchPermissionFilterContributor`), so the dropdown shows "No users found" — being a member of the same site is **not** sufficient on its own. To enable mentions for all members, grant a Regular Role they hold the `User → View` permission (Control Panel → Roles → *[role]* → Define Permissions → Users and Organizations → User → View).
>
> Note this `User` view grant is **company-scoped, not per-site** — Liferay has no built-in "only see users of my own sites" permission for this endpoint. It lets members search all users in the company (the endpoint then narrows the *returned* results to the current site). If that is too broad, front the search with a custom microservice endpoint that runs with service credentials and returns only site members.
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

Email and in-portal notifications for forum subscriptions look like a basic feature, but they **cannot be built on Liferay DXP's published APIs alone**. The platform records that a user has subscribed to a topic, yet it gives an off-portal integration no supported way to act on those subscriptions. This is a genuine gap in DXP — not a shortcoming of this project.

No portal-side OSGi artifact is involved: the capability is delivered entirely by Client Extensions.

- a **`ForumSubscription` custom Object** that stores who is subscribed to which topic, maintained by the fragments through the Objects REST API; and
- a **`ForumNotification` custom Object** whose *Notification Object Actions* deliver the email and the in-portal notification, with the [Forums Microservice](#forums-microservice-client-extension) writing one row per recipient.

The Objects, notification templates and object actions ship in the site initializer — a plain zip, installable anywhere. The [Forums Microservice](#forums-microservice-client-extension) is a *microservice* client extension, deployed as a container via [`LCP.json`](client-extensions/forums-microservice/LCP.json), so it additionally requires an environment that provisions container client extensions. Confirm that against the target subscription before relying on it for a Marketplace listing.

Note that delivery itself now happens entirely in the site-initializer half. The microservice only computes recipients — read the subscribers, resolve the @mentions, exclude the author, write one row each — so if a container Client Extension turns out to be unavailable, the surface left to replace is far smaller than the deleted OSGi module was.

Read [The Feature Gap](#the-feature-gap) first for *why* this shape is necessary; the sections that follow describe *how* it is implemented.

### The Feature Gap

When building the microservice to deliver email/in-portal notifications to forum subscribers — specifically, notifying everyone subscribed to a topic when a new reply or topic is posted — research surfaced two hard limitations in Liferay's *published* headless APIs:

**1. No endpoint returns who is subscribed to a resource.** Liferay's headless REST APIs have no endpoint that returns which users are subscribed to a given Object entry (or the Message Boards thread equivalent). The only subscription endpoints in `headless-admin-user` are scoped to the *calling* user: `GET /o/headless-admin-user/v1.0/my-user-account/subscriptions` returns only the authenticated caller's own subscriptions. There is no admin-facing endpoint that lists *all* subscribers for a resource. The underlying data lives in `SubscriptionLocalService` but is not exposed through any published REST API — so the microservice has no platform way to learn *whom* to notify.

**2. No off-portal way to create in-portal notifications.** Creating an in-portal (bell-panel) notification requires the internal `UserNotificationEventLocalService`, which a microservice running outside the portal JVM cannot invoke directly.

Two approaches were considered:

**Rejected -- REST Builder endpoints.** Liferay's **REST Builder** can generate a custom headless API that delegates to `SubscriptionLocalService`, so subscription state stays in Liferay's native store with no sync concerns. This project shipped that approach originally, as a `forum-subscriptions` OSGi module exposing `GET /messages/{messageId}/subscribers` and `POST /web-notifications`. The blocker is packaging: REST Builder modules are traditional OSGi artifacts, not Client Extensions, so they **cannot be deployed on Liferay SaaS**. A SaaS-installable Marketplace app must be client-extension-only, so the module was removed.

**Implemented -- custom Objects + a Notification Object Action.**

*Gap 1 (subscriber discovery)* is closed by a **`ForumSubscription`** Object (ERC `FORUM-SUBSCRIPTION`) holding a `subscriberUserId` and a cascade-delete `oneToMany` relationship from `ForumThread` (`REL-THREAD-SUBSCRIPTIONS`). The `forums-message-detail` and `forums-message-composer` fragments create and delete rows through `/o/c/forumsubscriptions`, and the microservice reads them with an OData filter on `r_threadSubscriptions_c_forumThreadId`.

*Gap 2 (in-portal notifications)* is closed by a **`ForumNotification`** Object (ERC `FORUM-NOTIFICATION`) carrying `recipientUserId`, `notificationSubject`, `notificationBody` and `notificationUrl`. Two **Notification Object Actions** on its *On After Add* trigger — one of `type: email`, one of `type: userNotification` — deliver both channels from the notification templates in [`site-initializer/notification-templates`](client-extensions/forums-site-initializer/site-initializer/notification-templates). The in-portal channel needs no `UserNotificationEventLocalService` and no custom notification handler: Liferay renders the bell entry itself.

The microservice's only job is fan-out — one `ForumNotification` row per recipient.

**How each template addresses its recipient.** The two channels do *not* work the same way, because `recipientUserId` is a plain `LongInteger` field and its term renders a number:

| Template | `recipientType` | Recipient | Why |
| :--- | :--- | :--- | :--- |
| Web | `term` | `[%FORUMNOTIFICATION_RECIPIENTUSERID%]` | A `userNotification` identifies its user by id, so the number is exactly what it needs. |
| Email | `email` | `[%FORUMNOTIFICATION_RECIPIENTEMAILADDRESS%]` | An email `To` needs an address, and the term for a `LongInteger` field cannot produce one. |

So the microservice **does** handle email addresses: `ForumNotificationService` resolves them from `/o/headless-admin-user/v1.0/user-accounts` (chunked, 50 ids per query) and writes `recipientEmailAddress` onto each row. A recipient that does not resolve simply gets no email; their bell notification still fires.

> Addressing both channels by term — which would keep addresses out of the row entirely — needs `recipientUserId` to become a **relationship to the User system object** rather than a `LongInteger`. The email template could then use `[%FORUMNOTIFICATION_RECIPIENTUSER_EMAILADDRESS%]` and the `recipientEmailAddress` field would be deleted along with the lookup. That change is not made here.

**Drift.** Because the custom Object is now the source of truth, `enableObjectEntrySubscription` is set to `false` on `ForumThread` and `ForumMessage`. That removes the OOTB `subscribe`/`unsubscribe` HATEOAS actions, so there is no second surface that could write subscription state and no way for the two stores to disagree.

**Migration.** Existing rows in Liferay's native `Subscription` table are *not* migrated — users subscribed before this change re-subscribe through the UI.

**Retention & visibility.** A recipient is only notified if they can `VIEW` the triggering entry, so the `User` role is granted model-scoped `VIEW` on `ForumNotification`. That grant is company-wide — the same shape that gives `Guest` read access to every `ForumThread` — so be clear about what it means:

> **Any authenticated user can read an un-purged `ForumNotification` row**, including its `recipientEmailAddress`, `notificationSubject` and `notificationBody`. `GET /o/c/forumnotifications` is enough, and `enableIndexSearch` is `true`.
>
> The only thing keeping that window small is the purge: the microservice deletes each row as soon as its actions have run (`forums.notification.purge`, default `true`). It is best-effort, not a guarantee — the flag is documented as something to turn **off** where object actions run asynchronously, and a failed delete is logged and swallowed rather than retried. Rows persist for as long as the purge is disabled or failing.
>
> Removing the grant is not obviously safe either, since delivery is said to depend on it. Taking the addresses out of the row is the fix that does not trade one problem for the other — see the note on the User relationship above.

### Forums Microservice (Client Extension)

The [`forums-microservice`](client-extensions/forums-microservice) is a Spring Boot Client Extension that works out **who** should be notified when new content is posted. It reads the topic's subscribers from `/o/c/forumsubscriptions`, resolves any @mentions, and writes one `ForumNotification` row per recipient. Delivery itself is done by the Notification Object Actions on that object — see [The Feature Gap](#the-feature-gap).

Liferay invokes it through two **Object Action** webhooks, each secured by a signed OAuth2 JWT that the Spring Boot OAuth2 resource server validates against the DXP's JWKS endpoint:

| Object Action | Endpoint | Trigger | Notifies |
| :--- | :--- | :--- | :--- |
| New Reply | `POST /object-action/new-reply` | A `ForumMessage` is created (On After Add) | Subscribers of the parent `ForumThread` (excluding the reply author), plus users @mentioned in the body |
| Updated Reply | `POST /object-action/updated-reply` | A `ForumMessage` is updated (On After Update) | Only users @mentioned by the edit — mentions already present before the edit are diffed out (using the payload's `originalObjectEntry`), so no one is re-pinged; subscribers are not re-notified |

A `GET /ready` endpoint serves as the unauthenticated readiness/liveness probe. The service listens on port **58082**.

**Both handlers answer immediately and fan out in the background.** Liferay calls an object action *synchronously and waits for the response*, so doing the work inline put the subscriber lookup, the title/site/display-page lookups, one `ForumNotification` write **and** one purge per recipient, and then the whole mention pass, inside the poster's "Posting..." spinner. The handlers now acknowledge the action and hand the payload to a small executor (`forums.notification.async.*`).

This is safe because nothing in a handler reads the entry that triggered it — the title comes from the parent `ForumThread` and the display URL from the payload — so there is no commit ordering to respect. The trade-offs:

- Queue overflow **runs on the calling thread**, so an overloaded service degrades to the old inline latency rather than dropping a notification. That backpressure also keeps the queue too shallow for a forwarded JWT to expire in it; if one does, the call is retried once without the token so the Basic Auth fallback can take over — which only helps where those credentials are actually set.
- Liferay now logs success as soon as the action is acknowledged, so **its log is no longer evidence that anything was delivered**. The microservice logs an elapsed-time line per fan-out, and an `ERROR` when a fan-out that had recipients reached none of them. The queue is in-memory: `server.shutdown=graceful` plus a 10s drain covers a rolling deploy, not a `SIGKILL`.

> Not to be confused with `forums.notification.purge`. That flag is about whether **Liferay** runs the `ForumNotification` object's own notification actions asynchronously, and is unaffected by this. The row is still created, its actions still fire and it is still purged — just on a pool thread.

There is no direct SMTP: email is sent by the `email` Notification Object Action, which enqueues through Liferay's own notification queue.

> Subscriptions are **thread-level only**. There is no category-level subscription, so creating a topic notifies no one — which is why there is no longer a `new-message` object action.

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

##### Binding the object actions locally

On PaaS/SaaS the `objectAction` client extension registers an executor and Liferay calls the handlers with a signed JWT — nothing extra to do. **On a local bundle that registration does not happen**; the portal log shows:

```
No object action executor found with company ID <id> and key liferay-forumsmicroservice-object-action-new-reply
```

The site initializer ships both actions ([`forum-message.object-actions.json`](client-extensions/forums-site-initializer/site-initializer/object-actions/forum-message.object-actions.json)) bound to the client-extension executor, which is correct for PaaS/SaaS. Locally you must **replace** them — delete `ForumMessageNewReply` and `ForumMessageUpdatedReply`, then recreate them as plain **webhooks** (Control Panel → Objects → ForumMessage → Actions):

| Trigger | Executor | URL |
| :--- | :--- | :--- |
| On After Add | Webhook | `http://localhost:58082/object-action/new-reply` |
| On After Update | Webhook | `http://localhost:58082/object-action/updated-reply` |

Leaving the imported versions in place is what produces the error above on every reply; adding webhooks *alongside* them would fire each handler twice.

Verify with `GET /o/notification/v1.0/notification-queue-entries` after a reply: two rows should appear for that subject, one `type=email` and one `type=userNotification`. If none do, `grep "No object action executor found"` in the portal log distinguishes "the trigger never fired" from a failure further down; the microservice log covers the rest.

A webhook carries no JWT, so `run-local.sh` activates the **`local` Spring profile** ([`application-local.properties`](client-extensions/forums-microservice/src/main/resources/application-local.properties)), which adds the two object-action paths to `liferay.oauth.urls.excludes`. The handlers treat the JWT as optional and fall back to the configured Basic Auth credentials for their own outbound calls.

> This loosening is **local-only**. `application-default.properties` — the profile PaaS/SaaS runs — excludes only `/ready`, leaving the object-action endpoints behind OAuth2. Verified by running the jar under each profile: `default` returns `401` on an unauthenticated object-action POST, `default,local` returns `200`.

##### Upgrading an environment built before the Objects switch

Everything above describes a **fresh** install, where the site initializer is the only thing that creates object actions. Before the Objects switch it shipped no `object-actions/` folder at all, so an environment set up against the older README has *hand-made* actions that nobody deletes on redeploy. Clear them out first — **Control Panel → Objects → ForumMessage / ForumThread → Actions**:

| Leftover | Where | Symptom if left in place |
| :--- | :--- | :--- |
| Hand-made `new-reply` / `updated-reply` | `ForumMessage` | Fires **alongside** the imported action — the initializer upserts by external reference code, so a different ERC survives. Two `ForumNotification` rows per recipient, so two emails and two bell notifications per reply. Nothing is logged. |
| `new-message` | `ForumThread` | The executor and the `/object-action/new-message` route were both removed. Bound to the client-extension executor it logs `No object action executor found ... key liferay-forumsmicroservice-object-action-new-message` on every topic creation; bound as a local webhook it instead gets a silent **404** back from the microservice. |

The duplicate case is the one to watch: it is silent, and `grep "No object action executor found"` does not catch the stale local webhook either. Check the Actions tab directly rather than relying on the log.

There is no category-level subscription — see the note under [Object Actions](#forums-microservice-client-extension) — which is why `new-message` has no replacement.

#### Environment variables

| Variable | Required | Default | Description |
| :--- | :--- | :--- | :--- |
| `LIFERAY_BASE_URL` | No | `http://localhost:8080` | Base URL of the Liferay instance. Used both to locate the OAuth2 JWKS endpoint for JWT validation and as the target for headless API callbacks (subscriber lookup, message-title fetch, ForumNotification writes, display-page URL construction). |
| `LIFERAY_DXP_HOST` | No | `localhost:8080` | DXP host written into the local LXC configtree by `run-local.sh` (local dev only). Must match the instance that issues the object-action JWTs. On PaaS this is provided by the platform. |
| `LIFERAY_DXP_PROTOCOL` | No | `http` | Protocol (`http`/`https`) paired with `LIFERAY_DXP_HOST` for the local configtree. |
| `LIFERAY_HEADLESS_API_USER` | No | `test@liferay.com` | Basic Auth username used **only** as a fallback when no JWT is forwarded on a call (e.g. manual/local testing). Normally the incoming object-action JWT is forwarded as a Bearer token. |
| `LIFERAY_HEADLESS_API_PASSWORD` | No | `test` | Basic Auth password for the fallback above. |
| `FORUMS_NOTIFICATION_PURGE` | No | `true` | Deletes each `ForumNotification` row once its object actions have run. Set to `false` if the environment executes object actions asynchronously. |
| `FORUMS_NOTIFICATION_ASYNC_CORE_SIZE` | No | `2` | Core threads on the notification fan-out pool. |
| `FORUMS_NOTIFICATION_ASYNC_MAX_SIZE` | No | `8` | Maximum threads on that pool. |
| `FORUMS_NOTIFICATION_ASYNC_QUEUE_CAPACITY` | No | `100` | Queued fan-outs before overflow runs on the calling thread. Short on purpose: each task retains the whole object-action payload and the container is allotted 512 MB. |
| `FORUMS_NOTIFICATION_ASYNC_AWAIT_TERMINATION_SECONDS` | No | `10` | How long shutdown waits for queued fan-outs to drain. Keep it inside the platform's SIGTERM→SIGKILL grace period (30s by default). |
| `FORUMS_SITE_BASE_URL` | No | `https://www.example.xyz` | Base URL prepended to the site-relative display-page path in email/web notifications, so links resolve to the deployed site. |

The OAuth user-agent application (ERC `liferay-forumsmicroservice-oauth-application-user-agent`) and the two object actions are declared in [`client-extension.yaml`](client-extensions/forums-microservice/client-extension.yaml); the remaining settings live in [`application-default.properties`](client-extensions/forums-microservice/src/main/resources/application-default.properties).

### Notification Templates & Object Actions

The site initializer ships both halves of the delivery path:

| Path | Role |
| :--- | :--- |
| [`notification-templates/forum-notification-email/`](client-extensions/forums-site-initializer/site-initializer/notification-templates/forum-notification-email) | `type: email` template (ERC `FORUM-NOTIFICATION-EMAIL-TEMPLATE`). `notification-template.json` holds the subject and recipient; the body is the sibling `en_US.html`. |
| [`notification-templates/forum-notification-web/`](client-extensions/forums-site-initializer/site-initializer/notification-templates/forum-notification-web) | `type: userNotification` template (ERC `FORUM-NOTIFICATION-WEB-TEMPLATE`) for the bell panel. |
| [`object-actions/forum-notification.object-actions.json`](client-extensions/forums-site-initializer/site-initializer/object-actions/forum-notification.object-actions.json) | The two `objectActionExecutorKey: notification` actions bound to `ForumNotification` → *On After Add*. |

Both templates address the recipient with the term `[%FORUMNOTIFICATION_RECIPIENTUSERID%]`, and interpolate `[%FORUMNOTIFICATION_NOTIFICATIONSUBJECT%]`, `[%FORUMNOTIFICATION_NOTIFICATIONBODY%]` and `[%FORUMNOTIFICATION_NOTIFICATIONURL%]` from the row the microservice wrote.

The email body links to the discussion with an `<a href="[%FORUMNOTIFICATION_NOTIFICATIONURL%]">` anchor rather than relying on the notification's own link target, because the triggering `ForumNotification` entry has no display page of its own.

The From address and display name are the `from` / `fromName` recipient settings in `forum-notification-email/notification-template.json` — edit them there (or in Control Panel → Notifications → Templates), not in the microservice.

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

### The Site Initializer Caps Out at 12 Object Definitions

On `dxp-2026.q1.4-lts` this site initializer publishes **12** object definitions successfully and fails at **13**, regardless of what the thirteenth contains. The failure surfaces during `publishObjectDefinitions` as an `ObjectDefinitionFriendlyURLSeparatorException` ("Other asset types may use this prefix") thrown against an *unrelated* object — `ForumMessage` — so the message points nowhere near the actual cause.

It is not a content problem. It reproduces with a trivial thirteenth object that has no relationships, no permissions and no actions, and it survives renaming objects, changing their derived URL separators, and reordering the definition files. Publishing definitions individually over the Object Admin REST API does not hit it, which suggests the fault is in the initializer's bulk create-then-publish loop rather than in object count itself.

This is why the unused `ForumMailingList` object was removed when `ForumSubscription` and `ForumNotification` were added: 11 − 1 + 2 = 12. **Adding any further object definition to this site initializer will break deployment on a clean bundle.** If more objects are needed, ship them outside the initializer — a batch client extension (`*.batch-engine-data.json`, the pattern Liferay's own CMP and DSR initializers use) or a post-deploy Object Admin REST call — rather than trying to fit under the cap.

> `friendlyURLSeparator` in an object-definition JSON is **ignored on create**; it only applies via `PATCH`. Setting it in the initializer to dodge the collision has no effect.

### The Bell Notification Is Not Clickable

The in-portal notification arrives with the correct text, but clicking it only marks it read and returns to the notifications list — it does not open the discussion. The email carries a working `<a href="[%FORUMNOTIFICATION_NOTIFICATIONURL%]">` link, so the discussion is always one click away there; the bell entry is an in-portal signal only.

The notification is raised against the `ForumNotification` row, which has no display page for the handler to resolve a URL from. Two configuration-level fixes were tried and **both are dead ends** — recorded here so they are not re-attempted:

| Attempt | Result |
| :--- | :--- |
| Put an `<a href>` in the notification **subject** | The bell escapes HTML; the raw `<a href="…">…</a>` renders as visible text. |
| **Retarget** the action at `ForumThread` via `objectDefinitionExternalReferenceCode` | Delivers correctly, and `[%FORUMNOTIFICATION_*%]` terms still resolve from the source object — but the link is unchanged. The href remains `markNotificationAsRead` + a redirect back to the notifications page, with no destination, even though the thread has a valid display page and friendly URL. |

Retargeting also cannot supply a per-row thread id: `predefinedValues` evaluates `value` as a DDM expression only when `inputAsValue` is false, and that path throws `DDMExpressionException: … _ddmExpressionFieldAccessor is null` for a bare field reference. `inputAsValue: true` takes the value literally, which is useless for an id that changes per notification.

**Option:** a custom `UserNotificationHandler` could build the link, but it is an OSGi component — reintroducing the SaaS packaging blocker that [The Feature Gap](#the-feature-gap) exists to remove. Not worth it for a link while email already carries one.

### HSQLDB Produces Misleading Failures

The default bundle ships with HSQLDB, which has twice produced symptoms that look like application bugs:

- **A wedged write session blocks every subsequent write.** Reads keep working normally, so the forum browses fine while `POST /o/c/forumnotifications/...` hangs indefinitely — no error, no log entry, the request simply never returns. The notification pipeline then appears broken when the database is at fault. A portal restart clears it; a thread dump shows the request parked in `org.hsqldb.lib.CountUpDownLatch.await`.
- **DDL is not transactional.** When publishing an object definition fails partway, the table and indexes it created survive the rollback. Retrying then fails with `object name already exists: O_<id>_<OBJECT>_L` — a different error than the original cause, which sends debugging in the wrong direction.

**Option:** switch to MySQL — `portal-ext.properties` already carries a commented-out block for it. Worth doing before debugging anything write-heavy. As a rule of thumb on this bundle: a hung write, or a repeat failure that differs from the first, is usually the database rather than the app.

### `forum-stats` Is Not SaaS-Installable

[`modules/forum-stats`](modules/forum-stats) counts a user's messages with an in-JVM `ModelListener` on `ObjectEntry`. Like the removed `forum-subscriptions` module it is a traditional OSGi artifact, so it **cannot be deployed on Liferay SaaS** and must be left out of a Marketplace listing. The counter simply does not advance without it.

**Option:** move the increment to the microservice, behind an Object Action webhook on `ForumMessage → On After Add` — the same shape the notification path now uses.
