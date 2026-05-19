/**
 * In-memory cache for board sprints (id -> { state, name, ... }).
 * TTL 10 minutes so we don't hit JIRA on every release-items request.
 */

const axios = require('axios');
const { JIRA_AGILE } = require('../config/api');
const teamBoardConfig = require('../config/teamBoardConfig.json');

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const cache = new Map(); // cacheKey (boardId:state) -> { at: number, map: Map(sprintId -> { state, name, startDate, endDate, completeDate }) }

/**
 * Fetch sprints for a board (paginated). Optionally filter by state (e.g. 'active', 'closed', 'future').
 * Returns Map(sprintId -> { state, name, startDate, endDate, completeDate }).
 * @param {number} boardId
 * @param {string} token - JIRA Bearer token
 * @param {object} httpsAgent
 * @param {string} [state] - Optional: 'active' | 'closed' | 'future' to filter sprints
 * @returns {Promise<Map<number, { state: string, name: string, startDate: string|null, endDate: string|null, completeDate: string|null }>>}
 */
async function fetchSprintsForBoard(boardId, token, httpsAgent, state) {
  const url = JIRA_AGILE.BOARD_SPRINTS(boardId);
  const result = new Map();
  let startAt = 0;
  const maxResults = 50;
  let hasMore = true;
  const params = { startAt: 0, maxResults };
  if (state) params.state = state;

  while (hasMore) {
    params.startAt = startAt;
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json'
      },
      httpsAgent,
      timeout: 15000,
      params
    });

    const values = response.data?.values || [];
    for (const s of values) {
      const id = s.id;
      if (id != null) {
        result.set(Number(id), {
          state: s.state || null,
          name: s.name || null,
          startDate: s.startDate || null,
          endDate: s.endDate || null,
          completeDate: s.completeDate || null
        });
      }
    }
    startAt += values.length;
    hasMore = values.length === maxResults && (response.data?.isLast === false || startAt < (response.data?.total || 0));
  }
  return result;
}

/**
 * Get sprint id -> { state, name, startDate, endDate, completeDate } for a board. Uses in-memory cache with TTL.
 * @param {number} boardId
 * @param {string} token
 * @param {object} httpsAgent
 * @param {string} [state] - Optional: 'active' | 'closed' | 'future' to filter sprints
 * @returns {Promise<Map<number, { state: string, name: string, startDate: string|null, endDate: string|null, completeDate: string|null }>>}
 */
async function getSprintsForBoard(boardId, token, httpsAgent, state) {
  const cacheKey = state ? `${boardId}:${state}` : String(boardId);
  const now = Date.now();
  const entry = cache.get(cacheKey);
  if (entry && now - entry.at < CACHE_TTL_MS) {
    return entry.map;
  }
  const map = await fetchSprintsForBoard(boardId, token, httpsAgent, state);
  cache.set(cacheKey, { at: now, map });
  return map;
}

/**
 * Resolve sprint state for an issue's sprint field value (CF 10360).
 * Value can be number, string, or object with id.
 * @param {*} raw - issue.fields.customfield_10360
 * @param {Map<number, { state, name }>} sprintMap
 * @returns {{ state: string|null, name: string|null }}
 */
function resolveSprintState(raw, sprintMap) {
  if (!sprintMap || sprintMap.size === 0) return { state: null, name: null };
  let id = null;
  if (typeof raw === 'number' && !Number.isNaN(raw)) id = raw;
  else if (typeof raw === 'string' && raw.trim() !== '') {
    const n = parseInt(raw, 10);
    if (!Number.isNaN(n)) id = n;
  } else if (raw && typeof raw === 'object' && raw.id != null) {
    id = Number(raw.id);
  }
  if (id == null) return { state: null, name: null };
  const info = sprintMap.get(Number(id));
  return info ? { state: info.state, name: info.name } : { state: null, name: null };
}

/**
 * Classify a JIRA issue into one of the four sprint-report buckets based on
 * its status:
 *   - 'completedInSprint' — status matches teamBoardConfig.completedStatusName (default 'Closed')
 *   - 'pendingQA'         — status matches teamBoardConfig.pendingQAStatusName  (default 'Resolved')
 *   - 'open'              — status category is 'new' (i.e. To Do)
 *   - 'inProgress'        — anything else (typically the In Progress category)
 *
 * @param {object} issue - JIRA issue with .fields.status
 * @returns {'completedInSprint'|'pendingQA'|'open'|'inProgress'}
 */
function classifySprintIssue(issue) {
  const status = (issue && issue.fields && issue.fields.status) || {};
  const statusName = (status.name || '').trim();
  const statusCategoryKey = (status.statusCategory && status.statusCategory.key) || '';
  const completed = (teamBoardConfig.completedStatusName || 'Closed').trim();
  const pendingQA = (teamBoardConfig.pendingQAStatusName || 'Resolved').trim();
  if (statusName === completed) return 'completedInSprint';
  if (statusName === pendingQA) return 'pendingQA';
  if (statusCategoryKey === 'new') return 'open';
  return 'inProgress';
}

/**
 * Walk an issue's changelog (newest-first) and find the timestamp when the
 * sprint field was set to the given sprintId. Returns ISO date string or null.
 *
 * @param {Array} histories - JIRA issue changelog histories
 * @param {number|string} sprintId
 * @param {string} sprintFieldId - usually 'customfield_10360'
 * @returns {string|null}
 */
function getAddedToSprintAt(histories, sprintId, sprintFieldId) {
  const sid = Number(sprintId);
  const list = histories || [];
  for (let i = list.length - 1; i >= 0; i--) {
    const h = list[i];
    const items = h.items || [];
    for (const item of items) {
      if (item.field !== sprintFieldId && item.fieldId !== sprintFieldId) continue;
      const toVal = item.to;
      const toId = toVal != null && (typeof toVal === 'number' || typeof toVal === 'string')
        ? Number(toVal)
        : (toVal && typeof toVal === 'object' && toVal.id != null ? Number(toVal.id) : null);
      if (toId === sid) {
        return h.created || null;
      }
    }
  }
  return null;
}

module.exports = {
  getSprintsForBoard,
  resolveSprintState,
  fetchSprintsForBoard,
  classifySprintIssue,
  getAddedToSprintAt
};
