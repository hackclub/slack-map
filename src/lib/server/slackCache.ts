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

const FRESH_MS = 5 * 60 * 1000;
// Past FRESH_MS the cached list is still served immediately while a refresh runs
// in the background, so a visitor never pays for the revalidation.
const STALE_MS = 60 * 60 * 1000;

type Entry = { channels: SlackChannel[]; at: number };

let entry: Entry | null = null;
// Dedupes concurrent misses so a cold start does not fire N identical calls.
let inFlight: Promise<SlackChannel[]> | null = null;

async function fetchFromSlack(): Promise<SlackChannel[]> {
	const token = env.SLACK_BOT_TOKEN;
	if (!token) throw new Error('Missing Slack token');

	const response = await fetch(
		'https://slack.com/api/conversations.list?exclude_archived=true&types=public_channel,private_channel&limit=200',
		{ headers: { Authorization: `Bearer ${token}` } }
	);
	const data = await response.json();

	if (!data.ok) throw new Error(data.error ?? 'Slack request failed');

	// Rare by design — if this logs on every page view, the cache is not working.
	console.log(`[slack] fetched ${data.channels?.length ?? 0} channels`);
	return (data.channels ?? []) as SlackChannel[];
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
