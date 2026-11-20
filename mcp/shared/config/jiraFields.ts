import cfg from './jiraFieldsConfig.json' with { type: 'json' };
const idToKey = new Map<string,string>();
const keyToId = new Map<string,string>();
for (const cat of Object.values((cfg as any).fields)) {
  for (const [k, v] of Object.entries(cat as any)) {
    idToKey.set((v as any).id, k);
    keyToId.set(k, (v as any).id);
  }
}
export function getFieldId(key: string): string | null { return keyToId.get(key) ?? null; }
export function getFieldValue(fields: Record<string,any> | null | undefined, key: string): any {
  if (!fields) return null;
  const f = (fields as any).fields ?? fields;
  const id = getFieldId(key);
  if (!id) return null;
  if (id in f) return f[id] ?? null;
  if (key in f) return f[key] ?? null;
  return null;
}
export function getAllFieldIds(keys: string[]): string { return keys.map(k=>getFieldId(k)).filter(Boolean).join(','); }
