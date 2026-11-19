import { useMemo, useCallback } from 'react';
import {
  formatDateLabel, computeGaDates, computeScaledWidths, getPositionPercent as getPosFn,
  computeValidSprintDates, computeWeeklyMarkers, computeGateMarkers, buildGateDateRows as buildRows,
  TICK_COLOR_BY_STATUS, getTickStyleForStatus as getTickFn,
} from '../services/ganttService';

/**
 * useGanttData — derives all Gantt computations from props.
 * No axios/fetch; pure derives via useMemo. Keeps JSX in component per minimal-architecture.
 */
export function useGanttData({ ganttConfig, selectedVersion, items, checkpointHistory, sortItems, sprintDates = [], allVersionsConfig = null, statusesWithTick = [] }) {
  const gaDates = useMemo(()=>computeGaDates(ganttConfig), [ganttConfig]);

  const timeline = useMemo(()=>{
    if (!ganttConfig?.ecDate || !gaDates.length) return null;
    const ec = new Date(ganttConfig.ecDate);
    const ga = gaDates[gaDates.length-1].date;
    const start = ec.getTime();
    const end = ga.getTime();
    const dur = end-start;
    if (dur<=0) return null;
    return { ec, ga, timelineStart:start, timelineEnd:end, timelineDuration:dur };
  }, [ganttConfig, gaDates]);

  const scaled = useMemo(()=>{
    if (!timeline) return { scaledMarkerWidth:3, scaledECWidth:4, scaledThinMarkerWidth:2 };
    return computeScaledWidths(timeline.timelineDuration, allVersionsConfig, ganttConfig);
  }, [timeline, allVersionsConfig, ganttConfig]);

  const getPositionPercent = useCallback((date)=>{
    if (!timeline) return null;
    return getPosFn(date, timeline.timelineStart, timeline.timelineDuration, timeline.timelineEnd);
  }, [timeline]);

  const validSprintDates = useMemo(()=>{
    if (!timeline) return [];
    return computeValidSprintDates(sprintDates, timeline.timelineStart, timeline.timelineEnd, getPositionPercent);
  }, [sprintDates, timeline, getPositionPercent]);

  const weeklyMarkers = useMemo(()=>{
    if (!timeline) return [];
    return computeWeeklyMarkers(sprintDates, timeline.timelineStart, timeline.timelineEnd, getPositionPercent);
  }, [sprintDates, timeline, getPositionPercent]);

  const gateMarkers = useMemo(()=>{
    if (!timeline || !ganttConfig) return [];
    return computeGateMarkers(ganttConfig, timeline.timelineStart, timeline.timelineEnd);
  }, [ganttConfig, timeline]);

  const gateDateRows = useMemo(()=>buildRows(ganttConfig), [ganttConfig]);

  const commitItemsSorted = useMemo(()=>{
    if (!sortItems) return items?.commit || [];
    return sortItems(items?.commit || []);
  }, [items, sortItems]);

  const getTickStyle = useCallback((statusStr, cPos, cgPos, pgPos)=>getTickFn(statusStr, cPos, cgPos, pgPos, statusesWithTick), [statusesWithTick]);

  const helpers = useMemo(()=>({
    formatDateLabel, TICK_COLOR_BY_STATUS, getItemStatusDisplay: (item)=>{
      const raw=item?.status;
      if (raw==null) return '';
      return typeof raw==='string'?raw:(raw?.name||raw?.value||'');
    },
    isJiraStatusWithTick: (statusStr)=>{
      if (!statusStr || !Array.isArray(statusesWithTick) || !statusesWithTick.length) return false;
      const n=String(statusStr).trim().toLowerCase();
      return statusesWithTick.some(s=>String(s).trim().toLowerCase()===n);
    }
  }), [statusesWithTick]);

  return {
    gaDates,
    ec: timeline?.ec || null,
    ga: timeline?.ga || null,
    timelineStart: timeline?.timelineStart ?? null,
    timelineEnd: timeline?.timelineEnd ?? null,
    timelineDuration: timeline?.timelineDuration ?? null,
    ...scaled,
    getPositionPercent,
    formatDateLabel,
    validSprintDates,
    weeklyMarkers,
    gateMarkers,
    gateDateRows,
    commitItemsSorted,
    getTickStyleForStatus: getTickStyle,
    helpers,
    hasValidTimeline: !!timeline,
  };
}

export default useGanttData;
