// SPDX-License-Identifier: LGPL-2.1-or-later

/**
 * Hot-update fragment source (html/css/js/configuration) from disk
 * for iterative dev, without redeploying the site-initializer zip.
 *
 * Redeploying the zip on an already-initialized site can fail
 * (e.g. LayoutFriendlyURLException). This script side-steps that by
 * writing directly to BOTH:
 *   - FragmentEntry        (source-of-truth for the collection)
 *   - FragmentEntryLink    (per-page snapshots embedded in layouts)
 *
 * Edit the `fragments` list below to pick which fragments to push,
 * then run in:
 *   Control Panel -> Server Administration -> Script (Groovy)
 *
 * Parser-safety notes (Liferay Script console):
 *   - No emojis in out.println.
 *   - No nested closures with GString interpolation in out.println
 *     (paste can truncate the trailing `}`); use string concat with +.
 *   - link.fragmentEntryId was removed in 2026.Q1.4 - use
 *     link.fragmentEntryERC.
 */

import com.liferay.fragment.service.FragmentCollectionLocalServiceUtil
import com.liferay.fragment.service.FragmentEntryLocalServiceUtil
import com.liferay.fragment.service.FragmentEntryLinkLocalServiceUtil

// EDIT ME: path to the site-initializer fragments, relative to the home
// directory of the OS user running the Liferay server. The Server
// Administration script console reads from the server's filesystem;
// System.getProperty("user.home") resolves to that server process's home
// (on a local dev box, that's you).
def workspaceFragmentsPath = System.getProperty("user.home") + "/Assets/liferay-forums/client-extensions/forums-site-initializer/site-initializer/fragments/company/forums/fragments"
def collectionKey = "forums"

// Edit this list to control which fragments get pushed.
def fragments = [
    "forums-categories-admin",
    "forums-category-grid",
    "forums-hero",
    "forums-message-composer",
    "forums-message-detail",
    "forums-message-list",
    "forums-moderation",
    "forums-related-topics",
]

// Search every group: the collection lives in the global group, whose id
// differs per instance, so it is resolved rather than hardcoded.
def collections = FragmentCollectionLocalServiceUtil.getFragmentCollections(-1, -1)
def col = collections.find { it.fragmentCollectionKey == collectionKey }
if (col == null) {
    out.println("FAIL FragmentCollection '" + collectionKey + "' not found in any group")
    out.println("Available keys: " + collections.collect { it.fragmentCollectionKey }.join(", "))
    return
}
out.println("Found collection '" + collectionKey + "' at groupId=" + col.groupId)
out.println("Reading from: " + workspaceFragmentsPath)

def entries = FragmentEntryLocalServiceUtil.getFragmentEntries(col.fragmentCollectionId)
def allLinks = FragmentEntryLinkLocalServiceUtil.getFragmentEntryLinks(-1, -1)

def deployFragment = { String fragmentKey ->
    def fragmentDir = new File(workspaceFragmentsPath + "/" + fragmentKey)
    if (!fragmentDir.exists()) {
        out.println("WARN " + fragmentKey + " - not found at " + fragmentDir.getAbsolutePath())
        return
    }

    def htmlFile = new File(fragmentDir, "index.html")
    def cssFile  = new File(fragmentDir, "index.css")
    def jsFile   = new File(fragmentDir, "index.js")
    def configFile = new File(fragmentDir, "configuration.json")

    def html = htmlFile.exists() ? htmlFile.text : ""
    def css  = cssFile.exists()  ? cssFile.text  : ""
    def js   = jsFile.exists()   ? jsFile.text   : ""
    def configuration = configFile.exists() ? configFile.text : ""

    def entry = entries.find { it.fragmentEntryKey == fragmentKey }
    if (entry == null) {
        out.println("WARN " + fragmentKey + " - no FragmentEntry in collection '" + collectionKey + "'")
        return
    }

    entry.setHtml(html)
    entry.setCss(css)
    entry.setJs(js)
    if (configuration) entry.setConfiguration(configuration)
    FragmentEntryLocalServiceUtil.updateFragmentEntry(entry)

    def myLinks = allLinks.findAll { it.fragmentEntryERC == entry.externalReferenceCode }
    myLinks.each { link ->
        link.setHtml(html)
        link.setCss(css)
        link.setJs(js)
        if (configuration) link.setConfiguration(configuration)
        FragmentEntryLinkLocalServiceUtil.updateFragmentEntryLink(link)
    }

    out.println("OK " + fragmentKey + ": 1 FragmentEntry + " + myLinks.size() + " FragmentEntryLinks")
}

fragments.each { deployFragment(it) }

out.println("")
out.println("Done. Reload the affected pages to see changes.")
