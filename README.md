# Primera Nota 🎵

Juego personal estilo *Heardle*: escuchás un fragmento cada vez más largo de una
canción (empezando en 1 segundo) y tenés que adivinarla antes de agotar los
intentos. Es totalmente personalizable: vos armás tu propia biblioteca de
canciones importándolas desde YouTube o TikTok, las organizás en playlists, y
ajustás la duración de los fragmentos.

> **Uso personal.** Este proyecto descarga audio de YouTube/TikTok con
> `yt-dlp` para tu propio consumo offline (jugar). No está pensado para
> redistribuir ni republicar ese contenido — respetá los términos de servicio
> de cada plataforma y los derechos de autor de las canciones que uses.

## Requisitos

- [Node.js](https://nodejs.org/) 18+
- [ffmpeg](https://ffmpeg.org/) (incluye `ffprobe`) en el PATH
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) en el PATH

En Debian/Ubuntu:

```bash
sudo apt-get install -y ffmpeg
pip3 install -U yt-dlp
```

## Instalación y ejecución

```bash
npm install
npm start
```

Abrí http://localhost:3000 en el navegador.

## Cómo se usa

1. **Biblioteca**: pegá un link de YouTube o TikTok, opcionalmente corregí el
   título/artista, elegí a qué playlist(s) va, y tocá "Agregar canción". La
   descarga y conversión de audio corren en segundo plano.
2. En la biblioteca podés ajustar el segundo de **inicio** de cada canción
   (por ejemplo, si querés que arranque justo en el estribillo en vez del
   silencio inicial).
3. **Playlists**: creá tantas como quieras (por década, género, artista,
   "virales de TikTok", etc.) y elegí qué canciones incluye cada una.
4. **Jugar**: elegí una playlist, tocá "Nueva canción" y arrancá a adivinar.
   Cada intento fallido desbloquea un fragmento más largo. Podés escribir tu
   respuesta (con autocompletado contra tu propia biblioteca), saltar el
   intento o rendirte.
5. **Ajustes**: cambiá la duración de cada fragmento (por defecto 1, 2, 4, 7,
   11 y 16 segundos, igual que el Heardle original) o la cantidad de intentos.

## Datos

Todo se guarda localmente en `data/`:
- `data/library.json` — canciones, playlists y configuración
- `data/audio/` — audio completo descargado de cada canción
- `data/clips/` — fragmentos recortados (se generan y cachean bajo demanda)

Esa carpeta está en `.gitignore` porque es contenido personal/descargado, no
código fuente.

## Desplegar: frontend en GitHub Pages + backend aparte

GitHub Pages solo sirve archivos estáticos: no puede ejecutar Node, `ffmpeg`
ni `yt-dlp`. Por eso el despliegue se divide en dos partes.

> **Sobre lo público que queda:** GitHub Pages y la URL del backend son
> accesibles por cualquiera que las conozca. Configurá siempre `API_KEY` en
> el backend antes de exponerlo — sin eso, cualquiera con la URL podría usar
> tu servidor para descargar audio.

### 1. Backend (Node + ffmpeg + yt-dlp) en un host con Docker

El repo incluye un `Dockerfile` listo para Render, Railway, Fly.io, Google
Cloud Run o cualquier host que acepte contenedores.

Variables de entorno a configurar en el host:

| Variable         | Para qué sirve                                                        |
|------------------|------------------------------------------------------------------------|
| `API_KEY`        | Contraseña que va a pedir para cada request (obligatoria si es público) |
| `ALLOWED_ORIGIN` | La URL exacta de tu GitHub Pages (ej. `https://usuario.github.io`)     |
| `DATA_DIR`       | Dónde guardar `library.json`/audio; apuntalo a un volumen persistente  |
| `PORT`           | Puerto (la mayoría de los hosts lo setean solos)                      |

⚠️ **Almacenamiento persistente**: la mayoría de los planes gratuitos de
Render/Railway tienen filesystem efímero (se borra en cada redeploy). Si
querés que tu biblioteca de canciones sobreviva, necesitás un disco/volumen
persistente montado en `DATA_DIR` (por eso `fly.toml` incluye un ejemplo de
volumen para Fly.io). Sin eso, tenés que re-importar las canciones después
de cada redeploy.

Ejemplo genérico con Docker:

```bash
docker build -t primeranota .
docker run -p 3000:3000 \
  -e API_KEY="elegí-una-clave-larga" \
  -e ALLOWED_ORIGIN="https://tu-usuario.github.io" \
  -v $(pwd)/data:/app/data \
  primeranota
```

Con Fly.io (usa el `fly.toml` incluido):

```bash
fly launch --no-deploy   # solo la primera vez, sin sobreescribir fly.toml
fly volumes create primeranota_data --size 1
fly secrets set API_KEY="elegí-una-clave-larga" ALLOWED_ORIGIN="https://tu-usuario.github.io"
fly deploy
```

### 2. Frontend en GitHub Pages

1. En GitHub: **Settings → Pages → Build and deployment → Source:
   GitHub Actions** (activalo una vez, es lo único que no se puede hacer
   por código).
2. El workflow `.github/workflows/deploy-pages.yml` ya está en el repo y
   publica la carpeta `public/` automáticamente en cada push a `main` (o a
   esta rama). Si trabajaste en una rama que no es `main`, mergeala primero.
3. Abrí la URL de Pages que te da GitHub (algo como
   `https://tu-usuario.github.io/PrimeraNota/`). La primera vez te va a
   pedir la URL del backend y, si configuraste `API_KEY`, la clave — se
   guardan en el `localStorage` de tu navegador, no en el repo. Podés
   cambiarlas después desde **Ajustes → Servidor**.

### Uso 100% local (sin desplegar nada)

Si no necesitás acceso remoto, `npm install && npm start` sigue funcionando
igual que antes: frontend y backend en el mismo origen, sin configurar nada
de conexión.
