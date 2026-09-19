"""Run configured family stages sequentially and preserve timings/logs for every attempt."""
import argparse, json, os, subprocess, sys, time
from datetime import datetime, timezone
from pathlib import Path

def run(manifest_path, stages):
    manifest = json.loads(Path(manifest_path).read_text(encoding='utf8'))
    folder = Path(manifest['paths']['docs'])/'runs'
    folder.mkdir(parents=True, exist_ok=True)
    at = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    receipt = folder/(at+'.json')
    record = {'manifest':str(manifest_path),'startedAt':at,'stages':[],'complete':False}
    def save():
        receipt.write_text(json.dumps(record,indent=2)+'\n',encoding='utf8')
    save()
    for stage in stages:
        if stage == 'freeze':
            command = ['node','--import','tsx','scripts/shader-probe/freeze-family.mjs','--manifest',str(manifest_path)]
        elif stage in ('mesh','source','build','gpu','index','coverage','verify'):
            command = [sys.executable,'-B','scripts/shader-probe/prepare-family.py','--manifest',str(manifest_path),stage]
        else:
            raise ValueError(f'Unknown family stage {stage}')
        log = folder/(at+'-'+stage+'.log')
        entry = {'stage':stage,'startedAt':datetime.now(timezone.utc).isoformat(),'log':str(log),'complete':False}
        record['stages'].append(entry);save()
        start = time.monotonic()
        with log.open('wb') as stream:
            result = subprocess.run(command,stdout=stream,stderr=subprocess.STDOUT,
                env={**os.environ,'APP_URL':manifest['paths']['appUrl']},
                creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
        entry.update(seconds=round(time.monotonic()-start,3),exitCode=result.returncode,complete=True)
        save()
        print(json.dumps({'family':manifest['id'],**entry}),flush=True)
        if result.returncode:
            print(log.read_text(encoding='utf8',errors='replace')[-3000:],flush=True)
            return result.returncode
    record['complete']=True;record['finishedAt']=datetime.now(timezone.utc).isoformat();save()
    return 0

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--manifest',required=True)
    p.add_argument('--stages',default='mesh,freeze,source,build,gpu,index,coverage,verify')
    a=p.parse_args()
    raise SystemExit(run(a.manifest,a.stages.split(',')))
