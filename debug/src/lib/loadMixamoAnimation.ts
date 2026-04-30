import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { VRM } from "@pixiv/three-vrm";
import { mixamoVRMRigMap } from "./mixamoVRMRigMap";

export async function loadMixamoAnimation(url: string, vrm: VRM): Promise<THREE.AnimationClip> {
  const loader = new FBXLoader();
  const asset = await loader.loadAsync(url);

  const clip = THREE.AnimationClip.findByName(asset.animations, "mixamo.com") ?? asset.animations[0];
  if (!clip) {
    throw new Error(`No animation clip found in ${url}`);
  }

  const tracks: THREE.KeyframeTrack[] = [];
  const restRotationInverse = new THREE.Quaternion();
  const parentRestWorldRotation = new THREE.Quaternion();
  const quat = new THREE.Quaternion();

  const motionHips = asset.getObjectByName("mixamorigHips");
  const motionHipsHeight = motionHips?.position.y ?? 0;
  const vrmHipsHeight = vrm.humanoid.normalizedRestPose.hips?.position?.[1] ?? 0;
  const hipsPositionScale = motionHipsHeight !== 0 ? vrmHipsHeight / motionHipsHeight : 1;

  clip.tracks.forEach((track) => {
    const [mixamoRigName, propertyName] = track.name.split(".");
    const vrmBoneName = mixamoVRMRigMap[mixamoRigName];
    const vrmNode = vrmBoneName ? vrm.humanoid.getNormalizedBoneNode(vrmBoneName as never) : null;
    const mixamoRigNode = asset.getObjectByName(mixamoRigName);

    if (vrmNode == null || mixamoRigNode == null || propertyName == null) return;

    mixamoRigNode.getWorldQuaternion(restRotationInverse).invert();
    mixamoRigNode.parent?.getWorldQuaternion(parentRestWorldRotation);

    if (track instanceof THREE.QuaternionKeyframeTrack) {
      const values = track.values.slice();

      for (let i = 0; i < values.length; i += 4) {
        quat.fromArray(values, i);
        quat.premultiply(parentRestWorldRotation).multiply(restRotationInverse);
        quat.toArray(values, i);
      }

      const isVRM0 = vrm.meta?.metaVersion === "0";
      tracks.push(
        new THREE.QuaternionKeyframeTrack(
          `${vrmNode.name}.${propertyName}`,
          track.times,
          isVRM0 ? values.map((value, index) => (index % 2 === 0 ? -value : value)) : values,
        ),
      );
      return;
    }

    if (track instanceof THREE.VectorKeyframeTrack) {
      const isVRM0 = vrm.meta?.metaVersion === "0";
      const values = track.values.map((value, index) => {
        const flipped = isVRM0 && index % 3 !== 1 ? -value : value;
        return propertyName === "position" ? flipped * hipsPositionScale : flipped;
      });

      tracks.push(
        new THREE.VectorKeyframeTrack(`${vrmNode.name}.${propertyName}`, track.times, values),
      );
    }
  });

  return new THREE.AnimationClip("vrmAnimation", clip.duration, tracks);
}
