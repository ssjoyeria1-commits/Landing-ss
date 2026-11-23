// Vista 3D del simulador de manillas (prototipo, 23 nov 2026), con Three.js. Solo en el navegador.
// La manilla está de pie como en una muñeca (el círculo en el plano XZ; el ancho del tejido a lo largo de Y), en
// milímetros: la serie de balines al frente, el tejido macramé de nudo plano a los dos lados hasta el cierre
// corredizo atrás, y del cierre salen las dos puntas con un balín en cada una.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

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

const PASO_NUDO = 1.9; // largo de cada nudo plano (mm)
const ANCHO_TEJIDO = 3.4; // ancho del tejido (mm)

export function crearVista3D(lienzo: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({ canvas: lienzo, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.setClearColor(0x000000, 0);

  const escena = new THREE.Scene();
  // Reflejos de un estudio fotográfico (generado, sin descargar imágenes): el oro brilla como en una foto de producto.
  const pmrem = new THREE.PMREMGenerator(renderer);
  escena.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const luz = new THREE.DirectionalLight(0xfff4e0, 1.4);
  luz.position.set(30, 60, 40);
  escena.add(luz);
  escena.add(new THREE.HemisphereLight(0xfff1dd, 0x2a0508, 0.6));

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

  // Oro de 18k: metal con poca rugosidad (el brillo sale del entorno).
  const oro = new THREE.MeshStandardMaterial({ color: 0xf2c56b, metalness: 1, roughness: 0.18 });
  const hiloMat = new THREE.MeshStandardMaterial({ color: 0x1b1716, roughness: 0.62, metalness: 0 });
  // Textura de fibra para el hilo: rayas finas generadas en un canvas, como relieve.
  hiloMat.bumpMap = texturaFibra();
  hiloMat.bumpScale = 0.6;

  const esfera = new THREE.SphereGeometry(1, 40, 28);
  const barra = new THREE.CapsuleGeometry(0.98, ANCHO_TEJIDO - 1.96, 6, 14);
  const lazo = new THREE.TorusGeometry(0.8, 0.45, 10, 20, Math.PI * 1.2);

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
      if (o instanceof THREE.Mesh && o.geometry !== esfera && o.geometry !== barra && o.geometry !== lazo) o.geometry.dispose();
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
    const alma = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(puntos, true), 200, 0.42, 10, true), hiloMat);
    manilla.add(alma);

    // Balines centrados al frente.
    let s = -ocupado / 2;
    d.balines.forEach((diametro, i) => {
      const { punto } = enCirculo(R, anguloDe(s + diametro / 2));
      const b = new THREE.Mesh(esfera, oro);
      b.position.copy(punto);
      b.scale.setScalar((diametro / 2) * 0.98);
      b.userData.escala = (diametro / 2) * 0.98;
      manilla.add(b);
      if (i >= animarDesde) {
        b.scale.setScalar(0.001);
        nuevas.push({ malla: b, desde: performance.now() + (i - animarDesde) * 35 });
      }
      s += diametro;
    });

    // Tejido macramé de nudo plano a los dos lados, desde la serie de balines hasta el cierre (atrás).
    const inicio = ocupado / 2 + 0.6;
    const fin = d.largo / 2 - CIERRE_MM / 2;
    const tejer = (desde: number, hasta: number, signo: 1 | -1, grueso = 1) => {
      let k = 0;
      for (let t = desde + PASO_NUDO / 2; t <= hasta - PASO_NUDO / 2 + 0.01; t += PASO_NUDO, k++) {
        const { punto, tangente, afuera } = enCirculo(R, anguloDe(signo * t));
        // La barra que cruza el tejido de lado a lado.
        const b = new THREE.Mesh(barra, hiloMat);
        b.position.copy(punto).addScaledVector(afuera, 0.35 * grueso);
        orientar(b, tangente, afuera);
        b.scale.set(grueso, grueso, grueso);
        manilla.add(b);
        // El lazo del nudo, a un lado y al otro alternando (el dibujo típico del nudo plano).
        const l = new THREE.Mesh(lazo, hiloMat);
        const lado = k % 2 === 0 ? 1 : -1;
        l.position.copy(punto).add(new THREE.Vector3(0, lado * (ANCHO_TEJIDO / 2 + 0.15) * grueso, 0));
        orientar(l, tangente, afuera);
        l.rotateX(lado > 0 ? 0 : Math.PI);
        l.rotateZ(-Math.PI * 0.1);
        l.scale.setScalar(grueso);
        manilla.add(l);
      }
    };
    tejer(inicio, fin, 1);
    tejer(inicio, fin, -1);

    // Cierre corredizo: un tramo de nudos más grueso atrás.
    tejer(d.largo / 2 - CIERRE_MM / 2, d.largo / 2 + CIERRE_MM / 2, 1, 1.35);

    // Las dos puntas del hilo salen del cierre hacia afuera y caen un poco, con un balín en cada una.
    const atras = enCirculo(R, anguloDe(d.largo / 2));
    for (const lado of [-1, 1]) {
      const salida = enCirculo(R, anguloDe(d.largo / 2 + lado * (CIERRE_MM / 2)));
      const p0 = salida.punto.clone();
      const p1 = p0.clone().addScaledVector(atras.afuera, 5).addScaledVector(salida.tangente, lado * 3).add(new THREE.Vector3(0, -3, 0));
      const p2 = p0.clone().addScaledVector(atras.afuera, 10).addScaledVector(salida.tangente, lado * 4).add(new THREE.Vector3(0, -10, 0));
      const curva = new THREE.CatmullRomCurve3([p0, p1, p2]);
      manilla.add(new THREE.Mesh(new THREE.TubeGeometry(curva, 30, 0.45, 8, false), hiloMat));
      const punta = new THREE.Mesh(esfera, oro);
      punta.position.copy(p2);
      punta.scale.setScalar(1.5);
      manilla.add(punta);
    }

    escena.add(manilla);
  }

  // Tamaño del lienzo según su caja en la página.
  const ajustar = () => {
    const { width, height } = lienzo.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height, false);
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
    renderer.render(escena, camara);
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
