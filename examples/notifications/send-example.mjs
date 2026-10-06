import { sendNotification } from './notify.mjs';
const result = await sendNotification({
  source: 'Example App',
  severity: 'success',
  title: 'Task completed',
  message: 'The local operation finished successfully.',
  context: { task: 'example' },
});
console.log(result.status, result.id);
