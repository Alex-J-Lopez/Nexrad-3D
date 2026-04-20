import * as THREE from "three";
import type { RadarVolumeMeta } from "@nexrad-3d/contracts";
import {
  buildAngleIndexTexture,
  buildPackedRadarVolume,
  buildValueIndexTexture,
  type PackedRadarVolume,
} from "../local/openStormVolumePipeline";

const RANGE_RING_RADII_KM = [50, 100, 150];
const RING_SEGMENTS = 128;
const BACKGROUND_COLOR = 0x070a12;
const VERTICAL_SCALE = 1;
const SHADER_MAX_STEPS = 512;

const VERTEX_SHADER = `
varying vec3 vWorldPos;

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldPos = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FRAGMENT_SHADER = `
precision highp float;

uniform sampler2D uVolume;
uniform sampler2D uAngleIndex;
uniform sampler2D uValueIndex;
uniform vec2 uVolumeTexSize;
uniform float uRadiusSize;
uniform float uThetaSize;
uniform float uThetaSizePadded;
uniform float uSweepCount;
uniform float uRaysPerLine;
uniform float uValueLower;
uniform float uValueUpper;
uniform float uInnerDistanceKm;
uniform float uBinSizeKm;
uniform float uVerticalScale;
uniform float uStepKm;
uniform float uMaxSteps;
uniform float uMode;
uniform float uOpacityScale;
uniform float uTime;
uniform float uFuzz;
uniform vec3 uVolumeMin;
uniform vec3 uVolumeMax;
uniform vec3 uCameraPos;

varying vec3 vWorldPos;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float sampleAngleIndex(float phiNorm) {
  float phi = clamp(phiNorm, 0.0, 0.999999) * 65536.0;
  float x = mod(floor(phi), 256.0);
  float y = floor(floor(phi) / 256.0);
  vec2 uv = vec2((x + 0.5) / 256.0, (y + 0.5) / 256.0);
  return texture2D(uAngleIndex, uv).r;
}

float sampleVolumeNearest(float radiusIndex, float thetaIndex, float sweepIndex) {
  float dataLine = thetaIndex + sweepIndex * uThetaSizePadded;
  float actualLine = floor(dataLine / uRaysPerLine);
  float lineOffset = mod(dataLine, uRaysPerLine) * uRadiusSize;
  float x = radiusIndex + lineOffset;
  vec2 uv = vec2((x + 0.5) / uVolumeTexSize.x, (actualLine + 0.5) / uVolumeTexSize.y);
  return texture2D(uVolume, uv).r;
}

float sampleVolumeTrilinear(float radiusIndex, float thetaIndex, float sweepIndex) {
  float r = radiusIndex - 0.5;
  float t = thetaIndex - 0.5;
  float s = sweepIndex;

  float r0 = clamp(floor(r), 0.0, uRadiusSize - 2.0);
  float t0 = clamp(floor(t), 0.0, uThetaSizePadded - 2.0);
  float s0 = clamp(floor(s), 0.0, max(0.0, uSweepCount - 2.0));

  float rf = clamp(fract(r), 0.0, 1.0);
  float tf = clamp(fract(t), 0.0, 1.0);
  float sf = clamp(fract(s), 0.0, 1.0);

  float v000 = sampleVolumeNearest(r0,     t0,     s0);
  float v100 = sampleVolumeNearest(r0 + 1.0, t0,     s0);
  float v010 = sampleVolumeNearest(r0,     t0 + 1.0, s0);
  float v110 = sampleVolumeNearest(r0 + 1.0, t0 + 1.0, s0);
  float v001 = sampleVolumeNearest(r0,     t0,     s0 + 1.0);
  float v101 = sampleVolumeNearest(r0 + 1.0, t0,     s0 + 1.0);
  float v011 = sampleVolumeNearest(r0,     t0 + 1.0, s0 + 1.0);
  float v111 = sampleVolumeNearest(r0 + 1.0, t0 + 1.0, s0 + 1.0);

  // Exclude trilinear fringes if ANY neighbor is NO_DATA (-9999)
  // This prevents NO_DATA from dragging down valid velocities and causing false intense boundaries.
  if (v000 < -9000.0 || v100 < -9000.0 || v010 < -9000.0 || v110 < -9000.0 ||
      v001 < -9000.0 || v101 < -9000.0 || v011 < -9000.0 || v111 < -9000.0) {
    return -9999.0;
  }

  // Skip clamping to uValueLower here so that NO_DATA (-9999) 
  // propagates through mix() and can be thresholded out in sampleValueIndex.

  float v00 = mix(v000, v100, rf);
  float v10 = mix(v010, v110, rf);
  float v01 = mix(v001, v101, rf);
  float v11 = mix(v011, v111, rf);

  float v0 = mix(v00, v10, tf);
  float v1 = mix(v01, v11, tf);
  return mix(v0, v1, sf);
}

vec4 sampleValueIndex(float value) {
  if (value < uValueLower - 5.0) return vec4(0.0);
  float mapped = clamp((value - uValueLower) / max(0.0001, uValueUpper - uValueLower), 0.0, 1.0) * 16383.0;
  float x = mod(floor(mapped), 128.0);
  float y = floor(floor(mapped) / 128.0);
  vec2 uv = vec2((x + 0.5) / 128.0, (y + 0.5) / 128.0);
  return texture2D(uValueIndex, uv);
}

void main() {
  vec3 rayDir = normalize(vWorldPos - uCameraPos);

  // Calculate ray-box intersection from camera position
  vec3 ro = uCameraPos;
  vec3 rd = rayDir;
  vec3 invDir = 1.0 / max(abs(rd), vec3(1e-5));
  vec3 t1 = (uVolumeMin - ro) * invDir * sign(rd);
  vec3 t2 = (uVolumeMax - ro) * invDir * sign(rd);

  vec3 tMin = min(t1, t2);
  vec3 tMax = max(t1, t2);

  float tNear = max(max(tMin.x, tMin.y), tMin.z);
  float tFar = min(min(tMax.x, tMax.y), tMax.z);

  if (tFar < tNear || tFar < 0.0) {
    discard;
  }

  // travel is distance from camera, don't start behind camera
  float travel = max(0.0, tNear);
  if (travel >= tFar) {
    discard;
  }
  if (uFuzz > 0.5) {
    travel += hash12(gl_FragCoord.xy + vec2(uTime * 29.0, uTime * 11.0)) * uStepKm;
  }

  float alpha = 0.0;
  vec3 color = vec3(0.0);
  float stepBins = uStepKm / max(0.0001, uBinSizeKm);

  for (int i = 0; i < ${SHADER_MAX_STEPS}; i++) {
    if (float(i) >= uMaxSteps || alpha >= 0.90 || travel > tFar) {
      break;
    }

    vec3 sampleWorld = ro + rd * travel;
    vec3 radar = vec3(sampleWorld.x, sampleWorld.z, sampleWorld.y / max(0.0001, uVerticalScale));

    float radiusKm = length(radar);
    float radiusIndex = (radiusKm - uInnerDistanceKm) / max(0.0001, uBinSizeKm);

    if (radiusIndex >= 0.0 && radiusIndex < (uRadiusSize - 1.0) && radiusKm > 0.0001) {
      float theta = atan(radar.y, radar.x);
      float thetaNorm = theta / (6.28318530718) + 0.25;
      if (thetaNorm < 0.0) {
        thetaNorm += 1.0;
      }
      float thetaTex = thetaNorm * uThetaSize + 1.0;

      float phi = acos(clamp(radar.z / radiusKm, -1.0, 1.0));
      float phiNorm = 1.0 - phi / 3.14159265359;
      float sweep = sampleAngleIndex(phiNorm);

      if (sweep >= 0.0) {
        float localValue = uMode >= 1.0
          ? sampleVolumeTrilinear(radiusIndex, thetaTex, sweep)
          : sampleVolumeNearest(floor(radiusIndex), floor(thetaTex), floor(sweep + 0.5));
        vec4 mapped = sampleValueIndex(localValue);

        float localAlpha = (1.0 - alpha) * mapped.a * stepBins / 100.0 * uOpacityScale;
        color += mapped.rgb * localAlpha;
        alpha += localAlpha;
      }
    }

    travel += uStepKm;
  }

  if (alpha <= 0.0001) {
    discard;
  }

  gl_FragColor = vec4(color / alpha, alpha);
}
`;

interface VolumeUniforms {
  [uniform: string]: THREE.IUniform;
  uVolume: THREE.IUniform<THREE.Texture | null>;
  uAngleIndex: THREE.IUniform<THREE.Texture | null>;
  uValueIndex: THREE.IUniform<THREE.Texture | null>;
  uVolumeTexSize: THREE.IUniform<THREE.Vector2>;
  uRadiusSize: THREE.IUniform<number>;
  uThetaSize: THREE.IUniform<number>;
  uThetaSizePadded: THREE.IUniform<number>;
  uSweepCount: THREE.IUniform<number>;
  uRaysPerLine: THREE.IUniform<number>;
  uValueLower: THREE.IUniform<number>;
  uValueUpper: THREE.IUniform<number>;
  uInnerDistanceKm: THREE.IUniform<number>;
  uBinSizeKm: THREE.IUniform<number>;
  uVerticalScale: THREE.IUniform<number>;
  uStepKm: THREE.IUniform<number>;
  uMaxSteps: THREE.IUniform<number>;
  uMode: THREE.IUniform<number>;
  uOpacityScale: THREE.IUniform<number>;
  uTime: THREE.IUniform<number>;
  uFuzz: THREE.IUniform<number>;
  uVolumeMin: THREE.IUniform<THREE.Vector3>;
  uVolumeMax: THREE.IUniform<THREE.Vector3>;
  uCameraPos: THREE.IUniform<THREE.Vector3>;
}


export type RenderingQuality = "high" | "medium" | "low";

export class RadarVolumeNode {
  public mesh: THREE.Mesh<THREE.BoxGeometry, THREE.ShaderMaterial>;
  
  private volumeTexture: THREE.DataTexture | null = null;
  private angleIndexTexture: THREE.DataTexture | null = null;
  private valueIndexTexture: THREE.DataTexture | null = null;
  public renderingQuality: RenderingQuality = "high";

  constructor() {
    const uniforms: VolumeUniforms = {
      uVolume: { value: null },
      uAngleIndex: { value: null },
      uValueIndex: { value: null },
      uVolumeTexSize: { value: new THREE.Vector2(1, 1) },
      uRadiusSize: { value: 1 },
      uThetaSize: { value: 1 },
      uThetaSizePadded: { value: 3 },
      uSweepCount: { value: 1 },
      uRaysPerLine: { value: 1 },
      uValueLower: { value: -20 },
      uValueUpper: { value: 80 },
      uInnerDistanceKm: { value: 0 },
      uBinSizeKm: { value: 1 },
      uVerticalScale: { value: VERTICAL_SCALE },
      uStepKm: { value: 0.5 },
      uMaxSteps: { value: 128 },
      uMode: { value: 1 },
      uOpacityScale: { value: 1.0 },
      uTime: { value: 0 },
      uFuzz: { value: 1 },
      uVolumeMin: { value: new THREE.Vector3(-100, 0, -100) },
      uVolumeMax: { value: new THREE.Vector3(100, 20, 100) },
      uCameraPos: { value: new THREE.Vector3() },
    };

    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      side: THREE.BackSide,
      depthWrite: false, 
      depthTest: true,
    });

    this.mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
    this.mesh.visible = false;
  }

  public updateTime(time: number, cameraPosition: THREE.Vector3) {
    const uniforms = this.mesh.material.uniforms as unknown as VolumeUniforms;
    uniforms.uTime.value = time;
    uniforms.uCameraPos.value.copy(cameraPosition);
  }

  public updateVolume(
    data: Float32Array, 
    metadata: RadarVolumeMeta, 
    thresholdDbz: number, 
    maxTextureSize: number
  ): number {
    const packed = buildPackedRadarVolume(data, metadata, maxTextureSize);
    const angleIndex = buildAngleIndexTexture(metadata);
    const valueIndex = buildValueIndexTexture(metadata, thresholdDbz);

    this.replaceTextures(packed, angleIndex, valueIndex.data);

    const rangeKm = Math.max(5, packed.maxRangeKm);
    const maxHeightKm = Math.max(2, packed.maxHeightKm);

    const volumeMin = new THREE.Vector3(-rangeKm, 0, -rangeKm);
    const volumeMax = new THREE.Vector3(rangeKm, maxHeightKm, rangeKm);

    this.mesh.position.set(0, (volumeMin.y + volumeMax.y) * 0.5, 0);
    this.mesh.scale.set(
      volumeMax.x - volumeMin.x,
      volumeMax.y - volumeMin.y,
      volumeMax.z - volumeMin.z
    );
    this.mesh.visible = true;

    const uniforms = this.mesh.material.uniforms as unknown as VolumeUniforms;
    uniforms.uVolumeTexSize.value.set(packed.width, packed.height);
    uniforms.uRadiusSize.value = packed.radiusSize;
    uniforms.uThetaSize.value = packed.thetaSize;
    uniforms.uThetaSizePadded.value = packed.paddedTheta;
    uniforms.uSweepCount.value = packed.sweepCount;
    uniforms.uRaysPerLine.value = packed.raysPerLine;
    uniforms.uValueLower.value = valueIndex.lower;
    uniforms.uValueUpper.value = valueIndex.upper;
    uniforms.uInnerDistanceKm.value = packed.innerDistanceKm;
    uniforms.uBinSizeKm.value = packed.binSizeKm;
    uniforms.uVerticalScale.value = VERTICAL_SCALE;

    // Apply Levels of Detail (LOD) settings based on RenderingQuality
    const isMedium = this.renderingQuality === "medium";
    const isLow = this.renderingQuality === "low";
    
    // Low quality = 2.0x step size (fewer steps), Medium = 1.3x, High = 1.0x
    const lodMultiplier = isLow ? 2.0 : isMedium ? 1.3 : 1.0;
    // Step loop bounds
    const maxShaderStepsCount = isLow ? 128 : isMedium ? 256 : SHADER_MAX_STEPS;

    const desiredStepKm = Math.max(0.05, packed.binSizeKm) * lodMultiplier;
    const volumeDepthKm = Math.max(20, rangeKm * 2.2);
    // Use lodMultiplier effectively on step computation
    const stepKm = Math.max(desiredStepKm, volumeDepthKm / maxShaderStepsCount);
    const maxSteps = Math.max(32, Math.min(maxShaderStepsCount, Math.ceil(volumeDepthKm / stepKm)));

    uniforms.uStepKm.value = stepKm;
    uniforms.uMaxSteps.value = maxSteps;
    uniforms.uMode.value = isLow ? 0 : 1; // Nearest neighbor (0) on low quality, trilinear (1) on medium/high
    uniforms.uOpacityScale.value = 1.35;
    uniforms.uFuzz.value = 1;
    uniforms.uVolumeMin.value.copy(volumeMin);
    uniforms.uVolumeMax.value.copy(volumeMax);

    return packed.radiusSize * packed.thetaSize * packed.sweepCount;
  }

  public clearVolume(): void {
    this.mesh.visible = false;
  }

  public dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();

    this.disposeTexture(this.volumeTexture);
    this.disposeTexture(this.angleIndexTexture);
    this.disposeTexture(this.valueIndexTexture);
  }

  private replaceTextures(
    packed: PackedRadarVolume,
    angleIndex: Float32Array,
    valueIndex: Float32Array
  ): void {
    this.disposeTexture(this.volumeTexture);
    this.disposeTexture(this.angleIndexTexture);
    this.disposeTexture(this.valueIndexTexture);

    this.volumeTexture = new THREE.DataTexture(
      new Float32Array(packed.data),
      packed.width,
      packed.height,
      THREE.RedFormat,
      THREE.FloatType
    );
    this.volumeTexture.minFilter = THREE.NearestFilter;
    this.volumeTexture.magFilter = THREE.NearestFilter;
    this.volumeTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.volumeTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.volumeTexture.generateMipmaps = false;
    this.volumeTexture.needsUpdate = true;

    this.angleIndexTexture = new THREE.DataTexture(
      new Float32Array(angleIndex),
      256,
      256,
      THREE.RedFormat,
      THREE.FloatType
    );
    this.angleIndexTexture.minFilter = THREE.NearestFilter;
    this.angleIndexTexture.magFilter = THREE.NearestFilter;
    this.angleIndexTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.angleIndexTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.angleIndexTexture.generateMipmaps = false;
    this.angleIndexTexture.needsUpdate = true;

    this.valueIndexTexture = new THREE.DataTexture(
      new Float32Array(valueIndex),
      128,
      128,
      THREE.RGBAFormat,
      THREE.FloatType
    );
    this.valueIndexTexture.minFilter = THREE.NearestFilter;
    this.valueIndexTexture.magFilter = THREE.NearestFilter;
    this.valueIndexTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.valueIndexTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.valueIndexTexture.generateMipmaps = false;
    this.valueIndexTexture.needsUpdate = true;

    const uniforms = this.mesh.material.uniforms as unknown as VolumeUniforms;
    uniforms.uVolume.value = this.volumeTexture;
    uniforms.uAngleIndex.value = this.angleIndexTexture;
    uniforms.uValueIndex.value = this.valueIndexTexture;
  }

  private disposeTexture(texture: THREE.Texture | null): void {
    if (texture) {
      texture.dispose();
    }
  }
}
