/**
 * downloadUtils.js
 *
 * Client-side download helpers for Release Versions:
 *   - downloadGantt(ganttRef, version)         → PNG via html2canvas
 *   - downloadExcel(items, opts)               → .xlsx via SheetJS
 *   - downloadHTML(items, opts)                → standalone .html report
 *   - downloadPDF(pageRef, opts)               → .pdf via jsPDF + html2canvas
 *   - downloadBoth(ganttRef, items, opts)      → Gantt PNG + Excel
 */

import { formatters } from '../shared/utils/formatters';

import html2canvas from 'html2canvas';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';

// ─── helpers ─────────────────────────────────────────────────────────────────

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function fmtDate(raw) {
  if (!raw) return '';
  let d;
  if (raw instanceof Date) {
    d = raw;
  } else if (typeof raw === 'object') {
    const str = raw.value || raw.date || raw.name || '';
    if (!str) return '';
    d = new Date(str);
  } else {
    d = new Date(raw);
  }
  if (!d || isNaN(d.getTime())) return '';
  const day = String(d.getDate()).padStart(2, '0');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${day}/${months[d.getMonth()]}/${d.getFullYear()}`;
}

function extractText(val) {
  if (val == null) return '';
  if (typeof val === 'string') return val.trim();
  if (typeof val === 'object') return (val.displayName || val.name || val.value || val.emailAddress || '').trim();
  return String(val);
}

function extractRisk(item) {
  const r = item.customfield_23560;
  if (!r) return 'Not Set';
  if (typeof r === 'string') return r.trim() || 'Not Set';
  return (r.value || r.name || 'Not Set').trim();
}

/** Flatten a JIRA item into a plain object suitable for both Excel and HTML */
function flattenItem(item, checkpointHistory, section) {
  const key = item.key || '';
  const history = (checkpointHistory || {})[key] || {};

  const historyStr = (fieldKey) => {
    const entries = history[fieldKey] || [];
    if (!entries.length) return '';
    const dates = [...new Set(entries.map(e => fmtDate(e.date)).filter(Boolean))];
    return dates.join(' → ');
  };

  const contact = (field) => {
    const v = typeof field === 'string' ? field : (field?.displayName || field?.name || field?.emailAddress || '');
    return v.trim();
  };

  return {
    Section: section,
    Key: key,
    Summary: extractText(item.summary),
    Status: extractText(item.status),
    Priority: extractText(item.priority),
    'Fix Version': Array.isArray(item.fixVersions)
      ? item.fixVersions.map(v => extractText(v)).join(', ')
      : (item.fixVersions ? String(item.fixVersions) : ''),
    'Risk Indicator': extractRisk(item),
    Assignee: contact(item.assignee),
    'QA Contact': contact(item.customfield_10860),
    'PM Owner': contact(item.customfield_11260),
    'Program Mgr': contact(item.customfield_27764),
    'FS/DS Done Date': fmtDate(item.customfield_13861),
    'FS/DS History': historyStr('fsdsDone'),
    'Test Plan Date': fmtDate(item.customfield_11068),
    'Test Plan History': historyStr('testPlan'),
    'Code Complete Date': fmtDate(item.customfield_11067),
    'Code Complete History': historyStr('codeComplete'),
    'Commit Gate Date': fmtDate(item.customfield_35863),
    'Commit Gate History': historyStr('commitGate'),
    'Promotion Gate Date': fmtDate(item.customfield_35864),
    'Promotion Gate History': historyStr('promotionGate'),
    'Status Update': extractText(item.customfield_23073),
    'Status Update Date': fmtDate(item.customfield_45660),
  };
}

// ─── Gantt PNG ───────────────────────────────────────────────────────────────

export async function downloadGantt(ganttRef, version) {
  if (!ganttRef?.current) throw new Error('Gantt chart not rendered yet.');
  const canvas = await html2canvas(ganttRef.current, {
    backgroundColor: '#f0f0f0',
    scale: 2,
    logging: false,
    useCORS: true,
    allowTaint: false,
  });
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error('Canvas export failed.'));
      triggerDownload(blob, `Gantt-${version || 'Release'}-${todayStr()}.png`);
      resolve();
    }, 'image/png');
  });
}

// ─── Excel ───────────────────────────────────────────────────────────────────

const RISK_BG = { Red: 'FFDE350B', Yellow: 'FFFFC400', Green: 'FF00875A', 'Not Set': 'FFB2B8C2' };
const RISK_FG = { Red: 'FFFFFFFF', Yellow: 'FF172B4D', Green: 'FFFFFFFF', 'Not Set': 'FF172B4D' };

function riskStyle(riskVal) {
  const key = Object.keys(RISK_BG).find(k => riskVal.toLowerCase().includes(k.toLowerCase())) || 'Not Set';
  return {
    fill: { patternType: 'solid', fgColor: { rgb: RISK_BG[key] } },
    font: { color: { rgb: RISK_FG[key] }, bold: true },
    alignment: { horizontal: 'center' }
  };
}

function headerStyle() {
  return {
    fill: { patternType: 'solid', fgColor: { rgb: 'FF172B4D' } },
    font: { color: { rgb: 'FFFFFFFF' }, bold: true },
    alignment: { horizontal: 'center', wrapText: true }
  };
}

function buildSheet(rows, checkpointHistory, section) {
  const flat = rows.map(item => flattenItem(item, checkpointHistory, section));
  if (!flat.length) return XLSX.utils.aoa_to_sheet([['No items']]);

  const headers = Object.keys(flat[0]);
  const aoa = [headers, ...flat.map(r => headers.map(h => r[h]))];
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Style header row
  headers.forEach((h, ci) => {
    const addr = XLSX.utils.encode_cell({ r: 0, c: ci });
    if (ws[addr]) ws[addr].s = headerStyle();
  });

  // Style Risk Indicator column
  const riskCol = headers.indexOf('Risk Indicator');
  if (riskCol >= 0) {
    flat.forEach((row, ri) => {
      const addr = XLSX.utils.encode_cell({ r: ri + 1, c: riskCol });
      if (ws[addr]) ws[addr].s = riskStyle(row['Risk Indicator'] || '');
    });
  }

  // Column widths
  ws['!cols'] = headers.map(h => {
    if (h === 'Summary' || h === 'Status Update') return { wch: 40 };
    if (h.includes('History')) return { wch: 30 };
    if (h.includes('Date')) return { wch: 16 };
    if (h === 'Key') return { wch: 12 };
    return { wch: 20 };
  });

  // Freeze top row
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };

  return ws;
}

export function downloadExcel({ filteredItems, checkpointHistory, version }) {
  const wb = XLSX.utils.book_new();

  // Summary sheet
  const summaryData = [
    ['Release Version Report'],
    ['Version:', version || ''],
    ['Generated:', new Date().toLocaleString()],
    ['Commit items:', (filteredItems.commit || []).length],
    ['Long-term-funded items:', (filteredItems.longTermFunded || []).length],
    ['Total items:', (filteredItems.commit?.length || 0) + (filteredItems.longTermFunded?.length || 0)],
  ];
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
  summarySheet['!cols'] = [{ wch: 28 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary');

  if ((filteredItems.commit || []).length > 0) {
    XLSX.utils.book_append_sheet(wb, buildSheet(filteredItems.commit, checkpointHistory, 'Commit'), 'Commit');
  }
  if ((filteredItems.longTermFunded || []).length > 0) {
    XLSX.utils.book_append_sheet(wb, buildSheet(filteredItems.longTermFunded, checkpointHistory, 'Long-term-funded'), 'Long-term-funded');
  }

  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true });
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  triggerDownload(blob, `Release-Report-${version || 'Release'}-${todayStr()}.xlsx`);
}

// ─── HTML report ─────────────────────────────────────────────────────────────

function escH(t) {
  return String(t || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function riskBadge(risk) {
  const key = Object.keys(RISK_BG).find(k => risk.toLowerCase().includes(k.toLowerCase())) || 'Not Set';
  const bg = { Red: '#DE350B', Yellow: '#FFC400', Green: '#00875A', 'Not Set': '#B2B8C2' };
  const fg = { Red: '#fff', Yellow: '#172B4D', Green: '#fff', 'Not Set': '#172B4D' };
  return `<span style="background:${bg[key]};color:${fg[key]};padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;">${escH(risk)}</span>`;
}

function buildHTMLSection(rows, checkpointHistory, sectionTitle, jiraBaseUrl) {
  if (!rows || rows.length === 0) return '';
  const flat = rows.map(r => flattenItem(r, checkpointHistory, sectionTitle));
  const headers = Object.keys(flat[0]).filter(h => h !== 'Section');

  const thead = `<tr>${headers.map(h => `<th>${escH(h)}</th>`).join('')}</tr>`;
  const tbody = flat.map((row, i) => {
    const bg = i % 2 === 0 ? '#fff' : '#f8f9fa';
    const cells = headers.map(h => {
      let val = row[h];
      if (h === 'Key') {
        return `<td><a href="${escH(jiraBaseUrl)}/browse/${escH(val)}" target="_blank" style="color:#0052cc;font-weight:600;">${escH(val)}</a></td>`;
      }
      if (h === 'Risk Indicator') {
        return `<td style="text-align:center;">${riskBadge(val || 'Not Set')}</td>`;
      }
      if (h === 'Status Update') {
        return `<td style="font-size:11px;max-width:280px;word-break:break-word;">${escH(val)}</td>`;
      }
      return `<td>${escH(val)}</td>`;
    }).join('');
    return `<tr style="background:${bg};">${cells}</tr>`;
  }).join('');

  return `
    <h2 style="margin:2rem 0 0.5rem;color:#172B4D;">${escH(sectionTitle)} (${rows.length})</h2>
    <div style="overflow-x:auto;">
      <table>
        <thead>${thead}</thead>
        <tbody>${tbody}</tbody>
      </table>
    </div>`;
}

export function downloadHTML({ filteredItems, checkpointHistory, version, jiraBaseUrl = 'https://jira.nutanix.com' }) {
  const commitSection = buildHTMLSection(filteredItems.commit || [], checkpointHistory, 'Section 1: Commit', jiraBaseUrl);
  const ltfSection = buildHTMLSection(filteredItems.longTermFunded || [], checkpointHistory, 'Section 2: Long-term-funded', jiraBaseUrl);
  const total = (filteredItems.commit?.length || 0) + (filteredItems.longTermFunded?.length || 0);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Release Report — ${escH(version || '')}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 12px; color: #172B4D; margin: 0; padding: 1.5rem; background: #fff; }
  h1 { font-size: 1.4rem; margin: 0 0 0.25rem; }
  .meta { color: #6c757d; font-size: 11px; margin-bottom: 1.5rem; }
  table { border-collapse: collapse; width: 100%; min-width: 800px; margin-bottom: 2rem; font-size: 11px; }
  th { background: #172B4D; color: #fff; padding: 8px 10px; text-align: left; white-space: nowrap; position: sticky; top: 0; }
  td { padding: 6px 10px; border-bottom: 1px solid #dee2e6; vertical-align: top; }
  a { color: #0052cc; }
  .summary-box { display: flex; gap: 2rem; flex-wrap: wrap; background: #f0f4f8; border: 1px solid #d0dce8; border-radius: 6px; padding: 1rem 1.5rem; margin-bottom: 1.5rem; }
  .summary-item { text-align: center; }
  .summary-item .num { font-size: 1.8rem; font-weight: 700; color: #172B4D; }
  .summary-item .label { font-size: 11px; color: #6c757d; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
<h1>Release Report — ${escH(version || 'All Versions')}</h1>
<div class="meta">Generated ${new Date().toLocaleString()}</div>

<div class="summary-box">
  <div class="summary-item"><div class="num">${total}</div><div class="label">Total items</div></div>
  <div class="summary-item"><div class="num">${filteredItems.commit?.length || 0}</div><div class="label">Commit</div></div>
  <div class="summary-item"><div class="num">${filteredItems.longTermFunded?.length || 0}</div><div class="label">Long-term-funded</div></div>
</div>

${commitSection}
${ltfSection}
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  triggerDownload(blob, `Release-Report-${version || 'Release'}-${todayStr()}.html`);
}

// ─── PDF ─────────────────────────────────────────────────────────────────────

/**
 * Capture the visible page content as a multi-page PDF.
 * Uses html2canvas to render the DOM element to a canvas, then slices
 * it into A4 landscape pages inside jsPDF.
 *
 * @param {React.RefObject} contentRef - ref pointing to the content wrapper element
 * @param {string} version - selected release version (used in filename + header)
 */
export async function downloadPDF(contentRef, version) {
  const el = contentRef?.current;
  if (!el) throw new Error('Content element not available for PDF export.');

  // Render the element to a high-res canvas
  const canvas = await html2canvas(el, {
    backgroundColor: '#ffffff',
    scale: 1.5,         // balance quality vs file size
    logging: false,
    useCORS: true,
    allowTaint: false,
    scrollX: 0,
    scrollY: -window.scrollY,  // capture from top
    windowWidth: el.scrollWidth,
    windowHeight: el.scrollHeight,
  });

  const imgData = canvas.toDataURL('image/jpeg', 0.88);
  const imgW = canvas.width;
  const imgH = canvas.height;

  // A4 landscape in mm
  const pageW = 297;
  const pageH = 210;
  const margin = 8; // mm
  const usableW = pageW - margin * 2;
  const usableH = pageH - margin * 2 - 10; // leave 10mm for header

  // Scale image to fit page width
  const scale = usableW / imgW;
  const scaledH = imgH * scale; // total height in mm when scaled to usableW

  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  const headerText = `Release Versions — ${version || ''} · ${formatters.date(new Date()) || new Date().toISOString().slice(0, 10)}`;
  const totalPages = Math.ceil(scaledH / usableH);

  for (let page = 0; page < totalPages; page++) {
    if (page > 0) pdf.addPage();

    // Header on each page
    pdf.setFontSize(9);
    pdf.setTextColor(80, 80, 80);
    pdf.text(headerText, margin, margin + 4);
    pdf.setTextColor(160, 160, 160);
    pdf.text(`Page ${page + 1} of ${totalPages}`, pageW - margin, margin + 4, { align: 'right' });

    // Thin rule under header
    pdf.setDrawColor(200, 200, 200);
    pdf.setLineWidth(0.2);
    pdf.line(margin, margin + 6, pageW - margin, margin + 6);

    // Slice of the source image for this page
    // sourceY in canvas pixels
    const sourceY = (page * usableH) / scale;
    const sourceH = Math.min(usableH / scale, imgH - sourceY);
    if (sourceH <= 0) break;

    // Crop via an offscreen canvas
    const slice = document.createElement('canvas');
    slice.width = imgW;
    slice.height = Math.ceil(sourceH);
    const ctx = slice.getContext('2d');
    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = imgW;
    srcCanvas.height = imgH;
    const srcCtx = srcCanvas.getContext('2d');
    const img = new Image();
    await new Promise(res => { img.onload = res; img.src = imgData; });
    srcCtx.drawImage(img, 0, 0);
    ctx.drawImage(srcCanvas, 0, sourceY, imgW, Math.ceil(sourceH), 0, 0, imgW, Math.ceil(sourceH));

    const sliceData = slice.toDataURL('image/jpeg', 0.88);
    const sliceH = Math.min(usableH, (imgH - sourceY) * scale);
    pdf.addImage(sliceData, 'JPEG', margin, margin + 8, usableW, sliceH);
  }

  pdf.save(`Release-Report-${version || 'Release'}-${todayStr()}.pdf`);
}

// ─── Both ────────────────────────────────────────────────────────────────────

export async function downloadBoth({ ganttRef, filteredItems, checkpointHistory, version, jiraBaseUrl: _jiraBaseUrl }) {
  await downloadGantt(ganttRef, version);
  // Small delay so browser handles first download before triggering second
  await new Promise(r => setTimeout(r, 400));
  downloadExcel({ filteredItems, checkpointHistory, version });
}
