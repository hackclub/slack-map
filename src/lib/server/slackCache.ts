import { env } from '$env/dynamic/private';
import type { SlackChannel } from '../slack.js';

/**
 * Process-wide cache for the workspace channel list.
 *
 * The Slack call takes a second or two, which is what used to leave every
 * visitor staring at "No channels yet". Two things fix that: the page loads this
 * on the server so the HTML already contains the channels, and this cache means
 * only the first request after a restart actually waits for Slack.
 *
 * Under adapter-node the module lives as long as the server process, so the
 * cache is shared across requests. It is intentionally in-memory: the data is
 * small, public to the workspace, and cheap to rebuild.
 */

// A full crawl takes ~15-20s, so it must not re-run every few minutes.
const FRESH_MS = 30 * 60 * 1000;
// Past FRESH_MS the cached list is still served immediately while a refresh runs
// in the background, so a visitor never pays for the revalidation.
const STALE_MS = 60 * 60 * 1000;

// ~200 channels per page. Hack Club has 5000+, so this is a deliberate ceiling
// on crawl time rather than a guess at the workspace size. Each page costs one
// Tier 2 call, and the map only renders a few hundred chips anyway, so crawling
// the whole workspace would spend the rate-limit budget for no visible gain.
const MAX_PAGES = 8;
// Tier 2 allows roughly 20 requests/minute; pacing avoids tripping it at all.
const PAGE_DELAY_MS = 1200;

type Entry = { channels: SlackChannel[]; at: number };

let entry: Entry | null = null;
// Dedupes concurrent misses so a cold start does not fire N identical calls.
let inFlight: Promise<SlackChannel[]> | null = null;

async function fetchFromSlack(): Promise<SlackChannel[]> {
	const token = env.SLACK_BOT_TOKEN;
	if (!token) throw new Error('Missing Slack token');

	const all: SlackChannel[] = [];
	let cursor = '';
	let pages = 0;

	// conversations.list is paginated and returns ~200 per page. Reading only the
	// first page silently truncated the workspace to 24 channels.
	do {
		const url =
			'https://slack.com/api/conversations.list' +
			'?exclude_archived=true&types=public_channel,private_channel&limit=200' +
			(cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');

		const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

		// conversations.list is Tier 2 (~20 req/min). A burst of pages trips it, and
		// Slack answers 429 with Retry-After. Wait it out once, then give up on the
		// remaining pages rather than failing the whole load.
		if (response.status === 429) {
			const wait = Number(response.headers.get('retry-after') ?? '5');
			console.warn(`[slack] rate limited, waiting ${wait}s (page ${pages + 1})`);
			await new Promise((resolve) => setTimeout(resolve, Math.min(wait, 30) * 1000));

			const retry = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
			const retryData = await retry.json();
			if (!retry.ok || !retryData.ok) break;

			all.push(...((retryData.channels ?? []) as SlackChannel[]));
			cursor = retryData.response_metadata?.next_cursor ?? '';
			pages++;
			continue;
		}

		const data = await response.json();

		if (!data.ok) {
			// Partial results beat none: keep whatever pages already succeeded.
			if (all.length) {
				console.warn(`[slack] stopped after ${pages} page(s): ${data.error}`);
				break;
			}
			throw new Error(data.error ?? 'Slack request failed');
		}

		all.push(...((data.channels ?? []) as SlackChannel[]));
		cursor = data.response_metadata?.next_cursor ?? '';
		pages++;

		// Stay under the tier limit rather than sprinting into a 429.
		if (cursor && pages < MAX_PAGES) {
			await new Promise((resolve) => setTimeout(resolve, PAGE_DELAY_MS));
		}
	} while (cursor && pages < MAX_PAGES);

	// Rare by design — if this logs on every page view, the cache is not working.
	console.log(`[slack] fetched ${all.length} channels across ${pages} page(s)`);

	// Busiest first, so the per-island cap keeps the channels people care about.
	return all.sort((a, b) => (b.num_members ?? 0) - (a.num_members ?? 0));
}

function refresh(): Promise<SlackChannel[]> {
	inFlight ??= fetchFromSlack()
		.then((channels) => {
			entry = { channels, at: Date.now() };
			return channels;
		})
		.finally(() => {
			inFlight = null;
		});

	return inFlight;
}

export type ChannelsResult = {
	channels: SlackChannel[];
	/** 'fresh' | 'stale' | 'miss' — surfaced for cache headers and debugging. */
	state: 'fresh' | 'stale' | 'miss';
	error?: string;
};

export async function getChannels(): Promise<ChannelsResult> {
	const age = entry ? Date.now() - entry.at : Infinity;

	if (entry && age < FRESH_MS) {
		return { channels: entry.channels, state: 'fresh' };
	}

	if (entry && age < STALE_MS) {
		// Serve what we have now; refresh without making this request wait.
		void refresh().catch((error) => console.warn('channel refresh failed:', error));
		return { channels: entry.channels, state: 'stale' };
	}

	try {
		return { channels: await refresh(), state: 'miss' };
	} catch (error) {
		// A hard failure with an expired cache still beats an empty map.
		if (entry) {
			return {
				channels: entry.channels,
				state: 'stale',
				error: error instanceof Error ? error.message : 'Slack request failed'
			};
		}
		throw error;
	}
}

/** Drops the cache so the next read refetches — used by the manual retry path. */
export function invalidateChannels() {
	entry = null;
}
