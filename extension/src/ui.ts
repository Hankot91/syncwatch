import { avatarSvg } from "./avatars";
import { DEFAULT_UI_SETTINGS } from "./types";
import { isLoopback } from "./config";
import type {
	UiState,
	UiSettings,
	LogEntry,
	MemberInfo,
	WaitInfo,
} from "./types";

// Panel de la sala dentro de la página (solo en el frame principal):
//  · una "isla" pequeña siempre visible (avatares, no leídos, espera en curso)
//  · un panel con personas, chat y avisos
//  · avisos breves sobre el video cuando está en pantalla completa
// Vive en un Shadow DOM cerrado para que los estilos de la página no lo rompan.

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: Inter, system-ui, -apple-system, "Segoe UI", sans-serif; scrollbar-width: thin; scrollbar-color: #2A2F3F transparent; }
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: #2A2F3F; border-radius: 8px; border: 2px solid transparent; background-clip: content-box; }
::-webkit-scrollbar-thumb:hover { background: #3A4052; background-clip: content-box; }
::-webkit-scrollbar-corner { background: transparent; }
.wrap { position: fixed; inset: 0; pointer-events: none; color: #ECEEF5; font-size: 13px; line-height: 1.4; }
.wrap[hidden] { display: none; }
button { font: inherit; color: inherit; cursor: pointer; }
.island {
	pointer-events: auto; position: fixed; top: 16px; right: 16px; display: flex; align-items: center; gap: 8px;
	padding: 5px 12px 5px 6px; border-radius: 999px; background: rgba(15,17,23,.92); border: 1px solid #2A2F3F;
	box-shadow: 0 6px 24px rgba(0,0,0,.45); transition: opacity .25s; user-select: none; cursor: pointer;
}
.island.dim { opacity: 0; }
.island:hover, .island:focus-within { opacity: 1; }
.stack { display: flex; }
.stack svg { margin-left: -8px; border-radius: 50%; border: 2px solid #0F1117; background: #0F1117; }
.stack svg:first-child { margin-left: 0; }
.count { font-weight: 600; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: #5EEAD4; }
.dot.off { background: #FB7185; }
.wait { padding: 1px 8px; border-radius: 999px; background: #5EEAD4; color: #04201C; font-weight: 700; font-size: 12px; }
.badge { min-width: 18px; padding: 1px 6px; border-radius: 999px; background: #FB7185; color: #1C1917; font-weight: 700; font-size: 12px; text-align: center; }
.wait[hidden], .badge[hidden] { display: none; }
.panel {
	pointer-events: auto; position: fixed; top: 62px; right: 16px; width: 330px; height: min(560px, calc(100vh - 90px));
	display: flex; flex-direction: column; background: #0F1117; border: 1px solid #2A2F3F; border-radius: 14px;
	box-shadow: 0 12px 40px rgba(0,0,0,.55); overflow: hidden;
}
.panel[hidden] { display: none; }
header { display: flex; align-items: center; gap: 8px; padding: 10px 12px; background: #171A23; border-bottom: 1px solid #2A2F3F; }
header h2 { margin: 0; flex: 1; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.x { border: 0; background: transparent; font-size: 16px; padding: 2px 6px; border-radius: 6px; color: #9AA1B5; }
.x:hover { background: #232838; color: #ECEEF5; }
.offline { padding: 6px 12px; background: #3b1620; color: #FB7185; font-size: 12px; }
.offline[hidden] { display: none; }
.msg svg { flex: none; }
.people { padding: 8px 12px; border-bottom: 1px solid #2A2F3F; display: flex; flex-wrap: wrap; gap: 8px; }
.person { position: relative; line-height: 0; cursor: default; }
.person svg { border-radius: 50%; }
.person i { position: absolute; right: -2px; bottom: -2px; width: 10px; height: 10px; border-radius: 50%; background: #5EEAD4; border: 2px solid #0F1117; }
.person.ad i { background: #FBBF24; }
.person.away i { background: #FB7185; }
.person.away svg, .person.ad svg { opacity: .6; }
.ibtn { width: 30px; height: 30px; padding: 0; display: grid; place-items: center; border: 0; border-radius: 8px; color: #fff; }
.ibtn svg { width: 20px; height: 20px; fill: #fff; }
.ibtn.gray { background: #2A2F3F; } .ibtn.gray:hover { background: #3A4052; }
.ibtn.green { background: #16A34A; } .ibtn.green:hover { background: #15803D; }
.ibtn.red { background: #E11D48; } .ibtn.red:hover { background: #BE123C; }
.emojis { display: grid; grid-template-columns: repeat(8, 1fr); gap: 2px; padding: 6px 12px; border-top: 1px solid #2A2F3F; background: #171A23; }
.emojis[hidden] { display: none; }
.emojis button { border: 0; background: transparent; font-size: 18px; padding: 3px 0; border-radius: 6px; }
.emojis button:hover { background: #232838; }
.emo { width: 34px; border: 1px solid #2A2F3F; border-radius: 8px; background: #171A23; font-size: 16px; padding: 0; }
.emo:hover { background: #232838; }
.log { flex: 1; overflow-y: auto; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
.msg { display: flex; gap: 8px; max-width: 92%; }
.msg.mine { align-self: flex-end; flex-direction: row-reverse; }
.bubble { padding: 6px 10px; border-radius: 12px; background: #232838; word-break: break-word; white-space: pre-wrap; }
.mine .bubble { background: #5EEAD4; color: #04201C; }
.who { font-size: 11px; color: #9AA1B5; margin-bottom: 1px; }
.ev { align-self: center; text-align: center; font-size: 12px; color: #9AA1B5; padding: 0 8px; }
.empty { margin: auto; color: #9AA1B5; text-align: center; font-size: 12px; }
.waitbar { padding: 8px 12px; background: #171A23; border-top: 1px solid #2A2F3F; font-size: 12px; }
.waitbar[hidden] { display: none; }
.track { height: 4px; margin-top: 6px; border-radius: 2px; background: #2A2F3F; overflow: hidden; }
.fill { height: 100%; background: #5EEAD4; transition: width .2s; }
form { display: flex; gap: 6px; padding: 8px 12px; border-top: 1px solid #2A2F3F; }
input[type=text] { flex: 1; min-width: 0; padding: 7px 10px; border-radius: 8px; border: 1px solid #2A2F3F; background: #171A23; color: #ECEEF5; outline: none; font-size: 13px; }
input[type=text]:focus { border-color: #5EEAD4; }
.send { padding: 7px 12px; border-radius: 8px; border: 0; background: #5EEAD4; color: #04201C; font-weight: 700; }
footer { padding: 8px 12px 10px; border-top: 1px solid #2A2F3F; display: grid; gap: 6px; font-size: 12px; color: #9AA1B5; }
footer label { display: flex; align-items: center; gap: 6px; cursor: pointer; }
.floats { position: fixed; inset: 0; pointer-events: none; overflow: hidden; }
.float { position: absolute; bottom: 90px; display: flex; flex-direction: column; align-items: center; animation: rise 3.2s ease-out forwards; }
.float b { font-size: 38px; line-height: 1; font-weight: 400; text-shadow: 0 2px 10px rgba(0,0,0,.55); }
.float span { margin-top: 3px; padding: 1px 8px; border-radius: 999px; background: rgba(15,17,23,.85); color: #ECEEF5; font-size: 11px; }
@keyframes rise {
	0% { transform: translateY(0) scale(.6); opacity: 0; }
	12% { transform: translateY(-30px) scale(1.1); opacity: 1; }
	100% { transform: translateY(-55vh) scale(1); opacity: 0; }
}
.reacts { display: flex; justify-content: space-around; padding: 4px 10px; border-top: 1px solid #2A2F3F; }
.reacts button, .reactbar button { border: 0; background: transparent; font-size: 20px; line-height: 1; padding: 5px 6px; border-radius: 8px; transition: transform .1s; }
.reacts button:hover, .reactbar button:hover { background: #232838; transform: scale(1.18); }
.reactbar { pointer-events: auto; position: fixed; top: 62px; right: 16px; display: flex; gap: 2px; padding: 5px 8px; border-radius: 999px; background: rgba(15,17,23,.95); border: 1px solid #2A2F3F; box-shadow: 0 6px 24px rgba(0,0,0,.45); }
.reactbar[hidden], .rbtn[hidden] { display: none; }
.rbtn { width: 26px; height: 26px; padding: 0; display: grid; place-items: center; border: 0; border-radius: 50%; background: #232838; color: #ECEEF5; }
.rbtn:hover { background: #3A4052; }
.rbtn svg { width: 17px; height: 17px; fill: currentColor; }
.toast {
	position: fixed; right: 16px; top: 62px; max-width: min(360px, 80vw); padding: 8px 12px; border-radius: 12px;
	background: rgba(15,17,23,.92); border: 1px solid #2A2F3F; box-shadow: 0 6px 24px rgba(0,0,0,.45);
	pointer-events: none; word-break: break-word;
}
.toast[hidden] { display: none; }
`;

function el<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	cls?: string,
	text?: string,
): HTMLElementTagNameMap[K] {
	const e = document.createElement(tag);
	if (cls) e.className = cls;
	if (text !== undefined) e.textContent = text;
	return e;
}

const hhmm = (at: number): string =>
	new Date(at).toLocaleTimeString("es", {
		hour: "2-digit",
		minute: "2-digit",
	});

function waitText(w: WaitInfo): string {
	const by = w.by;
	switch (w.reason) {
		case "ad":
			return by
				? `Esperando a que ${by} termine el anuncio`
				: "Esperando a que termine un anuncio";
		case "video":
			return by
				? `${by} cambió de video · esperando a todos`
				: "Video nuevo · esperando a todos";
		case "seek":
			return by
				? `${by} movió el video · esperando a todos`
				: "Esperando a todos";
		case "join":
			return "Alineando a todos";
	}
}

// Link que lleva a tus amigos al mismo video y los mete en la sala (la contraseña nunca viaja en el link)
function inviteLink(s: UiState): string {
	const base = s.roomUrl ?? location.href;
	try {
		const u = new URL(base);
		const parts = u.hash
			.replace(/^#/, "")
			.split("&")
			.filter(
				(x) =>
					x &&
					!x.startsWith("sw-room=") &&
					!x.startsWith("sw-lock=") &&
					!x.startsWith("sw-server="),
			);
		parts.push(`sw-room=${encodeURIComponent(s.room)}`);
		if (s.locked) parts.push("sw-lock=1");
		// la dirección del servidor viaja en el link, salvo localhost (no serviría en otro computador)
		if (!isLoopback(s.server))
			parts.push(`sw-server=${encodeURIComponent(s.server)}`);
		u.hash = parts.join("&");
		return u.toString();
	} catch {
		return base;
	}
}

async function copyText(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		const ta = document.createElement("textarea");
		ta.value = text;
		ta.style.cssText = "position:fixed;opacity:0";
		document.body.append(ta);
		ta.select();
		const ok = document.execCommand("copy");
		ta.remove();
		return ok;
	}
}

export type UiSend = (msg: {
	type: string;
	text?: string;
	emoji?: string;
}) => void;
export type Ui = {
	setState(ui: UiState | null): void;
	toggle(): void;
	react(name: string, emoji: string): void;
};

export function createUi(send: UiSend): Ui {
	let state: UiState | null = null;
	let settings: UiSettings = { ...DEFAULT_UI_SETTINGS };
	let unread = 0;
	const shown = new Set<string>(); // entradas del log ya procesadas (para saber cuáles son nuevas)
	let firstState = true;
	let waitToastOn = false;
	let toastTimer: number | undefined;
	let dimTimer: number | undefined;

	// --- Estructura ---------------------------------------------------------
	const host = document.createElement("div");
	host.setAttribute("popover", "manual"); // capa superior: queda por encima de casi todo
	host.style.cssText =
		"all:initial;position:fixed;top:0;left:0;width:0;height:0;overflow:visible;";
	const shadow = host.attachShadow({ mode: "closed" });
	const style = el("style");
	style.textContent = CSS;
	const wrap = el("div", "wrap");
	wrap.hidden = true;

	const island = el("div", "island");
	island.title = "Abrir o cerrar el panel de SyncWatch";
	island.setAttribute("role", "button");
	island.tabIndex = 0;
	const stack = el("div", "stack");
	const count = el("span", "count");
	const dot = el("span", "dot");
	const waitChip = el("span", "wait");
	waitChip.hidden = true;
	const badge = el("span", "badge");
	badge.hidden = true;
	const MOOD =
		'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z"/></svg>';
	const rbtn = el("button", "rbtn");
	rbtn.type = "button";
	rbtn.title = "Reaccionar";
	rbtn.setAttribute("aria-label", "Reaccionar");
	rbtn.innerHTML = MOOD;
	island.append(stack, count, dot, waitChip, badge, rbtn);

	const panel = el("section", "panel");
	panel.hidden = true;
	const header = el("header");
	const title = el("h2");
	const closeBtn = el("button", "x", "✕");
	closeBtn.type = "button";
	closeBtn.title = "Cerrar el panel";
	const svg = (paths: string): string =>
		`<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
	const resyncBtn = el("button", "ibtn green");
	resyncBtn.type = "button";
	resyncBtn.title =
		"Resincronizar: te alinea con la sala si tu video se desfasó";
	resyncBtn.setAttribute("aria-label", "Resincronizar");
	resyncBtn.innerHTML = svg(
		'<path d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>',
	);
	const leaveBtn = el("button", "ibtn red");
	leaveBtn.type = "button";
	leaveBtn.title = "Salir de la sala";
	leaveBtn.setAttribute("aria-label", "Salir de la sala");
	leaveBtn.innerHTML = svg(
		'<path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/>',
	);
	const LINK =
		'<path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/>';
	const CHECK =
		'<path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>';
	const copyBtn = el("button", "ibtn gray");
	copyBtn.type = "button";
	copyBtn.title = "Copiar link de invitación";
	copyBtn.setAttribute("aria-label", "Copiar link de invitación");
	copyBtn.innerHTML = svg(LINK);
	header.append(title, copyBtn, resyncBtn, leaveBtn, closeBtn);
	const offline = el(
		"div",
		"offline",
		"Sin conexión con el servidor. Reconectando…",
	);
	offline.hidden = true;
	const membersEl = el("div", "people");
	const logEl = el("div", "log");
	const waitBar = el("div", "waitbar");
	waitBar.hidden = true;
	const waitLabel = el("div");
	const track = el("div", "track");
	const fill = el("div", "fill");
	track.append(fill);
	waitBar.append(waitLabel, track);
	const emojiBar = el("div", "emojis");
	emojiBar.hidden = true;
	const EMOJIS = [
		"😀",
		"😂",
		"🤣",
		"😍",
		"😎",
		"😮",
		"😢",
		"😡",
		"👍",
		"👏",
		"🙌",
		"🔥",
		"🎉",
		"❤️",
		"💀",
		"👀",
		"🍿",
		"🤔",
		"😴",
		"😅",
		"🥹",
		"🤯",
		"😭",
		"💯",
	];
	const emoBtn = el("button", "emo", "😊");
	emoBtn.type = "button";
	emoBtn.title = "Emojis";
	emoBtn.setAttribute("aria-label", "Emojis");
	for (const e of EMOJIS) {
		const b = el("button", undefined, e);
		b.type = "button";
		b.addEventListener("click", () => {
			const a = input.selectionStart ?? input.value.length;
			const z = input.selectionEnd ?? a;
			input.value = input.value.slice(0, a) + e + input.value.slice(z);
			input.setSelectionRange(a + e.length, a + e.length);
			input.focus();
		});
		emojiBar.append(b);
	}
	emoBtn.addEventListener("click", () => {
		emojiBar.hidden = !emojiBar.hidden;
	});
	const form = el("form");
	const input = el("input");
	input.type = "text";
	input.placeholder = "Escribe un mensaje…";
	input.maxLength = 500;
	input.autocomplete = "off";
	const sendBtn = el("button", "send", "Enviar");
	sendBtn.type = "submit";
	form.append(emoBtn, input, sendBtn);

	const footer = el("footer");
	const syncers: Array<() => void> = [];
	const mkToggle = (
		label: string,
		key: "chatNotices" | "fsNotices",
	): HTMLLabelElement => {
		const l = el("label");
		const c = el("input");
		c.type = "checkbox";
		c.addEventListener("change", () => {
			settings = { ...settings, [key]: c.checked };
			void chrome.storage.local.set({ uiSettings: settings });
			render();
		});
		syncers.push(() => (c.checked = settings[key]));
		l.append(c, document.createTextNode(label));
		return l;
	};
	footer.append(
		mkToggle("Avisos en el chat", "chatNotices"),
		mkToggle("Avisos sobre el video en pantalla completa", "fsNotices"),
	);
	panel.append(
		header,
		offline,
		membersEl,
		logEl,
		waitBar,
		emojiBar,
		form,
		footer,
	);

	const toast = el("div", "toast");
	toast.hidden = true;
	// Reacciones: las mismas seis en la isla (panel cerrado) y en el panel; suben flotando sobre el video
	const REACTS = ["👍", "😂", "😮", "❤️", "🔥", "👏"];
	const reactBar = el("div", "reactbar");
	reactBar.hidden = true;
	const reactRow = el("div", "reacts");
	for (const emoji of REACTS) {
		for (const holder of [reactBar, reactRow]) {
			const b = el("button", undefined, emoji);
			b.type = "button";
			b.title = `Reaccionar ${emoji}`;
			b.addEventListener("click", () => {
				send({ type: "ui-react", emoji });
				reactBar.hidden = true;
			});
			holder.append(b);
		}
	}
	panel.insertBefore(reactRow, waitBar);
	const floats = el("div", "floats");
	rbtn.addEventListener("click", (e) => {
		e.stopPropagation(); // no abre el panel
		reactBar.hidden = !reactBar.hidden;
		wakeIsland();
	});
	wrap.append(floats, island, reactBar, panel, toast);
	shadow.append(style, wrap);

	// --- Posición: capa superior y pantalla completa --------------------------
	const inFullscreen = (): boolean => document.fullscreenElement !== null;

	function reshow(): void {
		try {
			if (host.matches(":popover-open")) host.hidePopover();
			host.showPopover();
		} catch {
			/* sin soporte de popover: queda como elemento normal */
		}
	}

	function place(): void {
		const fs = document.fullscreenElement;
		// dentro del elemento en pantalla completa si admite hijos; si es el <video> o un iframe, solo la capa superior
		const parent =
			fs && fs.tagName !== "VIDEO" && fs.tagName !== "IFRAME"
				? fs
				: document.documentElement;
		if (host.parentNode !== parent) parent.appendChild(host);
		reshow();
		wakeIsland();
		render();
	}

	// En pantalla completa la isla se desvanece si no mueves el mouse
	function wakeIsland(): void {
		island.classList.remove("dim");
		clearTimeout(dimTimer);
		// como los controles del video: se esconde sola si no mueves el mouse (salvo con el panel abierto o una espera en curso)
		if (!settings.panelOpen && !state?.wait)
			dimTimer = window.setTimeout(
				() => island.classList.add("dim"),
				3000,
			);
	}
	document.addEventListener("fullscreenchange", () => {
		if (state) place();
	});
	document.addEventListener("mousemove", wakeIsland, {
		passive: true,
		capture: true,
	});

	// --- Teclado: que el chat no active los atajos de la página (espacio, f, k…) ----
	window.addEventListener(
		"keydown",
		(e) => {
			if (e.target !== host) return; // el foco no está en nuestro panel
			e.stopImmediatePropagation();
			if (!e.isComposing && e.key === "Escape") input.blur();
		},
		true,
	);
	for (const type of ["keyup", "keypress"] as const)
		window.addEventListener(
			type,
			(e) => {
				if (e.target === host) e.stopImmediatePropagation();
			},
			true,
		);

	// --- Acciones ---------------------------------------------------------------
	function setOpen(open: boolean): void {
		settings = { ...settings, panelOpen: open };
		void chrome.storage.local.set({ uiSettings: settings });
		if (open) {
			unread = 0;
			toast.hidden = true;
			render();
			logEl.scrollTop = logEl.scrollHeight;
			input.focus();
		} else {
			input.blur();
			render();
		}
		wakeIsland();
	}
	island.addEventListener("click", () => setOpen(!settings.panelOpen));
	island.addEventListener("keydown", (e) => {
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			setOpen(!settings.panelOpen);
		}
	});
	closeBtn.addEventListener("click", () => setOpen(false));
	form.addEventListener("submit", (e) => {
		e.preventDefault();
		const text = input.value.trim();
		if (!text) return;
		send({ type: "ui-chat", text });
		input.value = "";
	});
	resyncBtn.addEventListener("click", () => send({ type: "ui-resync" }));
	copyBtn.addEventListener("click", async () => {
		if (!state) return;
		const ok = await copyText(inviteLink(state));
		copyBtn.innerHTML = svg(ok ? CHECK : LINK);
		copyBtn.title = ok ? "¡Link copiado!" : "No se pudo copiar el link";
		window.setTimeout(() => {
			copyBtn.innerHTML = svg(LINK);
			copyBtn.title = "Copiar link de invitación";
		}, 1800);
	});
	leaveBtn.addEventListener("click", () => send({ type: "ui-leave" }));

	// --- Dibujo -------------------------------------------------------------------
	function memberRow(m: MemberInfo, you: string): HTMLElement {
		const r = el("span", `person ${m.status}`);
		const what =
			m.status === "ok"
				? "viendo"
				: m.status === "ad"
					? "en un anuncio"
					: "en otra página";
		r.title = `${m.id === you ? `${m.name} (tú)` : m.name} · ${what}`;
		r.innerHTML = avatarSvg(m.avatar, 30);
		r.append(el("i"));
		return r;
	}

	function logRow(e: LogEntry): HTMLElement | null {
		if (e.kind === "event")
			return settings.chatNotices
				? el("div", "ev", `${e.text} · ${hhmm(e.at)}`)
				: null;
		const r = el("div", e.mine ? "msg mine" : "msg");
		const av = el("span");
		av.innerHTML = avatarSvg(e.from.avatar, 26);
		const body = el("div");
		if (!e.mine)
			body.append(el("div", "who", `${e.from.name} · ${hhmm(e.at)}`));
		body.append(el("div", "bubble", e.text));
		r.append(av, body);
		return r;
	}

	function render(): void {
		wrap.hidden = state === null;
		if (!state) return;
		const s = state;
		const open = settings.panelOpen;

		// isla
		stack.replaceChildren();
		for (const m of s.members.slice(0, 3)) {
			const holder = el("span");
			holder.innerHTML = avatarSvg(m.avatar, 24);
			if (holder.firstElementChild)
				stack.append(holder.firstElementChild);
		}
		count.textContent = String(s.members.length);
		dot.className = s.online ? "dot" : "dot off";
		waitChip.hidden = !s.wait;
		if (s.wait) waitChip.textContent = `${s.wait.ready}/${s.wait.total}`;
		badge.hidden = unread === 0 || open;
		badge.textContent = String(unread);
		rbtn.hidden = open; // con el panel abierto las reacciones están dentro del panel
		if (open) reactBar.hidden = true;

		// panel
		panel.hidden = !open;
		if (!open) return;
		title.textContent = `Sala ${s.room}`;
		offline.hidden = s.online;
		membersEl.replaceChildren(...s.members.map((m) => memberRow(m, s.you)));
		const atBottom =
			logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 40;
		const rows = s.log
			.map(logRow)
			.filter((r): r is HTMLElement => r !== null);
		if (rows.length === 0)
			logEl.replaceChildren(
				el(
					"div",
					"empty",
					"Aún no hay mensajes. Escribe algo para saludar.",
				),
			);
		else logEl.replaceChildren(...rows);
		if (atBottom) logEl.scrollTop = logEl.scrollHeight;
		waitBar.hidden = !s.wait;
		if (s.wait) {
			waitLabel.textContent = `${waitText(s.wait)} · ${s.wait.ready} de ${s.wait.total} listos`;
			fill.style.width = `${s.wait.total ? (100 * s.wait.ready) / s.wait.total : 0}%`;
		}
		for (const sync of syncers) sync();
	}

	function showToast(text: string, sticky = false): void {
		toast.textContent = text;
		toast.hidden = false;
		clearTimeout(toastTimer);
		waitToastOn = sticky;
		if (!sticky)
			toastTimer = window.setTimeout(() => (toast.hidden = true), 4500);
	}

	// Entradas nuevas del log: no leídos y avisos sobre el video en pantalla completa
	function handleNewEntries(ui: UiState): void {
		const fresh: LogEntry[] = [];
		for (const e of ui.log) {
			const key = `${e.at}|${e.kind}|${e.kind === "chat" ? e.from.id + e.text : e.text}`;
			if (shown.has(key)) continue;
			shown.add(key);
			fresh.push(e);
		}
		if (firstState) {
			firstState = false;
			return;
		} // lo que ya había al cargar la página no cuenta como nuevo
		for (const e of fresh) {
			if (e.kind === "chat" && !e.mine) {
				if (!settings.panelOpen) unread++;
				if (!settings.panelOpen) showToast(`${e.from.name}: ${e.text}`); // mensaje flotante, con o sin pantalla completa
			} else if (
				e.kind === "event" &&
				inFullscreen() &&
				settings.fsNotices &&
				!settings.panelOpen
			) {
				showToast(e.text);
			}
		}
		if (fresh.length) wakeIsland();
	}

	void chrome.storage.local.get("uiSettings").then((r) => {
		settings = {
			...DEFAULT_UI_SETTINGS,
			...(r.uiSettings as Partial<UiSettings> | undefined),
		};
		render();
	});

	return {
		setState(ui) {
			state = ui;
			if (!ui) {
				host.remove();
				firstState = true;
				shown.clear();
				unread = 0;
				wrap.hidden = true;
				return;
			}
			if (!host.isConnected) {
				document.documentElement.appendChild(host);
				place();
			}
			handleNewEntries(ui);
			// espera en curso en pantalla completa: aviso fijo hasta que termine
			if (
				ui.wait &&
				inFullscreen() &&
				settings.fsNotices &&
				!settings.panelOpen
			) {
				showToast(
					`${waitText(ui.wait)} · ${ui.wait.ready} de ${ui.wait.total}`,
					true,
				);
			} else if (!ui.wait && waitToastOn) {
				toast.hidden = true;
				waitToastOn = false;
			}
			if (ui.wait) wakeIsland(); // mientras esperan a alguien la isla se queda visible
			render();
		},
		react(name, emoji) {
			if (!state) return;
			const f = el("div", "float");
			f.style.right = `${24 + Math.random() * 170}px`;
			f.append(el("b", undefined, emoji), el("span", undefined, name));
			f.addEventListener("animationend", () => f.remove());
			floats.append(f);
			while (floats.childElementCount > 30)
				floats.firstElementChild?.remove();
		},
		toggle() {
			if (state) setOpen(!settings.panelOpen);
		},
	};
}
