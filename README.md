# x-research (Composio Fork)

> **Fork of [rohunvora/x-research-skill](https://github.com/rohunvora/x-research-skill)** — adapted to use [Composio](https://composio.dev) instead of a direct X API bearer token. Same functionality, zero API cost.

X/Twitter research agent for [Claude Code](https://code.claude.com) and [OpenClaw](https://openclaw.ai). Search, filter, monitor -- all from the terminal.

## What changed in this fork

The original skill connects directly to the X API, which now uses **pay-per-use pricing** ($0.005 per tweet read). 20,000 reads = $100.

This fork routes everything through **Composio** instead. Composio's free tier gives you 20,000 API calls/month. Same data, same search, $0.

| | Original | This Fork |
|---|---|---|
| **API** | X API (direct) | Composio (free tier) |
| **Auth** | X Bearer Token | Composio API Key |
| **Cost** | ~$0.50/search page | $0 |
| **Rate limit** | X API limits | 20K calls/month free |
| **Data** | Same | Same |

## What it does

Wraps the X API (via Composio) into a fast CLI so your AI agent (or you) can search tweets, pull threads, monitor accounts, and get sourced research without writing curl commands.

- **Search** with engagement sorting, time filtering, noise removal
- **Watchlists** for monitoring accounts
- **Thread following** for full conversations
- **Profile analysis** for recent activity
- **Cache** (15-min TTL) to avoid redundant calls
- **Multiple output formats** -- Telegram, markdown, JSON

## Install

### Claude Code
```bash
mkdir -p .claude/skills
cd .claude/skills
git clone https://github.com/xBenJamminx/x-research-skill.git x-research
```

### OpenClaw
```bash
mkdir -p skills
cd skills
git clone https://github.com/xBenJamminx/x-research-skill.git x-research
```

## Setup

1. **Create a free Composio account** at [composio.dev](https://composio.dev)
2. **Grab your API key** from the dashboard
3. **Connect Twitter** through Composio (they handle the OAuth flow)
4. **Set the env var:**
   ```bash
   export COMPOSIO_API_KEY="your-key-here"
   ```
   Or save it to your `.env` file.
5. **Install Bun** (for CLI tooling): https://bun.sh

That's it. No X Developer Portal account needed. No bearer tokens. No prepaid credits.

## Usage

### Natural language (just talk to Claude)
- "What are people saying about Opus 4.6?"
- "Search X for OpenClaw skills"
- "Check what @frankdegods posted recently"
- "What's trending in AI agents?"

### CLI commands
```bash
cd skills/x-research

# Search (sorted by likes, auto-filters retweets)
bun run x-search.ts search "your query" --sort likes --limit 10

# Profile -- recent tweets from a user
bun run x-search.ts profile username

# Thread -- full conversation
bun run x-search.ts thread TWEET_ID

# Single tweet
bun run x-search.ts tweet TWEET_ID

# Watchlist
bun run x-search.ts watchlist add username "optional note"
bun run x-search.ts watchlist check

# Save research to file
bun run x-search.ts search "query" --save --markdown
```

### Search options
```
--sort likes|impressions|retweets|recent   (default: likes)
--since 1h|3h|12h|1d|7d     Time filter (default: last 7 days)
--min-likes N                Filter minimum likes
--min-impressions N          Filter minimum impressions
--pages N                    Pages to fetch, 1-5 (default: 1)
--limit N                    Results to display (default: 15)
--no-replies                 Exclude replies
--save                       Save to ~/clawd/drafts/
--json                       Raw JSON output
--markdown                   Markdown research doc
```

## Cost comparison

| Operation | X API (direct) | This fork (Composio) |
|-----------|---------------|---------------------|
| Search (1 page, 100 posts) | ~$0.50 | $0 |
| Deep research (3 pages) | ~$1.50 | $0 |
| Profile check | ~$0.51 | $0 |
| Watchlist (5 accounts) | ~$2.55 | $0 |
| Cached repeat | free | free |

Composio free tier: 20,000 calls/month. Paid tiers available if you outgrow it.

## File structure

```
x-research/
├── SKILL.md              # Agent instructions (Claude reads this)
├── x-search.ts           # CLI entry point
├── lib/
│   ├── api.ts            # Composio API wrapper (was X API direct)
│   ├── cache.ts          # File-based cache, 15min TTL
│   └── format.ts         # Telegram + markdown formatters
└── data/
    ├── watchlist.json     # Accounts to monitor
    └── cache/             # Auto-managed
```

## Key differences from the original

1. **`lib/api.ts`** -- Rewired to use `composioExec()` calling `TWITTER_RECENT_SEARCH` instead of direct X API bearer token auth
2. **No bearer token needed** -- Auth is handled through your Composio connection
3. **No cost tracking** -- Because there's nothing to track ($0)
4. **Same output** -- All formatters, cache, and CLI commands work identically

## Limitations

- Search covers last 7 days only (X API recent search endpoint)
- Read-only -- never posts or interacts
- Requires Composio account with Twitter connected
- `min_likes` / `min_retweets` search operators unavailable (filtered post-hoc)

## Credits

- Original skill: [rohunvora/x-research-skill](https://github.com/rohunvora/x-research-skill)
- Composio adaptation: [@xBenJamminx](https://x.com/xBenJamminx)
- Powered by [Composio](https://composio.dev) and [Claude Code](https://code.claude.com)

## License

MIT
