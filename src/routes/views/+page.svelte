<script>
	import bowser from 'bowser';
	import { onMount, onDestroy } from 'svelte';
	import { getContext } from 'svelte';
	import { writable, derived } from 'svelte/store';
    import { goto } from '$app/navigation';
	import { viewFloors, viewTimes, viewScenePath, findVicinityItem } from '$lib/seakingAssets.js';
	let Marzipano;

	const hotspotName = getContext('hotspotName');
	const currentUI = getContext('currentUI');
	$currentUI['views'] = true;
	const UIPanel = getContext('UIPanel');

	// Available floors for each time of day (scene ids differ per time — see seakingAssets.js)
	const floors = viewFloors;

	const reversedFloorsWithIndices = floors.map((f, i) => ({ ...f, originalIndex: i })).reverse();

	// Info hotspots for the Amenity level (Morning) — yaw/pitch from the Seaking Marzipano export.
	// `side` keeps each label's hand-tuned direction from the previous set.
	const infoHotspots = [
		{ yaw: -2.3933366719004567, pitch: 0.24490037113676166, title: 'Mount Mary Basilica', side: 'right', height: 60 },
		{ yaw: -1.5033055594753009, pitch: -0.03590429798388328, title: 'Bandra Worli Sea Link', side: 'left', height: 60 },
		{ yaw: -1.4407648544781821, pitch: 0.10954063950802606, title: 'Taj Lands End', side: 'right', height: 60 },
		{ yaw: -2.4369888134318387, pitch: -0.038474433627067484, title: 'Worli business district', side: 'left', height: 60 },
		{ yaw: 1.2679139568392035, pitch: 0.3602239360865731, title: 'Bandstand & Carter Road Promenade', side: 'right', height: 60 },
		{ yaw: 0.8460049539203371, pitch: 0.03152529317160635, title: 'Versova–Bandra Sea Link', side: 'left', height: 60 },
		{ yaw: 1.6979486531817871, pitch: 0.13434710094206004, title: 'Otters Club', side: 'left', height: 60 },
		{ yaw: 1.8356727817929839, pitch: 0.031694567153557784, title: 'Pali Hill/Linking Road', side: 'left', height: 60 },
		{ yaw: 2.5381903410175912, pitch: 0.07963549875106501, title: 'Lilavati Hospital', side: 'right', height: 60 },
		{ yaw: 2.52674841938165, pitch: -0.06164556813085298, title: 'Dhirubhai Ambani International School', side: 'left', height: 60 },
		{ yaw: 2.4487294747446864, pitch: 0.0023716618291622638, title: 'Asian Heart Institute', side: 'left', height: 60 },
		{ yaw: 2.6084192680593468, pitch: -0.11710304331916888, title: 'BKC (Bandra-Kurla Complex)', side: 'right', height: 60 },
		{ yaw: 2.732296208749399, pitch: 0.017351364843236183, title: 'American School of Bombay', side: 'left', height: 60 },
		{ yaw: 2.900433864184567, pitch: 0.005290657278260724, title: 'Jio World Drive', side: 'right', height: 60 },
		{ yaw: 2.9296965245782625, pitch: -0.04721866851412848, title: 'Jio World Centre (NMACC)', side: 'left', height: 60 }
	];

	// Initial view parameters from the Seaking data.json files
	const initialView = {
		yaw: 0,
		pitch: 0,
		fov: 1.5707963267948966
	};

	// Scene levels/tile configuration
	const levels = [
		{ tileSize: 256, size: 256, fallbackOnly: true },
		{ tileSize: 512, size: 512 },
		{ tileSize: 512, size: 1024 },
		{ tileSize: 512, size: 2048 },
		{ tileSize: 512, size: 4096 }
	];

	let viewer;
	let allScenes = {};
	let currentScene = null;
	let viewChangeHandler = null;

	// Main overview (default view + info hotspots) is the Amenity level
	const mainFloorIndex = floors.findIndex((f) => f.name === 'Amenity Floor');

	// State
	const selectedTime = writable('morning');
	const selectedFloorIndex = writable(mainFloorIndex);
	const isMainOverview = derived(selectedFloorIndex, ($index) => $index === mainFloorIndex);

	// Hotspot toggle state
	const hotspotsEnabled = writable(true);

	// Collapsible sidebars state
	let floorCollapsed = true;
	let timeCollapsed = true;

	// Working Compass state
	let activeViewListener = null;
	const currentYaw = writable(initialView.yaw);
	const COMPASS_YAW_OFFSET = -0.99; // Align E with sunrise in panorama (~ -15 degrees)
	let rawYaw = initialView.yaw;
	let unwrappedYaw = initialView.yaw;

	// Track which hotspots have been shown
	const shownHotspots = new Set();

	onMount(async () => {
		// @ts-expect-error - marzipano doesn't have type bindings
		Marzipano = await import('marzipano');

		// Create viewer with settings from APP_DATA
		viewer = new Marzipano.Viewer(document.getElementById('pano'), {
			controls: {
				mouseViewMode: 'drag'
			}
		});

		window.dragControlMethod = bowser.mobile
			? viewer.controls().method('touchView').instance
			: viewer.controls().method('mouseViewDrag').instance;

		// Load main overview by default
		loadScene('morning', mainFloorIndex);
		UIPanel.set('loaded');
	});

	// Time of day states
	const availableTimes = viewTimes;

	const createScene = (time, floor) => {
		// Scene path: {VIEWS_BASE}/{Time}/tiles/{sceneId}
		const scenePath = viewScenePath(time, floor);

		let source = Marzipano.ImageUrlSource.fromString(
			`${scenePath}/{z}/{f}/{y}/{x}.jpg`,
			{ cubeMapPreviewUrl: `${scenePath}/preview.jpg` }
		);

		let geometry = new Marzipano.CubeGeometry(levels);
		let limiter = Marzipano.RectilinearView.limit.traditional(4096, (130 * Math.PI) / 180);
		let view = new Marzipano.RectilinearView(initialView, limiter);

		let scene = viewer.createScene({
			source: source,
			geometry: geometry,
			view: view,
			pinFirstLevel: true
		});

		const sceneKey = `${time}_${floor.ids[time]}`;
		allScenes[sceneKey] = { source, view, scene, time };
	};

	// Track scene caching to prevent GPU memory starvation
	const MAX_CACHED_SCENES = 6;
	let sceneOrder = [];

	const loadScene = (time, floorIndex) => {
		const floor = floors[floorIndex];
		if (!floor) return;

		const sceneKey = `${time}_${floor.ids[time]}`;

		// Lazily create scene if it doesn't exist in cache yet
		if (!allScenes[sceneKey]) {
			createScene(time, floor);
		}

		// Move current scene to most-recently-used in cache order
		sceneOrder = sceneOrder.filter((key) => key !== sceneKey);
		sceneOrder.push(sceneKey);

		// Evict least-recently-used scenes if we exceed the cache cap
		while (sceneOrder.length > MAX_CACHED_SCENES) {
			const evictKey = sceneOrder.shift();
			if (evictKey && evictKey !== sceneKey && allScenes[evictKey]) {
				const evictData = allScenes[evictKey];
				viewer.destroyScene(evictData.scene);
				delete allScenes[evictKey];
			}
		}

		const sceneData = allScenes[sceneKey];
		if (!sceneData) return;

		const scene = sceneData.scene;

		// Clear existing hotspots
		const container = scene.hotspotContainer();
		const hotspots = container.listHotspots();
		hotspots.forEach((hotspot) => {
			container.destroyHotspot(hotspot);
		});

		// Clear shown hotspots tracking
		shownHotspots.clear();

		// Remove previous view change handler
		if (viewChangeHandler) {
			scene.view().removeEventListener('change', viewChangeHandler);
		}

		// Remove previous compass listener
		if (activeViewListener && currentScene) {
			currentScene.view().removeEventListener('change', activeViewListener);
		}

		// Info hotspots only on the Amenity level, in Morning, and when enabled
		const shouldShowHotspots = floorIndex === mainFloorIndex && time === 'morning' && $hotspotsEnabled;

		if (shouldShowHotspots) {
			infoHotspots.forEach((hotspot, index) => {
				createInfoHotspot(scene, hotspot, index);
			});

			// Add viewport visibility handler
			viewChangeHandler = () => {
				checkHotspotVisibility(scene);
			};
			scene.view().addEventListener('change', viewChangeHandler);

			// Initial check after scene loads
			setTimeout(() => {
				checkHotspotVisibility(scene);
			}, 300);
		}

		// Register compass change listener
		const sceneYaw = scene.view().yaw();
		rawYaw = sceneYaw;
		unwrappedYaw = sceneYaw;

		activeViewListener = () => {
			const newYaw = scene.view().yaw();
			let diff = newYaw - rawYaw;
			if (diff > Math.PI) {
				diff -= 2 * Math.PI;
			} else if (diff < -Math.PI) {
				diff += 2 * Math.PI;
			}
			unwrappedYaw += diff;
			rawYaw = newYaw;
			currentYaw.set(unwrappedYaw);
		};
		scene.view().addEventListener('change', activeViewListener);
		currentYaw.set(unwrappedYaw);

		scene.switchTo();
		currentScene = scene;

		// Update state
		selectedTime.set(time);
		selectedFloorIndex.set(floorIndex);
	};

	const checkHotspotVisibility = (scene) => {
		if (!scene || !scene.view()) return;

		const view = scene.view();
		const yaw = view.yaw();
		const pitch = view.pitch();
		const fov = view.fov();

		// Check each hotspot
		infoHotspots.forEach((hotspot, index) => {
			const wrapper = document.getElementById(`hotspot-wrapper-${index}`);
			if (!wrapper) return;

			// Calculate angular distance considering yaw wraparound
			let yawDiff = Math.abs(hotspot.yaw - yaw);
			if (yawDiff > Math.PI) {
				yawDiff = 2 * Math.PI - yawDiff;
			}

			const pitchDiff = Math.abs(hotspot.pitch - pitch);

			// Check if hotspot is in viewport
			const inViewport = yawDiff < fov * 0.7 && pitchDiff < fov * 0.6;

			if (inViewport) {
				wrapper.classList.add('visible');
				shownHotspots.add(index);

				// Dynamically change direction of the label if it's near the top-center controls
				// (to prevent it from getting hidden behind / overlapping the "Info Hotspots" pill and compass)
				const rect = wrapper.getBoundingClientRect();
				const centerX = window.innerWidth / 2;
				
				// Center controls are at top: 0-150px, left: 50%
				// Check if the hotspot is near the center horizontally (within 160px) and near the top (top < 350px)
				if (Math.abs(rect.left - centerX) < 160 && rect.top < 350) {
					if (rect.left < centerX) {
						// Hotspot is to the left of center, so label should extend to the left
						wrapper.classList.remove('hotspot-right');
						wrapper.classList.add('hotspot-left');
					} else {
						// Hotspot is to the right of center, so label should extend to the right
						wrapper.classList.remove('hotspot-left');
						wrapper.classList.add('hotspot-right');
					}
				} else {
					// Fallback to the configured static side
					const originalSide = hotspot.side || (index % 2 === 0 ? 'right' : 'left');
					if (originalSide === 'left') {
						wrapper.classList.remove('hotspot-right');
						wrapper.classList.add('hotspot-left');
					} else {
						wrapper.classList.remove('hotspot-left');
						wrapper.classList.add('hotspot-right');
					}
				}
			} else {
				wrapper.classList.remove('visible');
				shownHotspots.delete(index);
			}
		});
	};

	const selectTimeOfDay = (time) => {
		if (time !== 'morning') {
			hotspotsEnabled.set(false);
		}
		loadScene(time, $selectedFloorIndex);
	};

	const selectFloor = (index) => {
		loadScene($selectedTime, index);
	};

	const toggleHotspots = () => {
		hotspotsEnabled.update((enabled) => !enabled);
		loadScene($selectedTime, $selectedFloorIndex);
	};

	// Maps each panorama hotspot title to its Vicinities item (gallery thumbnail source)
	const hotspotImageMap = {
		'Bandra Worli Sea Link': 'Connectivity/bandraworlisealink',
		'Bandstand & Carter Road Promenade': 'Retail & Lifestyle/bandstand',
		'BKC (Bandra-Kurla Complex)': 'Commercial/bkc',
		'Lilavati Hospital': 'Hospital/lilavatihosp',
		'Dhirubhai Ambani International School': 'Education/dhirubhaiambanischool',
		'Otters Club': 'Cafe & Clubs/otters',
		'Taj Lands End': 'Cafe & Clubs/tajlounges',
		'Jio World Centre (NMACC)': 'Commercial/jioworldcentre',
		'Jio World Drive': 'Retail & Lifestyle/jioworlddrive',
		'Versova–Bandra Sea Link': 'Connectivity/upcomingversovasealink',
		'Worli business district': 'Commercial/worli',
		'Mount Mary Basilica': 'Places of Worship/mountmary',
		'American School of Bombay': 'Education/americanschoolofbombay',
		'Asian Heart Institute': 'Hospital/asianhearthosp',
		'Pali Hill/Linking Road': 'Retail & Lifestyle/linkinghillroad'
	};

	const createInfoHotspot = (scene, hotspotData, index) => {
		const wrapper = document.createElement('div');
		wrapper.classList.add('info-hotspot');
		wrapper.classList.add('overview-hotspot');
		
		// Use hand-tailored side alignment from data (fallback to alternating left/right)
		const side = hotspotData.side || (index % 2 === 0 ? 'right' : 'left');
		wrapper.classList.add(`hotspot-${side}`);
		
		wrapper.id = `hotspot-wrapper-${index}`;

		// Use hand-tailored height from data (fallback to 60)
		const height = hotspotData.height || 60;
		wrapper.style.setProperty('--hotspot-height', `${height}px`);

		// Center pulse dot
		const pulseDot = document.createElement('div');
		pulseDot.classList.add('hotspot-pulse-dot');
		wrapper.appendChild(pulseDot);

		// Vertical line
		const line = document.createElement('div');
		line.classList.add('hotspot-line');
		wrapper.appendChild(line);

		// Hotspot label
		const hotspot = document.createElement('div');
		hotspot.classList.add('hotspot');
		hotspot.classList.add('overview-hotspot-label');

		const imgData = findVicinityItem(hotspotImageMap[hotspotData.title]);
		if (imgData) {
			const img = document.createElement('img');
			img.src = `${imgData.gallery}/1.webp`;
			img.alt = hotspotData.title;
			img.classList.add('hotspot-label-img');
			hotspot.appendChild(img);
		}

		const textContainer = document.createElement('div');
		textContainer.classList.add('hotspot-label-text-container');

		const titleEl = document.createElement('div');
		titleEl.classList.add('hotspot-label-title');
		titleEl.innerText = hotspotData.title;
		textContainer.appendChild(titleEl);

		const subtitleEl = document.createElement('div');
		subtitleEl.classList.add('hotspot-label-subtitle');
		subtitleEl.innerText = 'Mumbai';
		textContainer.appendChild(subtitleEl);

		hotspot.appendChild(textContainer);
		wrapper.appendChild(hotspot);

		// Create hotspot at correct yaw/pitch position
		scene
			.hotspotContainer()
			.createHotspot(wrapper, { yaw: hotspotData.yaw, pitch: hotspotData.pitch }, {});
	};

	function capitalize(str) {
		return str.charAt(0).toUpperCase() + str.slice(1);
	}

	let lastFloorWheelTime = 0;
	let lastTimeWheelTime = 0;

	function handleFloorWheel(e) {
		e.preventDefault();
		const now = Date.now();
		if (now - lastFloorWheelTime < 250) {
			return;
		}
		lastFloorWheelTime = now;

		// Scroll up (deltaY < 0) goes to higher floor index, scroll down (deltaY > 0) goes to lower floor index
		const direction = e.deltaY < 0 ? 1 : -1;
		const nextIndex = $selectedFloorIndex + direction;
		if (nextIndex >= 0 && nextIndex < floors.length) {
			selectFloor(nextIndex);
		}
	}

	function handleTimeWheel(e) {
		e.preventDefault();
		const now = Date.now();
		if (now - lastTimeWheelTime < 250) {
			return;
		}
		lastTimeWheelTime = now;

		// Scroll down (deltaY > 0) goes to later time of day, scroll up (deltaY < 0) goes to earlier time of day
		const direction = e.deltaY > 0 ? 1 : -1;
		const activeTimeIdx = availableTimes.indexOf($selectedTime);
		const nextIndex = activeTimeIdx + direction;
		if (nextIndex >= 0 && nextIndex < availableTimes.length) {
			selectTimeOfDay(availableTimes[nextIndex]);
		}
	}

	let floorTouchStartY = 0;
	let timeTouchStartY = 0;
	const TOUCH_SWIPE_THRESHOLD = 30;

	function handleFloorTouchStart(e) {
		floorTouchStartY = e.touches[0].clientY;
	}

	function handleFloorTouchMove(e) {
		e.preventDefault();
		const currentY = e.touches[0].clientY;
		const diffY = floorTouchStartY - currentY; // positive = swipe up

		if (Math.abs(diffY) >= TOUCH_SWIPE_THRESHOLD) {
			const direction = diffY > 0 ? 1 : -1;
			const nextIndex = $selectedFloorIndex + direction;
			if (nextIndex >= 0 && nextIndex < floors.length) {
				selectFloor(nextIndex);
			}
			floorTouchStartY = currentY;
		}
	}

	function handleTimeTouchStart(e) {
		timeTouchStartY = e.touches[0].clientY;
	}

	function handleTimeTouchMove(e) {
		e.preventDefault();
		const currentY = e.touches[0].clientY;
		const diffY = timeTouchStartY - currentY; // positive = swipe up

		if (Math.abs(diffY) >= TOUCH_SWIPE_THRESHOLD) {
			const direction = diffY > 0 ? 1 : -1;
			const activeTimeIdx = availableTimes.indexOf($selectedTime);
			const nextIndex = activeTimeIdx + direction;
			if (nextIndex >= 0 && nextIndex < availableTimes.length) {
				selectTimeOfDay(availableTimes[nextIndex]);
			}
			timeTouchStartY = currentY;
		}
	}

	onDestroy(() => {
		if (activeViewListener && currentScene) {
			currentScene.view().removeEventListener('change', activeViewListener);
		}
		if (viewer) {
			viewer = null;
		}
	});
</script>

<div class="overview-container">
	{#if timeCollapsed}
		<button
			class="minimized-sidebar-tab-right"
			on:click={() => (timeCollapsed = false)}
			type="button"
			id="minimize-toggle-time"
		>
			<span class="chevron-group">
				<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
					<path class="chevron-arrow-1" d="M17 18L11 12L17 6" stroke="rgba(255, 255, 255, 0.85)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
					<path class="chevron-arrow-2" d="M10 18L4 12L10 6" stroke="rgba(255, 255, 255, 0.35)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
				</svg>
			</span>
			<span class="golden-circle">
				<img src="/timearrow.png" alt="Time Arrow" class="w-5 h-5 object-contain" />
			</span>
		</button>
	{/if}

	<!-- Time of Day Selector (Semi-circular dial on right edge) -->
	<div 
		class="time-dial {timeCollapsed ? 'collapsed' : ''}" 
		on:touchstart|nonpassive={handleTimeTouchStart}
		on:touchmove|preventDefault|stopPropagation|nonpassive={handleTimeTouchMove}
	>
		<!-- Collapse/Expand Arrow -->
		{#if !timeCollapsed}
			<button
				class="dial-toggle-btn right-dial-toggle"
				on:click={() => (timeCollapsed = !timeCollapsed)}
				type="button"
			>
				<svg
					class="w-4 h-4 text-white transition-transform duration-300"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2.5"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<polyline points="9 18 15 12 9 6"></polyline>
				</svg>
			</button>
		{/if}

		<!-- Center text labels for Time Dial -->
		<div class="dial-center-label right-dial-label">
			<span class="text-[8px] tracking-widest text-white/40 uppercase">Sun Angle</span>
			<span class="text-[19px] font-semibold text-white mt-1 capitalize" style="font-family: 'Imprima', serif;">
				{$selectedTime}
			</span>
		</div>

		<!-- Radial Tick Marks -->
		{#each Array(20) as _, i}
			{@const tickAngle = -60 + (i * 120) / 19}
			{@const tickRad = (tickAngle * Math.PI) / 180}
			{@const tx = Math.cos(tickRad) * 185}
			{@const ty = Math.sin(tickRad) * 175}
			<div 
				class="dial-tick" 
				style="right: {tx}px; top: calc(50% + {ty}px); transform: translate(50%, -50%) rotate({-tickAngle}deg);"
			></div>
		{/each}

		<!-- Time Buttons along the arc -->
		<div class="dial-buttons">
			{#each availableTimes as time, idx}
				{@const activeTimeIdx = availableTimes.indexOf($selectedTime)}
				{@const relativeDistance = idx - activeTimeIdx}
				{@const angle = relativeDistance * 30}
				{@const rad = (angle * Math.PI) / 180}
				{@const tx = Math.cos(rad) * 185}
				{@const ty = Math.sin(rad) * 185}
				{@const opacity = Math.max(0, 1 - Math.abs(angle) / 75)}
				{@const visible = Math.abs(angle) <= 75}
				<button
					class="dial-time-btn {$selectedTime === time ? 'active' : ''}"
					style="right: {tx}px; top: calc(50% + {ty}px); opacity: {opacity}; pointer-events: {visible ? 'auto' : 'none'};"
					on:click={() => selectTimeOfDay(time)}
					title={capitalize(time)}
				>
					{#if time === 'morning'}
						<svg class="{$selectedTime === time ? 'w-5 h-5' : 'w-4 h-4'}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<circle cx="12" cy="12" r="4"/>
							<path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>
						</svg>
					{:else if time === 'afternoon'}
						<svg class="{$selectedTime === time ? 'w-5 h-5' : 'w-4 h-4'}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<circle cx="12" cy="12" r="5"/>
							<path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M5.64 18.36l-1.42 1.42M19.78 4.22l-1.42 1.42"/>
						</svg>
					{:else if time === 'evening'}
						<svg class="{$selectedTime === time ? 'w-5 h-5' : 'w-4 h-4'}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M17 18a5 5 0 0 0-10 0M12 2v7M4.93 4.93l4.24 4.24M19.07 4.93l-4.24 4.24M2 18h20"/>
						</svg>
					{:else}
						<svg class="{$selectedTime === time ? 'w-5 h-5' : 'w-4 h-4'}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>
						</svg>
					{/if}
				</button>
			{/each}
		</div>
	</div>

	{#if floorCollapsed}
		<button
			class="minimized-sidebar-tab"
			style="position: fixed; left: 0; top: 50%; transform: translateY(-50%); z-index: 1001; margin-top: 0;"
			on:click={() => (floorCollapsed = false)}
			type="button"
			id="minimize-toggle-floor"
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
	{/if}

	<!-- Floor Selector (Semi-circular dial on left edge) -->
	<div 
		class="floor-dial {floorCollapsed ? 'collapsed' : ''}" 
	 
		on:touchstart|nonpassive={handleFloorTouchStart}
		on:touchmove|preventDefault|stopPropagation|nonpassive={handleFloorTouchMove}
	>
		<!-- Collapse/Expand Arrow -->
		{#if !floorCollapsed}
			<button
				class="dial-toggle-btn left-dial-toggle"
				on:click={() => (floorCollapsed = !floorCollapsed)}
				type="button"
			>
				<svg
					class="w-4 h-4 text-white transition-transform duration-300"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2.5"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<polyline points="15 18 9 12 15 6"></polyline>
				</svg>
			</button>
		{/if}

		<!-- Center text labels -->
		<div class="dial-center-label">
			<span class="text-[12px] tracking-widest text-white/40 uppercase">Total Floors</span>
			<span class="text-3xl font-semibold text-white mt-1 mx-auto"  >
				28<span class="text-xs font-normal align-top ml-0.5  ">th</span>
			</span>
		</div>

		<!-- Radial Tick Marks -->
		{#each Array(32) as _, i}
			{@const tickAngle = -72 + (i * 144) / 31}
			{@const tickRad = (tickAngle * Math.PI) / 180}
			{@const tx = Math.cos(tickRad) * 175}
			{@const ty = Math.sin(tickRad) * 175}
			<div 
				class="dial-tick" 
				style="left: {tx}px; top: calc(50% + {ty}px); transform: translate(-50%, -50%) rotate({tickAngle}deg);"
			></div>
		{/each}

		<!-- Floor Buttons along the arc -->
		<div class="dial-buttons">
			{#each reversedFloorsWithIndices as floor, idx}
				{@const activeFloorIdx = reversedFloorsWithIndices.findIndex(f => f.originalIndex === $selectedFloorIndex)}
				{@const relativeDistance = activeFloorIdx - idx}
				{@const angle = relativeDistance * 24}
				{@const rad = (angle * Math.PI) / 180}
				{@const fx = Math.cos(rad) * 175}
				{@const fy = Math.sin(rad) * 175}
				{@const opacity = Math.max(0, 1 - Math.abs(angle) / 75)}
				{@const visible = Math.abs(angle) <= 75}
				{@const floorNum = floor.name.match(/\d+/)?.[0] ?? 'A'}
				<button
					title={floor.name}
					class="dial-floor-btn {$selectedFloorIndex === floor.originalIndex ? 'active' : ''}"
					style="left: {fx}px; top: calc(50% + {fy}px); opacity: {opacity}; pointer-events: {visible ? 'auto' : 'none'};"
					on:click={() => selectFloor(floor.originalIndex)}
				>
					{floorNum}
				</button>
			{/each}
		</div>
	</div>

	<!-- Hotspot Toggle Pill -->
	{#if $isMainOverview && $selectedTime === 'morning'}
		<div class="hotspot-toggle-pill animate-fade-in">
			<span class="toggle-pill-label">Info Hotspots</span>
			<button
				class="toggle-pill-btn {$hotspotsEnabled ? 'active' : ''}"
				on:click={toggleHotspots}
				aria-label={$hotspotsEnabled ? 'Turn off hotspots' : 'Turn on hotspots'}
				type="button"
			>
				<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
					<circle cx="12" cy="12" r="10"></circle>
					<line x1="12" y1="16" x2="12" y2="12"></line>
					<line x1="12" y1="8" x2="12.01" y2="8"></line>
				</svg>
			</button>
		</div>
	{/if}

	<!-- Working Compass -->
	<div class="compass-container animate-fade-in">
		<div class="compass-dial" style="transform: rotate({((-$currentYaw + COMPASS_YAW_OFFSET) * 180 / Math.PI)}deg);">
			<div class="direction-n">N</div>
			<div class="direction-e">E</div>
			<div class="direction-s">S</div>
			<div class="direction-w">W</div>
			
			<!-- Elegant Needle -->
			<div class="compass-needle-wrapper">
				<svg class="compass-needle-svg" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
					<!-- North Needle (Gold) -->
					<path d="M12 2L16 12H8L12 2Z" fill="#DEAD66" />
					<!-- South Needle (Gray) -->
					<path d="M12 22L8 12H16L12 22Z" fill="rgba(255, 255, 255, 0.4)" />
				</svg>
			</div>
		</div>
		<!-- Fixed heading marker at the top of the compass -->
		<div class="compass-heading-marker"></div>
	</div>

	<!-- Go Back Button at bottom-left corner -->
	<button
		class="go-back-btn animate-fade-in"
		on:click={() => {
			$currentUI.views = false;
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

	<!-- Marzipano Viewer -->
	<div id="pano" class="pano-viewer"></div>
</div>

<style>
	.overview-container {
		position: fixed;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		background: #000;
	}

	.pano-viewer {
		width: 100%;
		height: 100%;
	}

	/* Semi-circular dials layout */
	.floor-dial {
		position: fixed;
		left: -20px;
		top: 50%;
		transform: translateY(-50%);
		width: 220px;
		height: 440px;
		border-radius: 0 220px 220px 0;
		background: rgba(18, 18, 18, 0.55);
		backdrop-filter: blur(20px);
		-webkit-backdrop-filter: blur(20px);
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-left: none;
		box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
		z-index: 1000;
		transition: transform 0.6s cubic-bezier(0.16, 1, 0.3, 1);
	}

	.floor-dial.collapsed {
		transform: translate(-200px, -50%);
	}

	.time-dial {
		position: fixed;
		right: -40px;
		top: 50%;
		transform: translateY(-50%);
		width: 230px;
		height: 440px;
		border-radius: 220px 0 0 220px;
		background: rgba(18, 18, 18, 0.55);
		backdrop-filter: blur(20px);
		-webkit-backdrop-filter: blur(20px);
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-right: none;
		box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
		z-index: 1000;
		transition: transform 0.6s cubic-bezier(0.16, 1, 0.3, 1);
	}

	.time-dial.collapsed {
		transform: translate(215px, -50%);
	}

	/* Toggle buttons styling */
	.dial-toggle-btn {
		position: absolute;
		width: 36px;
		height: 36px;
		border-radius: 50%;
		border: 1.2px solid rgba(255, 255, 255, 0.15);
		background: rgba(30, 30, 30, 0.45);
		backdrop-filter: blur(10px);
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		transition: all 0.4s cubic-bezier(0.25, 1, 0.5, 1);
		z-index: 30;
		padding: 0;
	}

	.left-dial-toggle {
		left: 200px;
		top: 50%;
		transform: translateY(-50%);
	}

	.right-dial-toggle {
		right: 210px;
		top: 50%;
		transform: translateY(-50%);
	}

	.right-dial-toggle.active-golden {
		background: rgba(222, 173, 102, 1) !important;
		border-color: rgba(222, 173, 102, 1) !important;
		box-shadow: 0 0 15px rgba(222, 173, 102, 0.5);
		width: 48px;
		height: 48px;
		right: 145px;
	}

	/* Center labels for Floor Dial */
	.dial-center-label {
		position: absolute;
		left: 40px;
		top: 50%;
		transform: translateY(-50%);
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		pointer-events: none;
		user-select: none;
	}

	.right-dial-label { 
		left: 80px !important;
		right: auto !important;
		align-items: flex-start !important;
		text-align: center !important;
	}

	/* Dial buttons wrapper and absolute layout */
	.dial-buttons {
		position: absolute;
		inset: 0;
		pointer-events: none;
	}

	/* Radial Ticks */
	.dial-tick {
		position: absolute;
		width: 6px;
		height: 1px;
		background: rgba(255, 255, 255, 0.18);
		transform-origin: left center;
		pointer-events: none;
	}

	/* Floor Button along arc */
	.dial-floor-btn {
		position: absolute;
		width: 28px;
		height: 28px;
		border-radius: 50%;
		border: none;
		background: transparent;
		color: rgba(255, 255, 255, 0.5);
		font-size: 20px;
		font-weight: 500;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		pointer-events: auto;
		transform: translate(-50%, -50%);
		transition: all 0.3s cubic-bezier(0.25, 1, 0.5, 1);
		padding: 0;
	}

	.dial-floor-btn:hover {
		color: white;
		font-weight: bold;
		scale: 1.15;
	}

	.dial-floor-btn.active {
		background: rgba(222, 173, 102, 1) !important;
		color: white !important;
		font-weight: bold;
		width: 48px;
		height: 35px;
		font-size: 20px;
		border-radius: 9999px !important;
		box-shadow: 0 0 15px rgba(222, 173, 102, 0.45);
	}

	/* Time Button along arc */
	.dial-time-btn {
		position: absolute;
		width: 36px;
		height: 36px;
		border-radius: 50%;
		border: 1px solid rgba(255, 255, 255, 0.15);
		background: rgba(0, 0, 0, 0.35);
		color: rgba(255, 255, 255, 0.6);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		pointer-events: auto;
		transform: translate(50%, -50%);
		transition: all 0.3s cubic-bezier(0.25, 1, 0.5, 1);
		padding: 0;
	}

	.dial-time-btn:hover {
		border-color: white;
		color: white;
		scale: 1.1;
	}

	.dial-time-btn.active {
		background: rgba(222, 173, 102, 1) !important;
		border-color: rgba(222, 173, 102, 1) !important;
		color: white !important;
		width: 48px;
		height: 48px;
		box-shadow: 0 0 15px rgba(222, 173, 102, 0.45);
	}
	
	/* Hotspot Toggle Pill at Top Center */
	.hotspot-toggle-pill {
		position: fixed;
		top: 20px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 1000;
		background: rgba(30, 30, 30, 0.45);
		border-radius: 9999px;
		padding: 8px 12px 8px 20px;
		display: flex;
		align-items: center;
		gap: 16px;
		backdrop-filter: blur(10px);
		-webkit-backdrop-filter: blur(10px);
		border: 1.2px solid rgba(255, 255, 255, 0.15);
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.35);
	}

	.toggle-pill-label {
		color: rgba(255, 255, 255, 0.85);
		font-size: 11px;
		font-weight: 500;
		letter-spacing: 0.08em; 
		font-family: 'Imprima', sans-serif;
	}

	.toggle-pill-btn {
		width: 28px;
		height: 28px;
		border-radius: 50%;
		border: none;
		background: rgba(0, 0, 0, 0.45);
		color: rgba(255, 255, 255, 0.6);
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		transition: all 0.3s cubic-bezier(0.25, 1, 0.5, 1);
		padding: 0;
	}

	.toggle-pill-btn:hover {
		color: white;
		background: rgba(0, 0, 0, 0.65);
	}

	.toggle-pill-btn.active {
		background: rgba(222, 173, 102, 1) !important;
		color: white !important;
		box-shadow: 0 0 10px rgba(222, 173, 102, 0.4);
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

	/* Overview Badge */
	.overview-badge {
		position: fixed;
		bottom: 20px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 1000;
		background: rgba(255, 212, 0, 0.9);
		border-radius: 20px;
		padding: 10px 20px;
		display: flex;
		align-items: center;
		gap: 8px;
		color: #0f5da8;
		font-size: 13px;
		font-weight: 600;
		box-shadow: 0 4px 16px rgba(255, 212, 0, 0.3);
		animation: slideUp 0.5s ease;
	}

	@keyframes slideUp {
		from {
			opacity: 0;
			transform: translateX(-50%) translateY(20px);
		}
		to {
			opacity: 1;
			transform: translateX(-50%) translateY(0);
		}
	}

	:global(.info-hotspot) {
		position: absolute;
	}

	/* Responsive styling for semi-circular dials and controls */
	@media (max-width: 768px), (max-width: 950px) and (orientation: landscape) {
		.floor-dial {
			width: 220px !important;
			transform: translateY(-50%) scale(0.65) !important;
			transform-origin: left center;
		}
		.floor-dial.collapsed {
			transform: translate(-225px, -50%) scale(0.65) !important;
			transform-origin: left center;
		}

		.time-dial {
			width: 250px !important;
			right: -10px !important;
			transform: translateY(-50%) scale(0.65) !important;
			transform-origin: right center;
		}
		.time-dial.collapsed {
			transform: translate(225px, -50%) scale(0.65) !important;
			transform-origin: right center;
		}
		.right-dial-toggle {
			right: 230px !important;
		}

		.dial-center-label:not(.right-dial-label) span:nth-child(2) {
			font-size: 14px !important;
		}

		.right-dial-label {
			right: auto !important;
			left: 110px !important;
			align-items: flex-start !important;
			text-align: left !important;
		}
		.right-dial-label span:nth-child(1) {
			font-size: 7px !important;
		}
		.right-dial-label span:nth-child(2) {
			font-size: 18px !important;
			letter-spacing: 0.05em !important;
		}

		:global(.minimized-sidebar-tab) {
			transform: translateY(-50%) scale(0.65) !important;
			transform-origin: left center !important;
			margin-top: 0 !important;
		}
		
		:global(.minimized-sidebar-tab-right) {
			transform: translateY(-50%) scale(0.65) !important;
			transform-origin: right center !important;
		}

		:global(.overview-hotspot .hotspot-pulse-dot) {
			width: 32px !important;
			height: 32px !important;
			left: -16px !important;
			top: -16px !important;
		}

		.go-back-btn {
			bottom: 16px !important;
			left: 16px !important;
			padding: 6px 16px !important;
			font-size: 10px !important;
		}

		.hotspot-toggle-pill {
			top: 16px !important;
			padding: 6px 12px 6px 16px !important;
			gap: 10px !important;
		}
	}

	@media (max-width: 480px) {
		.floor-dial {
			transform: translateY(-50%) scale(0.52) !important;
			transform-origin: left center;
		}
		.floor-dial.collapsed {
			transform: translate(-185px, -50%) scale(0.52) !important;
			transform-origin: left center;
		}

		.time-dial {
			right: 0px !important;
			transform: translateY(-50%) scale(0.52) !important;
			transform-origin: right center;
		}
		.time-dial.collapsed {
			transform: translate(220px, -50%) scale(0.52) !important;
			transform-origin: right center;
		}
		.right-dial-toggle {
			right: 230px !important;
		}
		.right-dial-label {
			left: 100px !important;
			right: auto !important;
		}

		:global(.minimized-sidebar-tab) {
			transform: translateY(-50%) scale(0.52) !important;
			transform-origin: left center !important;
			margin-top: 0 !important;
		}
		
		:global(.minimized-sidebar-tab-right) {
			transform: translateY(-50%) scale(0.52) !important;
			transform-origin: right center !important;
		}

		:global(.overview-hotspot .hotspot-pulse-dot) {
			width: 26px !important;
			height: 26px !important;
			left: -13px !important;
			top: -13px !important;
		}
	}

	/* Hotspots Animations & Glassmorphism styles */
	:global(.overview-hotspot) {
		position: absolute;
		pointer-events: none;
		opacity: 0;
		visibility: hidden;
		transition: opacity 0.3s ease, visibility 0.3s ease;
	}

	:global(.overview-hotspot.visible) {
		opacity: 1;
		visibility: visible;
	}

	:global(.overview-hotspot:hover) {
		z-index: 2147483647 !important;
	}

	:global(.overview-hotspot:hover .overview-hotspot-label) {
		z-index: 2147483647 !important;
	}

	:global(.overview-hotspot .hotspot-pulse-dot) {
		position: absolute;
		width: 44px;
		height: 44px;
		background: url('/hotspot.png') no-repeat center center;
		background-size: contain;
		left: -22px;
		top: -22px;
		z-index: 2;
		transition: transform 0.25s cubic-bezier(0.25, 1, 0.5, 1);
	}

	:global(.overview-hotspot .hotspot-pulse-dot:hover) {
		transform: scale(1.15);
	}



	:global(.overview-hotspot .hotspot-line) {
		position: absolute;
		bottom: 0;
		left: -1px;
		width: 2px;
		height: var(--hotspot-height, 75px);
		background: linear-gradient(to top, #ffffff 0%, rgba(255, 255, 255, 0.8) 40%, rgba(255, 255, 255, 0.1) 100%);
		transform-origin: bottom;
		transform: scaleY(0);
	}
	
	:global(.overview-hotspot .hotspot-pulse-dot) {
		pointer-events: auto !important;
		cursor: pointer !important;
	}

	:global(.overview-hotspot.visible .hotspot-line) {
		transform: scaleY(0) !important;
	}
	:global(.overview-hotspot.visible:hover .hotspot-line) {
		transform: scaleY(1) !important;
	}

	:global(.overview-hotspot .overview-hotspot-label) {
		/* Reset global .hotspot styles */
		margin-top: 0 !important;
		padding: 6px 28px 6px 6px !important;
		border-radius: 9999px !important;
		
		/* White capsule background */
		background: #ffffff !important;
		border: 1.2px solid rgba(0, 0, 0, 0.08) !important;
		text-shadow: none !important;

		/* Flex layout */
		display: flex !important;
		align-items: center !important;
		gap: 16px !important;

		/* Positioning and initial state */
		position: absolute !important;
		bottom: var(--hotspot-height, 75px) !important;
		pointer-events: auto !important;
		cursor: pointer !important;
		white-space: nowrap !important;
		z-index: 3;
	}

	/* Image styling inside label */
	:global(.overview-hotspot .hotspot-label-img) {
		width: 60px !important;
		height: 60px !important;
		border-radius: 50% !important;
		object-fit: cover !important;
		display: block !important;
		pointer-events: none !important;
	}

	/* Text container styling */
	:global(.overview-hotspot .hotspot-label-text-container) {
		display: flex !important;
		flex-direction: column !important;
		align-items: flex-start !important;
		justify-content: center !important;
		gap: 2px !important;
		pointer-events: none !important;
	}

	/* Title styling */
	:global(.overview-hotspot .hotspot-label-title) {
		color: #b08d4f !important;
		font-size: 17px !important;
		font-weight: 550 !important;
		font-family: 'Outfit', 'Inter', sans-serif !important;
		line-height: 1.2 !important;
	}

	/* Subtitle styling */
	:global(.overview-hotspot .hotspot-label-subtitle) {
		color: #2c3539 !important;
		font-size: 14px !important;
		font-weight: 400 !important;
		font-family: 'Outfit', 'Inter', sans-serif !important;
		line-height: 1.2 !important;
	}

	/* Remove the ::before arrow from our overview hotspot */
	:global(.overview-hotspot .overview-hotspot-label::before) {
		display: none !important;
		content: none !important;
	}

	/* Alignment-specific styles */
	:global(.overview-hotspot.hotspot-right .overview-hotspot-label) {
		left: -15px !important;
		right: auto !important;
		transform: translateX(-15px) scale(0.95) !important;
		opacity: 0 !important;
		clip-path: inset(0 100% 0 0) !important;
		transition: opacity 0.5s cubic-bezier(0.25, 1, 0.5, 1), 
		            transform 0.5s cubic-bezier(0.25, 1, 0.5, 1),
		            clip-path 0.6s cubic-bezier(0.25, 1, 0.5, 1),
		            background-color 0.3s ease,
		            border-color 0.3s ease,
		            box-shadow 0.3s ease !important;
	}

	:global(.overview-hotspot.hotspot-right.visible:hover .overview-hotspot-label) {
		opacity: 1 !important;
		transform: translateX(0) scale(1) !important;
		clip-path: inset(0 0 0 0) !important;
	}

	:global(.overview-hotspot.hotspot-left .overview-hotspot-label) {
		right: -15px !important;
		left: auto !important;
		transform: translateX(15px) scale(0.95) !important;
		opacity: 0 !important;
		clip-path: inset(0 0 0 100%) !important;
		transition: opacity 0.5s cubic-bezier(0.25, 1, 0.5, 1), 
		            transform 0.5s cubic-bezier(0.25, 1, 0.5, 1),
		            clip-path 0.6s cubic-bezier(0.25, 1, 0.5, 1),
		            background-color 0.3s ease,
		            border-color 0.3s ease,
		            box-shadow 0.3s ease !important;
	}

	:global(.overview-hotspot.hotspot-left.visible:hover .overview-hotspot-label) {
		opacity: 1 !important;
		transform: translateX(0) scale(1) !important;
		clip-path: inset(0 0 0 0) !important;
	}

	/* Premium Hover effect */
	:global(.overview-hotspot.hotspot-right .overview-hotspot-label:hover) {
		border-color: rgba(176, 141, 79, 0.7) !important;
		box-shadow: 0 12px 36px rgba(176, 141, 79, 0.25), 0 6px 16px rgba(0, 0, 0, 0.12) !important;
		transform: translateX(2px) scale(1.03) !important;
	}

	:global(.overview-hotspot.hotspot-left .overview-hotspot-label:hover) {
		border-color: rgba(176, 141, 79, 0.7) !important;
		box-shadow: 0 12px 36px rgba(176, 141, 79, 0.25), 0 6px 16px rgba(0, 0, 0, 0.12) !important;
		transform: translateX(-2px) scale(1.03) !important;
	}

	@media (max-width: 1600px) {
		:global(.overview-hotspot .overview-hotspot-label) {
			padding: 5px 22px 5px 5px !important;
			gap: 12px !important;
		}
		:global(.overview-hotspot .hotspot-label-img) {
			width: 40px !important;
			height: 40px !important;
		}
		:global(.overview-hotspot .hotspot-label-title) {
			font-size: 14px !important;
		}
		:global(.overview-hotspot .hotspot-label-subtitle) {
			font-size: 12px !important;
		}
	}

	@media (max-width: 768px) {
		:global(.overview-hotspot .overview-hotspot-label) {
			padding: 4px 16px 4px 4px !important;
			gap: 10px !important;
		}
		:global(.overview-hotspot .hotspot-label-img) {
			width: 44px !important;
			height: 44px !important;
		}
		:global(.overview-hotspot .hotspot-label-title) {
			font-size: 13px !important;
		}
		:global(.overview-hotspot .hotspot-label-subtitle) {
			font-size: 10px !important;
		}
	}

	/* Working Compass Styles */
	.compass-container {
		position: fixed;
		top: 80px;
		left: 50%;
		transform: translateX(-50%);
		width: 60px;
		height: 60px;
		border-radius: 50%;
		background: rgba(30, 30, 30, 0.45);
		backdrop-filter: blur(10px);
		-webkit-backdrop-filter: blur(10px);
		border: 1.2px solid rgba(255, 255, 255, 0.15);
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.35);
		z-index: 1000;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.compass-dial {
		position: relative;
		width: 100%;
		height: 100%;
		border-radius: 50%;
		transition: transform 0.1s ease-out;
	}

	.direction-n, .direction-s, .direction-e, .direction-w {
		position: absolute;
		font-family: 'Imprima', sans-serif;
		font-size: 9px;
		font-weight: 700;
		color: rgba(255, 255, 255, 0.7);
		line-height: 1;
	}

	.direction-n {
		top: 6px;
		left: 50%;
		transform: translateX(-50%);
		color: #DEAD66;
	}

	.direction-s {
		bottom: 6px;
		left: 50%;
		transform: translateX(-50%);
	}

	.direction-e {
		right: 6px;
		top: 50%;
		transform: translateY(-50%);
	}

	.direction-w {
		left: 6px;
		top: 50%;
		transform: translateY(-50%);
	}

	.compass-needle-wrapper {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: 18px;
		height: 36px;
	}

	.compass-needle-svg {
		width: 100%;
		height: 100%;
	}

	.compass-heading-marker {
		position: absolute;
		top: -4px;
		left: 50%;
		transform: translateX(-50%);
		width: 0;
		height: 0;
		border-left: 4px solid transparent;
		border-right: 4px solid transparent;
		border-bottom: 6px solid #DEAD66;
		z-index: 1001;
	}

	@media (max-width: 768px) {
		.compass-container {
			top: 70px !important;
			width: 50px !important;
			height: 50px !important;
		}
		.direction-n, .direction-s, .direction-e, .direction-w {
			font-size: 8px !important;
		}
		.direction-n { top: 4px; }
		.direction-s { bottom: 4px; }
		.direction-e { right: 4px; }
		.direction-w { left: 4px; }
		.compass-needle-wrapper {
			width: 14px !important;
			height: 28px !important;
		}
	}

	/* Elevate the z-index of Marzipano's hotspot container to be higher than controls/dials,
	   while keeping #pano and its canvas at z-index: auto (under the controls/dials). */
	:global(.mz-hotspot-container),
	:global(.marzipano-hotspots-container),
	:global(#pano div:has(> .overview-hotspot)) {
		z-index: 2000 !important;
	}

</style>
