// WebGL renderer, lighting rig, camera helpers and the tilt-shift "miniature" post effect.
// Ported from Tabletop Turbo; the camera is free (orbit/look) instead of top-down over a table.
import * as THREE from '../vendor/three.bundle.js';
import { EffectComposer, RenderPass, ShaderPass, OutputPass, RoomEnvironment, UnrealBloomPass, GTAOPass } from '../vendor/three.bundle.js';
import { setMaxAnisotropy } from './textures.js';

// glow: [strength, radius, threshold]; the threshold is in linear light before tone mapping, so only
// things brighter than a sunlit white wall (bulbs, flames, the sky through a window) glow
export const BLOOM = [0.5, 0.45, 2.4];

const TiltShiftShader = {
  uniforms: {
    tDiffuse: { value: null },
    dir: { value: new THREE.Vector2(1, 0) },
    focus: { value: 0.5 },
    band: { value: 0.22 },
    amount: { value: 1.0 },
    vignette: { value: 0 },
    aspect: { value: 1 },
    sat: { value: 1 },
    tint: { value: new THREE.Vector3(1, 1, 1) },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform vec2 dir; uniform float focus; uniform float band; uniform float amount; uniform float vignette; uniform float aspect; uniform float sat; uniform vec3 tint;
    varying vec2 vUv;
    void main(){
      float d = abs(vUv.y - focus);
      float b = smoothstep(band, band + 0.32, d) * amount;
      vec4 sum = texture2D(tDiffuse, vUv) * 0.2270270270;
      vec2 o1 = dir * 1.3846153846 * b, o2 = dir * 3.2307692308 * b;
      sum += texture2D(tDiffuse, vUv + o1) * 0.3162162162;
      sum += texture2D(tDiffuse, vUv - o1) * 0.3162162162;
      sum += texture2D(tDiffuse, vUv + o2) * 0.0702702703;
      sum += texture2D(tDiffuse, vUv - o2) * 0.0702702703;
      if (vignette > 0.0) {
        vec2 q = (vUv - 0.5) * vec2(aspect, 1.0);
        float v = 1.0 - vignette * smoothstep(0.35, 1.05, length(q));
        sum.rgb *= v;
      }
      // the grade: a little richer colour and the venue's tint of the light
      sum.rgb = max(mix(vec3(dot(sum.rgb, vec3(0.2126, 0.7152, 0.0722))), sum.rgb, sat), 0.0) * tint;
      gl_FragColor = sum;
    }`,
};

// Cheaper tilt-shift for Medium: one full-screen pass instead of two. A small two-ring disk of taps
// (centre, 4 inner, 8 outer) approximates the two-pass Gaussian closely enough at this blur size.
const TiltShiftDiskShader = {
  uniforms: {
    tDiffuse: { value: null },
    px: { value: new THREE.Vector2(0.001, 0.001) },
    focus: { value: 0.5 },
    band: { value: 0.22 },
    amount: { value: 1.0 },
    vignette: { value: 0.32 },
    aspect: { value: 1 },
    sat: { value: 1 },
    tint: { value: new THREE.Vector3(1, 1, 1) },
  },
  vertexShader: TiltShiftShader.vertexShader,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform vec2 px; uniform float focus; uniform float band; uniform float amount; uniform float vignette; uniform float aspect; uniform float sat; uniform vec3 tint;
    varying vec2 vUv;
    void main(){
      float d = abs(vUv.y - focus);
      float b = smoothstep(band, band + 0.32, d) * amount;
      vec2 r1 = px * 2.1 * b, r2 = px * 4.2 * b;
      vec4 sum = texture2D(tDiffuse, vUv) * 0.2;
      vec4 inner = texture2D(tDiffuse, vUv + vec2(r1.x, 0.0)) + texture2D(tDiffuse, vUv - vec2(r1.x, 0.0))
                 + texture2D(tDiffuse, vUv + vec2(0.0, r1.y)) + texture2D(tDiffuse, vUv - vec2(0.0, r1.y));
      vec2 a = r2 * 0.9238795, c = r2 * 0.3826834;
      vec4 outer = texture2D(tDiffuse, vUv + vec2(a.x, c.y)) + texture2D(tDiffuse, vUv + vec2(c.x, a.y))
                 + texture2D(tDiffuse, vUv + vec2(-c.x, a.y)) + texture2D(tDiffuse, vUv + vec2(-a.x, c.y))
                 + texture2D(tDiffuse, vUv - vec2(a.x, c.y)) + texture2D(tDiffuse, vUv - vec2(c.x, a.y))
                 + texture2D(tDiffuse, vUv - vec2(-c.x, a.y)) + texture2D(tDiffuse, vUv - vec2(-a.x, c.y));
      sum += inner * 0.12 + outer * 0.04;
      if (vignette > 0.0) {
        vec2 q = (vUv - 0.5) * vec2(aspect, 1.0);
        sum.rgb *= 1.0 - vignette * smoothstep(0.35, 1.05, length(q));
      }
      // the grade: a little richer colour and the venue's tint of the light
      sum.rgb = max(mix(vec3(dot(sum.rgb, vec3(0.2126, 0.7152, 0.0722))), sum.rgb, sat), 0.0) * tint;
      gl_FragColor = sum;
    }`,
};

// tilt: true/false keeps its meaning for world builders (false = Low); tiltMode picks the shader.
// bloom: glow around lights, fire and bright windows; ao: ambient occlusion (soft shading in corners
// and where things touch)
export const QUALITY = {
  high: { pr: 2, shadow: 4096, msaa: 4, tilt: true, tiltMode: 'two-pass', grass: 1, bloom: true, ao: true },
  medium: { pr: 1.35, shadow: 2048, msaa: 4, tilt: true, tiltMode: 'one-pass', grass: 0.7, bloom: true, ao: false },
  low: { pr: 1, shadow: 1024, msaa: 0, tilt: false, tiltMode: 'off', grass: 0.35, bloom: false, ao: false },
};

// Integrated graphics as named by WEBGL_debug_renderer_info (browsers may shorten the name).
const DEDICATED_GPU = /nvidia|geforce|quadro|rtx|gtx|radeon rx|radeon pro|arc a\d/i;
const INTEGRATED_GPU = /intel|iris|uhd graphics|hd graphics|radeon\(tm\) graphics|amd radeon graphics|radeon vega|radeon \d{3}m\b/i;

export class GameRenderer {
  constructor(canvas, quality = 'medium') {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    const r = this.renderer;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.info.autoReset = false; // render() resets once per frame, so stats cover shadow + scene + post passes
    this.renderScale = 1; // dynamic resolution (Auto quality) scales the pixel ratio by this
    this.gpu = readGpuName(r.getContext());
    setMaxAnisotropy(Math.min(8, r.capabilities.getMaxAnisotropy()));

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 16 / 9, 2, 4000);
    this.viewWidth = 80; // units visible across the screen centre
    this.focusCfg = [0.5, 0.22, 1];
    this.target = new THREE.Vector3();

    const pm = new THREE.PMREMGenerator(r);
    this.envTex = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    pm.dispose();
    this.scene.environment = this.envTex;

    this.hemi = new THREE.HemisphereLight(0xfff6e8, 0x6b5a48, 0.6);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.radius = 3;
    this.sunDir = new THREE.Vector3(-0.45, 1, -0.35).normalize();
    this.scene.add(this.sun, this.sun.target);
    this.shadowSpan = 150;

    this.quality = null;
    this.setQuality(quality);
    this.resize();
  }

  setQuality(q) {
    if (!QUALITY[q]) q = 'medium';
    this.qualityName = q;
    const Q = (this.quality = QUALITY[q]);
    this.applyPixelRatio();
    this.sun.shadow.mapSize.set(Q.shadow, Q.shadow);
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    const cam = this.sun.shadow.camera;
    cam.left = -this.shadowSpan / 2; cam.right = this.shadowSpan / 2;
    cam.top = this.shadowSpan / 2; cam.bottom = -this.shadowSpan / 2;
    cam.near = 1; cam.far = 1000; cam.updateProjectionMatrix();
    this.buildComposer();
  }

  // Device pixel ratio, capped by the preset, times the dynamic render scale.
  pixelRatioTarget() {
    return Math.max(0.5, Math.min(window.devicePixelRatio || 1, this.quality.pr) * this.renderScale);
  }

  applyPixelRatio() {
    const pr = this.pixelRatioTarget();
    this.renderer.setPixelRatio(pr);
    if (this.composer) { this.composer.setPixelRatio(pr); this.resize(); }
  }

  // Dynamic resolution: 0.6..1 of the preset's pixel ratio. Returns true if it changed.
  setRenderScale(s) {
    s = Math.round(Math.min(1, Math.max(0.6, s)) * 100) / 100;
    if (s === this.renderScale) return false;
    this.renderScale = s;
    this.applyPixelRatio();
    return true;
  }

  // Integrated graphics (Intel, AMD APU): used for the "switch to High performance" hint.
  gpuLooksIntegrated() {
    return !!this.gpu && INTEGRATED_GPU.test(this.gpu) && !DEDICATED_GPU.test(this.gpu);
  }

  // Compile every material in the scene (hidden ones too: ghost car, splashes, hazards), upload every
  // texture and render two frames, so a race does not stutter in its first seconds while the browser
  // builds shaders. Compiled against the post-processing target, as the race renders, so the cached
  // programs are the ones actually used. Async where the browser compiles shaders in parallel.
  async warmUp() {
    const r = this.renderer, scene = this.scene;
    const textures = new Set();
    const addTex = (v) => { if (v && v.isTexture && !v.isRenderTargetTexture) textures.add(v); };
    scene.traverse((o) => {
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) {
        for (const k in m) addTex(m[k]);
        if (m.uniforms) for (const k in m.uniforms) addTex(m.uniforms[k] && m.uniforms[k].value);
      }
    });
    for (const t of textures) { try { r.initTexture(t); } catch (e) { /* uploaded on first use instead */ } }
    const prev = r.getRenderTarget();
    r.setRenderTarget(this.composer.renderTarget1);
    try {
      if (r.compileAsync && r.extensions.has('KHR_parallel_shader_compile')) await r.compileAsync(scene, this.camera);
      else r.compile(scene, this.camera);
    } finally { r.setRenderTarget(prev); }
    // shadow-pass and post-processing programs are built by real frames
    this.composer.render();
    this.composer.render();
    // wait until the GPU has really done it (compiling, uploading, first draws), so that work is not
    // still queued up when the countdown starts
    const gl = r.getContext(), px = new Uint8Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return { textures: textures.size, programs: r.info.programs ? r.info.programs.length : 0 };
  }

  buildComposer() {
    const r = this.renderer;
    if (this.composer) this.composer.dispose();
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), { type: THREE.HalfFloatType, samples: this.quality.msaa });
    this.composer = new EffectComposer(r, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const w = Math.max(1, size.x), h = Math.max(1, size.y);
    this.ao = null; this.bloom = null;
    if (this.quality.ao) {
      this.ao = new GTAOPass(this.scene, this.camera, w, h);
      this.ao.updateGtaoMaterial({ radius: 6, distanceExponent: 1.4, thickness: 4, scale: 1.1, samples: 12 });
      this.ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      this.ao.blendIntensity = this.aoCfg ?? 0.85;
      this.composer.addPass(this.ao);
    }
    if (this.quality.bloom) {
      const [strength, radius, threshold] = this.bloomCfg || BLOOM;
      this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), strength, radius, threshold);
      this.composer.addPass(this.bloom);
    }
    this.tiltH = new ShaderPass(TiltShiftShader);
    this.tiltV = new ShaderPass(TiltShiftShader);
    this.tiltV.uniforms.vignette.value = 0.32;
    this.tiltX = new ShaderPass(TiltShiftDiskShader);
    const mode = this.quality.tiltMode;
    this.tiltH.enabled = this.tiltV.enabled = mode === 'two-pass';
    this.tiltX.enabled = mode === 'one-pass';
    this.composer.addPass(this.tiltH);
    this.composer.addPass(this.tiltV);
    this.composer.addPass(this.tiltX);
    this.composer.addPass(new OutputPass());
    this.setFocus(...this.focusCfg);
    this.setGrade(this.gradeCfg);
    this.resize();
  }

  // colour grade, applied in the last tilt-shift pass (Medium and High): saturation and an RGB tint
  setGrade({ sat = 1.1, tint = [1, 1, 1] } = {}) {
    this.gradeCfg = { sat, tint };
    for (const p of [this.tiltV, this.tiltX]) { if (!p) continue; p.uniforms.sat.value = sat; p.uniforms.tint.value.set(...tint); }
  }

  setLighting(cfg = {}) {
    if (cfg.sunColor != null) this.sun.color.set(cfg.sunColor);
    if (cfg.sunIntensity != null) this.sun.intensity = cfg.sunIntensity;
    if (cfg.sunDir) this.sunDir.set(...cfg.sunDir).normalize();
    if (cfg.hemiSky != null) this.hemi.color.set(cfg.hemiSky);
    if (cfg.hemiGround != null) this.hemi.groundColor.set(cfg.hemiGround);
    if (cfg.hemiIntensity != null) this.hemi.intensity = cfg.hemiIntensity;
    this.scene.environmentIntensity = cfg.envIntensity ?? 0.55;
    this.renderer.toneMappingExposure = cfg.exposure ?? 1.0;
    this.scene.background = new THREE.Color(cfg.background ?? 0x2a2420);
    this.scene.fog = cfg.fog ? new THREE.Fog(cfg.fog.color, cfg.fog.near, cfg.fog.far) : null;
    this.shadowRadius = cfg.shadowRadius ?? 3;
    this.sun.shadow.radius = this.shadowRadius;
    // venues can tune the glow: [strength, radius, threshold], and how strong ambient occlusion is
    this.bloomCfg = cfg.bloom || BLOOM;
    if (this.bloom) [this.bloom.strength, this.bloom.radius, this.bloom.threshold] = this.bloomCfg;
    this.setGrade(cfg.grade);
    this.aoCfg = cfg.ao ?? 0.85;
    if (this.ao) this.ao.blendIntensity = this.aoCfg;
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setSize(w, h);
      const pr = this.renderer.getPixelRatio();
      const px = 1 / (w * pr), py = 1 / (h * pr);
      // blur radius in pixels at full strength scales with resolution
      const k = Math.max(1, (h * pr) / 900) * 2.2;
      this.tiltH.uniforms.dir.value.set(px * k, 0);
      this.tiltV.uniforms.dir.value.set(0, py * k);
      this.tiltV.uniforms.aspect.value = w / h;
      this.tiltX.uniforms.px.value.set(px * k, py * k);
      this.tiltX.uniforms.aspect.value = w / h;
    }
  }

  // Distance needed so `width` table units fill the screen width at the target.
  distanceForWidth(width) {
    const vfov = THREE.MathUtils.degToRad(this.camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
    return width / 2 / Math.tan(hfov / 2);
  }

  // Camera that looks at (tx, ty, tz) from a direction given by yaw (around y, 0 = from +z) and pitch
  // (above the horizon), at the distance that makes `width` units fill the screen width.
  // The shadow frustum follows the target. `shadowSpan` (units) sets how much ground gets shadows.
  orbit(tx, ty, tz, { yaw = 0, pitch = 0.5, width = this.viewWidth, shadowSpan = null } = {}) {
    this.target.set(tx, ty, tz);
    const d = this.distanceForWidth(width);
    const cp = Math.cos(pitch);
    this.camera.position.set(tx + d * cp * Math.sin(yaw), ty + d * Math.sin(pitch), tz + d * cp * Math.cos(yaw));
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
    this.followShadow(tx, ty, tz, shadowSpan ?? Math.max(this.shadowSpan, width * 1.6));
  }

  // Free camera: position and target given directly.
  look(px, py, pz, tx, ty, tz, shadowSpan = null) {
    this.target.set(tx, ty, tz);
    this.camera.position.set(px, py, pz);
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
    const d = this.camera.position.distanceTo(this.target);
    this.followShadow(tx, ty, tz, shadowSpan ?? Math.max(this.shadowSpan, d * 1.2));
  }

  // keep the shadow frustum centred on what we see, snapped to texels to avoid shimmer
  followShadow(tx, ty, tz, span) {
    span = Math.ceil(span / 10) * 10;
    const c = this.sun.shadow.camera;
    if (Math.abs(span - c.right * 2) > 1) {
      c.left = -span / 2; c.right = span / 2; c.top = span / 2; c.bottom = -span / 2; c.updateProjectionMatrix();
    }
    const texel = span / this.sun.shadow.mapSize.x;
    const cx = Math.round(tx / texel) * texel, cz = Math.round(tz / texel) * texel;
    this.sun.target.position.set(cx, ty, cz);
    this.sun.position.set(cx + this.sunDir.x * 400, ty + this.sunDir.y * 400, cz + this.sunDir.z * 400);
    this.sun.target.updateMatrixWorld();
  }

  // tilt-shift: screen height (0 bottom .. 1 top) that stays sharp, and how wide the sharp band is
  setFocus(focus = 0.5, band = 0.22, amount = 1) {
    this.focusCfg = [focus, band, amount];
    for (const p of [this.tiltH, this.tiltV, this.tiltX]) {
      if (!p) continue;
      p.uniforms.focus.value = focus; p.uniforms.band.value = band; p.uniforms.amount.value = amount;
    }
  }

  // Normalised screen position (-1..1) of a world point.
  project(x, y, z, out = new THREE.Vector3()) {
    out.set(x, y, z).project(this.camera);
    return out;
  }

  // `shake` (table units, set by the game after big crashes) nudges the camera for this frame only,
  // so gameplay checks that use the camera (who is on screen) never see it.
  render() {
    this.renderer.info.reset();
    const s = this.shake || 0;
    if (s > 0.01) {
      const cam = this.camera, t = performance.now() / 1000;
      const ox = s * (Math.sin(t * 61.3) * 0.6 + Math.sin(t * 37.1 + 2.1) * 0.4);
      const oz = s * (Math.sin(t * 53.7 + 1.3) * 0.6 + Math.sin(t * 29.3 + 0.4) * 0.4);
      cam.position.x += ox; cam.position.z += oz; cam.updateMatrixWorld();
      this.composer.render();
      cam.position.x -= ox; cam.position.z -= oz; cam.updateMatrixWorld();
      return;
    }
    this.composer.render();
  }
}

function readGpuName(gl) {
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    // ANGLE wraps the name: "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Laptop GPU (0x...) Direct3D11 ...)"
    const m = /^ANGLE \((?:[^,]*), ([^(,]+)/.exec(name || '');
    return (m ? m[1] : String(name || '')).trim();
  } catch (e) { return ''; }
}
