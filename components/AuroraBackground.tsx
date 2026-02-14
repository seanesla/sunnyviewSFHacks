"use client"

import { useEffect, useRef, useState } from "react"

/* ── helpers ─────────────────────────────────────────────────── */

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0, g = 0, b = 0
  if (h < 60)       { r = c; g = x }
  else if (h < 120) { r = x; g = c }
  else if (h < 180) { g = c; b = x }
  else if (h < 240) { g = x; b = c }
  else if (h < 300) { r = x; b = c }
  else              { r = c; b = x }
  return [r + m, g + m, b + m]
}

function readAccentHue(): number {
  if (typeof document === "undefined") return 220
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--accent-hue").trim()
  const n = parseFloat(raw)
  return Number.isFinite(n) ? n : 220
}

/* ── shaders ─────────────────────────────────────────────────── */

const VERT = `
attribute vec2 a_pos;
void main(){ gl_Position = vec4(a_pos, 0.0, 1.0); }
`

const FRAG = `
precision mediump float;

uniform vec2  u_resolution;
uniform float u_time;
uniform vec2  u_mouse;
uniform vec3  u_color_a;
uniform vec3  u_color_b;
uniform vec3  u_color_c;
uniform vec3  u_color_d;

/* ---- simplex 2D (Ashima Arts) ---- */
vec3 mod289(vec3 x){ return x - floor(x*(1.0/289.0))*289.0; }
vec2 mod289(vec2 x){ return x - floor(x*(1.0/289.0))*289.0; }
vec3 permute(vec3 x){ return mod289(((x*34.0)+1.0)*x); }

float snoise(vec2 v){
  const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                     -0.577350269189626, 0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v -   i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0))
                            + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy),
                           dot(x12.zw,x12.zw)), 0.0);
  m = m*m; m = m*m;
  vec3 x_ = 2.0*fract(p * C.www) - 1.0;
  vec3 h  = abs(x_) - 0.5;
  vec3 ox = floor(x_ + 0.5);
  vec3 a0 = x_ - ox;
  m *= 1.79284291400159 - 0.85373472095314*(a0*a0+h*h);
  vec3 g;
  g.x  = a0.x*x0.x  + h.x*x0.y;
  g.yz = a0.yz*x12.xz + h.yz*x12.yw;
  return 130.0 * dot(m, g);
}

mat2 rot(float a){
  float s = sin(a);
  float c = cos(a);
  return mat2(c, -s, s, c);
}

float fbm(vec2 p){
  float value = 0.0;
  float amp = 0.5;
  for(int i = 0; i < 5; i++){
    value += amp * snoise(p);
    p = rot(0.45) * p * 2.03 + vec2(13.7, 8.3);
    amp *= 0.52;
  }
  return value;
}

void main(){
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 p = uv - 0.5;
  p.x *= u_resolution.x / u_resolution.y;

  float t = u_time;
  vec2 mouse = (u_mouse - 0.5) * vec2(0.35, 0.22);

  vec2 warp = vec2(
    fbm((rot(0.5) * p) * 1.1 + vec2(t * 0.22, -t * 0.18)),
    fbm((rot(-0.5) * p) * 1.1 + vec2(-t * 0.17, t * 0.21))
  );

  vec2 q = p + warp * 0.28 + mouse;
  float layerA = fbm((rot(0.25) * q) * 1.4 + vec2(t * 0.12, -t * 0.08));
  float layerB = fbm((rot(-0.9) * q) * 2.0 + vec2(-t * 0.2, t * 0.16));
  float layerC = fbm((q + vec2(layerA * 0.35, layerB * 0.28)) * 2.6 + vec2(t * 0.11, t * 0.13));

  float field = 0.5 + 0.5 * (0.62 * layerA + 0.3 * layerB + 0.18 * layerC);
  field = clamp(field, 0.0, 1.0);

  vec3 color = mix(u_color_a, u_color_b, smoothstep(0.2, 0.8, field));
  color = mix(color, u_color_c, smoothstep(0.32, 0.98, field + layerB * 0.15));
  color = mix(color, u_color_d, smoothstep(0.55, 1.0, field + layerC * 0.1));

  float grain = snoise(gl_FragCoord.xy * 0.95 + vec2(t * 40.0, -t * 33.0)) * 0.018;
  color += grain;

  float edge = 1.0 - smoothstep(0.58, 1.25, length(p));
  float alpha = 0.46 + edge * 0.24;

  gl_FragColor = vec4(color, alpha);
}
`

/* ── component ───────────────────────────────────────────────── */

function compileShader(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const s = gl.createShader(type)
  if (!s) return null
  gl.shaderSource(s, src)
  gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.warn("AuroraBackground shader error:", gl.getShaderInfoLog(s))
    gl.deleteShader(s)
    return null
  }
  return s
}

export function AuroraBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const mouseRef = useRef<[number, number]>([0.5, 0.5])
  const mouseTargetRef = useRef<[number, number]>([0.5, 0.5])
  const [webglFailed, setWebglFailed] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: false })
    if (!gl) { setWebglFailed(true); return }

    /* compile program */
    const vs = compileShader(gl, gl.VERTEX_SHADER, VERT)
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG)
    if (!vs || !fs) { setWebglFailed(true); return }

    const prog = gl.createProgram()!
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { setWebglFailed(true); return }
    gl.useProgram(prog)

    /* full-screen quad */
    const buf = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW)
    const aPos = gl.getAttribLocation(prog, "a_pos")
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)

    /* uniforms */
    const uRes    = gl.getUniformLocation(prog, "u_resolution")
    const uTime   = gl.getUniformLocation(prog, "u_time")
    const uMouse  = gl.getUniformLocation(prog, "u_mouse")
    const uColorA = gl.getUniformLocation(prog, "u_color_a")
    const uColorB = gl.getUniformLocation(prog, "u_color_b")
    const uColorC = gl.getUniformLocation(prog, "u_color_c")
    const uColorD = gl.getUniformLocation(prog, "u_color_d")

    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

    /* reduced motion */
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false

    /* resize helper */
    const dpr = Math.min(window.devicePixelRatio ?? 1, 2)
    function resize() {
      const w = canvas!.clientWidth
      const h = canvas!.clientHeight
      canvas!.width  = w * dpr
      canvas!.height = h * dpr
      gl!.viewport(0, 0, canvas!.width, canvas!.height)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    /* mouse listener */
    function onMouse(e: MouseEvent) {
      mouseTargetRef.current = [e.clientX / window.innerWidth, 1 - e.clientY / window.innerHeight]
    }
    window.addEventListener("mousemove", onMouse)

    /* color update */
    function updateColors() {
      const hue = readAccentHue()
      const a = hslToRgb(hue - 35, 0.65, 0.16)
      const b = hslToRgb(hue + 8, 0.78, 0.28)
      const c = hslToRgb(hue + 36, 0.68, 0.24)
      const d = hslToRgb(hue - 90, 0.60, 0.20)
      gl!.uniform3f(uColorA, a[0], a[1], a[2])
      gl!.uniform3f(uColorB, b[0], b[1], b[2])
      gl!.uniform3f(uColorC, c[0], c[1], c[2])
      gl!.uniform3f(uColorD, d[0], d[1], d[2])
    }
    updateColors()
    const colorInterval = setInterval(updateColors, 2000)

    /* render loop */
    const t0 = performance.now()
    let raf = 0

    function frame() {
      const elapsed = (performance.now() - t0) / 1000
      const mouse = mouseRef.current
      const mouseTarget = mouseTargetRef.current

      if (reduceMotion) {
        mouse[0] = mouseTarget[0]
        mouse[1] = mouseTarget[1]
      } else {
        const smoothing = 0.07
        mouse[0] += (mouseTarget[0] - mouse[0]) * smoothing
        mouse[1] += (mouseTarget[1] - mouse[1]) * smoothing
      }

      gl!.uniform2f(uRes, canvas!.width, canvas!.height)
      gl!.uniform1f(uTime, reduceMotion ? 0 : elapsed * 0.14)
      gl!.uniform2f(uMouse, mouse[0], mouse[1])
      gl!.drawArrays(gl!.TRIANGLES, 0, 6)
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      clearInterval(colorInterval)
      window.removeEventListener("mousemove", onMouse)
      ro.disconnect()
      gl.getExtension("WEBGL_lose_context")?.loseContext()
    }
  }, [])

  if (webglFailed) {
    // fallback: layered static gradient with full-screen coverage
    return (
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(130%_110%_at_12%_18%,oklch(0.32_0.12_calc(var(--accent-hue)-60)_/_0.55)_0%,transparent_56%),radial-gradient(120%_120%_at_86%_20%,oklch(0.36_0.13_calc(var(--accent-hue)+14)_/_0.42)_0%,transparent_58%),radial-gradient(120%_110%_at_48%_84%,oklch(0.28_0.11_calc(var(--accent-hue)-16)_/_0.42)_0%,transparent_60%),linear-gradient(130deg,oklch(0.2_0.08_calc(var(--accent-hue)-82))_0%,oklch(0.24_0.09_calc(var(--accent-hue)-8))_44%,oklch(0.22_0.08_calc(var(--accent-hue)+32))_100%)]" />
    )
  }

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden
    />
  )
}
