import type { SlackChannel } from '../slack.js';
import { matchesPattern } from '../zones.js';

export type Hobby = { key: string; label: string; emoji: string; keywords: string[] };

export const HOBBIES: Hobby[] = [
	{ key: 'coding', label: 'Coding', emoji: '💻', keywords: ['code', 'coding', 'dev', 'programming', 'python', 'javascript', 'typescript', 'rust', 'web', 'api', 'github', 'linux'] },
	{ key: 'electronics', label: 'Electronics', emoji: '🔌', keywords: ['hardware', 'pcb', 'circuit', 'solder', 'electronics', 'embedded', 'arduino', 'raspberry', 'keyboard'] },
	{ key: 'robotics', label: 'Robots & 3D printing', emoji: '🦾', keywords: ['robot', 'robotics', 'drone', 'cad', '3d', 'printing', 'printer', 'laser', 'maker'] },
	{ key: 'gamedev', label: 'Games', emoji: '🎮', keywords: ['gamedev', 'game', 'games', 'gaming', 'godot', 'unity', 'jam', 'minecraft'] },
	{ key: 'art', label: 'Art & design', emoji: '🎨', keywords: ['art', 'design', 'figma', 'drawing', 'pixel', 'ui', 'ux', 'blender'] },
	{ key: 'music', label: 'Music', emoji: '🎵', keywords: ['music', 'audio', 'song', 'songs', 'guitar', 'piano', 'synth', 'osu'] },
	{ key: 'ai', label: 'AI & ML', emoji: '🧠', keywords: ['ai', 'ml', 'llm', 'machine', 'neural', 'data', 'gpt'] },
	{ key: 'security', label: 'Security & CTF', emoji: '🛡️', keywords: ['security', 'ctf', 'hacking', 'infosec', 'cyber', 'crypto'] },
	{ key: 'writing', label: 'Writing & reading', emoji: '✍️', keywords: ['writing', 'blog', 'books', 'reading', 'poetry', 'story'] },
	{ key: 'photo', label: 'Photo & video', emoji: '📷', keywords: ['photo', 'photos', 'photography', 'video', 'film', 'camera'] },
	{ key: 'science', label: 'Science & space', emoji: '🚀', keywords: ['space', 'science', 'physics', 'math', 'astro', 'rocket', 'chemistry'] },
	{ key: 'chill', label: 'Food, pets & chill', emoji: '🍕', keywords: ['food', 'cooking', 'baking', 'pets', 'cats', 'dogs', 'lounge'] }
];

export type Suggestion = { channel: SlackChannel; hobby: Hobby };

function hits(channelName: string, keywords: string[]) {
	const name = channelName.toLowerCase();
	return keywords.reduce((count, keyword) => count + (matchesPattern(name, keyword) ? 1 : 0), 0);
}

export function suggestChannels(
	channels: SlackChannel[],
	hobbyKeys: string[],
	customText = '',
	{ perHobby = 3, total = 9 } = {}
): Suggestion[] {
	const picked = HOBBIES.filter((hobby) => hobbyKeys.includes(hobby.key));

	const customWords = customText
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((word) => word.length >= 3);
	if (customWords.length) {
		picked.push({ key: 'custom', label: 'Your picks', emoji: '✨', keywords: customWords });
	}

	const usable = channels.filter((channel) => !channel.is_archived && !channel.is_private);

	const ranked = picked.map((hobby) =>
		usable
			.map((channel) => ({ channel, score: hits(channel.name, hobby.keywords) }))
			.filter((entry) => entry.score > 0)
			.sort(
				(a, b) =>
					b.score - a.score ||
					(b.channel.num_members ?? 0) - (a.channel.num_members ?? 0) ||
					a.channel.id.localeCompare(b.channel.id)
			)
			.map((entry) => ({ channel: entry.channel, hobby }))
	);

	const out: Suggestion[] = [];
	const seen = new Set<string>();
	const cursors = ranked.map(() => 0);
	const taken = ranked.map(() => 0);

	let progressed = true;
	while (progressed && out.length < total) {
		progressed = false;
		ranked.forEach((list, i) => {
			if (out.length >= total || taken[i] >= perHobby) return;
			while (cursors[i] < list.length && seen.has(list[cursors[i]].channel.id)) cursors[i]++;
			const next = list[cursors[i]];
			if (!next) return;
			seen.add(next.channel.id);
			out.push(next);
			taken[i]++;
			cursors[i]++;
			progressed = true;
		});
	}
	return out;
}
