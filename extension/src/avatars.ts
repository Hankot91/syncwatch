// Avatares de la sala (los del diseño). Cada uno es el interior de un SVG con viewBox 0 0 40 40.
export const AVATAR_IDS = ["zorro", "gato", "rana", "pinguino", "robot", "fantasma"] as const;
export type AvatarId = (typeof AVATAR_IDS)[number];

const PATHS: Record<string, string> = {
	zorro: `<circle cx="20" cy="20" r="20" fill="#F97316"/><path d="M7 6l9 7-9 8z" fill="#9A3412"/><path d="M33 6l-9 7 9 8z" fill="#9A3412"/><path d="M8 21c5 1 8 4 12 4s7-3 12-4c-1 9-6 15-12 15S9 30 8 21z" fill="#FFEDD5"/><circle cx="14.5" cy="19" r="2" fill="#1C1917"/><circle cx="25.5" cy="19" r="2" fill="#1C1917"/><path d="M17.5 28h5l-2.5 3z" fill="#1C1917"/>`,
	gato: `<circle cx="20" cy="20" r="20" fill="#A78BFA"/><path d="M8 5l8 7-9 6z" fill="#5B21B6"/><path d="M32 5l-8 7 9 6z" fill="#5B21B6"/><ellipse cx="20" cy="23" rx="12" ry="11" fill="#C4B5FD"/><circle cx="15" cy="21" r="2" fill="#1E1B4B"/><circle cx="25" cy="21" r="2" fill="#1E1B4B"/><path d="M18.5 26.5h3L20 28z" fill="#1E1B4B"/><path d="M5 25h8M5 29l8-2M35 25h-8M35 29l-8-2" stroke="#1E1B4B" stroke-width="1" stroke-linecap="round"/>`,
	rana: `<circle cx="20" cy="20" r="20" fill="#4ADE80"/><circle cx="12.5" cy="14" r="5.5" fill="#F0FDF4"/><circle cx="27.5" cy="14" r="5.5" fill="#F0FDF4"/><circle cx="13" cy="14.5" r="2.4" fill="#052E16"/><circle cx="27" cy="14.5" r="2.4" fill="#052E16"/><path d="M10 26c5 6 15 6 20 0" fill="none" stroke="#052E16" stroke-width="2.2" stroke-linecap="round"/>`,
	pinguino: `<circle cx="20" cy="20" r="20" fill="#60A5FA"/><ellipse cx="20" cy="22" rx="12" ry="14" fill="#1E293B"/><ellipse cx="20" cy="25" rx="8" ry="10" fill="#F1F5F9"/><circle cx="16" cy="17.5" r="1.8" fill="#0F172A"/><circle cx="24" cy="17.5" r="1.8" fill="#0F172A"/><path d="M17 21h6l-3 4z" fill="#FB923C"/>`,
	robot: `<circle cx="20" cy="20" r="20" fill="#94A3B8"/><rect x="9" y="12" width="22" height="19" rx="5" fill="#E2E8F0"/><rect x="18.5" y="5" width="3" height="8" fill="#475569"/><circle cx="20" cy="5" r="2.5" fill="#F43F5E"/><rect x="13" y="18" width="5" height="5" rx="1.5" fill="#0F172A"/><rect x="22" y="18" width="5" height="5" rx="1.5" fill="#0F172A"/><rect x="14" y="26" width="12" height="2" rx="1" fill="#475569"/>`,
	fantasma: `<circle cx="20" cy="20" r="20" fill="#F472B6"/><path d="M10 31V19a10 10 0 0 1 20 0v12l-3.4-3-3.3 3-3.3-3-3.3 3-3.3-3z" fill="#FDF2F8"/><circle cx="16" cy="19" r="2" fill="#500724"/><circle cx="24" cy="19" r="2" fill="#500724"/><ellipse cx="20" cy="25" rx="2.2" ry="2.8" fill="#500724"/>`,
};

export function avatarSvg(id: string, size = 28): string {
	const inner = PATHS[id] ?? PATHS.zorro;
	return `<svg width="${size}" height="${size}" viewBox="0 0 40 40" aria-hidden="true">${inner}</svg>`;
}
