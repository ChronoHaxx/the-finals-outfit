"""Make diagnostic contact sheets from capture/outfit reports; original PNGs remain unchanged."""
import argparse,json,math
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont

def make(report_path, output, slot, columns):
    report_path=Path(report_path);output=Path(output)
    if output.exists():raise ValueError('Preserve existing review sheet')
    report=json.loads(report_path.read_text(encoding='utf8'))
    if not report.get('passed'):raise ValueError('Review failed captures individually first')
    entries=[]
    for item in report.get('items',[]):
        for view in item['views']:
            entries.append((report_path.parent/view['image'],item['id'].split('-',2)[-1]+' / '+view['angle']['name']))
    entries.extend((report_path.parent/row['image'],row['name']) for row in report.get('checks',[]))
    for case in report.get('cases',[]):
        for state in ('original', 'mask-zero'):
            path=report_path.parent/(case['id']+'-'+state+'.png')
            if not path.is_file():raise ValueError(f'Missing mask control image: {path}')
            entries.append((path,case['id']+' / '+state))
    if not entries:raise ValueError('Report contains no images')
    w,h=350,280
    canvas=Image.new('RGB',(w*columns,h*math.ceil(len(entries)/columns)+38),'#141a22')
    draw=ImageDraw.Draw(canvas);font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',13)
    draw.text((10,10),output.stem+' — diagnostic crops; originals retained',font=font,fill='white')
    for i,(path,label) in enumerate(entries):
        with Image.open(path) as source:im=source.convert('RGB')
        if not report.get('checks') and slot in ('upperBody','lowerBody','upperBack'):
            iw,ih=im.size
            box={'upperBody':(.30,.06,.70,.94),'lowerBody':(.34,.04,.66,1),'upperBack':(.32,.10,.70,.88)}[slot]
            im=im.crop(tuple(round(v*(iw if n%2==0 else ih)) for n,v in enumerate(box)))
        im.thumbnail((w-12,h-35));x=(i%columns)*w;y=(i//columns)*h+38
        canvas.paste(im,(x+(w-im.width)//2,y));draw.text((x+5,y+h-29),label[:51],font=font,fill='white')
    output.parent.mkdir(parents=True,exist_ok=True);canvas.save(output,quality=92)
    print(json.dumps({'output':str(output),'images':len(entries),'sourceReport':str(report_path)}))

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--report',required=True);p.add_argument('--output',required=True)
    p.add_argument('--slot',default='');p.add_argument('--columns',type=int,default=4)
    a=p.parse_args()
    if not 1<=a.columns<=6:p.error('columns must be between 1 and 6')
    make(a.report,a.output,a.slot,a.columns)
