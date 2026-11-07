<script>
	import { goto, preloadCode } from '$app/navigation';
	import { getContext, onMount, onDestroy, tick } from 'svelte';
	import { flip } from 'svelte/animate';
	import { fade } from 'svelte/transition';
	import { gsap } from 'gsap';

	const currentUI = getContext('currentUI');
	const UIPanel = getContext('UIPanel');
	const introVideoLastFrame = getContext('introVideoLastFrame');

	let menuBgUrl = $derived($introVideoLastFrame || '/landing.png');

	let currentSlide = $state(1);
	let cardsCollapsed = $state(true);
	let activeCategoryTitle = $state('');
	let activeCategoryDesc = $state('');
	let card1W = $state(420);
	let card1H = $state(231);
	let card2W = $state(420);
	let card2H = $state(231);

	// Pre-navigation transition: fade the menu UI out and sweep a single big,
	// faded cloud up from the bottom, same as before, while the destination
	// page loads underneath. Animated with GSAP for a single smooth tween
	// instead of a CSS keyframe animation.
	let menuUIHidden = $state(false);
	let showClouds = $state(false);
	let cloudOverlayEl;
	let cloudImgEl;
	let cloudTimeline;
	const introTimers = [];

	import views1Video from '$lib/videos/views1.mp4';
	import vicinityVideo from '$lib/videos/vicinity.mp4';
	import subtractImg from '$lib/images/subtract.png';

	let canvas;
	let gl;
	let program;
	let positionBuffer;
	let texture;
	let ripples = $state([]);
	let rippleId = 0;
	let introOverlayEl;
	let introOverlayTween;
	let menuReady = $state(false);
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
	let animationFrameId;

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
			if (v_texCoord.x < 0.0 || v_texCoord.x > 1.0 || v_texCoord.y < 0.0 || v_texCoord.y > 1.0) {
				gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
			} else {
				gl_FragColor = texture2D(u_image, tc - displacement);
			}
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
		if (!canvas) return;
		gl = canvas.getContext('webgl');
		if (!gl) {
			console.error('WebGL not supported');
			return;
		}

		const vs = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
		const fs = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
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
		img.src = menuBgUrl;
		img.onload = () => {
			gl.bindTexture(gl.TEXTURE_2D, texture);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
			imageWidth = img.naturalWidth;
			imageHeight = img.naturalHeight;
			imageLoaded = true;
			resizeCanvas();
			updateUVScale(imageWidth, imageHeight);
			requestRender();
		};
	}

	function updateUVScale(imgWidth, imgHeight) {
		if (!canvas) return;
		const canvasWidth = canvas.width;
		const canvasHeight = canvas.height;

		const imageRatio = imgWidth / imgHeight;
		const canvasRatio = canvasWidth / canvasHeight;

		// Full image height always visible (no top/bottom crop); width is stretched
		// to fill the screen horizontally.
		uScale = 1.0;
		vScale = 1.0;
		uOffset = 0.0;
		vOffset = 0.0;
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

	onMount(() => {
		$UIPanel = 'loaded';
		$currentUI = {
			overview: true,
			views: false,
			Exterior: false,
			interiors: false,
			amenities: false,
			highlights: false,
			vicinity: false
		};

		initWebGL();
		preloadCode('/views');
		preloadCode('/vicinities');

		window.addEventListener('resize', handleResize);

		// Same fog technique as the /menu → /views|/vicinities cloud
		// transition: picks up right where the outgoing "/" page's veil left
		// off, holds briefly, then clears to reveal the menu — so the whole
		// video → menu handoff reads as one continuous blur-hold-reveal.
		if (introOverlayEl) {
			gsap.set(introOverlayEl, { backgroundColor: 'rgba(255,255,255,0.22)', backdropFilter: 'blur(14px)' });
			introOverlayTween = gsap.to(introOverlayEl, {
				backgroundColor: 'rgba(255,255,255,0)',
				backdropFilter: 'blur(0px)',
				duration: 0.9,
				ease: 'power2.inOut',
				delay: 0.4
			});
		}

		setTimeout(() => {
			menuReady = true;
		}, 400);

		return () => {
			window.removeEventListener('resize', handleResize);
			if (animationFrameId) cancelAnimationFrame(animationFrameId);
		};
	});

	function after(ms, fn) {
		introTimers.push(setTimeout(fn, ms));
	}

	async function handleExploreClick() {
		const destination = currentSlide === 1 ? 'views' : 'vicinity';
		activeCategoryTitle = destination === 'views' ? 'VIEWS' : 'VICINITY';
		activeCategoryDesc = destination === 'views' 
			? 'Discover Mumbai Through Immersive Aerial Perspectives, Revealing The Landmarks That Define This Exceptional Address.'
			: 'Discover the neighbourhood from an aerial perspective. Explore key landmarks, local destinations, and the vibrant surroundings through an interactive experience.';

		menuUIHidden = true;
		showClouds = true;
		await tick(); // wait for the cloud elements to mount before animating them

		if (cloudOverlayEl && cloudImgEl) {
			// Set initial states
			gsap.set(cloudImgEl, { yPercent: 100, opacity: 0, scale: 1.8, filter: 'blur(15px)' });
			gsap.set('.transition-cloud-left', { yPercent: 100, xPercent: -50, scale: 1.8, opacity: 0 });
			gsap.set('.transition-cloud-right', { yPercent: 100, xPercent: 50, scale: 1.8, opacity: 0 });
			gsap.set('.transition-text-content', { y: 60, opacity: 0, scale: 0.95 });
			gsap.set('.transition-title', { opacity: 0 });
			gsap.set('.transition-subheading', { opacity: 0 });

			// Blur transition background overlay
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

		after(3300, () => {
			showClouds = false;
		});
	}

	onDestroy(() => {
		introTimers.forEach(clearTimeout);
		cloudTimeline?.kill();
		introOverlayTween?.kill();
	});

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
</script>

<div
	class="menu-container fixed inset-0 w-screen h-screen bg-black overflow-hidden select-none"
	style="--menu-bg-image: url('{menuBgUrl}');"
	on:click={handlePageClick}
	on:mousemove={handleMouseMove}
>
	<!-- Focus Transition Blur Overlay -->
	<div class="menu-intro-overlay" bind:this={introOverlayEl}></div>

	<!-- Background building, held at its natural cover-fit size -->
	<div class="menu-bg-layer fixed inset-0 pointer-events-none flex items-center justify-center" style="z-index: 1;">
		{#if !imageLoaded}
			<img class="w-full h-full object-fill" src={menuBgUrl} alt="Building background" />
		{/if}
		<canvas
			bind:this={canvas}
			class="w-full h-full"
			class:hidden={!imageLoaded}
		></canvas>
	</div>

	<!-- Subtle progressive gradient blur columns behind side items -->
	<div 
		class="fixed left-0 top-0 w-[40vw] h-screen backdrop-blur-[6px] bg-black/5 pointer-events-none z-[5]"
		style="mask-image: linear-gradient(to right, black 60%, transparent 100%); -webkit-mask-image: linear-gradient(to right, black 60%, transparent 100%);"
	></div>
	<div 
		class="fixed right-0 top-0 w-[40vw] h-screen backdrop-blur-[6px] bg-black/5 pointer-events-none z-[5]"
		style="mask-image: linear-gradient(to left, black 60%, transparent 100%); -webkit-mask-image: linear-gradient(to left, black 60%, transparent 100%);"
	></div>

	<!-- Bottom Dark Overlay Gradient -->
	<div class="fixed bottom-0 left-0 w-full h-[20rem] bg-gradient-to-t z-10 from-black/75 via-black/35 to-transparent pointer-events-none"></div>

	<!-- Navigation UI Description Overlay -->
	<div class="menu-desc-container fixed bottom-6 left-0 z-[25] flex flex-col gap-2 pointer-events-auto text-left" class:animate-fade-in={menuReady} class:menu-fading-out={menuUIHidden}>
		<p class="text-white/80 text-xs md:text-[16px] text-justify font-normal leading-relaxed tracking-wide normal-case" style="font-family: 'Imprima', sans-serif;">
			In the heart of Mumbai, where heritage meets contemporary living, Raheja SOBO Residences presents a rare collection of thoughtfully crafted homes. An address defined by timeless architecture, exceptional views, and a neighbourhood that has shaped the city's finest lifestyles.
		</p>
	</div>

	<!-- Bottom Right Navigation Card & Controls -->
	<div class="slider-menu fixed bottom-12 z-[25] flex items-end gap-4 pointer-events-auto" class:animate-fade-in={menuReady} class:menu-fading-out={menuUIHidden} class:collapsed={cardsCollapsed}>
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
				<svg width="8" height="8" viewBox="0 0 10 10" fill="#DEAD66" style="transform: rotate(-40deg);">
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
					<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
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
				on:click={() => currentSlide !== 2 && (currentSlide = 2)}
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
				on:click={() => currentSlide !== 1 && (currentSlide = 1)}
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

<style>
	/* UI starts hidden, becomes visible when menuReady triggers this class */
	.menu-desc-container,
	.slider-menu {
		opacity: 0;
		transform: translateY(20px) scale(0.96);
	}

	.animate-fade-in {
		animation: fadeIn 1.0s cubic-bezier(0.16, 1, 0.3, 1) forwards;
	}

	.menu-fading-out {
		opacity: 0 !important;
		pointer-events: none !important;
		transform: translateY(12px);
		transition: opacity 500ms ease, transform 500ms ease;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
			transform: translateY(20px) scale(0.96);
		}
		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}

	button {
		background-size: 100% 100%;
		background-repeat: no-repeat;
		padding: 1rem 0.5rem;
		font-size: 1rem;
		border: 0;
	}

	.explore-card-btn {
		background-color: rgba(30, 30, 30, 0.45) !important;
		border: 1.5px solid #c5a880 !important;
		border-radius: 9999px !important;
		color: #e5d5be !important;
	    padding: 0.8rem 1.2rem !important;
		font-size: 0.75rem !important;
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
			display: none !important;
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
			transform: scale(0.52) !important;
			transform-origin: left bottom !important;
			max-width: 50% !important;
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

	/* Subtle zoom-in + fade entrance — settles at scale(1) (true natural
	   size) so nothing stays oversized once the animation finishes. */
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

	/* Same fog values as the outgoing "/" page and the cloud transition —
	   GSAP picks this up on mount (see onMount) and clears it after a brief
	   hold, so the handoff from the video reads as one continuous veil. */
	.menu-intro-overlay {
		position: fixed;
		inset: 0;
		z-index: 99999;
		background-color: rgba(255, 255, 255, 0.22);
		backdrop-filter: blur(14px);
		-webkit-backdrop-filter: blur(14px);
		pointer-events: none;
	}

	/* Pre-navigation transition: a single big, faded cloud sweeps up from the
	   bottom while a synced fog darkens behind it, covering the switch to
	   the destination page. GSAP drives the actual motion (see
	   handleExploreClick) for one continuous smooth tween; these rules just
	   set the static size/position/starting look. */
	.explore-transition-overlay {
		background-color: rgba(0,0,0,0);
		backdrop-filter: blur(0px);
		-webkit-backdrop-filter: blur(0px);
		will-change: background-color, backdrop-filter;
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
		position: absolute;
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
		position: absolute;
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
		position: absolute;
		bottom: -50%;
		left: -40%;
		width: 180vw;
		height: auto;
		z-index: 10;
		filter: blur(15px);
		will-change: transform, opacity;
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
