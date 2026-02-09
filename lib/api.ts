/**
 * X API wrapper via Composio -- search, threads, profiles, single tweets.
 * Uses Composio SDK for Twitter API access.
 * Zero API cost via Composio free tier.
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";

const CACHE_DIR = join(dirname(process.cwd()), "data", "cache");
const WATCHLIST_FILE = join(dirname(process.cwd()), "data", "watchlist.json");

// Ensure cache directory exists
if (!existsSync(CACHE_DIR)) {
  mkdirSync(CACHE_DIR, { recursive: true });
}

function getComposioKey(): string {
  if (process.env.COMPOSIO_API_KEY) return process.env.COMPOSIO_API_KEY;
  
  // Try .openclaw/.env
  try {
    const envFile = readFileSync("/root/.openclaw/.env", "utf-8");
    const match = envFile.match(/COMPOSIO_API_KEY=["']?([^"'\n]+)/);
    if (match) return match[1];
  } catch {}
  
  throw new Error("COMPOSIO_API_KEY not found. Set COMPOSIO_API_KEY in your shell or ~/.openclaw/.env");
}

// Get connection ID from env or use default
function getConnectionId(): string {
  return process.env.COMPOSIO_CONNECTION_ID || "";
}

// Get app/toolkit name (e.g., TWITTER)
function getAppName(): string {
  return process.env.COMPOSIO_APP_NAME || "TWITTER";
}

// Get entity/user ID for the API
function getEntityId(): string {
  return process.env.COMPOSIO_USER_ID || "";
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

interface ComposioResponse {
  data?: any;
  success?: boolean;
  error?: string;
}

interface TwitterUser {
  id: string;
  username: string;
  name: string;
  description?: string;
  public_metrics?: {
    followers_count: number;
    following_count: number;
    tweet_count: number;
  };
}

interface TweetResponse {
  data?: any;
  includes?: { users?: TwitterUser[] };
  meta?: { next_token?: string; result_count?: number };
}

function parseTweet(t: any, users: Record<string, TwitterUser> = {}): Tweet {
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
    urls: (t.entities?.urls || []).map((u: any) => u.expanded_url).filter(Boolean),
    mentions: (t.entities?.mentions || []).map((m: any) => m.username).filter(Boolean),
    hashtags: (t.entities?.hashtags || []).map((h: any) => h.tag).filter(Boolean),
    tweet_url: `https://x.com/${u.username || "?"}/status/${t.id}`,
  };
}

function parseTweets(response: TweetResponse): Tweet[] {
  const tweets = response.data || [];
  if (!Array.isArray(tweets) || tweets.length === 0) return [];
  
  const users: Record<string, TwitterUser> = {};
  for (const u of response.includes?.users || []) {
    users[u.id] = u;
  }
  
  return tweets.map((t: any) => parseTweet(t, users));
}

/**
 * Execute a Composio Twitter action using the v2 API format.
 */
async function composioExec(action: string, params: Record<string, any>): Promise<TweetResponse> {
  const key = getComposioKey();
  const connId = getConnectionId();
  const appName = getAppName();
  const entityId = getEntityId();
  
  const body: any = {
    input: params,
  };
  
  // Use connected account ID if available, otherwise use app name + entity ID
  if (connId) {
    body.connectedAccountId = connId;
  } else {
    body.appName = appName;
    if (entityId) {
      body.entityId = entityId;
    }
  }
  
  const res = await fetch("https://backend.composio.dev/api/v2/actions/" + action + "/execute", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Composio ${res.status}: ${errorText.slice(0, 300)}`);
  }
  
  const result = await res.json() as ComposioResponse;
  
  if (!result.success && result.error) {
    throw new Error(`Composio error: ${result.error}`);
  }
  
  return result.data as TweetResponse;
}

/**
 * Parse a "since" value into an ISO 8601 timestamp.
 */
function parseSince(since: string): string | null {
  const match = since.match(/^(\d+)(m|h|d)$/);
  if (match) {
    const num = parseInt(match[1]);
    const unit = match[2];
    const ms = unit === "m" ? num * 60_000 : unit === "h" ? num * 3_600_000 : num * 86_400_000;
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
  // Composio requires max_results >= 10
  const maxResults = Math.max(opts.maxResults || 10, 10);
  const pages = opts.pages || 1;
  const sort = opts.sortOrder || "relevancy";
  
  let allTweets: Tweet[] = [];
  let nextToken: string | undefined;
  
  for (let page = 0; page < pages; page++) {
    const params: Record<string, any> = {
      query,
      max_results: maxResults,
      sort_order: sort,
      tweet_fields: ["created_at", "public_metrics", "author_id", "conversation_id", "entities"],
      expansions: ["author_id"],
      user_fields: ["username", "name", "public_metrics", "description"],
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
    nextToken = result.meta?.next_token;
    if (!nextToken) break;
    if (page < pages - 1) await new Promise(r => setTimeout(r, 500));
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
  return search(query, { pages: opts.pages || 2, sortOrder: "recency" });
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
  
  const user = tweets.length > 0
    ? { username: tweets[0].username, name: tweets[0].name }
    : { username, name: username };
  
  return { user, tweets };
}

/**
 * Fetch a single tweet by ID.
 */
export async function getTweet(tweetId: string): Promise<Tweet | null> {
  const tweets = await search(tweetId, { maxResults: 10 });
  return tweets.find(t => t.id === tweetId) || tweets[0] || null;
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

/**
 * Get watchlist.
 */
export function getWatchlist(): { username: string; note?: string }[] {
  try {
    const data = JSON.parse(readFileSync(WATCHLIST_FILE, "utf-8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/**
 * Save watchlist.
 */
export function saveWatchlist(watchlist: { username: string; note?: string }[]): void {
  writeFileSync(WATCHLIST_FILE, JSON.stringify(watchlist, null, 2));
}
