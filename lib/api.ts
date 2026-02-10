/**
 * X API wrapper -- search, threads, profiles, single tweets.
 * Uses Bird CLI for free X search (preferred) or Composio as fallback.
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { execSync } from "child_process";

const CACHE_DIR = join(dirname(process.cwd()), "data", "cache");

// Ensure cache directory exists
if (!existsSync(CACHE_DIR)) {
  mkdirSync(CACHE_DIR, { recursive: true });
}

// Check if Bird CLI is available
function birdAvailable(): boolean {
  try {
    execSync("which bird", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// Get Composio key (fallback)
function getComposioKey(): string {
  if (process.env.COMPOSIO_API_KEY) return process.env.COMPOSIO_API_KEY;
  try {
    const envFile = readFileSync("/root/.openclaw/.env", "utf-8");
    const match = envFile.match(/COMPOSIO_API_KEY=["']?([^"'\n]+)/);
    if (match) return match[1];
  } catch {}
  return "";
}

// Get connection ID from env
function getConnectionId(): string {
  return process.env.COMPOSIO_CONNECTION_ID || "";
}

// Get app name
function getAppName(): string {
  return process.env.COMPOSIO_APP_NAME || "TWITTER";
}

// Get entity ID
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

// --- Bird CLI Integration ---

interface BirdTweet {
  id: string;
  text: string;
  author: {
    id: string;
    username: string;
    name: string;
  };
  created_at: string;
  metrics: {
    likes: number;
    retweets: number;
    replies: number;
    quotes: number;
    impressions: number;
  };
  urls: string[];
  mentions: string[];
  hashtags: string[];
}

function parseBirdTweet(t: BirdTweet): Tweet {
  return {
    id: t.id,
    text: t.text,
    author_id: t.author.id,
    username: t.author.username,
    name: t.author.name,
    created_at: t.created_at,
    conversation_id: t.id,
    metrics: {
      likes: t.metrics.likes || 0,
      retweets: t.metrics.retweets || 0,
      replies: t.metrics.replies || 0,
      quotes: t.metrics.quotes || 0,
      impressions: t.metrics.impressions || 0,
      bookmarks: 0,
    },
    urls: t.urls || [],
    mentions: t.mentions || [],
    hashtags: t.hashtags || [],
    tweet_url: `https://x.com/${t.author.username}/status/${t.id}`,
  };
}

async function birdSearch(query: string, opts: { limit?: number; sort?: string; since?: string } = {}): Promise<Tweet[]> {
  const limit = opts.limit || 100;
  const sort = opts.sort || "top"; // top, recent, likes
  
  let cmd = `bird search "${query.replace(/"/g, '\\"')}" --limit ${limit}`;
  
  if (opts.sort === "recent") {
    cmd += " --recent";
  } else if (opts.sort === "likes") {
    cmd += " --top";
  }
  
  if (opts.since) {
    const sinceMatch = opts.since.match(/^(\d+)([mhd])$/);
    if (sinceMatch) {
      const num = sinceMatch[1];
      const unit = sinceMatch[2];
      cmd += ` --since ${num}${unit}`;
    }
  }
  
  cmd += " --json";
  
  try {
    const output = execSync(cmd, { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 });
    const tweets: BirdTweet[] = JSON.parse(output);
    return tweets.map(parseBirdTweet);
  } catch (e: any) {
    throw new Error(`Bird CLI search failed: ${e.message}`);
  }
}

async function birdThread(tweetId: string): Promise<Tweet[]> {
  try {
    const output = execSync(`bird thread ${tweetId} --json`, { encoding: "utf-8", maxBuffer: 5 * 1024 * 1024 });
    const tweets: BirdTweet[] = JSON.parse(output);
    return tweets.map(parseBirdTweet);
  } catch (e: any) {
    throw new Error(`Bird CLI thread failed: ${e.message}`);
  }
}

async function birdProfile(username: string, opts: { count?: number } = {}): Promise<{ user: any; tweets: Tweet[] }> {
  const count = opts.count || 20;
  try {
    const output = execSync(`bird profile ${username} --count ${count} --json`, { encoding: "utf-8", maxBuffer: 5 * 1024 * 1024 });
    const data = JSON.parse(output);
    return {
      user: {
        username: data.username,
        name: data.name,
        description: data.description,
        followers: data.followers,
      },
      tweets: data.tweets?.map(parseBirdTweet) || [],
    };
  } catch (e: any) {
    throw new Error(`Bird CLI profile failed: ${e.message}`);
  }
}

async function birdTweet(tweetId: string): Promise<Tweet | null> {
  try {
    const output = execSync(`bird tweet ${tweetId} --json`, { encoding: "utf-8" });
    const t: BirdTweet = JSON.parse(output);
    return parseBirdTweet(t);
  } catch {
    return null;
  }
}

// --- Composio Fallback ---

interface TweetResponse {
  data?: any;
  includes?: { users?: any[] };
  meta?: { next_token?: string };
}

function parseTweet(t: any, users: Record<string, any> = {}): Tweet {
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
  
  const users: Record<string, any> = {};
  for (const u of response.includes?.users || []) {
    users[u.id] = u;
  }
  
  return tweets.map((t: any) => parseTweet(t, users));
}

async function composioExec(action: string, params: Record<string, any>): Promise<TweetResponse> {
  const key = getComposioKey();
  const connId = getConnectionId();
  const appName = getAppName();
  const entityId = getEntityId();
  
  const body: any = { input: params };
  if (connId) {
    body.connectedAccountId = connId;
  } else {
    body.appName = appName;
    if (entityId) body.entityId = entityId;
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
  
  const result = await res.json();
  return result.data as TweetResponse;
}

function parseSince(since: string): string | null {
  const match = since.match(/^(\d+)([mhd])$/);
  if (match) {
    const num = parseInt(match[1]);
    const unit = match[2];
    const ms = unit === "m" ? num * 60_000 : unit === "h" ? num * 3_600_000 : num * 86_400_000;
    return new Date(Date.now() - ms).toISOString();
  }
  return null;
}

async function composioSearch(
  query: string,
  opts: { maxResults?: number; pages?: number; sortOrder?: string; since?: string } = {}
): Promise<Tweet[]> {
  const maxResults = Math.max(opts.maxResults || 10, 10);
  const pages = opts.pages || 1;
  
  let allTweets: Tweet[] = [];
  let nextToken: string | undefined;
  
  for (let page = 0; page < pages; page++) {
    const params: Record<string, any> = {
      query,
      max_results: maxResults,
      sort_order: opts.sortOrder || "relevancy",
      tweet_fields: ["created_at", "public_metrics", "author_id", "conversation_id", "entities"],
      expansions: ["author_id"],
      user_fields: ["username", "name", "public_metrics", "description"],
    };
    
    if (opts.since) {
      const startTime = parseSince(opts.since);
      if (startTime) params.start_time = startTime;
    }
    
    if (nextToken) params.next_token = nextToken;
    
    const result = await composioExec("TWITTER_RECENT_SEARCH", params);
    const tweets = parseTweets(result);
    allTweets.push(...tweets);
    
    nextToken = result.meta?.next_token;
    if (!nextToken) break;
    if (page < pages - 1) await new Promise(r => setTimeout(r, 500));
  }
  
  return allTweets;
}

async function composioThread(conversationId: string, opts: { pages?: number } = {}): Promise<Tweet[]> {
  return composioSearch(`conversation_id:${conversationId}`, { pages: opts.pages || 2, sortOrder: "recency" });
}

async function composioProfile(username: string, opts: { count?: number; includeReplies?: boolean } = {}): Promise<{ user: any; tweets: Tweet[] }> {
  const replyFilter = opts.includeReplies ? "" : " -is:reply";
  const tweets = await composioSearch(`from:${username} -is:retweet${replyFilter}`, {
    maxResults: Math.min(opts.count || 20, 100),
    sortOrder: "recency",
  });
  
  const user = tweets.length > 0
    ? { username: tweets[0].username, name: tweets[0].name }
    : { username, name: username };
  
  return { user, tweets };
}

async function composioTweet(tweetId: string): Promise<Tweet | null> {
  const tweets = await composioSearch(tweetId, { maxResults: 10 });
  return tweets.find(t => t.id === tweetId) || tweets[0] || null;
}

// --- Unified API (Bird first, Composio fallback) ---

export async function search(
  query: string,
  opts: { maxResults?: number; pages?: number; sortOrder?: "relevancy" | "recency"; since?: string } = {}
): Promise<Tweet[]> {
  if (birdAvailable()) {
    try {
      return await birdSearch(query, {
        limit: opts.maxResults || 100,
        sort: opts.sortOrder === "recency" ? "recent" : "likes",
        since: opts.since,
      });
    } catch (e) {
      console.error(`Bird CLI failed, falling back to Composio: ${e}`);
    }
  }
  
  // Fallback to Composio
  const key = getComposioKey();
  if (!key) {
    throw new Error("Neither Bird CLI nor COMPOSIO_API_KEY available");
  }
  
  return composioSearch(query, opts);
}

export async function thread(conversationId: string, opts: { pages?: number } = {}): Promise<Tweet[]> {
  if (birdAvailable()) {
    try {
      return await birdThread(conversationId);
    } catch (e) {
      console.error(`Bird CLI failed, falling back to Composio: ${e}`);
    }
  }
  
  const key = getComposioKey();
  if (!key) {
    throw new Error("Neither Bird CLI nor COMPOSIO_API_KEY available");
  }
  
  return composioThread(conversationId, opts);
}

export async function profile(
  username: string,
  opts: { count?: number; includeReplies?: boolean } = {}
): Promise<{ user: any; tweets: Tweet[] }> {
  if (birdAvailable()) {
    try {
      return await birdProfile(username, { count: opts.count || 20 });
    } catch (e) {
      console.error(`Bird CLI failed, falling back to Composio: ${e}`);
    }
  }
  
  const key = getComposioKey();
  if (!key) {
    throw new Error("Neither Bird CLI nor COMPOSIO_API_KEY available");
  }
  
  return composioProfile(username, opts);
}

export async function getTweet(tweetId: string): Promise<Tweet | null> {
  if (birdAvailable()) {
    try {
      return await birdTweet(tweetId);
    } catch (e) {
      console.error(`Bird CLI failed, falling back to Composio: ${e}`);
    }
  }
  
  const key = getComposioKey();
  if (!key) {
    throw new Error("Neither Bird CLI nor COMPOSIO_API_KEY available");
  }
  
  return composioTweet(tweetId);
}

export function sortBy(
  tweets: Tweet[],
  metric: "likes" | "impressions" | "retweets" | "replies" = "likes"
): Tweet[] {
  return [...tweets].sort((a, b) => b.metrics[metric] - a.metrics[metric]);
}

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

export function dedupe(tweets: Tweet[]): Tweet[] {
  const seen = new Set<string>();
  return tweets.filter((t) => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });
}
