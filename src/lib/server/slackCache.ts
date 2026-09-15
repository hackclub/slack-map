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

// A full crawl now runs into minutes, so it must not re-run every few minutes.
const FRESH_MS = 30 * 60 * 1000;
// Past FRESH_MS the cached list is still served immediately while a refresh runs
// in the background, so a visitor never pays for the revalidation.
const STALE_MS = 60 * 60 * 1000;

// Slack caps `limit` at 200 but rarely fills a page — measured against this
// workspace the pages ran 10-154 channels, averaging ~48. Eight pages therefore
// bought only ~500 of 5000+ channels, which left every island except community
// nearly empty (software had 18 chips on a full-size island, nothing to scroll).
// The ceiling exists to bound the crawl, not to size the workspace, so it can be
// this high now that reaching it no longer makes anyone wait — see PRIME_PAGES.
const MAX_PAGES = 80;
// Pages to gather before the first request is answered. The rest of the crawl
// carries on in the background and swaps into the cache when it lands, so a cold
// start costs what it always did (~10s) instead of the ~2min a full crawl takes.
const PRIME_PAGES = 8;
// Tier 2 allows roughly 20 requests/minute. Only the prime pages are on the
// critical path, so they keep the old 50/min sprint to hold cold-start latency
// down; the background tail then drops to a compliant pace, because once the
// ceiling rose the sprint tripped 429s whose 30s Retry-After made the whole
// crawl slower than simply pacing it would have been. Pacing the prime pages
// too took the first load from 15s to 82s, which is why the two differ.
const PRIME_DELAY_MS = 1200;
// 3500ms is ~17/min, deliberately under the ceiling: the crawl is not the only
// caller, and a modal opening fires conversations.info against the same budget.
const PAGE_DELAY_MS = 3500;
// Consecutive 429s tolerated on one page before abandoning the rest. Each costs
// a Retry-After of up to 30s, which only background pages can afford to sit out.
const MAX_STALLS = 3;

type Entry = { channels: SlackChannel[]; at: number };

let entry: Entry | null = null;
// Dedupes concurrent misses so a cold start does not fire N identical calls.
let inFlight: Promise<SlackChannel[]> | null = null;

/** Busiest first, so the per-island cap keeps the channels people care about. */
const byMembers = (channels: SlackChannel[]) =>
	[...channels].sort((a, b) => (b.num_members ?? 0) - (a.num_members ?? 0));

/**
 * @param onPage called after each page once PRIME_PAGES are in, with everything
 * gathered so far. That both answers the waiting request and keeps publishing as
 * the crawl runs, so the map fills in progressively instead of staying at the
 * primed count for the couple of minutes the remaining pages take.
 */
async function fetchFromSlack(
	onPage?: (channels: SlackChannel[]) => void
): Promise<SlackChannel[]> {
	const token = env.SLACK_BOT_TOKEN;
	if (!token) throw new Error('Missing Slack token');

	const all: SlackChannel[] = [];
	let cursor = '';
	let pages = 0;
	// Consecutive 429s on the current page; reset by any page that succeeds.
	let stalls = 0;

	// Both the normal and the rate-limited path go through here, so a 429 can
	// neither skip priming nor stall the progressive updates behind it. Nothing
	// is published before PRIME_PAGES: a request landing mid-crawl reads the
	// cache directly, and a two-page map would be worse than waiting for eight.
	const publish = () => {
		if (pages >= PRIME_PAGES) onPage?.(byMembers(all));
	};

	// conversations.list is paginated and returns ~200 per page. Reading only the
	// first page silently truncated the workspace to 24 channels.
	do {
		const url =
			'https://slack.com/api/conversations.list' +
			'?exclude_archived=true&types=public_channel,private_channel&limit=200' +
			(cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');

		const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

		// conversations.list is Tier 2 and answers 429 with Retry-After. Waiting it
		// out once and giving up on the retry ended the crawl at page 29 of 80,
		// throwing away half the workspace over one unlucky pair of responses. The
		// cursor is untouched here, so a retry simply re-requests the same page.
		if (response.status === 429) {
			const wait = Number(response.headers.get('retry-after') ?? '5');
			if (++stalls > MAX_STALLS) {
				console.warn(`[slack] gave up at page ${pages + 1} after ${stalls} stalls`);
				break;
			}
			console.warn(`[slack] rate limited, waiting ${wait}s (page ${pages + 1})`);
			await new Promise((resolve) => setTimeout(resolve, Math.min(wait, 30) * 1000));
			continue;
		}

		// Consecutive stalls are what signal real trouble; an isolated one is
		// routine on a crawl this long and must not count against later pages.
		stalls = 0;

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
		publish();

		// Stay under the tier limit rather than sprinting into a 429.
		if (cursor && pages < MAX_PAGES) {
			const delay = pages < PRIME_PAGES ? PRIME_DELAY_MS : PAGE_DELAY_MS;
			await new Promise((resolve) => setTimeout(resolve, delay));
		}
	} while (cursor && pages < MAX_PAGES);

	// Rare by design — if this logs on every page view, the cache is not working.
	// The three endings are worth telling apart: a complete crawl needs nothing,
	// hitting the ceiling means raising MAX_PAGES would find more, and stopping
	// short of it means the workspace was cut off by errors or rate limits.
	const ending = !cursor
		? 'workspace complete'
		: pages >= MAX_PAGES
			? `stopped at the ${MAX_PAGES}-page ceiling, more remain`
			: 'stopped early, more remain';
	console.log(`[slack] fetched ${all.length} channels across ${pages} page(s) (${ending})`);

	return byMembers(all);
}

/**
 * Starts a crawl and resolves as soon as the map is drawable, not when the last
 * page lands. The remaining pages keep going and replace the cached list when
 * they finish, so the extra reach costs background time instead of page latency.
 *
 * `inFlight` is held for the whole crawl, not just until priming, so a second
 * caller arriving mid-crawl gets the already-primed list rather than kicking off
 * a duplicate walk of the workspace.
 */
function refresh(): Promise<SlackChannel[]> {
	if (inFlight) return inFlight;

	let ready: ((channels: SlackChannel[]) => void) | null = null;
	let fail: ((error: unknown) => void) | null = null;
	const primed = new Promise<SlackChannel[]>((resolve, reject) => {
		ready = resolve;
		fail = reject;
	});

	const settle = (channels: SlackChannel[]) => {
		entry = { channels, at: Date.now() };
		ready?.(channels);
		ready = fail = null;
	};

	void fetchFromSlack(settle)
		.then(settle)
		.catch((error) => {
			// Once something has been served, a failed tail is a log line rather
			// than a broken page — the primed channels are already on screen.
			if (!fail) {
				console.warn('[slack] crawl stopped early:', error);
				return;
			}
			fail(error);
			ready = fail = null;
		})
		.finally(() => {
			inFlight = null;
		});

	inFlight = primed;
	return primed;
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
