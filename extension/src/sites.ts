// Adaptadores por sitio: algunos sitios no cambian la URL al cambiar de video
// (Prime Video), así que la identidad del video sale de lo que muestra el reproductor.
import { normalizeUrl } from "./url";

const TAG = "[SyncWatch]";

export type SiteIdentity = { id: string; nav: string; title: string };

const PRIME = /(^|\.)primevideo\.com$/;

// Prime solo pinta el título y el episodio mientras la barra de controles está visible;
// cuando se oculta, esos elementos desaparecen. Por eso recordamos lo último que vimos.
let primeLabel: { show: string; episode: string } | null = null;

function textOf(selector: string): string {
	return document.querySelector(selector)?.textContent?.trim() ?? "";
}

// null      = este sitio no necesita adaptador (se usa la URL de siempre)
// "pending" = hay un reproductor pero aún no sabemos qué episodio es: mejor no informar nada todavía
// ¿Hay un reproductor de verdad (con video cargado)? La portada tiene un <video> vacío de vista
// previa que no cuenta: el reproductor real vive en #dv-web-player y trae un blob: como fuente.
function primePlayerActive(): boolean {
	const v = document.querySelector<HTMLVideoElement>("#dv-web-player video");
	return !!v && (v.currentSrc !== "" || v.readyState > 0);
}

export function siteIdentity(href: string): SiteIdentity | "pending" | null {
	if (!PRIME.test(location.hostname)) return null;

	if (!primePlayerActive()) {
		primeLabel = null; // cerró el reproductor: la etiqueta anterior ya no vale
		return null;
	}

	const show = textOf(".atvwebplayersdk-title-text");
	const episode = textOf(".atvwebplayersdk-episode-info");
	if (show) primeLabel = { show, episode };
	if (!primeLabel) return "pending";

	const key = primeLabel.episode
		? `${primeLabel.show} | ${primeLabel.episode}`
		: primeLabel.show;
	return {
		// identidad: la misma para todos los que ven este episodio, sin importar su URL
		id: `https://www.primevideo.com/#sw=${encodeURIComponent(key)}`,
		// a dónde llevar a otro: la página de la serie, marcando qué episodio reproducir
		nav: `${normalizeUrl(href)}#sw-ep=${encodeURIComponent(primeLabel.episode)}`,
		title: key,
	};
}

// Si llegamos a la página de la serie para ver un episodio concreto, pulsamos su Play.
// El episodio pedido viene en el hash (#sw-ep=T1 E4 Episodio 4) o, si Prime lo borró,
// el background lo recuerda (a veces Prime reescribe la URL al cargar).
export async function autoPlayRequestedEpisode(): Promise<void> {
	if (!PRIME.test(location.hostname)) return;

	let wanted = decodeURIComponent(
		location.hash.match(/sw-ep=([^&]+)/)?.[1] ?? "",
	);
	if (!wanted) {
		try {
			const reply = await chrome.runtime.sendMessage({
				type: "want-episode",
			});
			wanted = typeof reply?.episode === "string" ? reply.episode : "";
		} catch {
			/* el background no contestó */
		}
	}
	if (!wanted) return;

	const number = wanted.match(/E(\d+)/)?.[1];
	if (!number) return;

	const label = new RegExp(
		`(episodio|episode|épisode|episódio)\\s+${number}\\b`,
		"i",
	);
	let tries = 0;
	let clickedAt = 0;
	const timer = window.setInterval(() => {
		tries++;
		if (primePlayerActive()) {
			window.clearInterval(timer);
			return;
		}
		const buttons = [
			...document.querySelectorAll<HTMLAnchorElement>(
				'a[data-testid="episodes-playbutton"]',
			),
		];
		const link = buttons.find((a) =>
			label.test(a.getAttribute("aria-label") ?? ""),
		);

		if (link && clickedAt === 0) {
			clickedAt = Date.now();
			link.click(); // como si lo pulsaras tú
		} else if (link && Date.now() - clickedAt > 6000) {
			window.clearInterval(timer);
			// el clic no abrió el reproductor: vamos directo al enlace del episodio
			location.href = new URL(
				link.getAttribute("href") ?? "",
				location.href,
			).href;
		} else if (tries > 90) {
			window.clearInterval(timer);
			console.warn(
				TAG,
				`Prime: no encontré el episodio ${number} en la lista (${buttons.length} botones)`,
			);
		}
	}, 500);
}
