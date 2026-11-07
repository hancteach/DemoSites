// 大量小兵的畫法：每一種小兵只有「一個」InstancedMesh（一次 draw call 畫完幾百隻）。
// 骨架動作事先「烘」成一張貼圖：每一列是某段動作的某一格，存 24 根骨頭的矩陣；
// 頂點著色器依每隻小兵自己的「第幾格」去貼圖拿骨頭矩陣做蒙皮。CPU 每格只要寫一個數字。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const BAKE_FPS = 30;
const CLIPS = ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death', 'Jump'];

export async function loadCrowdType(url, capacity) {
  const gltf = await new GLTFLoader().loadAsync(url);
  const scene = gltf.scene;
  let skinned = null;
  scene.traverse((o) => { if (o.isSkinnedMesh && !skinned) skinned = o; });
  if (!skinned) throw new Error(`${url} 沒有骨架網格`);

  // ---- 烘焙骨頭矩陣 ----
  scene.updateMatrixWorld(true);
  const skeleton = skinned.skeleton;
  const bones = skeleton.bones.length;
  const mixer = new THREE.AnimationMixer(scene);
  const clips = {};
  const rows = [];
  const tmp = new THREE.Matrix4();
  for (const name of CLIPS) {
    const clip = gltf.animations.find((c) => c.name === name);
    if (!clip) continue;
    const frames = Math.max(1, Math.round(clip.duration * BAKE_FPS));
    clips[name] = { start: rows.length, frames, duration: clip.duration };
    const action = mixer.clipAction(clip);
    action.play();
    for (let f = 0; f < frames; f++) {
      action.time = Math.min(clip.duration, f / BAKE_FPS);
      mixer.update(0);
      scene.updateMatrixWorld(true);
      const row = new Float32Array(bones * 16);
      for (let b = 0; b < bones; b++) {
        // 世界座標 = mesh.matrixWorld × bindMatrixInverse × (骨頭世界矩陣 × 骨頭反矩陣) × bindMatrix × 頂點
        tmp.multiplyMatrices(skeleton.bones[b].matrixWorld, skeleton.boneInverses[b]);
        tmp.premultiply(skinned.bindMatrixInverse).premultiply(skinned.matrixWorld).multiply(skinned.bindMatrix);
        row.set(tmp.elements, b * 16);
      }
      rows.push(row);
    }
    action.stop();
  }
  const texData = new Float32Array(rows.length * bones * 16);
  rows.forEach((r, i) => texData.set(r, i * bones * 16));
  const bakeTex = new THREE.DataTexture(texData, bones * 4, rows.length, THREE.RGBAFormat, THREE.FloatType);
  bakeTex.needsUpdate = true;

  // ---- 幾何與材質 ----
  const geometry = skinned.geometry.clone();
  for (const k of Object.keys(geometry.attributes)) if (!['position', 'normal', 'uv', 'skinIndex', 'skinWeight'].includes(k)) geometry.deleteAttribute(k);
  const frameAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage);
  const flashAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aFrame', frameAttr);
  geometry.setAttribute('aFlash', flashAttr);

  const material = new THREE.MeshLambertMaterial({ map: skinned.material.map ?? null });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBake = { value: bakeTex };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform highp sampler2D uBake;
        attribute vec4 skinIndex;
        attribute vec4 skinWeight;
        attribute float aFrame;
        attribute float aFlash;
        varying float vFlash;
        mat4 bakedBone(float bone, int row) {
          int x = int(bone) * 4;
          return mat4(texelFetch(uBake, ivec2(x, row), 0), texelFetch(uBake, ivec2(x + 1, row), 0),
                      texelFetch(uBake, ivec2(x + 2, row), 0), texelFetch(uBake, ivec2(x + 3, row), 0));
        }`)
      .replace('#include <beginnormal_vertex>', `
        int bakeRow = int(aFrame + 0.5);
        mat4 boneMat = bakedBone(skinIndex.x, bakeRow) * skinWeight.x + bakedBone(skinIndex.y, bakeRow) * skinWeight.y
                     + bakedBone(skinIndex.z, bakeRow) * skinWeight.z + bakedBone(skinIndex.w, bakeRow) * skinWeight.w;
        vec3 objectNormal = normalize(mat3(boneMat) * normal);
        vFlash = aFlash;`)
      .replace('#include <begin_vertex>', 'vec3 transformed = (boneMat * vec4(position, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vFlash;')
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
        gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.0, 0.92, 0.75), vFlash);`);
  };

  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false; // 小兵散在整個場地，交給 GPU 處理
  mesh.count = 0;
  return { mesh, clips, frameAttr, flashAttr, bakeTex, capacity };
}

// 動作時間 → 烘焙貼圖的第幾列
export function frameRow(type, clipName, time, loop) {
  const c = type.clips[clipName] ?? type.clips.Idle;
  let f = Math.floor(time * BAKE_FPS);
  f = loop ? f % c.frames : Math.min(f, c.frames - 1);
  return c.start + f;
}
