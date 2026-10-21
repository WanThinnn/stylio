// A disk-shaped aperture in linear light, with depth-dependent circle of
// confusion and foreground rejection. Preview only; Photos renders the saved depth.
import {FOREGROUND_RESPONSE} from './portrait-scene-response.js';
const vertex=`#version 300 es
in vec2 position;out vec2 uv;void main(){uv=position*.5+.5;gl_Position=vec4(position,0,1);}`;
const fragment=`#version 300 es
precision highp float;
uniform sampler2D photo;uniform sampler2D depth;
uniform vec2 sourceSize;uniform float focus;uniform float radius;
uniform int angle;uniform int mirror;
in vec2 uv;out vec4 colour;
vec2 stored(vec2 p){
 if(angle==90)p=vec2(1.-p.y,p.x);else if(angle==180)p=1.-p;else if(angle==270)p=vec2(p.y,1.-p.x);
 if(mirror==0)p.y=1.-p.y;else if(mirror==1)p.x=1.-p.x;
 return vec2(p.x,1.-p.y);
}
vec3 linearRgb(vec3 s){return pow(max(s,vec3(0)),vec3(2.2));}
void main(){
 vec2 p=stored(vec2(uv.x,1.-uv.y));float d=texture(depth,p).r;
 // Apply the scene scale to disparity difference, not a pre-saturated curve:
 // otherwise two affine-equivalent model maps produce different blur radii.
 // Foreground attenuation remains an explicit preview policy, not Apple's math.
 float farBlur=max(focus-d,0.);
 float nearBlur=${FOREGROUND_RESPONSE}*max(d-focus,0.);
 float coc=radius*max(farBlur,nearBlur);
 vec3 original=texture(photo,p).rgb;
 if(coc<.5){colour=vec4(original,1);return;}
 vec3 sum=linearRgb(original);float weights=1.;
 for(int i=0;i<64;i++){
   float n=float(i),r=sqrt((n+.5)/64.),a=n*2.39996323;
   vec2 q=clamp(p+vec2(cos(a),sin(a))*r*coc/sourceSize,vec2(0),vec2(1));
   float sd=texture(depth,q).r;
   // Far surfaces cannot gather sharp, nearer subject pixels.
   float weight=d<focus?1.-smoothstep(.025,.095,sd-d):1.-smoothstep(.07,.22,d-sd);
   // Prefilter each aperture sample's footprint to avoid sparse bright dots
   // when a large high-resolution circle covers many source pixels.
   vec3 light=linearRgb(textureLod(photo,q,max(0.,log2(coc/8.))).rgb);
   sum+=light*weight;weights+=weight;
 }
 colour=vec4(pow(sum/max(weights,.001),vec3(1./2.2)),1);
}`;
export function createBokehRenderer(source,gray,width,height,{angle=0,mirror=null}={}){
  const sourceEdge=Math.max(source.width,source.height);
  const canvas=document.createElement('canvas'),swap=angle===90||angle===270;
  canvas.width=swap?source.height:source.width;canvas.height=swap?source.width:source.height;
  const gl=canvas.getContext('webgl2',{alpha:false,antialias:false,preserveDrawingBuffer:true,powerPreference:'high-performance'});
  if(!gl)throw Error('BOKEH_GPU');
  const shaders=[],textures=[];let program,buffer,depthCanvas;
  try{
    if(Math.max(source.width,source.height)>gl.getParameter(gl.MAX_TEXTURE_SIZE))throw Error('BOKEH_SIZE');
    const compile=(type,code)=>{const shader=gl.createShader(type);shaders.push(shader);gl.shaderSource(shader,code);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(shader));return shader;};
    program=gl.createProgram();gl.attachShader(program,compile(gl.VERTEX_SHADER,vertex));gl.attachShader(program,compile(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.useProgram(program);
    buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
    const location=gl.getAttribLocation(program,'position');gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,2,gl.FLOAT,false,0,0);
    depthCanvas=document.createElement('canvas');depthCanvas.width=width;depthCanvas.height=height;
    const ctx=depthCanvas.getContext('2d'),image=ctx.createImageData(width,height);
    for(let i=0;i<gray.length;i++){const p=i*4;image.data[p]=image.data[p+1]=image.data[p+2]=gray[i];image.data[p+3]=255;}ctx.putImageData(image,0,0);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
    [source,depthCanvas].forEach((surface,index)=>{
      const texture=gl.createTexture();textures.push(texture);gl.activeTexture(gl.TEXTURE0+index);gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,surface);
      if(index===0){gl.generateMipmap(gl.TEXTURE_2D);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);}
      gl.uniform1i(gl.getUniformLocation(program,index?'depth':'photo'),index);
    });
    gl.uniform2f(gl.getUniformLocation(program,'sourceSize'),source.width,source.height);
    const focusLocation=gl.getUniformLocation(program,'focus'),radiusLocation=gl.getUniformLocation(program,'radius');
    gl.uniform1i(gl.getUniformLocation(program,'angle'),angle);gl.uniform1i(gl.getUniformLocation(program,'mirror'),mirror??-1);
    depthCanvas.width=depthCanvas.height=0;depthCanvas=null;let closed=false;
    return {canvas,draw({focus,blur}){
      if(closed||gl.isContextLost())throw Error('BOKEH_GPU');
      gl.uniform1f(focusLocation,focus/255);gl.uniform1f(radiusLocation,blur*sourceEdge/768);
      gl.viewport(0,0,canvas.width,canvas.height);gl.drawArrays(gl.TRIANGLES,0,6);
      if(gl.getError()!==gl.NO_ERROR)throw Error('BOKEH_RENDER');
    },close(){if(closed)return;closed=true;release();}};
  }catch(error){release();throw error;}
  function release(){for(const texture of textures)gl.deleteTexture(texture);if(buffer)gl.deleteBuffer(buffer);if(program)gl.deleteProgram(program);for(const shader of shaders)gl.deleteShader(shader);if(depthCanvas)depthCanvas.width=depthCanvas.height=0;canvas.width=canvas.height=0;gl.getExtension('WEBGL_lose_context')?.loseContext();}
}
// One-shot callers retain the old API; interactive previews reuse one renderer.
export function renderBokeh(source,gray,width,height,settings){
  const renderer=createBokehRenderer(source,gray,width,height,settings);
  try{renderer.draw(settings);return renderer;}catch(error){renderer.close();throw error;}
}
