export type Mood = 'idle' | 'wave' | 'point' | 'think' | 'cheer';

export type TourTarget = { type: 'zone'; key: string } | { type: 'legend' } | null;

export type TourStep = {
	id: string;
	text: string;
	/** Used on the suggestions step when nothing matched. */
	emptyText?: string;
	target: TourTarget;
	mood?: Mood;
	/** Which corner Orpheus stands in: the one away from what is highlighted. */
	side?: 'left' | 'right';
	kind?: 'talk' | 'hobbies' | 'suggestions';
	/** Label for the primary button, when "Next" doesn't fit. */
	cta?: string;
};

export const TOUR_STEPS: TourStep[] = [
	{
		id: 'welcome',
		text: "Hey there! I'm Orpheus, Hack Club's resident dinosaur. This is a map of every public channel in the Hack Club Slack. Want the quick tour?",
		target: null,
		mood: 'wave',
		cta: 'Show me around!'
	},
	{
		id: 'community',
		text: "This big blue island is Community, the town square. Intros, #lounge, memes, music, pets... if it's social, it lives here.",
		target: { type: 'zone', key: 'community' },
		mood: 'point',
		side: 'right'
	},
	{
		id: 'ysws',
		text: 'Green is YSWS: You Ship, We Ship! Build something, ship it, and Hack Club sends you something back. Hackathons and jams hang out here too.',
		target: { type: 'zone', key: 'ysws' },
		mood: 'cheer',
		side: 'right'
	},
	{
		id: 'software',
		text: 'The gold island is Software: web dev, languages, Linux, databases... and the eternal tabs-vs-spaces debate.',
		target: { type: 'zone', key: 'software' },
		mood: 'point',
		side: 'left'
	},
	{
		id: 'hardware',
		text: 'Purple is Hardware. PCBs, soldering, robots, 3D printers. Things that blink, beep, and occasionally catch fire (responsibly).',
		target: { type: 'zone', key: 'hardware' },
		mood: 'point',
		side: 'left'
	},
	{
		id: 'connect',
		text: "Connect is where you find people: mentors, college and career advice, and help when you're stuck.",
		target: { type: 'zone', key: 'connect' },
		mood: 'point',
		side: 'right'
	},
	{
		id: 'legend',
		text: 'Lost? Tap any of these to light up its island on the map.',
		target: { type: 'legend' },
		mood: 'point',
		side: 'left'
	},
	{
		id: 'explore',
		text: 'Click an island to dive in. Inside, drag to see more channels and scroll to zoom. Click any channel to peek at what it is about.',
		target: null,
		mood: 'idle',
		side: 'left'
	},
	{
		id: 'hobbies',
		text: 'Now tell me about you! What do you like doing? Pick as many as you want.',
		target: null,
		mood: 'think',
		side: 'left',
		kind: 'hobbies',
		cta: 'Find my channels'
	},
	{
		id: 'suggestions',
		text: 'Ooh, good taste. I think you would like these. Click one to take a look:',
		emptyText:
			"Hmm, I couldn't find a match for that. Community is a great place to start, there's something for everyone!",
		target: null,
		mood: 'cheer',
		side: 'left',
		kind: 'suggestions'
	},
	{
		id: 'done',
		text: 'That is the tour! Replay it any time with "Take the tour" up top. Happy hacking!',
		target: null,
		mood: 'wave',
		side: 'left',
		cta: 'Start exploring'
	}
];
