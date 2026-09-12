import fs from 'node:fs';
import sharp from 'sharp';
const dir='visual-diff/reconstructed/native-nails-after';
const report=JSON.parse(fs.readFileSync('scripts/generated/shader-probe/native-nails-astra-v1/appearance.json'));
const catalog=JSON.parse(fs.readFileSync('src/data/items.json'));
const escape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const ids=[...new Set(report.cases.filter(c=>c.view==='right'&&c.id!=='bare').map(c=>c.id))];
const rows=[];
for(const id of ids){
 const item=catalog.find(i=>i.id===id);const width=810,height=390;
 // Capture keys name the camera side, not anatomy: +X ("right") is the source left hand.
 const title=Buffer.from(`<svg width="${width}" height="35"><rect width="100%" height="100%" fill="#161b22"/><text x="10" y="24" font-family="Arial" font-size="18" fill="white">${escape(item.name)} — character left / right</text></svg>`);
 const comp=[{input:title,left:0,top:0},{input:await sharp(`public/${item.imageUrl}`).resize(170,355,{fit:'contain',background:'#dce2e8'}).png().toBuffer(),left:0,top:35}];
 for(const [i,view] of ['right','left'].entries())comp.push({input:await sharp(`${dir}/${id}.${view}.png`).resize(320,355).png().toBuffer(),left:170+i*320,top:35});
 const row=await sharp({create:{width,height,channels:4,background:'#161b22'}}).composite(comp).png().toBuffer();
 rows.push(row);
}
const sheets=[];
for(let offset=0;offset<rows.length;offset+=4){const batch=rows.slice(offset,offset+4);const file=`${dir}/sheet-${String(sheets.length+1).padStart(2,'0')}.png`;await sharp({create:{width:810,height:390*batch.length,channels:4,background:'#161b22'}}).composite(batch.map((input,i)=>({input,left:0,top:i*390}))).png().toFile(file);sheets.push({file,ids:ids.slice(offset,offset+4)});}
fs.writeFileSync('scripts/generated/shader-probe/native-nails-astra-v1/sheets.json',JSON.stringify(sheets,null,2)+'\n');console.log(`${ids.length} nail choices in ${sheets.length} sheets`);
