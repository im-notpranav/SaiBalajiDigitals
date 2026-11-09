// The script at the top of index.html reads this same key, so the page paints in the right
// theme before React starts. Keep the two in step.
const STORAGE_KEY = "sb-theme";
const THEME_COLOR = { light: "#0b8ce0", dark: "#0f1320" };

// Quick on purpose: the switch is a small moment, and a long one feels slow, most of all on a phone.
const REVEAL_MS = 420;
const REVEAL_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
const FADE_MS = 180;

type Point = { x: number; y: number };

/**
 * Phones and tablets get a short cross-fade. A growing clip-path repaints a full screen of
 * blurred glass every frame, and that is what made the old switch stutter on mobile.
 */
function prefersLightweight() {
  return window.matchMedia("(pointer: coarse), (max-width: 768px)").matches;
}

function fadeTheme(apply: () => void) {
  const root = document.documentElement;
  root.classList.add("theme-fade");
  const transition = document.startViewTransition(apply);
  void transition.finished.finally(() => root.classList.remove("theme-fade"));
}

/**
 * Desktop: the new theme grows out of the toggle as a circle, and going back shrinks it into the
 * toggle again. `clip-path: circle()` is a plain shape the browser animates cheaply, with no
 * per-frame path building.
 */
function revealTheme(toDark: boolean, origin: Point, apply: () => void) {
  const root = document.documentElement;
  root.classList.add("theme-reveal");
  root.classList.toggle("theme-reveal-back", !toDark);

  const transition = document.startViewTransition(apply);
  const { innerWidth: w, innerHeight: h } = window;
  const reach = Math.hypot(Math.max(origin.x, w - origin.x), Math.max(origin.y, h - origin.y)) + 2;
  const grown = `circle(${reach}px at ${origin.x}px ${origin.y}px)`;
  const dot = `circle(0px at ${origin.x}px ${origin.y}px)`;

  transition.ready
    .then(() => {
      root.animate(
        { clipPath: toDark ? [dot, grown] : [grown, dot] },
        {
          duration: REVEAL_MS,
          easing: REVEAL_EASE,
          fill: "both",
          pseudoElement: toDark ? "::view-transition-new(root)" : "::view-transition-old(root)",
        },
      );
    })
    .catch(() => {
      /* skipped by a newer press: the theme has still been applied */
    });

  void transition.finished.finally(() => root.classList.remove("theme-reveal", "theme-reveal-back"));
}

export function isDarkTheme() {
  return document.documentElement.classList.contains("dark");
}

/** `origin` is where the reveal starts, in viewport pixels: the centre of the toggle. */
export function setDarkTheme(dark: boolean, origin: Point) {
  try {
    localStorage.setItem(STORAGE_KEY, dark ? "dark" : "light");
  } catch {
    /* private mode: the theme still applies until the next reload */
  }

  const apply = () => {
    document.documentElement.classList.toggle("dark", dark);
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", dark ? THEME_COLOR.dark : THEME_COLOR.light);
  };

  if (!document.startViewTransition) {
    apply();
  } else if (prefersLightweight() || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    // Nothing travels across the screen, but a whole page jumping from light to dark is still
    // hard on the eyes, so it gets a short cross-fade.
    fadeTheme(apply);
  } else {
    revealTheme(dark, origin, apply);
  }
}
