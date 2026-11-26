import type { Status, Profile, RoomSummary } from "./types";
import { AVATAR_IDS, avatarSvg } from "./avatars";
import { getServerUrl, normalizeServerUrl, isInsecure } from "./config";

const $ = <T extends HTMLElement>(id: string): T =>
	document.getElementById(id) as T;
const nameInput = $<HTMLInputElement>("name");
const avatarsEl = $<HTMLDivElement>("avatars");
const setupEl = $<HTMLDivElement>("setup");
const tabJoin = $<HTMLButtonElement>("tab-join");
const tabCreate = $<HTMLButtonElement>("tab-create");
const joinBox = $<HTMLDivElement>("join-box");
const createBox = $<HTMLDivElement>("create-box");
const roomsEl = $<HTMLDivElement>("rooms");
const refreshBtn = $<HTMLButtonElement>("refresh");
const joinPassBox = $<HTMLDivElement>("join-pass");
const joinPassLabel = $<HTMLLabelElement>("join-password-label");
const joinPass = $<HTMLInputElement>("join-password");
const roomInput = $<HTMLInputElement>("room");
const createPass = $<HTMLInputElement>("create-password");
const toggleBtn = $<HTMLButtonElement>("toggle");
const statusEl = $<HTMLDivElement>("status");
const mismatchEl = $<HTMLDivElement>("mismatch");
const mismatchText = $<HTMLDivElement>("mismatch-text");
const goBtn = $<HTMLButtonElement>("go");
const advBox = $<HTMLDetailsElement>("adv");
const serverInput = $<HTMLInputElement>("server");
const serverNote = $<HTMLDivElement>("server-note");
const serverSave = $<HTMLButtonElement>("server-save");

// Íconos (Material, rellenos): se pintan con el color del texto
const svg = (path: string, size = 14): string =>
	`<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
const ICON_LOCK =
	"M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zM9 8V6c0-1.66 1.34-3 3-3s3 1.34 3 3v2H9z";
const ICON_PEOPLE =
	"M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z";
const ICON_EYE =
	"M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z";
const ICON_EYE_OFF =
	"M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z";

let avatar: string = AVATAR_IDS[0];
let profileId = "";
let rooms: RoomSummary[] = [];
let selected = ""; // sala elegida en la lista
let mode: "join" | "create" = "join";
let idle = true;
let serverUrl = "";

function showError(text: string): void {
	statusEl.className = "error";
	statusEl.textContent = text;
}

// --- Mostrar / ocultar contraseña ----------------------------------------------------
for (const btn of document.querySelectorAll<HTMLButtonElement>(".eye")) {
	const input = $<HTMLInputElement>(btn.dataset.for ?? "");
	const paint = (): void => {
		const hidden = input.type === "password";
		btn.innerHTML = svg(hidden ? ICON_EYE : ICON_EYE_OFF, 18);
		btn.title = btn.ariaLabel = hidden
			? "Mostrar contraseña"
			: "Ocultar contraseña";
	};
	btn.addEventListener("click", () => {
		input.type = input.type === "password" ? "text" : "password";
		paint();
	});
	paint();
}

// --- Avatares ------------------------------------------------------------------------
function drawAvatars(): void {
	avatarsEl.replaceChildren();
	for (const id of AVATAR_IDS) {
		const b = document.createElement("button");
		b.type = "button";
		b.setAttribute("role", "radio");
		b.setAttribute("aria-checked", String(id === avatar));
		b.title = id;
		b.disabled = !idle;
		b.innerHTML = avatarSvg(id, 32);
		b.addEventListener("click", () => {
			avatar = id;
			drawAvatars();
		});
		avatarsEl.append(b);
	}
}

// --- Modo: buscar sala / crear sala ---------------------------------------------------
function setMode(m: "join" | "create"): void {
	mode = m;
	tabJoin.setAttribute("aria-selected", String(m === "join"));
	tabCreate.setAttribute("aria-selected", String(m === "create"));
	joinBox.hidden = m !== "join";
	createBox.hidden = m !== "create";
	toggleBtn.textContent =
		m === "join" ? "Unirme a la sala" : "Crear y entrar";
	statusEl.textContent = "";
	statusEl.className = "";
}
tabJoin.addEventListener("click", () => setMode("join"));
tabCreate.addEventListener("click", () => setMode("create"));

// --- Lista de salas --------------------------------------------------------------------
function selectedRoom(): RoomSummary | undefined {
	return rooms.find((r) => r.name === selected);
}

function syncJoinPassword(): void {
	const r = selectedRoom();
	joinPassBox.hidden = !r?.locked;
	if (r?.locked)
		joinPassLabel.innerHTML = `${svg(ICON_LOCK, 12)}Contraseña de la sala ${r.name}`;
	else joinPass.value = "";
}

function drawRooms(): void {
	roomsEl.replaceChildren();
	if (rooms.length === 0) {
		const hint = document.createElement("div");
		hint.className = "hint";
		hint.append("No hay salas activas. ");
		const go = document.createElement("button");
		go.className = "link";
		go.type = "button";
		go.textContent = "Crea una";
		go.addEventListener("click", () => setMode("create"));
		hint.append(go, ".");
		roomsEl.append(hint);
		return;
	}
	for (const r of rooms) {
		const b = document.createElement("button");
		b.type = "button";
		b.className = r.name === selected ? "room sel" : "room";
		const col = document.createElement("span");
		col.className = "col";
		const nm = document.createElement("span");
		nm.className = "nm";
		if (r.locked) nm.insertAdjacentHTML("beforeend", svg(ICON_LOCK, 13));
		const label = document.createElement("span");
		label.textContent = r.name;
		nm.append(label);
		col.append(nm);
		if (r.title) {
			const sm = document.createElement("small");
			sm.textContent = r.title;
			col.append(sm);
		}
		const meta = document.createElement("span");
		meta.className = "meta";
		meta.insertAdjacentHTML("beforeend", svg(ICON_PEOPLE, 14));
		meta.append(String(r.members));
		b.append(col, meta);
		b.addEventListener("click", () => {
			selected = r.name;
			drawRooms();
			syncJoinPassword();
			if (r.locked) joinPass.focus();
		});
		roomsEl.append(b);
	}
}

async function loadRooms(): Promise<void> {
	roomsEl.className = "hint";
	roomsEl.textContent = "Buscando salas…";
	const res:
		| { ok: true; rooms: RoomSummary[] }
		| { ok: false; error: string } = await chrome.runtime.sendMessage({
		type: "list-rooms",
	});
	if (!res.ok) {
		rooms = [];
		roomsEl.textContent = `No se pudo cargar la lista: ${res.error}`;
		return;
	}
	roomsEl.className = "";
	rooms = res.rooms;
	if (!rooms.some((r) => r.name === selected)) selected = "";
	drawRooms();
	syncJoinPassword();
}

// --- Servidor ---------------------------------------------------------------------------
function paintServerNote(url: string): void {
	serverNote.className = "hint";
	serverNote.textContent = isInsecure(url)
		? "Sin cifrar (ws://): fuera de tu computador, la contraseña de las salas y el chat viajarían en claro. Usa wss://."
		: url.startsWith("wss://")
			? "Conexión cifrada (wss://)."
			: "Servidor local (solo funciona en este computador).";
}

serverSave.addEventListener("click", async () => {
	const url = normalizeServerUrl(serverInput.value);
	if (!url) {
		serverNote.className = "hint error";
		serverNote.textContent =
			"Escribe una dirección que empiece con ws:// o wss:// (ej: wss://mi-servidor.ts.net)";
		return;
	}
	await chrome.storage.local.set({ serverUrl: url });
	serverUrl = url;
	serverInput.value = url;
	paintServerNote(url);
	void loadRooms();
});

// --- Estado de la conexión ---------------------------------------------------------------
function render(status: Status): void {
	idle = status.phase === "idle";
	toggleBtn.classList.toggle("leave", !idle);
	toggleBtn.textContent = idle
		? mode === "join"
			? "Unirme a la sala"
			: "Crear y entrar"
		: "Salir de la sala";
	nameInput.disabled = !idle;
	setupEl.hidden = !idle;
	advBox.hidden = !idle;
	drawAvatars();

	statusEl.className = status.phase === "error" ? "error" : "";
	switch (status.phase) {
		case "idle":
			if (status.message) {
				statusEl.textContent = status.message;
				statusEl.className = "error";
			} else if (!statusEl.textContent)
				statusEl.textContent = "Sin conexión.";
			break;
		case "connecting":
			statusEl.textContent = status.message ?? "Conectando...";
			break;
		case "connected":
			statusEl.textContent = `Conectado a la sala ${status.room} · ${status.peers} persona(s)`;
			break;
		case "error":
			statusEl.textContent = `Error: ${status.message}`;
			break;
	}

	const roomPage =
		status.phase === "connected" && status.mismatch
			? status.roomPage
			: undefined;
	mismatchEl.hidden = !roomPage;
	if (roomPage) {
		mismatchText.textContent =
			`La sala está en:\n${roomPage.title || roomPage.url}\n${roomPage.url}\n\n` +
			`Tu pestaña:\n${status.myPage?.url ?? "(aún no informada)"}\n\n` +
			"Mientras no coincidan, no se sincroniza nada.";
	}
}

async function init(): Promise<void> {
	serverUrl = await getServerUrl();
	serverInput.value = serverUrl;
	paintServerNote(serverUrl);
	$("version").textContent =
		`SyncWatch v${chrome.runtime.getManifest().version}`;
	const saved = (await chrome.storage.local.get({
		room: "",
		profile: null,
	})) as {
		room: string;
		profile: Profile | null;
	};
	selected = saved.room;
	profileId = saved.profile?.id ?? crypto.randomUUID();
	nameInput.value = saved.profile?.name ?? "";
	avatar = saved.profile?.avatar ?? AVATAR_IDS[0];
	setMode("join");
	const status: Status = await chrome.runtime.sendMessage({
		type: "get-status",
	});
	render(status);
	if (status.phase === "idle") void loadRooms();
}

refreshBtn.addEventListener("click", () => void loadRooms());

toggleBtn.addEventListener("click", async () => {
	const status: Status = await chrome.runtime.sendMessage({
		type: "get-status",
	});
	if (status.phase !== "idle") {
		await chrome.runtime.sendMessage({ type: "leave" });
		return;
	}

	const name = nameInput.value.trim();
	if (!name)
		return showError("Escribe tu apodo para que los demás te reconozcan");

	let room: string;
	let password: string;
	if (mode === "join") {
		const r = selectedRoom();
		if (!r)
			return showError(
				"Elige una sala de la lista (o crea una nueva en «Crear sala»)",
			);
		if (r.locked && !joinPass.value)
			return showError("Esta sala tiene contraseña: escríbela arriba");
		room = r.name;
		password = r.locked ? joinPass.value : "";
	} else {
		room = roomInput.value.trim();
		if (!room) return showError("Escribe un nombre para la sala nueva");
		if (rooms.some((r) => r.name === room))
			return showError(
				"Ya existe una sala con ese nombre: búscala en «Buscar sala»",
			);
		password = createPass.value;
	}

	const profile: Profile = { id: profileId, name, avatar };
	const [tab] = await chrome.tabs.query({
		active: true,
		currentWindow: true,
	});
	if (tab?.id === undefined)
		return showError("No se encontró la pestaña activa");

	await chrome.storage.local.set({ room, profile }); // la contraseña nunca se guarda
	await chrome.runtime.sendMessage({
		type: "join",
		serverUrl,
		room,
		tabId: tab.id,
		profile,
		password: password || undefined,
	});
});

chrome.runtime.onMessage.addListener((msg) => {
	if (msg?.type === "status") render(msg.status);
});

goBtn.addEventListener("click", () => {
	void chrome.runtime.sendMessage({ type: "go-to-room-page" });
});

void init();
