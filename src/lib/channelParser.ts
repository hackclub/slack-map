import type { SlackChannel } from './slack.js';

export interface SlackChannelData {
	id: string;
	name: string;
	zone: 'community' | 'ysws' | 'connect' | 'software' | 'hardware';
	description: string;
	memberCount: number;
	topic: string;
	isPrivate: boolean;
	createdAt: string;
}

export interface ChannelsJSON {
	channels: SlackChannelData[];
}

export async function parseChannelsJSON(jsonData: string): Promise<SlackChannelData[]> {
	try {
		const parsed: ChannelsJSON = JSON.parse(jsonData);
		return validateChannels(parsed.channels);
	} catch (error) {
		throw new Error(
			`Failed to parse channels JSON: ${error instanceof Error ? error.message : 'Unknown error'}`
		);
	}
}

function validateChannels(channels: unknown[]): SlackChannelData[] {
	return channels.map((channel) => {
		if (typeof channel !== 'object' || channel === null) {
			throw new Error('Invalid channel object');
		}

		const ch = channel as Record<string, unknown>;

		return {
			id: String(ch.id ?? ''),
			name: String(ch.name ?? ''),
			zone: String(ch.zone ?? '') as SlackChannelData['zone'],
			description: String(ch.description ?? ''),
			memberCount: Number(ch.memberCount ?? 0),
			topic: String(ch.topic ?? ''),
			isPrivate: Boolean(ch.isPrivate ?? false),
			createdAt: String(ch.createdAt ?? new Date().toISOString())
		};
	});
}

export function getChannelsByZone(channels: SlackChannelData[], zone: string): SlackChannelData[] {
	return channels.filter((ch) => ch.zone === zone);
}

export function enrichChannelInfo(
	channel: SlackChannelData
): SlackChannelData & { formattedDate: string } {
	return {
		...channel,
		formattedDate: new Date(channel.createdAt).toLocaleDateString()
	};
}

export function getChannelById(channels: SlackChannelData[], id: string): SlackChannelData | undefined {
	return channels.find((ch) => ch.id === id);
}

export function searchChannels(
	channels: SlackChannelData[],
	query: string
): SlackChannelData[] {
	const lowerQuery = query.toLowerCase();
	return channels.filter(
		(ch) =>
			ch.name.toLowerCase().includes(lowerQuery) ||
			ch.description.toLowerCase().includes(lowerQuery) ||
			ch.topic.toLowerCase().includes(lowerQuery)
	);
}

export function sortChannelsByMembers(channels: SlackChannelData[]): SlackChannelData[] {
	return [...channels].sort((a, b) => b.memberCount - a.memberCount);
}

export function sortChannelsByDate(channels: SlackChannelData[]): SlackChannelData[] {
	return [...channels].sort(
		(a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
	);
}