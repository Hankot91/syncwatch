import { WebSocketServer, WebSocket } from "ws";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

type VideoState = { paused: boolean; time: number; rate: number };
type PageInfo = { url: string; title: string; nav?: string };

// Quién es cada persona en la sala: sin registro, solo lo que ella elige (apodo y avatar)
type Profile = { id: string; name: string; avatar: string };
// ok = sincronizado · ad = en el video de la sala pero sin reproductor (anuncio/cargando) · away = en otra página
type MemberStatus = "ok" | "ad" | "away";
type MemberInfo = Profile & { status: MemberStatus };
type RoomSummary = {
	name: string;
	members: number;
	locked: boolean;
	title: string;
};
type EventKind =
	| "join"
	| "back"
	| "leave"
	| "drop"
	| "play"
	| "pause"
	| "seek"
	| "video"
	| "ad";
type WaitReason = "seek" | "video" | "ad" | "join";

type ClientMessage =
	| { type: "join"; room: string; profile: Profile; password?: string }
	| { type: "list" }
	| { type: "chat"; text: string }
	| { type: "react"; emoji: string }
	| { type: "bye" }
	| { type: "resync" }
	| { type: "ping" }
	| { type: "page"; url: string; title: string; video: boolean; nav?: string }
	| { type: "state"; state: VideoState; seek: boolean; reply?: boolean }
	| { type: "ready"; epoch: number };

type ServerMessage =
	| {
			type: "joined";
			room: string;
			peers: number;
			you: string;
			members: MemberInfo[];
			locked: boolean;
	  }
	| { type: "rooms"; rooms: RoomSummary[] }
	| { type: "peers"; peers: number; members: MemberInfo[] }
	| { type: "chat"; from: Profile; text: string; at: number }
	| { type: "reaction"; from: Profile; emoji: string }
	| {
			type: "event";
			kind: EventKind;
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

type Room = {
	name: string;
	members: Set<WebSocket>;
	page: PageInfo | null; // el video que se está viendo en la sala
	video: VideoState | null; // último estado conocido
	updatedAt: number; // cuándo se actualizó (ms)
	epoch: number; // número de la espera coordinada actual
	waiting: Set<WebSocket> | null; // quién falta por avisar "ready"; null = no hay espera
	playAfter: boolean; // si hay que reproducir al terminar la espera
	wantPlay: boolean; // lo que la gente quiere: reproducir o pausado (última acción de un usuario)
	holdTimer: ReturnType<typeof setTimeout> | null;
	holdStartedAt: number; // cuándo empezó la espera actual (ms)
	waitTotal: number; // a cuántos se espera en total (para la barra "2 de 3 listos")
	waitReason: WaitReason;
	waitBy: string | undefined; // quién la provocó (apodo)
	peersKey: string; // última lista de miembros enviada, para no repetirla
	pass: { salt: string; hash: string } | null; // contraseña de la sala (nunca en claro), null = sala abierta
};

const PORT = Number(process.env.PORT ?? 8080);
const HEARTBEAT_MS = 30_000;
const HOLD_TIMEOUT_MS = 15_000;
const MAX_AD_WAIT_MS = 60_000; // tope esperando a alguien que está en un anuncio o cargando
const AD_DEBOUNCE_MS = 1_500; // que alguien pierda el video 1,5 s seguidos antes de pausar a los demás
const MAX_ROOM_LENGTH = 64;
const MAX_URL_LENGTH = 2048;
const MAX_TITLE_LENGTH = 200;
const MAX_NAME_LENGTH = 20;
const MAX_PASSWORD_LENGTH = 64;
// Límites contra abuso (se pueden cambiar con variables de entorno)
const MAX_CONNECTIONS = Number(process.env.MAX_CONNECTIONS ?? 100);
const MAX_ROOMS = Number(process.env.MAX_ROOMS ?? 50);
const MAX_ROOM_MEMBERS = Number(process.env.MAX_ROOM_MEMBERS ?? 20);
const JOIN_DEADLINE_MS = 60_000; // una conexión que no entra a ninguna sala se cierra
const LIST_BURST = 5; // listas de salas permitidas...
const LIST_WINDOW_MS = 10_000; // ...cada 10 s por conexión
const REACTIONS = ["👍", "😂", "😮", "❤️", "🔥", "👏"]; // únicas reacciones permitidas
const REACT_BURST = 8; // máximo de reacciones...
const REACT_WINDOW_MS = 5_000; // ...cada 5 s por persona
const MAX_PASSWORD_FAILS = 5; // intentos fallidos por conexión antes de cortarla
const MAX_CHAT_LENGTH = 500;
const CHAT_BURST = 5; // máximo de mensajes de chat...
const CHAT_WINDOW_MS = 10_000; // ...cada 10 s por persona
const RECONNECT_GRACE_MS = 30_000; // volver en este tiempo cuenta como "volvió a conectarse"
const AVATARS = ["zorro", "gato", "rana", "pinguino", "robot", "fantasma"];
const FOLLOW_GRACE_MS = 5000; // tras quedar sincronizado, un cambio de URL así de rápido no arrastra a la sala

const rooms = new Map<string, Room>();
const roomOf = new WeakMap<WebSocket, Room>();
const pageOf = new WeakMap<WebSocket, string>(); // última URL que reportó cada miembro
const syncedAt = new WeakMap<WebSocket, number>(); // cuándo quedó sincronizado cada miembro
const adTimers = new WeakMap<WebSocket, ReturnType<typeof setTimeout>>();
const videoOf = new WeakMap<WebSocket, boolean>(); // ¿su pestaña tiene un video real ahora?
const anchoredTo = new WeakMap<WebSocket, string>(); // video de la sala al que estaba "enganchado"
const alive = new WeakSet<WebSocket>();
const profileOf = new WeakMap<WebSocket, Profile>();
const chatTimes = new WeakMap<WebSocket, number[]>();
const passFails = new WeakMap<WebSocket, number>();
const reactTimes = new WeakMap<WebSocket, number[]>();
const listTimes = new WeakMap<WebSocket, number[]>();
const recentlyDropped = new Map<string, number>(); // "sala|id" -> cuándo perdió la conexión

function send(ws: WebSocket, msg: ServerMessage): void {
	if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(room: Room, msg: ServerMessage, except?: WebSocket): void {
	for (const member of room.members) {
		if (member !== except) send(member, msg);
	}
}

function hashPassword(password: string, salt: string): string {
	return scryptSync(password, salt, 32).toString("hex");
}

function makePass(password: string): { salt: string; hash: string } {
	const salt = randomBytes(16).toString("hex");
	return { salt, hash: hashPassword(password, salt) };
}

function checkPass(room: Room, password: string): boolean {
	if (!room.pass) return true;
	const a = Buffer.from(hashPassword(password, room.pass.salt), "hex");
	const b = Buffer.from(room.pass.hash, "hex");
	return a.length === b.length && timingSafeEqual(a, b);
}

function roomList(): RoomSummary[] {
	return [...rooms.values()]
		.map((r) => ({
			name: r.name,
			members: r.members.size,
			locked: r.pass !== null,
			title: r.page?.title ?? "",
		}))
		.sort((x, y) => y.members - x.members || x.name.localeCompare(y.name));
}

function statusOf(room: Room, ws: WebSocket): MemberStatus {
	if (isSynced(room, ws)) return "ok";
	if (room.page && pageOf.get(ws) === room.page.url) return "ad";
	return "away";
}

function membersInfo(room: Room): MemberInfo[] {
	return [...room.members].flatMap((m) => {
		const p = profileOf.get(m);
		return p ? [{ ...p, status: statusOf(room, m) }] : [];
	});
}

// Lista de personas con su estado. Solo se envía si cambió algo (o si force).
function sendPeers(room: Room, force = false): void {
	const members = membersInfo(room);
	const key = JSON.stringify(members.map((m) => [m.id, m.status]));
	if (!force && key === room.peersKey) return;
	room.peersKey = key;
	broadcast(room, { type: "peers", peers: room.members.size, members });
}

// Un aviso con autor ("Ana pausó el video"): lo ven todos en el chat
function emit(
	room: Room,
	kind: EventKind,
	who?: Profile,
	detail?: string,
	except?: WebSocket,
): void {
	broadcast(
		room,
		{ type: "event", kind, who, detail, at: Date.now() },
		except,
	);
}

function fmtTime(sec: number): string {
	const s = Math.max(0, Math.floor(sec));
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const r = String(s % 60).padStart(2, "0");
	return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
}

// Progreso de la espera para la barra "Esperando a todos · 2 de 3 listos"
function sendWait(room: Room): void {
	if (!room.waiting) return;
	broadcast(room, {
		type: "wait",
		ready: Math.max(0, room.waitTotal - room.waiting.size),
		total: room.waitTotal,
		reason: room.waitReason,
		by: room.waitBy,
	});
}

function addWaiting(room: Room, ws: WebSocket): void {
	if (!room.waiting || room.waiting.has(ws)) return;
	room.waiting.add(ws);
	room.waitTotal++;
	sendWait(room);
}

// Sincronizado = tiene un video real y está en el mismo video que la sala
// (si la sala aún no tiene video, basta con tener uno)
function isSynced(room: Room, ws: WebSocket): boolean {
	if (!videoOf.get(ws)) return false;
	if (!room.page) return true;
	return pageOf.get(ws) === room.page.url;
}

// "Sitio" de una URL (primevideo.com, youtube.com...): solo se cambia de video dentro del mismo sitio
function siteOf(href: string): string {
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

// Los mensajes de reproducción solo van a quienes están en el mismo video
function broadcastSynced(
	room: Room,
	msg: ServerMessage,
	except?: WebSocket,
): void {
	for (const member of room.members) {
		if (member !== except && isSynced(room, member)) send(member, msg);
	}
}

// Estado actual de la sala: si se está reproduciendo, avanzamos el tiempo transcurrido
function currentState(room: Room): VideoState | null {
	if (!room.video) return null;
	if (room.video.paused) return room.video;
	const elapsed = (Date.now() - room.updatedAt) / 1000;
	return { ...room.video, time: room.video.time + elapsed * room.video.rate };
}

// Pone al día a quien acaba de quedar sincronizado
function catchUp(room: Room, ws: WebSocket): void {
	if (!isSynced(room, ws)) return;
	if (room.waiting && room.video) {
		addWaiting(room, ws); // también hay que esperarlo
		send(ws, { type: "hold", epoch: room.epoch, state: room.video });
		return;
	}

	// El tiempo guardado puede estar vacío o viejo (p. ej. justo tras cambiar de video).
	// Mejor le preguntamos en vivo al miembro sincronizado más antiguo en qué punto va:
	// su respuesta llega como un "state" con salto y dispara la espera coordinada.
	const ref = [...room.members]
		.filter((m) => m !== ws && isSynced(room, m))
		.sort((a, b) => (syncedAt.get(a) ?? 0) - (syncedAt.get(b) ?? 0))[0];
	if (ref) {
		send(ref, { type: "request-state" });
		console.log(
			`[${room.name}] pidiendo el punto actual a un miembro para alinear al que llegó`,
		);
		// Si nadie responde (su pestaña no tiene video aún), usamos lo guardado
		const epoch = room.epoch;
		setTimeout(() => {
			if (room.epoch !== epoch) return; // ya hubo una espera: sí respondió
			if (!room.members.has(ws) || !isSynced(room, ws)) return;
			const state = currentState(room);
			if (state) send(ws, { type: "state", state });
		}, 2500);
		return;
	}

	// Sin nadie de referencia: lo que haya guardado
	const state = currentState(room);
	if (state) send(ws, { type: "state", state });
}

// includeAll: esperar también a quienes aún no llegaron al video (cambio de video de la sala)
// also: alguien que ahora no cuenta como sincronizado (está en un anuncio) pero hay que esperar
function startHold(
	room: Room,
	state: VideoState,
	opts: {
		includeAll?: boolean;
		also?: WebSocket;
		reason?: WaitReason;
		by?: Profile;
	} = {},
): void {
	room.epoch++;
	room.waiting = opts.includeAll
		? new Set(room.members)
		: new Set([...room.members].filter((m) => isSynced(room, m)));
	if (opts.also) room.waiting.add(opts.also);
	room.waitTotal = room.waiting.size;
	room.waitReason = opts.reason ?? "seek";
	room.waitBy = opts.by?.name;
	room.playAfter = !state.paused;
	room.video = { ...state, paused: true };
	room.updatedAt = Date.now();
	room.holdStartedAt = Date.now();

	if (room.holdTimer) clearTimeout(room.holdTimer);
	room.holdTimer = setTimeout(() => holdTimedOut(room), HOLD_TIMEOUT_MS);

	broadcastSynced(room, {
		type: "hold",
		epoch: room.epoch,
		state: room.video,
	});
	sendWait(room);
	console.log(
		`[${room.name}] espera #${room.epoch} en t=${state.time.toFixed(1)} (esperando a ${room.waiting.size})`,
	);
}

// Se agotó el tiempo de la espera. Si a quien falta está en la página de la sala pero sin video
// (un anuncio o cargando), seguimos esperando un rato más; si no, se reanuda igual.
function holdTimedOut(room: Room): void {
	if (!room.waiting) return;
	const inAd = [...room.waiting].some(
		(m) =>
			room.page !== null &&
			pageOf.get(m) === room.page.url &&
			!videoOf.get(m),
	);
	if (inAd && Date.now() - room.holdStartedAt < MAX_AD_WAIT_MS) {
		room.holdTimer = setTimeout(() => holdTimedOut(room), 5_000);
		return;
	}
	console.log(
		`[${room.name}] espera #${room.epoch} agotada (faltaban ${room.waiting.size}), se reanuda igual`,
	);
	finishHold(room);
}

function finishHold(room: Room): void {
	if (!room.waiting || !room.video) return;
	if (room.holdTimer) clearTimeout(room.holdTimer);
	room.holdTimer = null;
	room.waiting = null;
	room.video = { ...room.video, paused: !room.playAfter };
	room.updatedAt = Date.now();
	broadcastSynced(room, {
		type: "resume",
		epoch: room.epoch,
		state: room.video,
	});
	broadcast(room, { type: "wait-end" });
	console.log(`[${room.name}] reanudar #${room.epoch}`);
}

// Quien deja de estar sincronizado (se fue o cambió de video) ya no cuenta en la espera
// Miembros que están en la página de la sala pero sin reproductor: un anuncio o cargando todavía
function pendingAtPage(room: Room): WebSocket[] {
	const url = room.page?.url;
	if (!url) return [];
	return [...room.members].filter(
		(m) => pageOf.get(m) === url && !videoOf.get(m),
	);
}

// La espera está vacía: ¿se puede reanudar? No si alguien sigue en un anuncio (con un tope).
function tryFinish(room: Room): void {
	if (!room.waiting || room.waiting.size > 0) return;
	const pending = pendingAtPage(room);
	if (
		pending.length > 0 &&
		Date.now() - room.holdStartedAt < MAX_AD_WAIT_MS
	) {
		for (const m of pending) addWaiting(room, m);
		console.log(
			`[${room.name}] espera #${room.epoch}: sigo esperando a ${pending.length} en un anuncio`,
		);
		return;
	}
	finishHold(room);
}

function dropFromWaiting(room: Room, ws: WebSocket): void {
	if (room.waiting?.delete(ws)) {
		sendWait(room);
		tryFinish(room);
	}
}

// Alguien que estaba sincronizado cambió de video: arrastra a la sala
function changeRoomPage(room: Room, page: PageInfo, by?: WebSocket): void {
	room.page = page;
	room.video = null; // el estado del video anterior ya no sirve
	room.updatedAt = Date.now();
	room.waiting = null;
	if (room.holdTimer) {
		clearTimeout(room.holdTimer);
		room.holdTimer = null;
	}
	broadcast(room, { type: "room-page", page });
	console.log(`[${room.name}] nuevo video: ${page.url}`);

	// Todos van al video nuevo: esperamos en el segundo 0 a que cada uno llegue y,
	// cuando estén todos listos (o se agote el tiempo), arrancamos juntos.
	// Quien llega después entra a esta espera por catchUp.
	room.wantPlay = true;
	const who = by ? profileOf.get(by) : undefined;
	emit(room, "video", who, page.title);
	startHold(
		room,
		{ paused: false, time: 0, rate: 1 },
		{ includeAll: true, reason: "video", by: who },
	);
}

// reason: "bye" = salió a propósito · "closed" = se cortó la conexión · "silent" = reemplazo interno
function leave(
	ws: WebSocket,
	reason: "bye" | "closed" | "silent" = "silent",
): void {
	const room = roomOf.get(ws);
	if (!room) return;
	const profile = profileOf.get(ws);
	roomOf.delete(ws);
	pageOf.delete(ws);
	syncedAt.delete(ws);
	videoOf.delete(ws);
	anchoredTo.delete(ws);
	clearTimeout(adTimers.get(ws));
	adTimers.delete(ws);
	room.members.delete(ws);

	dropFromWaiting(room, ws);

	if (room.members.size === 0) {
		if (room.holdTimer) clearTimeout(room.holdTimer);
		rooms.delete(room.name);
		console.log(`[${room.name}] sala vacía, eliminada`);
	} else {
		if (profile && reason !== "silent") {
			if (reason === "closed")
				recentlyDropped.set(`${room.name}|${profile.id}`, Date.now());
			emit(room, reason === "bye" ? "leave" : "drop", profile);
		}
		sendPeers(room, true);
		console.log(
			`[${room.name}] -1 ${profile?.name ?? "?"} (${reason}) → ${room.members.size}`,
		);
	}
}

// Nunca confiamos en lo que llega por la red: validamos todo.
function parse(raw: string): ClientMessage | { error: string } {
	let data: unknown;
	try {
		data = JSON.parse(raw);
	} catch {
		return { error: "JSON inválido" };
	}
	if (typeof data !== "object" || data === null) {
		return { error: "El mensaje debe ser un objeto JSON" };
	}
	const m = data as Record<string, unknown>;

	if (m.type === "ping") return { type: "ping" };

	if (m.type === "join") {
		if (
			typeof m.room !== "string" ||
			m.room.length === 0 ||
			m.room.length > MAX_ROOM_LENGTH
		) {
			return {
				error: `room debe ser texto de 1 a ${MAX_ROOM_LENGTH} caracteres`,
			};
		}
		const pr = m.profile as Record<string, unknown> | undefined;
		if (
			!pr ||
			typeof pr.id !== "string" ||
			pr.id.length < 8 ||
			pr.id.length > 64
		) {
			return { error: "profile.id inválido" };
		}
		const name =
			typeof pr.name === "string"
				? pr.name.trim().slice(0, MAX_NAME_LENGTH)
				: "";
		if (name.length === 0) return { error: "Escribe un apodo" };
		const avatar =
			typeof pr.avatar === "string" && AVATARS.includes(pr.avatar)
				? pr.avatar
				: AVATARS[0]!;
		const password =
			typeof m.password === "string" &&
			m.password.length > 0 &&
			m.password.length <= MAX_PASSWORD_LENGTH
				? m.password
				: undefined;
		return {
			type: "join",
			room: m.room,
			profile: { id: pr.id, name, avatar },
			password,
		};
	}

	if (m.type === "chat") {
		if (typeof m.text !== "string") return { error: "chat requiere texto" };
		const text = m.text.trim().slice(0, MAX_CHAT_LENGTH);
		if (text.length === 0) return { error: "Mensaje vacío" };
		return { type: "chat", text };
	}

	if (m.type === "react") {
		if (typeof m.emoji !== "string" || !REACTIONS.includes(m.emoji))
			return { error: "Reacción no permitida" };
		return { type: "react", emoji: m.emoji };
	}

	if (m.type === "list") return { type: "list" };
	if (m.type === "bye") return { type: "bye" };
	if (m.type === "resync") return { type: "resync" };

	if (m.type === "page") {
		if (
			typeof m.url !== "string" ||
			m.url.length === 0 ||
			m.url.length > MAX_URL_LENGTH
		) {
			return {
				error: `url debe ser texto de 1 a ${MAX_URL_LENGTH} caracteres`,
			};
		}
		if (!/^https?:\/\//.test(m.url)) {
			return { error: "url debe empezar con http:// o https://" };
		}
		const title =
			typeof m.title === "string"
				? m.title.slice(0, MAX_TITLE_LENGTH)
				: "";
		const nav =
			typeof m.nav === "string" &&
			m.nav.length <= MAX_URL_LENGTH &&
			/^https?:\/\//.test(m.nav)
				? m.nav
				: undefined;
		return {
			type: "page",
			url: m.url,
			title,
			video: m.video === true,
			nav,
		};
	}

	if (m.type === "state") {
		const s = m.state as Record<string, unknown> | undefined;
		if (
			!s ||
			typeof s.paused !== "boolean" ||
			!Number.isFinite(s.time) ||
			!Number.isFinite(s.rate)
		) {
			return {
				error: "state inválido: se espera { paused: boolean, time: number, rate: number }",
			};
		}
		return {
			type: "state",
			state: {
				paused: s.paused,
				time: s.time as number,
				rate: s.rate as number,
			},
			seek: m.seek === true,
			reply: m.reply === true,
		};
	}

	if (m.type === "ready") {
		if (!Number.isInteger(m.epoch))
			return { error: "ready requiere un epoch entero" };
		return { type: "ready", epoch: m.epoch as number };
	}

	return { error: `Tipo de mensaje desconocido: ${String(m.type)}` };
}

const wss = new WebSocketServer({ port: PORT, maxPayload: 4096 });

wss.on("connection", (ws) => {
	if (wss.clients.size > MAX_CONNECTIONS) {
		console.log(`conexión rechazada: ya hay ${MAX_CONNECTIONS}`);
		ws.close(1013, "Servidor lleno"); // 1013 = "intenta más tarde"
		return;
	}
	const deadline = setTimeout(() => {
		if (!roomOf.has(ws)) ws.close(1008, "Sin actividad");
	}, JOIN_DEADLINE_MS);
	ws.on("close", () => clearTimeout(deadline));
	alive.add(ws);
	ws.on("pong", () => alive.add(ws));

	ws.on("message", (data) => {
		const parsed = parse(data.toString());
		if ("error" in parsed) {
			send(ws, { type: "error", message: parsed.error });
			return;
		}

		if (parsed.type === "ping") {
			send(ws, { type: "pong" });
			return;
		}

		if (parsed.type === "list") {
			const now = Date.now();
			const times = (listTimes.get(ws) ?? []).filter(
				(t) => now - t < LIST_WINDOW_MS,
			);
			if (times.length >= LIST_BURST) return;
			times.push(now);
			listTimes.set(ws, times);
			send(ws, { type: "rooms", rooms: roomList() });
			return;
		}

		if (parsed.type === "join") {
			leave(ws); // si ya estaba en otra sala, sale primero
			let room = rooms.get(parsed.room);
			if (!room && rooms.size >= MAX_ROOMS) {
				send(ws, {
					type: "error",
					message: "El servidor alcanzó el máximo de salas",
				});
				return;
			}
			if (room && room.members.size >= MAX_ROOM_MEMBERS) {
				send(ws, {
					type: "error",
					message: `La sala está llena (máximo ${MAX_ROOM_MEMBERS})`,
				});
				return;
			}
			if (!room) {
				room = {
					name: parsed.room,
					members: new Set(),
					page: null,
					video: null,
					updatedAt: 0,
					epoch: 0,
					waiting: null,
					playAfter: false,
					wantPlay: false,
					holdTimer: null,
					holdStartedAt: 0,
					waitTotal: 0,
					waitReason: "seek",
					waitBy: undefined,
					peersKey: "",
					pass: null,
				};
				room.pass = parsed.password ? makePass(parsed.password) : null; // quien crea la sala puede ponerle contraseña
				rooms.set(parsed.room, room);
			} else if (!checkPass(room, parsed.password ?? "")) {
				const fails = (passFails.get(ws) ?? 0) + 1;
				passFails.set(ws, fails);
				send(ws, {
					type: "error",
					code: "password",
					message: parsed.password
						? "Contraseña incorrecta"
						: "Esta sala tiene contraseña",
				});
				if (fails >= MAX_PASSWORD_FAILS) ws.close();
				return;
			}
			// misma persona con una conexión vieja (reconexión): la vieja se descarta sin avisos
			for (const old of [...room.members]) {
				if (profileOf.get(old)?.id === parsed.profile.id) {
					leave(old, "silent");
					old.close();
				}
			}
			room.members.add(ws);
			roomOf.set(ws, room);
			profileOf.set(ws, parsed.profile);

			const key = `${room.name}|${parsed.profile.id}`;
			const droppedAt = recentlyDropped.get(key);
			recentlyDropped.delete(key);
			const returning =
				droppedAt !== undefined &&
				Date.now() - droppedAt < RECONNECT_GRACE_MS;

			send(ws, {
				type: "joined",
				room: room.name,
				peers: room.members.size,
				you: parsed.profile.id,
				members: membersInfo(room),
				locked: room.pass !== null,
			});
			send(ws, { type: "room-page", page: room.page });
			emit(
				room,
				returning ? "back" : "join",
				parsed.profile,
				undefined,
				ws,
			);
			sendPeers(room, true);
			console.log(
				`[${room.name}] +1 ${parsed.profile.name}${returning ? " (volvió)" : ""} → ${room.members.size}`,
			);
			// El estado del video se envía cuando el cliente reporta su página (mensaje "page")
			return;
		}

		// De aquí en adelante hay que estar en una sala
		const room = roomOf.get(ws);
		if (!room) {
			send(ws, {
				type: "error",
				message: "Primero debes unirte a una sala (join)",
			});
			return;
		}

		if (parsed.type === "bye") {
			leave(ws, "bye");
			return;
		}

		if (parsed.type === "chat") {
			const now = Date.now();
			const times = (chatTimes.get(ws) ?? []).filter(
				(t) => now - t < CHAT_WINDOW_MS,
			);
			if (times.length >= CHAT_BURST) {
				send(ws, {
					type: "notice",
					message: "Vas muy rápido, espera unos segundos.",
				});
				return;
			}
			times.push(now);
			chatTimes.set(ws, times);
			const from = profileOf.get(ws);
			if (from)
				broadcast(room, {
					type: "chat",
					from,
					text: parsed.text,
					at: now,
				});
			return;
		}

		if (parsed.type === "react") {
			const now = Date.now();
			const times = (reactTimes.get(ws) ?? []).filter(
				(t) => now - t < REACT_WINDOW_MS,
			);
			if (times.length >= REACT_BURST) return; // demasiado rápido: se ignora en silencio
			times.push(now);
			reactTimes.set(ws, times);
			const from = profileOf.get(ws);
			if (from)
				broadcast(room, {
					type: "reaction",
					from,
					emoji: parsed.emoji,
				});
			return;
		}

		if (parsed.type === "resync") {
			if (isSynced(room, ws)) catchUp(room, ws);
			return;
		}

		if (parsed.type === "page") {
			const wasSynced = isSynced(room, ws);
			pageOf.set(ws, parsed.url);
			videoOf.set(ws, parsed.video);
			if (parsed.video) {
				clearTimeout(adTimers.get(ws)); // volvió el video (terminó el anuncio): ya no hay que pausar a nadie
				adTimers.delete(ws);
			}
			const info: PageInfo = {
				url: parsed.url,
				title: parsed.title,
				nav: parsed.nav,
			};

			if (!room.page) {
				// El video de la sala lo define el primero que esté en una página con video real.
				// Quien está en una portada o en otra cosa no define nada.
				if (parsed.video) {
					room.page = info;
					anchoredTo.set(ws, info.url);
					syncedAt.set(ws, Date.now());
					broadcast(room, { type: "room-page", page: info });
					console.log(`[${room.name}] video de la sala: ${info.url}`);
				}
			} else if (parsed.url === room.page.url) {
				// está en el video de la sala (con o sin reproductor cargado todavía)
				// refresca el título; "a dónde navegar" lo fijó quien definió el video, no lo pisamos
				room.page = { ...info, nav: room.page.nav ?? info.nav };
				anchoredTo.set(ws, room.page.url);
				if (!wasSynced && isSynced(room, ws)) {
					syncedAt.set(ws, Date.now());
					catchUp(room, ws); // acaba de quedar sincronizado
				}
			} else if (
				parsed.video &&
				anchoredTo.get(ws) === room.page.url &&
				siteOf(parsed.url) === siteOf(room.page.url)
			) {
				// Estaba enganchado al video de la sala y llegó a OTRO video del mismo sitio:
				// es un cambio de episodio/video, la sala se va con él.
				if (Date.now() - (syncedAt.get(ws) ?? 0) > FOLLOW_GRACE_MS) {
					changeRoomPage(room, info, ws);
					anchoredTo.set(ws, info.url);
					syncedAt.set(ws, Date.now());
				} else {
					// acaba de llegar: casi seguro es un ajuste de la URL hecho por el sitio
					console.log(
						`[${room.name}] cambio de URL ignorado (recién sincronizado): ${room.page.url} → ${info.url}`,
					);
				}
			}
			// Cualquier otro caso (portada, otro sitio, un recién llegado en otro video)
			// no mueve la sala: la sala manda, el que llega la sigue.

			// Estaba sincronizado, sigue en el video de la sala pero perdió el reproductor
			// (un anuncio, un corte): los demás se pausan hasta que vuelva.
			if (!parsed.video && room.page && parsed.url === room.page.url) {
				clearTimeout(adTimers.get(ws));
				adTimers.set(
					ws,
					setTimeout(() => {
						adTimers.delete(ws);
						if (!room.members.has(ws) || isSynced(room, ws)) return; // salió o ya volvió
						if (pageOf.get(ws) !== room.page?.url) return; // se fue a otra página
						emit(room, "ad", profileOf.get(ws));
						if (room.waiting) {
							addWaiting(room, ws); // ya hay una espera: que esta también lo espere
							return;
						}
						const st = currentState(room);
						if (!st || st.paused) return; // si la sala ya está pausada no hay nada que detener
						console.log(
							`[${room.name}] un miembro está sin video en la página de la sala (¿anuncio?): pausamos a los demás`,
						);
						startHold(
							room,
							{ ...st, paused: !room.wantPlay },
							{ also: ws, reason: "ad", by: profileOf.get(ws) },
						);
					}, AD_DEBOUNCE_MS),
				);
			}

			// Solo soltamos de la espera a quien ya no está en el video de la sala;
			// quien está en la página pero sin reproductor (anuncio, cargando) sigue esperado.
			if (
				!isSynced(room, ws) &&
				pageOf.get(ws) !== room.page?.url &&
				(!room.page || siteOf(parsed.url) !== siteOf(room.page.url))
			)
				dropFromWaiting(room, ws); // se fue a otro sitio; si sigue en el mismo, viene en camino
			sendPeers(room);
			return;
		}

		// Quien no está en el video de la sala no puede mover la reproducción
		if (!isSynced(room, ws)) return;

		if (parsed.type === "state") {
			if (parsed.reply) {
				// Respuesta a "request-state": dice DÓNDE va, no si hay que reproducir. Puede estar
				// pausado solo porque una espera anterior lo detuvo; lo que cuenta es lo que la gente quiere.
				startHold(
					room,
					{ ...parsed.state, paused: !room.wantPlay },
					{ also: ws, reason: "join" },
				);
				return;
			}
			const who = profileOf.get(ws);
			if (parsed.seek) {
				room.wantPlay = !parsed.state.paused;
				emit(room, "seek", who, fmtTime(parsed.state.time), ws);
				startHold(room, parsed.state, { reason: "seek", by: who });
				return;
			}
			if (room.wantPlay !== !parsed.state.paused) {
				emit(
					room,
					parsed.state.paused ? "pause" : "play",
					who,
					fmtTime(parsed.state.time),
					ws,
				);
			}
			room.wantPlay = !parsed.state.paused;
			if (room.waiting) {
				// durante una espera no movemos a nadie, pero anotamos lo que el usuario quiere
				// para cuando se reanude (antes se perdía y todos quedaban pausados)
				room.playAfter = room.wantPlay;
				return;
			}
			room.video = parsed.state;
			room.updatedAt = Date.now();
			broadcastSynced(room, { type: "state", state: parsed.state }, ws);
			return;
		}

		// parsed.type === "ready"
		if (
			parsed.type === "ready" &&
			room.waiting &&
			parsed.epoch === room.epoch
		) {
			room.waiting.delete(ws);
			sendWait(room);
			tryFinish(room);
		}
	});

	ws.on("close", () => leave(ws, "closed"));
	ws.on("error", (err) => console.error("Error de socket:", err.message));
});

// Heartbeat: detecta conexiones muertas (cierre de laptop, caída de wifi...)
const heartbeat = setInterval(() => {
	for (const ws of wss.clients) {
		if (!alive.has(ws)) {
			ws.terminate();
			continue;
		}
		alive.delete(ws);
		ws.ping();
	}
}, HEARTBEAT_MS);

// Docker envía SIGTERM al detener el contenedor; sin esto tarda 10 s en matarlo
process.on("SIGTERM", () => {
	clearInterval(heartbeat);
	wss.close(() => process.exit(0));
});

console.log(`SyncWatch server escuchando en el puerto ${PORT}`);
