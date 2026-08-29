// `with { type: 'json' }` is required by this project's NodeNext module setting.
import unicodeMap from './emoji-unicode.json' with { type: 'json' };

/**
 * Slack writes emoji into topics and purposes as `:shortcode:`. Two kinds exist:
 *
 *  - standard Unicode emoji (`:thread:` -> 🧵), resolved from the bundled map,
 *    which is generated from iamcal/emoji-data — the same dataset Slack uses, so
 *    the shortcodes line up exactly;
 *  - custom workspace emoji (`:orpheus:`), which are images hosted by Slack and
 *    are frequently animated GIFs. Those need the `emoji:read` scope, so they are
 *    fetched separately and may simply be unavailable.
 */

const UNICODE: Record<string, string> = unicodeMap;

export type EmojiSegment =
	| { kind: 'text'; value: string }
	| { kind: 'image'; name: string; url: string };

// `:name:` where name is the shortcode charset Slack allows. The trailing colon
// may also open the next emoji, so matching is done with a global scan.
const SHORTCODE = /:([a-z0-9_+'-]+):/gi;

/**
 * Split text into plain runs and custom-emoji images. Unicode emoji are
 * substituted inline (they are just characters); custom ones become segments the
 * caller renders as <img>, which is what makes animated GIFs play.
 */
export function parseEmoji(
	input: string | undefined,
	custom: Record<string, string> = {}
): EmojiSegment[] {
	if (!input) return [];

	const segments: EmojiSegment[] = [];
	let buffer = '';
	let lastIndex = 0;
	let match: RegExpExecArray | null;

	SHORTCODE.lastIndex = 0;

	while ((match = SHORTCODE.exec(input))) {
		const name = match[1].toLowerCase();
		buffer += input.slice(lastIndex, match.index);
		lastIndex = match.index + match[0].length;

		// Slack appends skin tone as its own shortcode; drop it rather than
		// printing a stray `:skin-tone-3:` after the emoji it modifies.
		if (/^skin-tone-\d$/.test(name)) continue;

		const url = custom[name];
		if (url) {
			if (buffer) {
				segments.push({ kind: 'text', value: buffer });
				buffer = '';
			}
			segments.push({ kind: 'image', name, url });
			continue;
		}

		const char = UNICODE[name];
		// Unknown shortcode: leave it visible rather than silently deleting text.
		buffer += char ?? match[0];
	}

	buffer += input.slice(lastIndex);
	if (buffer) segments.push({ kind: 'text', value: buffer });

	return segments;
}

/** Convenience for places that only need Unicode substitution, no images. */
export function replaceUnicodeEmoji(input: string | undefined) {
	if (!input) return '';
	return input.replace(SHORTCODE, (whole, name: string) => {
		const key = name.toLowerCase();
		if (/^skin-tone-\d$/.test(key)) return '';
		return UNICODE[key] ?? whole;
	});
}

/** Fetch the workspace's custom emoji; resolves silently to {} without the scope. */
export async function loadCustomEmoji(): Promise<Record<string, string>> {
	try {
		const response = await fetch('/api/slack-emoji');
		const payload = await response.json();
		return payload.emoji ?? {};
	} catch {
		return {};
	}
}
