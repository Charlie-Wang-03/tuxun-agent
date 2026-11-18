export const blindAuditPrompt = `只观察两张同一游戏地图截图，不使用工具、搜索或外部数据。第二张以同一个图钉为中心放大；橙色图钉的尖端是选点。独立判断尖端实际位于哪个国家：先辨认可见国界以及尖端在国界的哪一侧；地名接近不代表属于该国。图钉或国界被遮挡、地图尺度不足或无法可靠判断时，certainty 必须为 uncertain，country_code 填空字符串；仅有可见国界和地名足以明确判断时，certainty 才为 visible，此时 country_code 填 ISO 3166-1 alpha-2 两位大写国家代码。reason 用中文解释，不推测正确答案。`;
export function validateBlindAudit(value) {
 if(!value || !['visible','uncertain'].includes(value.certainty) || typeof value.reason!=='string' || !value.reason.trim() || typeof value.country_code!=='string')throw Error('独立国家核对结果无效');
 if(value.certainty==='visible'&&!/^[A-Z]{2}$/.test(value.country_code))throw Error('独立国家核对代码无效');
 if(value.certainty==='uncertain'&&value.country_code!=='')throw Error('不确定时不能断言国家');
 return value;
}
export function reconcileCountry(audit,blind) {
 if(audit.verdict!=='match' || !/^[A-Z]{2}$/.test(audit.target_country_code ?? ''))return audit;
 if(blind.certainty==='uncertain')return {...audit,verdict:'uncertain',reason:`独立国家核对无法确认：${blind.reason}`,approximate_ok:false,has_correction:false};
 if(blind.country_code!==audit.target_country_code)return {...audit,verdict:'mismatch',reason:`独立国家核对为 ${blind.country_code}，与目标 ${audit.target_country_code} 不一致：${blind.reason}`,approximate_ok:false,has_correction:false};
 return audit;
}

// A timeout is absence of independent evidence, never a successful check.
export async function runBlindCheck(call) {
 try {const response=await call();return {blind:validateBlindAudit(response.value),tokens:response.tokens,timedOut:false};}
 catch(error){if(error.message!=='模型调用超时')throw error;return {blind:{certainty:'uncertain',country_code:'',reason:'独立国家核对超时'},tokens:null,timedOut:true};}
}
