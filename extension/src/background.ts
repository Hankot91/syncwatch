import type {
	VideoState,
	Session,
	Status,
	PageInfo,
	Profile,
	MemberInfo,
	LogEntry,
	UiState,
	RoomSummary,
	WaitInfo,
	WaitReason,
} from "./types";
import { normalizeUrl, isVideoPage, siteOf } from "./url";
import { getServerUrl, normalizeServerUrl } from "./config";

type ServerMessage =
	| {
			type: "joined";
			room: string;
			peers: number;
			you: string;
			members: MemberInfo[];
			locked: boolean;
	  }
	| { type: "peers"; peers: number; members: MemberInfo[] }
	| { type: "chat"; from: Profile; text: string; at: number }
	| { type: "reaction"; from: Profile; emoji: string }
	| {
			type: "event";
			kind: string;
			who?: Profile;
			detail?: string;
			at: number;
	  }
	| {
			type: "wait";
			ready: number;
			total: number;
			reason: WaitReason;
			by?: string;
	  }
	| { type: "wait-end" }
	| { type: "notice"; message: string }
	| { type: "room-page"; page: PageInfo | null }
	| { type: "state"; state: VideoState }
	| { type: "hold"; epoch: number; state: VideoState }
	| { type: "resume"; epoch: number; state: VideoState }
	| { type: "request-state" }
	| { type: "pong" }
	| { type: "error"; message: string; code?: "password" };

const KEEPALIVE_MS = 20_000;
const MAX_LOG = 100;
const MAX_BACKOFF_MS = 15_000;

let session: Session | null = null;
let socket: WebSocket | null = null;
let currentStatus: Status = { phase: "idle" };
let keepAliveTimer: number | undefined;
let reconnectTimer: number | undefined;
let attempts = 0;

let peers = 0; // personas en la sala
let members: MemberInfo[] = []; // quiénes y cómo están
let you = ""; // id de tu perfil
let log: LogEntry[] = []; // chat y avisos de esta sesión
let wait: WaitInfo | null = null; // espera en curso ("2 de 3 listos")
let online = false; // ¿hay conexión con el servidor ahora?
let locked = false; // ¿la sala tiene contraseña?
let myPage: PageInfo | null = null; // página de la pestaña de la fiesta (URL normalizada)
let roomPage: PageInfo | null = null; // video de la sala
let followedUrl: string | null = null; // último video de la sala al que ya nos llevamos (evita bucles)
let followPending = true; // al unirte: si la sala está en otro video, te lleva (la sala tiene prioridad)
const videoFrames = new Map<number, boolean>(); // frame de la pestaña -> ¿tiene un video real?
let lastPushed = ""; // lo último que le contamos al servidor sobre nuestra página
const FOLLOW_GRACE_MS = 5000; // igual que en el servidor
let freezeUntil = 0; // hasta cuándo pausamos el video que aparezca (la página nueva arranca sola)
let inRoomPage = false; // ¿estábamos en el video de la sala la última vez que miramos?
let syncedSince = 0; // desde cuándo
let wantEpisode: { label: string; until: number } | null = null; // episodio de Prime que hay que abrir al llegar

// Tu pestaña está en otro video que la sala
function isMismatch(): boolean {
	return roomPage !== null && myPage !== null && roomPage.url !== myPage.url;
}

// Lleva nuestra pestaña al video de la sala (una sola vez por video, para no hacer bucles).
// Si el sitio nos redirige y seguimos "en otro video", queda el aviso del popup como respaldo.
function goToRoom(): void {
	if (!session || !roomPage || !isMismatch()) return;
	if (followedUrl === roomPage.url) return;
	followedUrl = roomPage.url;
	freezeUntil = Date.now() + 20_000; // al llegar, el video queda quieto hasta que la sala arranque
	const ep = (roomPage.nav ?? "").match(/sw-ep=([^&]+)/)?.[1];
	wantEpisode = ep
		? { label: decodeURIComponent(ep), until: Date.now() + 60_000 }
		: null;
	void chrome.tabs.update(session.tabId, {
		url: roomPage.nav ?? roomPage.url,
	});
}

// Solo al unirte: la sala ya estaba viendo algo y tiene prioridad sobre lo que tú tuvieras abierto
function joinFollow(): void {
	if (!followPending || !roomPage || !myPage) return;
	followPending = false;
	goToRoom();
}

// Pausa el video de la pestaña (todos los frames) sin esperar al servidor
function pauseNow(): void {
	if (!session) return;
	chrome.tabs
		.sendMessage(session.tabId, { type: "pause-now" })
		.catch(() => {});
}

// Si venimos de un cambio de video, pausamos el video nuevo en cuanto aparezca,
// para que no se vea reproducirse y luego rebobinar cuando la sala nos detenga.
function freezeIfNeeded(): void {
	if (Date.now() >= freezeUntil || !hasVideo()) return;
	freezeUntil = 0;
	pauseNow();
}

// Anota desde cuándo estamos en el video de la sala
function noteSync(): void {
	const now =
		roomPage !== null && myPage !== null && roomPage.url === myPage.url;
	if (now && !inRoomPage) syncedSince = Date.now();
	if (now) wantEpisode = null; // ya llegamos al video de la sala
	inRoomPage = now;
}

// Nuestra pestaña cuenta para la sala solo si está en una página de video y algún frame tiene un video real
function hasVideo(): boolean {
	return (
		myPage !== null &&
		isVideoPage(myPage.url) &&
		[...videoFrames.values()].some(Boolean)
	);
}

// Le cuenta al servidor en qué página estamos y si tiene video (solo si algo cambió)
function pushPage(): void {
	if (!myPage) return;
	const video = hasVideo();
	const key = `${myPage.url}|${myPage.title}|${myPage.nav ?? ""}|${video}`;
	if (key === lastPushed) return;
	lastPushed = key;
	sendToServer({
		type: "page",
		url: myPage.url,
		title: myPage.title,
		nav: myPage.nav,
		video,
	});
}

function setStatus(next: Status): void {
	currentStatus = next;
	// el popup puede estar cerrado: ese error es normal
	chrome.runtime
		.sendMessage({ type: "status", status: currentStatus })
		.catch(() => {});
}

// --- Panel de la página ---------------------------------------------------------

function uiState(): UiState | null {
	if (!session) return null;
	return {
		room: session.room,
		you,
		online,
		members,
		log,
		wait,
		roomUrl: roomPage ? (roomPage.nav ?? roomPage.url) : null,
		server: session.serverUrl,
		locked,
	};
}

// Manda el estado al panel del frame principal de la pestaña (si la página aún no cargó, lo pedirá él)
function pushUi(): void {
	if (!session) return;
	chrome.tabs
		.sendMessage(
			session.tabId,
			{ type: "ui-state", ui: uiState() },
			{ frameId: 0 },
		)
		.catch(() => {});
}

function addLog(entry: LogEntry): void {
	log.push(entry);
	if (log.length > MAX_LOG) log.splice(0, log.length - MAX_LOG);
}

// Texto amistoso de un aviso del servidor (los propios casi no se muestran: ya los viste)
function eventText(
	kind: string,
	who: Profile | undefined,
	detail: string | undefined,
): string | null {
	const mine = who?.id === you;
	const n = who?.name ?? "Alguien";
	switch (kind) {
		case "join":
			return `${n} se unió a la sala`;
		case "back":
			return `${n} volvió a conectarse`;
		case "leave":
			return `${n} salió de la sala`;
		case "drop":
			return `${n} perdió la conexión`;
		case "play":
			return `${n} reanudó el video${detail ? ` (${detail})` : ""}`;
		case "pause":
			return `${n} pausó el video${detail ? ` (${detail})` : ""}`;
		case "seek":
			return `${n} saltó a ${detail ?? "otro punto"}`;
		case "video":
			return mine
				? "Cambiaste de video"
				: `${n} cambió de video${detail ? `: ${detail}` : ""}`;
		case "ad":
			return mine
				? "Estás en un anuncio: los demás esperan"
				: `${n} está viendo un anuncio`;
		default:
			return null;
	}
}

function connectedStatus(room: string): Status {
	return {
		phase: "connected",
		room,
		peers,
		roomPage: roomPage ?? undefined,
		mismatch: isMismatch(),
		myPage: myPage ?? undefined,
	};
}

function refreshStatus(): void {
	if (session && currentStatus.phase === "connected")
		setStatus(connectedStatus(session.room));
}

function sendToServer(msg: object): void {
	if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}

// Pide al frame principal de la pestaña que informe en qué página está
function askPage(): void {
	if (!session) return;
	chrome.tabs
		.sendMessage(session.tabId, { type: "report-page" }, { frameId: 0 })
		.catch(() => {});
	// todos los frames dicen si tienen video (el service worker pudo haberlo olvidado)
	chrome.tabs
		.sendMessage(session.tabId, { type: "report-presence" })
		.catch(() => {});
}

function handle(msg: ServerMessage): void {
	if (!session) return;
	switch (msg.type) {
		case "joined":
			peers = msg.peers;
			you = msg.you;
			locked = msg.locked;
			members = msg.members;
			online = true;
			wait = null;
			lastPushed = ""; // conexión nueva: el servidor no sabe nada de nosotros
			setStatus(connectedStatus(msg.room));
			pushUi();
			askPage(); // el servidor decide si estás sincronizado según tu página
			break;
		case "peers":
			peers = msg.peers;
			members = msg.members;
			setStatus(connectedStatus(session.room));
			pushUi();
			break;
		case "chat":
			addLog({
				kind: "chat",
				from: msg.from,
				text: msg.text,
				at: msg.at,
				mine: msg.from.id === you,
			});
			pushUi();
			break;
		case "reaction": // no va al chat: se dibuja flotando sobre el video
			chrome.tabs
				.sendMessage(
					session.tabId,
					{
						type: "reaction",
						from: msg.from,
						emoji: msg.emoji,
						mine: msg.from.id === you,
					},
					{ frameId: 0 },
				)
				.catch(() => {});
			break;
		case "event": {
			const text = eventText(msg.kind, msg.who, msg.detail);
			if (text) {
				addLog({ kind: "event", text, at: msg.at });
				pushUi();
			}
			break;
		}
		case "wait":
			wait = {
				ready: msg.ready,
				total: msg.total,
				reason: msg.reason,
				by: msg.by,
			};
			pushUi();
			break;
		case "wait-end":
			wait = null;
			pushUi();
			break;
		case "notice":
			addLog({ kind: "event", text: msg.message, at: Date.now() });
			pushUi();
			break;
		case "room-page": {
			const changed =
				roomPage !== null &&
				msg.page !== null &&
				roomPage.url !== msg.page.url;
			roomPage = msg.page;
			noteSync();
			refreshStatus();
			if (changed)
				goToRoom(); // la sala cambió de video: todos van
			else joinFollow(); // recién unido: la sala tiene prioridad
			break;
		}
		case "state":
		case "hold":
		case "resume":
			freezeUntil = 0; // el servidor ya manda sobre el reproductor
			// si estás en otro video, tu reproductor no se toca
			if (!isMismatch())
				chrome.tabs.sendMessage(session.tabId, msg).catch(() => {});
			break;
		case "request-state":
			// alguien llegó al video de la sala: pedimos a nuestro reproductor su punto actual
			if (!isMismatch())
				chrome.tabs
					.sendMessage(session.tabId, { type: "report-state" })
					.catch(() => {});
			break;
		case "error":
			if (msg.code === "password") {
				// sin contraseña o incorrecta: no tiene sentido reintentar, se vuelve al popup con el motivo
				chrome.tabs
					.sendMessage(
						session.tabId,
						{ type: "invite-error", message: msg.message },
						{ frameId: 0 },
					)
					.catch(() => {});
				void stopSession(msg.message);
				break;
			}
			setStatus({
				phase: "error",
				room: session.room,
				message: msg.message,
			});
			break;
		case "pong":
			break;
	}
}

function scheduleReconnect(code: number): void {
	if (!session) return;
	attempts++;
	online = false;
	wait = null;
	pushUi();
	const delay = Math.min(1000 * 2 ** (attempts - 1), MAX_BACKOFF_MS);
	setStatus({
		phase: "connecting",
		room: session.room,
		message: `Sin conexión con ${session.serverUrl} (código ${code}). Reintentando en ${Math.round(delay / 1000)} s...`,
	});
	reconnectTimer = setTimeout(connect, delay);
}

function connect(): void {
	if (!session) return;
	clearTimeout(reconnectTimer);
	clearInterval(keepAliveTimer);
	socket?.close();

	const { serverUrl, room } = session;
	setStatus({
		phase: "connecting",
		room,
		message: `Conectando a ${serverUrl}...`,
	});

	let ws: WebSocket;
	try {
		ws = new WebSocket(serverUrl);
	} catch {
		setStatus({
			phase: "error",
			room,
			message: `URL de servidor inválida: ${serverUrl}`,
		});
		return;
	}
	socket = ws;

	ws.onopen = () => {
		attempts = 0;
		ws.send(
			JSON.stringify({
				type: "join",
				room,
				profile: session?.profile,
				password: session?.password,
			}),
		);
		keepAliveTimer = setInterval(
			() => sendToServer({ type: "ping" }),
			KEEPALIVE_MS,
		);
	};

	ws.onmessage = (ev) => {
		if (ws !== socket) return; // es de una conexión vieja
		try {
			handle(JSON.parse(String(ev.data)) as ServerMessage);
		} catch {
			console.warn(
				"[SyncWatch] mensaje del servidor no es JSON:",
				ev.data,
			);
		}
	};

	ws.onclose = (ev) => {
		if (ws !== socket) return; // la cerramos nosotros a propósito
		clearInterval(keepAliveTimer);
		scheduleReconnect(ev.code);
	};
}

async function startSession(next: Session): Promise<void> {
	session = next;
	attempts = 0;
	peers = 0;
	members = [];
	you = "";
	log = [];
	wait = null;
	online = false;
	myPage = null;
	roomPage = null;
	followedUrl = null;
	followPending = true;
	freezeUntil = 0;
	inRoomPage = false;
	wantEpisode = null;
	lastPushed = "";
	videoFrames.clear();
	await chrome.storage.session.set({ session: next });
	connect();
}

async function stopSession(message?: string): Promise<void> {
	const tabId = session?.tabId;
	sendToServer({ type: "bye" }); // salida a propósito (distinta de un corte de red)
	if (tabId !== undefined)
		chrome.tabs
			.sendMessage(tabId, { type: "ui-state", ui: null }, { frameId: 0 })
			.catch(() => {});
	session = null;
	members = [];
	log = [];
	wait = null;
	online = false;
	myPage = null;
	roomPage = null;
	followedUrl = null;
	freezeUntil = 0;
	inRoomPage = false;
	wantEpisode = null;
	lastPushed = "";
	videoFrames.clear();
	peers = 0;
	clearTimeout(reconnectTimer);
	clearInterval(keepAliveTimer);
	const old = socket;
	socket = null; // así su onclose se ignora
	old?.close();
	await chrome.storage.session.remove("session");
	setStatus({ phase: "idle", message });
}

// Lista de salas: conexión corta solo para preguntar y cerrar
function listRoomsAt(
	serverUrl: string,
): Promise<{ ok: true; rooms: RoomSummary[] } | { ok: false; error: string }> {
	return new Promise((resolve) => {
		let ws: WebSocket;
		try {
			ws = new WebSocket(serverUrl);
		} catch {
			resolve({
				ok: false,
				error: `URL de servidor inválida: ${serverUrl}`,
			});
			return;
		}
		const timer = setTimeout(() => {
			ws.close();
			resolve({ ok: false, error: `${serverUrl} no respondió en 4 s` });
		}, 4000);
		ws.onopen = () => ws.send(JSON.stringify({ type: "list" }));
		ws.onmessage = (ev) => {
			try {
				const m = JSON.parse(String(ev.data)) as {
					type: string;
					rooms?: RoomSummary[];
				};
				if (m.type !== "rooms" || !m.rooms) return;
				clearTimeout(timer);
				ws.close();
				resolve({ ok: true, rooms: m.rooms });
			} catch {
				/* mensaje ajeno a la lista: se ignora */
			}
		};
		ws.onerror = () => {
			clearTimeout(timer);
			resolve({
				ok: false,
				error: `No se pudo conectar con ${serverUrl}`,
			});
		};
	});
}

async function listRooms(): Promise<
	{ ok: true; rooms: RoomSummary[] } | { ok: false; error: string }
> {
	return listRoomsAt(await getServerUrl());
}

// Entrar a una sala desde la tarjeta de invitación (usa el perfil guardado; si no hay, lo crea con el apodo escrito)
async function joinFromInvite(
	tabId: number,
	room: string,
	password: unknown,
	name: unknown,
	avatar: unknown,
	server: unknown,
): Promise<void> {
	const saved = (await chrome.storage.local.get({ profile: null })) as {
		profile: Profile | null;
	};
	const nick = typeof name === "string" ? name.trim().slice(0, 20) : "";
	const profile: Profile = {
		id: saved.profile?.id ?? crypto.randomUUID(),
		name: nick || saved.profile?.name || "Invitado",
		avatar:
			typeof avatar === "string"
				? avatar
				: (saved.profile?.avatar ?? "zorro"),
	};
	await chrome.storage.local.set({ profile });
	// el link de invitación puede traer la dirección del servidor: se guarda para la próxima vez
	const fromLink =
		typeof server === "string" ? normalizeServerUrl(server) : null;
	if (fromLink) await chrome.storage.local.set({ serverUrl: fromLink });
	await startSession({
		serverUrl: fromLink ?? (await getServerUrl()),
		room,
		tabId,
		profile,
		password:
			typeof password === "string" && password ? password : undefined,
	});
}

// Los listeners se registran al nivel superior: el service worker se despierta y duerme
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
	const fromPartyTab = session !== null && sender.tab?.id === session.tabId;

	switch (msg?.type) {
		case "state": // viene del content script
			if (fromPartyTab && !isMismatch()) {
				sendToServer({
					type: "state",
					state: msg.state,
					seek: msg.seek === true,
					reply: msg.reply === true,
				});
			}
			break;
		case "ready":
			if (fromPartyTab && !isMismatch())
				sendToServer({ type: "ready", epoch: msg.epoch });
			break;
		case "page": // solo cuenta la página del frame principal
			if (fromPartyTab && sender.frameId === 0) {
				const prev = myPage;
				// los sitios con adaptador (Prime) traen su propia identidad (id) y a dónde ir (nav)
				myPage = {
					url:
						typeof msg.id === "string"
							? msg.id
							: normalizeUrl(msg.url),
					title: msg.title,
					nav: typeof msg.nav === "string" ? msg.nav : undefined,
				};
				// Estabas en el video de la sala y te fuiste a OTRO sitio: sales de la sala
				if (
					roomPage &&
					prev?.url === roomPage.url &&
					siteOf(myPage.url) !== siteOf(roomPage.url)
				) {
					void stopSession(
						"Saliste de la sala porque cambiaste de sitio.",
					);
					break;
				}
				// Estabas en el video de la sala y abriste OTRO video del mismo sitio: el video
				// nuevo se pausa apenas aparezca; la sala decide cuándo arrancan todos.
				if (
					roomPage &&
					prev?.url === roomPage.url &&
					myPage.url !== roomPage.url &&
					isVideoPage(myPage.url) &&
					Date.now() - syncedSince > FOLLOW_GRACE_MS
				) {
					freezeUntil = Date.now() + 15_000;
				}
				noteSync();
				pushPage();
				freezeIfNeeded();
				refreshStatus();
				joinFollow();
			}
			break;
		case "want-episode": // la página de Prime pregunta si debe abrir un episodio concreto
			sendResponse(
				fromPartyTab && wantEpisode && Date.now() < wantEpisode.until
					? { episode: wantEpisode.label }
					: {},
			);
			break;
		case "video-info": // un frame de la pestaña dice si tiene un video real
			if (fromPartyTab && sender.frameId !== undefined) {
				videoFrames.set(sender.frameId, msg.present === true);
				pushPage();
				freezeIfNeeded();
			}
			break;
		case "get-status":
			sendResponse(currentStatus);
			break;
		case "list-rooms": // el popup pide la lista de salas del servidor
			void listRooms().then(sendResponse);
			return true; // respuesta asíncrona
		case "join-invite": // la tarjeta de invitación de la página pide entrar a una sala
			if (sender.tab?.id !== undefined && typeof msg.room === "string")
				void joinFromInvite(
					sender.tab.id,
					msg.room,
					msg.password,
					msg.name,
					msg.avatar,
					msg.server,
				);
			break;
		case "ui-get": // el panel de la página recién cargada pide el estado
			sendResponse(
				fromPartyTab && sender.frameId === 0 ? uiState() : null,
			);
			break;
		case "ui-chat":
			if (fromPartyTab && typeof msg.text === "string")
				sendToServer({ type: "chat", text: msg.text });
			break;
		case "ui-react":
			if (fromPartyTab && typeof msg.emoji === "string")
				sendToServer({ type: "react", emoji: msg.emoji });
			break;
		case "ui-resync":
			if (fromPartyTab) sendToServer({ type: "resync" });
			break;
		case "ui-leave":
			if (fromPartyTab) void stopSession();
			break;
		case "join":
			void startSession({
				serverUrl: msg.serverUrl,
				room: msg.room,
				tabId: msg.tabId,
				profile: msg.profile,
				password:
					typeof msg.password === "string" && msg.password
						? msg.password
						: undefined,
			});
			break;
		case "leave":
			void stopSession();
			break;
		case "go-to-room-page":
			if (session && roomPage)
				void chrome.tabs.update(session.tabId, {
					url: roomPage.nav ?? roomPage.url,
				});
			break;
	}
});

// La pestaña empieza a cargar otra página: los frames de la anterior ya no existen
chrome.tabs.onUpdated.addListener((tabId, info) => {
	if (session?.tabId === tabId && info.status === "loading")
		videoFrames.clear();
});

chrome.tabs.onRemoved.addListener((tabId) => {
	if (session?.tabId === tabId) void stopSession();
});

// Si el service worker se durmió y despertó, retomamos la sesión guardada
chrome.storage.session.get("session").then(({ session: saved }) => {
	if (saved && !session) {
		session = saved as Session;
		connect();
	}
});

// Atajo de teclado para mostrar u ocultar el panel (se cambia en chrome://extensions/shortcuts)
chrome.commands.onCommand.addListener((command) => {
	if (command === "toggle-panel" && session)
		chrome.tabs
			.sendMessage(session.tabId, { type: "ui-toggle" }, { frameId: 0 })
			.catch(() => {});
});
