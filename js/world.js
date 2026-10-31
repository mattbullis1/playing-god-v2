import * as THREE from 'three';
import { EffectComposer } from './vendor/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from './vendor/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './vendor/jsm/postprocessing/OutputPass.js';

const R = 10;
const UP = new THREE.Vector3(0, 1, 0);
const TAU = Math.PI * 2;

const YOUNG = new THREE.Color('#17b78f');
const MATURE = new THREE.Color('#7af2c9');
const DEAD_TILE = new THREE.Color('#07191d');
const SCORCH = new THREE.Color('#2a1a12');
const INFECT = new THREE.Color('#ff3648');
const BURNING = new THREE.Color('#ff8a2b');
const SUBMERGED = new THREE.Color('#1d4f9e');
const FAMINE = new THREE.Color('#c79a52');
const WAR_A = new THREE.Color('#ff4d61');
const WAR_B = new THREE.Color('#4d8dff');

function starTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(210,255,245,0.75)');
  g.addColorStop(1, 'rgba(120,255,230,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class World {
  constructor(canvas, life, fx) {
    this.canvas = canvas;
    this.life = life;
    this.fx = fx;
    this.n = life.n;

    this.time = 0;
    this.aliveList = [];
    this.heights = new Float32Array(this.n);
    this.deadHeights = new Float32Array(this.n).fill(0.02);
    this.slot = new Int32Array(this.n).fill(-1);
    this.quats = new Float32Array(this.n * 4);
    this.tileShade = new Float32Array(this.n);
    this.normals = life.positions;

    this.shake = 0;
    this.shakeMax = 0;
    this.shakeSeed = Math.random() * 100;
    this.arcTimer = 0;
    this.explodeTimer = 0;
    this.emberTimer = 0;
    this.floodVisual = 0;
    this.famineVisual = 0;

    this._dummy = new THREE.Object3D();
    this._color = new THREE.Color();
    this._v = new THREE.Vector3();

    this._initRenderer();
    this._initScene();
    this._initPlanet();
    this._initCells();
    this._initWater();
    this._initParticles();
    this._initEffects();
    this._initArchitecture();
    this._bindControls();
    this.resize();
  }

  /* ---------------------------------------------------------------- setup */

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
    this.renderer.setClearColor(0x02070a, 1);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.localClippingEnabled = true;
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x02070a, 0.0065);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 500);

    this.scene.add(new THREE.AmbientLight(0x63b7ad, 0.5));
    const key = new THREE.DirectionalLight(0xd8fff4, 1.7);
    key.position.set(9, 14, 7);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x2f7fff, 0.9);
    rim.position.set(-12, -4, -8);
    this.scene.add(rim);
    const warm = new THREE.PointLight(0xffb45e, 40, 80, 2);
    warm.position.set(14, -8, 12);
    this.scene.add(warm);
    this.warmLight = warm;

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.5, 0.4, 0.68);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.planet = new THREE.Group();
    this.scene.add(this.planet);

    this._atmoTarget = new THREE.Color(0x36e8cf);
    this._warmTarget = new THREE.Color(0xffb45e);

    this._initStars();
    this._initRings();
  }

  _initStars() {
    const count = 2400;
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const r = 55 + Math.random() * 110;
      const u = Math.random() * 2 - 1;
      const phi = Math.random() * TAU;
      const s = Math.sqrt(1 - u * u);
      pos[i * 3] = Math.cos(phi) * s * r;
      pos[i * 3 + 1] = u * r;
      pos[i * 3 + 2] = Math.sin(phi) * s * r;
      const warm = Math.random();
      c.setHSL(warm > 0.85 ? 0.09 : 0.46 + Math.random() * 0.06, 0.35 + Math.random() * 0.4, 0.55 + Math.random() * 0.4);
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.9,
      map: starTexture(),
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
      opacity: 0.9,
    });
    this.stars = new THREE.Points(geo, mat);
    this.scene.add(this.stars);
  }

  _initRings() {
    const ringGeo = new THREE.TorusGeometry(R * 1.32, 0.013, 6, 220);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x49e6c0,
      transparent: true,
      opacity: 0.26,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.ringA = new THREE.Mesh(ringGeo, ringMat);
    this.ringA.rotation.set(Math.PI / 2.35, 0.28, 0.14);
    this.planet.add(this.ringA);

    const geoB = new THREE.TorusGeometry(R * 1.52, 0.008, 6, 220);
    this.ringB = new THREE.Mesh(
      geoB,
      new THREE.MeshBasicMaterial({
        color: 0xffc76b,
        transparent: true,
        opacity: 0.14,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.ringB.rotation.set(Math.PI / 1.85, -0.3, 0.22);
    this.planet.add(this.ringB);

    this.satellites = [];
    const satGeo = new THREE.SphereGeometry(0.055, 8, 8);
    for (let i = 0; i < 3; i++) {
      const sat = new THREE.Mesh(
        satGeo,
        new THREE.MeshBasicMaterial({ color: i === 0 ? 0xffd88a : 0x7dffe0 })
      );
      sat.userData.orbit = R * (1.32 + i * 0.1);
      sat.userData.speed = 0.16 + i * 0.07;
      sat.userData.phase = i * 2.1;
      sat.userData.tilt = 0.24 + i * 0.2;
      this.scene.add(sat);
      this.satellites.push(sat);
    }

    // dust belt
    const dustCount = 420;
    const dp = new Float32Array(dustCount * 3);
    for (let i = 0; i < dustCount; i++) {
      const a = Math.random() * TAU;
      const rad = R * (1.42 + Math.random() * 0.3);
      dp[i * 3] = Math.cos(a) * rad;
      dp[i * 3 + 1] = (Math.random() - 0.5) * 0.5;
      dp[i * 3 + 2] = Math.sin(a) * rad;
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(dp, 3));
    this.dust = new THREE.Points(
      dg,
      new THREE.PointsMaterial({
        color: 0x8ff5d9,
        size: 0.09,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    this.dust.rotation.x = 0.3;
    this.scene.add(this.dust);
  }

  _initPlanet() {
    const baseGeo = new THREE.SphereGeometry(R * 0.998, 96, 64);
    const baseMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec3 vN;
        varying vec3 vP;
        void main(){
          vN = normalize(mat3(modelMatrix) * normal);
          vP = (modelMatrix * vec4(position,1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying vec3 vN;
        varying vec3 vP;
        void main(){
          vec3 viewDir = normalize(cameraPosition - vP);
          float fres = pow(1.0 - max(dot(vN, viewDir), 0.0), 2.4);
          float band = sin(vP.y * 2.1 + sin(vP.x * 1.7) * 1.4 + uTime * 0.04) * 0.5 + 0.5;
          vec3 deep = vec3(0.006, 0.030, 0.038);
          vec3 shallow = vec3(0.012, 0.072, 0.082);
          vec3 col = mix(deep, shallow, band * 0.65);
          col += vec3(0.06, 0.55, 0.48) * fres * 0.16;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.baseSphere = new THREE.Mesh(baseGeo, baseMat);
    this.baseMat = baseMat;
    this.planet.add(this.baseSphere);

    // fine latitude wireframe for scale
    const grid = new THREE.SphereGeometry(R * 1.002, 48, 28);
    const wire = new THREE.MeshBasicMaterial({
      color: 0x4ce7c3,
      wireframe: true,
      transparent: true,
      opacity: 0.035,
      depthWrite: false,
    });
    this.grid = new THREE.Mesh(grid, wire);
    this.planet.add(this.grid);

    // atmosphere
    const atmoMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0x36e8cf) } },
      vertexShader: /* glsl */ `
        varying vec3 vN;
        varying vec3 vV;
        void main(){
          vN = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position,1.0);
          vV = -mv.xyz;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying vec3 vN;
        varying vec3 vV;
        void main(){
          float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.6);
          gl_FragColor = vec4(uColor * rim * 0.75, rim * 0.42);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      depthWrite: false,
    });
    this.atmo = new THREE.Mesh(new THREE.SphereGeometry(R * 1.09, 64, 48), atmoMat);
    this.planet.add(this.atmo);
  }

  _initCells() {
    const n = this.n;
    const geo = new THREE.CylinderGeometry(0.405, 0.405, 1, 6, 1, false);
    geo.computeVertexNormals();

    const lightDir = new THREE.Vector3(0.55, 0.75, 0.35).normalize();
    this.tileMat = new THREE.MeshBasicMaterial();
    this.tiles = new THREE.InstancedMesh(geo, this.tileMat, n);
    this.tiles.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    this.tiles.frustumCulled = false;
    this.planet.add(this.tiles);

    this.lifeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.lifeMat.toneMapped = false;
    this.cells = new THREE.InstancedMesh(geo, this.lifeMat, n);
    this.cells.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.cells.frustumCulled = false;
    this.cells.count = 0;
    this.planet.add(this.cells);

    // allocate instance colors
    this.tiles.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    this.cells.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    this.cells.instanceColor.setUsage(THREE.DynamicDrawUsage);

    const q = new THREE.Quaternion();
    const normal = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      normal.set(this.normals[i * 3], this.normals[i * 3 + 1], this.normals[i * 3 + 2]);
      q.setFromUnitVectors(UP, normal);
      this.quats[i * 4] = q.x;
      this.quats[i * 4 + 1] = q.y;
      this.quats[i * 4 + 2] = q.z;
      this.quats[i * 4 + 3] = q.w;

      this._dummy.position.copy(normal).multiplyScalar(R + 0.008);
      this._dummy.quaternion.copy(q);
      this._dummy.scale.set(1, 0.018, 1);
      this._dummy.updateMatrix();
      this.tiles.setMatrixAt(i, this._dummy.matrix);

      const shade = 0.72 + Math.random() * 0.42;
      this._color.copy(DEAD_TILE).multiplyScalar(shade);
      this.tiles.setColorAt(i, this._color);
      const dot = this.normals[i * 3] * lightDir.x + this.normals[i * 3 + 1] * lightDir.y + this.normals[i * 3 + 2] * lightDir.z;
      this.tileShade[i] = 0.62 + Math.max(0, dot) * 0.42 + Math.random() * 0.08;
    }
    this.tiles.instanceMatrix.needsUpdate = true;
    this.tiles.instanceColor.needsUpdate = true;
    this.refreshCells();
  }

  _initWater() {
    this.floodPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x1a63ff,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      clippingPlanes: [this.floodPlane],
    });
    this.water = new THREE.Mesh(new THREE.SphereGeometry(R * 1.035, 72, 48), mat);
    this.water.visible = false;
    this.planet.add(this.water);

    const wireMat = new THREE.MeshBasicMaterial({
      color: 0x7fc4ff,
      wireframe: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      clippingPlanes: [this.floodPlane],
    });
    this.waterWire = new THREE.Mesh(new THREE.SphereGeometry(R * 1.04, 40, 26), wireMat);
    this.waterWire.visible = false;
    this.planet.add(this.waterWire);
  }

  _initParticles() {
    const MAX = 1200;
    this.pMax = MAX;
    this.pPos = new Float32Array(MAX * 3);
    this.pCol = new Float32Array(MAX * 3);
    this.pSize = new Float32Array(MAX);
    this.pAlpha = new Float32Array(MAX);
    this.pVel = new Float32Array(MAX * 3);
    this.pLife = new Float32Array(MAX);
    this.pMaxLife = new Float32Array(MAX);
    this.pCursor = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.pSize, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.pAlpha, 1).setUsage(THREE.DynamicDrawUsage));

    const mat = new THREE.ShaderMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {},
      vertexShader: /* glsl */ `
        attribute float aSize;
        attribute float aAlpha;
        varying float vA;
        varying vec3 vC;
        void main(){
          vA = aAlpha;
          vC = color;
          vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = aSize * (280.0 / max(-mv.z, 1.0));
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vA;
        varying vec3 vC;
        void main(){
          float d = length(gl_PointCoord - 0.5);
          if (d > 0.5) discard;
          float a = smoothstep(0.5, 0.02, d) * vA;
          gl_FragColor = vec4(vC, a);
        }
      `,
    });
    this.particles = new THREE.Points(geo, mat);
    this.particles.frustumCulled = false;
    this.scene.add(this.particles);
  }

  _initEffects() {
    this.rings = [];
    const ringGeo = new THREE.RingGeometry(0.93, 1, 72);
    for (let i = 0; i < 14; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(ringGeo, mat);
      mesh.visible = false;
      this.scene.add(mesh);
      this.rings.push({ mesh, t: 0, dur: 1, delay: 0, max: 3, active: false });
    }

    const crackMat = new THREE.LineBasicMaterial({
      color: 0xffa658,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const crackGeo = new THREE.BufferGeometry();
    crackGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9 * 6 * 2 * 3), 3));
    this.cracks = new THREE.LineSegments(crackGeo, crackMat);
    this.cracks.frustumCulled = false;
    this.cracks.visible = false;
    this.planet.add(this.cracks);
    this.crackTime = 99;

    // war projectiles
    this.arcs = [];
    const arcGeo = new THREE.SphereGeometry(0.07, 8, 8);
    for (let i = 0; i < 12; i++) {
      const mesh = new THREE.Mesh(arcGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }));
      mesh.visible = false;
      this.scene.add(mesh);
      this.arcs.push({ mesh, t: 0, dur: 1, active: false, start: new THREE.Vector3(), mid: new THREE.Vector3(), end: new THREE.Vector3() });
    }
  }

  /* ------------------------------------------------------------- controls */

  _bindControls() {
    this.theta = 0.72;
    this.phi = 1.16;
    this.dist = 35;
    this.targetTheta = this.theta;
    this.targetPhi = this.phi;
    this.targetDist = this.dist;
    this.dragging = false;
    this.moved = 0;
    this.lastX = 0;
    this.lastY = 0;
    this.idle = 99;

    const el = this.canvas;
    el.style.touchAction = 'none';

    el.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.moved = 0;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.idle = 0;
      el.setPointerCapture(e.pointerId);
      el.classList.add('grabbing');
    });

    el.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.moved += Math.abs(dx) + Math.abs(dy);
      this.targetTheta -= dx * 0.006;
      this.targetPhi = Math.max(0.22, Math.min(2.94, this.targetPhi - dy * 0.005));
      this.idle = 0;
    });

    const end = (e) => {
      if (!this.dragging) return;
      this.dragging = false;
      el.classList.remove('grabbing');
      if (this.moved < 7) this.paintAt(e.clientX, e.clientY);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', () => {
      this.dragging = false;
      el.classList.remove('grabbing');
    });

    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.targetDist = Math.max(16, Math.min(46, this.targetDist + e.deltaY * 0.014));
        this.idle = 0;
      },
      { passive: false }
    );
  }

  paintAt(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hit = ray.intersectObject(this.baseSphere, false)[0];
    if (!hit) return -1;
    const p = hit.point.clone().normalize();
    let best = -1;
    let bestDot = -2;
    for (let i = 0; i < this.n; i++) {
      const d =
        p.x * this.normals[i * 3] +
        p.y * this.normals[i * 3 + 1] +
        p.z * this.normals[i * 3 + 2];
      if (d > bestDot) {
        bestDot = d;
        best = i;
      }
    }
    if (best >= 0) {
      this.life.toggle(best);
      if (this.life.alive[best]) this.life.age[best] = 1;
      this.refreshCells();
      return best;
    }
    return -1;
  }

  /* ------------------------------------------------------------- geometry */

  refreshCells() {
    const alive = this.life.alive;
    this.aliveList.length = 0;
    this.slot.fill(-1);
    let k = 0;
    for (let i = 0; i < this.n; i++) {
      if (alive[i]) {
        this.aliveList.push(i);
        this.slot[i] = k;
        this.heights[i] = Math.max(this.heights[i], 0.06);
        k++;
      } else {
        this.heights[i] = 0;
      }
    }
    this.cells.count = this.aliveList.length;
    this.cells.instanceColor.needsUpdate = true;
    this._paintDeadTiles();
  }

  _paintDeadTiles() {
    const fx = this.fx;
    const flood = this.fx.flood || {};
    const axis = flood.axis;
    const level = flood.level || 0;
    for (let i = 0; i < this.n; i++) {
      if (this.life.alive[i]) continue;
      this._color.copy(DEAD_TILE).multiplyScalar(this.tileShade[i]);
      if (fx.scorch[i] > 0) {
        this._color.lerp(SCORCH, Math.min(1, fx.scorch[i]) * 0.85);
      }
      if (fx.heat[i] > 0) {
        this._color.lerp(INFECT, Math.min(0.5, fx.heat[i] * 0.35));
      }
      if (flood.active && axis) {
        const dot = this.normals[i * 3] * axis.x + this.normals[i * 3 + 1] * axis.y + this.normals[i * 3 + 2] * axis.z;
        if (dot > level) this._color.lerp(SUBMERGED, 0.8);
      }
      this.tiles.setColorAt(i, this._color);
    }
    this.tiles.instanceColor.needsUpdate = true;
  }

  _updateAliveCells(dt) {
    const fx = this.fx;
    const count = this.aliveList.length;
    if (!count) return;
    const t = this.time;
    for (let k = 0; k < count; k++) {
      const i = this.aliveList[k];
      const age = Math.min(this.life.age[i], 10);
      const target = 0.1 + Math.min(age, 8) * 0.02;
      const h = (this.heights[i] += (target - this.heights[i]) * Math.min(1, dt * 5));

      this._dummy.position.set(
        this.normals[i * 3] * (R + 0.02 + h * 0.5),
        this.normals[i * 3 + 1] * (R + 0.02 + h * 0.5),
        this.normals[i * 3 + 2] * (R + 0.02 + h * 0.5)
      );
      this._dummy.quaternion.set(
        this.quats[i * 4],
        this.quats[i * 4 + 1],
        this.quats[i * 4 + 2],
        this.quats[i * 4 + 3]
      );
      this._dummy.scale.set(1, h, 1);
      this._dummy.updateMatrix();
      this.cells.setMatrixAt(k, this._dummy.matrix);

      const fresh = Math.min(1, age / 9);
      this._color.copy(YOUNG).lerp(MATURE, fresh);

      if (fx.famine > 0) this._color.lerp(FAMINE, fx.famine * 0.55);

      if (fx.faction[i] !== 0) {
        this._color.lerp(fx.faction[i] > 0 ? WAR_A : WAR_B, 0.5);
      }

      const heat = fx.heat[i];
      if (heat > 0.02) {
        this._color.lerp(INFECT, Math.min(0.92, heat * 0.9));
        this._color.multiplyScalar(0.85 + Math.sin(t * 7 + i) * 0.16);
      }
      const fire = fx.fire[i];
      if (fire > 0) {
        this._color.lerp(BURNING, Math.min(0.95, 0.35 + fire * 0.6));
        this._color.multiplyScalar(0.9 + Math.sin(t * 11 + i * 1.7) * 0.3);
      }
      const flood = fx.flood;
      if (flood && flood.active && flood.axis) {
        const dot =
          this.normals[i * 3] * flood.axis.x +
          this.normals[i * 3 + 1] * flood.axis.y +
          this.normals[i * 3 + 2] * flood.axis.z;
        if (dot > flood.level) this._color.lerp(SUBMERGED, 0.75);
      }

      this.cells.setColorAt(k, this._color);
    }
    this.cells.instanceMatrix.needsUpdate = true;
    this.cells.instanceColor.needsUpdate = true;
  }

  /* --------------------------------------------------------------- effects */

  spawnParticles(origin, colorHex, count, opts = {}) {
    const {
      speed = 1.6,
      size = 2.2,
      life = 1.2,
      spread = 1,
      outward = true,
      gravity = 0,
    } = opts;
    const c = new THREE.Color(colorHex);
    const base = new THREE.Vector3(origin.x, origin.y, origin.z);
    for (let i = 0; i < count; i++) {
      const idx = this.pCursor;
      this.pCursor = (this.pCursor + 1) % this.pMax;
      const dir = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
      if (dir.lengthSq() < 0.01) dir.set(1, 0, 0);
      dir.normalize();
      if (outward) {
        const radial = base.clone().normalize();
        dir.multiplyScalar(spread).add(radial).normalize();
      }
      const sp = speed * (0.4 + Math.random() * 0.8);
      this.pPos[idx * 3] = base.x + dir.x * 0.12;
      this.pPos[idx * 3 + 1] = base.y + dir.y * 0.12;
      this.pPos[idx * 3 + 2] = base.z + dir.z * 0.12;
      this.pVel[idx * 3] = dir.x * sp;
      this.pVel[idx * 3 + 1] = dir.y * sp + gravity;
      this.pVel[idx * 3 + 2] = dir.z * sp;
      this.pCol[idx * 3] = c.r;
      this.pCol[idx * 3 + 1] = c.g;
      this.pCol[idx * 3 + 2] = c.b;
      const s = size * (0.5 + Math.random());
      this.pSize[idx] = s;
      this.pAlpha[idx] = 1;
      this.pLife[idx] = this.pMaxLife[idx] = life * (0.55 + Math.random() * 0.9);
    }
  }

  spawnRing(normal, colorHex, maxRadius, duration = 1.2, delay = 0, thickness = 1) {
    const slot = this.rings.find((r) => !r.active);
    if (!slot) return;
    slot.active = true;
    slot.t = -delay;
    slot.dur = duration;
    slot.max = maxRadius;
    slot.mesh.visible = delay <= 0;
    slot.mesh.material.color.set(colorHex);
    slot.mesh.material.opacity = 0;
    slot.mesh.position.copy(normal).multiplyScalar(R + 0.12);
    slot.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal.clone().normalize());
    slot.mesh.scale.setScalar(0.02 * thickness);
  }

  quake(normal, severity = 0.6) {
    const n = normal.clone().normalize();
    this.shakeMax = 0.22 + severity * 0.55;
    this.shake = 1.4 + severity * 1.8;
    for (let i = 0; i < 3; i++) {
      this.spawnRing(n, i === 0 ? 0xffd18a : 0xff9a4d, 2.6 + severity * 3.4, 1.5 + i * 0.25, i * 0.16);
    }
    this._makeCracks(n);
    const p = n.clone().multiplyScalar(R);
    this.spawnParticles(p, 0xd9c2a0, 46 + Math.round(severity * 60), {
      speed: 1.4 + severity,
      size: 2.6,
      life: 1.4,
      spread: 1.2,
    });
    this.spawnParticles(p, 0xffb066, 20, { speed: 2.2, size: 2, life: 0.8, spread: 1.4 });
  }

  _makeCracks(normal) {
    const pos = this.cracks.geometry.attributes.position;
    let v = 0;
    const tangent = new THREE.Vector3(1, 0, 0);
    if (Math.abs(normal.dot(tangent)) > 0.9) tangent.set(0, 1, 0);
    tangent.crossVectors(normal, tangent).normalize();
    const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize();

    for (let b = 0; b < 8; b++) {
      const ang = Math.random() * TAU;
      const dir = tangent
        .clone()
        .multiplyScalar(Math.cos(ang))
        .add(bitangent.clone().multiplyScalar(Math.sin(ang)))
        .normalize();
      let p = normal.clone().multiplyScalar(R + 0.045);
      let d = dir.clone();
      const steps = 5 + ((Math.random() * 3) | 0);
      for (let s = 0; s < steps; s++) {
        const next = p.clone().add(d.clone().multiplyScalar(0.32 + Math.random() * 0.3)).normalize().multiplyScalar(R + 0.045);
        pos.array[v++] = p.x; pos.array[v++] = p.y; pos.array[v++] = p.z;
        pos.array[v++] = next.x; pos.array[v++] = next.y; pos.array[v++] = next.z;
        p = next;
        d.add(tangent.clone().multiplyScalar((Math.random() - 0.5) * 0.7)).normalize();
      }
    }
    // zero the rest
    for (let i = v; i < pos.array.length; i++) pos.array[i] = 0;
    pos.needsUpdate = true;
    this.crackTime = 0;
    this.cracks.visible = true;
  }

  setFlood(active, axis, level) {
    this.floodVisual += ((active ? 1 : 0) - this.floodVisual) * 0.05;
    this.water.visible = this.floodVisual > 0.01;
    this.waterWire.visible = this.water.visible;
    this.water.material.opacity = this.floodVisual * 0.34;
    this.waterWire.material.opacity = this.floodVisual * 0.12;
    if (axis) {
      this.floodPlane.normal.set(axis.x, axis.y, axis.z).normalize();
      this.floodPlane.constant = -level * R;
    }
    this.water.scale.setScalar(1 + this.floodVisual * 0.01 + Math.sin(this.time * 1.5) * 0.003);
    this.waterWire.scale.copy(this.water.scale);
    if (this.water.visible) this.water.rotation.y = this.time * 0.04;
  }

  setFaction(faction) {
    this.fx.faction = faction;
  }

  /* --------------------------------------------------------------- update */

  update(dt) {
    this.time += dt;
    this.baseMat.uniforms.uTime.value = this.time;
    this.grid.rotation.y = this.time * 0.01;
    this.ringA.rotation.z += dt * 0.02;
    this.ringB.rotation.z -= dt * 0.014;
    this.dust.rotation.y += dt * 0.012;

    // camera inertia
    this.idle += dt;
    if (this.idle > 4 && !this.dragging) this.targetTheta += dt * 0.045;
    this.theta += (this.targetTheta - this.theta) * Math.min(1, dt * 7);
    this.phi += (this.targetPhi - this.phi) * Math.min(1, dt * 7);
    this.dist += (this.targetDist - this.dist) * Math.min(1, dt * 6);
    const spherical = new THREE.Spherical(this.dist, this.phi, this.theta);
    this.camera.position.setFromSpherical(spherical);
    this.camera.lookAt(0, 0, 0);

    // satellites
    for (const sat of this.satellites) {
      const a = this.time * sat.userData.speed + sat.userData.phase;
      sat.position.set(
        Math.cos(a) * sat.userData.orbit,
        Math.sin(a * 2) * sat.userData.orbit * 0.12 * sat.userData.tilt,
        Math.sin(a) * sat.userData.orbit
      );
      sat.position.applyAxisAngle(new THREE.Vector3(0.2, 0, 0.15), sat.userData.tilt);
    }

    // planet shake
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt);
      const k = (this.shake / this.shakeMax) * (0.6 + 0.4 * Math.sin(this.time * 43));
      const amp = this.shakeMax * Math.min(1, this.shake) * 0.6;
      this.planet.position.set(
        Math.sin(this.time * 61 + this.shakeSeed) * amp * 0.6,
        Math.cos(this.time * 53 + this.shakeSeed) * amp * 0.45,
        Math.sin(this.time * 47) * amp * 0.3
      );
      this.planet.rotation.z = Math.sin(this.time * 37) * amp * 0.012 * k;
    } else {
      this.planet.position.multiplyScalar(0.85);
      this.planet.rotation.z *= 0.85;
    }

    this._updateAliveCells(dt);
    if (this.fx.dirtyDead) {
      this._paintDeadTiles();
      this.fx.dirtyDead = false;
    }

    // rings
    for (const r of this.rings) {
      if (!r.active) continue;
      r.t += dt;
      if (r.t < 0) continue;
      if (!r.mesh.visible) r.mesh.visible = true;
      const p = Math.min(1, r.t / r.dur);
      const s = 0.25 + p * r.max;
      r.mesh.scale.setScalar(s);
      r.mesh.material.opacity = (1 - p) * (1 - p) * 0.85;
      if (p >= 1) {
        r.active = false;
        r.mesh.visible = false;
      }
    }

    // cracks fade
    if (this.crackTime < 6) {
      this.crackTime += dt;
      this.cracks.material.opacity = Math.max(0, 1 - this.crackTime / 3.2) * 0.9;
      if (this.crackTime > 3.4) this.cracks.visible = false;
    }

    // particles
    let anyParticle = false;
    for (let i = 0; i < this.pMax; i++) {
      if (this.pLife[i] <= 0) {
        this.pAlpha[i] = 0;
        continue;
      }
      anyParticle = true;
      this.pLife[i] -= dt;
      this.pPos[i * 3] += this.pVel[i * 3] * dt;
      this.pPos[i * 3 + 1] += this.pVel[i * 3 + 1] * dt;
      this.pPos[i * 3 + 2] += this.pVel[i * 3 + 2] * dt;
      this.pVel[i * 3] *= 1 - dt * 0.9;
      this.pVel[i * 3 + 1] *= 1 - dt * 0.9;
      this.pVel[i * 3 + 2] *= 1 - dt * 0.9;
      const f = Math.max(0, this.pLife[i] / this.pMaxLife[i]);
      this.pAlpha[i] = f * f;
    }
    if (anyParticle) {
      const g = this.particles.geometry.attributes;
      g.position.needsUpdate = true;
      g.aAlpha.needsUpdate = true;
    }

    this._updateDisasterVisuals(dt);
  }

  _updateDisasterVisuals(dt) {
    const fx = this.fx;

    let atmo = 0x36e8cf;
    let warm = 0xffb45e;
    if (fx.plague > 0) {
      atmo = 0xff4b5c;
      warm = 0xff5a4d;
    } else if (fx.war && fx.war.active) {
      atmo = 0xff7a6b;
      warm = 0xff6a4d;
    } else if (fx.flood && (fx.flood.active || fx.flood.level < 0.995)) {
      atmo = 0x4d9cff;
      warm = 0x6aa8ff;
    } else if (fx.famine > 0) {
      atmo = 0xc79a52;
      warm = 0xd09a52;
    }
    this._atmoTarget.setHex(atmo);
    this._warmTarget.setHex(warm);
    this.atmo.material.uniforms.uColor.value.lerp(this._atmoTarget, Math.min(1, dt * 1.8));
    this.warmLight.color.lerp(this._warmTarget, Math.min(1, dt * 1.8));
    this.bloom.strength = this.glowBase * (fx.famine > 0 ? 0.62 : 1);

    // wildfire embers and smoke
    for (let i = 0; i < this.n; i += 3) {
      if (fx.fire[i] > 0.2 && Math.random() < 0.07) {
        const p = new THREE.Vector3(
          this.normals[i * 3] * R,
          this.normals[i * 3 + 1] * R,
          this.normals[i * 3 + 2] * R
        );
        if (Math.random() < 0.55) {
          this.spawnParticles(p, 0xff8a2b, 1, { speed: 1.5, size: 2.4, life: 1.3, spread: 0.5 });
        } else {
          this.spawnParticles(p, 0x6d7a72, 1, { speed: 0.9, size: 4.6, life: 2.2, spread: 0.5 });
        }
      }
    }

    // war projectiles & impacts
    if (fx.war && fx.war.active) {
      this.arcTimer -= dt;
      this.explodeTimer -= dt;
      if (this.arcTimer <= 0) {
        this.arcTimer = 0.18 + Math.random() * 0.3;
        this._spawnArc();
      }
      if (this.explodeTimer <= 0) {
        this.explodeTimer = 0.5 + Math.random() * 0.5;
        this._warImpact();
      }
    }
  }

  _spawnArc() {
    const slot = this.arcs.find((a) => !a.active);
    if (!slot) return;
    const axis = new THREE.Vector3(this.fx.war.axis.x, this.fx.war.axis.y, this.fx.war.axis.z).normalize();
    // pick a point near the front
    let idx = -1;
    for (let tries = 0; tries < 40; tries++) {
      const j = (Math.random() * this.n) | 0;
      const dot =
        this.normals[j * 3] * axis.x +
        this.normals[j * 3 + 1] * axis.y +
        this.normals[j * 3 + 2] * axis.z;
      if (Math.abs(dot) < 0.35) {
        idx = j;
        break;
      }
    }
    if (idx < 0) idx = (Math.random() * this.n) | 0;
    const start = new THREE.Vector3(
      this.normals[idx * 3],
      this.normals[idx * 3 + 1],
      this.normals[idx * 3 + 2]
    ).multiplyScalar(R);
    const side = Math.random() < 0.5 ? 1 : -1;
    const target = start.clone().add(
      new THREE.Vector3(
        (Math.random() - 0.5) * 2.2,
        (Math.random() - 0.5) * 2.2,
        (Math.random() - 0.5) * 2.2
      )
    );
    target.add(axis.clone().multiplyScalar(side * 0.8));
    target.normalize().multiplyScalar(R);
    const mid = start.clone().add(target).normalize().multiplyScalar(R + 2.6);
    slot.active = true;
    slot.t = 0;
    slot.dur = 0.8 + Math.random() * 0.5;
    slot.start.copy(start);
    slot.mid.copy(mid);
    slot.end.copy(target);
    slot.mesh.position.copy(start);
    slot.mesh.material.color.setHex(side > 0 ? 0xff7a6b : 0x7fa8ff);
    slot.mesh.visible = true;
  }

  _warImpact() {
    const axis = new THREE.Vector3(this.fx.war.axis.x, this.fx.war.axis.y, this.fx.war.axis.z).normalize();
    let idx = (Math.random() * this.n) | 0;
    for (let tries = 0; tries < 40; tries++) {
      const j = (Math.random() * this.n) | 0;
      const dot =
        this.normals[j * 3] * axis.x +
        this.normals[j * 3 + 1] * axis.y +
        this.normals[j * 3 + 2] * axis.z;
      if (Math.abs(dot) < 0.28) {
        idx = j;
        break;
      }
    }
    const p = new THREE.Vector3(
      this.normals[idx * 3],
      this.normals[idx * 3 + 1],
      this.normals[idx * 3 + 2]
    );
    this.spawnRing(p, 0xff8a5c, 1.4, 0.7);
    this.spawnParticles(p.clone().multiplyScalar(R), 0xffa04d, 16, { speed: 1.8, size: 2.6, life: 0.9 });
    this.spawnParticles(p.clone().multiplyScalar(R), 0x9fb4c8, 8, { speed: 1.2, size: 3.4, life: 1.4 });
  }

  updateArcs(dt) {
    for (const a of this.arcs) {
      if (!a.active) continue;
      a.t += dt / a.dur;
      if (a.t >= 1) {
        a.active = false;
        a.mesh.visible = false;
        continue;
      }
      const t = a.t;
      const it = 1 - t;
      a.mesh.position.set(
        it * it * a.start.x + 2 * it * t * a.mid.x + t * t * a.end.x,
        it * it * a.start.y + 2 * it * t * a.mid.y + t * t * a.end.y,
        it * it * a.start.z + 2 * it * t * a.mid.z + t * t * a.end.z
      );
    }
  }

  setGlow(v) {
    this.glowBase = 0.14 + v * 0.62;
    this.bloom.strength = this.glowBase;
  }

  resize() {
    const parent = this.canvas.parentElement;
    const w = parent.clientWidth || window.innerWidth;
    const h = parent.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /* ------------------------------------------------ V2: civilizations */

  _initArchitecture() {
    const addInstanced = (geo, mat, cap) => {
      const mesh = new THREE.InstancedMesh(geo, mat, cap);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.visible = false;
      this.planet.add(mesh);
      return mesh;
    };

    // City nodes: crystalline glows raised by mature clusters.
    this.cityCap = 96;
    this.cityMesh = addInstanced(
      new THREE.OctahedronGeometry(0.3, 0),
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0.92,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
      this.cityCap
    );

    // Temple spires: raised while the world worships.
    this.templeCap = 96;
    this.templeMesh = addInstanced(
      new THREE.ConeGeometry(0.17, 0.85, 5),
      new THREE.MeshBasicMaterial({
        color: 0x9dffe2,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
      this.templeCap
    );

    // Planetary defense shields: raised by panic.
    this.shieldCap = 32;
    this.shieldMesh = addInstanced(
      new THREE.SphereGeometry(0.55, 10, 8),
      new THREE.MeshBasicMaterial({
        color: 0x6da8ff,
        transparent: true,
        opacity: 0.3,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
      this.shieldCap
    );

    // Trade routes: luminous arcs across the sphere.
    const MAX_ROUTES = 64;
    const STEPS = 6;
    this.routeCap = MAX_ROUTES;
    this.routeSteps = STEPS;
    this.routePos = new Float32Array(MAX_ROUTES * STEPS * 2 * 3);
    this.routeGeo = new THREE.BufferGeometry();
    this.routeGeo.setAttribute('position', new THREE.BufferAttribute(this.routePos, 3));
    this.routeGeo.setDrawRange(0, 0);
    this.routeLines = new THREE.LineSegments(
      this.routeGeo,
      new THREE.LineBasicMaterial({
        color: 0xffd98a,
        transparent: true,
        opacity: 0.38,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.routeLines.frustumCulled = false;
    this.planet.add(this.routeLines);

    this._archDummy = new THREE.Object3D();
    this._archColor = new THREE.Color();
    this._archA = new THREE.Vector3();
    this._archB = new THREE.Vector3();
    this._archP = new THREE.Vector3();
    this._archQ = new THREE.Vector3();
  }

  _updateArchitecture(civ, dt) {
    void dt;
    if (!this.cityMesh || !civ) return;
    const arch = civ.architecture || {};
    const cities = arch.cities || [];
    const routes = arch.routes || [];
    const positions = this.life.positions;
    const dummy = this._archDummy;
    const color = this._archColor;
    const t = this.time;

    const TIER_COLORS = [0x9dffe2, 0xffc76b, 0xff8a2b, 0x7af2c9];
    const shown = [];

    // --- city nodes -------------------------------------------------
    let count = 0;
    for (const city of cities) {
      if (count >= this.cityCap) break;
      if (!this.life.alive[city.idx]) continue;
      const tier = Math.min(city.tier || 0, 3);
      const lift = R + 0.45 + tier * 0.12;
      const pulse = 0.85 + Math.sin(t * 2.6 + city.idx * 0.7) * 0.22;
      const s = (0.55 + tier * 0.3) * pulse;
      dummy.position.set(
        positions[city.idx * 3] * lift,
        positions[city.idx * 3 + 1] * lift,
        positions[city.idx * 3 + 2] * lift
      );
      dummy.rotation.set(t * 0.35 + city.idx, t * 0.55, 0);
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      this.cityMesh.setMatrixAt(count, dummy.matrix);
      color.setHex(TIER_COLORS[tier]);
      this.cityMesh.setColorAt(count, color);
      shown.push(city.idx);
      count++;
    }
    this.cityMesh.count = count;
    this.cityMesh.visible = count > 0;
    if (count > 0) {
      this.cityMesh.instanceMatrix.needsUpdate = true;
      if (this.cityMesh.instanceColor) this.cityMesh.instanceColor.needsUpdate = true;
    }

    // --- temple spires ----------------------------------------------
    const temples = Math.min(Math.floor(civ.templesBuilt || 0), count, this.templeCap);
    for (let k = 0; k < temples; k++) {
      const idx = shown[k];
      const nx = positions[idx * 3];
      const ny = positions[idx * 3 + 1];
      const nz = positions[idx * 3 + 2];
      const lift = R + 0.85;
      dummy.position.set(nx * lift, ny * lift, nz * lift);
      dummy.quaternion.setFromUnitVectors(UP, this._archA.set(nx, ny, nz));
      dummy.scale.setScalar(0.9 + Math.sin(t * 3 + k * 1.3) * 0.07);
      dummy.updateMatrix();
      this.templeMesh.setMatrixAt(k, dummy.matrix);
    }
    this.templeMesh.count = temples;
    this.templeMesh.visible = temples > 0;
    if (temples > 0) this.templeMesh.instanceMatrix.needsUpdate = true;

    // --- defense shields ---------------------------------------------
    const panic = civ.panic || 0;
    let shields = 0;
    if (panic > 0.35 && count > 0) {
      shields = Math.min(count, this.shieldCap);
      for (let k = 0; k < shields; k++) {
        const idx = shown[k];
        const lift = R + 0.6;
        const s = 0.75 + panic * 1.3 + Math.sin(t * 4 + k * 1.7) * 0.07;
        dummy.position.set(
          positions[idx * 3] * lift,
          positions[idx * 3 + 1] * lift,
          positions[idx * 3 + 2] * lift
        );
        dummy.quaternion.identity();
        dummy.scale.setScalar(s);
        dummy.updateMatrix();
        this.shieldMesh.setMatrixAt(k, dummy.matrix);
      }
      this.shieldMesh.instanceMatrix.needsUpdate = true;
    }
    this.shieldMesh.count = shields;
    this.shieldMesh.visible = shields > 0;
    this.shieldMesh.material.opacity = 0.16 + panic * 0.34 + Math.sin(t * 3) * 0.04;

    // --- trade routes -------------------------------------------------
    let seg = 0;
    const STEPS = this.routeSteps;
    const pos = this.routePos;
    const A = this._archA;
    const B = this._archB;
    const P = this._archP;
    const Q = this._archQ;
    for (const r of routes) {
      if (seg >= this.routeCap) break;
      if (!this.life.alive[r.from] || !this.life.alive[r.to]) continue;
      A.set(positions[r.from * 3], positions[r.from * 3 + 1], positions[r.from * 3 + 2]);
      B.set(positions[r.to * 3], positions[r.to * 3 + 1], positions[r.to * 3 + 2]);
      for (let s = 0; s < STEPS; s++) {
        P.copy(A).lerp(B, s / STEPS).normalize().multiplyScalar(R + 1.1);
        Q.copy(A).lerp(B, (s + 1) / STEPS).normalize().multiplyScalar(R + 1.1);
        const o = (seg * STEPS + s) * 6;
        pos[o] = P.x;
        pos[o + 1] = P.y;
        pos[o + 2] = P.z;
        pos[o + 3] = Q.x;
        pos[o + 4] = Q.y;
        pos[o + 5] = Q.z;
      }
      seg++;
    }
    this.routeGeo.setDrawRange(0, seg * STEPS * 2);
    this.routeGeo.attributes.position.needsUpdate = true;
    this.routeLines.visible = seg > 0;
  }

  render(dt) {
    this.updateArcs(dt);
    if (this.civilization) this._updateArchitecture(this.civilization, dt);
    this.composer.render();
  }
}
