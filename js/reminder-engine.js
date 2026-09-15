const ReminderEngine = (function(){
  const CHECK_INTERVAL_MS = 30 * 60 * 1000;
  const CLEANUP_AGE_MS    = 60 * 24 * 60 * 60 * 1000;
  let _intervalId = null, _running = false;

  function _isReady(){
    return !!(state.currentUser && typeof NotificationSystem !== 'undefined' && typeof FirebaseDB !== 'undefined');
  }
  function _remainingDays(endDate){
    if(!endDate) return null;
    const end = new Date(endDate);
    if(isNaN(end.getTime())) return null;
    const today = new Date(); today.setHours(0,0,0,0);
    end.setHours(0,0,0,0);
    return Math.ceil((end - today) / 86400000);
  }
  function _persistTaskFlag(task){
    try{ if(typeof FirebaseDB !== 'undefined' && FirebaseDB.updateTask) FirebaseDB.updateTask(task.id,{reminderSent:task.reminderSent}).catch(()=>{}); } catch(e){}
  }
  function _persistSubtaskFlag(parentTask){
    try{ if(typeof FirebaseDB !== 'undefined' && FirebaseDB.updateTask) FirebaseDB.updateTask(parentTask.id,{subtasks:parentTask.subtasks}).catch(()=>{}); } catch(e){}
  }
  // Note: cleanup of stale notifications is now handled by NotificationSystem._archiveOldNotifications()
  // ReminderEngine no longer performs its own cleanup to avoid duplicate work.
  async function _check(){
    if(!_isReady()) return;
    const tasks = state.tasks || [];
    const cu    = state.currentUser;
    for(const task of tasks){
      if(!task||!task.id) continue;
      task.reminderSent = task.reminderSent||{};
      const days = _remainingDays(task.endDate||task.dueDate);
      const uid  = task.assignee||cu.id;
      if(days !== null){
        if(days===2 && !task.reminderSent.twoDay){
          await NotificationSystem.createNotification({type:'reminder',category:'reminder',userId:uid,taskId:task.id,projectId:task.project||'',sprintId:task.sprint||'',createdBy:'system',title:'Task due in 2 days',message:`"${task.title}" is due in 2 days.`});
          task.reminderSent.twoDay=true; _persistTaskFlag(task);
          console.log('[ReminderEngine] 2-day reminder → task',task.id);
        }
        if(days===1 && !task.reminderSent.oneDay){
          await NotificationSystem.createNotification({type:'reminder',category:'reminder',userId:uid,taskId:task.id,projectId:task.project||'',sprintId:task.sprint||'',createdBy:'system',title:'Task due tomorrow',message:`"${task.title}" is due tomorrow.`});
          task.reminderSent.oneDay=true; _persistTaskFlag(task);
          console.log('[ReminderEngine] 1-day reminder → task',task.id);
        }
      }
      let subDirty = false;
      for(const sub of (task.subtasks||[])){
        if(!sub||!sub.id) continue;
        sub.reminderSent = sub.reminderSent||{};
        const sd  = _remainingDays(sub.endDate||sub.dueDate);
        const su  = sub.assignee||uid;
        if(sd===null) continue;
        if(sd===2 && !sub.reminderSent.twoDay){
          await NotificationSystem.createNotification({type:'reminder',category:'reminder',userId:su,taskId:task.id,subtaskId:sub.id,projectId:task.project||'',sprintId:task.sprint||'',createdBy:'system',title:'Subtask due in 2 days',message:`Subtask "${sub.title}" (in "${task.title}") is due in 2 days.`});
          sub.reminderSent.twoDay=true; subDirty=true;
          console.log('[ReminderEngine] 2-day reminder → subtask',sub.id);
        }
        if(sd===1 && !sub.reminderSent.oneDay){
          await NotificationSystem.createNotification({type:'reminder',category:'reminder',userId:su,taskId:task.id,subtaskId:sub.id,projectId:task.project||'',sprintId:task.sprint||'',createdBy:'system',title:'Subtask due tomorrow',message:`Subtask "${sub.title}" (in "${task.title}") is due tomorrow.`});
          sub.reminderSent.oneDay=true; subDirty=true;
          console.log('[ReminderEngine] 1-day reminder → subtask',sub.id);
        }
      }
      if(subDirty) _persistSubtaskFlag(task);
    }
  }
  function start(){
    if(_running) return; _running=true;
    _check().catch(e=>console.warn('[ReminderEngine] initial check error:',e));
    _intervalId=setInterval(()=>_check().catch(e=>console.warn('[ReminderEngine] interval error:',e)),CHECK_INTERVAL_MS);
    console.log('[ReminderEngine] started');
  }
  function stop(){ if(_intervalId){clearInterval(_intervalId);_intervalId=null;} _running=false; console.log('[ReminderEngine] stopped'); }
  function runNow(){ return _check(); }
  return { start, stop, runNow };
})();
window.ReminderEngine = ReminderEngine;

