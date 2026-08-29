/**
 * Single source of truth for mapping a Slack channel name to a map zone.
 * Imported by both the map page and scripts/seed-channels.js, so the two
 * can never drift apart. Plain JS (not .ts) so the Node seed script can
 * import it without a TypeScript loader.
 *
 * @typedef {'community' | 'ysws' | 'connect' | 'software' | 'hardware'} ZoneKey
 */

/**
 * Patterns are tried in this order and the first zone to match wins, so the
 * more specific zones come before `community`, which acts as the fallback.
 *
 * A pattern containing a hyphen is matched against the whole channel name.
 * Any other pattern is matched against the name's individual tokens: either
 * an exact token match, or a substring match when the pattern is long enough
 * to be unambiguous. That token rule is what keeps `#mentorship` in `connect`
 * instead of letting the bare substring "ship" drag it into `ysws`.
 *
 * @type {Record<ZoneKey, string[]>}
 */
export const ZONE_PATTERNS = {
	software: [
		'code', 'coding', 'dev', 'devops', 'backend', 'frontend', 'fullstack',
		'api', 'git', 'github', 'web', 'mobile', 'program', 'programming',
		'software', 'linux', 'design', 'bug', 'terminal', 'vim', 'rust',
		'python', 'javascript', 'typescript', 'compiler', 'database'
	],
	hardware: [
		'hardware', 'package', 'pcb', 'circuit', 'solder', 'electronics',
		'embedded', 'robot', 'robotics', 'cad', 'laser', 'printer', 'printing',
		'maker', 'mechanical', 'sensor', 'arduino', 'raspberry'
	],
	ysws: [
		'ysws', 'ship', 'shipped', 'hackathon', 'hack-night', 'hack-club',
		'jam', 'arcade', 'workshop', 'submission', 'scrapyard', 'onboard'
	],
	connect: [
		'hq', 'mentor', 'mentorship', 'network', 'networking', 'connect',
		'career', 'jobs', 'advice', 'guidance', 'support', 'college', 'study',
		'school', 'scholarship', 'interview'
	],
	community: [
		'welcome', 'announcement', 'announcements', 'intro', 'introduction',
		'lounge', 'random', 'general', 'social', 'meme', 'spam', 'anime',
		'music', 'gaming', 'game', 'osu', 'sticker', 'orpheus', 'cult',
		'food', 'pets', 'photos', 'watercooler', 'offtopic'
	]
};

/** @type {ZoneKey} */
export const FALLBACK_ZONE = 'community';

/**
 * @param {string} name lowercased channel name
 * @param {string} pattern
 * @returns {boolean}
 */
function matchesPattern(name, pattern) {
	if (pattern.includes('-')) return name.includes(pattern);

	const tokens = name.split(/[^a-z0-9]+/).filter(Boolean);
	return tokens.some(
		(token) => token === pattern || (pattern.length >= 5 && token.includes(pattern))
	);
}

/**
 * Resolve the zone a channel belongs to from its name.
 *
 * @param {string} channelName
 * @returns {ZoneKey}
 */
export function zoneForChannelName(channelName) {
	const name = channelName.toLowerCase();

	for (const zone of /** @type {ZoneKey[]} */ (Object.keys(ZONE_PATTERNS))) {
		if (ZONE_PATTERNS[zone].some((pattern) => matchesPattern(name, pattern))) {
			return zone;
		}
	}

	return FALLBACK_ZONE;
}
