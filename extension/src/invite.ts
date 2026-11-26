import { AVATAR_IDS, avatarSvg } from "./avatars";
import { isInsecure } from "./config";

// Tarjeta que aparece cuando abres un link de invitación (…#sw-room=sala) sin estar en una sala.
// Pide tu apodo, tu avatar y la contraseña (si la sala la tiene) y te une. Shadow DOM cerrado, como el panel.

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: Inter, system-ui, -apple-system, "Segoe UI", sans-serif; }
.card {
	position: fixed; top: 16px; right: 16px; width: 310px; padding: 16px; border-radius: 14px;
	background: #0F1117; color: #ECEEF5; border: 1px solid #2A2F3F; box-shadow: 0 12px 40px rgba(0,0,0,.55); font-size: 13px;
}
svg { fill: currentColor; flex: none; }
h2 { margin: 0 0 4px; font-size: 15px; }
p { margin: 0 0 6px; color: #9AA1B5; display: flex; align-items: center; gap: 5px; }
p svg { color: #FBBF24; }
label { display: block; margin: 10px 0 5px; font-size: 12px; font-weight: 600; color: #9AA1B5; }
input { width: 100%; padding: 8px 10px; border-radius: 8px; border: 1px solid #2A2F3F; background: #171A23; color: #ECEEF5; font: inherit; outline: none; }
input:focus { border-color: #5EEAD4; }
.pw { position: relative; }
.pw input { padding-right: 38px; }
.eye { position: absolute; right: 4px; top: 50%; transform: translateY(-50%); width: 30px; height: 30px; padding: 0; display: grid; place-items: center; border: 0; border-radius: 6px; background: none; color: #9AA1B5; cursor: pointer; }
.eye:hover { color: #ECEEF5; background: #232838; }
.avatars { display: flex; gap: 6px; }
.avatars button { padding: 2px; border: 2px solid transparent; border-radius: 50%; background: none; line-height: 0; cursor: pointer; flex: none; }
.avatars button[aria-checked="true"] { border-color: #5EEAD4; }
.srv { margin: 0 0 4px; font-size: 12px; color: #9AA1B5; word-break: break-all; }
.srv.warn { color: #FBBF24; }
.err { margin-top: 8px; color: #FB7185; font-size: 12px; }
.err[hidden] { display: none; }
.row { display: flex; gap: 8px; margin-top: 14px; }
.row button { flex: 1; padding: 9px; border-radius: 10px; border: 1px solid #2A2F3F; background: #232838; color: #ECEEF5; font: inherit; cursor: pointer; }
.row button.go { border: 0; background: #5EEAD4; color: #04201C; font-weight: 700; }
.row button:disabled { opacity: .6; cursor: default; }
`;

const ICON_LOCK =
	"M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zM9 8V6c0-1.66 1.34-3 3-3s3 1.34 3 3v2H9z";
const ICON_EYE =
	"M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z";
const ICON_EYE_OFF =
	"M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z";
const svg = (path: string, size: number): string =>
	`<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;

export type InviteOptions = {
	room: string;
	locked: boolean;
	server?: string; // servidor que trae el link (se muestra para que sepas a dónde te conectas)
	name: string; // apodo guardado (puede venir vacío)
	avatar?: string; // avatar guardado (si no viene, se lee de chrome.storage)
	onJoin: (name: string, password: string, avatar: string) => void;
};

export type Invite = { error(message: string): void; close(): void };

type SavedProfile = { id: string; name: string; avatar: string };

export function showInvite(opts: InviteOptions): Invite {
	const host = document.createElement("div");
	host.setAttribute("popover", "manual");
	host.style.cssText =
		"all:initial;position:fixed;top:0;left:0;width:0;height:0;overflow:visible;";
	const shadow = host.attachShadow({ mode: "closed" });

	const style = document.createElement("style");
	style.textContent = CSS;
	const card = document.createElement("div");
	card.className = "card";

	const h = document.createElement("h2");
	h.textContent = "Te invitaron a una sala";
	const p = document.createElement("p");
	if (opts.locked) p.insertAdjacentHTML("beforeend", svg(ICON_LOCK, 13));
	p.append(`Sala ${opts.room}${opts.locked ? " · con contraseña" : ""}`);

	const srv = document.createElement("div");
	if (opts.server) {
		srv.className = isInsecure(opts.server) ? "srv warn" : "srv";
		srv.textContent =
			`Servidor: ${opts.server}` +
			(isInsecure(opts.server) ? " · sin cifrar (ws://)" : "");
	}
	const nameLabel = document.createElement("label");
	nameLabel.textContent = "Tu apodo";
	const nameInput = document.createElement("input");
	nameInput.maxLength = 20;
	nameInput.placeholder = "ej: Camilo";
	nameInput.value = opts.name;

	// Avatar: arranca con el guardado (si hay) y se puede cambiar aquí
	let avatar: string =
		opts.avatar && (AVATAR_IDS as readonly string[]).includes(opts.avatar)
			? opts.avatar
			: AVATAR_IDS[0];
	let savedProfile: SavedProfile | null = null;
	const avatarLabel = document.createElement("label");
	avatarLabel.textContent = "Tu avatar";
	const avatarsEl = document.createElement("div");
	avatarsEl.className = "avatars";
	avatarsEl.setAttribute("role", "radiogroup");
	function drawAvatars(): void {
		avatarsEl.replaceChildren();
		for (const id of AVATAR_IDS) {
			const b = document.createElement("button");
			b.type = "button";
			b.setAttribute("role", "radio");
			b.setAttribute("aria-checked", String(id === avatar));
			b.title = id;
			b.innerHTML = avatarSvg(id, 30);
			b.addEventListener("click", () => {
				avatar = id;
				drawAvatars();
			});
			avatarsEl.append(b);
		}
	}
	drawAvatars();
	void chrome.storage.local.get({ profile: null }).then((r) => {
		savedProfile = r.profile as SavedProfile | null;
		if (
			!opts.avatar &&
			savedProfile?.avatar &&
			(AVATAR_IDS as readonly string[]).includes(savedProfile.avatar)
		) {
			avatar = savedProfile.avatar;
			drawAvatars();
		}
	});

	card.append(h, p);
	if (opts.server) card.append(srv);
	card.append(nameLabel, nameInput, avatarLabel, avatarsEl);

	let passInput: HTMLInputElement | null = null;
	if (opts.locked) {
		const passLabel = document.createElement("label");
		passLabel.textContent = "Contraseña de la sala";
		const wrap = document.createElement("div");
		wrap.className = "pw";
		passInput = document.createElement("input");
		passInput.type = "password";
		passInput.maxLength = 64;
		const eye = document.createElement("button");
		eye.type = "button";
		eye.className = "eye";
		const paintEye = (): void => {
			const hidden = passInput?.type === "password";
			eye.innerHTML = svg(hidden ? ICON_EYE : ICON_EYE_OFF, 18);
			eye.title = hidden ? "Mostrar contraseña" : "Ocultar contraseña";
			eye.setAttribute("aria-label", eye.title);
		};
		eye.addEventListener("click", () => {
			if (!passInput) return;
			passInput.type =
				passInput.type === "password" ? "text" : "password";
			paintEye();
		});
		paintEye();
		wrap.append(passInput, eye);
		card.append(passLabel, wrap);
	}

	const err = document.createElement("div");
	err.className = "err";
	err.hidden = true;

	const row = document.createElement("div");
	row.className = "row";
	const no = document.createElement("button");
	no.textContent = "Ahora no";
	no.type = "button";
	const go = document.createElement("button");
	go.textContent = "Unirme";
	go.className = "go";
	go.type = "button";
	row.append(no, go);
	card.append(err, row);
	shadow.append(style, card);

	function showError(message: string): void {
		err.textContent = message;
		err.hidden = false;
		go.disabled = false;
		go.textContent = "Unirme";
		(passInput ?? nameInput).focus();
	}

	async function submit(): Promise<void> {
		const name = nameInput.value.trim();
		if (!name)
			return showError(
				"Escribe tu apodo para que los demás te reconozcan",
			);
		if (passInput && !passInput.value)
			return showError("Escribe la contraseña de la sala");
		err.hidden = true;
		go.disabled = true;
		go.textContent = "Entrando…";
		// guarda apodo y avatar para que el servidor y el popup usen los mismos
		const profile: SavedProfile = {
			id: savedProfile?.id ?? crypto.randomUUID(),
			name,
			avatar,
		};
		await chrome.storage.local.set({ profile });
		opts.onJoin(name, passInput?.value ?? "", avatar);
	}

	go.addEventListener("click", () => void submit());
	no.addEventListener("click", () => host.remove());
	// que escribir aquí no active los atajos de la página
	for (const type of ["keydown", "keyup", "keypress"] as const)
		window.addEventListener(
			type,
			(e) => {
				if (e.target !== host) return;
				e.stopImmediatePropagation();
				if (type === "keydown" && (e as KeyboardEvent).key === "Enter")
					void submit();
			},
			true,
		);

	document.documentElement.appendChild(host);
	try {
		host.showPopover();
	} catch {
		/* sin popover: queda como elemento normal */
	}
	(opts.name ? (passInput ?? nameInput) : nameInput).focus();

	return { error: showError, close: () => host.remove() };
}
