import unittest
from unittest.mock import patch
import xml.etree.ElementTree as ET

import readme_contributions as feed


def pr(number=1):
    return {"number": number, "title": "Fix & test",
            "html_url": f"https://github.com/upstream/project/pull/{number}",
            "repository_url": "https://api.github.com/repos/upstream/project",
            "pull_request": {"merged_at": "2026-11-22T03:23:42Z"},
            "merged_at": "2026-11-22T03:23:42Z"}


def commit(sha="a"*40, message="Fix\n\nCo-authored-by: Agent-Yan <352840372+Agent-Yan@users.noreply.github.com>", repo="upstream/project", fork=False, login=None):
    return {"sha": sha, "repository": {"full_name": repo, "fork": fork,
                                      "private": False},
            "html_url": f"https://github.com/{repo}/commit/{sha}",
            "author": {"login": login} if login else None,
            "commit": {"message": message,
                       "committer": {"date": "2026-11-22T03:23:40Z"}}}


class ContributionTests(unittest.TestCase):
    def test_exact_coauthor(self):
        self.assertTrue(feed.credited(commit()))
        self.assertTrue(feed.coauthored("Fix\n\nCo-Authored-By: agent <352840372+AGENT-YAN@users.noreply.github.com>\nSigned-off-by: A <a@example.org>"))
        self.assertFalse(feed.coauthored("Fix\n\nCo-authored-by: Agent-Yan <somebody@example.org>"))
        self.assertFalse(feed.coauthored("Fix\n\nCo-authored-by: Agent-Yan <352840372+Agent-Yan@users.noreply.github.com>\n\nExample only"))
        self.assertFalse(feed.credited(commit(message="Agent-Yan mentioned")))

    def test_collect_and_deduplicate(self):
        first = commit()
        standalone = commit(sha="b"*40, message="Direct commit", login="Agent-Yan")
        unrelated = commit(sha="c"*40, message="Mention Agent-Yan")
        fork = commit(sha="d"*40, fork=True)
        own = commit(sha="e"*40, repo="Master-Norna/yan")

        def search(kind, query, date_field):
            if kind == "issues":
                return [pr(1)]
            return [first, standalone, unrelated, fork, own]

        def associated(repo, sha):
            return [pr(1), pr(2)] if sha == first["sha"] else []

        with patch.object(feed, "search", side_effect=search), \
                patch.object(feed, "associated_pulls", side_effect=associated) as pulls:
            rows = feed.collect()
        self.assertEqual(pulls.call_count, 2)
        self.assertEqual({feed.reference(p) for p in rows}, {"#1", "#2", "bbbbbbb"})
        self.assertEqual(len(rows), 3)
        svg = feed.render_svg(rows)
        ET.fromstring(svg)
        self.assertIn("bbbbbbb", svg)
        self.assertIn("Fix &amp; test", svg)
        self.assertIn("bbbbbbb", feed.render_index(rows))

    def test_manual_include_and_exclude(self):
        item = pr(2)
        item["base"] = {"repo": {"full_name": "upstream/project", "private": False}}
        found = {pr(1)["html_url"]: feed.pr_row(pr(1), "upstream/project")}
        overrides = {"include": [item["html_url"]], "exclude": [pr(1)["html_url"]]}
        with patch.object(feed, "api", return_value=item):
            feed.apply_overrides(found, overrides)
            feed.apply_overrides(found, overrides)
        self.assertEqual(list(found), [item["html_url"]])
        with self.assertRaises(ValueError):
            feed.apply_overrides(found, {"include": ["https://example.org/pull/1"], "exclude": []})

    def test_three_horizontal_lanes(self):
        rows = [feed.pr_row(pr(i), "upstream/project") for i in range(1, 7)]
        svg = feed.render_svg(rows)
        ET.fromstring(svg)
        self.assertIn('viewBox="0 0 850 326"', svg)
        self.assertIn('id="strip2"', svg)
        self.assertEqual(svg.count("<animateTransform"), 3)

    def test_search_splits_cap_and_paginates(self):
        calls = []

        def api(path, **kwargs):
            calls.append(kwargs)
            if len(calls) == 1:
                return {"total_count": 1001, "items": []}
            if len(calls) == 2:
                return {"total_count": 101, "items": [{"id": 1}]}
            if len(calls) == 3:
                return {"total_count": 101, "items": [{"id": 2}]}
            return {"total_count": 1, "items": [{"id": 3}]}

        with patch.object(feed, "api", side_effect=api):
            rows = list(feed.search("commits", "author:Agent-Yan", "committer-date"))
        self.assertEqual({p["id"] for p in rows}, {1, 2, 3})
        self.assertEqual(calls[2]["page"], 2)

    def test_search_incomplete(self):
        with patch.object(feed, "api", return_value={"incomplete_results": True}):
            with self.assertRaises(RuntimeError):
                list(feed.search("commits", "author:Agent-Yan", "committer-date"))


if __name__ == "__main__":
    unittest.main()
