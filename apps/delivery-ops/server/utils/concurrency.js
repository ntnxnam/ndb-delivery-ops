/**
 * Run an array of async tasks with bounded concurrency.
 * Preserves result order (results[i] corresponds to tasks[i]()).
 *
 * @param {Array<() => Promise<any>>} tasks - Array of no-arg async functions
 * @param {number} concurrency - Max number of tasks running at once
 * @returns {Promise<Array<any>>} Results in same order as tasks
 */
async function runWithConcurrency(tasks, concurrency) {
  if (tasks.length === 0) return [];
  const results = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      if (i >= tasks.length) break;
      results[i] = await tasks[i]();
    }
  }
  const workers = Array.from(
    { length: Math.min(concurrency, tasks.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

module.exports = {
  runWithConcurrency
};
