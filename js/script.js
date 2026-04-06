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

	return `
		<article class="gallery-item" data-index="${index}">
			<img
				src="${apodItem.url}"
				alt="${apodItem.title}"
				loading="${loadingMode}"
				decoding="async"
				fetchpriority="${fetchPriority}"
			/>
			<p><strong>${apodItem.title}</strong></p>
			<p>${apodItem.date}</p>
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
		const url = `${APOD_API_URL}?api_key=${apiKey}&start_date=${startDate}&end_date=${endDate}`;
		response = await fetch(url, { signal });

		let parsedData = null;

		try {
			parsedData = await response.json();
		} catch {
			parsedData = null;
		}

		if (response.ok) {
			responseData = parsedData;
			break;
		}

		const nasaMessage = parsedData?.error?.message;

		if (nasaMessage) {
			lastErrorMessage = nasaMessage;
		}

		if (!nasaMessage || !nasaMessage.toLowerCase().includes('api key')) {
			break;
		}
	}

	if (!response || !response.ok) {
		throw new Error(lastErrorMessage);
	}

	// APOD can return a single object for a one-day request.
	const apodItems = Array.isArray(responseData) ? responseData : [responseData];

	// We only show images in this gallery (APOD can also return videos)
	const imageItems = apodItems
		.filter((item) => item.media_type === 'image')
		.sort((a, b) => new Date(b.date) - new Date(a.date));

	apodCache.set(cacheKey, imageItems);
	return imageItems;
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
			showGalleryMessage('No images found in this date range. Try different dates.');
			return;
		}

		renderGallery(apodItems);
	} catch (error) {
		if (error.name === 'AbortError') {
			return;
		}

		if (error.name === 'TypeError' && error.message.toLowerCase().includes('fetch')) {
			showGalleryMessage('Network error: unable to reach NASA API. Check your internet connection and try again.', '📡');
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
