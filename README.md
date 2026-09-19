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
