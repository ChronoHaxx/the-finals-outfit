// Arrange actual renderer captures for visual acceptance; no generated/retouched imagery.
import fs from 'node:fs';
import sharp from 'sharp';
const out='visual-diff/reconstructed/paint-contracts-after';
const report=JSON.parse(fs.readFileSync('scripts/generated/shader-probe/paint-contracts-astra-v1/appearance-checks.json'));
const catalog=JSON.parse(fs.readFileSync('src/data/items.json'));
const label=(s,w,h=32)=>Buffer.from(`<svg width="${w}" height="${h}"><rect width="100%" height="100%" fill="#161b22"/><text x="12" y="22" font-family="Arial" font-size="16" fill="#eee">${s.replaceAll('&','&amp;').replaceAll('<','&lt;')}</text></svg>`);
const overview=[];
let index=0;
for(const c of report.cases.filter(c=>c.added)){
  const item=catalog.find(i=>i.id===c.name);
  const tiles=[{input:label(item.name,1440,40),left:0,top:0}];
  for(let i=0;i<c.views.length;i++){
    const x=i%4*360,y=40+Math.floor(i/4)*432;
    tiles.push({input:await sharp(`${out}/${c.views[i].file}`).resize(360,400).toBuffer(),left:x,top:y});
    tiles.push({input:label(`${i*45} degrees`,360),left:x,top:y+400});
  }
  await sharp({create:{width:1440,height:904,channels:4,background:'#161b22'}}).composite(tiles).png().toFile(`${out}/${c.name}.sheet.png`);
  const x=index%2*720,y=Math.floor(index/2)*310;
  overview.push({input:label(item.name,720,40),left:x,top:y});
  const files=[`public/${item.imageUrl}`,`visual-diff/reconstructed/paint-contracts-before/${c.name}.0.png`,`${out}/${c.name}.0.png`];
  for(let n=0;n<3;n++){
    overview.push({input:await sharp(files[n]).resize(240,240,{fit:'contain',background:'#d5dce2'}).png().toBuffer(),left:x+n*240,top:y+40});
    overview.push({input:label(['Source thumbnail','Before','After'][n],240,30),left:x+n*240,top:y+280});
  }
  index++;
}
await sharp({create:{width:1440,height:1240,channels:4,background:'#161b22'}}).composite(overview).png().toFile(`${out}/overview.png`);
console.log(`${index} eight-view sheets and one source/before/after overview written.`);
