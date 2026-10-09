export function workoutAdmin(workout, config, url, body) {
  if (!workout) throw new Error('Workout service unavailable.');
  const userId =
    body?.userId || url.searchParams.get('userId') || config.customOwnerId || config.ownerIds?.[0];
  switch (url.pathname) {
    case '/api/workout/state':
      return workout.state(userId);
    case '/api/workout/exercises':
      return workout.saveRecord('exercises', body.record, userId, body.expectedRevision);
    case '/api/workout/programs':
      return workout.saveRecord('programs', body.record, userId, body.expectedRevision);
    case '/api/workout/chains':
      return workout.saveRecord('chains', body.record, userId, body.expectedRevision);
    case '/api/workout/preferences':
      return workout.savePreferences(body.preferences);
    case '/api/workout/next':
      return workout.setNext(userId, body.programId, body.templateId, body.expectedRevision);
    case '/api/workout/start':
      return workout.start(userId, body);
    case '/api/workout/confirm':
      return workout.confirmation(userId, body.sessionId, body);
    case '/api/workout/action':
      return workout.mutate(userId, body.sessionId, body);
    case '/api/workout/decision':
      return workout.decide(userId, body.sessionId, body);
    case '/api/workout/correct':
      return workout.correct(userId, body.sessionId, body);
    default:
      throw new Error('Unknown Workout API.');
  }
}
export const workoutGetRoutes = ['/api/workout/state'];
export const workoutPostRoutes = [
  'exercises',
  'programs',
  'chains',
  'preferences',
  'next',
  'start',
  'confirm',
  'action',
  'decision',
  'correct',
].map((route) => '/api/workout/' + route);
