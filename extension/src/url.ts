// Parámetros que no cambian qué video es
const TRACKING_PARAMS = new Set([
	"fbclid",
	"gclid",
	"t",
	"si",
	"feature",
	"pp",
]);

// Sitios donde la URL trae mucho ruido: nos quedamos solo con lo que identifica el video
function canonicalVideoUrl(u: URL): string | null {
	const host = u.hostname.replace(/^(www|m)\./, "");

	if (host === "youtube.com") {
		if (u.pathname === "/watch") {
			const id = u.searchParams.get("v");
			if (id) return `https://youtube.com/watch?v=${id}`;
		}
		const m = u.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]+)/);
		if (m) return `https://youtube.com/watch?v=${m[1]}`;
	}

	if (host === "youtu.be") {
		const id = u.pathname.split("/")[1];
		if (id) return `https://youtube.com/watch?v=${id}`;
	}

	return null;
}

// Identidad de un video: misma página = mismo video.
export function normalizeUrl(href: string): string {
	try {
		const u = new URL(href);

		const special = canonicalVideoUrl(u);
		if (special) return special;

		// Regla general: ignora el hash, "www.", los parámetros de seguimiento y la "/" final
		u.hash = "";
		u.hostname = u.hostname.replace(/^www\./, "");
		for (const key of [...u.searchParams.keys()]) {
			if (key.startsWith("utm_") || TRACKING_PARAMS.has(key))
				u.searchParams.delete(key);
		}
		u.searchParams.sort();
		const path = u.pathname.replace(/\/+$/, "");
		u.pathname = path === "" ? "/" : path;
		return u.toString();
	} catch {
		return href; // si no es una URL válida, la dejamos tal cual
	}
}

// ¿Esta URL es una página de video? En YouTube solo lo son /watch, /shorts, /live y /embed
// (la portada, las búsquedas y los canales no). En el resto de sitios no lo sabemos por la URL.
export function isVideoPage(href: string): boolean {
	try {
		const u = new URL(href);
		const host = u.hostname.replace(/^(www|m)\./, "");
		if (host === "youtube.com" || host === "youtu.be") return canonicalVideoUrl(u) !== null;
		return true;
	} catch {
		return false;
	}
}

// "Sitio" de una URL, para saber si dos páginas son del mismo servicio:
// primevideo.com, youtube.com (youtu.be cuenta como youtube.com)...
export function siteOf(href: string): string {
	try {
		const host = new URL(href).hostname.replace(/^(www|m)\./, "");
		if (host === "youtu.be") return "youtube.com";
		const parts = host.split(".");
		const secondLevel = ["co", "com", "org", "net", "gov", "edu", "ac"];
		const keep =
			parts.length >= 3 &&
			parts[parts.length - 1].length === 2 &&
			secondLevel.includes(parts[parts.length - 2])
				? 3
				: 2;
		return parts.slice(-keep).join(".");
	} catch {
		return href;
	}
}
