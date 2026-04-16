import * as THREE from "three";
import type { RadarVolumeMeta } from "@nexrad-3d/contracts";
import { buildPointArrays } from "./pointCloudArrays";

const RANGE_RING_RADII_KM = [50, 100, 150];
const RING_SEGMENTS = 128;
const POINT_SIZE = 1.8;
const BACKGROUND_COLOR = 0x070a12;

export class PointCloudRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly canvas: HTMLCanvasElement;
  private points: THREE.Points | null = null;
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
    this.camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 2000);
    this.updateCamera();

    this.addGroundDisk();
    this.addRangeRings();

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
      this.spherical.r = Math.max(80, Math.min(500, this.spherical.r + e.deltaY * 0.3));
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
          80,
          Math.min(500, this.spherical.r - (d - this.lastTouchDist) * 0.5)
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

  /** Fallback main-thread path: builds point arrays then delegates to updateFromWorkerResult. */
  updateVolume(data: Float32Array, metadata: RadarVolumeMeta, thresholdDbz: number): number {
    const { positions, colors, pointCount } = buildPointArrays(data, metadata, thresholdDbz);
    return this.updateFromWorkerResult(positions, colors, pointCount);
  }

  /** Accept pre-built typed arrays (e.g. from a worker) and update the GPU buffers in place. */
  updateFromWorkerResult(positions: Float32Array, colors: Float32Array, pointCount: number): number {
    if (pointCount === 0) {
      if (this.points) this.points.visible = false;
      return 0;
    }

    if (!this.points) {
      this.initPointCloud(positions.length);
    }

    const geo = this.points!.geometry;
    const posAttr = geo.getAttribute("position") as THREE.BufferAttribute;
    const colAttr = geo.getAttribute("color") as THREE.BufferAttribute;

    if (positions.length > posAttr.array.length) {
      this.initPointCloud(positions.length);
    }

    const posArr = posAttr.array as Float32Array;
    const colArr = colAttr.array as Float32Array;
    posArr.set(positions);
    colArr.set(colors);
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    geo.setDrawRange(0, pointCount);
    this.points!.visible = true;
    return pointCount;
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
    if (this.points) {
      this.points.geometry.dispose();
      (this.points.material as THREE.Material).dispose();
    }
    this.renderer.dispose();
  }

  private initPointCloud(maxCount: number): void {
    if (this.points) {
      this.scene.remove(this.points);
      this.points.geometry.dispose();
      (this.points.material as THREE.Material).dispose();
      this.points = null;
    }

    const geo = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(new Float32Array(maxCount * 3), 3);
    const colAttr = new THREE.BufferAttribute(new Float32Array(maxCount * 3), 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    colAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("position", posAttr);
    geo.setAttribute("color", colAttr);
    geo.setDrawRange(0, 0);

    const mat = new THREE.PointsMaterial({
      size: POINT_SIZE,
      vertexColors: true,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.85,
    });

    this.points = new THREE.Points(geo, mat);
    this.scene.add(this.points);
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

  private addGroundDisk(): void {
    const geo = new THREE.CircleGeometry(155, 128);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x1a2035,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.4,
    });
    const disk = new THREE.Mesh(geo, mat);
    disk.rotation.x = -Math.PI / 2;
    disk.position.y = -0.5;
    this.scene.add(disk);
  }

  private startRenderLoop(): void {
    const animate = () => {
      this.animFrameId = requestAnimationFrame(animate);
      if (this.spinning) {
        this.spherical.theta += 0.005;
        this.updateCamera();
      }
      this.renderer.render(this.scene, this.camera);
    };
    animate();
  }
}
