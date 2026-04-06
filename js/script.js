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

// Replace this with your real NASA API key.
// If left blank, we fall back to NASA's public DEMO_KEY.
const NASA_API_KEY = 'c97ssOlrthqmBtVRgYHmQ1qizZQAdgj4I5OWsHEK';
const DEMO_API_KEY = 'DEMO_KEY';

function getPreferredApiKey() {
	return NASA_API_KEY.trim() || DEMO_API_KEY;
}

const APOD_API_URL = 'https://api.nasa.gov/planetary/apod';
let currentApodItems = [];
const apodCache = new Map();
let activeRequestController = null;

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
			<div class="placeholder-icon">${icon}</div>
			<p>${message}</p>
		</div>
	`;
}

// Build one gallery card from one APOD object
function createGalleryItem(apodItem, index) {
	const loadingMode = index === 0 ? 'eager' : 'lazy';
	const fetchPriority = index === 0 ? 'high' : 'low';
	const isVideo = apodItem.media_type === 'video';
	const mediaLabel = isVideo ? 'Video' : 'Image';

	return `
		<article class="gallery-item" data-index="${index}">
			<img
				src="${isVideo ? apodItem.thumbnail_url : apodItem.url}"
				alt="${apodItem.title}"
				loading="${loadingMode}"
				decoding="async"
				fetchpriority="${fetchPriority}"
			/>
			<p><strong>${apodItem.title}</strong></p>
			<p>${apodItem.date}</p>
			<p>${mediaLabel}</p>
		</article>
	`;
}

// Render all APOD cards in the gallery
function renderGallery(apodItems) {
	currentApodItems = apodItems;
	gallery.innerHTML = apodItems.map((item, index) => createGalleryItem(item, index)).join('');
}

// Fill modal with one APOD item's full details
function openModal(apodItem) {
	modalImage.src = apodItem.hdurl || apodItem.url;
	modalImage.alt = apodItem.title;
	modalTitle.textContent = apodItem.title;
	modalDate.textContent = apodItem.date;
	modalExplanation.textContent = apodItem.explanation;

	imageModal.classList.add('open');
	imageModal.setAttribute('aria-hidden', 'false');
}

function closeModal() {
	imageModal.classList.remove('open');
	imageModal.setAttribute('aria-hidden', 'true');
}

// Fetch APOD data from NASA using the selected date range
async function getApodByDateRange(startDate, endDate, signal) {
	const cacheKey = `${startDate}:${endDate}`;

	if (apodCache.has(cacheKey)) {
		return apodCache.get(cacheKey);
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

	// Show images and videos (videos use thumbnail_url from thumbs=true).
	const galleryItems = apodItems
		.filter((item) => item.media_type === 'image' || (item.media_type === 'video' && item.thumbnail_url))
		.sort((a, b) => new Date(b.date) - new Date(a.date));

	apodCache.set(cacheKey, galleryItems);
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

		const isNetworkFetchError = error.name === 'TypeError' && error.message.toLowerCase().includes('fetch');
		const isNasaServerOutage = /NASA API error \((5\d\d)\)/.test(error.message);

		if (isNetworkFetchError || isNasaServerOutage) {
			renderGallery(getFallbackApodItems());
			getImagesButton.textContent = 'Showing Sample Photos';
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
	const clickedCard = event.target.closest('.gallery-item');

	if (!clickedCard) {
		return;
	}

	const itemIndex = Number(clickedCard.dataset.index);
	const selectedItem = currentApodItems[itemIndex];

	if (!selectedItem) {
		return;
	}

	if (selectedItem.media_type === 'video') {
		window.open(selectedItem.url, '_blank', 'noopener,noreferrer');
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
	if (event.key === 'Escape' && imageModal.classList.contains('open')) {
		closeModal();
	}
});
