// Single source of truth for K Raheja Seaking CDN assets (Views panoramas + Vicinities media).
// Generated from seaking-assets.csv — update here when the CDN folders change.

const CDN = 'https://assets.vestate.io/webtool/kraheja/seaking';

// ---------------------------------------------------------------------------
// VIEWS — Marzipano tiles: {VIEWS_BASE}/{Time}/tiles/{sceneId}/{z}/{f}/{y}/{x}.jpg
// Scene ids differ per time of day (the folders were exported in different orders),
// so each floor carries its own id for every time.
// ---------------------------------------------------------------------------
export const VIEWS_BASE = `${CDN}/custom/Views`;

export const viewTimes = ['morning', 'afternoon', 'evening', 'night'];

// CDN folder name for each time key
export const viewTimeFolders = {
	morning: 'Morning',
	afternoon: 'Afternoon',
	evening: 'Evening',
	night: 'Night'
};

// Ordered bottom → top (the floor dial shows them reversed).
export const viewFloors = [
	{ name: '1st Floor', ids: { morning: '10-1st-floor', afternoon: '0-1st-floor_', evening: '0-1st-floor', night: '3-1st-floor' } },
	{ name: '3rd Floor', ids: { morning: '2-3rd-floor', afternoon: '1-3rd-floor', evening: '1-3rd-floor', night: '9-3rd-floor' } },
	{ name: '6th Floor', ids: { morning: '3-6th-floor', afternoon: '2-6th-floor', evening: '2-6th-floor', night: '4-6th-floor' } },
	{ name: '9th Floor', ids: { morning: '4-9th-floor', afternoon: '3-9th-floor', evening: '6-9th-floor', night: '0-9th-floor' } },
	{ name: '12th Floor', ids: { morning: '0-12th-floor', afternoon: '4-12th-floor', evening: '7-12th-floor', night: '1-12th-floor' } },
	{ name: '15th Floor', ids: { morning: '5-15th-floor', afternoon: '5-15th-floor', evening: '8-15th-floor', night: '10-15th-floor' } },
	{ name: '18th Floor', ids: { morning: '6-18th-floor', afternoon: '6-18th-floor', evening: '9-18th-floor', night: '5-18th-floor' } },
	{ name: '21st Floor', ids: { morning: '7-21st-floor', afternoon: '7-21st-floor', evening: '3-21st-floor', night: '6-21st-floor' } },
	{ name: '24th Floor', ids: { morning: '8-24th-floor', afternoon: '8-24th-floor', evening: '4-24th-floor', night: '7-24th-floor' } },
	{ name: '28th Floor', ids: { morning: '9-28th-floor', afternoon: '9-28th-floor', evening: '10-28th-floor', night: '8-28th-floor' } },
	{ name: 'Amenity Floor', ids: { morning: '1-amenity-level', afternoon: '10-amenity-floor', evening: '5-amenity-floor', night: '2-amenity-floor' } }
];

export function viewScenePath(time, floor) {
	return `${VIEWS_BASE}/${viewTimeFolders[time]}/tiles/${floor.ids[time]}`;
}

// ---------------------------------------------------------------------------
// VICINITIES — one .mp4 per location plus a 3-image gallery ({gallery}/{1..3}.webp)
// ---------------------------------------------------------------------------
const VIC = `${CDN}/vicinities`;

export const vicinityIntroVideo = `${VIC}/day-video/Intro.mp4`;

const item = (category, file, slug, label, distance = '') => ({
	id: `${category}/${slug}`,
	label,
	distance,
	video: encodeURI(`${VIC}/${category}/${file}.mp4`),
	gallery: encodeURI(`${VIC}/${category}/gallery/${slug}`)
});

export const vicinityCategories = [
	{
		id: 'connectivity',
		name: 'Connectivity',
		items: [
			item('Connectivity', 'Bandra Worli Sea Link', 'bandraworlisealink', 'Bandra Worli Sea Link', '3.8 KM'),
			item('Connectivity', 'BKC Metro Station', 'bkcmetrostation', 'BKC Metro Station', '1.8 KM'),
			item('Connectivity', 'Versova', 'versova', 'Versova'),
			item('Connectivity', 'Bandra Terminus', 'bandraterminus', 'Bandra Terminus', '2.5 KM'),
			item('Connectivity', 'Coastal Road', 'coastalroad', 'Coastal Road', '4.2 KM'),
			item('Connectivity', 'Santacruz Metro Line', 'santacruzmetroline', 'Santacruz Metro Line', '2.1 KM'),
			item('Connectivity', 'Upcoming Versova Sea Link', 'upcomingversovasealink', 'Upcoming Versova Sea Link', '3.5 KM'),
			item('Connectivity', 'Western Express Highway', 'westernexpresshighway', 'Western Express Highway', '1.0 KM')
		]
	},
	{
		id: 'cafe-club',
		name: 'Cafe & Clubs',
		items: [
			item('Cafe & Clubs', 'Khar Gymkhana', 'khargymkhana', 'Khar Gymkhana', '0.8 KM'),
			item('Cafe & Clubs', 'Taj Lounges', 'tajlounges', 'Taj Lounges', '4.5 KM'),
			item('Cafe & Clubs', 'Bastian', 'bastian', 'Bastian', '1.2 KM'),
			item('Cafe & Clubs', 'MIG', 'mig', 'MIG', '1.5 KM'),
			item('Cafe & Clubs', 'National Sports Club', 'nationalsportsclub', 'National Sports Club', '5.0 KM'),
			item('Cafe & Clubs', 'Otters', 'otters', 'Otters Club', '1.1 KM'),
			item('Cafe & Clubs', 'Pali Village Cafe', 'palivillagecafe', 'Pali Village Café', '0.9 KM'),
			item('Cafe & Clubs', 'Toto_s', 'totos', "Toto's", '0.7 KM'),
			item('Cafe & Clubs', 'Veronicas', 'veronicas', "Veronica's", '0.6 KM'),
			item('Cafe & Clubs', 'Willingdon Club', 'willingdonclub', 'Willingdon Club', '6.2 KM')
		]
	},
	{
		id: 'hospital',
		name: 'Hospital',
		items: [
			item('Hospital', 'Holy Family Hosp', 'holyfamilyhosp', 'Holy Family Hospital', '1.6 KM'),
			item('Hospital', 'Lilavati Hosp', 'lilavatihosp', 'Lilavati Hospital', '1.3 KM'),
			item('Hospital', 'Asian Heart Hosp', 'asianhearthosp', 'Asian Heart Hospital', '2.2 KM')
		]
	},
	{
		id: 'commercial',
		name: 'Commercial',
		items: [
			item('Commercial', 'BKC', 'bkc', 'BKC', '1.8 KM'),
			item('Commercial', 'Jio World Centre', 'jioworldcentre', 'Jio World Centre', '2.0 KM'),
			item('Commercial', 'Lower Parel', 'lowerparel', 'Lower Parel', '8.5 KM'),
			item('Commercial', 'NMACC', 'nmacc', 'NMACC', '2.0 KM'),
			item('Commercial', 'Worli', 'worli', 'Worli', '9.0 KM')
		]
	},
	{
		id: 'education',
		name: 'Education',
		items: [
			item('Education', 'American School of Bombay', 'americanschoolofbombay', 'American School of Bombay', '2.4 KM'),
			item('Education', 'Dhirubhai Ambani School', 'dhirubhaiambanischool', 'Dhirubhai Ambani School', '2.2 KM'),
			item('Education', 'St Andrews College', 'standrewscollege', 'St Andrews College', '1.1 KM'),
			item('Education', 'St Stanislaus', 'ststanislaus', 'St Stanislaus', '0.8 KM')
		]
	},
	{
		id: 'retail-lifestyle',
		name: 'Retail & Lifestyle',
		items: [
			item('Retail & Lifestyle', 'Bandstand', 'bandstand', 'Bandstand', '1.4 KM'),
			item('Retail & Lifestyle', 'Jio World Drive', 'jioworlddrive', 'Jio World Drive', '2.3 KM'),
			item('Retail & Lifestyle', 'Linking_ Hill Road', 'linkinghillroad', 'Linking / Hill Road', '0.5 KM'),
			item('Retail & Lifestyle', 'Carter Road', 'carterroad', 'Carter Road', '1.5 KM')
		]
	},
	{
		id: 'faith-heritage',
		name: 'Places of Worship',
		items: [item('Places of Worship', 'Mount Mary', 'mountmary', 'Mount Mary', '1.7 KM')]
	}
];

export function findVicinityItem(id) {
	for (const cat of vicinityCategories) {
		const found = cat.items.find((i) => i.id === id);
		if (found) return found;
	}
	return null;
}
