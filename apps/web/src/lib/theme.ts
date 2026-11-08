// The script at the top of index.html reads this same key, so the page paints in the right
// theme before React starts. Keep the two in step.
const STORAGE_KEY = "sb-theme";
const THEME_COLOR = { light: "#0b8ce0", dark: "#0f1320" };

type Point = { x: number; y: number };

// Long for UI, on purpose: a rare, full-screen moment, and any quicker it reads as a wipe.
const LIQUID_MS = 1000;
const LIQUID_EASE = "cubic-bezier(0.77, 0, 0.175, 1)";
const LIQUID_KEYFRAMES = 32;
// Starts as a visible droplet, so there is a response on the very first frame.
const LIQUID_DROPLET = 14;
// Few points on purpose: the outline is drawn as curves, so it stays smooth at any size.
const LIQUID_POINTS = 48;
// [lobes, weight, drift, phase]. Whole-number lobes so the outline joins up with itself.
const LIQUID_RIPPLES = [
  [3, 0.5, 1.7, 0.4],
  [5, 0.3, -2.3, 2.1],
  [8, 0.2, 3.1, 4.2],
] as const;

/** A closed, wobbling blob around `origin`, as SVG path data for `clip-path: path()`. */
function liquidOutline(origin: Point, radius: number, swell: number, progress: number) {
  const points: Point[] = [];
  for (let i = 0; i < LIQUID_POINTS; i++) {
    const angle = (i / LIQUID_POINTS) * Math.PI * 2;
    const wobble = LIQUID_RIPPLES.reduce(
      (sum, [lobes, weight, drift, phase]) =>
        sum + weight * Math.sin(lobes * angle + phase + drift * progress * Math.PI * 2),
      0,
    );
    const r = Math.max(0.5, radius + swell * wobble);
    points.push({ x: origin.x + r * Math.cos(angle), y: origin.y + r * Math.sin(angle) });
  }

  // Catmull-Rom through the points, written as cubic beziers.
  const at = (i: number) => points[(i + LIQUID_POINTS) % LIQUID_POINTS]!;
  const n = (v: number) => v.toFixed(1);
  let path = `M${n(points[0]!.x)} ${n(points[0]!.y)}`;
  for (let i = 0; i < LIQUID_POINTS; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    path +=
      `C${n(p1.x + (p2.x - p0.x) / 6)} ${n(p1.y + (p2.y - p0.y) / 6)} ` +
      `${n(p2.x - (p3.x - p1.x) / 6)} ${n(p2.y - (p3.y - p1.y) / 6)} ${n(p2.x)} ${n(p2.y)}`;
  }
  return `${path}Z`;
}

/** Keyframes for the spreading blob and for the lit band that rides on its edge. */
function liquidKeyframes(origin: Point) {
  const { innerWidth: w, innerHeight: h } = window;
  // Ends past the farthest corner, with no wobble left, so the blob covers the whole screen.
  const reach = Math.hypot(Math.max(origin.x, w - origin.x), Math.max(origin.y, h - origin.y)) + 2;
  const maxSwell = Math.min(w, h) * 0.1;

  const fill: Keyframe[] = [];
  const edge: Keyframe[] = [];
  for (let f = 0; f <= LIQUID_KEYFRAMES; f++) {
    const progress = f / LIQUID_KEYFRAMES;
    const radius = LIQUID_DROPLET + progress * (reach - LIQUID_DROPLET);
    const energy = f === LIQUID_KEYFRAMES ? 0 : Math.sin(Math.PI * progress);
    const swell = Math.min(radius * 0.3, maxSwell * energy);
    const band = 2 + 6 * energy;

    fill.push({ clipPath: `path("${liquidOutline(origin, radius, swell, progress)}")` });
    const outer = liquidOutline(origin, radius + band, swell, progress);
    const inner = liquidOutline(origin, radius, swell, progress);
    edge.push({ clipPath: `path(evenodd, "${outer}${inner}")`, opacity: energy * 0.55 });
  }
  return { fill, edge };
}

let liquidRun = 0;
let liquidEdge: HTMLElement | null = null;

/**
 * Dark mode spills out of the toggle as a liquid, and going back drains it into the toggle, so
 * the change has a source and a way back. The browser ignores mouse clicks on the page until it
 * finishes (`pointer-events` does not lift that); the keyboard still works, hence the restart.
 */
function pourTheme(toDark: boolean, origin: Point, apply: () => void) {
  const root = document.documentElement;
  const run = ++liquidRun;

  // A second press mid-pour: the browser ends the first transition, this one starts fresh.
  liquidEdge?.remove();
  const edgeEl = document.createElement("div");
  edgeEl.className = "theme-liquid-edge";
  liquidEdge = edgeEl;

  root.classList.add("theme-liquid");
  root.classList.toggle("theme-liquid-drain", !toDark);

  const transition = document.startViewTransition(() => {
    apply();
    document.body.append(edgeEl);
  });

  const animations: Animation[] = [];
  transition.ready
    .then(() => {
      const { fill, edge } = liquidKeyframes(origin);
      const timing = {
        duration: LIQUID_MS,
        easing: LIQUID_EASE,
        // The end state has to hold: the browser tears the transition down a frame after the
        // animations finish, and without it the uncut layers flash for that frame.
        fill: "both" as const,
        direction: toDark ? ("normal" as const) : ("reverse" as const),
      };
      animations.push(
        root.animate(fill, {
          ...timing,
          pseudoElement: toDark ? "::view-transition-new(root)" : "::view-transition-old(root)",
        }),
        root.animate(edge, {
          ...timing,
          pseudoElement: "::view-transition-new(theme-liquid-edge)",
        }),
      );
    })
    .catch(() => {
      /* skipped by a newer press: the theme has still been applied */
    });

  void transition.finished.finally(() => {
    // A held end state must not outlive the transition, or it would clip the next switch.
    animations.forEach((animation) => animation.cancel());
    edgeEl.remove();
    if (run === liquidRun) root.classList.remove("theme-liquid", "theme-liquid-drain");
  });
}

export function isDarkTheme() {
  return document.documentElement.classList.contains("dark");
}

/** `origin` is where the liquid starts, in viewport pixels: the centre of the toggle. */
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
  } else if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    // Nothing travels across the screen, but a whole page jumping from light to dark is still
    // hard on the eyes, so it gets the browser's plain cross-fade.
    document.startViewTransition(apply);
  } else {
    pourTheme(dark, origin, apply);
  }
}
