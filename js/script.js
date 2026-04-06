// Find our date picker inputs on the page
const startInput = document.getElementById('startDate');
const endInput = document.getElementById('endDate');
const getImagesButton = document.querySelector('.filters button');
const gallery = document.getElementById('gallery');
const imageModal = document.getElementById('imageModal');
const closeModalButton = document.getElementById('closeModalButton');
const modalImage = document.getElementById('modalImage');
const modalTitle = document.getElementById('modalTitle');
const modalDate = document.getElementById('modalDate');
const modalExplanation = document.getElementById('modalExplanation');
const spaceFactText = document.getElementById('spaceFactText');
const galleryStatus = document.getElementById('galleryStatus');

// Replace this with your real NASA API key.
// If left blank, we fall back to NASA's public DEMO_KEY.
const NASA_API_KEY = 'c97ssOlrthqmBtVRgYHmQ1qizZQAdgj4I5OWsHEK';
const DEMO_API_KEY = 'DEMO_KEY';

function getPreferredApiKey() {
	return NASA_API_KEY.trim() || DEMO_API_KEY;
}

const APOD_API_URL = 'https://api.nasa.gov/planetary/apod';
const SOLAR_SYSTEM_API_URL = 'https://api.le-systeme-solaire.net/rest/bodies/';
// Performance: cap requests so users do not accidentally load years of APOD entries at once.
const MAX_RANGE_DAYS = 31;
// Performance: keep a lightweight browser cache so refreshes are faster.
const SESSION_CACHE_KEY_PREFIX = 'apodRange:';
const SESSION_CACHE_INDEX_KEY = 'apodRange:index';
const MAX_SESSION_CACHE_ENTRIES = 8;
const SPACE_FACT_CACHE_KEY = 'spaceFact:latest';

let currentApodItems = [];
const apodCache = new Map();
let activeRequestController = null;
let lastFocusedElement = null;

// Short beginner-friendly facts we can display above the gallery.
const SPACE_FACTS = [
	'One day on Venus is longer than one Venus year. Venus spins so slowly that a single rotation takes about 243 Earth days.',
	'Neutron stars are incredibly dense. A teaspoon of neutron-star material would weigh around a billion tons on Earth.',
	'Jupiter has the shortest day of all planets in our solar system, spinning once in just under 10 hours.',
	'The footprints left by Apollo astronauts on the Moon can last for millions of years because there is no wind or rain.',
	'The International Space Station travels at about 17,500 miles per hour, orbiting Earth roughly every 90 minutes.',
	'Saturn could float in water if you had an ocean big enough, because its average density is lower than water.',
	'The Sun contains about 99.8% of all the mass in our solar system.'
];

// Local fallback images for times when the NASA API is temporarily unavailable.
function getFallbackApodItems() {
	return [
		{
			title: 'Andromeda Galaxy (Sample)',
			date: 'Sample Image',
			url: 'https://apod.nasa.gov/apod/image/2201/AndromedaMosaic1312.jpg',
			hdurl: 'https://apod.nasa.gov/apod/image/2201/AndromedaMosaic1312.jpg',
			explanation: 'NASA APOD is temporarily unavailable, so this sample space photo is shown instead.'
		},
		{
			title: 'Pillars of Creation (Sample)',
			date: 'Sample Image',
			url: 'https://apod.nasa.gov/apod/image/2210/pillars-creation_jwst_960.jpg',
			hdurl: 'https://apod.nasa.gov/apod/image/2210/pillars-creation_jwst_960.jpg',
			explanation: 'This is a fallback photo so the gallery still works in class during API downtime.'
		},
		{
			title: 'Earth and Moon from Mars (Sample)',
			date: 'Sample Image',
			url: 'https://apod.nasa.gov/apod/image/1402/CuriosityEarthMoon1024.jpg',
			hdurl: 'https://apod.nasa.gov/apod/image/1402/CuriosityEarthMoon1024.jpg',
			explanation: 'Try again later to load live APOD data from NASA.'
		}
	];
}

// Retry once for temporary server problems so students do not see random failures.
async function fetchWithRetry(url, signal) {
	const maxAttempts = 2;

	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		try {
			const response = await fetch(url, { signal });
			const isTemporaryServerError = [502, 503, 504].includes(response.status);

			if (isTemporaryServerError && attempt < maxAttempts) {
				await new Promise((resolve) => setTimeout(resolve, 1200));
				continue;
			}

			return response;
		} catch (error) {
			const isNetworkFetchError = error.name === 'TypeError';

			if (isNetworkFetchError && attempt < maxAttempts) {
				await new Promise((resolve) => setTimeout(resolve, 1200));
				continue;
			}

			throw error;
		}
	}
}

// Call the setupDateInputs function from dateRange.js
// This sets up the date pickers to:
// - Default to a range of 9 days (from 9 days ago to today)
// - Restrict dates to NASA's image archive (starting from 1995)
setupDateInputs(startInput, endInput);

// Show a message inside the gallery area (used for loading, errors, and empty states)
function showGalleryMessage(message, icon = '🔭') {
	gallery.innerHTML = `
		<div class="placeholder">
			<div class="placeholder-icon" aria-hidden="true">${icon}</div>
			<p>${message}</p>
		</div>
	`;
	galleryStatus.textContent = message;
}

function showRandomSpaceFact() {
	const randomIndex = Math.floor(Math.random() * SPACE_FACTS.length);
	spaceFactText.textContent = SPACE_FACTS[randomIndex];
}

function formatNumber(value, fallback = 'unknown') {
	if (typeof value !== 'number' || Number.isNaN(value)) {
		return fallback;
	}

	return new Intl.NumberFormat().format(value);
}

function buildSolarSystemFact(body) {
	const bodyName = body.englishName || body.id || 'This object';
	const bodyType = body.bodyType || 'space object';
	const radius = formatNumber(body.meanRadius);
	const gravity = typeof body.gravity === 'number' ? body.gravity.toFixed(2) : 'unknown';
	const moonCount = Array.isArray(body.moons) ? body.moons.length : 0;

	const factTemplates = [
		`Did you know? ${bodyName} is a ${bodyType.toLowerCase()} with an average radius of about ${radius} km.`,
		`Did you know? Gravity on ${bodyName} is about ${gravity} m/s².`,
		`Did you know? ${bodyName} currently has ${moonCount} known moon${moonCount === 1 ? '' : 's'}.`
	];

	const validFacts = factTemplates.filter((fact) => !fact.includes('unknown'));

	if (validFacts.length === 0) {
		return `Did you know? ${bodyName} is part of our solar system.`;
	}

	const randomFactIndex = Math.floor(Math.random() * validFacts.length);
	return validFacts[randomFactIndex];
}

// Try to load a live fact from the Solar System API.
async function getSolarSystemApiFact() {
	const response = await fetch(SOLAR_SYSTEM_API_URL);

	if (!response.ok) {
		throw new Error('Could not load Solar System API fact.');
	}

	const data = await response.json();
	const allBodies = Array.isArray(data.bodies) ? data.bodies : [];

	const usefulBodies = allBodies.filter((body) => {
		const hasName = Boolean(body.englishName || body.id);
		const isMajorBodyType = body.isPlanet || body.bodyType === 'Moon' || body.bodyType === 'Planet' || body.bodyType === 'Dwarf Planet';
		return hasName && isMajorBodyType;
	});

	if (usefulBodies.length === 0) {
		throw new Error('No useful bodies found in Solar System API response.');
	}

	const randomBodyIndex = Math.floor(Math.random() * usefulBodies.length);
	return buildSolarSystemFact(usefulBodies[randomBodyIndex]);
}

// Show a fact quickly: use cache first, then try API, then fall back to local facts.
async function showDidYouKnowFact() {
	try {
		const cachedFact = sessionStorage.getItem(SPACE_FACT_CACHE_KEY);

		if (cachedFact) {
			spaceFactText.textContent = cachedFact;
		}
	} catch {
		// Ignore storage issues and continue.
	}

	try {
		const liveFact = await getSolarSystemApiFact();
		spaceFactText.textContent = liveFact;

		try {
			sessionStorage.setItem(SPACE_FACT_CACHE_KEY, liveFact);
		} catch {
			// Ignore storage issues and keep running.
		}
	} catch {
		if (!spaceFactText.textContent) {
			showRandomSpaceFact();
		}
	}
}

// Return how many days are in the chosen date range (inclusive).
function getRangeLengthInDays(startDate, endDate) {
	const millisecondsPerDay = 24 * 60 * 60 * 1000;
	const diffInMilliseconds = new Date(endDate) - new Date(startDate);
	return Math.floor(diffInMilliseconds / millisecondsPerDay) + 1;
}

function getSessionCacheKey(startDate, endDate) {
	return `${SESSION_CACHE_KEY_PREFIX}${startDate}:${endDate}`;
}

function readSessionCacheIndex() {
	try {
		const indexText = sessionStorage.getItem(SESSION_CACHE_INDEX_KEY);

		if (!indexText) {
			return [];
		}

		const parsedIndex = JSON.parse(indexText);
		return Array.isArray(parsedIndex) ? parsedIndex : [];
	} catch {
		return [];
	}
}

function writeSessionCacheIndex(indexItems) {
	try {
		sessionStorage.setItem(SESSION_CACHE_INDEX_KEY, JSON.stringify(indexItems));
	} catch {
		// Storage might be blocked. The app still works without this optimization.
	}
}

// Keep only the newest cache keys so storage does not grow forever.
function pruneSessionCacheIndex() {
	const indexItems = readSessionCacheIndex();

	if (indexItems.length <= MAX_SESSION_CACHE_ENTRIES) {
		return;
	}

	const keysToRemove = indexItems.slice(0, indexItems.length - MAX_SESSION_CACHE_ENTRIES);
	const keptKeys = indexItems.slice(indexItems.length - MAX_SESSION_CACHE_ENTRIES);

	for (const key of keysToRemove) {
		try {
			sessionStorage.removeItem(key);
		} catch {
			// Ignore storage access errors.
		}
	}

	writeSessionCacheIndex(keptKeys);
}

function getSessionCachedApodItems(startDate, endDate) {
	const cacheKey = getSessionCacheKey(startDate, endDate);

	let cachedText = null;

	try {
		cachedText = sessionStorage.getItem(cacheKey);
	} catch {
		return null;
	}

	if (!cachedText) {
		return null;
	}

	try {
		const parsedItems = JSON.parse(cachedText);
		return Array.isArray(parsedItems) ? parsedItems : null;
	} catch {
		sessionStorage.removeItem(cacheKey);
		return null;
	}
}

function setSessionCachedApodItems(startDate, endDate, apodItems) {
	const cacheKey = getSessionCacheKey(startDate, endDate);

	try {
		sessionStorage.setItem(cacheKey, JSON.stringify(apodItems));

		const existingIndex = readSessionCacheIndex().filter((key) => key !== cacheKey);
		existingIndex.push(cacheKey);
		writeSessionCacheIndex(existingIndex);
		pruneSessionCacheIndex();
	} catch {
		// If storage is full or blocked, we silently skip this optimization.
	}
}

// Build one gallery card from one APOD object
function createGalleryItem(apodItem, index) {
	const loadingMode = index === 0 ? 'eager' : 'lazy';
	const fetchPriority = index === 0 ? 'high' : 'low';
	const isVideo = apodItem.media_type === 'video';
	const mediaLabel = isVideo ? 'Video' : 'Image';
	const previewUrl = isVideo ? apodItem.thumbnail_url : apodItem.url;

	const mediaMarkup = previewUrl
		? `
			<img
				src="${previewUrl}"
				alt="${apodItem.title}"
				loading="${loadingMode}"
				decoding="async"
				fetchpriority="${fetchPriority}"
			/>
		`
		: '<div class="media-placeholder" aria-hidden="true">🎬</div>';

	const videoLinkMarkup = isVideo
		? `<a class="video-link" href="${apodItem.url}" target="_blank" rel="noopener noreferrer" aria-label="Watch video: ${apodItem.title}">Watch Video</a>`
		: '';

	const cardInnerMarkup = `
		${mediaMarkup}
		<p><strong>${apodItem.title}</strong></p>
		<p>${apodItem.date}</p>
		<p>${mediaLabel}</p>
		${videoLinkMarkup}
	`;

	if (isVideo) {
		return `
			<article class="gallery-item" data-index="${index}">
				${cardInnerMarkup}
			</article>
		`;
	}

	return `
		<article class="gallery-item" data-index="${index}">
			<button
				type="button"
				class="gallery-item-button"
				data-open-image="${index}"
				aria-label="View details for image: ${apodItem.title}"
			>
				${cardInnerMarkup}
			</button>
		</article>
	`;
}

// Render all APOD cards in the gallery
function renderGallery(apodItems) {
	currentApodItems = apodItems;
	// Render all cards in one string to avoid many small DOM updates.
	gallery.innerHTML = apodItems.map((item, index) => createGalleryItem(item, index)).join('');
	galleryStatus.textContent = `Loaded ${apodItems.length} APOD entries.`;
}

function getFocusableElementsInModal() {
	return imageModal.querySelectorAll(
		'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
	);
}

function trapFocusInModal(event) {
	if (event.key !== 'Tab' || !imageModal.classList.contains('open')) {
		return;
	}

	const focusableElements = getFocusableElementsInModal();

	if (focusableElements.length === 0) {
		event.preventDefault();
		return;
	}

	const firstFocusable = focusableElements[0];
	const lastFocusable = focusableElements[focusableElements.length - 1];

	if (event.shiftKey && document.activeElement === firstFocusable) {
		event.preventDefault();
		lastFocusable.focus();
		return;
	}

	if (!event.shiftKey && document.activeElement === lastFocusable) {
		event.preventDefault();
		firstFocusable.focus();
	}
}

// Fill modal with one APOD item's full details
function openModal(apodItem) {
	lastFocusedElement = document.activeElement;
	modalImage.src = apodItem.hdurl || apodItem.url;
	modalImage.alt = apodItem.title;
	modalTitle.textContent = apodItem.title;
	modalDate.textContent = apodItem.date;
	modalExplanation.textContent = apodItem.explanation;

	imageModal.classList.add('open');
	imageModal.setAttribute('aria-hidden', 'false');
	closeModalButton.focus();
}

function closeModal() {
	imageModal.classList.remove('open');
	imageModal.setAttribute('aria-hidden', 'true');

	if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
		lastFocusedElement.focus();
	}
}

// Fetch APOD data from NASA using the selected date range
async function getApodByDateRange(startDate, endDate, signal) {
	const cacheKey = `${startDate}:${endDate}`;

	if (apodCache.has(cacheKey)) {
		return apodCache.get(cacheKey);
	}

	// Performance: check sessionStorage before making a network request.
	const sessionCachedItems = getSessionCachedApodItems(startDate, endDate);

	if (sessionCachedItems) {
		apodCache.set(cacheKey, sessionCachedItems);
		return sessionCachedItems;
	}

	// Try user key first. If NASA rejects it, try DEMO_KEY automatically.
	const keysToTry = [getPreferredApiKey()];

	if (keysToTry[0] !== DEMO_API_KEY) {
		keysToTry.push(DEMO_API_KEY);
	}

	let response;
	let responseData;
	let lastErrorMessage = 'Could not load space images. Please try again.';

	for (const apiKey of keysToTry) {
		// thumbs=true lets the API include thumbnail_url for video entries.
		const url = `${APOD_API_URL}?api_key=${apiKey}&start_date=${startDate}&end_date=${endDate}&thumbs=true`;
		response = await fetchWithRetry(url, signal);

		let parsedData = null;
		let responseText = '';

		try {
			responseText = await response.text();
		} catch {
			responseText = '';
		}

		if (responseText) {
			try {
				parsedData = JSON.parse(responseText);
			} catch {
				parsedData = null;
			}
		}

		if (response.ok) {
			responseData = parsedData;
			break;
		}

		const nasaMessage = parsedData?.error?.message || parsedData?.msg || parsedData?.message;

		if (nasaMessage) {
			lastErrorMessage = `NASA API error (${response.status}): ${nasaMessage}`;
		} else if (responseText) {
			lastErrorMessage = `NASA API error (${response.status}): ${responseText.slice(0, 160)}`;
		} else {
			lastErrorMessage = `NASA API error (${response.status}).`;
		}

		const mentionsApiKey = lastErrorMessage.toLowerCase().includes('api key') || lastErrorMessage.toLowerCase().includes('api_key');

		if (!mentionsApiKey) {
			break;
		}
	}

	if (!response || !response.ok) {
		throw new Error(lastErrorMessage);
	}

	// APOD can return a single object for a one-day request.
	const apodItems = Array.isArray(responseData) ? responseData : [responseData].filter(Boolean);

	// Show both images and videos.
	const galleryItems = apodItems
		.filter((item) => item.media_type === 'image' || item.media_type === 'video')
		// Date strings are YYYY-MM-DD, so string compare is faster than creating Date objects.
		.sort((a, b) => b.date.localeCompare(a.date));

	apodCache.set(cacheKey, galleryItems);
	setSessionCachedApodItems(startDate, endDate, galleryItems);
	return galleryItems;
}

// Handle the button click to fetch and display APOD results
async function handleGetImagesClick() {
	const startDate = startInput.value;
	const endDate = endInput.value;

	if (!startDate || !endDate) {
		showGalleryMessage('Please select both a start date and an end date.');
		return;
	}

	if (new Date(startDate) > new Date(endDate)) {
		showGalleryMessage('Start date must be before or equal to end date.');
		return;
	}

	const rangeLength = getRangeLengthInDays(startDate, endDate);

	if (rangeLength > MAX_RANGE_DAYS) {
		showGalleryMessage(`Please choose ${MAX_RANGE_DAYS} days or fewer for faster loading.`);
		return;
	}

	// Stop older requests so only the newest date range updates the gallery.
	if (activeRequestController) {
		activeRequestController.abort();
	}

	activeRequestController = new AbortController();

	getImagesButton.disabled = true;
	getImagesButton.textContent = 'Loading...';
	showGalleryMessage('Loading space photos...', '🔄');

	try {
		const apodItems = await getApodByDateRange(startDate, endDate, activeRequestController.signal);

		if (apodItems.length === 0) {
			showGalleryMessage('No APOD entries found in this date range. Try different dates.');
			return;
		}

		renderGallery(apodItems);
	} catch (error) {
		if (error.name === 'AbortError') {
			return;
		}

		// Debug log helps us diagnose API issues in the browser console.
		console.error('APOD request failed:', error);

		const isNetworkFetchError = error.name === 'TypeError';
		const isNasaServerOutage = /NASA API error \((5\d\d)\)/.test(error.message);
		const isNasaRateLimitOrAuthError = /NASA API error \((401|403|429)\)/.test(error.message);

		if (isNetworkFetchError || isNasaServerOutage || isNasaRateLimitOrAuthError) {
			renderGallery(getFallbackApodItems());
			getImagesButton.textContent = 'Showing Sample Photos';
			galleryStatus.textContent = 'NASA API is unavailable right now. Showing sample space photos.';
			setTimeout(() => {
				getImagesButton.textContent = 'Get Space Images';
			}, 1800);
			return;
		}

		showGalleryMessage(error.message);
	} finally {
		activeRequestController = null;
		getImagesButton.disabled = false;
		getImagesButton.textContent = 'Get Space Images';
	}
}

getImagesButton.addEventListener('click', handleGetImagesClick);

// Use event delegation so newly rendered cards automatically work
gallery.addEventListener('click', (event) => {
	const imageButton = event.target.closest('.gallery-item-button');

	if (!imageButton) {
		return;
	}

	const itemIndex = Number(imageButton.dataset.openImage);
	const selectedItem = currentApodItems[itemIndex];

	if (!selectedItem || selectedItem.media_type === 'video') {
		return;
	}

	openModal(selectedItem);
});

closeModalButton.addEventListener('click', closeModal);

// Close when user clicks the dark overlay area
imageModal.addEventListener('click', (event) => {
	if (event.target === imageModal) {
		closeModal();
	}
});

// Close with Escape for keyboard accessibility
document.addEventListener('keydown', (event) => {
	trapFocusInModal(event);

	if (event.key === 'Escape' && imageModal.classList.contains('open')) {
		closeModal();
	}
});

showDidYouKnowFact();
