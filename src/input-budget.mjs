import {AsyncLocalStorage} from 'node:async_hooks';

export class BudgetExceededError extends Error {}

// A compound action (hover+wheel, press+release, drag) spends one slot at its
// first input, even if the acknowledgement fails. Every input checks time.
export function createInputBudget({state, remaining, actionLimit, stopped=()=>false}) {
  const scopes=new AsyncLocalStorage();
  const checkTime=scope=>{
    if(stopped())throw Error('用户已请求停止');
    if((scope?.remaining ?? remaining)()<=0)throw new BudgetExceededError('时间上限');
  };
  const reserve=scope=>{
    checkTime(scope);
    if(scope.used)return;
    if(!scope.transition){
      if(state.actions>=actionLimit())throw new BudgetExceededError('单题操作上限');
      state.actions++;
    }
    scope.used=true;
  };
  return {
    run(fn) {return scopes.getStore()?fn():scopes.run({used:false},fn);},
    transition(fn, timeLeft=remaining) {
      if(scopes.getStore())throw Error('不能在普通动作内启动页面切换');
      return scopes.run({used:false,transition:true,remaining:timeLeft},fn);
    },
    spend() {reserve({used:false});},
    dispatch(send) {
      const scope=scopes.getStore();
      if(!scope)throw Error('浏览器输入缺少预算作用域');
      reserve(scope);
      return send();
    }
  };
}
