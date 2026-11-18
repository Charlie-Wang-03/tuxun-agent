import {acquireRunLock} from '../../src/run-lock.mjs';
try {
  const release=await acquireRunLock(Number(process.argv[2]));
  process.send({locked:true});
  process.on('message',async message=>{if(message==='release'){await release();process.disconnect();}});
} catch(error){process.send({error:error.message});process.disconnect();process.exitCode=1;}
