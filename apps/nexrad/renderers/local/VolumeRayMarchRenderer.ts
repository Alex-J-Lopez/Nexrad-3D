import * as THREE from "three";
import type { RadarVolumeMeta, RadarSite } from "@nexrad-3d/contracts";
import { RadarVolumeNode, type RenderingQuality } from "../shared/radarVolumeNode";
import type { FlightData } from "../../hooks/useFlightData";

const RANGE_RING_RADII_KM = [50, 100, 150];
const RING_SEGMENTS = 128;
const BACKGROUND_COLOR = 0x070a12;
const VERTICAL_SCALE = 1;

function createFlightLabelSprite(text: string, colorStr: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.font = "bold 28px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(0,0,0,0.8)";
  ctx.strokeText(text, 128, 32);
  ctx.fillStyle = colorStr;
  ctx.fillText(text, 128, 32);

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ 
    map: tex, 
    transparent: true, 
    depthTest: false,
  });
  const sp = new THREE.Sprite(mat);
  sp.scale.set(8, 2, 1);
  return sp;
}

export class VolumeRayMarchRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly canvas: HTMLCanvasElement;
  private readonly radarNode: RadarVolumeNode;
  private readonly flightsGroup: THREE.Group;
  
  private animFrameId: number | null = null;
  private spherical = { theta: -0.4, phi: 1.1, r: 230 };
  private isDragging = false;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private lastTouchDist = 0;
  private spinning = false;

  private readonly boundMouseDown: (e: MouseEvent) => void;
  private readonly boundMouseMove: (e: MouseEvent) => void;
  private readonly boundMouseUp: () => void;
  private readonly boundWheel: (e: WheelEvent) => void;
  private readonly boundTouchStart: (e: TouchEvent) => void;
  private readonly boundTouchMove: (e: TouchEvent) => void;
  private readonly boundTouchEnd: () => void;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const w = canvas.clientWidth || 700;
    const h = canvas.clientHeight || 520;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h, false);
    this.renderer.setClearColor(BACKGROUND_COLOR, 1);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, w / h, 0.001, 50000);
    this.updateCamera();

    this.addRangeRings();
    
    this.radarNode = new RadarVolumeNode();
    this.scene.add(this.radarNode.mesh);

    this.flightsGroup = new THREE.Group();
    this.scene.add(this.flightsGroup);

    this.boundMouseDown = (e) => {
      this.isDragging = true;
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
    };
    this.boundMouseMove = (e) => {
      if (!this.isDragging) return;
      this.spherical.theta -= (e.clientX - this.lastPointerX) * 0.008;
      this.spherical.phi = Math.max(
        0.2,
        Math.min(1.5, this.spherical.phi + (e.clientY - this.lastPointerY) * 0.006)
      );
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
      this.updateCamera();
    };
    this.boundMouseUp = () => {
      this.isDragging = false;
    };
    this.boundWheel = (e) => {
      this.spherical.r = Math.max(0.1, Math.min(600, this.spherical.r + e.deltaY * 0.3));
      this.updateCamera();
      e.preventDefault();
    };
    this.boundTouchStart = (e) => {
      if (e.touches.length === 1) {
        this.isDragging = true;
        this.lastPointerX = e.touches[0].clientX;
        this.lastPointerY = e.touches[0].clientY;
      }
      if (e.touches.length === 2) {
        this.lastTouchDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
      }
      e.preventDefault();
    };
    this.boundTouchMove = (e) => {
      if (e.touches.length === 1 && this.isDragging) {
        this.spherical.theta -= (e.touches[0].clientX - this.lastPointerX) * 0.01;
        this.spherical.phi = Math.max(
          0.2,
          Math.min(1.5, this.spherical.phi + (e.touches[0].clientY - this.lastPointerY) * 0.008)
        );
        this.lastPointerX = e.touches[0].clientX;
        this.lastPointerY = e.touches[0].clientY;
        this.updateCamera();
      }
      if (e.touches.length === 2) {
        const d = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        this.spherical.r = Math.max(
          0.1,
          Math.min(600, this.spherical.r - (d - this.lastTouchDist) * 0.5)
        );
        this.lastTouchDist = d;
        this.updateCamera();
      }
      e.preventDefault();
    };
    this.boundTouchEnd = () => {
      this.isDragging = false;
    };

    canvas.addEventListener("mousedown", this.boundMouseDown);
    window.addEventListener("mousemove", this.boundMouseMove);
    window.addEventListener("mouseup", this.boundMouseUp);
    canvas.addEventListener("wheel", this.boundWheel, { passive: false });
    canvas.addEventListener("touchstart", this.boundTouchStart, { passive: false });
    canvas.addEventListener("touchmove", this.boundTouchMove, { passive: false });
    canvas.addEventListener("touchend", this.boundTouchEnd);

    this.startRenderLoop();
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  toggleSpin(): boolean {
    this.spinning = !this.spinning;
    return this.spinning;
  }

  resetCamera(): void {
    this.spherical = { theta: -0.4, phi: 1.1, r: 230 };
    this.updateCamera();
  }

  updateFlights(flights: FlightData[], site: RadarSite | null): void {
    // Clear old flights
    while (this.flightsGroup.children.length > 0) {
      const child = this.flightsGroup.children[0];
      this.flightsGroup.remove(child);
      if ((child as any).geometry) (child as any).geometry.dispose();
      if ((child as any).material) {
        if ((child as any).material.map) (child as any).material.map.dispose();
        (child as any).material.dispose();
      }
    }

    if (flights.length === 0 || !site) return;

    const R = 6371; // Earth radius in km
    const rad = Math.PI / 180;
    const siteLatRad = site.latitude * rad;

    const pointsGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(flights.length * 3);
    const colors = new Float32Array(flights.length * 3);

    // Also draw trails based on velocity and heading
    const trailPositions: number[] = [];
    const trailColors: number[] = [];

    flights.forEach((flight, i) => {
      // Calculate local km offset
      const dx = (flight.longitude - site.longitude) * rad * R * Math.cos(siteLatRad);
      const dz = -(flight.latitude - site.latitude) * rad * R;
      const relativeAltitudeMeters = flight.altitude - (site.elevationMeters ?? 0);
      const dy = (relativeAltitudeMeters / 1000) * VERTICAL_SCALE;

      positions[i * 3] = dx;
      positions[i * 3 + 1] = dy;
      positions[i * 3 + 2] = dz;

      // Color based on altitude (e.g., higher = warmer color)
      const color = new THREE.Color();
      color.setHSL(Math.max(0, 0.7 - (flight.altitude / 12000) * 0.7), 1.0, 0.6);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;

      // Add a short trail indicating heading/velocity
      // distance in km = velocity * 60 / 1000
      if (flight.velocity > 0) {
        const trailLengthKm = (flight.velocity * 60) / 1000;
        const headingRad = (90 - flight.heading) * rad;
        const trailDx = Math.cos(headingRad) * trailLengthKm;
        const trailDz = -Math.sin(headingRad) * trailLengthKm;

        trailPositions.push(dx, dy, dz);
        trailPositions.push(dx - trailDx, dy, dz - trailDz);

        trailColors.push(color.r, color.g, color.b);
        trailColors.push(color.r, color.g, color.b);
      }

      const labelText = flight.callsign ? flight.callsign.trim() : flight.icao24;
      const sprite = createFlightLabelSprite(labelText, `#${color.getHexString()}`);
      sprite.position.set(dx, dy + 1.5, dz);
      this.flightsGroup.add(sprite);
    });

    pointsGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    pointsGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const pointsMat = new THREE.PointsMaterial({
      size: 4,
      vertexColors: true,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.9,
    });
    this.flightsGroup.add(new THREE.Points(pointsGeo, pointsMat));

    if (trailPositions.length > 0) {
      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute("position", new THREE.Float32BufferAttribute(trailPositions, 3));
      lineGeo.setAttribute("color", new THREE.Float32BufferAttribute(trailColors, 3));

      const lineMat = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.5,
      });
      this.flightsGroup.add(new THREE.LineSegments(lineGeo, lineMat));
    }
  }

  updateVolume(data: Float32Array, metadata: RadarVolumeMeta, thresholdDbz: number, quality: RenderingQuality = "high"): number {
    this.radarNode.renderingQuality = quality;
    return this.radarNode.updateVolume(data, metadata, thresholdDbz, this.renderer.capabilities.maxTextureSize);
  }

  clearVolume(): void {
    this.radarNode.clearVolume();
  }

  dispose(): void {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    this.canvas.removeEventListener("mousedown", this.boundMouseDown);
    window.removeEventListener("mousemove", this.boundMouseMove);
    window.removeEventListener("mouseup", this.boundMouseUp);
    this.canvas.removeEventListener("wheel", this.boundWheel);
    this.canvas.removeEventListener("touchstart", this.boundTouchStart);
    this.canvas.removeEventListener("touchmove", this.boundTouchMove);
    this.canvas.removeEventListener("touchend", this.boundTouchEnd);

    this.radarNode.dispose();
    this.scene.remove(this.radarNode.mesh);
    this.renderer.dispose();
  }

  private updateCamera(): void {
    this.camera.position.set(
      this.spherical.r * Math.sin(this.spherical.phi) * Math.sin(this.spherical.theta),
      this.spherical.r * Math.cos(this.spherical.phi) + 20,
      this.spherical.r * Math.sin(this.spherical.phi) * Math.cos(this.spherical.theta)
    );
    this.camera.lookAt(0, 20, 0);
  }

  private addRangeRings(): void {
    for (const rkm of RANGE_RING_RADII_KM) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= RING_SEGMENTS; i++) {
        const a = (i / RING_SEGMENTS) * 2 * Math.PI;
        pts.push(new THREE.Vector3(rkm * Math.cos(a), 0, rkm * Math.sin(a)));
      }
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      this.scene.add(
        new THREE.Line(
          geo,
          new THREE.LineBasicMaterial({ color: 0x1e3050, transparent: true, opacity: 0.5 })
        )
      );
    }
  }

  private startRenderLoop(): void {
    const animate = () => {
      this.animFrameId = requestAnimationFrame(animate);
      if (this.spinning) {
        this.spherical.theta += 0.005;
        this.updateCamera();
      }

      this.radarNode.updateTime(performance.now() * 0.001, this.camera.position);

      this.renderer.render(this.scene, this.camera);
    };
    animate();
  }
}
