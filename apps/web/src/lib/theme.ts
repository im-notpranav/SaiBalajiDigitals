// The script at the top of index.html reads this same key, so the page paints in the right
// theme before React starts. Keep the two in step.
const STORAGE_KEY = "sb-theme";
const THEME_COLOR = { light: "#0b8ce0", dark: "#0f1320" };

// An even ease-in-out. The circle's area grows with the square of its radius, so a curve that
// front-loads the motion (ease-out) floods most of the screen in the first few frames and then
// crawls: it reads as a flash. Easing in and out keeps the visible edge moving steadily.
const REVEAL_MS = 560;
// A phone screen is a shorter sweep, so the same pace takes less time.
const REVEAL_MS_TOUCH = 480;
const REVEAL_BEZIER = [0.65, 0, 0.35, 1] as const;
const REVEAL_EASE = `cubic-bezier(${REVEAL_BEZIER.join(", ")})`;
// Keep in step with `html.theme-fade` in styles.css.
const FADE_MS = 240;

type Point = { x: number; y: number };

// The theme the user last asked for. Kept here rather than read back from the page because the
// page only changes a frame later, and a quick second press must toggle from the new value.
let wanted: boolean | null = null;
// Each switch gets a number. A press during a running switch cuts the old one short, and the old
// one's clean-up must not strip the classes the new one is using.
let current = 0;
let titleBarTimer: number | undefined;

function revealDuration() {
  return window.matchMedia("(pointer: coarse), (max-width: 768px)").matches
    ? REVEAL_MS_TOUCH
    : REVEAL_MS;
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The browser's address bar on a phone and the title bar of the installed app. */
function setTitleBar(dark: boolean) {
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", dark ? THEME_COLOR.dark : THEME_COLOR.light);
}

function cubic(a: number, b: number, s: number) {
  return 3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3;
}

/** The time fraction (0..1) at which the reveal's ease reaches `progress`. */
function timeAt(progress: number) {
  const [x1, y1, x2, y2] = REVEAL_BEZIER;
  // Both curves rise steadily, so a bisection on the curve's own parameter is enough.
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (cubic(y1, y2, mid) < progress) lo = mid;
    else hi = mid;
  }
  return cubic(x1, x2, (lo + hi) / 2);
}

function clearSwitchClasses(root: HTMLElement) {
  root.classList.remove("theme-reveal", "theme-reveal-back", "theme-fade");
}

function fadeTheme(id: number, dark: boolean, apply: () => void) {
  const root = document.documentElement;
  // The classes go on inside the update, together with the theme: one style pass before the
  // switch can start instead of two, and `transition: none` still lands in the same pass as the
  // new colours, so nothing animates twice.
  const transition = document.startViewTransition(() => {
    clearSwitchClasses(root);
    root.classList.add("theme-fade");
    apply();
  });
  transition.ready.catch(() => {
    /* skipped by a newer press: the theme has still been applied */
  });
  window.clearTimeout(titleBarTimer);
  titleBarTimer = window.setTimeout(() => setTitleBar(dark), FADE_MS / 2);
  void transition.finished.finally(() => {
    if (id === current) clearSwitchClasses(root);
  });
}

/**
 * Desktop and phone alike: the new theme grows out of the toggle as a circle, and going back
 * shrinks it into the toggle again. The circle clips a still snapshot of the page, not the live
 * page, so the blurred glass is painted once at the start rather than every frame, and
 * `clip-path: circle()` is a plain shape with no per-frame path building.
 */
function revealTheme(id: number, toDark: boolean, origin: Point, apply: () => void) {
  const root = document.documentElement;
  const transition = document.startViewTransition(() => {
    clearSwitchClasses(root);
    root.classList.add("theme-reveal");
    root.classList.toggle("theme-reveal-back", !toDark);
    apply();
  });

  const duration = revealDuration();
  const { innerWidth: w, innerHeight: h } = window;
  const reach = Math.hypot(Math.max(origin.x, w - origin.x), Math.max(origin.y, h - origin.y)) + 2;
  const grown = `circle(${reach}px at ${origin.x}px ${origin.y}px)`;
  const dot = `circle(0px at ${origin.x}px ${origin.y}px)`;

  let sweep: Animation | undefined;
  transition.ready
    .then(() => {
      sweep = root.animate(
        { clipPath: toDark ? [dot, grown] : [grown, dot] },
        {
          duration,
          easing: REVEAL_EASE,
          fill: "both",
          pseudoElement: toDark ? "::view-transition-new(root)" : "::view-transition-old(root)",
        },
      );
      // The installed app's title bar can't be animated. It changes when the circle's edge
      // crosses the middle of it, instead of jumping on the press while the page still shows
      // the old theme.
      const edge = Math.min(1, Math.hypot(origin.x - w / 2, origin.y) / reach);
      window.clearTimeout(titleBarTimer);
      titleBarTimer = window.setTimeout(
        () => setTitleBar(toDark),
        timeAt(toDark ? edge : 1 - edge) * duration,
      );
    })
    .catch(() => {
      // Skipped: by a newer press (which sets the title bar itself), or because the window was
      // hidden. The theme itself has been applied either way.
      if (id === current) setTitleBar(toDark);
    });

  void transition.finished.finally(() => {
    // `fill: both` would otherwise keep the finished sweep alive, one more per press.
    sweep?.cancel();
    if (id === current) clearSwitchClasses(root);
  });
}

export function isDarkTheme() {
  return wanted ?? document.documentElement.classList.contains("dark");
}

/**
 * `origin` is where the reveal starts, in viewport pixels: the centre of the toggle.
 * `onApply` runs in the same frame the page changes theme, so state that draws part of the page
 * (the toggle's own icon) changes inside the animation rather than a frame ahead of it.
 */
export function setDarkTheme(dark: boolean, origin: Point, onApply?: () => void) {
  wanted = dark;
  const id = ++current;
  try {
    localStorage.setItem(STORAGE_KEY, dark ? "dark" : "light");
  } catch {
    /* private mode: the theme still applies until the next reload */
  }

  const apply = () => {
    document.documentElement.classList.toggle("dark", dark);
    onApply?.();
  };

  if (!document.startViewTransition) {
    apply();
    setTitleBar(dark);
  } else if (prefersReducedMotion()) {
    // Nothing travels across the screen, but a whole page jumping from light to dark is still
    // hard on the eyes, so it gets a short cross-fade.
    fadeTheme(id, dark, apply);
  } else {
    revealTheme(id, dark, origin, apply);
  }
}
