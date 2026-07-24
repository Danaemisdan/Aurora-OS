/**
 * SiriWave — Real WebGL GLSL wave renderer (ported from 21st.dev/community/components/40973894/siri-wave)
 *
 * Usage:
 *   const wave = new SiriWave('container-id', { speed: 1.0 });
 *   wave.start();
 *   wave.setSpeed(2.0);  // faster for talking/listening
 *   wave.setSpeed(0.4);  // slow for idle
 *   wave.stop();
 *   wave.destroy();
 */

const VERTEX_SHADER = `attribute vec2 aPos; void main(){ gl_Position=vec4(aPos,0.0,1.0); }`;

// The beautiful Siri waveform — chromatic aberration + iOS voice waveform
// We expose iSpeed uniform to dynamically control energy without rebuilding program
const WAVE_SHADER = `precision highp float;
uniform vec2 iResolution;
uniform float iTime;
uniform float iSpeed;
uniform float iAmplitude;
uniform float iHeat;
const float PI = 3.14159265359;
const float AMPLITUDE   = 0.32;
const float FREQ        = 1.1;
const float ABER_FREQ   = 1.0;
const float ABERRATION  = 2.6;
const float THICKNESS   = 3.0;
const float INTENSITY   = 2.;
const float FALLOFF     = 1.7;
const float EDGE_MASK   = 0.4;
const float EDGE_INSET  = 0.0;
const float BAND_FILL   = 30000.0;
const float BAND_THICK  = 0.08;
const float SOFTNESS    = 2.5;
const float LOW_AMP     = 6.0;
const float LOW_INT     = 1.5;
const float MID_ABER    = 0.8;
const float MID_ABAMP   = 0.05;
const float MID_SOFT    = 0.4;
const float HIGH_ABER   = 0.5;
const float HIGH_ABAMP  = 0.06;
const float RESOLVED    = 1.0;
const float UNRES_SCALE = 0.14;
const float WAVE_SCALE  = 0.6;
const float SPEED       = 2.4;

vec3 spectral4(int s){
    float x = float(s);
    return clamp(vec3(abs(x-3.0)-1.0, 2.0-abs(x-2.0), 2.0-abs(x-4.0)), 0.0, 1.0);
}

void main(){
    vec2 R = iResolution.xy;
    float aspect = R.x / R.y;
    vec2 p = (gl_FragCoord.xy + 0.5) * 2.0 / R - 1.0;
    p.x *= aspect;
    float yScreen = p.y;
    p /= max(WAVE_SCALE, 0.1);

    // Heat wave causes rapid speed and distortion
    float t    = iTime * iSpeed * (1.0 + iHeat * 15.0);
    float low  = clamp(0.45 + 0.45*sin(t*0.8)*sin(t*0.37+1.0), 0.0, 1.0);
    float mid  = clamp(0.40 + 0.40*sin(t*1.7+2.0)*sin(t*0.53), 0.0, 1.0);
    float high = clamp(0.30 + 0.30*sin(t*2.9+4.0)*sin(t*0.71+2.0), 0.0, 1.0);

    float res   = clamp(RESOLVED, 0.0, 1.0);
    float drift = mod(t, 20.0*PI) * SPEED;

    // Envelope width animates from tiny to full width
    float envWidth = mix(0.1, 1.0, iAmplitude);
    float xN  = p.x / (max(aspect, 1.0) * envWidth);
    float env = cos(PI*0.5 * min(abs(0.9*xN), 1.0));
    env *= env;

    float A1    = AMPLITUDE + 0.01*low*LOW_AMP;
    float A2    = A1 + mid*MID_ABAMP + high*HIGH_ABAMP;
    float AB    = (ABERRATION + mid*MID_ABER + high*HIGH_ABER)*res * (1.0 + iHeat * 4.0);
    
    // Heat causes slight thickness and intensity bursts
    float th    = mix(0.1, 0.01*THICKNESS, res) * (1.0 + iHeat);
    float inten = mix(0.1, 0.01*(INTENSITY + low*LOW_INT), res) * (1.0 + iHeat * 1.5);
    float soft  = 0.01*res*max(0.0, SOFTNESS + mid*MID_SOFT);

    float dUnres = max(length(p) - mix(0.14, UNRES_SCALE, res), 0.0);
    
    // Increase frequency during heat wave
    float freqMod = 1.0 + iHeat * 3.0;
    float yMain = A1 * env * res * sin(p.x*FREQ*freqMod + drift) * iAmplitude;

    float bandFillTh = max(BAND_THICK, 1e-4);
    float bandAmt    = 1e-4 * BAND_FILL * inten;
    vec3 num = vec3(0.0), den = vec3(0.0);
    for(int s = 0; s < 4; s++){
        vec3 hue = mix(vec3(1.0), spectral4(s), res);
        den += hue;
        float ab = mix(-AB, AB, float(s)/3.0) * iAmplitude;
        float yL = A2 * env * res * sin(p.x*ABER_FREQ*freqMod + drift + ab) * iAmplitude;
        float d   = mix(dUnres, abs(p.y - yL), res);
        float lor = mix(1.0/(1.0 + (0.02*d)*(0.02*d)), 1.0, res);
        float line = inten / (sqrt(d*d + soft*soft) + th);
        float lo = min(yMain, yL), hi = max(yMain, yL);
        float dBand = max(0.0, max(p.y - hi, lo - p.y));
        float band  = bandAmt / (dBand + bandFillTh);
        num += hue * lor * (line + band);
    }
    vec3 col = num / den;

    float dM    = mix(dUnres, abs(p.y - yMain), res);
    float lorM  = mix(1.0/(1.0 + (0.02*dM)*(0.02*dM)), 1.0, res);
    float boost = (1.0 - res) * (14.0*low + 4.0);
    col += 0.5 * inten * (lorM + boost) / (sqrt(dM*dM + soft*soft) + th);

    col = pow(max(col, 0.0), vec3(1.5));
    float emT = clamp((abs(yScreen) - 1.0 + EDGE_INSET) / (-max(EDGE_MASK, 1e-4)), 0.0, 1.0);
    float em  = emT*emT*(3.0 - 2.0*emT);
    float gauss = exp(-pow(xN*FALLOFF, 2.0));
    col *= mix(1.0, em*gauss, res);
    col *= res;

    // Output with alpha=0 for black pixels (transparent background)
    float brightness = col.r + col.g + col.b;
    float alpha = clamp(brightness * 3.0, 0.0, 1.0);
    gl_FragColor = vec4(col, alpha);
}`;

class SiriWave {
    /**
     * @param {string} containerId  — ID of the container div
     * @param {Object} options
     * @param {number} [options.speed=1.0]  — multiplier for wave animation speed
     * @param {number} [options.width]      — override width in px (defaults to container width)
     * @param {number} [options.height=80]  — height in px
     */
    constructor(containerId, options = {}) {
        this.containerId = containerId;
        this.container = document.getElementById(containerId);
        if (!this.container) {
            console.warn('[SiriWave] Container not found:', containerId);
            return;
        }

        this.speed = options.speed !== undefined ? options.speed : 1.0;
        this.height = options.height || 80;
        this.isRunning = false;

        // Create a wide rectangular canvas, NOT a square
        this.canvas = document.createElement('canvas');
        this.canvas.style.display = 'block';
        this.canvas.style.width = '100%';
        this.canvas.style.height = this.height + 'px';
        // CRITICAL: transparent background
        this.canvas.style.background = 'transparent';
        this.canvas.style.borderRadius = '0';

        this.container.innerHTML = '';
        this.container.appendChild(this.canvas);

        // Use preserveDrawingBuffer + premultipliedAlpha: false for proper transparency
        this.gl = this.canvas.getContext('webgl', {
            alpha: true,
            premultipliedAlpha: false,
            preserveDrawingBuffer: false,
        });

        if (!this.gl) {
            console.warn('[SiriWave] WebGL not available');
            return;
        }

        // Enable alpha blending
        this.gl.enable(this.gl.BLEND);
        this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
        this.gl.clearColor(0, 0, 0, 0);

        const compile = (type, src) => {
            const shader = this.gl.createShader(type);
            this.gl.shaderSource(shader, src);
            this.gl.compileShader(shader);
            if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
                console.error('[SiriWave] Shader error:', this.gl.getShaderInfoLog(shader));
                this.gl.deleteShader(shader);
                return null;
            }
            return shader;
        };

        this.program = this.gl.createProgram();
        this.vs = compile(this.gl.VERTEX_SHADER, VERTEX_SHADER);
        this.fs = compile(this.gl.FRAGMENT_SHADER, WAVE_SHADER);

        if (!this.vs || !this.fs) return;

        this.gl.attachShader(this.program, this.vs);
        this.gl.attachShader(this.program, this.fs);
        this.gl.linkProgram(this.program);
        this.gl.useProgram(this.program);

        // Full-screen triangle
        this.buffer = this.gl.createBuffer();
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.buffer);
        this.gl.bufferData(
            this.gl.ARRAY_BUFFER,
            new Float32Array([-1, -1, 3, -1, -1, 3]),
            this.gl.STATIC_DRAW
        );
        const aPos = this.gl.getAttribLocation(this.program, 'aPos');
        this.gl.enableVertexAttribArray(aPos);
        this.gl.vertexAttribPointer(aPos, 2, this.gl.FLOAT, false, 0, 0);

        this.uResolution = this.gl.getUniformLocation(this.program, 'iResolution');
        this.uTime = this.gl.getUniformLocation(this.program, 'iTime');
        this.uSpeed = this.gl.getUniformLocation(this.program, 'iSpeed');
        this.uAmplitude = this.gl.getUniformLocation(this.program, 'iAmplitude');
        this.uHeat = this.gl.getUniformLocation(this.program, 'iHeat');

        this.targetAmplitude = 0.0;
        this.currentAmplitude = 0.0;
        this.heat = 0.0;

        // Set canvas pixel size
        this._resize();

        // Observe container size changes
        if (typeof ResizeObserver !== 'undefined') {
            this._ro = new ResizeObserver(() => this._resize());
            this._ro.observe(this.container);
        }
    }

    _resize() {
        if (!this.canvas || !this.gl) return;
        const w = this.container.clientWidth || 400;
        const h = this.height;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        this.canvas.width = Math.round(w * dpr);
        this.canvas.height = Math.round(h * dpr);
        this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    }

    /** Change wave animation speed. 0.3=idle, 1.0=default, 1.8=listening, 2.5=talking */
    setSpeed(s) {
        this.speed = s;
    }

    start() {
        if (!this.gl || this.isRunning) return;
        this.isRunning = true;
        this.startTime = performance.now();
        this.targetAmplitude = 1.0;
        this.currentAmplitude = 0.0; // Start flat every time it opens
        this.heat = 1.0; // Initial heat burst

        const frame = () => {
            if (!this.isRunning) return;
            const now = performance.now();
            const t = (now - this.startTime) / 1000;

            // Smoothly animate amplitude towards target
            this.currentAmplitude += (this.targetAmplitude - this.currentAmplitude) * 0.08;
            
            // Heat rapidly decays
            this.heat *= 0.92;

            this.gl.clear(this.gl.COLOR_BUFFER_BIT);
            this.gl.uniform2f(this.uResolution, this.canvas.width, this.canvas.height);
            this.gl.uniform1f(this.uTime, t);
            this.gl.uniform1f(this.uSpeed, this.speed);
            this.gl.uniform1f(this.uAmplitude, this.currentAmplitude);
            this.gl.uniform1f(this.uHeat, this.heat);
            this.gl.drawArrays(this.gl.TRIANGLES, 0, 3);
            this.raf = requestAnimationFrame(frame);
        };
        frame();
    }

    stop() {
        this.isRunning = false;
        if (this.raf) {
            cancelAnimationFrame(this.raf);
            this.raf = null;
        }
    }

    destroy() {
        this.stop();
        if (this._ro) {
            this._ro.disconnect();
            this._ro = null;
        }
        if (this.gl) {
            this.gl.deleteProgram(this.program);
            if (this.vs) this.gl.deleteShader(this.vs);
            if (this.fs) this.gl.deleteShader(this.fs);
            this.gl.deleteBuffer(this.buffer);
        }
        if (this.canvas && this.canvas.parentNode) {
            this.canvas.remove();
        }
    }
}

window.SiriWave = SiriWave;
