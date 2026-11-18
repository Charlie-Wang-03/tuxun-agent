import {translate, bindStaticMessages} from './dashboard-i18n.mjs';
import {readPreferences, savePreferences, resolvedTheme, minutesToSeconds} from './dashboard-preferences.mjs';
import {emptySummary} from './dashboard-summary.mjs';
import {parseReplay, summarizeEvents, parseReplayMetadata, indexReplay, createReplayReader, modeNames, actionNames, eventTitle as modelEventTitle, eventDetail as modelEventDetail, eventTone, isKeyEvent, budgetValues, clockText, durationText as modelDurationText, tokenText as modelTokenText} from './dashboard-model.mjs';

export function mountDashboard({token}) {
  let storage;
  try {storage=window.localStorage;} catch { /* In-memory preferences remain available. */ }
  const preferences=readPreferences(storage);
  const t=(value,...values)=>translate(preferences.language,value,...values);
  const eventTitle=event=>modelEventTitle(event,t), eventDetail=event=>modelEventDetail(event,t);
  const durationText=seconds=>modelDurationText(seconds,t), tokenText=summary=>modelTokenText(summary,t);
  const applyStatic=bindStaticMessages(document,t), systemTheme=matchMedia('(prefers-color-scheme: dark)');
  const $ = id => document.getElementById(id);
  const text = (id, value) => {const next = String(value ?? ''); if ($(id).textContent !== next) $(id).textContent = next;};
  const tone = (id, value) => {$(id).dataset.tone = value;};
  const modes = [...document.querySelectorAll('input[name=mode]')];
  let view = 'run', snapshot = null, connected = false, lastStatus = 0, statusTask = null;
  let startPending = false, stopPending = false, mutation = 0, configuring = false;
  let frameURL = null, lastFrame = 0, frameError = '', previewBusy = false, frameEpoch = 0;
  let fullLogGeneration = 0;
  let inspectorTab = 'notes';
  function selectInspector(tab) {
    inspectorTab=tab;
    for(const [name,pane] of [['notes','agentPane'],['events','eventsPane'],['round','roundPane']]) {
      $(pane).hidden=name!==tab;$(name+'Tab').setAttribute('aria-pressed',String(name===tab));
    }
  }
  for(const name of ['notes','events','round'])$(name+'Tab').onclick=()=>selectInspector(name);
  $('logsButton').onclick=()=>{$('runDetails').open=true;$('logsDialog').showModal();renderReplayLog();};
  $('runDetails').ontoggle=()=>{if($('runDetails').open)renderReplayLog();};
  $('closeLogs').onclick=()=>$('logsDialog').close();
  $('advancedButton').onclick=()=>$('advancedDialog').showModal();
  $('closeAdvanced').onclick=()=>$('advancedDialog').close();
  $('actions').oninput=()=>{$('manualReady').checked=false;$('authorize').checked=false;refreshConfig();};
  let replay = null, replayTimer = null, loadGeneration = 0, liveTimelineKey = '', replayTimelineKey = '';

  let currentError='', loadStatus=null;
  function error(message = '') {currentError=message;const value=typeof message==='function'?message():message;text('actionError',value);$('actionError').hidden=!value;}
  function setLoadStatus(render) {loadStatus=render;text('replayLoadStatus',render());}
  function element(tag, value, className) {
    const node = document.createElement(tag);
    if (value != null) node.textContent = String(value);
    if (className) node.className = className;
    return node;
  }
  async function request(url, options = {}) {
    const response = await fetch(url, {...options, signal:AbortSignal.timeout(6000), headers:{'x-dashboard-token':token,...options.headers}});
    if (!response.ok) {const data = await response.json().catch(() => ({})); throw Error(data.error || t`请求失败（${response.status}）`);}
    return response;
  }
  const isReplay = () => view === 'replay' && !!replay;
  const statusFresh = () => connected && Date.now()-lastStatus < 7000;
  const frameFresh = () => lastFrame > 0 && !frameError && Date.now()-lastFrame < 7000;
  function config() {
    return {mode:modes.find(input => input.checked)?.value || 'fixed', games:Number($('games').value), roundSeconds:minutesToSeconds($('round').value), totalSeconds:minutesToSeconds($('total').value), maxActions:Number($('actions').value)};
  }
  function configText(c) {
    return t`${t(modeNames[c.mode]) || t('未知模式')} · ${c.games} 局 / ${c.games*5} 题 · 每题 ${durationText(c.roundSeconds)} · 每局最多 ${durationText(c.totalSeconds)} · 每题 ${c.maxActions} 次操作`;
  }
  function configValid(c) {return Object.hasOwn(modeNames,c.mode) && [c.games,c.roundSeconds,c.totalSeconds,c.maxActions].every(n => Number.isSafeInteger(n) && n > 0);}
  function refreshConfig() {
    const c = config();
    text('configSummary', configValid(c) ? configText(c) : t('请填写有效的正整数预算与局数。'));
    text('roundHint', configValid(c) ? t`每题 ${durationText(c.roundSeconds)}` : t('需要正整数分钟数'));
    text('totalHint', configValid(c) ? t`每局最多 ${durationText(c.totalSeconds)}，新局重置` : t('需要正整数分钟数'));
    $('start').disabled = view !== 'run' || !statusFresh() || !!snapshot?.running || startPending || !frameFresh() || !configValid(c) || !$('manualReady').checked || !$('authorize').checked;
    text('start', startPending ? t('正在请求启动…') : t('确认并启动'));
    const offline = view === 'replay';
    text('workspaceTitle', offline ? t('离线复盘') : t('运行准备'));
    text('nextStep', offline ? t('选择本机运行目录，按局、题和事件查看记录。') :
      !statusFresh() ? t('等待本机服务恢复连接后再启动。') :
      !frameFresh() ? t('请在专用 Chrome 中手动登录图寻并开始经典五题。') :
      !configValid(c) ? t('请将局数和预算填写为有效的正整数。') :
      !$('manualReady').checked ? t('已取得预览；请核对右侧模式、网站计时和运行范围。') :
      !$('authorize').checked ? t('网页设置已人工确认；请核对真实选点与截图发送授权。') :
      t('启动条件已满足，点击“确认并启动”开始本次运行。'));
    const checks = offline ? [[t('读取方式'),t('仅本机浏览器')],[t('事件文件'),t('一份 events.jsonl')],[t('截图文件'),t('与日志一起选择')],[t('模型调用'),t('回放不会调用')]] :
      [[t('本机服务'),statusFresh()?t('已连接'):t('连接未知')],[t('游戏预览'),frameFresh()?t('已取得最新画面'):lastFrame?t('画面已过期'):t('等待画面')],
       [t('网页设置'),$('manualReady').checked?t('已人工确认'):t('待人工核对')],[t('运行授权'),$('authorize').checked?t('已确认'):t('待确认')]];
    checks.forEach(([label,value],i)=>{text('checkLabel'+i,label);text('checkValue'+i,value);});
    text('emptyTitle', offline ? (replay ? t('当前事件暂无可用截图') : t('尚未载入回放画面')) : t('尚未取得游戏预览'));
    text('emptyHelp', offline ? t('选择含 events.jsonl 和对应截图的目录。缺失的截图会在画面下方说明。') : t('请在专用 Chrome 中手动登录并开始经典五题，随后等待预览更新。'));
  }
  function clearFrame() {
    if (frameURL) URL.revokeObjectURL(frameURL);
    frameURL = null; $('frame').removeAttribute('src'); $('frame').hidden = true; $('frameEmpty').hidden = false;
  }
  function setFrame(blob, alt) {
    const next = URL.createObjectURL(blob), old = frameURL;
    $('frame').src = next; $('frame').alt = alt; $('frame').hidden = false; $('frameEmpty').hidden = true; frameURL = next;
    if (old) URL.revokeObjectURL(old);
  }
  function refreshAges() {
    const fresh = statusFresh();
    text('connectionStatus', fresh ? t('控制台 · 已连接本机服务') : lastStatus ? t`控制台 · ${Math.floor((Date.now()-lastStatus)/1000)} 秒未更新` : t('控制台 · 尚未连接'));
    if (!fresh) {
      text('status', t('连接中断 · 状态未知')); tone('status','warning');if(view==='run')text('phaseOverview',t('状态更新中断'));
      $('connectionWarning').hidden = false;
      text('connectionWarning', t('无法确认运行状态，正在重连。已有信息可能过期；连接中断不等于 Agent 已停止。'));
      $('start').disabled = true;
    }
    if (view === 'run') {
      const budget = fresh ? budgetValues(snapshot) : null;
      text('budget', budget ? clockText(budget.round) : snapshot?.running ? t('未知') : t('未运行'));
      text('gameBudget', budget ? clockText(budget.game) : snapshot?.running ? t('未知') : t('未运行'));
      text('actionBudget', budget ? t`${budget.actions} 次` : snapshot?.running ? t('未知') : t('未运行'));
      tone('budget', budget && budget.round <= 60 ? 'warning':'neutral');
      tone('actionBudget', budget && budget.actions <= 3 ? 'warning':'neutral');
      const phase = snapshot?.summary?.phase, began = Date.parse(phase?.time);
      text('phaseElapsed', fresh && snapshot?.running && Number.isFinite(began) ? t`${phase?.kind === 'model_start' ? t('已等待'):t('本阶段已持续')} ${Math.max(0,Math.floor((Date.now()-began)/1000))} 秒 · 完成时间未知` : '');
      const age = Math.max(0,Math.floor((Date.now()-lastFrame)/1000));
      const label = lastFrame ? t`${frameError || (age >= 7 ? t('画面更新中断') : t('实时预览'))} · ${age >= 7 || frameError ? t('当前为旧画面 · ') : ''}最近更新于 ${age} 秒前` : frameError || t('等待专用 Chrome 中的题库经典五题页面');
      text('frameStatus',label); tone('frameStatus',!frameFresh()?'warning':'neutral');text('frameHealth',frameFresh()?t('预览正常更新'):lastFrame?t('预览更新中断，当前为旧画面'):t('等待预览'));
      text('previewReady',frameFresh()?t('程序检查 · 已取得只读预览'):t('程序检查 · 尚无最新预览，暂不能启动'));
    }
    refreshConfig();
  }
  function refreshGlobal() {
    const running = !!snapshot?.running, stopping = !!snapshot?.stopping || stopPending;
    const hasRun = !!snapshot?.runId || !!snapshot?.summary?.started;
    $('main').dataset.view = view;
    $('main').dataset.scene=view==='replay'?(replay?'replay':'replay-empty'):!running&&(!hasRun||configuring)?'prepare':running?'run':'end';
    $('roundTab').hidden=!isReplay();
    if(!isReplay()&&inspectorTab==='round')selectInspector('notes');
    // Keep stop available when the connection drops: a later request may still reach the server.
    $('stop').disabled = (!running && !startPending) || stopping;
    text('stop',stopping?t('正在停止…'):snapshot?.stopError?t('重试停止'):t('停止运行'));
    $('replayFiles').disabled = running || startPending;
    $('changeReplay').disabled = running || startPending;
    for (const node of [...modes,...['games','round','total','actions','manualReady','authorize'].map($)]) node.disabled = running || startPending;
    $('newRun').hidden = running || !hasRun || configuring || view!=='run';
    $('setup').hidden = view !== 'run' || running || (hasRun && !configuring);
    $('replaySetup').hidden = view !== 'replay' || !!replay;
    $('loadFullLog').hidden = view !== 'run';
    $('downloadReplayLog').hidden = !isReplay();
    $('loadFullLog').disabled = !statusFresh() || !snapshot?.summary?.started;
    text('logHint',view==='run'?($('fullLog').hidden?t('最近 120 行运行输出。完整事件记录可按需载入；这是载入时的快照。'):t('完整事件日志已载入（载入时快照，可能含未完成尾行）。下方另保留最近运行输出。')):t('显示当前事件之前最多 120 条记录，每条最多 4000 字符；完整原始日志可另存，包含未完成尾行。'));
    $('replayControls').hidden = !isReplay();
    $('runSummary').hidden = view !== 'run' || !hasRun;
    $('monitor').hidden = false;
    $('endPanel').hidden = view !== 'run' || running || !hasRun || configuring;
    $('connectionWarning').hidden = statusFresh();
    $('stopNotice').hidden = !(stopping || snapshot?.stopError || (view === 'replay' && running));
    text('stopNotice', snapshot?.stopError || (stopping ? t('正在阻止后续输入并等待本地进程结束。已发出的操作或提交仍可能完成；远端模型调用状态可能未知。') : t('另有真实运行正在进行。当前内容是离线记录；顶部“停止运行”控制真实运行。')));
    if (statusFresh()) {
      text('status',view === 'replay' ? (running?t('离线复盘 · 另有运行'):t('离线复盘')) : snapshot?.stopError?t('停止请求失败'):stopping?t('正在停止'):startPending?t('正在启动'):running?t('运行中'):hasRun?t('已结束'):t('准备中'));
      tone('status',snapshot?.stopError?'danger':stopping?'warning':running?'success':'neutral');
    }
    text('workspaceSource',view==='replay'?t('离线记录 · 本地读取'):t('真实游戏 · 只读预览'));
    $('runTab').setAttribute('aria-pressed',String(view==='run'));
    $('replayTab').setAttribute('aria-pressed',String(view==='replay'));
    refreshAges();
  }
  function renderScores(summary) {
    const state=summary.state, scores=summary.scores?.[state?.game || 1] || {};
    const nodes=Array.from({length:5},(_,i)=>{
      const n=i+1, result=scores[n], item=element('div',null,'score-item');
      item.dataset.current=String(n===state?.round);
      item.append(element('span',t`第 ${n} 题`),element('strong',result ? (Number.isFinite(result.points)?t`${result.points.toLocaleString('zh-CN')} 分`:t('结果未记录')) : n===state?.round && view==='run' && snapshot?.running?t('进行中'):t('未记录')));
      if(result?.forced)item.append(element('span',t('兜底提交')));
      return item;
    });
    $('scoreBoard').replaceChildren(...nodes);
  }
  function renderSummary(summary) {
    const state=summary.state, audit=summary.latestAudit;
    text('roundValue',state?.round ? t`第 ${state.game || 1} / ${summary.started?.limits?.games || state.game || 1} 局 · ${state.round} / 5 题` : t('等待题目'));
    text('phase',t(summary.phase?.label) || t('等待运行'));text('phaseOverview',t(summary.phase?.label) || t('等待运行'));
    text('observation',summary.observation || t('本题尚无模型返回的可见线索。'));
    text('decision',summary.decision ? t(actionNames[summary.decision.type] || summary.decision.type) : t('本题尚无动作计划。'));
    text('decisionReason',summary.decision?.reason || '');
    text('actionResult',eventDetail(summary.actionResult));
    $('fallback').hidden=!summary.fallback; text('fallback',summary.fallback?t`兜底原因：${summary.fallback}`:'');
    const verdict=({match:t('与目标描述一致'),mismatch:t('与目标描述不一致'),uncertain:t('不确定')})[audit?.verdict];
    text('auditStatus',t`图钉核对：${verdict || t('暂无记录')}`);
    tone('auditStatus',audit?.verdict==='mismatch'?'danger':audit?.verdict==='uncertain'?'warning':'neutral');
    text('auditReason',audit?.reason || t('本题尚无有效核对记录。'));
    text('modeValue',t(modeNames[summary.started?.mode]) || t('未记录'));
    text('scoreValue',Number.isFinite(state?.score)?state.score.toLocaleString('zh-CN'):t('未记录'));
    text('tokens',tokenText(summary));
    renderScores(summary);
  }
  function renderLive() {
    const summary=snapshot?.summary || emptySummary();
    renderSummary(summary);
    if (snapshot?.running && (snapshot.stopping || stopPending || summary.phase?.kind === 'stopped')) {text('phase',t('等待本地进程结束'));text('phaseOverview',t('等待本地进程结束'));}
    text('outcome',t(snapshot?.stopError) || (snapshot?.stopping?t('正在停止'):snapshot?.running?t('运行中'):t(snapshot?.outcome) || t('尚未启动')));
    if(summary.started)text('runningConfig',configText({mode:summary.started.mode,...summary.started.limits}));
    else text('runningConfig',t('尚未收到运行配置记录'));
    if(!snapshot?.running && (summary.started || snapshot?.runId)) {
      text('endTitle',summary.started?t('本次运行已结束'):t('未能开始运行'));
      text('endReason',t(snapshot.outcome));
      const results=Object.values(summary.scores).flatMap(Object.values);
      text('endStats',summary.started?t`记录 ${results.length} / ${(summary.started.limits?.games || 1)*5} 题结果 · ${results.filter(e=>e.forced).length} 题标记兜底 · 未记录结果不计作零分。`:t('没有收到题目记录；请检查进程错误后重新配置。'));
    }
    const rows=indexReplay(snapshot?.events || []).filter(row=>isKeyEvent(row.event)).slice(-40);
    const key=JSON.stringify(rows);
    if(key!==liveTimelineKey){liveTimelineKey=key;renderTimeline(rows,false);}
    const log=$('log'), near=log.scrollHeight-log.scrollTop-log.clientHeight<60;
    text('log',(snapshot?.lines || []).join('\n'));
    if(near)log.scrollTop=log.scrollHeight;
    $('selectedEvent').hidden=true;
    text('timelineHint',t('最近 40 条 · 完整记录见右上角探索记录'));
  }
  async function status() {
    if(statusTask)return statusTask;
    const version=mutation;
    statusTask=(async()=>{
      try {
        const next=await(await request('/api/status')).json();
        if(version!==mutation)return;
        if (snapshot?.runId !== next.runId) {fullLogGeneration++;$('fullLog').hidden=true;text('fullLog','');}
        snapshot=next; connected=true; lastStatus=Date.now();
        if(next.running)configuring=false;
        if(view==='run')renderLive();
        refreshGlobal();
      } catch {
        if(version!==mutation)return;
        connected=false; refreshGlobal();
      } finally {statusTask=null;}
    })();
    return statusTask;
  }
  async function preview() {
    if(view!=='run'||previewBusy)return;
    previewBusy=true;const epoch=frameEpoch;
    try {
      const blob=await(await request('/api/frame')).blob();
      if(view!=='run'||epoch!==frameEpoch)return;
      setFrame(blob,t('专用浏览器最新只读画面'));lastFrame=Date.now();frameError='';
    } catch(e) {
      if(view!=='run'||epoch!==frameEpoch)return;
      frameError=e.message;
    } finally {previewBusy=false;refreshAges();}
  }
  function switchView(next) {
    if(next===view)return;
    view=next;selectInspector('notes');frameEpoch++;loadGeneration++;fullLogGeneration++;$('fullLog').hidden=true;pauseReplay();clearFrame();lastFrame=0;frameError='';error();
    if(next==='run'){liveTimelineKey='';renderLive();preview();}
    else if(replay){replayTimelineKey='';replay.frameKey=null;renderReplay();}
    else renderEmptyReplay();
    refreshGlobal();
  }
  $('runTab').onclick=()=>switchView('run');
  $('replayTab').onclick=()=>switchView('replay');
  $('changeReplay').onclick=()=>$('replayFiles').click();
  $('openReview').onclick=()=>{switchView('replay');$('replayFiles').focus();};
  $('newRun').onclick=()=>{configuring=true;$('manualReady').checked=false;$('authorize').checked=false;refreshGlobal();modes[0].focus();};
  $('setupForm').oninput=e=>{
    if(e.target.id!=='manualReady'&&e.target.id!=='authorize'){$('manualReady').checked=false;$('authorize').checked=false;}
    refreshConfig();
  };
  $('setupForm').onsubmit=async event=>{
    event.preventDefault();refreshConfig();if($('start').disabled)return;
    const data={...config(),confirm:true};startPending=true;mutation++;fullLogGeneration++;$('fullLog').hidden=true;text('fullLog','');error();refreshGlobal();
    try {
      await request('/api/start',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
      configuring=false;$('manualReady').checked=false;$('authorize').checked=false;
      $('stop').focus();
    } catch(e){error(()=>t`启动请求：${t(e.message)}。请等待状态刷新确认是否已启动，不要重复提交。`);}
    finally {startPending=false;await statusTask;await status();refreshGlobal();}
  };
  $('stop').onclick=async()=>{
    if($('stop').disabled)return;
    stopPending=true;mutation++;error();refreshGlobal();
    try {await request('/api/stop',{method:'POST'});}
    catch(e){error(()=>t`停止请求：${t(e.message)}。尚不能确认已停止，可在连接恢复后重试。`);}
    finally {stopPending=false;await statusTask;await status();refreshGlobal();}
  };

  $('loadFullLog').onclick=async()=>{
    const generation=++fullLogGeneration;error();$('loadFullLog').disabled=true;
    try {
      const log=await(await request('/api/events?run='+encodeURIComponent(snapshot.runId))).text();
      if(generation!==fullLogGeneration || view!=='run')return;
      text('fullLog',log);$('fullLog').hidden=false;text('logHint',t('完整事件日志已载入（载入时的快照，可能含尚未写完的末行）。下方另保留最近运行输出。'));
    } catch(e){if(generation===fullLogGeneration)error(()=>t`无法读取完整事件日志：${t(e.message)}`);}
    finally {if(generation===fullLogGeneration)$('loadFullLog').disabled=!statusFresh();}
  };

  function renderTimeline(rows, interactive) {
    const nodes=rows.map(row=>{
      const li=element('li'), node=element(interactive?'button':'div',null,interactive?'':'event-row');
      node.dataset.tone=eventTone(row.event);
      node.append(element('strong',eventTitle(row.event)),element('small',t`#${row.index+1} · ${row.game} 局${row.round?' / '+row.round+t(' 题'):''}`),element('p',eventDetail(row.event)));
      if(interactive){node.type='button';node.dataset.index=String(row.index);node.onclick=()=>seek(row.index+1);}
      li.append(node);return li;
    });
    $('timeline').replaceChildren(...(nodes.length?nodes:[element('li',t('尚无关键事件。'),'empty-row')]));
  }
  function pauseReplay() {clearInterval(replayTimer);replayTimer=null;if(replay)replay.paused=true;}
  function renderEmptyReplay() {
    renderSummary(emptySummary());
    for(const id of ['phaseElapsed','log','fullLog','provenance','replayRecordInfo','roundReview','selectedEvent'])text(id,'');
    $('fullLog').hidden=true;$('selectedEvent').hidden=true;
    for(const id of ['budget','gameBudget','actionBudget']){text(id,t('回放不计算'));tone(id,'neutral');}
    text('outcome',t('尚未启动'));text('frameStatus',t('尚未载入回放画面'));
    text('timelineHint',t('尚无关键事件。'));renderTimeline([],false);
    $('roundNav').replaceChildren();$('roundNav').dataset.key='';
    liveTimelineKey='';replayTimelineKey='';
  }
  function replayControls() {
    if(!replay)return;
    text('replayPause',replay.position===replay.rows.length?t('重新播放'):replay.paused?t('播放回放'):t('暂停回放'));
    text('replayProgress',`${replay.position} / ${replay.rows.length}`);
    $('replayPosition').value=String(replay.position);
    text('outcome',replay.position===replay.rows.length?t('回放完成'):replay.paused?t('回放已暂停'):t('离线回放'));
  }
  function roundReview(game, round) {
    const group=replay.report.games.get(game) || [], detail=group.find(r=>r.round===round);
    const mixed=detail?.legacyCalls>0&&detail?.structuredCalls>0;
    const result=detail?.result;
    const values=[[t('得分'),Number.isFinite(result?.points)?`${result.points} / 5000`:t('未记录')],[t('距离'),result?.distance || t('未记录')],[t('耗时'),detail?.elapsed != null?t`${detail.elapsed} 秒`:t('未知')],[t('模型调用'),detail?t`${detail.modelCalls} 次`:t('未记录')],[t('已知 token'),mixed?t('口径混合，不合计'):detail?.tokenKnownCalls?`${detail.tokenTotal}${detail.missingTokens?t('（部分未知）'):''}`:t('未知')],[t('兜底'),result?.forced===true?result.forced_detail?.trigger || t('是，原因未记录'):result?.forced===false?t('未标记兜底'):t('未知')]];
    const nodes=values.map(([label,value])=>{const div=element('div');div.append(element('span',label+' '),element('strong',value));return div;});
    $('roundReview').replaceChildren(...nodes);
  }
  function replayInfo(meta,began,truncated) {
      const source=meta?({real:t('真实录制'),simulated:t('模拟')})[meta.source]+t('（文件声明）'):t('来源未知');
      const editing=meta?({redacted:t('已遮盖'),none:t('未经编辑'),unknown:t('编辑情况未知')})[meta.editing]+t('（文件声明）'):t('编辑情况未知');
      return t`离线回放 · ${source} · ${meta?.recorded_at || began || t('录制时间未知')} · ${editing}${truncated?t(' · 日志末行不完整'):''}`;
  }
  function renderReplay() {
    if(!replay)return;
    replay.info=replayInfo(replay.meta,replay.began,replay.truncated);text('provenance',replay.info);
    text('replayRecordInfo',t`${replay.rows.length} 个事件 · ${replay.report.resultCount} / ${replay.report.plannedGames*5} 题有结果 · 文件仅在本机读取`);
    for(const option of $('replayGame').options)option.textContent=t`第 ${option.value} 局`;
    const state=replay.reader.at(replay.position), {summary,screenshot,last}=state;
    renderSummary(summary);text('phaseElapsed',t('回放显示记录阶段，不计算实时等待'));
    for(const id of ['budget','gameBudget','actionBudget']){text(id,t('回放不计算'));tone(id,'neutral');}
    const game=last?.game || Number($('replayGame').value) || 1, round=last?.round || 1;
    $('replayGame').value=String(game);roundReview(game,round);
    const navKey=preferences.language+':'+game;
    if($('roundNav').dataset.key!==navKey){
      const buttons=Array.from({length:5},(_,i)=>{
        const n=i+1,row=replay.reader.roundStart(game,n),result=replay.report.games.get(game)?.[i]?.result;
        const button=element('button');button.type='button';button.append(element('span',t`第 ${n} 题`),element('small',result?Number.isFinite(result.points)?t`${result.points} 分${result.forced?t(' · 兜底'):''}`:t('结果未记录'):t('未记录结果')));
        button.disabled=!row;button.onclick=()=>seek(row.index+1);return button;
      });
      $('roundNav').dataset.key=navKey;$('roundNav').replaceChildren(...buttons);
    }
    [...$('roundNav').children].forEach((button,i)=>button.setAttribute('aria-current',String(i+1===round)));
    const frameKey=screenshot?`${screenshot.index}:${screenshot.name}`:'none';
    if(replay.frameKey!==frameKey){
      replay.frameKey=frameKey;clearFrame();
      if(screenshot&&replay.images.has(screenshot.name))setFrame(replay.images.get(screenshot.name),t`离线截图 · 事件 ${screenshot.index+1} · ${eventTitle({kind:screenshot.kind})}`);
    }
    const caption=screenshot ? replay.images.has(screenshot.name)?t`截图关联事件：${screenshot.kind} · #${screenshot.index+1}${screenshot.index!==replay.position-1?t(' · 当前事件无新截图，沿用本题最近记录'):''}`:t('当前截图缺失，已隐藏旧画面') : t('本题在当前位置尚无截图');
    text('frameStatus',`${replay.info} · ${caption}`);tone('frameStatus',!screenshot||!replay.images.has(screenshot.name)?'warning':'neutral');
    const timeline=replay.reader.timeline(game,round,replay.position);
    const key=`${game}:${round}:${timeline.rows[0]?.index}:${timeline.rows.at(-1)?.index}`;
    if(replayTimelineKey!==key){
      replayTimelineKey=key;
      renderTimeline(timeline.rows,true);
    }
    for(const button of $('timeline').querySelectorAll('button'))button.setAttribute('aria-current',String(Number(button.dataset.index)===replay.position-1));
    text('timelineHint',t`第 ${game} 局 · 第 ${round} 题 · 显示附近 ${timeline.rows.length} / ${timeline.total} 个关键节点；拖动进度可查看其他位置`);
    $('selectedEvent').hidden=!last;
    if(last){const heading=element('strong',t`当前事件 #${last.index+1} · ${eventTitle(last.event)}`);$('selectedEvent').replaceChildren(heading,element('p',eventDetail(last.event)),element('p',last.event.time || t('事件时间未记录')));}
    renderReplayLog();
    replayControls();
  }
  function renderReplayLog() {
    if(isReplay()&&$('logsDialog').open&&$('runDetails').open)text('log',replay.reader.log(replay.position).text);
  }
  function releaseReplayLog() {
    if(replay?.logURL)URL.revokeObjectURL(replay.logURL);
    $('downloadReplayLog').removeAttribute('href');
  }
  function seek(position) {
    if(!replay)return;
    pauseReplay();replay.position=Math.max(0,Math.min(replay.rows.length,Math.trunc(Number(position)||0)));renderReplay();
  }
  function playReplay() {
    if(!replay)return;
    pauseReplay();if(replay.position===replay.rows.length)replay.position=0;
    replay.paused=false;replayControls();
    replayTimer=setInterval(()=>{
      if(!replay||view!=='replay')return pauseReplay();
      replay.position=Math.min(replay.position+1,replay.rows.length);
      if(replay.position===replay.rows.length)pauseReplay();
      renderReplay();
    },1000/Number($('replaySpeed').value));
  }
  $('replayPause').onclick=()=>{if(!replay)return;if(replay.paused)playReplay();else{pauseReplay();replayControls();}};
  $('replaySpeed').onchange=()=>{if(replay&&!replay.paused)playReplay();};
  $('replayPosition').oninput=e=>seek(e.target.value);
  $('replayGame').onchange=e=>{const row=replay?.reader.gameStart(Number(e.target.value));if(row)seek(row.index+1);};
  $('replayFiles').onchange=async event=>{
    const generation=++loadGeneration;error();
    try {
      if(snapshot?.running||startPending)throw Error('请先停止真实运行，再载入离线记录。');
      const files=[...event.target.files],logs=files.filter(f=>f.name==='events.jsonl');
      if(logs.length!==1)throw Error('请选择只包含一份 events.jsonl 的运行目录');
      setLoadStatus(()=>t('正在本机读取记录…'));
      const log=logs[0],parent=file=>(file.webkitRelativePath||file.name).replace(/[^/]*$/,'');
      const parsed=parseReplay(await log.text());
      const metaFiles=files.filter(f=>parent(f)===parent(log)&&f.name==='replay-meta.json');
      if(metaFiles.length>1)throw Error('回放说明文件重复');
      const meta=metaFiles.length?parseReplayMetadata(await metaFiles[0].text()):null;
      if(generation!==loadGeneration||view!=='replay')return;
      if(snapshot?.running)throw Error('检测到真实运行，请先停止后载入记录。');
      const rows=indexReplay(parsed.events),reader=createReplayReader(rows),report=summarizeEvents(parsed.events,parsed);
      pauseReplay();releaseReplayLog();frameEpoch++;clearFrame();replayTimelineKey='';$('roundNav').dataset.key='';
      const began=parsed.events.find(e=>e.kind==='started')?.time;
      const info=replayInfo(meta,began,parsed.truncated);
      replay={meta,began,truncated:parsed.truncated,rows,reader,report,logURL:URL.createObjectURL(log),images:new Map(files.filter(f=>parent(f)===parent(log)&&/\.(png|jpe?g)$/i.test(f.name)).map(f=>[f.name,f])),info,position:1,paused:true,frameKey:null};
      $('downloadReplayLog').href=replay.logURL;
      const options=[...replay.report.games.keys()].map(game=>{const option=element('option',t`第 ${game} 局`);option.value=String(game);return option;});
      $('replayGame').replaceChildren(...options);$('replayPosition').max=String(replay.rows.length);$('replayExit').disabled=false;
      text('provenance',info);setLoadStatus(()=>t`已载入 ${replay.rows.length} 个事件 · ${replay.report.resultCount} / ${replay.report.plannedGames*5} 题有结果。来源声明未经程序验证；原始记录可能包含私人信息。`);
      text('replayRecordInfo',t`${replay.rows.length} 个事件 · ${replay.report.resultCount} / ${replay.report.plannedGames*5} 题有结果 · 文件仅在本机读取`);
      renderReplay();refreshGlobal();
    } catch(e){if(generation!==loadGeneration)return;error(()=>t`无法载入回放：${t(e.message)}`);setLoadStatus(()=>replay?t('载入失败，保留上一份记录。'):t('载入失败，请检查目录。'));}
    finally {event.target.value='';}
  };
  $('replayExit').onclick=()=>{
    loadGeneration++;pauseReplay();releaseReplayLog();replay=null;clearFrame();$('replayExit').disabled=true;error();
    fullLogGeneration++;renderEmptyReplay();
    setLoadStatus(()=>t('记录已关闭，文件未上传。'));refreshGlobal();
  };
  $('frame').onerror=()=>{
    $('frame').hidden=true;$('frameEmpty').hidden=false;
    if(isReplay())text('frameStatus',t`${replay.info} · 截图无法解码，已隐藏画面`);
    else{frameError=t('预览图片无法解码');refreshAges();}
  };
  const themeOrder=['light','dark','system'];
  const themeLabel={light:'亮色',dark:'暗色',system:'跟随系统'};
  function nextTheme() {return themeOrder[(themeOrder.indexOf(preferences.theme)+1)%themeOrder.length];}
  function applyPreferenceButtons() {
    $('languageTarget').textContent=preferences.language==='zh'?'EN':'中';
    const languageLabel=preferences.language==='zh'?t('切换为英文'):t('切换为中文');
    $('languageToggle').dataset.value=preferences.language;
    $('languageToggle').title=languageLabel;$('languageToggle').setAttribute('aria-label',languageLabel);
    const themeHint=t`当前：${t(themeLabel[preferences.theme])}；点击切换为${t(themeLabel[nextTheme()])}`;
    $('themeToggle').dataset.value=preferences.theme;
    $('themeToggle').title=themeHint;$('themeToggle').setAttribute('aria-label',themeHint);
    for(const icon of $('themeToggle').querySelectorAll('[data-mode]'))icon.toggleAttribute('hidden',icon.dataset.mode!==preferences.theme);
  }
  function applyTheme() {
    document.documentElement.dataset.theme=resolvedTheme(preferences.theme,systemTheme.matches);
    applyPreferenceButtons();
  }
  function applyLanguage() {
    document.documentElement.lang=preferences.language==='en'?'en':'zh-CN';
    applyStatic();applyPreferenceButtons();
    liveTimelineKey='';replayTimelineKey='';
    if(isReplay()){replay.frameKey=null;renderReplay();}else if(view==='run')renderLive();else renderEmptyReplay();
    error(currentError);if(loadStatus)setLoadStatus(loadStatus);
    refreshGlobal();
  }
  $('languageToggle').onclick=()=>{preferences.language=preferences.language==='zh'?'en':'zh';savePreferences(storage,preferences);applyLanguage();};
  $('themeToggle').onclick=()=>{preferences.theme=nextTheme();savePreferences(storage,preferences);applyTheme();};
  systemTheme.addEventListener('change',applyTheme);
  applyTheme();applyLanguage();status();preview();
  const statusTimer=setInterval(status,1000),previewTimer=setInterval(preview,2000),ageTimer=setInterval(refreshAges,1000);
  window.addEventListener('pagehide',()=>{clearInterval(statusTimer);clearInterval(previewTimer);clearInterval(ageTimer);pauseReplay();releaseReplayLog();clearFrame();systemTheme.removeEventListener('change',applyTheme);},{once:true});
}
