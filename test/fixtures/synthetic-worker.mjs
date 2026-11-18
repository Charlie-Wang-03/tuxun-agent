// Test-only worker. It does not connect to a browser or model.
const send = event => process.send?.({type:'event',event});
const now=Date.now();
send({kind:'started',mode:'fixed',limits:{games:1,roundSeconds:20,totalSeconds:60,maxActions:5}});
send({kind:'state',game:1,round:1,score:0,actions:0,start:now,roundStart:now,roundLimit:20,actionLimit:5});
send({kind:'selection_audit',game:1,round:1,verdict:'uncertain',reason:'模拟范围不清'});
send({kind:'model_start',label:'模拟核对',time:new Date(now).toISOString()});
console.log('模拟观察：本地测试');
const splitLine=Buffer.from('分段中文输出\n');
process.stdout.write(splitLine.subarray(0,2));
setImmediate(()=>process.stdout.write(splitLine.subarray(2)));
process.on('message', message => {
  if (message?.type !== 'stop') return;
  send({kind:'stopped',reason:'模拟停止；提交状态未知'});
  process.disconnect();
});
