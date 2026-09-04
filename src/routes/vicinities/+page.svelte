<script>
	import { goto } from '$app/navigation';
	import { getContext, onMount, onDestroy } from 'svelte';
	import minimizeBtn from '$lib/images/minimize-icon.svg';
	import maximizeBtn from '$lib/images/maximize-icon.svg';
	import * as Accordion from '$lib/components/ui/accordion/index.ts';
	import { createLoadObserver } from '$lib/utils.ts';
	import { writable } from 'svelte/store';
	import { slide } from 'svelte/transition';
	import { browser } from '$app/environment';
	import { gsap } from 'gsap';
	// Poster is a base64 data URI baked into this .js module (see vicinity-intro-poster.js)
	// rather than a plain asset import — a plain import emits a separate hashed file, and
	// on a slow connection that extra round-trip recreates the exact black-flash we're fixing.
	import vicinityIntroPoster from '$lib/images/vicinity-intro-poster.js';
	import { hlsVideo } from '$lib/useHlsVideo';

	// Segmented (HLS) version of the intro loop — lets the browser start playing
	// after the first few-second chunk instead of waiting on the whole file.
	const introVid = '/hls/intro/master.m3u8';

	let currentUI = getContext('currentUI');
	let cleanId;
	$currentUI['vicinity'] = true;
	const onload = createLoadObserver(() => {
		console.log('loaded!!!');
	});

	const isSafariMobile =
		browser &&
		/iPhone|iPad|iPod/.test(navigator.userAgent) &&
		/Safari/.test(navigator.userAgent) &&
		!/CriOS|FxiOS|OPiOS|EdgiOS/.test(navigator.userAgent);

	const isAmenitiesMinimized = writable();
	$: isAmenitiesMinimized.set(isSafariMobile ? true : false);

	let vicinityImg = getContext('vicinityImg');
	let galleryCollapsed = false;
	let openAccordionItems = []; // persists which sidebar categories are expanded across minimize/reopen
	let isLoaded = true;

	// Tracks the last category clicked in the sidebar, independent of accordion expand/collapse,
	// so re-clicking or collapsing the same category doesn't reset its video back to the default.
	let activeCategoryId = '';
	$: activeCategoryVideo =
		(vicinityCategories.find((cat) => cat.id === activeCategoryId) || {}).video360 || introVid;
	let activeSrc = '';
	let prevSrc = '';
	let imgEl;
	let videoLoading = false;
	let videoLoadSafetyTimer;

	$: displaySrc = $vicinityImg != '-' ? 'https://assets.vestate.io/webtool/kraheja/kraheja/vicinities/' + $vicinityImg : '';
	$: {
		if (displaySrc && displaySrc !== activeSrc) {
			prevSrc = activeSrc;
			activeSrc = displaySrc;
			isLoaded = false;
		}
	}
	$: if (imgEl && imgEl.complete && imgEl.naturalWidth > 0) {
		isLoaded = true;
	}

	$: if ($vicinityImg !== '-') {
		galleryCollapsed = false;
	}



	onMount(async () => {
		vicinityImg.set('-');
		console.log('vicinity mounted');

		// Subtle zoom-in transition for the background without hiding it
		gsap.fromTo('.vicinity-bg-wrapper', 
			{
				scale: 1.05
			},
			{
				scale: 1.0,
				duration: 1.5,
				ease: 'power2.out'
			}
		);
	});

	let activeFolder = '';
	let activeCategoryFolder = '';
	let activeLabel = '';
	let activeDistance = '';
	// Two persistent video layers ping-pong the "front" role: whichever one isn't
	// front keeps its already-loaded src and just fades out, instead of being
	// reassigned a new src and having to reload from scratch (that reload was
	// showing up as a stray blank/unloaded flash mid-transition).
	let videoSrcA = '';
	let videoSrcB = '';
	let frontIsA = true;
	let videoElA;
	let videoElB;
	let cardSlideIndex = 1;
	let galleryInterval;

	function startGalleryTimer() {
		stopGalleryTimer();
		galleryInterval = setInterval(() => {
			cardSlideIndex = cardSlideIndex === 3 ? 1 : cardSlideIndex + 1;
		}, 3000);
	}

	function stopGalleryTimer() {
		if (galleryInterval) {
			clearInterval(galleryInterval);
			galleryInterval = null;
		}
	}

	function selectSlide(num) {
		cardSlideIndex = num;
		startGalleryTimer();
	}

	$: {
		if (activeFolder && activeCategoryFolder) {
			startGalleryTimer();
		} else {
			stopGalleryTimer();
		}
	}

	$: if ($vicinityImg) {
		cardSlideIndex = 1;
	}

	onDestroy(() => {
		stopGalleryTimer();
		if (videoLoadSafetyTimer) clearTimeout(videoLoadSafetyTimer);
	});

	// Marks the layer that just became playable as ready, and pauses the other
	// (now-hidden) layer so it isn't left decoding video in the background forever.
	function markLayerReady(isLayerA) {
		if (isLayerA !== frontIsA) return; // event from the layer that's currently fading out, ignore
		videoLoading = false;
		if (videoLoadSafetyTimer) {
			clearTimeout(videoLoadSafetyTimer);
			videoLoadSafetyTimer = null;
		}
		const backEl = isLayerA ? videoElB : videoElA;
		backEl?.pause();
	}

	// A video that fails to load (bad/missing CDN file) would otherwise leave the
	// crossfade stuck on the old video until the 5s safety timer expires — reveal
	// immediately instead so a broken clip doesn't look like a frozen UI.
	function markLayerErrored(isLayerA, src) {
		console.warn('Vicinity video failed to load:', src);
		markLayerReady(isLayerA);
	}

	function markLayerLoading(isLayerA) {
		if (isLayerA !== frontIsA) return;
		videoLoading = true;
	}

	function handleTimeUpdate(isLayerA) {
		const currentEl = isLayerA ? videoElA : videoElB;
		if (currentEl && $vicinityImg === 'Retail%20And%20Lifestyle/JioWorldDrive.webp') {
			if (currentEl.currentTime >= 6) {
				currentEl.pause();
			}
		}
	}

	$: {
		const oldVideo = frontIsA ? videoSrcA : videoSrcB;
		activeFolder = '';
		activeCategoryFolder = '';
		activeLabel = '';
		activeDistance = '';

		let nextVideo = '';
		for (const cat of vicinityCategories) {
			const found = cat.items.find((item) => item.id === $vicinityImg);
			if (found) {
				activeFolder = found.folder || '';
				activeCategoryFolder = cat.folder || '';
				activeLabel = found.label || '';
				activeDistance = found.distance || '';
				if (found.video) {
					nextVideo = found.video;
				} else if (found.folder && cat.folder) {
					// `folder` names the image gallery path; `videoFolder`/`videoName` override it
					// when the video CDN uses a different (usually shorter) folder/file name.
					const encodedCat = cat.videoFolder || cat.folder;
					const encodedSub = encodeURIComponent(found.videoName || found.folder);
					// `hls: true` opts a clip into chunked playback once its segmented
					// master.m3u8 + .ts files have been uploaded to that same CDN folder —
					// until then, leave it pointing at the plain .mp4.
					nextVideo = found.hls
						? `https://assets.vestate.io/kl-rahega/videos/${encodedCat}/${encodedSub}/master.m3u8`
						: `https://assets.vestate.io/k_raheja/${encodedCat}/${encodedSub}.mp4`;
				}
				break;
			}
		}

		if (nextVideo && (
			$vicinityImg === 'Connectivity/BKCMetrostation.webp' || 
			$vicinityImg === 'Commercial/LowerParel.webp' ||
			$vicinityImg === 'Connectivity/CoastalRoad.webp'
		)) {
			nextVideo += '#t=1';
		}

		if (nextVideo && $vicinityImg === 'Retail%20And%20Lifestyle/JioWorldDrive.webp') {
			nextVideo += '#t=0,6';
		}

		if ($vicinityImg !== '-') {
			if (nextVideo !== oldVideo) {
				// Send the new video to whichever layer is currently in back — the layer
				// coming to front loads nextVideo, the layer going to back keeps showing
				// whatever it already had loaded.
				const nextFrontIsA = !frontIsA;
				const targetSrc = nextFrontIsA ? videoSrcA : videoSrcB;
				
				if (targetSrc === nextVideo) {
					// The target layer already has this video loaded! Svelte won't trigger a reload.
					// We must manually reset, play, and mark it ready immediately.
					frontIsA = nextFrontIsA;
					videoLoading = false;
					
					const currentEl = frontIsA ? videoElA : videoElB;
					const backEl = frontIsA ? videoElB : videoElA;
					
					if (currentEl) {
						const startSec = ($vicinityImg === 'Connectivity/BKCMetrostation.webp' || 
										  $vicinityImg === 'Commercial/LowerParel.webp' || 
										  $vicinityImg === 'Connectivity/CoastalRoad.webp') ? 1 : 0;
						currentEl.currentTime = startSec;
						currentEl.play().catch((err) => console.log('Autoplay play error:', err));
					}
					if (backEl) {
						backEl.pause();
					}
				} else {
					if (frontIsA) {
						videoSrcB = nextVideo;
					} else {
						videoSrcA = nextVideo;
					}
					frontIsA = !frontIsA;

					videoLoading = true;
					if (videoLoadSafetyTimer) clearTimeout(videoLoadSafetyTimer);
					videoLoadSafetyTimer = setTimeout(() => {
						videoLoading = false;
					}, 5000);
				}
			} else {
				// The video is already loaded on the front layer, but the user re-selected it.
				// We should seek to the start (or 1s for special videos) and play.
				const currentEl = frontIsA ? videoElA : videoElB;
				if (currentEl) {
					const startSec = ($vicinityImg === 'Connectivity/BKCMetrostation.webp' ||   
									  $vicinityImg === 'Connectivity/CoastalRoad.webp') ? 1 : 0;
					currentEl.currentTime = startSec;
					currentEl.play().catch((err) => console.log('Autoplay play error:', err));
				}
			}
		} else {
			// Clear video sources when switching back to category level to prevent stale state leak
			videoSrcA = '';
			videoSrcB = '';
			videoLoading = false;
		}
	}

	let lightboxOpen = false;
	let lightboxIndex = 1;

	function openLightbox(index) {
		lightboxIndex = index;
		lightboxOpen = true;
	}

	function closeLightbox() {
		lightboxOpen = false;
	}

	function nextImage() {
		lightboxIndex = lightboxIndex === 3 ? 1 : lightboxIndex + 1;
	}

	function prevImage() {
		lightboxIndex = lightboxIndex === 1 ? 3 : lightboxIndex - 1;
	}

	function handleKeyDown(e) {
		if (!lightboxOpen) return;
		if (e.key === 'ArrowRight') nextImage();
		if (e.key === 'ArrowLeft') prevImage();
		if (e.key === 'Escape') closeLightbox();
	}

	// Organized vicinities from local folder structure
	const isDay = writable();

	// Vicinity data organized by category
	const vicinityCategories = [
		{
			id: 'connectivity',
			name: 'Connectivity',
			folder: 'Connectivity',
			videoFolder: 'Connectivity3',
			video360: "https://assets.vestate.io/kl-rahega/videos/touch-points/Connectivity.mp4",
			items: [
				{ id: 'Connectivity/BandraTerminus.webp', label: 'Bandra Terminus', folder: 'Bandra Terminus', videoName: 'Bandra Terminus', distance: '2.5 KM', subcategory: 'Railway' },
				{ id: 'Connectivity/BKCMetrostation.webp', label: 'BKC Metro Station', folder: 'BKC Metro station', videoName: 'BKC Metro Station', distance: '1.8 KM', subcategory: 'Metro' },
				{ id: 'Connectivity/SantacruzMetroLine.webp', label: 'Santa Cruz Metro Line', folder: 'Santacruz Metro line 3', videoName: 'St.cruz metro', distance: '2.1 KM', subcategory: 'Metro' },
				{ id: 'Connectivity/CoastalRoad.webp', label: 'Coastal Road', folder: 'Coastal Road', videoName: 'Coastal Road', distance: '4.2 KM', subcategory: 'Roadways' },
				{ id: 'Connectivity/Versova Bandra Sea Link.webp', label: 'Versova–Bandra Sea Link', folder: 'Versova-Bandra sea link', videoName: 'Versova', distance: '3.5 KM', subcategory: 'Roadways' },
				{ id: 'Connectivity/WesternExpressHighway.webp', label: 'Western Express Highway', folder: 'Western Express Highway', videoName: 'Western Express', distance: '1.0 KM', subcategory: 'Roadways' },
				{ id: 'Connectivity/WorliSeaLink.webp', label: 'Bandra Worli Sea Link', folder: 'Bandra Worli Sea Link', videoName: 'Bandra Worli Sea Link', distance: '3.8 KM', subcategory: 'Roadways' }
			]
		},
		{
			id: 'cafe-club',
			name: 'Cafes & Clubs',
			folder: 'Cafe%20%26%20Clubs',
			videoFolder: 'Cafes',
			video360: 'https://assets.vestate.io/kl-rahega/videos/touch-points/Cafe.mp4',
			items: [
				{ id: 'Cafe%20and%20Club/Bastian.webp', label: 'Bastian', folder: 'Bastian', distance: '1.2 KM' },
				{ id: 'Cafe%20and%20Club/Khar Gymkhana.webp', label: 'Khar Gymkhana', folder: 'Khar Gymkhana', distance: '0.8 KM' },
				{ id: 'Cafe%20and%20Club/MIG.webp', label: 'MIG', folder: 'MIG', distance: '1.5 KM' },
				{ id: 'Cafe%20and%20Club/NationalSportsClubofIndia.webp', label: 'National Sports Club of India', folder: 'National Sports Club of India', videoName: 'National sports', distance: '5.0 KM' },
				{ id: 'Cafe%20and%20Club/Otters.webp', label: 'Otters Club', folder: 'Otter_s', videoName: 'Otters', distance: '1.1 KM' },
				{ id: 'Cafe%20and%20Club/PaliVillageCafé.webp', label: 'Pali Village Café', folder: 'Pali Village Cafe', distance: '0.9 KM' },
				{ id: 'Cafe%20and%20Club/Taj lounges .webp', label: 'Taj Lands End', folder: 'Taj Lounges', videoName: 'Taj Lounges', distance: '4.5 KM' },
				{ id: 'Cafe%20and%20Club/Toto\'s.webp', label: 'Toto\'s', folder: 'Toto_s', distance: '0.7 KM' },
				{ id: 'Cafe%20and%20Club/Veronicas Pali Hill Cafes.webp', label: 'Veronicas Pali Hill Cafes', folder: 'Veronica_s-Pali Hill Cafes', videoName: 'Veronica_s', distance: '0.6 KM' },
				{ id: 'Cafe%20and%20Club/WillingdonClub .webp', label: 'Willingdon Club', folder: 'Willingdon club', videoName: 'Willington', distance: '6.2 KM' }
			]
		},
		{
			id: 'commercial',
			name: 'Commercial',
			folder: 'Commercial',
			video360: 'https://assets.vestate.io/kl-rahega/videos/touch-points/Commercial.mp4',
			items: [
				{ id: 'Commercial/BKC  .webp', label: 'BKC', folder: 'BKC',  distance: '1.8 KM' },
				{ id: 'Commercial/JioWorldCentre.webp', label: 'Jio World Centre', folder: 'Jio World Centre',  distance: '2.0 KM' },
				{ id: 'Commercial/LowerParel.webp', label: 'Lower Parel', folder: 'Lower Parel', videoName: 'Lower Parel1', distance: '8.5 KM' },
				{ id: 'Commercial/NMAC .webp', label: 'NMACC', folder: 'NMAC', videoName: 'NMACC', distance: '2.0 KM' },
				{ id: 'Commercial/Worli.webp', label: 'Worli Business District', folder: 'Worli',videoName: "Worli1" , distance: '9.0 KM' }
			]
		},
		{
			id: 'hospital',
			name: 'Hospitals',
			folder: 'Hospitals',
			videoFolder: 'Hospitals2',
			video360: 'https://assets.vestate.io/kl-rahega/videos/touch-points/Hospital.mp4',
			items: [
				{ id: 'Hospital/Asian Heart Institute.webp', label: 'Asian Heart Institute', folder: 'Asian Heart Institute', distance: '2.2 KM' },
				{ id: 'Hospital/HolyFamily  .webp', label: 'Holy Family', folder: 'Holy Family Hospital', videoName: 'Holy Family Hosp', distance: '1.6 KM' },
				{ id: 'Hospital/LilavatiHospital.webp', label: 'Lilavati Hospital', folder: 'Lilavati Hospital', videoName: 'Lilavati Hospital ', distance: '1.3 KM' }
			]
		},
		{
			id: 'education',
			name: 'Education Institutes',
			folder: 'Education%20Institutes',
			videoFolder: 'Education',
			video360: 'https://assets.vestate.io/kl-rahega/videos/touch-points/School.mp4',
			items: [
				{ id: 'Education/AmericanSchoolofBombay.webp', label: 'American School of Bombay', folder: 'American School of Bombay', videoName: 'American School', distance: '2.4 KM' },
				{ id: 'Education/DhirubhaiAmbani.webp', label: 'Dhirubhai Ambani International School', folder: 'Dhirubhai Ambani International School', videoName: 'Dhirubhai Ambani', distance: '2.2 KM' },
				{ id: 'Education/StAndrews .webp', label: 'St. Andrews', folder: 'St. Andrews College', videoName: 'St Andrew_s College', distance: '1.1 KM' },
				{ id: 'Education/StStanislaus.webp', label: 'St. Stanislaus', folder: 'St. Stanislaus International School', videoName: 'St Stanislaus School', distance: '0.8 KM' }
			]
		},
		{
			id: 'faith-heritage',
			name: 'Faith & Heritage',
			folder: 'Faith%20%26%20Heritage',
			videoFolder: 'Faith',
			video360: 'https://assets.vestate.io/kl-rahega/videos/touch-points/Faith.mp4',
			items: [
				{ id: 'Faith%20And%20Heritage/Mount Mary Basilica.webp', label: 'Mount Mary Basilica', folder: 'Mount Mary', videoName: 'Mount Mary', distance: '1.7 KM' }
			]
		},
		{
			id: 'retail-lifestyle',
			name: 'Retail & Lifestyle',
			folder: 'Retail%20%26%20Lifestyle',
			videoFolder: 'Retail',
			video360: 'https://assets.vestate.io/kl-rahega/videos/touch-points/Retail.mp4',
			items: [
				{ id: 'Retail%20And%20Lifestyle/Bandstand.webp', label: 'Bandstand', folder: 'Bandstand', distance: '1.4 KM' },
				{ id: 'Retail%20And%20Lifestyle/CarterRoad.webp', label: 'Carter Road', folder: 'Carter Road', distance: '1.5 KM' },
				{ id: 'Retail%20And%20Lifestyle/JioWorldDrive.webp', label: 'Jio World Drive', folder: 'Jio World Drive', distance: '2.3 KM' },
				{ id: 'Retail%20And%20Lifestyle/LinkingHillRoad .webp', label: 'Pali Hill/Linking Road', folder: 'Linking-Hill Road', videoName: 'Linking Road', distance: '0.5 KM' }
			]
		}
	];

	// Only these vicinities get the "Towards X" signpost label (matched to closest item by name)
	const towardsLabelIds = [
		'Connectivity/SantacruzMetroLine.webp', // Towards Santacruz Metro Line3
		'Connectivity/WesternExpressHighway.webp', // Towards Western Express Highway
		'Cafe%20and%20Club/NationalSportsClubofIndia.webp', // Towards National Sports Club of India
		'Cafe%20and%20Club/WillingdonClub .webp', // Towards Willingdon club
		'Commercial/Worli.webp', // Towards Worli
		'Commercial/LowerParel.webp' // Towards Lower Parel
	];

	function toggleDayNight() {
		isDay.update((value) => !value);
		isDay.subscribe((value) => {
			// hotspotName.set(value ? 'night' : 'Exterior');
		});
	}
</script>

{#if $isAmenitiesMinimized}
	<button
		class="minimized-sidebar-tab"
		style="position: fixed; left: 0; top: 50%; transform: translateY(-50%); z-index: 1001; margin-top: 0;"
		on:click={() => ($isAmenitiesMinimized = false)}
		type="button"
		id="minimize-toggle-vicinity"
	>
		<span class="chevron-group">
			<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
				<path class="chevron-arrow-1" d="M7 6L13 12L7 18" stroke="rgba(255, 255, 255, 0.35)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
				<path class="chevron-arrow-2" d="M14 6L20 12L14 18" stroke="rgba(255, 255, 255, 0.85)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
			</svg>
		</span>
		<span class="golden-circle">
			<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
				<polyline points="2 17 12 22 22 17"></polyline>
				<polyline points="2 12 12 17 22 12"></polyline>
			</svg>
		</span>
	</button>
{:else}
	<div class="left-panel-wrapper">
		<div class="left-panel p-2">
			<div class="left-panel--header flex items-center justify-between">
				<div class="header-icon-box">
					<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"></polygon>
						<line x1="9" y1="3" x2="9" y2="18"></line>
						<line x1="15" y1="6" x2="15" y2="21"></line>
					</svg>
				</div>
				<div class="left-title flex flex-col justify-center ml-3 text-left">
					<span class="explore-subtitle">Click to Explore</span>
					<span class="explore-title">Locations</span>
				</div>
				<button
					on:click={() => {
						$isAmenitiesMinimized = true;
					}}
					class="ghost-btn close-btn ml-auto !px-0 !py-0"
					id="minimize-toggle-vicinity"
				>
					<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
						<path d="M17 18L11 12L17 6" stroke="rgba(255, 255, 255, 0.85)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
						<path d="M10 18L4 12L10 6" stroke="rgba(255, 255, 255, 0.35)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
					</svg>
				</button>
			</div>

			<div class="panel-divider"></div>

			<div class="infrastructure-heading">Current Infrastructure</div>

			<div class="no-hovers">
				<div class="inner-btn-group">
					<Accordion.Root class="w-full sm:max-w-full" multiple={true} bind:value={openAccordionItems}>
						<Accordion.Item class="hidden" value="item-1wqweqweqweqwe">
							<Accordion.Trigger id="station-level-ss" class="hidden">asdasdasd</Accordion.Trigger>
						</Accordion.Item>

						{#each vicinityCategories as category}
							<Accordion.Item value={category.id}>
								<Accordion.Trigger id={category.id + '-level'} on:click={() => { vicinityImg.set('-'); activeCategoryId = category.id; }}>
									<div class="flex items-center gap-3 w-full text-left">
										<img 
											src={`/${category.id === 'cafe-club' ? 'cafe' : category.id === 'retail-lifestyle' ? 'retail' : category.id === 'faith-heritage' ? 'faith' : category.id === 'connectivity' ? 'connectivity1' : category.id === 'hospital' ? 'hospital1' : category.id}.png`} 
											alt={category.name} 
											class="category-icon w-5 h-5 object-contain" 
										/>
										<span
											class="category-name"
											style={(activeCategoryId === category.id && $vicinityImg === '-')
												? 'color: rgba(222, 173, 102, 1) !important; opacity: 1 !important;'
												: 'color: rgba(255, 255, 255, 0.85) !important; opacity: 0.65 !important;'}
										>
											{category.name === 'Cafes & Clubs' ? 'Cafe & Clubs' : category.name}
										</span>
									</div>
								</Accordion.Trigger>
								<Accordion.Content>
									{#each category.items as item}
										<button
											class={$vicinityImg == item.id
												? 'active inner-modal-btn'
												: 'inner-modal-btn'}
											id={'x-' + item.id.replaceAll(/[\s./]+/g, '-') + '-am'}
											on:click={() => { vicinityImg.set(item.id); $isAmenitiesMinimized = true; }}
										>
											{item.label}
										</button>
									{/each}
								</Accordion.Content>
							</Accordion.Item>
						{/each}
					</Accordion.Root>
				</div>
			</div>
		</div>
	</div>
{/if}

<div class="vicinity-bg-wrapper d-block visible absolute bottom-0 left-0 right-0 top-0 overflow-hidden bg-black">
	{#if $vicinityImg === '-'}
		{#key activeCategoryId}
			<video
				use:hlsVideo={activeCategoryVideo}
				poster={activeCategoryVideo === introVid ? vicinityIntroPoster : undefined}
				autoplay
				muted
				loop
				playsinline
				class="absolute top-0 left-0 h-full w-full object-cover z-40"
			></video>
		{/key}
	{/if}

	{#if $vicinityImg != '-'}
		<div class="absolute top-0 left-0 w-full h-full z-50 bg-black overflow-hidden">
			{#if videoSrcA || videoSrcB}
				<!-- Layer A: front while frontIsA, otherwise sits in back keeping its already-loaded content -->
				<video
					bind:this={videoElA}
					use:hlsVideo={videoSrcA}
					autoplay
					muted
					playsinline
					preload="auto"
					class="absolute top-0 left-0 h-full w-full object-cover vicinity-video-fade {frontIsA ? 'z-20' : 'z-10'} {(frontIsA ? videoLoading : !videoLoading) ? 'is-loading' : 'is-ready'}"
					on:playing={() => markLayerReady(true)}
					on:canplay={() => markLayerReady(true)}
					on:timeupdate={() => handleTimeUpdate(true)}
					on:loadstart={() => markLayerLoading(true)}
					on:waiting={() => markLayerLoading(true)}
					on:error={() => markLayerErrored(true, videoSrcA)}
				></video>

				<!-- Layer B: front while !frontIsA, otherwise sits in back keeping its already-loaded content -->
				<video
					bind:this={videoElB}
					use:hlsVideo={videoSrcB}
					autoplay
					muted
					playsinline
					preload="auto"
					class="absolute top-0 left-0 h-full w-full object-cover vicinity-video-fade {!frontIsA ? 'z-20' : 'z-10'} {(!frontIsA ? videoLoading : !videoLoading) ? 'is-loading' : 'is-ready'}"
					on:playing={() => markLayerReady(false)}
					on:canplay={() => markLayerReady(false)}
					on:timeupdate={() => handleTimeUpdate(false)}
					on:loadstart={() => markLayerLoading(false)}
					on:waiting={() => markLayerLoading(false)}
					on:error={() => markLayerErrored(false, videoSrcB)}
				></video>
			{:else}
				{#if !isLoaded && prevSrc}
					<img
						src={prevSrc}
						alt="Vicinity Previous"
						class="absolute top-0 left-0 h-full w-full object-cover filter blur-[8px] scale-105 pointer-events-none"
					/>
				{/if}

				<img
					bind:this={imgEl}
					src={activeSrc}
					alt="Vicinity"
					class="absolute top-0 left-0 h-full w-full object-cover transition-opacity duration-300 {isLoaded ? 'opacity-100' : 'opacity-0'}"
					on:load={() => { isLoaded = true; }}
					on:error={() => { isLoaded = true; }}
				/>
			{/if}
		</div>
	{/if}
</div>

<!-- Right-side gallery card (preview with dots) -->
{#if activeFolder && activeCategoryFolder && !galleryCollapsed}
	{@const activePreviewUrl = `https://assets.vestate.io/kl-rahega/images/${activeCategoryFolder}/${encodeURIComponent(activeFolder)}/${cardSlideIndex}.png`}
	<div class="right-gallery-card p-4 select-none animate-fade-in text-left {activeFolder === 'Willingdon club' ? 'right-gallery-card--willingdon' : ''}">
		<!-- Header with Title & Distance & Close Button -->
		<div class="flex justify-between items-start mb-4">
			<div class="flex flex-col pr-4">
				<h3 class="text-white text-[16px] font-semibold tracking-wide leading-tight uppercase font-serif" style="font-family: 'The Seasons', serif;">
					{activeLabel}
				</h3>
				{#if activeDistance}
					<div class="flex items-center gap-1.5 text-white/50 text-[11px] mt-1.5 font-medium">
						<!-- Custom direction/road split icon -->
						<svg class="w-4 h-4 text-white/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
							<line x1="9" y1="3" x2="9" y2="21"></line>
							<line x1="15" y1="3" x2="15" y2="21"></line>
							<line x1="3" y1="9" x2="21" y2="9"></line>
							<line x1="3" y1="15" x2="21" y2="15"></line>
						</svg>
						{activeDistance}
					</div>
				{/if}
			</div>

			<!-- Close button -->
			<button
				class="text-white/60 hover:text-white cursor-pointer transition-colors p-1.5 rounded-full hover:bg-white/10 border border-white/10 flex items-center justify-center w-8 h-8"
				on:click={() => galleryCollapsed = true}
				type="button"
			>
				<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
					<line x1="18" y1="6" x2="6" y2="18"></line>
					<line x1="6" y1="6" x2="18" y2="18"></line>
				</svg>
			</button>
		</div>

		<!-- Image Container with dots overlay -->
		<div class="relative w-full h-[150px] rounded-[14px] overflow-hidden border border-white/10 group cursor-pointer shadow-lg">
			<!-- Image click opens lightbox -->
			<div class="w-full h-full" on:click={() => openLightbox(cardSlideIndex)}>
				<img
					src={activePreviewUrl}
					alt={activeLabel}
					class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
				/>
				<div class="absolute inset-0 bg-black/5 group-hover:bg-black/0 transition-colors"></div>
			</div>

			<!-- Indicator dots centered at the bottom of the image -->
			<div class="absolute bottom-4 left-0 right-0 flex justify-center gap-2.5 z-10" on:click|stopPropagation>
				{#each [1, 2, 3] as imgNum}
					<button
						class="w-2 h-2 rounded-full transition-all duration-300 p-0 cursor-pointer {cardSlideIndex === imgNum ? 'bg-white scale-125' : 'bg-white/40 hover:bg-white/70'}"
						on:click={() => selectSlide(imgNum)}
						type="button"
						aria-label={`Slide ${imgNum}`}
					></button>
				{/each}
			</div>
		</div>
	</div>
{/if}

<!-- Center Lightbox Overlay -->
{#if lightboxOpen && activeFolder && activeCategoryFolder}
	<div class="lightbox-overlay-glass fixed inset-0 z-[10000] flex flex-col items-center justify-center animate-fade-in" on:click={closeLightbox}>
		
		<!-- Main Image Container -->
		<div 
			class="lightbox-card-glass relative max-w-6xl w-[90vw] h-[78vh] rounded-[16px] overflow-hidden shadow-2xl flex items-center justify-center p-2.5"
			on:click|stopPropagation
		>
			<!-- Viewport close button (top right of the image container) -->
			<button
				class="lightbox-close-glass cursor-pointer transition-all flex items-center justify-center w-11 h-11 rounded-full shadow-lg"
				on:click={closeLightbox}
				type="button"
			>
				<svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
					<line x1="18" y1="6" x2="6" y2="18"></line>
					<line x1="6" y1="6" x2="18" y2="18"></line>
				</svg>
			</button>

			<img
				src={`https://assets.vestate.io/kl-rahega/images/${activeCategoryFolder}/${encodeURIComponent(activeFolder)}/${lightboxIndex}.png`}
				alt={`${activeLabel} Gallery`}
				class="w-full h-full object-cover rounded-[10px] select-none"
			/>
		</div>

		<!-- Navigation Pill below the Image -->
		<div 
			class="lightbox-nav-glass flex items-center gap-6 mt-6 select-none px-6 py-2.5 rounded-full shadow-lg"
			on:click|stopPropagation
		>
			<!-- Prev Button -->
			<button
				class="text-white/50 hover:text-white cursor-pointer transition-all p-1 rounded-full hover:bg-white/10 flex items-center justify-center w-8 h-8"
				on:click={prevImage}
				type="button"
			>
				<svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
					<polyline points="15 18 9 12 15 6"></polyline>
				</svg>
			</button>

			<!-- Page count text -->
			<span class="text-white/80 text-xs font-semibold tracking-widest font-mono">
				{lightboxIndex} / 3
			</span>

			<!-- Next Button -->
			<button
				class="text-white/50 hover:text-white cursor-pointer transition-all p-1 rounded-full hover:bg-white/10 flex items-center justify-center w-8 h-8"
				on:click={nextImage}
				type="button"
			>
				<svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
					<polyline points="9 18 15 12 9 6"></polyline>
				</svg>
			</button>
		</div>
	</div>
{/if}

{#if activeFolder && activeCategoryFolder && galleryCollapsed}
	<button
		class="minimized-sidebar-tab-right"
		style="position: fixed; right: 0; top: 50%; transform: translateY(-50%); z-index: 1001; margin-top: 0;"
		on:click={() => (galleryCollapsed = false)}
		type="button"
		id="minimize-toggle-gallery"
	>
		<span class="chevron-group">
			<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
				<path class="chevron-arrow-1" d="M17 18L11 12L17 6" stroke="rgba(255, 255, 255, 0.85)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
				<path class="chevron-arrow-2" d="M10 18L4 12L10 6" stroke="rgba(255, 255, 255, 0.35)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
			</svg>
		</span>
		<span class="golden-circle">
			<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
				<rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
				<circle cx="8.5" cy="8.5" r="1.5"></circle>
				<polyline points="21 15 16 10 5 21"></polyline>
			</svg>
		</span>
		<span class="tab-label-text">GALLERY</span>
	</button>
{/if}

<svelte:window on:keydown={handleKeyDown} />

<!-- Go Back Button at bottom-left corner -->
<button
	class="go-back-btn"
	on:click={() => {
		$currentUI.vicinity = false;
		goto('/?menu=true');
	}}
	type="button"
>
	<svg class="w-3.5 h-3.5 mr-1.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
		<line x1="19" y1="12" x2="5" y2="12"></line>
		<polyline points="12 19 5 12 12 5"></polyline>
	</svg>
	Go Back
</button>



<style>
	/* Video Crossfade – incoming video blurs in as it fades in on top */
	.vicinity-video-fade {
		transition: opacity 700ms cubic-bezier(0.4, 0, 0.2, 1), filter 700ms cubic-bezier(0.4, 0, 0.2, 1);
		will-change: opacity, filter;
	}
	.vicinity-video-fade.is-loading {
		opacity: 0;
		filter: blur(20px);
	}
	.vicinity-video-fade.is-ready {
		opacity: 1;
		filter: blur(0);
	}

	/* Go Back Button */
	.go-back-btn {
		position: fixed;
		bottom: 24px;
		left: 24px;
		z-index: 1000;
		background: rgba(30, 30, 30, 0.45);
		border-radius: 9999px;
		padding: 8px 20px;
		display: flex;
		align-items: center;
		justify-content: center;
		backdrop-filter: blur(10px);
		-webkit-backdrop-filter: blur(10px);
		border: 1.2px solid rgba(255, 255, 255, 0.15);
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.35);
		color: rgba(255, 255, 255, 0.85);
		font-size: 11px;
		font-weight: 500;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		cursor: pointer;
		transition: all 0.3s cubic-bezier(0.25, 1, 0.5, 1);
		font-family: 'Imprima', sans-serif;
	}

	.go-back-btn:hover {
		background: rgba(222, 173, 102, 1);
		border-color: rgba(222, 173, 102, 1);
		color: white;
		box-shadow: 0 0 15px rgba(222, 173, 102, 0.45);
	}

 

 

	:global(.left-panel-wrapper) {
		bottom: 6.5rem !important;
	}
	@media (min-width: 1020px) {
		:global(.left-panel-wrapper) {
			bottom: 6rem !important;
		}
	}

	/* Lightbox Glassmorphism Overlay styling */
	.lightbox-overlay-glass {
		background: rgba(10, 10, 10, 0.35) !important;
		backdrop-filter: blur(20px) !important;
		-webkit-backdrop-filter: blur(20px) !important;
	}

	/* Glass Close Button */
	.lightbox-close-glass {
		position: absolute !important;
		top: 16px !important;
		right: 16px !important;
		z-index: 50 !important;
		background: rgba(18, 18, 18, 0.38) !important;
		backdrop-filter: blur(20px) !important;
		-webkit-backdrop-filter: blur(20px) !important;
		border: 0.65px solid transparent !important;
		background-clip: padding-box !important;
		color: rgba(255, 255, 255, 0.6) !important;
		box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.25) !important;
	}

	.lightbox-close-glass::before {
		content: "";
		position: absolute;
		inset: 0;
		border-radius: 50% !important;
		padding: 0.65px;
		background: linear-gradient(180deg, rgba(255, 255, 255, 0.4) 0%, rgba(153, 153, 153, 0) 100%);
		-webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
		-webkit-mask-composite: xor;
		mask-composite: exclude;
		pointer-events: none;
		z-index: -1;
	}

	.lightbox-close-glass:hover {
		color: #ffffff !important;
		transform: scale(1.05);
	}

	/* Glass Card containing the image */
	.lightbox-card-glass {
		position: relative;
		background: rgba(18, 18, 18, 0.38) !important;
		backdrop-filter: blur(20px) !important;
		-webkit-backdrop-filter: blur(20px) !important;
		border: 0.65px solid transparent !important;
		background-clip: padding-box !important;
		border-radius: 16px !important;
		box-shadow: 0 25px 50px rgba(0, 0, 0, 0.5) !important;
	}

	.lightbox-card-glass::before {
		content: "";
		position: absolute;
		inset: 0;
		border-radius: 16px !important;
		padding: 0.65px;
		background: linear-gradient(180deg, rgba(255, 255, 255, 0.4) 0%, rgba(153, 153, 153, 0) 100%);
		-webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
		-webkit-mask-composite: xor;
		mask-composite: exclude;
		pointer-events: none;
		z-index: -1;
	}

	/* Glass Navigation Pill */
	.lightbox-nav-glass {
		position: relative;
		background: rgba(18, 18, 18, 0.38) !important;
		backdrop-filter: blur(20px) !important;
		-webkit-backdrop-filter: blur(20px) !important;
		border: 0.65px solid transparent !important;
		background-clip: padding-box !important;
		border-radius: 9999px !important;
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35) !important;
	}

	.lightbox-nav-glass::before {
		content: "";
		position: absolute;
		inset: 0;
		border-radius: 9999px !important;
		padding: 0.65px;
		background: linear-gradient(180deg, rgba(255, 255, 255, 0.4) 0%, rgba(153, 153, 153, 0) 100%);
		-webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
		-webkit-mask-composite: xor;
		mask-composite: exclude;
		pointer-events: none;
		z-index: -1;
	}

	/* Right Gallery Card */
	.right-gallery-card {
		position: fixed;
		right: 1.5rem;
		top: 50%;
		transform: translateY(-50%);
		z-index: 1000;
		width: 290px;
		background: rgba(18, 18, 18, 0.38) !important;
		backdrop-filter: blur(20px) !important;
		-webkit-backdrop-filter: blur(20px) !important;
		border: 0.65px solid transparent !important;
		background-clip: padding-box !important;
		border-radius: 12px !important;
		box-shadow: 0 20px 50px rgba(0, 0, 0, 0.45) !important;
		transition: all 0.3s cubic-bezier(0.25, 1, 0.5, 1);
	}

	.right-gallery-card--willingdon {
		top: 75%;
	}

	.right-gallery-card::before {
		content: "";
		position: absolute;
		inset: 0;
		border-radius: 12px !important;
		padding: 0.65px;
		background: linear-gradient(180deg, rgba(255, 255, 255, 0.4) 0%, rgba(153, 153, 153, 0) 100%);
		-webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
		-webkit-mask-composite: xor;
		mask-composite: exclude;
		pointer-events: none;
		z-index: -1;
	}

	@media (max-width: 950px) and (orientation: landscape) {
		:global(.left-panel-wrapper) {
			left: 12px !important;
			bottom: 70px !important;
			transform: scale(0.85) !important;
			transform-origin: left bottom !important;
		}
		
		/* Direct font size increases inside vicinity left-panel for landscape phone screens */
		:global(.left-panel-wrapper .category-name) {
			font-size: 14.5px !important;
		}
		
		:global(.left-panel-wrapper .inner-modal-btn) {
			font-size: 13px !important;
			padding: 7px 11px !important;
		}

		:global(.left-panel-wrapper .infrastructure-heading) {
			font-size: 11.5px !important;
		}
		
		:global(.left-panel-wrapper .explore-title) {
			font-size: 16px !important;
		}
		:global(.minimized-sidebar-tab) {
			transform: translateY(-50%) scale(0.68) !important;
			transform-origin: left center !important;
		}
		.right-gallery-card {
			transform: translateY(-50%) scale(0.68) !important;
			transform-origin: right center !important;
			right: 12px !important;
		}
		:global(.minimized-sidebar-tab-right) {
			transform: translateY(-50%) scale(0.68) !important;
			transform-origin: right center !important;
		}
	}

	:global(.minimized-sidebar-tab-right) {
		background: rgba(18, 18, 18, 0.38) !important;
		backdrop-filter: blur(20px) !important;
		-webkit-backdrop-filter: blur(20px) !important;
		border: none !important;
		position: fixed;
	}

	:global(.minimized-sidebar-tab-right)::before {
		content: "";
		position: absolute;
		inset: 0;
		border-radius: 24px 0 0 24px !important;
		padding: 0.65px;
		background: linear-gradient(180deg, rgba(255, 255, 255, 0.4) 0%, rgba(153, 153, 153, 0) 100%);
		-webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
		-webkit-mask-composite: xor;
		mask-composite: exclude;
		pointer-events: none;
		z-index: -1;
	}

	:global(.minimized-sidebar-tab-right .tab-label-text) {
		display: none;
	}

	@media (max-width: 768px), (max-width: 950px) and (orientation: landscape) {
		:global(.minimized-sidebar-tab-right .tab-label-text) {
			display: block !important;
		}
	}
</style>
