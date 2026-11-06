import type * as THREE from 'three';

/**
 * Stratified alpha hashing for the stable-frame accumulator (decision #19, signed off 4 Nov 2026).
 *
 * Three's `alphaHash` keeps a fragment when its alpha is at least a hash threshold of the object-space position. The
 * hash cells are about a twentieth of a pixel, so each sub-pixel jittered accumulator sample draws a fresh, independent
 * threshold: 32 samples are 32 coin flips, and the average converges only as 1/sqrt(N) (std 0.088 at 50% coverage,
 * measured in w131), which reads as grain on see-through plastic.
 *
 * While the accumulator renders sample n >= 1 of N, the threshold instead comes from a seeded permutation of the
 * 2^k >= N equal strata, plus a fixed offset inside the stratum. Over a power-of-two sample count each pixel of a surface
 * sees one threshold from every stratum, so its kept fraction lands within about 1/N of the authored opacity. The
 * permutation is seeded by the pixel, the drawing triangle (its provoking vertex index), the face side and a
 * per-material salt: a visor and the skull behind it, a card stack, or the two faces of a two-sided shell each shuffle
 * independently, so stacked layers keep independent coverage (as with a random permutation per layer, the w131 bound)
 * instead of keeping or dropping the same pixels together.
 *
 * Index 0 is every draw outside the accumulator and the accumulator's first (unjittered) sample: three's own hash,
 * unchanged, so `?temporal=0` and exports render exactly as before. (The accumulator's motion mode, used while an
 * animation plays, uses its own threshold instead: alphaHashMotionFrame below.)
 */
export const alphaHashSample = { value: 0 };
/** k: the accumulator's strata are 2^k >= its sample count. */
export const alphaHashSampleBits = { value: 5 };
/**
 * Motion mode (showcase animation, 5 Nov 2026): 0 is off; otherwise the accumulator's motion frame + 1. A running
 * average clamped to each pixel's 3x3 neighbourhood (StableFrameAccumulator) needs every neighbourhood to show what
 * the surface looks like, but per-pixel random thresholds leave all nine pixels of a 10% surface uncovered in about 39%
 * of frames, and the clamp then erases the surface. Motion frames use an ordered 3-periodic pattern instead (the idea
 * behind UE's temporal-AA dither): any 3x3 window holds each of nine threshold bands once, so a surface above 1/9
 * opacity always shows a covered pixel there (measured: 0 empty windows at 10%, against 36-39% for the random hash and
 * 17.6% for interleaved gradient noise, tried first). The bands rotate per frame so every pixel visits all of them (no
 * fixed screen door), and a per-triangle, per-material, per-side offset keeps stacked cards independent, as in the
 * still path. Below 1/9 opacity a window can still come up empty, so very faint surfaces thin out while moving.
 */
export const alphaHashMotionFrame = { value: 0 };

/** Draw motion frame `frame` (>= 0) with the neighbourhood-stratified threshold, or turn it off with null. */
export function setAlphaHashMotionFrame(frame: number | null) {
  if (frame !== null && (!Number.isInteger(frame) || frame < 0)) throw new Error('Invalid alpha-hash motion frame');
  alphaHashMotionFrame.value = frame === null ? 0 : (frame % 64) + 1;
}

/** Draw sample `index` of `count` (index 0: three's own hash). */
export function setAlphaHashSample(index: number, count = 2) {
  if (!Number.isInteger(index) || index < 0 || !Number.isInteger(count) || count < 1 || count > 256 || index >= Math.max(count, 1))
    throw new Error('Invalid alpha-hash sample');
  alphaHashSample.value = index;
  alphaHashSampleBits.value = Math.max(1, Math.ceil(Math.log2(count)));
}

const VERTEX_DECLARATIONS = `#ifdef USE_ALPHAHASH
flat varying uint vAlphaHashVertex;
#endif
`;

const VERTEX_ASSIGNMENT = `#include <begin_vertex>
#ifdef USE_ALPHAHASH
vAlphaHashVertex = uint( gl_VertexID );
#endif`;

const FRAGMENT_FUNCTIONS = `#include <alphahash_pars_fragment>
#ifdef USE_ALPHAHASH
uniform uint alphaHashSample;
uniform uint alphaHashSampleBits;
uniform uint alphaHashSalt;
uniform uint alphaHashMotionFrame;
flat varying uint vAlphaHashVertex;
uint alphaHashMix( uint x ) {
	x ^= x >> 16u; x *= 0x7feb352du; x ^= x >> 15u; x *= 0x846ca68bu; x ^= x >> 16u;
	return x;
}
// A seeded permutation of k-bit sample indices: rounds of xorshift, odd multiply and add, each a bijection mod 2^k.
uint alphaHashPermute( uint x, uint seed ) {
	uint mask = ( 1u << alphaHashSampleBits ) - 1u, shift = max( 1u, alphaHashSampleBits >> 1u );
	for ( uint i = 1u; i <= 3u; i ++ ) {
		uint h = alphaHashMix( seed ^ ( i * 0x9e3779b9u ) );
		x ^= x >> shift; x = ( x * ( h | 1u ) ) & mask; x = ( x + ( h >> 16u ) ) & mask;
	}
	return x;
}
float sampledAlphaHashThreshold( vec3 position ) {
	// Evaluated unconditionally: its screen derivatives stay out of flow control. One exit at the end: with early
	// returns, ANGLE's D3D back end warned the result was "potentially uninitialized" (X4000) on every hashed program.
	float spatial = getAlphaHashThreshold( position );
	float threshold = spatial;
	uvec2 pixel = uvec2( gl_FragCoord.xy );
	if ( alphaHashMotionFrame != 0u ) {
		// A 3-periodic ranking: every 3x3 window of pixels holds each of the nine bands once, whatever its position.
		// The ranks rotate each frame (every pixel visits every band). The position inside its band is random per pixel
		// and frame: one shared offset made a whole surface below 1/9 opacity empty (and vanish) on the same frames, and
		// a 50% surface pulse between 4/9 and 5/9; scattered, the rare empty windows only thin a faint surface a little.
		// The per-layer offset (stacked cards stay independent) is a whole-band rotation plus a shift that wraps inside
		// the band: added after the bands, it pushed pixels into the next band and could empty band 0 of a window.
		const uint ranks[ 9 ] = uint[ 9 ]( 0u, 7u, 3u, 5u, 2u, 8u, 6u, 4u, 1u );
		uint frame = alphaHashMotionFrame - 1u;
		uvec2 cell = pixel % 3u;
		uint layer = alphaHashMix( vAlphaHashVertex ^ alphaHashMix( alphaHashSalt ^ ( gl_FrontFacing ? 0u : 0x9e3779b9u ) ) );
		uint band = ( ranks[ cell.y * 3u + cell.x ] + frame + layer % 9u ) % 9u;
		float inside = fract( float( alphaHashMix( pixel.x ^ alphaHashMix( pixel.y ^ alphaHashMix( frame ^ 0x2545f491u ) ) ) >> 8u ) * ( 1.0 / 16777216.0 )
			+ float( layer >> 8u ) * ( 1.0 / 16777216.0 ) );
		threshold = max( ( float( band ) + inside ) / 9.0, 1.0e-6 );
	} else if ( alphaHashSample != 0u ) {
		uint seed = alphaHashMix( pixel.x ^ alphaHashMix( pixel.y ^ alphaHashMix( vAlphaHashVertex
			^ alphaHashMix( alphaHashSalt ^ ( gl_FrontFacing ? 0u : 0x9e3779b9u ) ) ) ) );
		// 24-bit threshold: the permuted stratum in the top k bits, a fixed per-pixel offset inside it below.
		uint stratum = alphaHashPermute( alphaHashSample, seed );
		uint inside = alphaHashMix( seed ^ 0x51ed270bu ) >> ( 8u + alphaHashSampleBits );
		threshold = max( float( ( stratum << ( 24u - alphaHashSampleBits ) ) | inside ) * ( 1.0 / 16777216.0 ), 1.0e-6 );
	}
	return threshold;
}
#endif`;

const FRAGMENT_TEST = `#ifdef USE_ALPHAHASH
	if ( diffuseColor.a < sampledAlphaHashThreshold( vPosition ) ) discard;
#endif`;

function replaceOnce(source: string, marker: string, replacement: string) {
  const at = source.indexOf(marker);
  if (at < 0 || source.indexOf(marker, at + marker.length) >= 0) throw new Error(`Three shader chunk changed: ${marker}`);
  return source.slice(0, at) + replacement + source.slice(at + marker.length);
}

/** A stable 24-bit salt per material, so two materials stacked at a pixel shuffle independently. */
export function alphaHashSalt(key: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 0x01000193) >>> 0;
  return hash & 0xffffff;
}

/** Call from a material's onBeforeCompile (surface or depth/distance) before its chunks are resolved. */
export function installSampledAlphaHash(shader: THREE.WebGLProgramParametersWithUniforms, material: THREE.Material) {
  shader.uniforms.alphaHashSample = alphaHashSample;
  shader.uniforms.alphaHashSampleBits = alphaHashSampleBits;
  shader.uniforms.alphaHashSalt = { value: alphaHashSalt(material.uuid) };
  shader.uniforms.alphaHashMotionFrame = alphaHashMotionFrame;
  shader.vertexShader = VERTEX_DECLARATIONS + replaceOnce(shader.vertexShader, '#include <begin_vertex>', VERTEX_ASSIGNMENT);
  shader.fragmentShader = replaceOnce(shader.fragmentShader, '#include <alphahash_pars_fragment>', FRAGMENT_FUNCTIONS);
  shader.fragmentShader = replaceOnce(shader.fragmentShader, '#include <alphahash_fragment>', FRAGMENT_TEST);
}
