<script>
	import Home from './Home.svelte';
	import { setContext, getContext } from 'svelte';
	import { writable } from 'svelte/store';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { fade } from 'svelte/transition';
	import 'iconify-icon';
	import instructionIcon from '$lib/images/instruction-icon.svg';
	import instructionPanoIcon from '$lib/images/instruction-pano.svg';
	import newRahejaVid from '$lib/videos/new-raheja1.mp4';
	// Poster is a base64 data URI baked into this .js module (see intro-poster.js) rather
	// than a plain asset import — a plain import emits a separate hashed file, and on a
	// slow connection that extra round-trip recreates the exact black-flash we're fixing.
	import introPoster from '$lib/images/intro-poster.js';
	import views1Video from '$lib/videos/views1.mp4';
	import vicinityVideo from '$lib/videos/vicinity.mp4';
	import subtractImg from '$lib/images/subtract.png';
	import { onMount, onDestroy, tick } from 'svelte';
	import { gsap } from 'gsap';
	// Create a store and update it when necessary...
	const hotspotName = getContext('hotspotName');
	const currentUI = getContext('currentUI');
	const walkthroughDisabled = getContext('walkthroughDisabled');

	const UIPanel = getContext('UIPanel');
	const introVideoLastFrame = getContext('introVideoLastFrame');

	const instructionPano = writable();
	$effect(() => {
		instructionPano.set(true);
	});

	function inIframe() {
		try {
			return window.self !== window.top;
		} catch (e) {
			return true;
		}
	}
	let isIframe = $state(inIframe());
	let introVideoMuted = $state(true);
	let showVideoIntro = $state(false);
	let introVideoReady = $state(false);
	let introAudioBlocked = $state(false);
	let introTransitioning = $state(false);
	let typedSubheading = $state('');
	let introPlaybackEl = null;
	let exitFogEl = null;

	const INTRO_SUBHEADING = 'Leading Real Estate Developer in India';
	let typingTimer;
	let exitFogTween;

	// Svelte 5 state variables for menu content
	let showMenuContent = $state(false);
	let shouldAnimateMenu = $state(false);
	let transitionTriggered = false;
	let activeCategoryTitle = $state('');
	let activeCategoryDesc = $state('');
	let menuBgUrl = $derived(introVideoLastFrame ? ($introVideoLastFrame || '/rahejanew1.png') : '/rahejanew1.png');

	function after(ms, fn) {
		return setTimeout(fn, ms);
	}

	let currentSlide = $state(1);
	let cardsCollapsed = $state(true);
	let card1W = $state(420);
	let card1H = $state(231);
	let card2W = $state(420);
	let card2H = $state(231);

	let menuUIHidden = $state(false);
	let showClouds = $state(false);
	let cloudOverlayEl = null;
	let cloudImgEl = null;
	let cloudTimeline;
	const introTimers = [];

	let canvas = $state(null);
	let gl = null;
	let program = null;
	let positionBuffer = null;
	let texture = null;
	let ripples = $state([]);
	let rippleId = 0;
	let lastMouseX = 0;
	let lastMouseY = 0;
	const SPAWN_DISTANCE = 30;
	let imageLoaded = $state(false);
	let imageWidth = 0;
	let imageHeight = 0;
	let uScale = 1.0;
	let vScale = 1.0;
	let uOffset = 0.0;
	let vOffset = 0.0;
	let animationFrameId = null;

	// DOM element references for GSAP animations
	let menuDescEl = null;
	let sliderMenuEl = null;
	let videoIntroScreenEl = null;
	let introOverlayEl = null;
	let introOverlayTween;

	// Debug logs to trace state transitions
	$effect(() => {
		console.log('[DEBUG] showMenuContent state changed:', showMenuContent);
	});
	$effect(() => {
		console.log('[DEBUG] UIPanel state changed:', $UIPanel);
	});

	// Automatically listen to URL query param menu=true (for navigating back from views/vicinities)
	$effect(() => {
		if ($page.url.searchParams.get('menu') === 'true') {
			shouldAnimateMenu = false; // Do NOT animate when returning from subpages
			showMenuContent = true;
			UIPanel?.set('menu');
			showVideoIntro = false;
		}
	});

	let unsubscribeUIPanel;

	// Initialize WebGL when the canvas is mounted
	$effect(() => {
		if (showMenuContent && canvas) {
			// If we are playing the intro transition, delay WebGL initialization to keep animations smooth.
			// Otherwise (e.g. returning to menu), initialize instantly.
			const delay = shouldAnimateMenu ? 2000 : 0;

			const timer = setTimeout(() => {
				initWebGL();
				window.addEventListener('resize', handleResize);
			}, delay);

			return () => {
				clearTimeout(timer);
				window.removeEventListener('resize', handleResize);
				if (animationFrameId) cancelAnimationFrame(animationFrameId);
			};
		}
	});

	// Automatically run the menu transition when showMenuContent becomes true
	$effect(() => {
		if (showMenuContent && !shouldAnimateMenu) {
			// Instantly set them to their fully visible states with no transition
			gsap.set('.menu-desc-container, .slider-menu', {
				opacity: 1,
				scale: 1,
				z: 0
			});
		}
	});

	// Grabs the video's final rendered frame so WebGL canvas can use it as its background.
	function captureIntroLastFrame() {
		if (!introPlaybackEl) return;
		try {
			const canvas = document.createElement('canvas');
			canvas.width = introPlaybackEl.videoWidth;
			canvas.height = introPlaybackEl.videoHeight;
			canvas.getContext('2d').drawImage(introPlaybackEl, 0, 0);
			introVideoLastFrame.set(canvas.toDataURL('image/jpeg', 0.9));
		} catch (e) {
			// capture failed
		}
	}

	function handleVideoTimeUpdate() {
		// Do nothing to let the video play to the very end
	}

	function handleIntroVideoEnded() {
		if (!transitionTriggered) {
			transitionTriggered = true;
			triggerMenuTransition(false);
		}
	}

	function skipIntroVideo() {
		if (transitionTriggered) return;
		transitionTriggered = true;
		if (typingTimer) clearTimeout(typingTimer);
		if (introPlaybackEl) {
			try {
				introPlaybackEl.pause();
			} catch (e) {}
		}
		if (introVideoLastFrame) {
			introVideoLastFrame.set('/rahejanew1.png');
		}
		triggerMenuTransition(true);
	}

	async function triggerMenuTransition(isSkip = false) {
		if (!isSkip) {
			captureIntroLastFrame();
		}

		// Mount menu content immediately with no entry animations, and keep the navcard closed
		shouldAnimateMenu = false;
		showMenuContent = true;
		cardsCollapsed = true;
		UIPanel?.set('menu');

		// Wait for Svelte to mount the menu elements in the DOM
		await tick();

		const fadeDuration = isSkip ? 0.6 : 1.5;
		const textFadeDuration = isSkip ? 0.4 : 1.2;

		// Fade out the center text slowly and naturally
		gsap.to('.video-intro-text', {
			opacity: 0,
			duration: textFadeDuration,
			ease: 'sine.inOut'
		});

		// Fade out the video intro screen container to reveal the menu container behind it smoothly
		gsap.to('.video-intro-screen', {
			opacity: 0,
			duration: fadeDuration,
			ease: 'power2.out',
			onComplete: () => {
				try {
					console.log('[DEBUG] video intro screen fade completed');
					showVideoIntro = false;
				} catch (err) {
					console.error(err);
				}
			}
		});
	}

	function typeSubheadingLoop() {
		let i = 0;

		function tickLoop() {
			i++;
			typedSubheading = INTRO_SUBHEADING.slice(0, i);
			if (i < INTRO_SUBHEADING.length) {
				typingTimer = setTimeout(tickLoop, 60);
			}
		}

		tickLoop();
	}

	async function startExperience() {
		if (!(window.self !== window.top) && window.innerWidth < 1200) {
			if (document.body.requestFullscreen) {
				document.body.requestFullscreen();
			} else if (document.body.webkitRequestFullscreen) {
				document.body.webkitRequestFullscreen();
			} else if (document.body.msRequestFullscreen) {
				document.body.msRequestFullscreen();
			}
		}

		transitionTriggered = false;
		introVideoReady = false;
		introAudioBlocked = false;
		UIPanel?.set('loaded');
		showVideoIntro = true;
		typeSubheadingLoop();

		// Attempt unmuted playback while still inside this click's user-activation
		// window (tick() is only a microtask away, so the gesture still counts).
		// Falls back to muted + a tap-to-unmute affordance if the browser blocks it.
		await tick();
		if (introPlaybackEl) {
			introPlaybackEl.muted = false;
			introPlaybackEl.play().catch(() => {
				introPlaybackEl.muted = true;
				introAudioBlocked = true;
				introPlaybackEl.play().catch(() => {});
			});
		}
	}

	function unmuteIntro(event) {
		event?.stopPropagation();
		if (introPlaybackEl) {
			introPlaybackEl.muted = false;
			introPlaybackEl.play().catch(() => {});
			introAudioBlocked = false;
		}
	}

	// WebGL ripple background logic
	const vertexShaderSource = `
		attribute vec2 a_position;
		varying vec2 v_texCoord;
		uniform vec2 u_uvScale;
		uniform vec2 u_uvOffset;
		void main() {
			gl_Position = vec4(a_position, 0.0, 1.0);
			vec2 uv = a_position * 0.5 + 0.5;
			uv.y = 1.0 - uv.y;
			v_texCoord = uv * u_uvScale + u_uvOffset;
		}
	`;

	const fragmentShaderSource = `
		precision mediump float;
		varying vec2 v_texCoord;
		uniform sampler2D u_image;
		uniform float u_aspectRatio;

		uniform vec4 u_ripples[30];
		uniform int u_rippleCount;

		void main() {
			vec2 tc = v_texCoord;
			vec2 displacement = vec2(0.0);

			for (int i = 0; i < 30; i++) {
				if (i >= u_rippleCount) break;
				
				vec4 ripple = u_ripples[i];
				vec2 ripplePos = ripple.xy;
				float progress = ripple.z;
				float intensity = ripple.w;

				vec2 diff = tc - ripplePos;
				diff.y /= u_aspectRatio;

				float dist = length(diff);
				
				float waveRadius = progress * 0.5;
				float waveWidth = 0.07;
				
				if (dist > 0.0 && dist < waveRadius + waveWidth && dist > waveRadius - waveWidth) {
					float d = dist - waveRadius;
					float x = d / waveWidth;
					float wave = sin(x * 3.14159) * (1.0 - progress);
					displacement += normalize(diff) * wave * 0.012 * intensity;
				}
			}

			displacement.y *= u_aspectRatio;
			gl_FragColor = texture2D(u_image, tc - displacement);
		}
	`;

	function createShader(gl, type, source) {
		const shader = gl.createShader(type);
		gl.shaderSource(shader, source);
		gl.compileShader(shader);
		if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
			console.error('Shader compile error:', gl.getShaderInfoLog(shader));
			gl.deleteShader(shader);
			return null;
		}
		return shader;
	}

	function initWebGL() {
		try {
			if (!canvas) return;
			gl = canvas.getContext('webgl');
			if (!gl) {
				console.error('WebGL not supported');
				return;
			}

			const vs = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
			const fs = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
			if (!vs || !fs) {
				console.error('Failed to compile shaders');
				return;
			}
			program = gl.createProgram();
			gl.attachShader(program, vs);
			gl.attachShader(program, fs);
			gl.linkProgram(program);

			if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
				console.error('Program link error:', gl.getProgramInfoLog(program));
				return;
			}

			positionBuffer = gl.createBuffer();
			gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
			gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
				-1.0, -1.0,
				 1.0, -1.0,
				-1.0,  1.0,
				-1.0,  1.0,
				 1.0, -1.0,
				 1.0,  1.0,
			]), gl.STATIC_DRAW);

			texture = gl.createTexture();
			gl.bindTexture(gl.TEXTURE_2D, texture);
			
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

			const img = new Image();
			img.onload = () => {
				try {
					if (!gl) return;
					gl.bindTexture(gl.TEXTURE_2D, texture);
					gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
					imageWidth = img.naturalWidth;
					imageHeight = img.naturalHeight;
					imageLoaded = true;
					resizeCanvas();
					updateUVScale(imageWidth, imageHeight);
					requestRender();
				} catch (err) {
					console.error('Error loading WebGL texture image:', err);
				}
			};
			img.src = menuBgUrl;
		} catch (err) {
			console.error('WebGL initialization crashed:', err);
		}
	}

	function updateUVScale(imgWidth, imgHeight) {
		if (!canvas) return;
		const canvasWidth = canvas.width;
		const canvasHeight = canvas.height;

		const imageRatio = imgWidth / imgHeight;
		const canvasRatio = canvasWidth / canvasHeight;

		if (canvasRatio > imageRatio) {
			uScale = 1.0;
			vScale = imageRatio / canvasRatio;
			uOffset = 0.0;
			vOffset = (1.0 - vScale) * 0.5;
		} else {
			uScale = canvasRatio / imageRatio;
			vScale = 1.0;
			uOffset = (1.0 - uScale) * 0.5;
			vOffset = 0.0;
		}
	}

	function resizeCanvas() {
		if (!canvas || !gl) return;
		const displayWidth = window.innerWidth;
		const displayHeight = window.innerHeight;
		if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
			canvas.width = displayWidth;
			canvas.height = displayHeight;
			gl.viewport(0, 0, canvas.width, canvas.height);
		}
	}

	function requestRender() {
		if (animationFrameId) cancelAnimationFrame(animationFrameId);
		animationFrameId = requestAnimationFrame(render);
	}

	function render() {
		if (!gl || !imageLoaded) return;

		resizeCanvas();

		gl.clearColor(0.0, 0.0, 0.0, 1.0);
		gl.clear(gl.COLOR_BUFFER_BIT);

		gl.useProgram(program);

		const positionLoc = gl.getAttribLocation(program, 'a_position');
		gl.enableVertexAttribArray(positionLoc);
		gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
		gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);

		const uvScaleLoc = gl.getUniformLocation(program, 'u_uvScale');
		gl.uniform2f(uvScaleLoc, uScale, vScale);

		const uvOffsetLoc = gl.getUniformLocation(program, 'u_uvOffset');
		gl.uniform2f(uvOffsetLoc, uOffset, vOffset);

		const aspectLoc = gl.getUniformLocation(program, 'u_aspectRatio');
		gl.uniform1f(aspectLoc, canvas.width / canvas.height);

		const maxRipples = 30;
		const ripplesData = new Float32Array(maxRipples * 4);
		const count = Math.min(ripples.length, maxRipples);

		for (let i = 0; i < count; i++) {
			const r = ripples[i];
			const idx = i * 4;
			ripplesData[idx] = r.x / canvas.width;
			ripplesData[idx + 1] = 1.0 - (r.y / canvas.height);
			ripplesData[idx + 2] = r.progress;
			ripplesData[idx + 3] = r.intensity;
		}

		const ripplesLoc = gl.getUniformLocation(program, 'u_ripples');
		gl.uniform4fv(ripplesLoc, ripplesData);

		const countLoc = gl.getUniformLocation(program, 'u_rippleCount');
		gl.uniform1i(countLoc, count);

		gl.drawArrays(gl.TRIANGLES, 0, 6);

		if (ripples.length > 0) {
			const now = Date.now();
			ripples = ripples.map(r => {
				const elapsed = now - r.startTime;
				const duration = r.type === 'click' ? 1200 : 800;
				return {
					...r,
					progress: elapsed / duration
				};
			}).filter(r => r.progress < 1.0);

			animationFrameId = requestAnimationFrame(render);
		} else {
			animationFrameId = null;
		}
	}

	function handleResize() {
		resizeCanvas();
		if (imageWidth && imageHeight) {
			updateUVScale(imageWidth, imageHeight);
		}
		requestRender();
	}

	function spawnRipple(x, y, type) {
		const id = rippleId++;
		const intensity = type === 'click' ? 0.5 : 0.15;
		ripples = [...ripples, {
			id,
			x,
			y,
			type,
			startTime: Date.now(),
			progress: 0.0,
			intensity
		}];

		if (!animationFrameId) {
			requestRender();
		}
	}

	function handlePageClick(e) {
		if (e.target.closest('.slider-menu')) {
			return;
		}
		spawnRipple(e.clientX, e.clientY, 'click');
	}

	function handleMouseMove(e) {
		if (e.target.closest('.slider-menu')) {
			return;
		}
		const distance = Math.hypot(e.clientX - lastMouseX, e.clientY - lastMouseY);
		if (distance > SPAWN_DISTANCE) {
			lastMouseX = e.clientX;
			lastMouseY = e.clientY;
			spawnRipple(e.clientX, e.clientY, 'hover');
		}
	}

	async function handleExploreClick() {
		const destination = currentSlide === 1 ? 'views' : 'vicinity';
		const targetPath = destination === 'views' ? '/views' : '/vicinities';

		activeCategoryTitle = destination === 'views' ? 'VIEWS' : 'VICINITY';
		activeCategoryDesc = destination === 'views' 
			? 'Discover Mumbai Through Immersive Aerial Perspectives, Revealing The Landmarks That Define This Exceptional Address.'
			: 'Discover the neighbourhood from an aerial perspective. Explore key landmarks, local destinations, and the vibrant surroundings through an interactive experience.';

		menuUIHidden = true;
		showClouds = true;
		await tick();

		// Fade out the menu background layer so the blur on the overlay stands out
		gsap.to('.menu-bg-layer', { opacity: 0.1, duration: 1.5, ease: 'power2.out' });

		if (cloudOverlayEl && cloudImgEl) {
			// Set initial states
			gsap.set(cloudImgEl, { yPercent: 100, opacity: 0, scale: 1.8, filter: 'blur(15px)' });
			gsap.set('.transition-cloud-left', { yPercent: 100, xPercent: -50, scale: 1.8, opacity: 0 });
			gsap.set('.transition-cloud-right', { yPercent: 100, xPercent: 50, scale: 1.8, opacity: 0 });
			gsap.set('.transition-text-content', { y: 60, opacity: 0, scale: 0.95 });
			gsap.set('.transition-title', { opacity: 0 });
			gsap.set('.transition-subheading', { opacity: 0 });

			// Blur transition background overlay (pure blur, no background overlay color/whites tint)
			gsap.fromTo(cloudOverlayEl, 
				{ backdropFilter: 'blur(0px)' },
				{ backdropFilter: 'blur(16px)', duration: 1.5, ease: 'power2.out' }
			);

			// 1. Big cloud moves first from bottom to top
			gsap.to(cloudImgEl, {
				yPercent: -150,
				opacity: 0.75,
				filter: 'blur(0px)',
				duration: 2.2,
				ease: 'power2.inOut'
			});

			// 2. The center text and the two corner clouds follow it up (after a 0.4s delay)
			const followDelay = 0.4;

			// Center Card comes up and settles
			gsap.to('.transition-text-content', {
				opacity: 1,
				y: 0,
				scale: 1,
				duration: 1.6,
				ease: 'power3.out',
				delay: followDelay
			});

			// Staggered text fade in inside the card
			gsap.to('.transition-title', {
				opacity: 1,
				duration: 1.2,
				ease: 'power2.out',
				delay: followDelay + 0.3
			});

			gsap.to('.transition-subheading', {
				opacity: 1,
				duration: 1.2,
				ease: 'power2.out',
				delay: followDelay + 0.5
			});

			// Left cloud comes up and settles in the top-left corner
			gsap.to('.transition-cloud-left', {
				xPercent: 0,
				yPercent: 0,
				scale: 1.3,
				opacity: 0.9,
				duration: 1.8,
				ease: 'power2.out',
				delay: followDelay + 0.1
			});

			// Right cloud comes up and settles in the top-right corner
			gsap.to('.transition-cloud-right', {
				xPercent: 0,
				yPercent: 0,
				scale: 1.3,
				opacity: 0.9,
				duration: 1.8,
				ease: 'power2.out',
				delay: followDelay + 0.1
			});
		}

		// Hold for 2 seconds (total time before navigation)
		after(2000, () => {
			if (destination === 'views') {
				$currentUI = {
					overview: false,
					views: true,
					Exterior: false,
					interiors: false,
					amenities: false,
					highlights: false,
					vicinity: false
				};
				goto('/views');
			} else {
				$currentUI = {
					overview: false,
					views: false,
					Exterior: false,
					interiors: false,
					amenities: false,
					highlights: false,
					vicinity: true
				};
				goto('/vicinities');
			}
		});

		// Clean up overlay state after transition page mounts
		after(3300, () => {
			showClouds = false;
			menuUIHidden = false; // Reset menu UI visibility state
		});
	}

	onDestroy(() => {
		if (typingTimer) clearTimeout(typingTimer);
		exitFogTween?.kill();
		introTimers.forEach(clearTimeout);
		cloudTimeline?.kill();
		introOverlayTween?.kill();
		if (unsubscribeUIPanel) unsubscribeUIPanel();
	});

	const toggleIntroAudio = (event) => {
		if (event) event.stopPropagation();
		const video = document.querySelector('.intro-video');
		if (video) {
			video.muted = !video.muted;
			introVideoMuted = video.muted;
			if (!video.muted) {
				video.play().catch((err) => console.log('Audio playback permission error:', err));
			}
		}
	};

	onMount(async () => {
		unsubscribeUIPanel = UIPanel.subscribe((val) => {
			if (val === 'loading') {
				showMenuContent = false;
				showVideoIntro = false;
				typedSubheading = '';
				transitionTriggered = false;
				introVideoReady = false;
				introAudioBlocked = false;
				if (introPlaybackEl) {
					try {
						introPlaybackEl.pause();
						introPlaybackEl.currentTime = 0;
					} catch (e) {}
				}
			}
		});

		function setElementHeight() {
			const vh = window.innerHeight * 0.01;
			document.documentElement.style.setProperty('--vh', `${vh}px`);
		}
		setElementHeight();
		// Update the height on resize
		window.addEventListener('resize', setElementHeight);
		let lastClickTime = 0;
		const clickTimeout = 300; // Timeout in milliseconds (adjustable)
		if (!(window.self !== window.top) && window.innerWidth < 1200) {
			window.addEventListener('click', () => {
				const now = Date.now();
				if (now - lastClickTime < clickTimeout) {
					if (document.body.requestFullscreen) {
						document.body.requestFullscreen();
					} else if (document.body.webkitRequestFullscreen) {
						/* Safari */
						document.body.webkitRequestFullscreen();
					} else if (document.body.msRequestFullscreen) {
						/* IE11 */
						document.body.msRequestFullscreen();
					}
				}
				lastClickTime = now;
			});
		}

		localStorage.getItem('instructions-view-count') == 4 && instructionPano.set(false);

		const video = document.querySelector('.intro-video');
		if (video) {
			video.muted = true;
			introVideoMuted = true;
			video.play().catch((e) => console.error('Video playback failed completely:', e));
		}
	});
	setContext('currentUI', currentUI);

	const show = (ui) => {
		$currentUI = {
			interiors: false,
			amenities: false,
			interiorsDollhouse: false,
			highlights: false
		};
		$currentUI[ui] = true;
		console.log('second', $currentUI);
	};
	hotspotName.subscribe((changedHotspot) => {
		if (changedHotspot == 'Exterior') {
			$currentUI['highlights'] = false;

			show('Exterior');
		}

		if (changedHotspot == 'lawn') {
			$currentUI['highlights'] = false;

			console.log($currentUI);
			show('amenities');
		}
	});

	//
</script>

<svelte:head>
	<title>K Raheja</title>
	<meta name="description" content="kl-raheja" />
	<link rel="prefetch" href="/vicinity-intro.mp4" as="video" type="video/mp4" />
</svelte:head>

<Home />
<div class="rotate-to-view">
	<svg
		width="594"
		height="641"
		viewBox="0 0 594 641"
		fill="none"
		xmlns="http://www.w3.org/2000/svg"
	>
		<g clip-path="url(#clip0_323_2301)">
			<path d="M251.999 151H341.999" stroke="#fff" stroke-width="12" stroke-linecap="round" />
			<circle cx="296.999" cy="457" r="12" fill="#fff" />
		</g>
		<rect x="203.999" y="147" width="186" height="352" rx="12" stroke="#fff" stroke-width="8" />
		<path
			d="M343.449 618.795C341.64 617.527 341.2 615.033 342.467 613.224L363.116 583.734C364.383 581.925 366.877 581.485 368.687 582.752C370.496 584.019 370.936 586.513 369.669 588.323L351.314 614.536L377.527 632.89C379.337 634.157 379.777 636.651 378.51 638.461C377.243 640.271 374.748 640.71 372.939 639.443L343.449 618.795ZM581.096 274.468C580.713 272.292 582.165 270.218 584.341 269.834C586.517 269.451 588.591 270.903 588.975 273.079L581.096 274.468ZM345.049 611.579C421.054 598.177 488.623 555.131 532.891 491.91L539.444 496.499C493.959 561.458 424.533 605.687 346.438 619.457L345.049 611.579ZM532.891 491.91C577.158 428.69 594.498 350.474 581.096 274.468L588.975 273.079C602.745 351.174 584.928 431.54 539.444 496.499L532.891 491.91Z"
			fill="white"
		/>
		<path
			d="M349.021 32.1887C350.288 33.9983 349.848 36.4925 348.038 37.7596L318.549 58.4083C316.739 59.6754 314.245 59.2356 312.978 57.426C311.711 55.6164 312.151 53.1222 313.96 51.8551L340.173 33.5007L321.819 7.28779C320.552 5.47817 320.991 2.98399 322.801 1.71688C324.611 0.449769 327.105 0.88956 328.372 2.69918L349.021 32.1887ZM125.313 83.3514L127.607 86.628L125.313 83.3514ZM7.93895 274.47C7.55531 276.645 5.4807 278.098 3.30513 277.714C1.12953 277.331 -0.323135 275.256 0.0604705 273.08L7.93895 274.47ZM345.05 38.4222C269.044 25.0204 190.828 42.3605 127.607 86.628L123.019 80.0748C187.977 34.5903 268.344 16.7735 346.439 30.5437L345.05 38.4222ZM127.607 86.628C64.3868 130.895 21.3408 198.464 7.93895 274.47L0.0604705 273.08C13.8308 194.985 58.0601 125.559 123.019 80.0748L127.607 86.628Z"
			fill="white"
		/>
		<defs>
			<clipPath id="clip0_323_2301">
				<rect x="203.999" y="147" width="186" height="352" rx="12" fill="white" />
			</clipPath>
		</defs>
	</svg>
	Please rotate your device for better experience
</div>

<!-- <img src={lntLogo} alt="" id="lntlogo" class="absolute left-5 top-5 z-[2000000002]" /> -->
{#if $UIPanel == 'loading'}
	<div
		class="fixed left-0 top-0 z-[2000000000] h-screen w-screen rounded bg-black bg-cover bg-center bg-no-repeat"
	>
		<div class="z-[2000000002] h-screen w-screen bg-gradient-to-t from-black">
			<video
				class="intro-video"
				src="https://assets.vestate.io/webtool/kraheja/kraheja/Logos/output.mp4"
				autoplay
				muted
				loop
				playsinline
				style="width: 100vw; height: 100vh; object-fit: cover; position: absolute; left: 0; top: 0; z-index: -1;"
			></video>
			<button
				on:click={toggleIntroAudio}
				class="intro-mute-btn fixed top-5 left-5 z-[2000000003] rounded-full text-white cursor-pointer flex items-center justify-center"
				aria-label={introVideoMuted ? "Unmute audio" : "Mute audio"}
			>
				{#if introVideoMuted}
					<!-- Muted Speaker Icon -->
					<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
						<line x1="23" y1="9" x2="17" y2="15"></line>
						<line x1="17" y1="9" x2="23" y2="15"></line>
					</svg>
				{:else}
					<!-- Playing Speaker Icon -->
					<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
						<path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
					</svg>
				{/if}
			</button>
			<div class="intro-container fixed inset-0 z-[2000000003] pointer-events-none select-none">
				<!-- Left Bottom Text Section -->
				<div class="intro-text-container absolute left-6 md:left-16 bottom-6 md:bottom-16 flex flex-col items-start text-left text-white max-w-[55%] md:max-w-[40%] lg:max-w-[40%] xl:max-w-[38%] pointer-events-none">
					<!-- STEP › INTO -->
					<div class="flex items-center gap-2 text-[10px] md:text-2xl font-light tracking-[0.3em] uppercase text-white/90">
						<span style="font-family: 'Viaoda Libre', serif !important;">STEP</span>
						<span class="text-[#c5a880] text-sm md:text-5xl font-normal leading-none" style="transform: translateY(-5px); font-family: 'Viaoda Libre', serif !important;">›</span>
						<span style="font-family: 'Viaoda Libre', serif !important;">INTO</span>
					</div>

					<!-- K RAHEJA -->
					<h1 class="text-2xl md:text-5xl tracking-[0.12em] uppercase text-white my-1 md:my-3 font-normal font-serif leading-none" style="font-family: 'Viaoda Libre', serif;">
						K RAHEJA
					</h1>

					<!-- Description -->
					<p class="text-[9px] md:text-[15px] font-light text-white/70 leading-relaxed tracking-wider normal-case " style="font-family: 'Imprima', sans-serif;">
			 Explore a location where iconic landmarks, cultural destinations and everyday experiences come together, seamlessly connected to your lifestyle.				</p>
				</div>

				<!-- Right Bottom Button Container -->
				<div class="intro-btn-container absolute right-6 md:right-16 bottom-6 md:bottom-16 pointer-events-auto">
					<button
						id="v-start-btn"
						on:click={startExperience}
						class="get-started-btn cursor-pointer"
					>
						DISCOVER
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}
{#if $UIPanel == 'instructions-exterior' && $currentUI.Exterior && $walkthroughDisabled}
	<div class="centered-panel instruction-screen p-4">
		<div class="left-panel--header mb-3 flex justify-between">
			<div class="left-title flex flex-col gap-1 text-left">
				<div class="text-2xl font-bold">Instructions</div>
				See how to explore K Raheja
			</div>
			<button
				on:click={() => {
					UIPanel.set('loaded');
					!isIframe && localStorage.setItem('instructions-view-count', '4');
				}}
				id="instruction-close"
				class="ghost-btn close-btn !px-0 !pt-0"
			>
				<svg
					width="42"
					height="42"
					viewBox="0 0 42 42"
					fill="none"
					xmlns="http://www.w3.org/2000/svg"
				>
					<rect
						x="0.363281"
						y="0.319336"
						width="41.5884"
						height="41.5884"
						rx="9.50592"
						fill="#ECECEC"
					/>
					<path
						d="M15.9062 15.8613L26.4104 26.3655"
						stroke="black"
						stroke-width="2.06369"
						stroke-linecap="round"
					/>
					<path
						d="M26.4102 15.8613L15.906 26.3655"
						stroke="black"
						stroke-width="2.06369"
						stroke-linecap="round"
					/>
				</svg>
			</button>
		</div>
		<div class="mb-4 mt-3 grid grid-cols-3 gap-2">
			<div class="col-span-1">
				Navigate and explore around with your mouse. Click on a touchpoint to interact
			</div>
			<div class="col-span-1"><img src={instructionIcon} alt="" /></div>
			<div class="col-span-1">
				<div class="mt-[2.75rem]">Use your mouse scroller to zoom an object.</div>
			</div>
		</div>
		<button
			on:click={() => {
				UIPanel.set('instructions-nav');
				!isIframe && localStorage.setItem('instructions-view-count', '1');
			}}
			class="primary-btn mx-auto block w-80"
			id="contact-submit">Okay</button
		>
	</div>
{/if}
{#if $instructionPano && $hotspotName != 'Exterior' && $hotspotName != 'ExteriorImg' && $walkthroughDisabled}
	<div class="centered-panel instruction-screen p-4">
		<div class="left-panel--header mb-3 flex justify-between">
			<div class="left-title flex flex-col gap-1 text-left">
				<div class="text-2xl font-bold">Instructions</div>
				See how to explore K Raheja
			</div>
			<button
				on:click={() => {
					instructionPano.set(false);
					!isIframe && localStorage.setItem('instructions-view-count', '4');
				}}
				id="instruction-2-close"
				class="ghost-btn close-btn !px-0 !pt-0"
			>
				<svg
					width="42"
					height="42"
					viewBox="0 0 42 42"
					fill="none"
					xmlns="http://www.w3.org/2000/svg"
				>
					<rect
						x="0.363281"
						y="0.319336"
						width="41.5884"
						height="41.5884"
						rx="9.50592"
						fill="#ECECEC"
					/>
					<path
						d="M15.9062 15.8613L26.4104 26.3655"
						stroke="black"
						stroke-width="2.06369"
						stroke-linecap="round"
					/>
					<path
						d="M26.4102 15.8613L15.906 26.3655"
						stroke="black"
						stroke-width="2.06369"
						stroke-linecap="round"
					/>
				</svg>
			</button>
		</div>
		<div class="mb-4 mt-3 grid grid-cols-2 gap-2">
			<div class="col-span-1"><img src={instructionPanoIcon} alt="" /></div>
			<div class="col-span-1">
				<div class="mt-[2.75rem]">
					Click on the arrows highlighted on the floor to navigate, Rotate left & right with you
					mouse to view the surrounding.
				</div>
			</div>
		</div>
		<button
			on:click={() => {
				instructionPano.set(false);
				!isIframe && localStorage.setItem('instructions-view-count', '4');
			}}
			class="primary-btn mx-auto block w-80"
			id="contact-submit">Okay</button
		>
	</div>
{/if}

{#if showVideoIntro}
	<div bind:this={videoIntroScreenEl} class="video-intro-screen fixed left-0 top-0 z-[2000000010] h-screen w-screen bg-black overflow-hidden">
		<img
			src={introPoster}
			alt=""
			aria-hidden="true"
			class="video-intro-poster absolute left-0 top-0 h-full w-full object-cover"
		/>
		<video
			bind:this={introPlaybackEl}
			class="video-intro-bg absolute left-0 top-0 h-full w-full object-cover"
			class:video-ready={introVideoReady}
			src={newRahejaVid}
			poster={introPoster}
			preload="auto"
			autoplay
			muted
			playsinline
			on:loadeddata={() => (introVideoReady = true)}
			on:ended={handleIntroVideoEnded}
			on:timeupdate={handleVideoTimeUpdate}
		></video>
		{#if introAudioBlocked}
			<button
				on:click={unmuteIntro}
				class="intro-mute-btn fixed top-5 left-5 z-[2000000013] rounded-full text-white cursor-pointer flex items-center justify-center"
				type="button"
				aria-label="Unmute audio"
			>
				<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
					<line x1="23" y1="9" x2="17" y2="15"></line>
					<line x1="17" y1="9" x2="23" y2="15"></line>
				</svg>
			</button>
		{/if}
		<div class="video-intro-text absolute inset-0 flex flex-col items-center justify-center text-center px-4 pointer-events-none" class:transitioning={introTransitioning}>
			<h1 class="video-intro-heading">K RAHEJA</h1>
			<p class="video-intro-subheading">
				{typedSubheading}<span class="typing-caret">|</span>
			</p>
		</div>
		<!-- Skip Button on Bottom Right -->
		<div class="video-skip-container absolute right-6 md:right-16 bottom-6 md:bottom-16 z-[2000000015] pointer-events-auto">
			<button
				id="skip-intro-btn"
				on:click={skipIntroVideo}
				class="get-started-btn skip-intro-btn cursor-pointer"
				type="button"
				aria-label="Skip video"
			>
				SKIP
			</button>
		</div>
	</div>
{/if}

{#if showMenuContent}
	<div
		class="menu-container fixed inset-0 w-screen h-screen bg-black overflow-hidden select-none"
		style="--menu-bg-image: url('{menuBgUrl}');"
		on:click={handlePageClick}
		on:mousemove={handleMouseMove}
	>
		<!-- Background building, held at its natural cover-fit size -->
		<div class="menu-bg-layer fixed inset-0 pointer-events-none flex items-center justify-center" style="z-index: 1;">
			{#if !imageLoaded}
				<img class="w-full h-full object-cover" src={menuBgUrl} alt="Building background" />
			{/if}
			<canvas
				bind:this={canvas}
				class="w-full h-full"
				class:hidden={!imageLoaded}
			></canvas>
		</div>



		<!-- Bottom Dark Overlay Gradient -->
		<div class="fixed bottom-0 left-0 w-full h-[20rem] bg-gradient-to-t from-black/75 via-black/35 to-transparent pointer-events-none" style="z-index: 10;"></div>

	

		<!-- Bottom Right Navigation Card & Controls -->
		<div bind:this={sliderMenuEl} class="slider-menu fixed bottom-12 flex items-end gap-4 pointer-events-auto" class:menu-fading-out={menuUIHidden} class:collapsed={cardsCollapsed} style="z-index: 25;">
			<div class="relative card-slider-wrapper w-[420px] h-[255px]">
				<!-- Toggle/Collapse circular button -->
				<button
					on:click={(e) => {
						e.stopPropagation();
						if (cardsCollapsed) {
							cardsCollapsed = false;
						} else {
							currentSlide = currentSlide === 1 ? 2 : 1;
						}
					}}
					class="toggle-slide-btn w-10 h-10 rounded-full bg-black/40 hover:bg-black/60 transition-all duration-300 flex items-center justify-center text-[#DEAD66] cursor-pointer z-30 !p-0"
					class:absolute={!cardsCollapsed}
					class:expanded-btn={!cardsCollapsed}
					class:collapsed-btn={cardsCollapsed}
					aria-label={cardsCollapsed ? "Expand menu" : "Collapse menu"}
				>
					<svg width="18" height="18" viewBox="0 0 10 10" fill="#DEAD66" style="transform: rotate(-40deg);">
						<circle cx="5" cy="2" r="1.1" />
						<circle cx="2" cy="6.8" r="1.1" />
						<circle cx="8" cy="6.8" r="1.1" />
					</svg>
				</button>

				<!-- Close/Collapse circular button (on the right side) -->
				{#if !cardsCollapsed}
					<button
						on:click={(e) => { e.stopPropagation(); cardsCollapsed = true; }}
						class="close-cards-btn w-10 h-10 rounded-full flex items-center justify-center cursor-pointer z-30 !p-0"
						aria-label="Collapse menu"
					>
						<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
							<line x1="18" y1="6" x2="6" y2="18"></line>
							<line x1="6" y1="6" x2="18" y2="18"></line>
						</svg>
					</button>
				{/if}

				<!-- Card 2 (VICINITY) -->
				<div 
					bind:clientWidth={card2W} 
					bind:clientHeight={card2H}
					class="nav-card {currentSlide === 2 ? 'front' : 'back'} cursor-pointer"
					on:click={() => currentSlide === 2 ? handleExploreClick() : (currentSlide = 2)}
				>
					<div class="glass-blur-bg"></div>
					<svg class="absolute inset-0 w-full h-full pointer-events-none" style="z-index: -1;">
						<path d="M 40,0 L {card2W - 40},0 A 40,40 0 0 1 {card2W},40 L {card2W},{card2H - 40} A 40,40 0 0 1 {card2W - 40},{card2H} L 40,{card2H} A 40,40 0 0 1 0,{card2H - 40} L 0,40 A 40,40 0 0 1 40,0 Z" 
						      fill="rgba(18, 18, 18, 0.45)" 
						      stroke="rgba(255, 255, 255, 0.12)" 
						      stroke-width="1.2" />
					</svg>
					
					<!-- Text section -->
					<div class="flex flex-col flex-1 text-left relative z-10 max-w-[48%]">
						<h2 class="text-3xl tracking-[0.03em] text-white mb-2 font-normal uppercase" style="font-family: 'The Seasons', serif;">
							VICINITY
						</h2>
						<p class="text-white/70 text-[13px] mb-2 normal-case font-light max-w-[225px]" style="font-family: 'Imprima', sans-serif; letter-spacing: 0.02em; line-height: 1.7;">
							Discover Mumbai's finest landmarks, cultural destinations, and lifestyle experiences close to your home.
						</p>
						<!-- Explore button -->
						<button
							on:click={(e) => { e.stopPropagation(); handleExploreClick(); }}
							class="explore-card-btn self-start flex items-center justify-center gap-2 px-5 py-2 rounded-full border border-[#c5a880] text-[10px] text-[#e5d5be] tracking-widest bg-transparent hover:bg-[#c5a880] hover:text-[#1e1e1e] transition-all duration-300 cursor-pointer !h-auto !w-auto"
							style="font-family: 'Imprima', sans-serif;"
						>
							<svg width="18" height="18" viewBox="0 0 10 10" fill="currentColor" style="transform: rotate(-40deg);">
								<circle cx="5" cy="2" r="1" />
								<circle cx="2" cy="7" r="1" />
								<circle cx="8" cy="7" r="1" />
							</svg>
							Explore
						</button>
					</div>
					
					<!-- Thumbnail Video -->
					<div class="thumbnail-cutout z-10" style="--subtract-mask: url({subtractImg});">
						<video 
							class="w-full h-full object-cover pointer-events-none" 
							src={vicinityVideo} 
							autoplay 
							loop 
							muted 
							playsinline
						></video>
					</div>
				</div>

				<!-- Card 1 (VIEWS) -->
				<div 
					bind:clientWidth={card1W} 
					bind:clientHeight={card1H}
					class="nav-card {currentSlide === 1 ? 'front' : 'back'} cursor-pointer"
					on:click={() => currentSlide === 1 ? handleExploreClick() : (currentSlide = 1)}
				>
					<div class="glass-blur-bg"></div>
					<svg class="absolute inset-0 w-full h-full pointer-events-none" style="z-index: -1;">
						<path d="M 40,0 L {card1W - 40},0 A 40,40 0 0 1 {card1W},40 L {card1W},{card1H - 40} A 40,40 0 0 1 {card1W - 40},{card1H} L 40,{card1H} A 40,40 0 0 1 0,{card1H - 40} L 0,40 A 40,40 0 0 1 40,0 Z" 
						      fill="rgba(18, 18, 18, 0.45)" 
						      stroke="rgba(255, 255, 255, 0.12)" 
						      stroke-width="1.2" />
					</svg>

					<!-- Text section -->
					<div class="flex flex-col flex-1 text-left relative z-10 max-w-[48%]">
						<h2 class="text-3xl tracking-[0.03em] text-white mb-2 font-normal uppercase" style="font-family: 'The Seasons', serif;">
							VIEWS
						</h2>
						<p class="text-white/70 text-[13px] mb-2 normal-case font-light max-w-[225px]" style="font-family: 'Imprima', sans-serif; letter-spacing: 0.02em; line-height: 1.7;">
							Explore The Building From Multiple Viewpoints And Discover Every Angle Of Its Architecture And Surroundings.
						</p>
						<!-- Explore button -->
						<button
							on:click={(e) => { e.stopPropagation(); handleExploreClick(); }}
							class="explore-card-btn self-start flex items-center justify-center gap-2 px-5 py-2 rounded-full border border-[#c5a880] text-[10px] text-[#e5d5be] tracking-widest bg-transparent hover:bg-[#c5a880] hover:text-[#1e1e1e] transition-all duration-300 cursor-pointer !h-auto !w-auto"
							style="font-family: 'Imprima', sans-serif;"
						>
							<svg width="18" height="18" viewBox="0 0 10 10" fill="currentColor" style="transform: rotate(-40deg);">
								<circle cx="5" cy="2" r="1" />
								<circle cx="2" cy="7" r="1" />
								<circle cx="8" cy="7" r="1" />
							</svg>
							Explore
						</button>
					</div>
					
					<!-- Thumbnail Video -->
					<div class="thumbnail-cutout z-10" style="--subtract-mask: url({subtractImg});">
						<video 
							class="w-full h-full object-cover pointer-events-none" 
							src={views1Video} 
							autoplay 
							loop 
							muted 
							playsinline
						></video>
					</div>
				</div>
			</div>

			<!-- Page Indicators -->
			<button 
				class="custom-indicator select-none cursor-pointer border-0 bg-transparent p-0 flex items-baseline outline-none" 
				style="font-family: 'IvyPresto Text', serif;"
				on:click={() => currentSlide = currentSlide === 1 ? 2 : 1}
				aria-label="Toggle slide"
			>
				<div class="indicator-num large">
					{#key currentSlide}
						<span transition:fade={{ duration: 250 }}>
							{currentSlide === 1 ? '01' : '02'}
						</span>
					{/key}
				</div>
				
				<div class="indicator-line"></div>
				
				<div class="indicator-num small">
					{#key currentSlide}
						<span transition:fade={{ duration: 250 }}>
							{currentSlide === 1 ? '02' : '01'}
						</span>
					{/key}
				</div>
			</button>
		</div>

		<!-- Transition loading screen showing early page branding & corner clouds -->
		{#if showClouds}
			<div class="explore-transition-overlay fixed inset-0 w-screen h-screen z-[2000000000] flex flex-col items-center justify-center py-16 pointer-events-none" bind:this={cloudOverlayEl}>
				<!-- Center Text Content -->
				<div class="transition-text-content flex flex-col items-center text-center px-4 max-w-4xl">
					<!-- Page Title with Metallic Silver Reflection Gradient -->
					<h2 class="transition-title select-none opacity-0">
						{activeCategoryTitle}
					</h2>
					<!-- Subheading Description -->
					<p class="transition-subheading select-none opacity-0 mt-6 max-w-2xl leading-relaxed text-white/80">
						{activeCategoryDesc}
					</p>
				</div>

				<!-- Big sweeping cloud -->
				<img src="/clouds.png" alt="" class="transition-big-cloud absolute pointer-events-none" bind:this={cloudImgEl} />

				<!-- Two Corner Clouds -->
				<img src="/clouds.png" alt="" class="transition-cloud-left absolute pointer-events-none" />
				<img src="/clouds.png" alt="" class="transition-cloud-right absolute pointer-events-none" />
			</div>
		{/if}
	</div>
{/if}

<style>
	button {
		background-size: 100% 100%;
		background-repeat: no-repeat;
		padding: 1rem 0.5rem;
		font-size: 1rem;
		border: 0;
	}

	.get-started-btn {
		background-color: rgba(30, 30, 30, 0.45) !important;
		border: 1.5px solid #c5a880 !important;
		border-radius: 9999px !important;
		color: #e5d5be !important;
		padding: 0.75rem 2.5rem !important;
		font-size: 1.05rem !important;
		letter-spacing: 0.12em !important;
		text-transform: none !important;
		font-weight: normal !important;
		transition: all 0.4s ease-in-out !important;
		cursor: pointer !important;
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3) !important;
		font-family: 'The Seasons', serif !important;
		display: inline-flex !important;
		align-items: center !important;
		justify-content: center !important;
		height: auto !important;
		width: auto !important;
		min-width: 160px !important;
		animation: none !important;
	}

	.get-started-btn:hover {
		background-color: #DEAD66 !important; 
		font-weight: bold !important;
		color: #ffffff !important;
		border-color: #DEAD66 !important;
		transform: scale(1.03) !important;
		animation: none !important;
	}

	.skip-intro-btn {
		backdrop-filter: blur(12px) !important;
		-webkit-backdrop-filter: blur(12px) !important;
		letter-spacing: 0.15em !important;
		min-width: 140px !important;
		z-index: 2000000015 !important;
	}

	.skip-intro-btn:active {
		transform: scale(0.97) !important;
	}

	@media (max-width: 768px), (max-width: 950px) and (orientation: landscape) {
		.get-started-btn {
			padding: 0.5rem 1.75rem !important;
			font-size: 0.8rem !important;
			min-width: 120px !important;
		}

		.skip-intro-btn {
			min-width: 110px !important;
			padding: 0.5rem 1.5rem !important;
		}
	}

	.centered-panel {
		border-radius: 0.8rem;
		position: absolute;
		bottom: 2rem;
		z-index: 99;
		transform-origin: center;
		top: 0;
		left: 0;
		width: 500px;
		height: fit-content;
		right: 0;
		bottom: 0;
		margin: auto;
		background-color: #fff;
		flex-wrap: wrap;
	}
	.instruction-screen {
		width: 600px;
	}

	/* Loader Animation */
	.loader {
		position: relative;
		width: 80px;
		height: 80px;
	}

	.loader-ring {
		position: absolute;
		width: 100%;
		height: 100%;
		border: 4px solid transparent;
		border-top-color: #ffd400;
		border-radius: 50%;
		animation: spin 1.5s cubic-bezier(0.68, -0.55, 0.265, 1.55) infinite;
	}

	.loader-ring:nth-child(1) {
		animation-delay: -0.45s;
	}

	.loader-ring:nth-child(2) {
		animation-delay: -0.3s;
	}

	.loader-ring:nth-child(3) {
		animation-delay: -0.15s;
	}

	@keyframes spin {
		0% {
			transform: rotate(0deg) scale(0.5);
		}
		50% {
			transform: rotate(180deg) scale(0.8);
		}
		100% {
			transform: rotate(360deg) scale(0.5);
		}
	}

	/* Video Intro Screen (post-Discover) */
	.video-intro-poster {
		z-index: 0;
	}

	.video-intro-bg {
		z-index: 1;
		opacity: 0;
		transition: opacity 600ms ease;
	}

	.video-intro-bg.video-ready {
		opacity: 1;
	}

	.video-intro-overlay {
		z-index: 2;
		background: rgba(10, 10, 10, 0.35);
	}

	.video-intro-text {
		z-index: 3;
		transition: opacity 450ms ease;
	}

	.video-intro-text.transitioning {
		opacity: 0;
	}

	/* Same fog technique as the /menu cloud transition — builds smoothly via
	   GSAP (see handleIntroVideoEnded) and hands off to /menu's matching
	   veil, so the two pages read as one continuous blur-hold-reveal. */
	.video-exit-fog {
		z-index: 4;
		background-color: rgba(255, 255, 255, 0);
		backdrop-filter: blur(0px);
		-webkit-backdrop-filter: blur(0px);
		pointer-events: none;
		will-change: background-color, backdrop-filter;
	}

	.video-intro-heading {
		font-family: 'Viaoda Libre', serif;
		font-weight: 400;
		font-size: clamp(2.5rem, 7vw, 5.5rem);
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: rgba(255, 255, 255, 0.92);
		text-shadow: 0 4px 30px rgba(0, 0, 0, 0.5);
		margin: 0;
	}

	.video-intro-subheading {
		margin-top: 0.75rem;
		font-family: 'Imprima', sans-serif;
		font-weight: 300;
		font-size: clamp(0.8rem, 1.6vw, 1.1rem);
		letter-spacing: 0.2em;
		text-transform: uppercase;
		color: rgba(255, 255, 255, 0.75);
		min-height: 1.4em;
	}

	.typing-caret {
		display: inline-block;
		margin-left: 2px;
		color: rgba(255, 255, 255, 0.75);
		animation: caret-blink 0.8s step-end infinite;
	}

	@keyframes caret-blink {
		0%, 100% { opacity: 1; }
		50% { opacity: 0; }
	}

	/* Navigation Cards Stack & Design */

	.menu-fading-out {
		opacity: 0 !important;
		pointer-events: none !important;
		transform: translateY(12px);
		transition: opacity 500ms ease, transform 500ms ease;
	}

	.explore-card-btn {
		background-color: rgba(30, 30, 30, 0.45) !important;
		border: 1.5px solid #c5a880 !important;
		border-radius: 9999px !important;
		color: #e5d5be !important;
		padding: 0.8rem 1.2rem !important;
		font-size: 1rem !important;
		letter-spacing: 0.12em !important;
		text-transform: none !important;
		font-weight: normal !important;
		transition: all 0.4s ease-in-out !important;
		cursor: pointer !important;
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3) !important;
		display: inline-flex !important;
		align-items: center !important;
		justify-content: center !important;
		height: auto !important;
		width: auto !important;
		margin-bottom: 12px !important;
	}

	.explore-card-btn:hover {
		background-color: #c5a880 !important;
		color: #1e1e1e !important;
		box-shadow: 0 0 25px rgba(197, 168, 128, 0.65) !important;
		border-color: #c5a880 !important;
	}

	/* Navigation Cards Stack & Design */
	.nav-card{
		position:absolute;
		inset:0;
		padding:24px 24px;
		border-radius:40px;
		overflow:hidden;
		transition:.6s cubic-bezier(.19,1,.22,1);
		backdrop-filter: blur(25px);
		-webkit-backdrop-filter: blur(25px);
	}

	.nav-card::before{
		content:"";
		position:absolute;
		inset:0;
		border-radius:inherit;
		background:
			radial-gradient(
				ellipse at top,
				rgba(255,255,255,.24),
				transparent 55%
			);
		mix-blend-mode:screen;
		pointer-events:none;
	}
	 
	/* stacking states */
	.nav-card.front {
		z-index: 20;
		opacity: 1 !important;
		transform: translate(0,0) scale(1) !important;
		pointer-events: auto;
		left: 0% !important;
		right: 0% !important;
		width: 100% !important;
	}

	.nav-card.back {
		z-index: 10;
		opacity: 0.65 !important;
		transform: translate(0, -28px) scale(0.93) !important;
		pointer-events: none;
		filter: blur(1.5px) !important;
		left: 15% !important;
		right: 20% !important;
		width: 80% !important;
	}

	/* Concentric Cutout Mask for Thumbnail on Right Side */
	.thumbnail-cutout {
		position: absolute;
		top: 15px;
		bottom: 15px;
		right: 14px;
		width: 48%;
		background: transparent;
		overflow: hidden;
		-webkit-mask-image: var(--subtract-mask);
		mask-image: var(--subtract-mask);
		-webkit-mask-size: 100% 100%;
		mask-size: 100% 100%;
		-webkit-mask-repeat: no-repeat;
		mask-repeat: no-repeat;
		-webkit-mask-position: center;
		mask-position: center;
	}

	.thumbnail-cutout img {
		border-top-left-radius: 2.5rem;
		border-bottom-left-radius: 2.5rem;
	}

	.custom-indicator {
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
		transform: translateY(10px);
		background: transparent !important;
		border: 0 !important;
		padding: 0 !important;
	}

	.indicator-num {
		display: grid;
		grid-template-areas: "stack";
		align-items: baseline;
		color: #ffffff;
		font-weight: 300;
		font-family: 'IvyPresto Text', serif;
		line-height: 0.85;
	}

	.indicator-num > span {
		grid-area: stack;
	}

	.indicator-num.large {
		font-size: 32px;
		width: 32px;
		text-align: left;
	}

	.indicator-num.small {
		font-size: 16px;
		opacity: 1;
		width: 20px;
		text-align: left; 
	}

	.indicator-line {
		width: 20px;
		height: 1px;
		background: rgba(255, 255, 255, 0.45);
		align-self: center;
		transform: translateY(8px);
	}

	.toggle-slide-btn {
		border: 1.8px solid #DEAD66 !important;
	}

	.slider-menu {
		transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
		right: 1.5rem !important;
	}

	.menu-desc-container {
		transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
		left: 0 !important;
		width: 720px !important;
		max-width: 720px !important;
	}
	.menu-desc-container p {
		padding-left: 4rem !important;
	}

	@media (max-width: 1440px) and (min-width: 769px) {
		.card-slider-wrapper {
			width: 470px !important;
		}
	}

	@media (max-width: 1500px) {
		.slider-menu {
			right: 4% !important;
			transform: scale(0.85) !important;
			transform-origin: bottom right !important;
		}
		.menu-desc-container {
			left: 4% !important;
			width: 35% !important;
			max-width: 35% !important;
		}
		.menu-desc-container p {
			padding-left: 0 !important;
		}
	}

	@media (max-width: 1024px) {
		.menu-desc-container {
			left: 2rem !important;
			width: 45% !important;
			max-width: 45% !important;
		}
		.menu-desc-container p {
			font-size: 13px !important;
			line-height: 1.5 !important;
			padding-left: 0 !important;
		}
		.slider-menu {
			gap: 1.5rem !important;
			right: 1.5rem !important;
			bottom: 2rem !important;
		}
	}

	@media (max-width: 768px) {
		.menu-desc-container {
			display: block !important;
			position: absolute !important;
			bottom: auto !important;
			top: 80px !important;
			left: 16px !important;
			right: 16px !important;
			width: calc(100% - 32px) !important;
			max-width: calc(100% - 32px) !important;
		}
		.menu-desc-container p {
			font-size: 14.5px !important;
			line-height: 1.6 !important;
			padding-left: 0 !important;
			text-align: center !important;
		}
		.slider-menu {
			flex-direction: column !important;
			align-items: flex-end !important;
			gap: 1rem !important;
			transform: scale(0.8) !important;
			transform-origin: bottom right !important;
			right: 16px !important;
			bottom: 16px !important;
		}
	}

	@media (max-width: 480px) {
		.slider-menu {
			flex-direction: column !important;
			align-items: flex-end !important;
			gap: 0.75rem !important;
			transform: scale(0.68) !important;
			transform-origin: bottom right !important;
			right: 12px !important;
			bottom: 12px !important;
		}
	}

	@media (max-width: 950px) and (orientation: landscape) {
		.menu-desc-container {
			display: flex !important;
			left: 16px !important;
			bottom: 12px !important;
			padding-left: 0 !important;
			transform: scale(0.72) !important;
			transform-origin: left bottom !important;
			max-width: 55% !important;
		}
		.menu-desc-container p {
			font-size: 14.5px !important;
			line-height: 1.6 !important;
		}
		.slider-menu {
			flex-direction: column !important;
			align-items: flex-end !important;
			gap: 0.75rem !important;
			transform: scale(0.58) !important;
			transform-origin: bottom right !important;
			right: 16px !important;
			bottom: 12px !important;
		}
	}

	.glass-blur-bg {
		position: absolute;
		inset: -60px;
		z-index: -2;
		background: var(--menu-bg-image) no-repeat center center;
		background-size: cover;
		background-attachment: fixed;
		filter: blur(45px) brightness(0.9);
		opacity: 0.95;
		pointer-events: none;
	}

	.menu-bg-layer {
		opacity: 0;
		transform: scale(1.05);
		animation: menu-bg-fade-in 1100ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
	}

	@keyframes menu-bg-fade-in {
		from {
			opacity: 0;
			transform: scale(1.05);
		}
		to {
			opacity: 1;
			transform: scale(1);
		}
	}

	.menu-intro-overlay {
		position: fixed;
		inset: 0;
		z-index: 99999;
		background-color: rgba(255, 255, 255, 0.22);
		backdrop-filter: blur(14px);
		-webkit-backdrop-filter: blur(14px);
		pointer-events: none;
	}

	.transition-text-content {
		background: transparent !important;
		backdrop-filter: none !important;
		-webkit-backdrop-filter: none !important;
		border: none !important;
		box-shadow: none !important;
		padding: 0 !important;
		max-width: 90% !important;
		width: auto !important;
		z-index: 30 !important;
		text-align: center !important;
	}

	.transition-title {
		font-family: 'Viaoda Libre', 'The Seasons', serif !important;
		font-size: clamp(4rem, 11vw, 8rem) !important;
		font-weight: 300 !important;
		letter-spacing: 0.22em !important;
		text-transform: uppercase !important;
		margin: 0;
		padding: 0;
		color: rgba(255, 255, 255, 0.12) !important;
		-webkit-text-stroke: 1.2px rgba(255, 255, 255, 0.75) !important;
		text-shadow: 
			-2px -2px 0px rgba(255, 255, 255, 0.3),
			2px 2px 2px rgba(0, 0, 0, 0.25),
			0px 10px 25px rgba(0, 0, 0, 0.35) !important;
		line-height: 1.0 !important;
		text-align: center;
	}

	.transition-subheading {
		font-family: 'Imprima', sans-serif;
		font-size: clamp(0.75rem, 1.4vw, 0.95rem);
		font-weight: 300;
		letter-spacing: 0.08em;
		max-width: 620px;
		text-transform: none;
		line-height: 1.7;
		color: rgba(255, 255, 255, 0.85);
		text-shadow: 0 2px 10px rgba(0, 0, 0, 0.5);
	}

	.transition-cloud-left {
		top: -15%;
		left: -15%;
		width: 50vw;
		max-width: 700px;
		height: auto;
		filter: blur(4px) brightness(1.15);
		transform-origin: bottom left;
		z-index: 20;
	}

	.transition-cloud-right {
		top: -15%;
		right: -15%;
		width: 50vw;
		max-width: 700px;
		height: auto;
		filter: blur(4px) brightness(1.15) scaleX(-1);
		transform-origin: bottom right;
		z-index: 20;
	}

	.transition-big-cloud {
		bottom: -50%;
		left: -40%;
		width: 180vw;
		height: auto;
		z-index: 10;
		filter: blur(15px);
		will-change: transform, opacity;
	}

	/* Intro Mute/Unmute Button – Circular Glassmorphism */
	.intro-mute-btn {
		width: 56px;
		height: 56px;
		background: rgba(255, 255, 255, 0.18);
		backdrop-filter: blur(24px) saturate(1.4);
		-webkit-backdrop-filter: blur(24px) saturate(1.4);
		border: 1.2px solid rgba(255, 255, 255, 0.35);
		box-shadow:
			0 8px 32px rgba(0, 0, 0, 0.25),
			inset 0 1px 0 rgba(255, 255, 255, 0.15),
			0 0 0 1px rgba(255, 255, 255, 0.06);
		transition: all 0.35s cubic-bezier(0.25, 1, 0.5, 1);
		animation: mute-btn-pulse 2.5s ease-in-out infinite;
		position: relative;
	}

	.intro-mute-btn::before {
		content: "";
		position: absolute;
		inset: 0;
		border-radius: 50%;
		padding: 1.2px;
		background: linear-gradient(
			160deg,
			rgba(255, 255, 255, 0.5) 0%,
			rgba(255, 255, 255, 0.1) 50%,
			rgba(255, 255, 255, 0.02) 100%
		);
		-webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
		-webkit-mask-composite: xor;
		mask-composite: exclude;
		pointer-events: none;
	}

	.intro-mute-btn:hover {
		background: rgba(255, 255, 255, 0.28);
		border-color: rgba(255, 255, 255, 0.5);
		box-shadow:
			0 8px 32px rgba(0, 0, 0, 0.3),
			inset 0 1px 0 rgba(255, 255, 255, 0.2),
			0 0 20px rgba(255, 255, 255, 0.12);
		transform: scale(1.08);
		animation: none;
	}

	.intro-mute-btn:active {
		transform: scale(0.95);
		background: rgba(255, 255, 255, 0.32);
	}

	@keyframes mute-btn-pulse {
		0%, 100% {
			box-shadow:
				0 8px 32px rgba(0, 0, 0, 0.25),
				inset 0 1px 0 rgba(255, 255, 255, 0.15),
				0 0 0 1px rgba(255, 255, 255, 0.06);
		}
		50% {
			box-shadow:
				0 8px 32px rgba(0, 0, 0, 0.25),
				inset 0 1px 0 rgba(255, 255, 255, 0.15),
				0 0 18px rgba(255, 255, 255, 0.15),
				0 0 0 1px rgba(255, 255, 255, 0.12);
		}
	}

	@media (max-width: 768px), (max-width: 950px) and (orientation: landscape) {
		.intro-mute-btn {
			width: 46px;
			height: 46px;
		}
		.intro-mute-btn svg {
			width: 18px;
			height: 18px;
		}
	}

	/* Collapsible navigation slider menu */
	.slider-menu {
		transition: all 0.5s cubic-bezier(0.16, 1, 0.3, 1) !important;
	}
	.card-slider-wrapper {
		transition: all 0.5s cubic-bezier(0.16, 1, 0.3, 1) !important;
	}
	.nav-card {
		transition: all 0.5s cubic-bezier(0.16, 1, 0.3, 1) !important;
	}
	.custom-indicator {
		transition: all 0.5s cubic-bezier(0.16, 1, 0.3, 1) !important;
	}
	.toggle-slide-btn {
		transition: all 0.5s cubic-bezier(0.16, 1, 0.3, 1) !important;
	}

	.expanded-btn {
		position: absolute !important;
		left: -3rem !important;
		top: 50% !important;
		transform: translateY(-50%) !important;
	}

	.collapsed-btn {
		position: absolute !important;
		left: 0 !important;
		top: 0 !important;
		transform: none !important;
	}

	.slider-menu.collapsed .card-slider-wrapper {
		width: 40px !important;
		height: 40px !important;
	}

	.slider-menu.collapsed .nav-card {
		opacity: 0 !important;
		pointer-events: none !important;
		transform: scale(0.6) translateX(100px) !important;
	}

	.slider-menu.collapsed .custom-indicator {
		opacity: 0 !important;
		pointer-events: none !important;
		width: 0 !important;
		margin: 0 !important;
		overflow: hidden !important;
	}

	.close-cards-btn {
		position: absolute !important;
		right: -3rem !important;
		top: 50% !important;
		transform: translateY(-50%) !important;
		border: 1.8px solid rgba(255, 255, 255, 0.15) !important;
		background: rgba(30, 30, 30, 0.45) !important;
		color: #DEAD66 !important;
		backdrop-filter: blur(10px);
		-webkit-backdrop-filter: blur(10px);
		transition: all 0.3s ease !important;
	}

	.close-cards-btn:hover {
		background: rgba(222, 173, 102, 1) !important;
		border-color: rgba(222, 173, 102, 1) !important;
		color: white !important;
		box-shadow: 0 0 15px rgba(222, 173, 102, 0.45);
	}
</style>
