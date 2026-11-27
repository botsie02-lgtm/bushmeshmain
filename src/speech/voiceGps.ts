import {validateLocationFix,type BushMeshLocationFix} from '../location/positionPlanner';
export function localGpsReading(command:'speed'|'heading',fix:BushMeshLocationFix|null,actualNative:boolean,permission:boolean,now=Date.now()):string{
 if(!actualNative||!permission||!fix||validateLocationFix(fix)||fix.timestampMs>now||now-fix.timestampMs>15000||fix.accuracyMeters==null||fix.accuracyMeters>50)return 'Current reliable GPS reading unavailable.';
 if(command==='speed')return fix.speedKmh==null?'GPS speed unavailable.':'GPS speed '+Math.round(fix.speedKmh)+' kilometres per hour.';
 if(fix.headingDegrees==null||fix.headingDegrees<0||fix.headingDegrees>=360||fix.speedKmh==null||fix.speedKmh<5)return 'GPS direction of travel unavailable.';
 return 'GPS direction of travel '+Math.round(fix.headingDegrees)%360+' degrees.';
}
