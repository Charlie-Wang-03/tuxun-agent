import { inflateSync } from 'node:zlib';

const crcTable = Uint32Array.from({length: 256}, (_, i) => {
  for (let bit = 0; bit < 8; bit++) i = (i >>> 1) ^ (i & 1 ? 0xedb88320 : 0);
  return i >>> 0;
});
export function pngCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}

// Decode the ordinary, non-interlaced 8-bit PNGs emitted by Chrome screenshots.
export function inspectStreetPng(png, surfacePoint = null) {
  if (!Buffer.isBuffer(png) || !png.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw Error('街景截图不是 PNG');
  let width, height, depth, color, interlace, chunks = [], pos = 8, ended = false, dataEnded = false;
  while (pos + 12 <= png.length) {
    const len = png.readUInt32BE(pos), type = png.toString('ascii', pos + 4, pos + 8), start = pos + 8;
    if (start + len + 4 > png.length) throw Error('街景截图不完整');
    if (!/^[A-Za-z]{4}$/.test(type) || pngCrc32(png.subarray(pos + 4, start + len)) !== png.readUInt32BE(start + len)) throw Error('PNG 校验失败');
    if (pos === 8 && type !== 'IHDR') throw Error('PNG 缺少首部');
    if (type === 'IHDR') {
      if (pos !== 8 || len !== 13 || png[start + 10] !== 0 || png[start + 11] !== 0) throw Error('PNG 首部无效');
      width = png.readUInt32BE(start); height = png.readUInt32BE(start + 4); depth = png[start + 8]; color = png[start + 9]; interlace = png[start + 12];
    } else if (type === 'IDAT') {
      if (dataEnded) throw Error('PNG 图像数据块不连续');
      chunks.push(png.subarray(start, start + len));
    } else {
      if (chunks.length) dataEnded = true;
      if (type === 'IEND') { if (len !== 0) throw Error('PNG 结束块无效'); ended = true; }
      else if (type === 'PLTE') { if (chunks.length || !len || len % 3 || len > 768) throw Error('PNG 调色板无效'); }
      else if (type[0] === type[0].toUpperCase()) throw Error('PNG 包含不支持的数据块');
    }
    pos = start + len + 4; if (ended) break;
  }
  if (!ended || pos !== png.length) throw Error('街景截图不完整或包含尾随数据');
  const channels = ({ 0:1, 2:3, 4:2, 6:4 })[color];
  if (!width || !height || width * height > 20000000 || depth !== 8 || !channels || interlace !== 0 || !chunks.length) throw Error('不支持的街景截图格式');
  const stride = width * channels, raw = inflateSync(Buffer.concat(chunks), { maxOutputLength: (stride + 1) * height });
  if (raw.length !== (stride + 1) * height) throw Error('街景截图数据长度异常');
  let previous = Buffer.alloc(stride), offset = 0, total = 0, bright = 0, waterPixels=0, surfacePixels=0;
  const sample=[], stepX=Math.max(1,Math.floor(width/32)), stepY=Math.max(1,Math.floor(height/24));
  const paeth = (a,b,c) => { const p=a+b-c, da=Math.abs(p-a), db=Math.abs(p-b), dc=Math.abs(p-c); return da<=db && da<=dc ? a : db<=dc ? b : c; };
  for (let y=0; y<height; y++) {
    const filter=raw[offset++], row=Buffer.allocUnsafe(stride);
    if (filter>4) throw Error('不支持的 PNG 滤镜');
    for (let i=0; i<stride; i++) {
      const a=i>=channels?row[i-channels]:0, b=previous[i], c=i>=channels?previous[i-channels]:0;
      row[i]=(raw[offset++] + (filter===0?0:filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):paeth(a,b,c))) & 255;
    }
    for (let x=0; x<width; x++) { const i=x*channels, lum=channels<3?row[i]:(row[i]*299+row[i+1]*587+row[i+2]*114)/1000; total+=lum; if (lum>20) bright++; if(y%stepY===0&&x%stepX===0)sample.push(Math.round(lum)); if(surfacePoint && channels>=3 && Math.abs(x-surfacePoint.x*width)<=8 && Math.abs(y-surfacePoint.y*height)<=8){surfacePixels++; if(row[i+2]-row[i]>20 && row[i+2]-row[i+1]>8 && row[i+2]>100)waterPixels++;} }
    previous=row;
  }
  const pixels=width*height, mean=total/pixels, brightFraction=bright/pixels;
  return { width,height,mean,brightFraction, black: mean<5 && brightFraction<0.01, sample, ...(surfacePoint ? {surface:surfacePixels>=100 && waterPixels/surfacePixels>=.85?'likely_water':'unknown',waterFraction:surfacePixels?waterPixels/surfacePixels:0} : {}) };
}

// A changed image is evidence of a changed view, not proof of a new panorama.
export function compareStreetFrames(before, after) {
  if (!before || !after || before.width!==after.width || before.height!==after.height || before.sample.length!==after.sample.length || !before.sample.length) throw Error('街景截图尺寸不一致');
  let sum=0, changed=0;
  for(let i=0;i<before.sample.length;i++){const d=Math.abs(before.sample[i]-after.sample[i]);sum+=d;if(d>=15)changed++;}
  const meanDifference=sum/before.sample.length, changedFraction=changed/before.sample.length;
  return {meanDifference,changedFraction,changed:meanDifference>=3&&changedFraction>=0.03};
}
