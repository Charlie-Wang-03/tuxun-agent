import { pngCrc32 } from '../src/image-check.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { inspectStreetPng, compareStreetFrames } from '../src/image-check.mjs';

function png(rgb, filter=0) {
  const chunk=(type,data)=>{const b=Buffer.alloc(12+data.length);b.writeUInt32BE(data.length);b.write(type,4);data.copy(b,8);b.writeUInt32BE(pngCrc32(b.subarray(4,8+data.length)),8+data.length);return b};
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(2,0);ihdr.writeUInt32BE(2,4);ihdr[8]=8;ihdr[9]=2;
  const pixels=Buffer.from([...rgb,...rgb]);let prev=Buffer.alloc(6);const rows=[];
  const paeth=(a,b,c)=>{const p=a+b-c,da=Math.abs(p-a),db=Math.abs(p-b),dc=Math.abs(p-c);return da<=db&&da<=dc?a:db<=dc?b:c};
  for(let y=0;y<2;y++){const row=Buffer.alloc(7);row[0]=filter;for(let i=0;i<6;i++){const a=i>=3?pixels[i-3]:0,b=prev[i],c=i>=3?prev[i-3]:0;const prediction=filter===0?0:filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):paeth(a,b,c);row[i+1]=(pixels[i]-prediction)&255}rows.push(row);prev=pixels}
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(Buffer.concat(rows))),chunk('IEND',Buffer.alloc(0))]);
}
test('区分全黑画面和明亮街景',()=>{assert.equal(inspectStreetPng(png([0,0,0])).black,true);assert.equal(inspectStreetPng(png([110,130,150])).black,false)});
test('正确读取 PNG 五种行滤镜',()=>{for(let f=0;f<=4;f++){const result=inspectStreetPng(png([100,150,200],f));assert.equal(result.black,false);assert.ok(result.mean>130&&result.mean<150)}});
test('拒绝损坏或不受支持的截图',()=>{assert.throws(()=>inspectStreetPng(Buffer.from('not a png')))});

function rewriteChunk(image, type, change) {
  for(let pos=8;pos<image.length;){
    const length=image.readUInt32BE(pos),end=pos+12+length;
    if(image.toString('ascii',pos+4,pos+8)===type){
      const data=change(Buffer.from(image.subarray(pos+8,end-4)));
      const chunk=Buffer.alloc(data.length+12);chunk.writeUInt32BE(data.length);chunk.write(type,4);data.copy(chunk,8);chunk.writeUInt32BE(pngCrc32(chunk.subarray(4,-4)),chunk.length-4);
      return Buffer.concat([image.subarray(0,pos),chunk,image.subarray(end)]);
    }
    pos=end;
  }
  throw Error('fixture chunk missing');
}
test('PNG 校验拒绝缺尾、损坏校验和、错误首部与无效压缩数据',()=>{
  assert.equal(pngCrc32(Buffer.from('123456789')),0xcbf43926);
  const good=png([110,130,150]),corrupt=Buffer.from(good);corrupt[29]^=1;
  for(const image of [good.subarray(0,-12),good.subarray(0,-1),Buffer.concat([good,Buffer.from([0])]),corrupt,
    rewriteChunk(good,'IHDR',data=>data.subarray(0,12)),
    rewriteChunk(good,'IHDR',data=>{data[10]=1;return data}),
    rewriteChunk(good,'IHDR',data=>{data.writeUInt32BE(20000001,0);return data}),
    rewriteChunk(good,'IDAT',()=>Buffer.from('invalid zlib')),
    rewriteChunk(good,'IDAT',()=>deflateSync(Buffer.from([9,...Array(13).fill(0)])))
  ]) assert.throws(()=>inspectStreetPng(image));
});
test('比较相同及明显变化的街景采样',()=>{const a=inspectStreetPng(png([30,40,50])),b=inspectStreetPng(png([180,190,200]));assert.equal(compareStreetFrames(a,a).changed,false);assert.equal(compareStreetFrames(a,b).changed,true);assert.throws(()=>compareStreetFrames(a,{...b,width:3}))});

test('基于可见地图像素仅拦截明显蓝色水域',()=>{
  const water=inspectStreetPng(png([120,170,220]),{x:.5,y:.5});
  assert.equal(water.surface,'unknown'); // tiny samples cannot establish a robust surface
  assert.equal(inspectStreetPng(png([150,200,120]),{x:.5,y:.5}).surface,'unknown');
});
function solidMap(rgb){
 const chunk=(type,data)=>{const b=Buffer.alloc(12+data.length);b.writeUInt32BE(data.length);b.write(type,4);data.copy(b,8);b.writeUInt32BE(pngCrc32(b.subarray(4,8+data.length)),8+data.length);return b};
 const h=Buffer.alloc(13);h.writeUInt32BE(32,0);h.writeUInt32BE(32,4);h[8]=8;h[9]=2;
 const row=Buffer.from([0,...Array.from({length:32},()=>rgb).flat()]);
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',h),chunk('IDAT',deflateSync(Buffer.concat(Array(32).fill(row)))),chunk('IEND',Buffer.alloc(0))]);
}
test('大面积蓝色像素触发水域拦截，绿色不触发',()=>{
 assert.equal(inspectStreetPng(solidMap([130,180,230]),{x:.5,y:.5}).surface,'likely_water');
 assert.equal(inspectStreetPng(solidMap([160,200,140]),{x:.5,y:.5}).surface,'unknown');
});
