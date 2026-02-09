/**
 * X API wrapper via Composio -- search, threads, profiles, single tweets.
 * Uses Composio TWITTER_RECENT_SEARCH instead of direct X API bearer token.
 * Zero API cost, same data format.
 */

import { readFileSync } from "fs";

const COMPOSIO_BASE = "https://backend.composio.dev/api";
const RATE_DELAY_MS = 500; // be nice to Composio

function getComposioKey(): string {
  if (process.env.COMPOSIO_API_KEY) return process.env.COMPOSIO_API_KEY;

  // Try .openclaw/.env
  try {
    const envFile = readFileSync("/root/.openclaw/.env", "utf-8");
    const match = envFile.match(/COMPOSIO_API_KEY=["']?([^"'\n]+)/);
    if (match) return match[1];
  } catch {}

  throw new Error("COMPOSIO_API_KEY not found in env or /root/.openclaw/.env");
}

// Ben's main account connection (default entity)
function getConnectionId(): string {
  return process.env.COMPOSIO_CONNECTION_ID || "1fc9b642-233c-41c0-b754-3879b85ec0bb";
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export interface Tweet {
  id: string;
  text: string;
  author_id: string;
  username: string;
  name: string;
  created_at: string;
  conversation_id: string;
  metrics: {
    likes: number;
    retweets: number;
    replies: number;
    quotes: number;
    impressions: number;
    bookmarks: number;
  };
  urls: string[];
  mentions: string[];
  hashtags: string[];
  tweet_url: string;
}

interface ComposioResult {
  data?: {
    data?: any[];
    includes?: { users?: any[] };
    meta?: { next_token?: string; result_count?: number };
  };
  successful?: boolean;
  error?: string;
}

function parseTweets(raw: any): Tweet[] {
  const data = raw?.data || raw;
  const tweets = Array.isArray(data) ? data : data?.data || [];
  if (!Array.isArray(tweets) || tweets.length === 0) return [];

  // Build user lookup from includes
  const users: Record<string, any> = {};
  const includes = raw?.includes || raw?.data?.includes || {};
  for (const u of includes?.users || []) {
    users[u.id] = u;
  }

  return tweets.map((t: any) => {
    const u = users[t.author_id] || {};
    const m = t.public_metrics || {};
    return {
      id: t.id,
      text: t.text,
      author_id: t.author_id,
      username: u.username || "?",
      name: u.name || "?",
      created_at: t.created_at,
      conversation_id: t.conversation_id || t.id,
      metrics: {
        likes: m.like_count || 0,
        retweets: m.retweet_count || 0,
        replies: m.reply_count || 0,
        quotes: m.quote_count || 0,
        impressions: m.impression_count || 0,
        bookmarks: m.bookmark_count || 0,
      },
      urls: (t.entities?.urls || [])
        .map((u: any) => u.expanded_url)
        .filter(Boolean),
      mentions: (t.entities?.mentions || [])
        .map((m: any) => m.username)
        .filter(Boolean),
      hashtags: (t.entities?.hashtags || [])
        .map((h: any) => h.tag)
        .filter(Boolean),
      tweet_url: `https://x.com/${u.username || "?"}/status/${t.id}`,
    };
  });
}

/**
 * Execute a Composio Twitter action.
 */
async function composioExec(action: string, params: Record<string, any>): Promise<any> {
  const key = getComposioKey();
  const connId = getConnectionId();

  const res = await fetch(`${COMPOSIO_BASE}/v2/actions/${action}/execute`, {
    method: "POST",
    headers: {
      "x-api-key": key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      connectedAccountId: connId,
      input: params,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Composio ${res.status}: ${body.slice(0, 200)}`);
  }

  const result = await res.json() as ComposioResult;
  if (result.error) {
    throw new Error(`Composio error: ${result.error}`);
  }

  return result.data || result;
}

/**
 * Parse a "since" value into an ISO 8601 timestamp.
 */
function parseSince(since: string): string | null {
  const match = since.match(/^(\d+)(m|h|d)$/);
  if (match) {
    const num = parseInt(match[1]);
    const unit = match[2];
    const ms =
      unit === "m" ? num * 60_000 :
      unit === "h" ? num * 3_600_000 :
      num * 86_400_000;
    return new Date(Date.now() - ms).toISOString();
  }

  if (since.includes("T") || since.includes("-")) {
    try {
      return new Date(since).toISOString();
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Search recent tweets (last 7 days) via Composio.
 */
export async function search(
  query: string,
  opts: {
    maxResults?: number;
    pages?: number;
    sortOrder?: "relevancy" | "recency";
    since?: string;
  } = {}
): Promise<Tweet[]> {
  const maxResults = Math.max(Math.min(opts.maxResults || 100, 100), 10);
  const pages = opts.pages || 1;
  const sort = opts.sortOrder || "relevancy";

  let allTweets: Tweet[] = [];
  let nextToken: string | undefined;

  for (let page = 0; page < pages; page++) {
    const params: Record<string, any> = {
      query,
      max_results: maxResults,
      sort_order: sort,
      tweet__fields: ["created_at", "public_metrics", "author_id", "conversation_id", "entities"],
      expansions: ["author_id"],
      user__fields: ["username", "name", "public_metrics", "description"],
    };

    if (opts.since) {
      const startTime = parseSince(opts.since);
      if (startTime) params.start_time = startTime;
    }

    if (nextToken) {
      params.next_token = nextToken;
    }

    const result = await composioExec("TWITTER_RECENT_SEARCH", params);
    const tweets = parseTweets(result);
    allTweets.push(...tweets);

    // Check for pagination
    nextToken = result?.meta?.next_token || result?.data?.meta?.next_token;
    if (!nextToken) break;
    if (page < pages - 1) await sleep(RATE_DELAY_MS);
  }

  return allTweets;
}

/**
 * Fetch a full conversation thread by root tweet ID.
 */
export async function thread(
  conversationId: string,
  opts: { pages?: number } = {}
): Promise<Tweet[]> {
  const query = `conversation_id:${conversationId}`;
  const tweets = await search(query, {
    pages: opts.pages || 2,
    sortOrder: "recency",
  });
  return tweets;
}

/**
 * Get recent tweets from a specific user.
 */
export async function profile(
  username: string,
  opts: { count?: number; includeReplies?: boolean } = {}
): Promise<{ user: any; tweets: Tweet[] }> {
  const replyFilter = opts.includeReplies ? "" : " -is:reply";
  const query = `from:${username} -is:retweet${replyFilter}`;
  const tweets = await search(query, {
    maxResults: Math.min(opts.count || 20, 100),
    sortOrder: "recency",
  });

  // Extract user info from first tweet if available
  const user = tweets.length > 0
    ? { username: tweets[0].username, name: tweets[0].name }
    : { username, name: username };

  return { user, tweets };
}

/**
 * Fetch a single tweet by ID.
 * Uses search with the tweet ID as a workaround since Composio
 * may not expose the single tweet lookup endpoint.
 */
export async function getTweet(tweetId: string): Promise<Tweet | null> {
  // Search for the specific tweet by conversation_id or url
  const tweets = await search(tweetId, { maxResults: 10 });
  return tweets.find(t => t.id === tweetId) || tweets[0] || null;
}

/**
 * Look up a user by username via Composio.
 */
export async function userLookup(username: string): Promise<any> {
  try {
    const result = await composioExec("TWITTER_USER_LOOKUP_ME", {});
    return result;
  } catch {
    // Fallback: search for user's tweets and extract info
    const { user } = await profile(username, { count: 1 });
    return user;
  }
}

/**
 * Sort tweets by engagement metric.
 */
export function sortBy(
  tweets: Tweet[],
  metric: "likes" | "impressions" | "retweets" | "replies" = "likes"
): Tweet[] {
  return [...tweets].sort((a, b) => b.metrics[metric] - a.metrics[metric]);
}

/**
 * Filter tweets by minimum engagement.
 */
export function filterEngagement(
  tweets: Tweet[],
  opts: { minLikes?: number; minImpressions?: number }
): Tweet[] {
  return tweets.filter((t) => {
    if (opts.minLikes && t.metrics.likes < opts.minLikes) return false;
    if (opts.minImpressions && t.metrics.impressions < opts.minImpressions) return false;
    return true;
  });
}

/**
 * Deduplicate tweets by ID.
 */
export function dedupe(tweets: Tweet[]): Tweet[] {
  const seen = new Set<string>();
  return tweets.filter((t) => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });
}
