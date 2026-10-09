export const template = `
<div class="workout-toolbar"><nav id="workoutTabs" aria-label="Workout pages"></nav><div class="columns"><label>Workout user ID<input id="workoutUser" inputmode="numeric" /></label><button id="workoutRefresh" class="quiet" type="button">Load user / refresh Workout</button></div></div>
<div id="workoutContent" aria-live="polite"><section><p>Loading Workout…</p></section></div>`;
export const summary = (data) => {
  const w = data.workout;
  if (!w) return 'Workout service unavailable';
  if (w.active)
    return `${w.active.name} in progress · ${w.active.exercise}/${w.active.exercises} exercises · ${w.active.sets} working sets`;
  return `Next: ${w.next || 'No plan selected'} · Last: ${w.last ? new Date(w.last).toLocaleDateString() : 'No completed workouts'} · No active workout`;
};
