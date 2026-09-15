const SEEN_KEY = 'slack-map:tour-seen:v1';
const HOBBY_KEY = 'slack-map:hobbies:v1';

export function hasSeenTour(): boolean {
	try {
		return localStorage.getItem(SEEN_KEY) === '1';
	} catch {
		return true;
	}
}

export function markTourSeen() {
	try {
		localStorage.setItem(SEEN_KEY, '1');
	} catch {
		// nothing to do; worst case the tour shows again next visit
	}
}

export function loadHobbies(): { keys: string[]; custom: string } {
	try {
		const raw = JSON.parse(localStorage.getItem(HOBBY_KEY) ?? 'null');
		return {
			keys: Array.isArray(raw?.keys) ? raw.keys.filter((k: unknown) => typeof k === 'string') : [],
			custom: typeof raw?.custom === 'string' ? raw.custom : ''
		};
	} catch {
		return { keys: [], custom: '' };
	}
}

export function saveHobbies(keys: string[], custom: string) {
	try {
		localStorage.setItem(HOBBY_KEY, JSON.stringify({ keys, custom }));
	} catch {
		// preferences are a convenience, never required
	}
}
