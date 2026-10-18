/**
 * 高画质后处理管线。
 *
 * 顺序：RenderPass → SSAO（轻）→ UnrealBloom（低强度、高阈值）→
 * 色彩分级（低饱和、暖高光/冷暗部、暗角、轻颗粒）→ SMAA → OutputPass。
 * FXAA 只在 SMAA 不可用时作为 OutputPass 之后的替代抗锯齿。
 *
 * Three.js 0.186.1 自带下列 addon（已核对存在）：
 * - `postprocessing/EffectComposer.js`
 * - `postprocessing/RenderPass.js`
 * - `postprocessing/SSAOPass.js`
 * - `postprocessing/UnrealBloomPass.js`
 * - `postprocessing/ShaderPass.js`
 * - `postprocessing/SMAAPass.js`
 * - `postprocessing/FXAAPass.js`
 * - `postprocessing/OutputPass.js`
 *
 * 任何单个 pass 创建失败都会记录具体错误并跳过该 pass；如果整条 composer
 * 无法建立，则降级为 `RenderPass + OutputPass` 的最小高画质路径。只有最小
 * 路径也失败时才抛错，由渲染器退回直接渲染并记录原因。
 */

import { Vector2 } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/** 色彩分级 + 暗角 + 颗粒的合并着色器，减少一个全屏 pass。 */
export const COLOR_GRADE_SHADER = Object.freeze({
  name: 'DustlineColorGrade',
  uniforms: Object.freeze({
    tDiffuse: { value: null },
    saturation: { value: 0.86 },
    vignette: { value: 0.22 },
    grain: { value: 0.03 },
    time: { value: 0 }
  }),
  vertexShader: /* glsl */ `
    varying vec2 vUv;

    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float saturation;
    uniform float vignette;
    uniform float grain;
    uniform float time;
    varying vec2 vUv;

    float hash(vec2 point) {
      return fract(sin(dot(point, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec4 source = texture2D(tDiffuse, vUv);
      vec3 color = source.rgb;

      float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
      color = mix(vec3(luminance), color, saturation);

      // 暗部偏冷、高光偏暖；中间调保持中性，避免极端青橙。
      vec3 coolShadow = vec3(0.94, 0.98, 1.05);
      vec3 warmHighlight = vec3(1.045, 1.0, 0.95);
      float highlightWeight = smoothstep(0.25, 0.78, luminance);
      color = color * mix(coolShadow, warmHighlight, highlightWeight);

      float edge = distance(vUv, vec2(0.5));
      float vignetteWeight = smoothstep(0.32, 0.86, edge);
      color = color * (1.0 - vignette * vignetteWeight);

      float noise = hash(vUv * 1024.0 + vec2(time * 3.17, time * 1.73));
      color = color + vec3((noise - 0.5) * grain);

      gl_FragColor = vec4(color, source.a);
    }
  `
});

/** 报告给渲染器的 pass 名称顺序。 */
export const POST_PROCESSING_PASS_NAMES = Object.freeze([
  'render',
  'ssao',
  'bloom',
  'color-grade',
  'antialiasing',
  'output'
]);

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isObject(value) {
  return value !== null && typeof value === 'object';
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isFinitePositive(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * 创建一个 pass 并记录失败原因；失败时返回 null，不中断整条管线。
 *
 * @param {string} passName
 * @param {() => unknown} factory
 * @param {string[]} fallbacks
 * @returns {unknown|null}
 */
function createOptionalPass(passName, factory, fallbacks) {
  try {
    return factory();
  } catch (error) {
    console.error(
      '[post-processing] 创建 ' + passName + ' 失败，跳过该效果: ',
      error
    );
    fallbacks.push(passName);
    return null;
  }
}

/**
 * @param {unknown} pass
 * @returns {void}
 */
function disposePass(pass) {
  if (pass === null || pass === undefined) {
    return;
  }
  if (typeof pass.dispose === 'function') {
    pass.dispose();
  }
}

/**
 * 创建高画质后处理管线。
 *
 * @param {{
 *   renderer: unknown,
 *   scene: unknown,
 *   camera: unknown,
 *   width: number,
 *   height: number
 * }} options
 * @returns {{
 *   render: () => void,
 *   setSize: (width: number, height: number) => void,
 *   dispose: () => void,
 *   getPasses: () => string[],
 *   getFallbacks: () => string[],
 *   isDegraded: () => boolean
 * }}
 */
export function createPostProcessing(options) {
  if (!isObject(options)) {
    throw new TypeError('createPostProcessing 需要 { renderer, scene, camera, width, height }');
  }
  const source = /** @type {Record<string, unknown>} */ (options);
  const renderer = source.renderer;
  const scene = source.scene;
  const camera = source.camera;
  if (renderer === null || renderer === undefined) {
    throw new TypeError('createPostProcessing 需要 WebGLRenderer');
  }
  if (scene === null || scene === undefined) {
    throw new TypeError('createPostProcessing 需要 Scene');
  }
  if (camera === null || camera === undefined) {
    throw new TypeError('createPostProcessing 需要 Camera');
  }
  if (!isFinitePositive(source.width) || !isFinitePositive(source.height)) {
    throw new RangeError('createPostProcessing 的 width/height 必须是大于 0 的有限数字');
  }

  let width = /** @type {number} */ (source.width);
  let height = /** @type {number} */ (source.height);
  const fallbacks = [];
  const passes = [];
  const createdPasses = [];

  /** @type {unknown} */
  let composer = null;
  /** @type {unknown} */
  let pendingComposer = null;
  /** @type {unknown} */
  let gradePass = null;
  let degraded = false;
  let disposed = false;
  let startedAt = 0;
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    startedAt = performance.now();
  }

  /**
   * 建立最小可用管线：RenderPass + OutputPass。整条完整管线失败时使用。
   *
   * @returns {unknown}
   */
  function createMinimalComposer() {
    const minimal = new EffectComposer(renderer);
    try {
      minimal.setSize(width, height);
      const renderPass = new RenderPass(scene, camera);
      const outputPass = new OutputPass();
      minimal.addPass(renderPass);
      minimal.addPass(outputPass);
      createdPasses.push(renderPass, outputPass);
      passes.length = 0;
      passes.push('render', 'output');
      return minimal;
    } catch (error) {
      minimal.dispose();
      throw error;
    }
  }

  try {
    const fullComposer = new EffectComposer(renderer);
    pendingComposer = fullComposer;
    fullComposer.setSize(width, height);

    const renderPass = new RenderPass(scene, camera);
    fullComposer.addPass(renderPass);
    createdPasses.push(renderPass);
    passes.push('render');

    const ssaoPass = createOptionalPass(
      'ssao',
      () => {
        const pass = new SSAOPass(scene, camera, width, height, 16);
        pass.kernelRadius = 1.0;
        pass.minDistance = 0.002;
        pass.maxDistance = 0.1;
        pass.output = SSAOPass.OUTPUT.Default;
        return pass;
      },
      fallbacks
    );
    if (ssaoPass !== null) {
      fullComposer.addPass(ssaoPass);
      createdPasses.push(ssaoPass);
      passes.push('ssao');
    }

    const bloomPass = createOptionalPass(
      'bloom',
      () => {
        const pass = new UnrealBloomPass(
          new Vector2(width, height),
          0.28,
          0.35,
          0.85
        );
        return pass;
      },
      fallbacks
    );
    if (bloomPass !== null) {
      fullComposer.addPass(bloomPass);
      createdPasses.push(bloomPass);
      passes.push('bloom');
    }

    const colorGradePass = createOptionalPass(
      'color-grade',
      () => new ShaderPass(COLOR_GRADE_SHADER),
      fallbacks
    );
    if (colorGradePass !== null) {
      fullComposer.addPass(colorGradePass);
      createdPasses.push(colorGradePass);
      gradePass = colorGradePass;
      passes.push('color-grade');
    }

    const smaaPass = createOptionalPass('smaa', () => new SMAAPass(), fallbacks);
    if (smaaPass !== null) {
      fullComposer.addPass(smaaPass);
      createdPasses.push(smaaPass);
      passes.push('antialiasing');
    }

    const outputPass = new OutputPass();
    fullComposer.addPass(outputPass);
    createdPasses.push(outputPass);
    passes.push('output');

    if (smaaPass === null) {
      const fxaaPass = createOptionalPass('fxaa', () => new FXAAPass(), fallbacks);
      if (fxaaPass !== null) {
        fullComposer.addPass(fxaaPass);
        createdPasses.push(fxaaPass);
        passes.push('antialiasing');
      }
    }

    composer = fullComposer;
    pendingComposer = null;
  } catch (error) {
    console.error(
      '[post-processing] 完整后处理管线创建失败，降级为 RenderPass + OutputPass: ',
      error
    );
    fallbacks.push('full-pipeline');
    degraded = true;
    for (const pass of createdPasses) {
      disposePass(pass);
    }
    createdPasses.length = 0;
    passes.length = 0;
    if (pendingComposer !== null) {
      const pendingValue = /** @type {{dispose?: () => void}} */ (pendingComposer);
      if (typeof pendingValue.dispose === 'function') {
        pendingValue.dispose();
      }
      pendingComposer = null;
    }
    try {
      composer = createMinimalComposer();
    } catch (minimalError) {
      console.error(
        '[post-processing] 最小后处理管线也创建失败，渲染器将直接渲染: ',
        minimalError
      );
      throw minimalError;
    }
  }

  /**
   * @returns {void}
   */
  function render() {
    if (disposed) {
      return;
    }
    if (gradePass !== null) {
      let now = startedAt + 1;
      if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
        now = performance.now();
      }
      const uniforms = /** @type {{uniforms: Record<string, {value: unknown}>}} */ (gradePass).uniforms;
      if (uniforms !== undefined && uniforms.time !== undefined) {
        uniforms.time.value = (now - startedAt) / 1000;
      }
    }
    /** @type {{render: () => void}} */ (composer).render();
  }

  /**
   * @param {number} nextWidth
   * @param {number} nextHeight
   * @returns {void}
   */
  function setSize(nextWidth, nextHeight) {
    if (!isFinitePositive(nextWidth) || !isFinitePositive(nextHeight)) {
      throw new RangeError('post-processing.setSize 的宽高必须是大于 0 的有限数字');
    }
    width = nextWidth;
    height = nextHeight;
    /** @type {{setSize: (w: number, h: number) => void}} */ (composer).setSize(width, height);
  }

  /**
   * @returns {void}
   */
  function dispose() {
    if (disposed) {
      return;
    }
    disposed = true;
    for (const pass of createdPasses) {
      disposePass(pass);
    }
    createdPasses.length = 0;
    const composerValue = /** @type {{dispose?: () => void}} */ (composer);
    if (typeof composerValue.dispose === 'function') {
      composerValue.dispose();
    }
    composer = null;
    gradePass = null;
  }

  return {
    render,
    setSize,
    dispose,
    getPasses() {
      return passes.slice();
    },
    getFallbacks() {
      return fallbacks.slice();
    },
    isDegraded() {
      return degraded;
    }
  };
}
