<script>
	import { goto } from '$app/navigation';
	import { page, navigating } from '$app/stores';
	import { onMount, setContext } from 'svelte';
	import { writable, get } from 'svelte/store';
	import '../app.pcss';
	import './styles.css';
	import rahejaLogo from '$lib/images/rahejanew.png';
	import poweredLogo from '$lib/images/powered.png';

	const navSlide = writable();
	setContext('navSlide', navSlide);

	const hotspotName = writable(0);
	const UIPanel = writable('loading');
	const walkthroughDisabled = writable();
	$: walkthroughDisabled.set(false);

	$: hotspotName.set('overview');
	setContext('hotspotName', hotspotName);
	setContext('UIPanel', UIPanel);

	let currentUI = writable({
		overview: false,
		views: false,
		Exterior: false,
		interiors: false,
		amenities: false,
		highlights: false,
		vicinity: false
	});
	setContext('currentUI', currentUI);

	const show = (ui) => {
		var newUI = {
			overview: false,
			views: false,
			Exterior: false,
			interiors: false,
			amenities: false,
			highlights: false,
			vicinity: false
		};
		newUI[ui] = true;
		currentUI.set(newUI);
		console.log('second', $currentUI);
	};
	const vicinityImg = writable('-');
	setContext('vicinityImg', vicinityImg);

	// Last frame captured from the intro (/) video, reused as the /menu background
	const introVideoLastFrame = writable(null);
	setContext('introVideoLastFrame', introVideoLastFrame);

	// check for the iframe window
	function inIframe() {
		try {
			return window.self !== window.top;
		} catch (e) {
			return true;
		}
	}
	var isIframe = inIframe();
	const switchChecker = () => {
		// eslint-disable-next-line svelte/valid-compile
		switch ($page.url.searchParams.get('panel')) {
			case 'interiors':
				show('interiors');
				UIPanel.set('loaded');
				break;
			case 'contact-us':
				show('contact');
				UIPanel.set('contact');
				break;
			case 'brochure':
				show('Brochure');
				UIPanel.set('Brochure');
				break;
			case 'amenities':
				show('amenities');
				UIPanel.set('loaded');
				break;
			case 'vicinity':
				show('vicinity');
				UIPanel.set('loaded');
				break;
			case 'overview':
				show('Exterior');
				console.log('setting overview');
				UIPanel.set('loaded');
				break;
			case 'highlights':
				show('highlights');
				UIPanel.set('loaded');
				break;
			default:
				break;
		}
	};
	UIPanel.subscribe((val) => {
		if (typeof sessionStorage !== 'undefined') {
			sessionStorage.setItem('rahega_UIPanel', val);
		}
	});

	// Reactive statement to handle client-side route transitions
	$: if ($page.url) {
		switchChecker();
		if ($page.url.pathname === '/') {
			show('overview');
			// Intro videos removed — the home route always opens straight on the menu.
			UIPanel.set('menu');
		} else if ($page.url.pathname === '/menu') {
			show('overview');
			UIPanel.set('loaded');
		}
		if ($page.url.href.includes('brochure')) {
			show('Brochure');
			UIPanel.set('Brochure');
		}
		if ($page.url.href.includes('amenities')) {
			show('amenities');
			UIPanel.set('loaded');
		}
		if ($page.url.href.includes('overview')) {
			show('overview');
			UIPanel.set('loaded');
		}
		if ($page.url.href.includes('views')) {
			show('views');
			UIPanel.set('loaded');
		}
		if ($page.url.href.includes('vicinities')) {
			show('vicinity');
			UIPanel.set('loaded');
		}
	}

	onMount(() => {
		const savedUIPanel = sessionStorage.getItem('rahega_UIPanel');
		if (savedUIPanel && $page.url.pathname !== '/') {
			UIPanel.set(savedUIPanel);
		}

		// 2-finger swipe up global listener for fullscreen mode
		let touchStartY = 0;
		const handleTouchStartGlobal = (e) => {
			if (e.touches.length >= 2) {
				touchStartY = e.touches[0].clientY;
			}
		};
		const handleTouchMoveGlobal = (e) => {
			if (e.touches.length >= 2 && touchStartY) {
				const currentY = e.touches[0].clientY;
				const diffY = touchStartY - currentY; // positive = swipe up
				if (diffY > 40) {
					const docEl = document.documentElement;
					if (docEl.requestFullscreen) {
						docEl.requestFullscreen().catch(() => {});
					} else if (docEl.webkitRequestFullscreen) {
						docEl.webkitRequestFullscreen();
					} else if (docEl.msRequestFullscreen) {
						docEl.msRequestFullscreen();
					}
					touchStartY = 0; // reset
				}
			}
		};

		window.addEventListener('touchstart', handleTouchStartGlobal, { passive: true });
		window.addEventListener('touchmove', handleTouchMoveGlobal, { passive: true });

		return () => {
			window.removeEventListener('touchstart', handleTouchStartGlobal);
			window.removeEventListener('touchmove', handleTouchMoveGlobal);
		};
	});
</script>

<div class="app">
	<!-- svelte-ignore a11y-click-events-have-key-events -->
	<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
	<img 
		src={rahejaLogo} 
		alt="Raheja Logo" 
		class="raheja-logo cursor-pointer" 
		class:hidden={$UIPanel == 'loading'} 
		on:click={() => {
			UIPanel.set('menu');
			goto('/');
		}} 
	/>
	<img src={poweredLogo} alt="Powered by Vretail" class="vretail-watermark" class:hidden={$UIPanel == 'loading'} />

	<!-- Device Rotation Overlay for Portrait Mobile Screens -->
	<div class="rotate-overlay">
		<div class="rotate-content">
			<div class="phone-icon-wrapper">
				<svg class="phone-rotate-icon" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
					<path class="phone-body" d="M35 15h30c2.2 0 4 1.8 4 4v62c0 2.2-1.8 4-4 4H35c-2.2 0-4-1.8-4-4V19c0-2.2 1.8-4 4-4z" fill="none" stroke="white" stroke-width="3" />
					<circle class="phone-btn" cx="50" cy="77" r="3" fill="white" />
					<path class="arrow" d="M65 30a20 20 0 0 1 10 15m0 0l-5-2m5 2l2-5" fill="none" stroke="#ffd400" stroke-width="3" stroke-linecap="round" />
				</svg>
			</div>
			<h2>Rotate Your Device</h2>
			<p>Please rotate your device to landscape mode for the best experience.</p>
		</div>
	</div>

	<slot />


	<div class={'nav-wrapper ' + ($navSlide ? 'active-drop-wrapper' : '')} class:hidden={$UIPanel == 'loading' || $UIPanel == 'menu' || $page.url.pathname == '/views' || $page.url.pathname == '/menu' || $page.url.pathname == '/vicinities'}>
		<nav class="z-[999]">
			{#if $UIPanel == 'instructions-nav'}
				<div class="tooltip-text relative">
					<strong> Navigation Panel</strong>
					<p>You can navigate to various options available here</p>

					<button
						on:click={() => {
							UIPanel.set('instructions-color-mode');

							!isIframe && localStorage.setItem('instructions-view-count', '2');
						}}
						class=" ghost-btn next-btn absolute bottom-[-1px] right-[-1px] border-0 !px-0 !py-0"
					>
						<svg
							width="40"
							height="40"
							viewBox="0 0 51 50"
							fill="none"
							xmlns="http://www.w3.org/2000/svg"
						>
							<path
								d="M0.00390625 12.0128C0.00390625 5.42948 5.34075 0.0926514 11.9241 0.0926514H50.0687V37.6226C50.0687 44.206 44.7318 49.5428 38.1485 49.5428H0.00390625V12.0128Z"
								fill="url(#paint0_linear_75_2649)"
							/>
							<path
								d="M33.5968 24.9588C34.2895 25.3152 34.2895 26.3054 33.5968 26.6617L20.9503 33.1676C20.1422 33.5833 19.2637 32.745 19.6413 31.9184L22.2492 26.2081C22.3646 25.9554 22.3646 25.6651 22.2492 25.4125L19.6413 19.7022C19.2637 18.8756 20.1422 18.0372 20.9503 18.4529L33.5968 24.9588Z"
								fill="white"
							/>
							<defs>
								<linearGradient
									id="paint0_linear_75_2649"
									x1="0.394398"
									y1="42.7963"
									x2="42.8438"
									y2="25.5106"
									gradientUnits="userSpaceOnUse"
								>
									<stop stop-color="#0F5DA8" />
									<stop offset="1" stop-color="#0F5DA8" />
								</linearGradient>
							</defs>
						</svg>
					</button>
				</div>
			{/if}

			<div class:hidden={$page.url.hash == '#hidenav'} >
				<svg
					on:click={() => navSlide.set(!$navSlide)}
					type="button"
					width="135"
					height="38"
					viewBox="0 0 135 38"
					fill="none"
					xmlns="http://www.w3.org/2000/svg"
					class="pointer mx-auto block cursor-pointer"
				>
					<g clip-path="url(#clip0_688_470)">
						<path
							fill-rule="evenodd"
							clip-rule="evenodd"
							d="M98.7523 13.3744C114.818 26.5965 131.663 44 152.47 44H680.754C702.293 44 719.754 61.4609 719.754 83C719.754 104.539 702.293 122 680.754 122H-492C-513.539 122 -531 104.539 -531 83C-531 61.4609 -513.539 44 -492 44H-18.4702C2.33679 44 19.1821 26.5965 35.2477 13.3744C43.8831 6.26749 54.9431 2 67 2C79.0569 2 90.117 6.26749 98.7523 13.3744Z"
							fill="url(#paint0_linear_688_470)"
						/>
						<path
							class={!$navSlide ? 'active-drop' : ''}
							d="M60.3076 24L59 22.6615L66.1266 15.3708C66.2408 15.2533 66.3766 15.1601 66.5262 15.0964C66.6757 15.0328 66.8361 15 66.9981 15C67.1602 15 67.3206 15.0328 67.4701 15.0964C67.6197 15.1601 67.7555 15.2533 67.8697 15.3708L75 22.6615L73.6924 23.9987L67 17.156L60.3076 24Z"
							fill="white"
							fill-opacity="0.7"
						/>
						<path
							class={!$navSlide ? 'active-drop' : ''}
							d="M60.3076 31L59 29.6615L66.1266 22.3708C66.2408 22.2533 66.3766 22.1601 66.5262 22.0964C66.6757 22.0328 66.8361 22 66.9981 22C67.1602 22 67.3206 22.0328 67.4701 22.0964C67.6197 22.1601 67.7555 22.2533 67.8697 22.3708L75 29.6615L73.6924 30.9987L67 24.156L60.3076 31Z"
							fill="white"
							fill-opacity="0.2"
						/>
					</g>
					<defs>
						<linearGradient
							id="paint0_linear_688_470"
							x1="-521.244"
							y1="95.6284"
							x2="-435.661"
							y2="-263.156"
							gradientUnits="userSpaceOnUse"
						>
							<stop stop-color="#0F5DA8" />
							<stop offset="1" stop-color="#0F5DA8" />
						</linearGradient>
						<clipPath id="clip0_688_470">
							<rect width="135" height="38" fill="white" />
						</clipPath>
					</defs>
				</svg>
			</div>

			<div class="btn-group" class:hidden={$page.url.hash == '#hidenav'}>
				<!-- <button
					id="overview"
					on:click={() => {
						show('overview');
						$hotspotName = 'overview';
						goto('/');
						UIPanel.set('loaded');
					}}
					class={$currentUI.overview && $UIPanel != 'Brochure'
						? 'transparent-btn active'
						: 'transparent-btn'}
				>
					<svg
						width="19"
						height="18"
						viewBox="0 0 19 18"
						fill="none"
						xmlns="http://www.w3.org/2000/svg"
					>
						<path
							d="M6.58949 15.1462C6.52087 15.2551 6.48655 15.3368 6.43165 15.398C6.26009 15.5954 6.04048 15.6363 5.81402 15.5342C5.58755 15.4253 5.45716 15.221 5.54637 14.9692C5.73853 14.3906 5.95127 13.812 6.1846 13.247C6.30813 12.9543 6.63753 12.8726 6.91204 13.0564C7.39242 13.3831 7.85908 13.7303 8.31888 14.0842C8.54534 14.2612 8.60024 14.5063 8.44927 14.7513C8.26398 15.0441 7.98947 15.0577 7.62575 14.8807C7.91398 15.541 8.19535 16.1196 8.75122 16.5144C9.01887 16.6982 9.28651 16.6778 9.54729 16.5076C9.84238 16.317 10.0483 16.0447 10.2198 15.7452C10.8169 14.7582 11.0914 13.6554 11.311 12.5458C11.3659 12.2531 11.1394 12.362 11.0296 12.3757C10.0345 12.4642 9.03945 12.471 8.05123 12.4233C6.2944 12.3416 4.57188 12.0966 2.91798 11.4771C2.26603 11.2321 1.64154 10.9257 1.11311 10.4492C0.0905803 9.53028 0.0837177 8.40711 1.10625 7.48134C1.77879 6.8755 2.60917 6.53515 3.45327 6.25606C4.13953 6.03142 4.83952 5.86124 5.55324 5.76594C5.79343 5.73191 5.86892 5.6298 5.91009 5.40517C6.08852 4.29561 6.36989 3.21327 6.864 2.1922C7.13164 1.63402 7.45419 1.11668 7.94143 0.715059C8.70318 0.0819969 9.58846 0.088804 10.3434 0.721866C10.9061 1.19836 11.2561 1.81781 11.5443 2.4781C12.162 3.91441 12.4296 5.42559 12.5668 6.964C12.6835 8.24374 12.6904 9.52348 12.5737 10.8032C12.5463 11.1163 12.628 11.1504 12.9237 11.0891C13.8433 10.8917 14.7492 10.6603 15.5933 10.2518C15.9776 10.068 16.3344 9.85022 16.6227 9.53028C16.9727 9.14228 16.9864 8.80192 16.6501 8.40711C16.2658 7.95784 15.758 7.69236 15.1746 7.4473C15.2158 7.56302 15.2433 7.6379 15.2639 7.70597C15.3394 7.95784 15.257 8.16205 15.0305 8.28458C14.8109 8.40711 14.5639 8.4003 14.406 8.19609C14.0354 7.70597 13.6786 7.20905 13.3423 6.69171C13.157 6.40581 13.308 6.08588 13.658 5.96335C14.1727 5.77956 14.6943 5.60938 15.2158 5.4392C15.5041 5.3439 15.7442 5.42559 15.8746 5.69787C16.005 5.97696 15.9021 6.2016 15.6413 6.35816C15.607 6.37859 15.5658 6.40581 15.5109 6.44666C15.806 6.59641 16.0874 6.73936 16.3619 6.88912C16.7874 7.12056 17.1648 7.41327 17.4668 7.78766C18.0707 8.54325 18.057 9.40775 17.4256 10.1429C17.0276 10.6126 16.5129 10.9257 15.9639 11.1912C14.9345 11.6813 13.8433 11.9604 12.7247 12.1374C12.4845 12.1783 12.3884 12.2667 12.3472 12.5118C12.1482 13.7099 11.8394 14.8807 11.2629 15.9698C11.0296 16.4055 10.7551 16.8071 10.3845 17.1338C9.5816 17.835 8.64828 17.8282 7.85908 17.1134C7.37183 16.671 7.04243 16.1128 6.77478 15.5206C6.71988 15.4116 6.65812 15.2959 6.58949 15.1462ZM5.63559 8.74746C5.615 8.00549 5.66304 7.50857 5.69735 7.01165C5.70421 6.89593 5.74539 6.74617 5.52579 6.79382C4.366 7.02526 3.2268 7.29755 2.21113 7.93061C1.11311 8.61813 1.11998 9.28523 2.20427 9.97955C2.87681 10.4084 3.61797 10.6671 4.38659 10.8645C6.60322 11.4363 8.85416 11.5043 11.1257 11.341C11.4414 11.3206 11.5237 11.2048 11.5443 10.9121C11.661 9.39414 11.661 7.87615 11.4688 6.36497C11.311 5.09885 11.0502 3.85995 10.5149 2.69593C10.3159 2.26028 10.0757 1.84504 9.71199 1.52511C9.32082 1.17794 8.97769 1.17794 8.57966 1.5183C8.29143 1.77016 8.08555 2.08329 7.90712 2.41684C7.42673 3.32219 7.17968 4.29561 6.9738 5.28264C6.9189 5.5345 6.99439 5.57534 7.22086 5.55492C8.08555 5.46643 8.9571 5.46643 9.82179 5.48685C10.2267 5.49366 10.4532 5.67745 10.46 5.99058C10.4669 6.31732 10.2267 6.51473 9.80121 6.50792C8.9571 6.49431 8.10614 6.50792 7.26203 6.57599C6.7542 6.61683 6.76792 6.61003 6.72675 7.09333C6.63753 8.05314 6.65126 9.01975 6.66498 9.98636C6.67184 10.3744 6.50028 10.5922 6.1846 10.6058C5.85519 10.6194 5.64245 10.4016 5.63559 10.0136C5.62873 9.50305 5.63559 9.00613 5.63559 8.74746Z"
							fill="currentColor"
							stroke="currentColor"
							stroke-width="0.394234"
						/>
					</svg>
					Overview
				</button> -->

				<button
					id="reset-tour"
					on:click={() => {
						$currentUI = {
							overview: false,
							views: false,
							Exterior: false,
							interiors: false,
							amenities: false,
							highlights: false,
							vicinity: false
						};
						UIPanel.set('menu');
						if (typeof sessionStorage !== 'undefined') {
							sessionStorage.clear();
						}
						goto('/');
					}}
					class={$UIPanel == 'loading' ? 'transparent-btn active' : 'transparent-btn'}
				>
					<svg
						width="19"
						height="18"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
						<polyline points="9 22 9 12 15 12 15 22"/>
					</svg>
					Home
				</button>

				<button
					id="views"
					on:click={() => {
						show('views');
						goto('/views');
						UIPanel.set('loaded');
					}}
					class={$currentUI.views && $UIPanel != 'Brochure'
						? 'transparent-btn active'
						: 'transparent-btn'}
				>
					<svg
						width="19"
						height="18"
						viewBox="0 0 20 20"
						fill="none"
						xmlns="http://www.w3.org/2000/svg"
					>
						<path
							d="M10 3.5C5 3.5 1.7 6.61 0 10.5C1.7 14.39 5 17.5 10 17.5C15 17.5 18.3 14.39 20 10.5C18.3 6.61 15 3.5 10 3.5ZM10 15C7.51 15 5.5 12.99 5.5 10.5C5.5 8.01 7.51 6 10 6C12.49 6 14.5 8.01 14.5 10.5C14.5 12.99 12.49 15 10 15ZM10 8C8.62 8 7.5 9.12 7.5 10.5C7.5 11.88 8.62 13 10 13C11.38 13 12.5 11.88 12.5 10.5C12.5 9.12 11.38 8 10 8Z"
							fill="currentColor"
						/>
					</svg>
					Views
				</button>

				<button
					id="vicinity"
					on:click={() => {
						show('vicinity');
						goto('/vicinities');
						UIPanel.set('loaded');
					}}
					class={$currentUI.vicinity ? 'transparent-btn active' : 'transparent-btn'}
				>
					<svg
						width="17"
						height="16"
						viewBox="0 0 17 16"
						fill="none"
						xmlns="http://www.w3.org/2000/svg"
					>
						<path
							d="M8.49535 0.0693359C11.2918 0.0693359 13.4186 2.10511 13.4992 4.65137C13.524 5.34636 13.3008 5.986 13.0341 6.60718C12.3087 8.32929 11.2918 9.87918 10.2315 11.4106C9.79127 12.0441 9.32622 12.653 8.87359 13.2803C8.78058 13.4095 8.71857 13.4464 8.60696 13.2926C7.05063 11.2077 5.5687 9.07964 4.46501 6.71174C3.37992 4.38075 4.31 2.43723 5.4943 1.34246C6.40578 0.499862 7.49087 0.0877871 8.49535 0.0693359ZM8.74338 6.36117C9.61145 6.36117 10.3183 5.66618 10.3245 4.80512C10.3307 3.94407 9.60525 3.21833 8.73717 3.21833C7.8691 3.21833 7.14364 3.95022 7.15604 4.81128C7.16844 5.67233 7.8753 6.36117 8.74338 6.36117Z"
							fill="currentColor"
						/>
						<path
							d="M8.29317 14.232C10.3207 14.2258 11.8585 14.0167 13.3218 13.414C13.8488 13.1987 14.3511 12.9342 14.7541 12.5222C15.2006 12.067 15.1944 11.6611 14.7417 11.2121C14.3015 10.7754 13.7434 10.5233 13.173 10.308C12.9808 10.2342 12.9684 10.1789 13.0738 10.0128C13.2784 9.68068 13.4582 9.33626 13.6442 8.99184C13.7124 8.86883 13.762 8.80118 13.9232 8.86883C14.6735 9.1948 15.3866 9.58842 15.9508 10.1912C16.9305 11.2429 16.9243 12.6021 15.9198 13.6354C15.1199 14.4534 14.1031 14.9085 13.018 15.2037C9.99211 16.034 6.96625 16.0832 3.9652 15.0684C3.15913 14.7978 2.41506 14.398 1.77641 13.826C0.4805 12.6513 0.474299 11.1445 1.75781 9.9513C2.28485 9.46542 2.89871 9.11485 3.54356 8.80733C3.71098 8.72737 3.76678 8.78272 3.84119 8.92418C4.0272 9.2809 4.21322 9.63148 4.42404 9.96975C4.51704 10.1235 4.47984 10.1666 4.33103 10.2281C3.89079 10.4126 3.46915 10.6278 3.08472 10.9046C2.97931 10.9846 2.8739 11.0707 2.7747 11.1629C2.25385 11.6611 2.24765 12.0916 2.7809 12.5775C3.52496 13.2602 4.44884 13.58 5.40372 13.8322C6.50741 14.1274 7.62351 14.2443 8.29317 14.232ZM8.49535 0.0693359C11.2918 0.0693359 13.4186 2.10511 13.4992 4.65137C13.524 5.34636 13.3008 5.986 13.0341 6.60718C12.3087 8.32929 11.2918 9.87918 10.2315 11.4106C9.79127 12.0441 9.32622 12.653 8.87359 13.2803C8.78058 13.4095 8.71857 13.4464 8.60696 13.2926C7.05063 11.2077 5.5687 9.07964 4.46501 6.71174C3.37992 4.38075 4.31 2.43723 5.4943 1.34246C6.40578 0.499862 7.49087 0.0877871 8.49535 0.0693359ZM8.74338 6.36117C9.61145 6.36117 10.3183 5.66618 10.3245 4.80512C10.3307 3.94407 9.60525 3.21833 8.73717 3.21833C7.8691 3.21833 7.14364 3.95022 7.15604 4.81128C7.16844 5.67233 7.8753 6.36117 8.74338 6.36117Z"
							fill="currentColor"
						/>
					</svg>
					Vicinity
				</button>
			</div>
		</nav>
	</div>
</div>

<style>
</style>
