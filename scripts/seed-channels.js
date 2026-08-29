#!/usr/bin/env node
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { zoneForChannelName } from '../src/lib/zones.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Plain `node` does not read .env the way Vite does, so load it ourselves.
function loadEnvFile() {
	const envPath = path.join(__dirname, '../.env');
	if (!fsSync.existsSync(envPath)) return;

	for (const line of fsSync.readFileSync(envPath, 'utf8').split('\n')) {
		const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
		if (match && !process.env[match[1]]) {
			process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
		}
	}
}

loadEnvFile();
const TOKEN = process.env.SLACK_BOT_TOKEN;

if (!TOKEN) {
	console.error('Error: SLACK_BOT_TOKEN not found in environment or .env');
	process.exit(1);
}

async function fetchChannels() {
	console.log('Fetching channels from Slack...');
	const response = await fetch(
		'https://slack.com/api/conversations.list?exclude_archived=true&types=public_channel,private_channel&limit=100',
		{
			headers: { Authorization: `Bearer ${TOKEN}` }
		}
	);
	const data = await response.json();

	if (!data.ok) {
		throw new Error(`Slack API error: ${data.error}`);
	}

	return data.channels;
}

async function fetchChannelInfo(channelId) {
	const response = await fetch(
		`https://slack.com/api/conversations.info?channel=${channelId}`,
		{
			headers: { Authorization: `Bearer ${TOKEN}` }
		}
	);
	const data = await response.json();

	if (!data.ok) {
		console.warn(`Failed to fetch info for ${channelId}: ${data.error}`);
		return { topic: { value: '' }, purpose: { value: '' } };
	}

	return data.channel;
}

async function seedChannels() {
	try {
		const channels = await fetchChannels();
		console.log(`Found ${channels.length} channels`);

		const seededChannels = [];

		for (const channel of channels) {
			const info = await fetchChannelInfo(channel.id);
			const zone = zoneForChannelName(channel.name);

			seededChannels.push({
				id: channel.id,
				name: channel.name,
				zone,
				description: info.purpose?.value || info.topic?.value || `${channel.name} channel`,
				memberCount: channel.num_members || 0,
				topic: info.topic?.value || '',
				isPrivate: channel.is_private || false,
				createdAt: new Date(channel.created * 1000).toISOString()
			});

			console.log(`✓ ${channel.name} → ${zone}`);
		}

		const outputPath = path.join(__dirname, '../public/channels.json');
		await fs.writeFile(
			outputPath,
			JSON.stringify({ channels: seededChannels }, null, 2)
		);

		console.log(`\n✅ Seeded ${seededChannels.length} channels to ${outputPath}`);
	} catch (error) {
		console.error('Error seeding channels:', error.message);
		process.exit(1);
	}
}

seedChannels();
