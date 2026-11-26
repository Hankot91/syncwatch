import type {
	VideoState,
	StateMessage,
	ReadyMessage,
	PageMessage,
	VideoInfoMessage,
	ToContent,
} from "./types";
import { siteIdentity, autoPlayRequestedEpisode } from "./sites";
import { createUi } from "./ui";
import { showInvite } from "./invite";
import { normalizeServerUrl } from "./config";
import type { Invite } from "./invite";
import type { UiState } from "./types";

const TAG = "[SyncWatch]";
const DRIFT_TOLERANCE = 0.5; // segundos de diferencia que toleramos
const SETTLE_MS = 150; // espera para que termine la ráfaga de eventos
const POLL_MS = 200; // cada cuánto revisamos si el video se estabilizó
const MAX_WAIT_MS = 5000; // máximo esperando a que MI video se estabilice antes de enviar
const MAX_SUPPRESS_MS = 10000; // seguro: máximo tiempo sin enviar tras aplicar un estado remoto
const HAVE_FUTURE_DATA = 3; // readyState: hay datos suficientes para seguir reproduciendo
const MIN_VIDEO_AREA = 20000; // px²: un video más pequeño es una vista previa, no el reproductor
const MIN_VIDEO_SECONDS = 120; // duración mínima para contar como "el video" (descarta trailers y anuncios)

const tracked = new WeakSet<HTMLVideoElement>();
let activeVideo: HTMLVideoElement | null = null;
let sendTimer: number | undefined;
let seekedSinceLastSend = false; // ¿hubo un salto del usuario desde el último envío?
let currentEpoch = 0; // número de la espera coordinada en curso

// true mientras el video está "en transición" por culpa de un estado remoto que aplicamos
let suppressing = false;
let suppressTimer: number | undefined;

// Orden remota que llegó cuando esta página aún no tenía <video> (p. ej. recién cargada)
let pendingRemote: {
	state: VideoState;
	onSettled?: () => void;
	at: number;
} | null = null;
const PENDING_MAX_MS = 10000; // pasado este tiempo la orden ya está vieja y se descarta

// Si Chrome bloquea play() por falta de interacción, guardamos el estado y pedimos un clic
let pending: { state: VideoState; receivedAt: number } | null = null;
let overlayHost: HTMLElement | null = null;

function snapshot(video: HTMLVideoElement): VideoState {
	return {
		paused: video.paused,
		time: video.currentTime,
		rate: video.playbackRate,
	};
}

// Estable = no está saltando y tiene datos para reproducir
function isSettled(video: HTMLVideoElement): boolean {
	return !video.seeking && video.readyState >= HAVE_FUTURE_DATA;
}

// --- Local -> otros -------------------------------------------------------

function onVideoEvent(video: HTMLVideoElement, name: string): void {
	activeVideo = video;
	if (suppressing) return; // el cambio lo provocamos nosotros, no el usuario
	if (name === "seeked") seekedSinceLastSend = true;
	window.clearTimeout(sendTimer);
	sendTimer = window.setTimeout(() => sendWhenSettled(video), SETTLE_MS);
}

function sendWhenSettled(
	video: HTMLVideoElement,
	startedAt = performance.now(),
): void {
	if (suppressing) return;
	const waited = performance.now() - startedAt;
	if (!isSettled(video) && waited < MAX_WAIT_MS) {
		// todavía cargando: no enviamos un estado a medias, reintentamos
		sendTimer = window.setTimeout(
			() => sendWhenSettled(video, startedAt),
			POLL_MS,
		);
		return;
	}
	const msg: StateMessage = {
		type: "state",
		state: snapshot(video),
		seek: seekedSinceLastSend,
	};
	seekedSinceLastSend = false;
	chrome.runtime.sendMessage(msg).catch(() => {});
}

function attach(video: HTMLVideoElement): void {
	if (tracked.has(video)) return;
	tracked.add(video);
	for (const name of ["play", "pause", "seeked", "ratechange"] as const) {
		video.addEventListener(name, () => onVideoEvent(video, name));
	}
}

function scan(): void {
	document.querySelectorAll("video").forEach(attach);

	// ¿había una orden esperando a que apareciera el video?
	if (pendingRemote && pickVideo()) {
		const p = pendingRemote;
		pendingRemote = null;
		if (Date.now() - p.at < PENDING_MAX_MS)
			void applyRemote(p.state, p.onSettled);
	}
}

// --- Otros -> local -------------------------------------------------------

function area(v: HTMLVideoElement): number {
	const r = v.getBoundingClientRect();
	return r.width * r.height;
}

function pickVideo(): HTMLVideoElement | null {
	if (activeVideo?.isConnected) return activeVideo;
	const videos = [...document.querySelectorAll("video")];
	videos.sort((a, b) => area(b) - area(a)); // el más grande
	return videos[0] ?? null;
}

// Deja de ignorar eventos locales solo cuando el video se estabiliza de verdad.
// onSettled se llama en ese momento (lo usa la espera coordinada para avisar "ready").
function beginSuppress(video: HTMLVideoElement, onSettled?: () => void): void {
	suppressing = true;
	window.clearTimeout(sendTimer); // cancela cualquier envío pendiente
	seekedSinceLastSend = false;
	window.clearInterval(suppressTimer);

	const startedAt = performance.now();
	let calmChecks = 0;
	suppressTimer = window.setInterval(() => {
		calmChecks = isSettled(video) ? calmChecks + 1 : 0;
		const timedOut = performance.now() - startedAt > MAX_SUPPRESS_MS;
		if (calmChecks >= 2 || timedOut) {
			window.clearInterval(suppressTimer);
			suppressing = false;
			if (timedOut)
				console.warn(
					TAG,
					"El video no se estabilizó en",
					MAX_SUPPRESS_MS,
					"ms",
				);
			onSettled?.();
		}
	}, POLL_MS);
}

// --- Cartel para cuando Chrome bloquea el autoplay -------------------------

function hideOverlay(): void {
	overlayHost?.remove();
	overlayHost = null;
}

function showOverlay(): void {
	if (overlayHost) return;
	const host = document.createElement("div");
	host.style.cssText =
		"all: initial; position: fixed; inset: 0; z-index: 2147483647;";
	const root = host.attachShadow({ mode: "closed" }); // aísla nuestro estilo del de la página
	root.innerHTML = `
    <style>
      .backdrop { position: fixed; inset: 0; display: flex; flex-direction: column;
        align-items: center; justify-content: center; gap: 14px;
        background: rgba(0, 0, 0, 0.6); font-family: system-ui, sans-serif; color: #fff; }
      p { margin: 0; font-size: 16px; text-align: center; max-width: 320px; }
      button { font: inherit; font-weight: 600; padding: 10px 20px; border: 0;
        border-radius: 8px; cursor: pointer; background: #6c5ce7; color: #fff; }
    </style>
    <div class="backdrop">
      <p>La sala ya está reproduciendo. El navegador necesita un clic tuyo para continuar.</p>
      <button type="button">Unirme a la reproducción</button>
    </div>`;
	root.querySelector("button")?.addEventListener("click", onJoinClick);
	document.documentElement.appendChild(host);
	overlayHost = host;
}

function onJoinClick(): void {
	const p = pending;
	pending = null;
	hideOverlay();
	if (!p) return;
	// el tiempo de la sala siguió corriendo mientras el usuario hacía clic
	const elapsed = p.state.paused
		? 0
		: ((performance.now() - p.receivedAt) / 1000) * p.state.rate;
	void applyRemote({ ...p.state, time: p.state.time + elapsed });
}

// --- Aplicar un estado remoto ---------------------------------------------

async function applyRemote(
	state: VideoState,
	onSettled?: () => void,
): Promise<void> {
	const video = pickVideo();
	if (!video) {
		// este frame no tiene video (todavía): guardamos la orden por si aparece pronto
		pendingRemote = { state, onSettled, at: Date.now() };
		return;
	}
	pendingRemote = null;

	if (state.paused) {
		pending = null;
		hideOverlay(); // la sala se pausó: ya no hay nada que pedirle al usuario
	}

	const needsSeek =
		Math.abs(video.currentTime - state.time) > DRIFT_TOLERANCE;
	const needsRate = video.playbackRate !== state.rate;
	const needsPause = state.paused && !video.paused;
	const needsPlay = !state.paused && video.paused;
	const changed = needsSeek || needsRate || needsPause || needsPlay;
	if (!changed && !onSettled) return; // ya estamos igual y nadie espera respuesta

	beginSuppress(video, onSettled); // antes de tocar nada: los eventos llegan después

	if (needsSeek) video.currentTime = state.time;
	if (needsRate) video.playbackRate = state.rate;

	try {
		if (needsPause) video.pause();
		else if (needsPlay) await video.play();
	} catch (err) {
		if (err instanceof DOMException && err.name === "NotAllowedError") {
			console.warn(
				TAG,
				"Chrome bloqueó play(): hace falta un clic del usuario en esta página",
			);
			pending = { state, receivedAt: performance.now() };
			showOverlay();
			return;
		}
		const detail =
			err instanceof DOMException
				? `${err.name}: ${err.message}`
				: String(err);
		console.warn(TAG, "No se pudo reproducir:", detail);
	}
}

function sendReady(epoch: number): void {
	if (epoch !== currentEpoch) return; // mientras tanto llegó una espera más nueva
	const msg: ReadyMessage = { type: "ready", epoch };
	chrome.runtime.sendMessage(msg).catch(() => {});
}

// Panel de la sala: solo en el frame principal
const ui =
	window === window.top
		? createUi((m) => void chrome.runtime.sendMessage(m).catch(() => {}))
		: null;
let invite: Invite | null = null;

// Link de invitación (#sw-room=sala): si no estás en una sala, ofrece unirte
async function checkInvite(): Promise<void> {
	const room = location.hash.match(/sw-room=([^&]+)/)?.[1];
	if (!room) return;
	const state: UiState | null = await chrome.runtime
		.sendMessage({ type: "ui-get" })
		.catch(() => null);
	if (state) return; // ya estás en una sala
	const saved = (await chrome.storage.local.get({ profile: null })) as {
		profile: { name: string; avatar: string } | null;
	};
	const roomName = decodeURIComponent(room);
	const serverRaw = location.hash.match(/sw-server=([^&]+)/)?.[1];
	const server = serverRaw
		? normalizeServerUrl(decodeURIComponent(serverRaw))
		: null;
	invite = showInvite({
		room: roomName,
		server: server ?? undefined,
		locked: /sw-lock=1/.test(location.hash),
		name: saved.profile?.name ?? "",
		avatar: saved.profile?.avatar ?? "zorro",
		onJoin: (name, password, avatar) => {
			chrome.runtime
				.sendMessage({
					type: "join-invite",
					room: roomName,
					password,
					name,
					avatar,
					server,
				})
				.catch(() => {});
		},
	});
}

// Al entrar a la sala quitamos el rastro de la invitación del link (sin tocar el resto del hash)
function stripInviteFromUrl(): void {
	const parts = location.hash
		.replace(/^#/, "")
		.split("&")
		.filter(
			(x) =>
				x &&
				!x.startsWith("sw-room=") &&
				!x.startsWith("sw-lock=") &&
				!x.startsWith("sw-server="),
		);
	history.replaceState(
		null,
		"",
		location.pathname +
			location.search +
			(parts.length ? `#${parts.join("&")}` : ""),
	);
}

if (ui) {
	chrome.runtime
		.sendMessage({ type: "ui-get" })
		.then((state: UiState | null) => {
			ui.setState(state);
			if (!state) void checkInvite();
		})
		.catch(() => {});
}

chrome.runtime.onMessage.addListener((msg: ToContent) => {
	switch (msg?.type) {
		case "ui-state":
			ui?.setState(msg.ui);
			if (msg.ui && invite) {
				invite.close();
				invite = null;
				stripInviteFromUrl();
			}
			break;
		case "reaction":
			ui?.react(msg.from.name, msg.emoji);
			break;
		case "invite-error":
			invite?.error(msg.message);
			break;
		case "ui-toggle":
			ui?.toggle();
			break;
		case "state":
		case "resume":
			void applyRemote(msg.state);
			break;
		case "hold":
			currentEpoch = msg.epoch;
			void applyRemote(msg.state, () => sendReady(msg.epoch));
			break;
		case "report-page":
			if (window === window.top) reportPage();
			break;
		case "pause-now": {
			// la página nueva arranca sola: la congelamos hasta que la sala diga cuándo empezar
			const v = pickVideo();
			if (!v || v.paused) break;
			beginSuppress(v); // que esta pausa no se cuente como una acción del usuario
			v.pause();
			break;
		}
		case "report-presence":
			lastPresent = null; // fuerza el reenvío
			checkPresence();
			break;
		case "report-state": {
			// alguien acaba de llegar: decimos en qué punto vamos, como un salto,
			// para que el servidor haga la espera coordinada con todos
			const video = pickVideo();
			if (!video) break; // este frame no tiene el reproductor
			const reply: StateMessage = {
				type: "state",
				state: snapshot(video),
				seek: true,
				reply: true,
			};
			chrome.runtime.sendMessage(reply).catch(() => {});
			break;
		}
	}
});

scan();
new MutationObserver(scan).observe(document.documentElement, {
	childList: true,
	subtree: true,
});

// --- Página actual (solo el frame principal) --------------------------------

function reportPage(): void {
	const site = siteIdentity(location.href);
	if (site === "pending") return; // hay reproductor pero aún no sabemos qué episodio es
	const msg: PageMessage = {
		type: "page",
		url: location.href,
		title: site?.title ?? document.title,
		id: site?.id,
		nav: site?.nav,
	};
	chrome.runtime.sendMessage(msg).catch(() => {});
}

// Lo que identifica "la página actual": la URL y, en sitios con adaptador, el video que muestra
function pageKey(): string {
	const site = siteIdentity(location.href);
	return (
		location.href +
		"|" +
		(site === "pending" ? "pending" : (site?.id ?? ""))
	);
}

if (window === window.top) {
	let lastKey = pageKey();
	reportPage();
	void autoPlayRequestedEpisode();
	window.setInterval(() => {
		const key = pageKey();
		if (key === lastKey) return;
		lastKey = key;
		reportPage(); // enseguida, para que la sala reaccione rápido
		// los sitios que no recargan (YouTube) actualizan el título un instante después
		window.setTimeout(reportPage, 1000);
	}, 300);
}

// --- ¿Hay un video "de verdad" en este frame? -----------------------------------
// Solo las páginas con un video real cuentan para la sala. Las portadas con vistas
// previas, los anuncios y las páginas sin reproductor quedan fuera de la sincronización.

function isRealVideo(v: HTMLVideoElement): boolean {
	if (area(v) < MIN_VIDEO_AREA) return false;
	// YouTube marca el reproductor mientras muestra un anuncio (a verificar si cambia)
	if (/(^|\.)youtube\.com$/.test(location.hostname)) {
		return !document.querySelector(".html5-video-player.ad-showing");
	}
	// En el resto, la duración distingue la película/episodio de un trailer o anuncio.
	// Infinity = transmisión en vivo; NaN = todavía no se sabe.
	return v.duration === Infinity || v.duration >= MIN_VIDEO_SECONDS;
}

const PRESENT_STABLE_MS = 1000; // tras un anuncio, el video debe verse 1 s seguido (entre dos anuncios hay un instante "limpio")
let presentSince = 0;
const PRESENCE_RESEND_MS = 5000; // reenviamos aunque no cambie, por si el background lo olvidó
let lastPresent: boolean | null = null;
let lastPresenceSentAt = 0;
function checkPresence(): void {
	const raw = [...document.querySelectorAll("video")].some(isRealVideo);
	if (!raw) presentSince = 0;
	else if (presentSince === 0) presentSince = Date.now();
	// pasar de "sin video" a "con video" solo se informa si se mantiene un rato
	const present =
		raw &&
		!(
			lastPresent === false &&
			Date.now() - presentSince < PRESENT_STABLE_MS
		);
	const stale = Date.now() - lastPresenceSentAt > PRESENCE_RESEND_MS;
	if (present === lastPresent && !stale) return;
	lastPresent = present;
	lastPresenceSentAt = Date.now();
	const msg: VideoInfoMessage = { type: "video-info", present };
	chrome.runtime.sendMessage(msg).catch(() => {});
}
window.setInterval(checkPresence, 300);
checkPresence();
