import * as THREE from "three";
import maplibregl from "maplibre-gl";
import type { RadarSite, RadarVolumeMeta } from "@nexrad-3d/contracts";
import { RadarVolumeNode } from "../shared/radarVolumeNode";

export class MaplibreRadarLayer implements maplibregl.CustomLayerInterface {
  public id = "radar-volume-layer";
  public type: "custom" = "custom";
  public renderingMode: "3d" = "3d";
  
  private camera: THREE.Camera;
  private scene: THREE.Scene;
  private map: maplibregl.Map | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private radarNode: RadarVolumeNode;
  
  private site: RadarSite | null = null;

  constructor() {
    this.camera = new THREE.Camera();
    this.scene = new THREE.Scene();
    
    this.radarNode = new RadarVolumeNode();
    this.scene.add(this.radarNode.mesh);
  }

  public update(
    site: RadarSite,
    metadata: RadarVolumeMeta,
    data: Float32Array,
    thresholdDbz: number
  ) {
    this.site = site;
    // Maplibre has a different approach but realistically maxTextureSize needs renderer 
    // let's pass a sensible default 8192 or dynamically fetch if renderer is bound
    const maxTextureSize = this.renderer ? this.renderer.capabilities.maxTextureSize : 8192;
    this.radarNode.updateVolume(data, metadata, thresholdDbz, maxTextureSize);
    
    if (this.map) {
      this.map.triggerRepaint();
    }
  }

  public clear() {
    this.radarNode.clearVolume();
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
