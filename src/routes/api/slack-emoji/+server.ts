import { env } from '$env/dynamic/private';
import type { RequestHandler } from '@sveltejs/kit';

type EmojiMap = Record<string, string>;

// The list is workspace-wide and changes rarely, so it is cached in memory
// rather than re-fetched for every visitor.
let cache: { map: EmojiMap; at: number; note: string } | null = null;
const TTL_MS = 60 * 60 * 1000;

/**
 * Slack returns aliases as `alias:other-name`. Follow them to a real URL, with a
 * hop limit so a circular alias cannot spin forever.
 */
function resolveAliases(raw: EmojiMap): EmojiMap {
	const out: EmojiMap = {};

	for (const [name, value] of Object.entries(raw)) {
		let current = value;
		let hops = 0;

		while (typeof current === 'string' && current.startsWith('alias:') && hops < 8) {
			current = raw[current.slice('alias:'.length)];
			hops++;
		}

		if (typeof current === 'string' && current.startsWith('http')) out[name] = current;
	}

	return out;
}

export const GET: RequestHandler = async () => {
	const token = env.SLACK_BOT_TOKEN;

	const respond = (map: EmojiMap, note: string, cacheable: boolean) => {
		if (cacheable) cache = { map, at: Date.now(), note };
		return new Response(JSON.stringify({ emoji: map, note }), {
			status: 200,
			headers: { 'content-type': 'application/json' }
		});
	};

	// Custom emoji are a progressive enhancement: without them the page still
	// renders every standard Unicode emoji, so a failure here is never fatal.
	if (!token) return respond({}, 'no token', false);

	if (cache && Date.now() - cache.at < TTL_MS) {
		return respond(cache.map, cache.note, false);
	}

	try {
		const response = await fetch('https://slack.com/api/emoji.list', {
			headers: { Authorization: `Bearer ${token}` }
		});
		const data = await response.json();

		if (!data.ok) {
			// missing_scope is the expected case until `emoji:read` is granted.
			const note =
				data.error === 'missing_scope'
					? 'custom emoji need the emoji:read scope on the Slack app'
					: `slack: ${data.error}`;
			console.warn('emoji.list unavailable —', note);
			return respond({}, note, true);
		}

		const map = resolveAliases(data.emoji ?? {});
		return respond(map, `${Object.keys(map).length} custom emoji`, true);
	} catch (error) {
		console.error('emoji.list fetch failed:', error);
		return respond({}, 'fetch failed', false);
	}
};
