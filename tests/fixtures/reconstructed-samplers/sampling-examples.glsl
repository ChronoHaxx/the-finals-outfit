uniform highp sampler2D u_t3;
uniform highp sampler2D u_t4;
uniform highp sampler2DArray u_t19;
vec4 example(vec2 uv0, vec2 uv1) {
  vec4 a = texture(u_t3, vec2(uv0.x, uv0.y));
  vec4 b = textureLod(u_t4, vec2(uv1.x, uv1.y), 0.0);
  vec4 c = textureGrad(u_t3, vec2(uv0.x, uv0.y), vec2(dFdx(uv0.x), dFdx(uv0.y)), vec2(dFdy(uv0.x), dFdy(uv0.y)));
  return a+b+c+texture(u_t19,vec3(uv1,0.0));
}
