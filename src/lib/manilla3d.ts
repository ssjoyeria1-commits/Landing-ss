// Vista 3D del simulador de manillas (prototipo, 23 nov 2026), con Three.js. Solo en el navegador.
// La manilla está de pie como en una muñeca (el círculo en el plano XZ; el ancho del tejido a lo largo de Y), en
// milímetros: la serie de balines al frente, el tejido macramé de nudo plano a los dos lados hasta el cierre
// corredizo atrás, y del cierre salen las dos puntas con un balín en cada una.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

export interface Diseno {
  /** Diámetros (mm) de los balines, en orden. */
  balines: number[];
  /** Color del hilo. */
  hilo: string;
  /** Largo total de la manilla (mm). */
  largo: number;
}

/** Largo del cierre corredizo (mm): no lleva balines. */
export const CIERRE_MM = 10;

// Medidas tomadas de las fotos de las manillas de SS (23 nov 2026): tira plana y apretada de hilo delgado.
const PASO_NUDO = 1.2; // largo de cada nudo plano (mm)
const ANCHO_TEJIDO = 4; // ancho de la tira (mm)
const HILO_MM = 0.8; // grosor del hilo
const ROTACION_ESTUDIO = 1.2; // radianes

export function crearVista3D(lienzo: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({ canvas: lienzo, antialias: true, alpha: true });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  // Sombras suaves: la manilla se apoya en una superficie invisible y deja su sombra (así no parece flotar).
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const escena = new THREE.Scene();
  // Reflejos: primero un estudio generado (inmediato) y, cuando llega, la luz 360° de un estudio fotográfico real
  // (public/3d/estudio.hdr: "Studio Small 09" de Poly Haven, licencia CC0). Con ella el oro se ve como en una foto.
  const pmrem = new THREE.PMREMGenerator(renderer);
  escena.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  new HDRLoader().load('/3d/estudio.hdr', (hdr) => {
    escena.environment = pmrem.fromEquirectangular(hdr).texture;
    // Girado para que las ventanas de luz del estudio se reflejen de frente en los balines.
    escena.environmentRotation.y = ROTACION_ESTUDIO;
    escena.environmentIntensity = 1.5;
    hdr.dispose();
  });

  const luz = new THREE.DirectionalLight(0xfff4e0, 1.4);
  luz.position.set(15, 90, 25);
  luz.castShadow = true;
  luz.shadow.mapSize.set(1024, 1024);
  Object.assign(luz.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 10, far: 200 });
  luz.shadow.radius = 6;
  luz.shadow.bias = -0.0004;
  escena.add(luz);

  // Superficie que solo muestra la sombra (el fondo de la página se sigue viendo).
  const piso = new THREE.Mesh(new THREE.PlaneGeometry(220, 220), new THREE.ShadowMaterial({ opacity: 0.45 }));
  piso.rotation.x = -Math.PI / 2;
  piso.position.y = -2.7;
  piso.receiveShadow = true;
  escena.add(piso);
  escena.add(new THREE.HemisphereLight(0xfff1dd, 0x2a0508, 0.6));
  // Luces pequeñas y fuertes, como las de una vitrina: hacen chispear las facetas al girar.
  for (const [x, y, z, i] of [[-40, 50, 60, 220], [45, 30, 50, 160], [0, 70, -40, 120]]) {
    const p = new THREE.PointLight(0xfff6e6, i, 0, 1.2);
    p.position.set(x, y, z);
    escena.add(p);
  }

  const camara = new THREE.PerspectiveCamera(34, 1, 1, 1000);
  camara.position.set(0, 46, 96);

  const controles = new OrbitControls(camara, lienzo);
  controles.enableDamping = true;
  controles.enablePan = false;
  controles.minDistance = 45;
  controles.maxDistance = 130;
  controles.autoRotate = true;
  controles.autoRotateSpeed = 1.6;
  controles.target.set(0, 0, 0);

  // Oro de 18k diamantado como el de las fotos: la superficie lleva líneas finas cruzadas (el corte a máquina), que
  // se hacen con un relieve generado; brillo de metal con un poco de rugosidad para que destelle sin ser espejo.
  const oro = new THREE.MeshStandardMaterial({
    color: 0xe9b54f,
    metalness: 1,
    roughness: 0.11,
    envMapIntensity: 1.4,
    bumpMap: texturaDiamantado(),
    bumpScale: 1.6,
  });
  // El balincito de las puntas es liso.
  const oroLiso = new THREE.MeshStandardMaterial({ color: 0xf0c869, metalness: 1, roughness: 0.12, envMapIntensity: 1.35 });
  const hiloMat = new THREE.MeshStandardMaterial({ color: 0x1b1716, roughness: 0.62, metalness: 0 });
  // Textura de fibra para el hilo: rayas finas generadas en un canvas, como relieve.
  hiloMat.bumpMap = texturaFibra();
  hiloMat.bumpScale = 0.6;

  const esfera = new THREE.SphereGeometry(1, 48, 32);
  const bulto = new THREE.SphereGeometry(1, 12, 8);

  let manilla = new THREE.Group();
  escena.add(manilla);
  let nuevas: { malla: THREE.Mesh; desde: number }[] = [];

  /** Punto, tangente y dirección hacia afuera en el ángulo `a` de un círculo de radio `r` (plano XZ). */
  const enCirculo = (r: number, a: number) => ({
    punto: new THREE.Vector3(r * Math.cos(a), 0, r * Math.sin(a)),
    tangente: new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)),
    afuera: new THREE.Vector3(Math.cos(a), 0, Math.sin(a)),
  });

  /** Orienta un objeto con su eje Y a lo ancho del tejido, Z hacia afuera y X a lo largo del hilo. */
  const orientar = (obj: THREE.Object3D, tangente: THREE.Vector3, afuera: THREE.Vector3) => {
    const m = new THREE.Matrix4().makeBasis(tangente, new THREE.Vector3(0, 1, 0), afuera);
    obj.quaternion.setFromRotationMatrix(m);
  };

  function dibujar(d: Diseno, animarDesde = Infinity) {
    escena.remove(manilla);
    manilla.traverse((o) => {
      if (o instanceof THREE.Mesh && o.geometry !== esfera && o.geometry !== bulto) o.geometry.dispose();
    });
    manilla = new THREE.Group();
    nuevas = [];
    hiloMat.color.set(d.hilo);

    const R = d.largo / (2 * Math.PI);
    const anguloDe = (s: number) => Math.PI / 2 + (s / d.largo) * 2 * Math.PI; // s = 0: al frente
    const ocupado = d.balines.reduce((a, b) => a + b, 0);

    // Alma del hilo por toda la vuelta (se ve entre balines).
    const circulo = new THREE.EllipseCurve(0, 0, R, R, 0, Math.PI * 2, false, 0);
    const puntos = circulo.getPoints(160).map((p) => new THREE.Vector3(p.x, 0, p.y));
    const alma = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(puntos, true), 200, HILO_MM / 2, 10, true), hiloMat);
    manilla.add(alma);

    // Balines centrados al frente.
    let s = -ocupado / 2;
    d.balines.forEach((diametro, i) => {
      const { punto, tangente } = enCirculo(R, anguloDe(s + diametro / 2));
      const b = new THREE.Mesh(esfera, oro);
      b.position.copy(punto);
      // Los polos del balín (donde se juntan las líneas) miran hacia el hilo: al frente se ven las líneas cruzadas.
      b.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangente);
      b.scale.setScalar((diametro / 2) * 0.98);
      b.userData.escala = (diametro / 2) * 0.98;
      manilla.add(b);
      if (i >= animarDesde) {
        b.scale.setScalar(0.001);
        nuevas.push({ malla: b, desde: performance.now() + (i - animarDesde) * 35 });
      }
      s += diametro;
    });

    // Tejido macramé de nudo plano a los dos lados, desde la serie de balines hasta el cierre (atrás). Como en las
    // fotos: una tira plana y apretada; cada nudo son dos bultos de hilo lado a lado (un poco torcidos, alternando) y
    // un lazo en uno de los bordes, alternando el lado. Todos los nudos van en dos mallas (InstancedMesh) para que el
    // celular los dibuje de una vez.
    const nudos: { punto: THREE.Vector3; tangente: THREE.Vector3; afuera: THREE.Vector3; k: number; grueso: number }[] = [];
    const tejer = (desde: number, hasta: number, signo: 1 | -1, grueso = 1) => {
      let k = 0;
      for (let t = desde + PASO_NUDO / 2; t <= hasta - PASO_NUDO / 2 + 0.01; t += PASO_NUDO, k++) {
        nudos.push({ ...enCirculo(R, anguloDe(signo * t)), k, grueso });
      }
    };
    const inicio = ocupado / 2 + 0.3;
    const fin = d.largo / 2 - CIERRE_MM / 2;
    tejer(inicio, fin, 1);
    tejer(inicio, fin, -1);
    // Cierre corredizo (abajo de la muñeca): un tramo de nudos más grueso.
    tejer(d.largo / 2 - CIERRE_MM / 2, d.largo / 2 + CIERRE_MM / 2, 1, 1.3);

    const bultos = new THREE.InstancedMesh(bulto, hiloMat, nudos.length * 2);
    const lazos = new THREE.InstancedMesh(bulto, hiloMat, nudos.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const giro = new THREE.Quaternion();
    const esc = new THREE.Vector3();
    const pos = new THREE.Vector3();
    nudos.forEach((n, i) => {
      q.setFromRotationMatrix(new THREE.Matrix4().makeBasis(n.tangente, new THREE.Vector3(0, 1, 0), n.afuera));
      for (const lado of [-1, 1]) {
        // Cada bulto: largo a lo ancho de la tira, torcido un poco (al revés en cada nudo) como el hilo anudado.
        giro.setFromAxisAngle(n.afuera, (n.k % 2 ? 1 : -1) * lado * 0.35);
        pos.copy(n.punto).addScaledVector(n.afuera, 0.55 * n.grueso).add(new THREE.Vector3(0, lado * 0.95 * n.grueso, 0));
        esc.set(0.72, 1.15, 0.75).multiplyScalar(n.grueso);
        m.compose(pos, giro.clone().multiply(q), esc);
        bultos.setMatrixAt(i * 2 + (lado > 0 ? 1 : 0), m);
      }
      const lado = n.k % 2 ? 1 : -1;
      pos.copy(n.punto).addScaledVector(n.afuera, 0.35 * n.grueso).add(new THREE.Vector3(0, lado * (ANCHO_TEJIDO / 2) * n.grueso, 0));
      esc.set(0.55, 0.5, 0.55).multiplyScalar(n.grueso);
      m.compose(pos, q, esc);
      lazos.setMatrixAt(i, m);
    });
    manilla.add(bultos, lazos);

    // Las dos puntas del hilo cuelgan del cierre, largas y delgadas, cada una con un balincito de oro y el nudo final.
    const atras = enCirculo(R, anguloDe(d.largo / 2));
    for (const lado of [-1, 1]) {
      const salida = enCirculo(R, anguloDe(d.largo / 2 + lado * (CIERRE_MM / 2)));
      const p0 = salida.punto.clone();
      const p1 = p0.clone().addScaledVector(atras.afuera, 4).addScaledVector(salida.tangente, lado * 2).add(new THREE.Vector3(0, -6, 0));
      const p2 = p0.clone().addScaledVector(atras.afuera, 7).addScaledVector(salida.tangente, lado * 3.5).add(new THREE.Vector3(0, -18, 0));
      const p3 = p0.clone().addScaledVector(atras.afuera, 8).addScaledVector(salida.tangente, lado * 4).add(new THREE.Vector3(0, -30 - lado * 3, 0));
      const curva = new THREE.CatmullRomCurve3([p0, p1, p2, p3]);
      manilla.add(new THREE.Mesh(new THREE.TubeGeometry(curva, 48, HILO_MM / 2, 8, false), hiloMat));
      const punta = new THREE.Mesh(esfera, oroLiso);
      punta.position.copy(curva.getPoint(0.9));
      punta.scale.setScalar(1.1);
      manilla.add(punta);
      const nudoFinal = new THREE.Mesh(bulto, hiloMat);
      nudoFinal.position.copy(p3);
      nudoFinal.scale.set(0.8, 1.1, 0.8);
      manilla.add(nudoFinal);
    }

    manilla.traverse((o) => (o.castShadow = true));
    escena.add(manilla);
  }

  // Desenfoque como el de una cámara de fotos: nítido donde está el centro de la manilla, suave lo más lejano.
  const compositor = new EffectComposer(renderer);
  compositor.addPass(new RenderPass(escena, camara));
  const desenfoque = new BokehPass(escena, camara, { focus: 100, aperture: 0.0016, maxblur: 0.006 });
  // El desenfoque de Three.js deja el fondo opaco; sin esa línea promedia también la transparencia y se sigue
  // viendo la página detrás.
  desenfoque.materialBokeh.fragmentShader = desenfoque.materialBokeh.fragmentShader.replace('gl_FragColor.a = 1.0;', '');
  desenfoque.materialBokeh.needsUpdate = true;
  compositor.addPass(desenfoque);
  compositor.addPass(new OutputPass());

  // Tamaño del lienzo según su caja en la página.
  const ajustar = () => {
    const { width, height } = lienzo.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    compositor.setPixelRatio(renderer.getPixelRatio());
    compositor.setSize(width, height);
    camara.aspect = width / height;
    camara.updateProjectionMatrix();
  };
  new ResizeObserver(ajustar).observe(lienzo);
  ajustar();

  // Solo se dibuja mientras se ve (ahorra batería).
  let visible = true;
  new IntersectionObserver(([e]) => (visible = e.isIntersecting)).observe(lienzo);
  const reducir = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reducir) controles.autoRotate = false;

  renderer.setAnimationLoop((ahora) => {
    if (!visible || document.hidden) return;
    for (const n of nuevas) {
      const p = Math.min(1, Math.max(0, (ahora - n.desde) / 320));
      const e = 1 - Math.pow(1 - p, 3);
      n.malla.scale.setScalar(Math.max(0.001, n.malla.userData.escala * e));
    }
    controles.update();
    // Enfoca siempre el frente de la manilla (los balines), aunque la acerquen o alejen.
    (desenfoque.uniforms as Record<string, { value: number }>).focus.value = camara.position.distanceTo(controles.target) - 20;
    compositor.render();
  });

  // El usuario toma el control: deja de girar sola un rato.
  let pausa: number | undefined;
  controles.addEventListener('start', () => {
    controles.autoRotate = false;
    clearTimeout(pausa);
  });
  controles.addEventListener('end', () => {
    if (!reducir) pausa = window.setTimeout(() => (controles.autoRotate = true), 4000);
  });

  return { dibujar };
}

/** Líneas finas cruzadas como el diamantado a máquina (relieve sobre la esfera). */
function texturaDiamantado() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#808080';
  g.fillRect(0, 0, c.width, c.height);
  g.lineWidth = 1.4;
  for (const [inclinacion, tono] of [[0.55, '#d8d8d8'], [-0.55, '#3a3a3a']] as const) {
    g.strokeStyle = tono;
    for (let x = -c.width; x < c.width * 2; x += 7) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x + c.height * inclinacion * 2, c.height);
      g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** Rayas finas en diagonal, como las fibras torcidas de un hilo, para usar como relieve. */
function texturaFibra() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#808080';
  g.fillRect(0, 0, 64, 64);
  for (let i = -64; i < 128; i += 6) {
    g.strokeStyle = i % 12 === 0 ? '#b0b0b0' : '#505050';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + 32, 64);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 1);
  return t;
}

/** ¿El navegador puede dibujar en 3D? */
export function hayWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}
