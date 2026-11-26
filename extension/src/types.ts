export type VideoState = { paused: boolean; time: number; rate: number };
export type PageInfo = { url: string; title: string; nav?: string }; // nav: a dónde navegar para llegar ahí (si difiere de url)

export type StateMessage = {
	type: "state";
	state: VideoState;
	seek?: boolean;
	reply?: boolean; // respuesta a "report-state": dice dónde vamos, no si hay que reproducir
};
export type HoldMessage = { type: "hold"; epoch: number; state: VideoState };
export type ResumeMessage = {
	type: "resume";
	epoch: number;
	state: VideoState;
};
export type ReadyMessage = { type: "ready"; epoch: number };
export type PageMessage = {
	type: "page";
	url: string;
	title: string;
	id?: string;
	nav?: string;
};
export type ReportPageMessage = { type: "report-page" };
// content script -> background: ¿este frame tiene un video "de verdad" ahora mismo?
export type VideoInfoMessage = { type: "video-info"; present: boolean };
export type ReportStateMessage = { type: "report-state" };
export type ReportPresenceMessage = { type: "report-presence" };
export type PauseNowMessage = { type: "pause-now" };

// Lo que el background le manda al content script
export type ToContent =
	| StateMessage
	| HoldMessage
	| ResumeMessage
	| ReportPageMessage
	| ReportStateMessage
	| ReportPresenceMessage
	| PauseNowMessage
	| UiStateMessage
	| UiToggleMessage
	| InviteErrorMessage
	| ReactionMessage;

// Quién eres en la sala (sin cuentas: lo eliges tú)
export type Profile = { id: string; name: string; avatar: string };
export type MemberStatus = "ok" | "ad" | "away"; // sincronizado · en un anuncio/cargando · en otra página
export type MemberInfo = Profile & { status: MemberStatus };
export type WaitReason = "seek" | "video" | "ad" | "join";
export type WaitInfo = {
	ready: number;
	total: number;
	reason: WaitReason;
	by?: string;
};

// Una línea del chat: mensaje de alguien o aviso ("Ana pausó el video")
export type LogEntry =
	| { kind: "chat"; from: Profile; text: string; at: number; mine: boolean }
	| { kind: "event"; text: string; at: number };

// Todo lo que necesita el panel de la página para dibujarse
export type UiState = {
	room: string;
	you: string; // id del perfil propio
	online: boolean; // false = reconectando
	members: MemberInfo[];
	log: LogEntry[];
	wait: WaitInfo | null;
	roomUrl: string | null; // a dónde navegar para ver lo mismo que la sala (para el link de invitación)
	locked: boolean; // la sala tiene contraseña
	server: string; // dirección del servidor (va en el link de invitación si no es localhost)
};

// background -> content (frame principal)
export type UiStateMessage = { type: "ui-state"; ui: UiState | null }; // null = no hay sala
export type UiToggleMessage = { type: "ui-toggle" };
export type ReactionMessage = {
	type: "reaction";
	from: Profile;
	emoji: string;
	mine: boolean;
}; // reacción flotante
export type InviteErrorMessage = { type: "invite-error"; message: string }; // la invitación no pudo entrar (contraseña, etc.)

// Preferencias del panel (chrome.storage.local)
export type UiSettings = {
	panelOpen: boolean;
	chatNotices: boolean;
	fsNotices: boolean;
};
export const DEFAULT_UI_SETTINGS: UiSettings = {
	panelOpen: false,
	chatNotices: true,
	fsNotices: true,
};

// Una sala de la lista del popup
export type RoomSummary = {
	name: string;
	members: number;
	locked: boolean;
	title: string;
};

export type Session = {
	serverUrl: string;
	room: string;
	tabId: number;
	profile: Profile;
	password?: string;
};

export type Status = {
	phase: "idle" | "connecting" | "connected" | "error";
	room?: string;
	peers?: number;
	message?: string;
	roomPage?: PageInfo; // el video en el que está la sala
	mismatch?: boolean; // true = tu pestaña está en otro video
	myPage?: PageInfo; // la página de tu pestaña, para diagnosticar
};
