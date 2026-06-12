# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.0] - 2026-06-12

### Added

- **Team win probability**: a bar above the lobby teams estimates each team's
  chance to win. Player skill is a recency-weighted average of the ETF2L
  `skill_contrib` of divisions played in official seasons (a match's weight
  halves every ~18 months, long-inactive achievements fade towards the
  newcomer level); players without ETF2L history count as newcomers. Team
  averages are compared with a logistic (Elo-style) curve.
- The win probability can be disabled either with the toggle on the lobby page
  or on the new extension options page; the setting syncs via
  `chrome.storage.sync`. Division badges are always shown.

## [0.4.0] - 2026-06-12

### Changed

- The career-best division is now computed from the player's **full ETF2L
  match history** (all pages of `/player/{id}/results`) in addition to their
  current teams. Previously only current teams counted, so the badge
  disappeared as soon as a player left the team that earned it.
- If the player's current teams already include a Premiership entry, the match
  history is skipped entirely — nothing can beat tier 0.
- Cache TTL raised from 6 to 24 hours to offset the extra API traffic; cached
  results from previous versions are invalidated.
- API requests are gentler (lower concurrency, larger spacing) and HTTP 429
  responses are retried automatically after the `Retry-After` pause instead of
  failing the lookup.

## [0.3.1] - 2026-06-12

### Fixed

- The **Fresh** division (newcomer bracket introduced in 6v6 Season 52) now has
  a proper badge color; previously it was shown as an unstyled badge.

## [0.3.0] - 2026-06-11

### Changed

- The badge now shows the player's highest ETF2L division across **all game
  modes**: a 6v6 lobby and a Highlander lobby show the same badge for the same
  player. Previously the badge was filtered by the lobby's game mode.
- Only official league seasons (6v6 Season, Highlander Season, ...) are counted
  towards the badge. Cups (Fun Cup, 1 Day Cup, ...) are ignored: they often run
  with mixed-level teams and inflated the badge.
- Lobby game-mode detection was removed entirely — it is no longer needed.
- Cached results from previous versions are invalidated and cleaned up on
  update.

## [0.2.0] - 2026-06-11

### Changed

- The badge now shows the player's **career-best** ETF2L division (the highest
  tier they ever played in), preferring the lobby's game mode (6v6 / Highlander)
  and official seasons over cups.
- Player data now comes from the ETF2L `/player/{steamid64}` endpoint (teams
  with per-competition divisions and numeric tiers) instead of parsing the last
  20 match results. Division selection is based on the numeric `tier` field
  rather than string heuristics.

### Added

- Support for the **High** division, plus badge colors for Division 3 and
  Division 4.
- Badges survive TF2Center page re-renders: the lobby page (Apache Wicket)
  replaces DOM chunks over WebSocket, wiping injected elements — badges are now
  restored automatically without extra API requests.
- Automatic retry 30 seconds after a failed lookup.
- ETF2L API rate limiting (HTTP 429) is respected: requests pause according to
  the `Retry-After` header.
- Expired cache entries are pruned on every service worker startup (previously
  the cache only ever grew).

### Fixed

- The game-mode filter never matched 6v6 seasons (it searched competition
  *names*, which often don't contain the mode, e.g. "Season 33: Top Tiers"); a
  6v6 lobby could show a player's Highlander division and vice versa.
- API errors were cached for 6 hours as "no division"; errors are no longer
  cached at all.
- A failed lookup used to leave blank badges with no retry until the lobby
  roster changed.
- The badge could attach to the wrong link when a player is linked outside
  their slot (e.g. the lobby leader in the "Leader" options row); slot links
  now take priority.
- Lobby mode detection could be flipped by chat messages mentioning a mode; the
  mode is now read from the lobby header (`.lobbyHeaderInfo h1`).
- Chat activity no longer re-triggers DOM scans (mutations from the chat and
  from the extension's own badges are ignored).
- Removed duplicate variable declarations in the content script and the unused
  `"type": "module"` in the manifest; the background worker no longer holds the
  message channel open for unrelated messages.

## [0.1.0]

- Initial release: ETF2L division badges on TF2Center lobby pages, based on the
  `/player/{id}/results` endpoint, with local caching.
