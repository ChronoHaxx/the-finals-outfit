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
 * unchanged, so `?temporal=0`, moving views and exports render exactly as before.
 */
export const alphaHashSample = { value: 0 };
/** k: the accumulator's strata are 2^k >= its sample count. */
export const alphaHashSampleBits = { value: 5 };

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
	// Evaluated unconditionally: its screen derivatives stay out of flow control.
	float spatial = getAlphaHashThreshold( position );
	if ( alphaHashSample == 0u ) return spatial;
	uvec2 pixel = uvec2( gl_FragCoord.xy );
	uint seed = alphaHashMix( pixel.x ^ alphaHashMix( pixel.y ^ alphaHashMix( vAlphaHashVertex
		^ alphaHashMix( alphaHashSalt ^ ( gl_FrontFacing ? 0u : 0x9e3779b9u ) ) ) ) );
	// 24-bit threshold: the permuted stratum in the top k bits, a fixed per-pixel offset inside it below.
	uint stratum = alphaHashPermute( alphaHashSample, seed );
	uint inside = alphaHashMix( seed ^ 0x51ed270bu ) >> ( 8u + alphaHashSampleBits );
	return max( float( ( stratum << ( 24u - alphaHashSampleBits ) ) | inside ) * ( 1.0 / 16777216.0 ), 1.0e-6 );
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
  shader.vertexShader = VERTEX_DECLARATIONS + replaceOnce(shader.vertexShader, '#include <begin_vertex>', VERTEX_ASSIGNMENT);
  shader.fragmentShader = replaceOnce(shader.fragmentShader, '#include <alphahash_pars_fragment>', FRAGMENT_FUNCTIONS);
  shader.fragmentShader = replaceOnce(shader.fragmentShader, '#include <alphahash_fragment>', FRAGMENT_TEST);
}
