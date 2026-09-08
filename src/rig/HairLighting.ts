// Shared preview implementation of Brian Karis's published R / TT / TRT
// approximation (SIGGRAPH 2016, slides 18, 20, 25-29, 32, 39, 47):
// https://blog.selfshadow.com/publications/s2016-shading-course/karis/s2016_pbs_epic_hair.pdf
// This is not THE FINALS' native lighting shader. Lobe widths and cuticle tilt
// below are shared preview policy; no item-specific light or colour fitting.
// Native exponential hair shadows, depth offset and TAA remain separate work.
export const HAIR_SCATTERING_GLSL = /* glsl */ `
float recoveredHairGaussian(float x, float width) {
  float b = max(width, 0.002);
  return exp(-0.5 * x * x / (b * b)) / (2.50662827463 * b);
}
float recoveredHairFresnel(float cosine, float specular) {
  float f0 = clamp(0.08 * specular, 0.0, 1.0);
  return f0 + (1.0 - f0) * pow(clamp(1.0 - cosine, 0.0, 1.0), 5.0);
}
vec3 recoveredHairFacingNormal(vec3 V, vec3 T) {
  vec3 n = V - T * dot(V, T);
  if (dot(n, n) < 1e-8) n = cross(T, abs(T.z) < 0.9 ? vec3(0,0,1) : vec3(0,1,0));
  return normalize(n);
}
vec3 recoveredHairScattering(vec3 L, vec3 V, vec3 T, vec3 color,
  float roughness, float specular, float scatter, bool environment) {
  float sinI = clamp(dot(T, L), -1.0, 1.0), sinV = clamp(dot(T, V), -1.0, 1.0);
  float cosI = sqrt(max(0.0, 1.0 - sinI * sinI)), cosV = sqrt(max(0.0, 1.0 - sinV * sinV));
  float cosD = max(0.001, sqrt(max(0.0, 0.5 + 0.5 * (cosI * cosV + sinI * sinV))));
  float cosPhi = clamp((dot(L, V) - sinI * sinV) / max(1e-5, cosI * cosV), -1.0, 1.0);
  float cosHalfPhi = sqrt(max(0.0, 0.5 + 0.5 * cosPhi));
  float sumSin = sinI + sinV;
  float beta = clamp(roughness, 0.02, 1.0); beta *= beta;
  float broadening = environment ? 0.2 : 0.0;
  float tilt = 0.035;
  vec3 C = clamp(color, vec3(0.0), vec3(1.0));
  // R: white reflection off the outside of a fibre.
  float R = recoveredHairGaussian(sumSin + 2.0 * tilt, beta + broadening)
    * 0.25 * cosHalfPhi * recoveredHairFresnel(sqrt(max(0.0, 0.5 + 0.5 * dot(L, V))), specular);
  if (environment) R *= clamp(dot(L, V) + 1.0, 0.0, 1.0);
  // TT: transmission through the fibre, attenuated by its pigment.
  float a = cosD / (1.19 + 0.36 * cosD * cosD);
  float h = clamp((1.0 + a * (0.6 - 0.8 * cosPhi)) * cosHalfPhi, 0.0, 1.0);
  float fTT = recoveredHairFresnel(cosD * sqrt(max(0.0, 1.0 - h * h)), specular);
  vec3 absorptionTT = pow(C, vec3(sqrt(max(0.0, 1.0 - h * h * a * a)) / (2.0 * cosD)));
  vec3 TT = absorptionTT * ((1.0 - fTT) * (1.0 - fTT)) * exp(-3.65 * cosPhi - 3.98)
    * recoveredHairGaussian(sumSin - tilt, 0.5 * beta + broadening);
  // TRT: coloured light after one internal reflection and two passages.
  float fTRT = recoveredHairFresnel(0.5 * cosD, specular);
  vec3 TRT = pow(C, vec3(0.8 / cosD)) * ((1.0 - fTRT) * (1.0 - fTRT) * fTRT)
    * exp(17.0 * cosPhi - 16.78) * recoveredHairGaussian(sumSin - 4.0 * tilt, 2.0 * beta + broadening);
  // The paper's unshadowed multiple-scattering approximation, weighted by the
  // recovered Scatter input. Three supplies regular filtered shadow visibility;
  // it cannot supply the native exponential volume path-length term yet.
  float wrap = (dot(recoveredHairFacingNormal(V, T), L) + 1.0) / (4.0 * 3.14159265359);
  vec3 multiple = sqrt(C) * clamp(scatter, 0.0, 1.0) * max(0.0, wrap);
  return vec3(R) + (environment ? vec3(0.0) : TT) + TRT + multiple;
}
`;

export const HAIR_LIGHTING_GLSL = HAIR_SCATTERING_GLSL + /* glsl */ `
void RE_Direct_RecoveredHair(const in IncidentLight light, const in vec3 position, const in vec3 normal,
  const in vec3 view, const in vec3 clearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflected) {
  // Hair scattering is defined around the fibre; card N dot L is not its cosine.
  reflected.directSpecular += light.color * recoveredHairScattering(light.direction, view, material.hairTangent,
    material.diffuseColor, material.hairRoughness, material.hairSpecular, material.hairScatter, false);
}
void RE_IndirectDiffuse_RecoveredHair(const in vec3 irradiance, const in vec3 position, const in vec3 normal,
  const in vec3 view, const in vec3 clearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflected) {
  reflected.indirectDiffuse += irradiance * recoveredHairScattering(recoveredHairFacingNormal(view, material.hairTangent),
    view, material.hairTangent, material.diffuseColor, material.hairRoughness, material.hairSpecular, material.hairScatter, true);
}
void RE_IndirectSpecular_RecoveredHair(const in vec3 radiance, const in vec3 irradiance, const in vec3 clearcoatRadiance,
  const in vec3 position, const in vec3 normal, const in vec3 view, const in vec3 clearcoatNormal,
  const in PhysicalMaterial material, inout ReflectedLight reflected) {
  RE_IndirectDiffuse_RecoveredHair(irradiance, position, normal, view, clearcoatNormal, material, reflected);
}
#undef RE_Direct
#undef RE_IndirectDiffuse
#undef RE_IndirectSpecular
#undef RE_Direct_RectArea
#define RE_Direct RE_Direct_RecoveredHair
#define RE_IndirectDiffuse RE_IndirectDiffuse_RecoveredHair
#define RE_IndirectSpecular RE_IndirectSpecular_RecoveredHair
#if NUM_RECT_AREA_LIGHTS > 0
  #error Recovered hair area-light integration is not yet supported
#endif
`;
