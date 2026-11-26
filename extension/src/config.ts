// Dirección del servidor de SyncWatch. Cada quien monta el suyo, así que se guarda en la extensión
// (popup → Ajustes avanzados) y también puede venir en un link de invitación.
export const DEFAULT_SERVER_URL = "ws://localhost:8080";

// Devuelve la dirección limpia (ws:// o wss://, sin "/" final ni hash) o null si no es válida
export function normalizeServerUrl(raw: string): string | null {
	try {
		const u = new URL(raw.trim());
		if (u.protocol !== "ws:" && u.protocol !== "wss:") return null;
		if (!u.hostname || raw.length > 200) return null;
		u.hash = "";
		return u.toString().replace(/\/$/, "");
	} catch {
		return null;
	}
}

export async function getServerUrl(): Promise<string> {
	const r = await chrome.storage.local.get({ serverUrl: DEFAULT_SERVER_URL });
	return normalizeServerUrl(String(r.serverUrl)) ?? DEFAULT_SERVER_URL;
}

// localhost / 127.0.0.1: solo sirve en el mismo computador
export function isLoopback(url: string): boolean {
	try {
		return ["localhost", "127.0.0.1", "[::1]"].includes(
			new URL(url).hostname,
		);
	} catch {
		return false;
	}
}

// ws:// fuera de tu computador viaja sin cifrar (las contraseñas de sala y el chat se verían en la red)
export function isInsecure(url: string): boolean {
	try {
		return new URL(url).protocol === "ws:" && !isLoopback(url);
	} catch {
		return false;
	}
}
