import * as THREE from "three";
import maplibregl from "maplibre-gl";
import type { RadarSite, RadarVolumeMeta } from "@nexrad-3d/contracts";
import { RadarVolumeNode, type RenderingQuality } from "../shared/radarVolumeNode";
import type { FlightData } from "../../hooks/useFlightData";

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

export class MaplibreRadarLayer implements maplibregl.CustomLayerInterface {
  public id = "radar-volume-layer";
  public type: "custom" = "custom";
  public renderingMode: "3d" = "3d";
  
  private camera: THREE.Camera;
  private scene: THREE.Scene;
  private map: maplibregl.Map | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private radarNode: RadarVolumeNode;
  private flightsGroup: THREE.Group;
  
  private site: RadarSite | null = null;

  constructor() {
    this.camera = new THREE.Camera();
    this.scene = new THREE.Scene();
    
    this.radarNode = new RadarVolumeNode();
    this.scene.add(this.radarNode.mesh);

    this.flightsGroup = new THREE.Group();
    this.scene.add(this.flightsGroup);
  }

  public update(
    site: RadarSite,
    metadata: RadarVolumeMeta,
    data: Float32Array,
    thresholdDbz: number,
    quality: RenderingQuality = "high",
    flights?: FlightData[]
  ) {
    this.site = site;
    this.radarNode.renderingQuality = quality;
    // Maplibre has a different approach but realistically maxTextureSize needs renderer 
    // let's pass a sensible default 8192 or dynamically fetch if renderer is bound
    const maxTextureSize = this.renderer ? this.renderer.capabilities.maxTextureSize : 8192;
    // Potentially scale max texture size depending on quality as well
    const effectiveMaxSize = quality === "low" ? Math.min(2048, maxTextureSize) : maxTextureSize;
    this.radarNode.updateVolume(data, metadata, thresholdDbz, effectiveMaxSize);

    this.updateFlights(flights || []);
    
    if (this.map) {
      this.map.triggerRepaint();
    }
  }

  private updateFlights(flights: FlightData[]) {
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

    if (flights.length === 0 || !this.site) return;

    const R = 6371; // Earth radius in km
    const rad = Math.PI / 180;
    const siteLatRad = this.site.latitude * rad;

    const pointsGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(flights.length * 3);
    const colors = new Float32Array(flights.length * 3);

    // Also draw trails based on velocity and heading
    const trailPositions: number[] = [];
    const trailColors: number[] = [];

    flights.forEach((flight, i) => {
      // Calculate local km offset
      const dx = (flight.longitude - this.site!.longitude) * rad * R * Math.cos(siteLatRad);
      const dz = -(flight.latitude - this.site!.latitude) * rad * R;
      const relativeAltitudeMeters = flight.altitude - this.site!.elevationMeters;
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
      // Velocity is m/s. Let's make the trail represent ~1 minute of flight (60 seconds)
      // distance in km = velocity * 60 / 1000
      if (flight.velocity > 0) {
        const trailLengthKm = (flight.velocity * 60) / 1000;
        // true_track is degrees clockwise from true north.
        // Three.js (-Z is North, +X is East)
        // North = 0 heading -> -Z
        // East  = 90 heading -> +X
        // South = 180 heading -> +Z
        // West  = 270 heading -> -X
        const headingRad = (90 - flight.heading) * rad;
        const trailDx = Math.cos(headingRad) * trailLengthKm;
        const trailDz = -Math.sin(headingRad) * trailLengthKm;

        trailPositions.push(dx, dy, dz);
        trailPositions.push(dx - trailDx, dy, dz - trailDz);

        trailColors.push(color.r, color.g, color.b);
        trailColors.push(color.r, color.g, color.b); // Fade out could be done here
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

  public clear() {
    this.radarNode.clearVolume();
    this.updateFlights([]);
    if (this.map) {
      this.map.triggerRepaint();
    }
  }

  public onAdd(map: maplibregl.Map, gl: WebGLRenderingContext) {
    this.map = map;
    this.renderer = new THREE.WebGLRenderer({
      canvas: map.getCanvas(),
      context: gl,
      antialias: true,
    });
    this.renderer.autoClear = false;
  }

  public render(gl: WebGLRenderingContext, matrix: maplibregl.CustomRenderMethodInput) {
    if (!this.renderer || !this.site || !this.radarNode.mesh.visible) {
      return;
    }

    const mercatorCoords = maplibregl.MercatorCoordinate.fromLngLat(
      [this.site.longitude, this.site.latitude],
      this.site.elevationMeters || 0
    );

    const mercatorScale = mercatorCoords.meterInMercatorCoordinateUnits();
    // Three.js model is defined in kilometers
    const kmScale = mercatorScale * 1000;

    const modelTransform = {
      translateX: mercatorCoords.x,
      translateY: mercatorCoords.y,
      translateZ: mercatorCoords.z,
      rotateX: Math.PI / 2, // Rotate from MapLibre's Z-up to Three's Y-up
      rotateY: 0,
      rotateZ: 0,
      scale: kmScale
    };

    const rotationX = new THREE.Matrix4().makeRotationX(modelTransform.rotateX);
    const rotationY = new THREE.Matrix4().makeRotationY(modelTransform.rotateY);
    const rotationZ = new THREE.Matrix4().makeRotationZ(modelTransform.rotateZ);

    const l = new THREE.Matrix4()
      .makeTranslation(
        modelTransform.translateX,
        modelTransform.translateY,
        modelTransform.translateZ
      )
      .scale(
        new THREE.Vector3(
          modelTransform.scale,
          -modelTransform.scale,
          modelTransform.scale
        )
      )
      .multiply(rotationX)
      .multiply(rotationY)
      .multiply(rotationZ);

    // CustomRenderMethodInput has standard method 'defaultProjectionData'
    const m = new THREE.Matrix4().fromArray(matrix.defaultProjectionData.mainMatrix);

    this.camera.projectionMatrix = m.clone().multiply(l);
    
    // Shader needs local camera position! Actually, our shader expects world-space camera position.
    // In our shared node, `uCameraPos` is used. But the mesh is just at local (0, 0, 0)?
    // Wait, the mesh is added to `this.scene`, so the mesh world matrix is identity!
    // So the camera position passed to `updateTime(..., camPos)` needs to be the camera position relative to the mesh (i.e. model space).
    // The projectionMatrix of Three.js here already includes the view AND model matrix combined into the camera's projection!
    // Thus the view matrix is the identity, model is identity, and all of it is in projectionMatrix.
    // So getting the camera local coordinates means inverting the projectionMatrix.
    const invertProj = this.camera.projectionMatrix.clone().invert();
    // The camera position is origin (0,0,0) in clip space... Wait, camera pos in clip space is not 0.
    // In perspective, w = z or something. The camera origin in view space is (0,0,0,1).
    // Let's use `Vector3(0,0,0).applyMatrix4(invertMatrix)`? No.
    // The previous math was getting element 8, 9, 10 divided by 11.
    const invElems = invertProj.elements;
    const camPos = new THREE.Vector3(
      invElems[8] / invElems[11],
      invElems[9] / invElems[11],
      invElems[10] / invElems[11]
    );

    this.radarNode.updateTime(performance.now() * 0.001, camPos);

    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
    if (this.map) {
      this.map.triggerRepaint();
    }
  }
}
