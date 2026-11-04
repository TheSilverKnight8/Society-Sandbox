import { MAX_ELEV } from '../map/terrain';
import { STEP, isoX, isoY, type TileSource } from './iso';
import { LEVELS, TerrainChunks } from './terrainChunks';
import { BACKDROP } from './style';

// The isometric view: a canvas, a camera, and a drawing loop. It handles moving the
// camera itself (wheel to zoom, right or middle drag to pan, WASD or arrow keys) and
// passes left-button actions on as tile positions to whoever owns it.

export interface Camera {
  /** The iso point at the middle of the screen. */
  x: number;
  y: number;
  /** Screen pixels (CSS) per tile width. */
  zoom: number;
}

export interface TilePointer {
  /** Tile under the pointer, or null when it is off the map. */
  tile: { x: number; y: number } | null;
  button: number;
  shift: boolean;
  alt: boolean;
  /** The pointer's position on the canvas, in CSS pixels. */
  sx: number;
  sy: number;
}

export interface ViewHooks {
  onPointerDown?(p: TilePointer): void;
  onPointerMove?(p: TilePointer): void;
  onPointerUp?(p: TilePointer): void;
  onHover?(tile: { x: number; y: number } | null): void;
  /** Draws things standing on the terrain (people, later buildings), in screen pixels. */
  objects?(ctx: CanvasRenderingContext2D, view: IsoView, now: number): void;
  /** Draws on top of everything, in screen pixels. */
  overlay?(ctx: CanvasRenderingContext2D, view: IsoView): void;
}

const MAX_ZOOM = 96;
/** Time per frame spent drawing chunk pictures that are missing or out of date. */
const RENDER_BUDGET_MS = 10;

export class IsoView {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  src: TileSource;
  chunks: TerrainChunks;
  cam: Camera = { x: 0, y: 0, zoom: 4 };
  hooks: ViewHooks = {};
  width = 1;
  height = 1;
  dpr = 1;
  private raf = 0;
  private dirty = true;
  private running = false;
  private keys = new Set<string>();
  private lastFrame = 0;
  private drag: { x: number; y: number; camX: number; camY: number; id: number } | null = null;
  private leftDown = false;
  private hoverTile: { x: number; y: number } | null = null;
  private resizeObs: ResizeObserver;
  private lastPointer: { x: number; y: number } | null = null;
  /** Milliseconds the last frame took to draw (for checking speed). */
  frameMs = 0;
  /** Draw every frame (while things move), not only when something changed. */
  animating = false;
  /** The terrain as last drawn for this camera, so frames where only people move just copy it. */
  private layer = document.createElement('canvas');
  private layerKey = '';
  private terrainDirty = true;

  constructor(canvas: HTMLCanvasElement, src: TileSource) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.src = src;
    this.chunks = new TerrainChunks(src);
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(canvas);
    this.resize();
    this.fit();
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
    canvas.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  destroy() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    const c = this.canvas;
    c.removeEventListener('wheel', this.onWheel);
    c.removeEventListener('pointerdown', this.onPointerDown);
    c.removeEventListener('pointermove', this.onPointerMove);
    c.removeEventListener('pointerup', this.onPointerUp);
    c.removeEventListener('pointercancel', this.onPointerUp);
    c.removeEventListener('pointerleave', this.onPointerLeave);
    c.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  /** Asks for the next frame to be drawn. The view only draws when something changed. */
  redraw() {
    this.dirty = true;
  }

  /** Swaps in new tile data of the same size (for example after regenerating). */
  replaceTiles(src: TileSource) {
    this.src = src;
    this.chunks = new TerrainChunks(src);
    this.terrainDirty = true;
    this.redraw();
  }

  /** Tells the view these tiles (indexes) changed. */
  tilesChanged(tiles: Iterable<number>) {
    this.chunks.invalidate(tiles);
    this.terrainDirty = true;
    this.redraw();
  }

  // ---------------------------------------------------------------- camera

  private resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = Math.max(1, r.width);
    this.height = Math.max(1, r.height);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.redraw();
  }

  private minZoom() {
    // Zoomed out far enough to see the whole map with room around it.
    const s = this.src.size;
    return Math.min((this.width / s) * 0.6, (this.height / (s * 0.5)) * 0.6);
  }

  /** Shows the whole map. */
  fit() {
    const s = this.src.size;
    this.cam = { x: 0, y: s * 0.25, zoom: Math.min((this.width / s) * 0.95, (this.height / (s * 0.5 + 2)) * 0.92) };
    this.clampCam();
    this.redraw();
  }

  private clampCam() {
    const s = this.src.size;
    this.cam.zoom = Math.max(this.minZoom(), Math.min(MAX_ZOOM, this.cam.zoom));
    this.cam.x = Math.max(-s * 0.5, Math.min(s * 0.5, this.cam.x));
    this.cam.y = Math.max(-2, Math.min(s * 0.5 + 1, this.cam.y));
  }

  toScreen(X: number, Y: number): [number, number] {
    return [(X - this.cam.x) * this.cam.zoom + this.width / 2, (Y - this.cam.y) * this.cam.zoom + this.height / 2];
  }

  toIso(sx: number, sy: number): [number, number] {
    return [(sx - this.width / 2) / this.cam.zoom + this.cam.x, (sy - this.height / 2) / this.cam.zoom + this.cam.y];
  }

  zoomAt(sx: number, sy: number, factor: number) {
    const [bx, by] = this.toIso(sx, sy);
    this.cam.zoom *= factor;
    this.clampCam();
    const [ax, ay] = this.toIso(sx, sy);
    this.cam.x += bx - ax;
    this.cam.y += by - ay;
    this.clampCam();
    this.redraw();
  }

  /** The tile drawn at a screen point: the frontmost tile whose column covers it. */
  pick(sx: number, sy: number): { x: number; y: number } | null {
    const [X, Y] = this.toIso(sx, sy);
    const { size, elevation } = this.src;
    // From the highest possible level down: the first column tall enough to reach the point is in front.
    for (let h = MAX_ELEV; h >= 0; h--) {
      const yy = Y + h * STEP;
      // Inverse of isoX / isoY at this level: x - y = 2X, x + y = 4Y.
      const fx = (2 * X + 4 * yy) / 2;
      const fy = (4 * yy - 2 * X) / 2;
      const x = Math.floor(fx);
      const y = Math.floor(fy);
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      if (elevation[y * size + x] >= h) return { x, y };
    }
    return null;
  }

  // ---------------------------------------------------------------- drawing

  private frame = (now: number) => {
    if (!this.running) return;
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.keyPan(dt);
    if (this.dirty || this.animating) {
      this.dirty = false;
      const t0 = performance.now();
      this.draw(now);
      this.frameMs = this.frameMs * 0.9 + (performance.now() - t0) * 0.1;
    }
    this.raf = requestAnimationFrame(this.frame);
  };

  private draw(now: number) {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const key = `${this.cam.x},${this.cam.y},${this.cam.zoom},${W},${H}`;
    if (key !== this.layerKey || this.terrainDirty) {
      if (this.layer.width !== W || this.layer.height !== H) {
        this.layer.width = W;
        this.layer.height = H;
      }
      this.terrainDirty = this.drawTerrain(this.layer.getContext('2d', { alpha: false })!);
      this.layerKey = key;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.layer, 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.hooks.objects?.(ctx, this, now);
    this.hooks.overlay?.(ctx, this);
    if (this.terrainDirty) this.dirty = true;
  }

  /** Draws the terrain for the current camera. Returns true if some chunks are still to be drawn. */
  private drawTerrain(ctx: CanvasRenderingContext2D): boolean {
    const { zoom } = this.cam;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = BACKDROP;
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'medium';

    // The detail level just above the zoom, allowing a slight enlargement (up to 1.2x) to save drawing time.
    const want = zoom * this.dpr;
    const level = LEVELS.find((l) => l * 1.2 >= want) ?? LEVELS[LEVELS.length - 1];
    const [vx0, vy0] = this.toIso(0, 0);
    const [vx1, vy1] = this.toIso(this.width, this.height);
    this.chunks.beginFrame();
    const visible = this.chunks.ordered().filter((b) => !(b.x1 < vx0 || b.x0 > vx1 || b.y1 < vy0 || b.y0 > vy1));

    // Draw missing or out-of-date chunk pictures, nearest the middle of the screen first, within the time budget.
    const deadline = performance.now() + RENDER_BUDGET_MS;
    const todo = visible.filter((b) => {
      const e = this.chunks.get(b.cx, b.cy, level);
      return !e || e.dirty;
    });
    const mx = this.cam.x;
    const my = this.cam.y;
    todo.sort((a, b) => Math.hypot((a.x0 + a.x1) / 2 - mx, (a.y0 + a.y1) / 2 - my) - Math.hypot((b.x0 + b.x1) / 2 - mx, (b.y0 + b.y1) / 2 - my));
    let rendered = 0;
    for (const b of todo) {
      if (performance.now() > deadline) break;
      this.chunks.render(b, level);
      rendered++;
    }

    // Then copy the pictures, back to front; a chunk not drawn yet shows another level's picture.
    for (const b of visible) {
      const e = this.chunks.get(b.cx, b.cy, level) ?? this.chunks.fallback(b.cx, b.cy, level);
      if (!e) continue;
      const [sx, sy] = this.toScreen(e.x0, e.y0);
      const scale = zoom / e.level;
      ctx.drawImage(e.canvas, sx, sy, e.canvas.width * scale, e.canvas.height * scale);
    }
    return rendered < todo.length;
  }

  /** Traces the top face of a tile, in screen pixels, for overlays. */
  traceTile(ctx: CanvasRenderingContext2D, x: number, y: number) {
    const h = this.src.elevation[y * this.src.size + x];
    const [sx, sy] = this.toScreen(isoX(x, y), isoY(x, y, h));
    const z = this.cam.zoom;
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + z * 0.5, sy + z * 0.25);
    ctx.lineTo(sx, sy + z * 0.5);
    ctx.lineTo(sx - z * 0.5, sy + z * 0.25);
    ctx.closePath();
  }

  // ---------------------------------------------------------------- input

  private pointerInfo(e: PointerEvent): TilePointer {
    const r = this.canvas.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    return { tile: this.pick(sx, sy), button: e.button, shift: e.shiftKey, alt: e.altKey, sx, sy };
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const r = this.canvas.getBoundingClientRect();
    const lines = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
    this.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.pow(1.0018, -lines));
    this.updateHover(e.clientX - r.left, e.clientY - r.top);
  };

  private onPointerDown = (e: PointerEvent) => {
    this.canvas.focus({ preventScroll: true });
    if (e.button === 1 || e.button === 2) {
      e.preventDefault();
      this.drag = { x: e.clientX, y: e.clientY, camX: this.cam.x, camY: this.cam.y, id: e.pointerId };
      this.canvas.setPointerCapture(e.pointerId);
      this.canvas.style.cursor = 'grabbing';
      return;
    }
    if (e.button === 0) {
      this.leftDown = true;
      this.canvas.setPointerCapture(e.pointerId);
      this.hooks.onPointerDown?.(this.pointerInfo(e));
    }
  };

  private onPointerMove = (e: PointerEvent) => {
    const r = this.canvas.getBoundingClientRect();
    this.lastPointer = { x: e.clientX - r.left, y: e.clientY - r.top };
    if (this.drag && e.pointerId === this.drag.id) {
      this.cam.x = this.drag.camX - (e.clientX - this.drag.x) / this.cam.zoom;
      this.cam.y = this.drag.camY - (e.clientY - this.drag.y) / this.cam.zoom;
      this.clampCam();
      this.redraw();
    }
    this.updateHover(e.clientX - r.left, e.clientY - r.top);
    if (this.leftDown) this.hooks.onPointerMove?.(this.pointerInfo(e));
  };

  private onPointerUp = (e: PointerEvent) => {
    if (this.drag && e.pointerId === this.drag.id) {
      this.drag = null;
      this.canvas.style.cursor = '';
    }
    if (this.leftDown && e.button === 0) {
      this.leftDown = false;
      this.hooks.onPointerUp?.(this.pointerInfo(e));
    } else if (this.leftDown && e.type === 'pointercancel') {
      this.leftDown = false;
      this.hooks.onPointerUp?.(this.pointerInfo(e));
    }
  };

  private onPointerLeave = () => {
    this.lastPointer = null;
    if (!this.leftDown && !this.drag) this.setHover(null);
  };

  private onContextMenu = (e: Event) => e.preventDefault();

  private updateHover(sx: number, sy: number) {
    this.setHover(this.pick(sx, sy));
  }

  private setHover(t: { x: number; y: number } | null) {
    const same = t === this.hoverTile || (t && this.hoverTile && t.x === this.hoverTile.x && t.y === this.hoverTile.y);
    if (same) return;
    this.hoverTile = t;
    this.hooks.onHover?.(t);
    this.redraw();
  }

  get hover() {
    return this.hoverTile;
  }

  private typing(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (this.typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
      this.keys.add(k);
      e.preventDefault();
    } else if (k === '=' || k === '+') {
      this.zoomAt(this.width / 2, this.height / 2, 1.25);
    } else if (k === '-' || k === '_') {
      this.zoomAt(this.width / 2, this.height / 2, 0.8);
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.key.toLowerCase());
  };

  private onBlur = () => this.keys.clear();

  private keyPan(dt: number) {
    if (!this.keys.size) return;
    let dx = 0;
    let dy = 0;
    if (this.keys.has('w') || this.keys.has('arrowup')) dy -= 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) dy += 1;
    if (this.keys.has('a') || this.keys.has('arrowleft')) dx -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) dx += 1;
    if (!dx && !dy) return;
    // About 900 screen pixels a second, whatever the zoom.
    const speed = 900 / this.cam.zoom;
    this.cam.x += dx * speed * dt;
    this.cam.y += dy * speed * dt;
    this.clampCam();
    if (this.lastPointer) this.updateHover(this.lastPointer.x, this.lastPointer.y);
    this.redraw();
  }
}
