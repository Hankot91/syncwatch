# SyncWatch

🇪🇸 [Español](#español) · 🇬🇧 [English](#english)

---

## Español

Extensión de Chrome (Manifest V3) para ver videos en grupo, sincronizados: play, pausa y salto de tiempo se replican entre todos. Funciona con cualquier página que use una etiqueta HTML `<video>`. Incluye chat, reacciones, avatares, lista de salas, salas con contraseña y enlace de invitación. Tú alojas tu propio servidor; no hay servicio central.

> **No se transmite video.** Cada persona reproduce el video desde su propia cuenta o fuente. SyncWatch solo envía eventos pequeños (play/pausa/tiempo) y mensajes de chat.

### Características
- Sincronización de reproducción en cualquier `<video>` (Amazon Prime Video tiene adaptador propio; otras plataformas por probar).
- Chat, reacciones flotantes y avisos de quién entra, sale, pausa o salta.
- Salas públicas (lista con candado si tienen contraseña) y enlace de invitación que ya incluye la dirección del servidor.
- Espera automática cuando alguien está en un anuncio o se desconecta.
- Panel dentro de la página (también en pantalla completa). Atajo: `Alt+Shift+C`.

### Requisitos
- Node.js 20 o superior
- Google Chrome (o un navegador basado en Chromium)
- Opcional: Docker, y `cloudflared` o Tailscale para exponer el servidor a internet

### 1. Levantar el servidor

Con Node:
```bash
cd server
npm install
npm run build
npm start
```

Con Docker:
```bash
cd server
docker compose up -d --build
```

El servidor escucha en `127.0.0.1:8080`. Variables de entorno opcionales:

| Variable | Por defecto | Descripción |
|---|---|---|
| `PORT` | 8080 | Puerto |
| `MAX_CONNECTIONS` | 100 | Conexiones simultáneas |
| `MAX_ROOMS` | 50 | Salas simultáneas |
| `MAX_ROOM_MEMBERS` | 20 | Integrantes por sala |

### 2. Instalar la extensión
```bash
cd extension
npm install
npm run build
```
1. Abre `chrome://extensions` y activa el **Modo de desarrollador**.
2. Pulsa **Cargar descomprimida** y elige la carpeta `extension/dist`.
3. Cada vez que recompiles, pulsa el botón de recargar de la extensión.

### 3. Exponer el servidor a internet (para jugar con amigos)

Tus amigos necesitan llegar a tu servidor. Dos opciones sin abrir puertos del router:

**Cloudflare quick tunnel** (sin cuenta, la URL cambia cada vez):
```bash
cloudflared tunnel --url http://localhost:8080
```
Te da `https://algo.trycloudflare.com`. En la extensión usa `wss://algo.trycloudflare.com`.

**Tailscale Funnel** (URL estable, requiere cuenta):
```bash
tailscale funnel --bg 8080
```
En la extensión usa `wss://<equipo>.<tailnet>.ts.net`.

En el popup abre **Ajustes avanzados → Servidor**, pega la dirección y guarda. El enlace de invitación que generes incluye esa dirección, así que tus amigos solo lo abren.

⚠️ Usa siempre `wss://` (cifrado) si vas a poner contraseña en una sala. Con `ws://` la contraseña viaja sin cifrar. El servidor la guarda solo como hash en memoria y desaparece con la sala.

### Aviso legal
- SyncWatch es un proyecto independiente, **sin relación** con Netflix, Amazon, Disney, YouTube ni ninguna otra plataforma. Los nombres de marcas pertenecen a sus dueños y se mencionan solo para indicar compatibilidad.
- No elude DRM, no graba ni retransmite contenido. Cada usuario necesita acceso legítimo al contenido que reproduce.
- Cada plataforma tiene sus propios términos de servicio; revisa que el uso de herramientas de terceros sea aceptable para ti. Úsalo bajo tu responsabilidad.
- Software proporcionado "tal cual", sin garantías.

### Licencia
[PolyForm Noncommercial 1.0.0](LICENSE): puedes usarlo, modificarlo y compartirlo para fines **no comerciales**. El uso comercial requiere permiso del autor. Es una licencia de código disponible, no una licencia "open source" según la OSI.

### Contribuir
Issues y pull requests son bienvenidos. Usamos [Conventional Commits](https://www.conventionalcommits.org/es/).

---

## English

Chrome (Manifest V3) extension to watch videos together in sync: play, pause and seek are mirrored across everyone in the room. It works on any page that uses an HTML `<video>` tag. It includes chat, reactions, avatars, a room list, password-protected rooms and invite links. You host your own server; there is no central service.

> **No video is streamed.** Everyone plays the video from their own account or source. SyncWatch only sends tiny events (play/pause/time) and chat messages.

### Features
- Playback sync on any `<video>` (Amazon Prime Video has a dedicated adapter; other platforms are untested).
- Chat, floating reactions, and notices for joins, leaves, pauses and seeks.
- Public rooms (padlock if password-protected) and invite links that already include the server address.
- Automatic wait when someone is watching an ad or drops off.
- In-page panel (works in fullscreen too). Shortcut: `Alt+Shift+C`.

### Requirements
- Node.js 20 or newer
- Google Chrome (or a Chromium-based browser)
- Optional: Docker, and `cloudflared` or Tailscale to expose the server

### 1. Run the server

With Node:
```bash
cd server
npm install
npm run build
npm start
```

With Docker:
```bash
cd server
docker compose up -d --build
```

The server listens on `127.0.0.1:8080`. Optional environment variables:

| Variable | Default | Description |
|---|---|---|
| `PORT` | 8080 | Port |
| `MAX_CONNECTIONS` | 100 | Concurrent connections |
| `MAX_ROOMS` | 50 | Concurrent rooms |
| `MAX_ROOM_MEMBERS` | 20 | Members per room |

### 2. Install the extension
```bash
cd extension
npm install
npm run build
```
1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select the `extension/dist` folder.
3. After each rebuild, click the extension's reload button.

### 3. Expose the server to the internet (to play with friends)

Your friends need to reach your server. Two options that need no router port forwarding:

**Cloudflare quick tunnel** (no account, URL changes every run):
```bash
cloudflared tunnel --url http://localhost:8080
```
It prints `https://something.trycloudflare.com`. In the extension use `wss://something.trycloudflare.com`.

**Tailscale Funnel** (stable URL, needs an account):
```bash
tailscale funnel --bg 8080
```
In the extension use `wss://<machine>.<tailnet>.ts.net`.

In the popup open **Ajustes avanzados → Servidor** (advanced settings → server), paste the address and save. Invite links include that address, so friends just open the link.

⚠️ Always use `wss://` (encrypted) if you set a room password. Over `ws://` the password travels unencrypted. The server keeps it only as an in-memory hash, and it disappears with the room.

### Legal notice
- SyncWatch is an independent project with **no affiliation** to Netflix, Amazon, Disney, YouTube or any other platform. Trademarks belong to their owners and are mentioned only to indicate compatibility.
- It does not circumvent DRM and does not record or rebroadcast content. Every user needs legitimate access to what they play.
- Each platform has its own terms of service; check that using third-party tools is acceptable to you. Use at your own risk.
- Provided "as is", without warranty.

### License
[PolyForm Noncommercial 1.0.0](LICENSE): you may use, modify and share it for **noncommercial** purposes. Commercial use requires the author's permission. This is a source-available license, not an OSI-approved "open source" license.

### Contributing
Issues and pull requests are welcome. We use [Conventional Commits](https://www.conventionalcommits.org/).
