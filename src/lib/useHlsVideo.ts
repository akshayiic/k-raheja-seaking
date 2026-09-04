import Hls from 'hls.js';
import { writable, type Writable, type Readable } from 'svelte/store';

export interface UseHlsVideoOptions {
	/**
	 * HLS playlist (.m3u8). Nothing is attached while this is null/undefined, so
	 * the caller can hold playback back until it wants the stream to start.
	 */
	src?: string | null;

	/**
	 * Gate for the attach. Keep it false until the element is worth streaming to
	 * (near the viewport, past an LCP hold) — the playlist is only fetched once
	 * this flips true.
	 */
	enabled?: boolean;

	/**
	 * Initial bandwidth assumption, in bits per second. hls.js defaults to
	 * 500kbps and applies a 0.95 factor, so on any real ladder the first fragment
	 * is the blurriest rung regardless of the viewer's actual connection.
	 *
	 * This must stay comfortably above the BANDWIDTH the top rung advertises in
	 * master.m3u8, or the first fragment silently drops a rung — raising the
	 * ladder's bitrates without raising this reintroduces the soft first seconds.
	 * The hero ladder tops out near 3Mbps (or ~4.8Mbps once 1080p masters land),
	 * hence 6Mbps. ABR corrects downward within a segment or two if the
	 * connection is slower, and capToPlayerSize keeps small viewports off the
	 * top rung entirely.
	 */
	initialBandwidthEstimate?: number;

	/** Cap the chosen rung to the element's on-screen size. */
	capToPlayerSize?: boolean;

	/**
	 * Optional fallback progressive video URL (e.g. .mp4) to load if HLS fails.
	 */
	fallbackSrc?: string | null;

	/**
	 * Whether to trigger play() once the manifest is parsed.
	 */
	autoPlay?: boolean;
}

export interface UseHlsVideoState {
	/**
	 * Svelte action to attach to the <video> element via `use:attach`.
	 */
	attach: (node: HTMLVideoElement) => { update: (newOptions?: UseHlsVideoOptions) => void; destroy: () => void };

	/**
	 * The blob: URL currently feeding the element, once MSE is attached.
	 */
	blobUrl: Readable<string | null>;

	/**
	 * HLS is unusable here (no MediaSource, or a fatal stream error).
	 */
	failed: Readable<boolean>;

	/**
	 * Direct access to the current HTMLVideoElement.
	 */
	videoElement: Readable<HTMLVideoElement | null>;

	/**
	 * Manually destroy the HLS instance.
	 */
	destroy: () => void;
}

/**
 * Plays an HLS ladder through Media Source Extensions with optimal first-frame bandwidth estimates.
 *
 * The playlist URL is never handed to the video element directly unless fallback is required.
 * hls.js parses the manifest, fetches segments itself and appends them into a MediaSource, whose
 * object URL (`blob:…`) becomes the element's src — so the browser only ever sees buffered media,
 * not an .m3u8.
 *
 * It prevents the initial blurry fragment by starting with a high initial bandwidth estimate (6 Mbps default),
 * prefetching the first fragment immediately (`startFragPrefetch: true`), and leveraging `preferManagedMediaSource: true`.
 */
export function useHlsVideo(initialOptions: UseHlsVideoOptions = {}): UseHlsVideoState {
	let options: UseHlsVideoOptions = {
		enabled: true,
		initialBandwidthEstimate: 6_000_000,
		capToPlayerSize: true,
		autoPlay: true,
		...initialOptions
	};

	const blobUrlStore: Writable<string | null> = writable(null);
	const failedStore: Writable<boolean> = writable(false);
	const videoElementStore: Writable<HTMLVideoElement | null> = writable(null);

	let currentElement: HTMLVideoElement | null = null;
	let hlsInstance: Hls | null = null;
	let currentAttachedSrc: string | null = null;

	function cleanup() {
		if (hlsInstance) {
			try {
				hlsInstance.destroy();
			} catch (e) {
				console.error('Error destroying HLS instance:', e);
			}
			hlsInstance = null;
		}
		currentAttachedSrc = null;
		blobUrlStore.set(null);
	}

	function setup(el: HTMLVideoElement, opts: UseHlsVideoOptions) {
		options = {
			enabled: true,
			initialBandwidthEstimate: 6_000_000,
			capToPlayerSize: true,
			autoPlay: true,
			...opts
		};

		const { src, enabled, initialBandwidthEstimate, capToPlayerSize, fallbackSrc, autoPlay } = options;

		if (!enabled || !el || !src) {
			cleanup();
			if (!src && el) {
				el.removeAttribute('src');
				el.load();
			}
			return;
		}

		if (currentAttachedSrc === src && hlsInstance) {
			return;
		}

		cleanup();
		currentAttachedSrc = src;
		failedStore.set(false);

		// Handle media fragment (e.g. #t=1 or #t=0,6)
		let cleanSrc = src;
		let startPosition: number = -1;
		if (src.includes('#t=')) {
			const hashIndex = src.indexOf('#t=');
			const timeParam = src.substring(hashIndex + 3);
			cleanSrc = src.substring(0, hashIndex);
			const parsedSec = parseFloat(timeParam.split(',')[0]);
			if (!isNaN(parsedSec)) {
				startPosition = parsedSec;
			}
		}

		// If it's a plain video file (not .m3u8), directly play it
		if (!cleanSrc.includes('.m3u8')) {
			el.src = src;
			if (autoPlay) {
				el.play().catch(() => {});
			}
			return;
		}

		// Check if HLS.js is supported
		let hlsInitialized = false;
		if (typeof window !== 'undefined' && Hls.isSupported()) {
			try {
				const hls = new Hls({
					capLevelToPlayerSize: capToPlayerSize,
					autoStartLoad: true,
					abrEwmaDefaultEstimate: initialBandwidthEstimate ?? 6_000_000,
					// Fetch the first fragment while the variant playlist is still being parsed
					startFragPrefetch: true,
					// Prefer ManagedMediaSource on modern Safari/Apple platforms
					preferManagedMediaSource: true,
					enableWorker: true,
					lowLatencyMode: false,
					backBufferLength: 10,
					...(startPosition > 0 ? { startPosition } : {})
				});

				hlsInstance = hls;

				hls.on(Hls.Events.MEDIA_ATTACHED, () => {
					const attached = el.currentSrc || el.src;
					blobUrlStore.set(attached && attached.startsWith('blob:') ? attached : null);
				});

				hls.on(Hls.Events.MANIFEST_PARSED, () => {
					if (startPosition > 0) {
						try {
							el.currentTime = startPosition;
						} catch (_) {}
					}
					if (autoPlay) {
						el.play().catch(() => {});
					}
				});

				hls.on(Hls.Events.ERROR, (_event, data) => {
					if (data.fatal) {
						console.warn('Fatal HLS error encountered:', data);
						switch (data.type) {
							case Hls.ErrorTypes.NETWORK_ERROR:
								console.log('Attempting HLS network recovery...');
								hls.startLoad();
								break;
							case Hls.ErrorTypes.MEDIA_ERROR:
								console.log('Attempting HLS media recovery...');
								hls.recoverMediaError();
								break;
							default:
								failedStore.set(true);
								cleanup();
								if (fallbackSrc) {
									el.src = fallbackSrc;
									if (autoPlay) el.play().catch(() => {});
								}
								break;
						}
					}
				});

				hls.loadSource(cleanSrc);
				hls.attachMedia(el);
				hlsInitialized = true;
			} catch (err) {
				console.warn('Failed to initialize HLS.js instance:', err);
				hlsInitialized = false;
			}
		}

		if (!hlsInitialized) {
			if (el.canPlayType('application/vnd.apple.mpegurl')) {
				// Native HLS fallback (e.g. Safari on iOS without MSE)
				el.src = src;
				if (autoPlay) {
					el.play().catch(() => {});
				}
			} else {
				// HLS is unusable here
				failedStore.set(true);
				if (fallbackSrc) {
					el.src = fallbackSrc;
					if (autoPlay) el.play().catch(() => {});
				}
			}
		}
	}

	function attach(node: HTMLVideoElement) {
		currentElement = node;
		videoElementStore.set(node);

		setup(node, options);

		return {
			update(newOptions?: UseHlsVideoOptions) {
				if (newOptions) {
					options = { ...options, ...newOptions };
					setup(node, options);
				}
			},
			destroy() {
				cleanup();
				currentElement = null;
				videoElementStore.set(null);
			}
		};
	}

	return {
		attach,
		blobUrl: { subscribe: blobUrlStore.subscribe },
		failed: { subscribe: failedStore.subscribe },
		videoElement: { subscribe: videoElementStore.subscribe },
		destroy: cleanup
	};
}

/**
 * Svelte action helper: `<video use:hlsVideo={options} />` or `<video use:hlsVideo={src} />`
 */
export function hlsVideo(node: HTMLVideoElement, options: UseHlsVideoOptions | string | null | undefined) {
	const parsedOptions: UseHlsVideoOptions =
		typeof options === 'string'
			? { src: options, enabled: true, initialBandwidthEstimate: 6_000_000 }
			: options || {};

	const hlsHook = useHlsVideo(parsedOptions);
	const actionInstance = hlsHook.attach(node);

	return {
		update(newOptions: UseHlsVideoOptions | string | null | undefined) {
			const next: UseHlsVideoOptions =
				typeof newOptions === 'string'
					? { src: newOptions, enabled: true, initialBandwidthEstimate: 6_000_000 }
					: newOptions || {};
			actionInstance.update(next);
		},
		destroy() {
			actionInstance.destroy();
		}
	};
}

export default useHlsVideo;
