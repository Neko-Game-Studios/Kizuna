import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRM, VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import { loadMixamoAnimation } from "../lib/loadMixamoAnimation";

type Props = { isDark: boolean; isTalking?: boolean };

type FaceMorphTarget = {
  mesh: THREE.Mesh;
  index: number;
  name: string;
  weight: number;
};

export function VrmSidePanel({ isDark, isTalking = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const vrmRef = useRef<VRM | null>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const isTalkingRef = useRef(isTalking);
  const mouthStateRef = useRef({
    aa: 0,
    ih: 0,
    ou: 0,
    ee: 0,
    oh: 0,
    targetAa: 0,
    targetIh: 0,
    targetOu: 0,
    targetEe: 0,
    targetOh: 0,
    nextSwitch: 0,
  });
  const blinkStateRef = useRef({
    value: 0,
    nextBlinkAt: 0,
    startedAt: -1,
  });
  const blinkTargetsRef = useRef<string[]>([]);
  const openEyeMorphTargetsRef = useRef<FaceMorphTarget[]>([]);
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);

  const applyIdleAnimation = (vrm: VRM, elapsed: number) => {
    const humanoid = vrm.humanoid;

    const breathCycle = Math.sin(elapsed * 1.5) * 0.5 + 0.5;
    const breathIntensity = 0.015;
    const chestBone = humanoid.getNormalizedBone("chest");
    if (chestBone) {
      chestBone.node.scale.set(
        1 + breathCycle * breathIntensity,
        1 + breathCycle * breathIntensity * 0.5,
        1 + breathCycle * breathIntensity,
      );
    }

    const swayBone = humanoid.getNormalizedBone("hips");
    if (swayBone) {
      swayBone.node.rotation.z = Math.sin(elapsed * 0.4) * 0.01;
      swayBone.node.rotation.y = Math.sin(elapsed * 0.25) * 0.02;
    }

    const neckBone = humanoid.getNormalizedBone("neck");
    if (neckBone) neckBone.node.rotation.x = -0.08;

    const headBone = humanoid.getNormalizedBone("head");
    if (headBone) headBone.node.rotation.x = -0.16;

    const leftUpperArm = humanoid.getNormalizedBone("leftUpperArm");
    const rightUpperArm = humanoid.getNormalizedBone("rightUpperArm");
    const leftLowerArm = humanoid.getNormalizedBone("leftLowerArm");
    const rightLowerArm = humanoid.getNormalizedBone("rightLowerArm");

    if (leftUpperArm) {
      leftUpperArm.node.rotation.z = -0.56;
      leftUpperArm.node.rotation.x = 0.06;
      leftUpperArm.node.rotation.y = -0.03;
    }
    if (rightUpperArm) {
      rightUpperArm.node.rotation.z = 0.56;
      rightUpperArm.node.rotation.x = 0.06;
      rightUpperArm.node.rotation.y = 0.03;
    }
    if (leftLowerArm) {
      leftLowerArm.node.rotation.x = -0.42;
      leftLowerArm.node.rotation.z = -0.02;
    }
    if (rightLowerArm) {
      rightLowerArm.node.rotation.x = -0.42;
      rightLowerArm.node.rotation.z = 0.02;
    }
  };

  const applyArmOffset = (vrm: VRM) => {
    const humanoid = vrm.humanoid;

    const leftUpperArm = humanoid.getNormalizedBone("leftUpperArm");
    const rightUpperArm = humanoid.getNormalizedBone("rightUpperArm");
    const leftLowerArm = humanoid.getNormalizedBone("leftLowerArm");
    const rightLowerArm = humanoid.getNormalizedBone("rightLowerArm");

    if (leftUpperArm) {
      leftUpperArm.node.rotation.z += 0.18;
      leftUpperArm.node.rotation.x += 0.03;
    }
    if (rightUpperArm) {
      rightUpperArm.node.rotation.z -= 0.18;
      rightUpperArm.node.rotation.x += 0.03;
    }
    if (leftLowerArm) {
      leftLowerArm.node.rotation.z += 0.06;
    }
    if (rightLowerArm) {
      rightLowerArm.node.rotation.z -= 0.06;
    }
  };

  const updateBlinkValue = (elapsed: number, deltaTime: number) => {
    const blink = blinkStateRef.current;
    const blinkDuration = 0.16;

    if (blink.nextBlinkAt === 0) blink.nextBlinkAt = elapsed + 2 + Math.random() * 3;
    if (blink.startedAt < 0 && elapsed >= blink.nextBlinkAt) blink.startedAt = elapsed;

    if (blink.startedAt >= 0) {
      const progress = (elapsed - blink.startedAt) / blinkDuration;
      if (progress >= 1) {
        blink.value = 0;
        blink.startedAt = -1;
        blink.nextBlinkAt = elapsed + 2 + Math.random() * 3;
      } else {
        blink.value = Math.sin(progress * Math.PI) * 0.85;
      }
    } else if (deltaTime >= 0) {
      blink.value = 0;
    }

    return blink.value;
  };

  const applyBlinkExpressions = (vrm: VRM, value: number) => {
    const expressionManager = vrm.expressionManager;
    if (!expressionManager) return;

    for (const target of blinkTargetsRef.current) {
      expressionManager.setValue(target, value);
    }
  };

  const applyOpenEyeMorphs = (blinkValue: number) => {
    for (const target of openEyeMorphTargetsRef.current) {
      if (target.mesh.morphTargetInfluences?.[target.index] !== undefined) {
        target.mesh.morphTargetInfluences[target.index] = target.weight * (1 - blinkValue);
      }
    }
  };

  const findOpenEyeMorphTargets = (root: THREE.Object3D) => {
    const matches: FaceMorphTarget[] = [];

    root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      const dictionary = mesh.morphTargetDictionary;
      if (!dictionary || !mesh.morphTargetInfluences) return;

      for (const [name, index] of Object.entries(dictionary)) {
        if (/eye.*spread/i.test(name)) {
          matches.push({ mesh, index, name, weight: 0.65 });
        }
      }
    });

    return matches;
  };

  const applyTalkingAnimation = (
    vrm: VRM,
    elapsed: number,
    deltaTime: number,
    talking: boolean,
  ) => {
    const expressionManager = vrm.expressionManager;
    if (!expressionManager) return;

    const mouth = mouthStateRef.current;
    const smoothing = 1 - Math.exp(-deltaTime * 20);

    if (!talking) {
      mouth.targetAa = 0;
      mouth.targetIh = 0;
      mouth.targetOu = 0;
      mouth.targetEe = 0;
      mouth.targetOh = 0;
    } else if (elapsed >= mouth.nextSwitch) {
      const shouldPause = Math.random() < 0.18;
      const energy = 0.45 + Math.random() * 0.55;

      if (shouldPause) {
        mouth.targetAa = 0;
        mouth.targetIh = 0;
        mouth.targetOu = 0;
        mouth.targetEe = 0;
        mouth.targetOh = 0;
        mouth.nextSwitch = elapsed + 0.05 + Math.random() * 0.08;
      } else {
        const viseme = Math.floor(Math.random() * 5);
        const secondary = Math.floor(Math.random() * 5);
        mouth.targetAa = viseme === 0 ? energy : secondary === 0 ? energy * 0.18 : 0;
        mouth.targetIh = viseme === 1 ? energy * 0.85 : secondary === 1 ? energy * 0.16 : 0;
        mouth.targetOu = viseme === 2 ? energy * 0.78 : secondary === 2 ? energy * 0.2 : 0;
        mouth.targetEe = viseme === 3 ? energy * 0.82 : secondary === 3 ? energy * 0.18 : 0;
        mouth.targetOh = viseme === 4 ? energy * 0.9 : secondary === 4 ? energy * 0.2 : 0;
        mouth.nextSwitch = elapsed + 0.07 + Math.random() * 0.11;
      }
    }

    mouth.aa += (mouth.targetAa - mouth.aa) * smoothing;
    mouth.ih += (mouth.targetIh - mouth.ih) * smoothing;
    mouth.ou += (mouth.targetOu - mouth.ou) * smoothing;
    mouth.ee += (mouth.targetEe - mouth.ee) * smoothing;
    mouth.oh += (mouth.targetOh - mouth.oh) * smoothing;

    expressionManager.setValue("aa", mouth.aa);
    expressionManager.setValue("ih", mouth.ih);
    expressionManager.setValue("ou", mouth.ou);
    expressionManager.setValue("ee", mouth.ee);
    expressionManager.setValue("oh", mouth.oh);
  };

  useEffect(() => {
    isTalkingRef.current = isTalking;
  }, [isTalking]);

  useEffect(() => {
    if (!canvasRef.current) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
    camera.position.set(0, 1, 4.1);

    const renderer = new THREE.WebGLRenderer({
      canvas: canvasRef.current,
      alpha: true,
      antialias: true,
      precision: "highp",
      powerPreference: "high-performance",
    });
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;

    const keyLight = new THREE.DirectionalLight(0xffffff, Math.PI);
    keyLight.position.set(1, 1, 1).normalize();
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0xbfd9ff, 1.2);
    fillLight.position.set(-1.2, 0.8, 1.5).normalize();
    scene.add(fillLight);
    scene.add(new THREE.HemisphereLight(0xf8fbff, 0x1e293b, 1.15));
    scene.add(new THREE.AmbientLight(0xffffff, 1.1));

    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));

    loader.load(
      "/model.vrm",
      (gltf) => {
        const vrm = gltf.userData.vrm as VRM;
        vrmRef.current = vrm;
        scene.add(vrm.scene);

        const expressionManager = vrm.expressionManager;
        if (expressionManager) {
          const mapKeys = Object.keys(expressionManager.expressionMap ?? {});
          if (mapKeys.includes("blink")) {
            blinkTargetsRef.current = ["blink"];
          } else {
            const eyePair = ["blinkLeft", "blinkRight"].filter((name) => mapKeys.includes(name));
            const discovered = mapKeys.filter((name) => /blink|wink|eyeclose|eye_close/i.test(name));
            blinkTargetsRef.current = eyePair.length > 0 ? eyePair : Array.from(new Set(discovered));
          }
        }

        openEyeMorphTargetsRef.current = findOpenEyeMorphTargets(vrm.scene);

        VRMUtils.rotateVRM0(vrm);
        vrm.scene.rotation.y = 0;
        vrm.scene.position.y = -0.5;
        vrm.scene.scale.setScalar(1.15);

        void loadMixamoAnimation("/Idle1.fbx", vrm)
          .then((clip) => {
            const mixer = new THREE.AnimationMixer(vrm.scene);
            mixerRef.current?.stopAllAction();
            mixerRef.current?.uncacheRoot(vrm.scene);
            mixerRef.current = mixer;

            const action = mixer.clipAction(clip);
            action.reset();
            action.setLoop(THREE.LoopRepeat, Infinity);
            action.play();
          })
          .catch((err) => {
            console.error("[vrm] failed to load idle animation", err);
          });

        setStatus("loaded");
      },
      undefined,
      (err) => {
        console.error("[vrm] failed to load", err);
        setLoadError(err instanceof Error ? err.message : String(err));
        setStatus("error");
      },
    );

    const handleResize = () => {
      if (!canvasRef.current) return;
      const width = canvasRef.current.clientWidth;
      const height = canvasRef.current.clientHeight;

      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 3));
    };

    window.addEventListener("resize", handleResize);
    handleResize();

    const clock = new THREE.Clock();
    let animationId = 0;

    const animate = () => {
      animationId = requestAnimationFrame(animate);
      const deltaTime = clock.getDelta();
      const elapsed = clock.getElapsedTime();

      if (vrmRef.current) {
        const blinkValue = updateBlinkValue(elapsed, deltaTime);
        if (!mixerRef.current) {
          applyIdleAnimation(vrmRef.current, elapsed);
        }
        applyBlinkExpressions(vrmRef.current, blinkValue);
        applyTalkingAnimation(vrmRef.current, elapsed, deltaTime, isTalkingRef.current);
        mixerRef.current?.update(deltaTime);
        applyArmOffset(vrmRef.current);
        vrmRef.current.update(deltaTime);
        applyOpenEyeMorphs(blinkValue);
      }

      renderer.render(scene, camera);
    };

    animate();

    return () => {
      window.removeEventListener("resize", handleResize);
      cancelAnimationFrame(animationId);
      mixerRef.current?.stopAllAction();
      if (vrmRef.current) mixerRef.current?.uncacheRoot(vrmRef.current.scene);
      renderer.dispose();
      if (vrmRef.current) VRMUtils.deepDispose(vrmRef.current.scene);
    };
  }, []);

  return (
    <div className="h-full p-4">
      <div
        className={`relative h-full overflow-hidden rounded-2xl border ${
          isDark ? "border-slate-800 bg-slate-950" : "border-slate-200 bg-white"
        }`}
      >
        <div
          className={`absolute left-4 right-4 top-4 z-10 flex items-center justify-between rounded-full border px-4 py-2 backdrop-blur-md ${
            isDark
              ? "border-slate-700/70 bg-slate-950/70 text-slate-200"
              : "border-slate-200/80 bg-white/75 text-slate-800"
          }`}
        >
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              {isTalking && <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 pulse-ring" />}
              <span className={`relative inline-flex h-2 w-2 rounded-full ${isTalking ? "bg-emerald-400" : "bg-slate-500"}`} />
            </span>
            <span className="text-xs font-bold uppercase tracking-wide">Avatar</span>
          </div>
          <span className="mono text-[10px] uppercase tracking-wider text-slate-500">
            {status === "loaded" ? (isTalking ? "talking" : "idle") : status}
          </span>
        </div>

        <div
          className={`absolute inset-0 ${
            isDark
              ? "bg-[radial-gradient(circle_at_50%_22%,rgba(56,189,248,0.18),transparent_34%),linear-gradient(180deg,rgba(15,23,42,0),rgba(2,6,23,0.9))]"
              : "bg-[radial-gradient(circle_at_50%_24%,rgba(14,165,233,0.16),transparent_38%),linear-gradient(180deg,rgba(255,255,255,0),rgba(248,250,252,0.86))]"
          }`}
        />

        <canvas ref={canvasRef} className="relative h-full w-full outline-none" />

        {status === "loading" && (
          <div className={`absolute inset-0 flex items-center justify-center ${isDark ? "bg-slate-950/80" : "bg-white/80"}`}>
            <div className={`rounded-full border px-5 py-3 text-sm ${isDark ? "border-slate-800 bg-slate-900 text-slate-300" : "border-slate-200 bg-white text-slate-600"}`}>
              Initialisiere 3D-Renderer…
            </div>
          </div>
        )}

        {status === "error" && (
          <div className={`absolute inset-0 flex items-center justify-center ${isDark ? "bg-slate-950/85" : "bg-white/85"}`}>
            <div className="rounded-2xl border border-rose-400/35 bg-rose-500/10 px-5 py-4 text-sm text-rose-400">
              {loadError ?? "Avatar konnte nicht geladen werden"}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
