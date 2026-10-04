/**
 * The film's OFL fonts (public/fonts, credited in CREDITS.md): loaded with FontFace into document.fonts
 * before the film page reports ready, so every caption card rasterises with its real face from the first
 * frame (a fallback serif in one frame and Cinzel in the next would break the film's determinism).
 * A missing or undecodable file fails the boot loudly.
 */

export interface FilmFont {
  family: string;
  url: string;
  /** CSS font-weight descriptor (a range for variable fonts) */
  weight: string;
  style?: 'normal' | 'italic';
}

/** Family names as the caption raster uses them. */
export const FONT = {
  display: 'Cinzel',
  decorative: 'Cinzel Decorative',
  serif: 'Cormorant Garamond',
  text: 'EB Garamond',
} as const;

export const FILM_FONTS: FilmFont[] = [
  { family: FONT.display, url: '/fonts/cinzel/Cinzel-VariableFont_wght.ttf', weight: '400 900' },
  { family: FONT.decorative, url: '/fonts/cinzeldecorative/CinzelDecorative-Regular.ttf', weight: '400' },
  { family: FONT.decorative, url: '/fonts/cinzeldecorative/CinzelDecorative-Bold.ttf', weight: '700' },
  { family: FONT.serif, url: '/fonts/cormorantgaramond/CormorantGaramond-VariableFont_wght.ttf', weight: '300 700' },
  { family: FONT.serif, url: '/fonts/cormorantgaramond/CormorantGaramond-Italic-VariableFont_wght.ttf', weight: '300 700', style: 'italic' },
  { family: FONT.text, url: '/fonts/ebgaramond/EBGaramond-VariableFont_wght.ttf', weight: '400 800' },
  { family: FONT.text, url: '/fonts/ebgaramond/EBGaramond-Italic-VariableFont_wght.ttf', weight: '400 800', style: 'italic' },
];

let loading: Promise<void> | null = null;

/** Fetch, decode and register every film font (once per page). Rejects on any missing / broken file. */
export function loadFilmFonts(): Promise<void> {
  loading ??= (async () => {
    const faces = await Promise.all(
      FILM_FONTS.map(async (f) => {
        const res = await fetch(f.url);
        const type = res.headers.get('content-type') ?? '';
        // (a dev server answers an unknown path with index.html: catch it before the decoder does)
        if (!res.ok || type.includes('text/html')) throw new Error(`film fonts: ${f.url} is missing (${res.status} ${type})`);
        const face = new FontFace(f.family, await res.arrayBuffer(), { weight: f.weight, style: f.style ?? 'normal' });
        try {
          await face.load();
        } catch (e) {
          throw new Error(`film fonts: ${f.url} failed to decode (${String(e)})`);
        }
        return face;
      }),
    );
    for (const face of faces) document.fonts.add(face);
    await document.fonts.ready;
    for (const f of FILM_FONTS) {
      const probe = `${f.style === 'italic' ? 'italic ' : ''}${f.weight.split(' ')[0]} 24px "${f.family}"`;
      if (!document.fonts.check(probe)) throw new Error(`film fonts: ${f.family} (${f.style ?? 'normal'}) is not available after loading`);
    }
  })();
  return loading;
}
