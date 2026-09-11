import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { DEFAULT_POLICY, type Policy, PublicationError } from "./core.js";

const keys = new Set(["state","priority","labels","property_names"]);
const propKeys = new Set(["identifier","title","state","priority","labels","blocked_by"]);
export const resolvePath = (value:string, base:string=process.cwd()) => isAbsolute(value) ? resolve(value) : resolve(base, value);

export async function loadConfig(file:string, base?:string, policy=DEFAULT_POLICY):Promise<{config:{};policy:Policy}> {
 const path=resolvePath(file,base); let raw:unknown; try { raw=JSON.parse(await readFile(path,"utf8")); } catch { throw new PublicationError(`missing or invalid configuration: ${path}`); }
 if(!raw || typeof raw!=="object" || Array.isArray(raw)) throw new PublicationError("configuration must be an object"); const r=raw as Record<string,unknown>;
 const unknown=Object.keys(r).filter(k=>!keys.has(k)); if(unknown.length) throw new PublicationError(`unknown configuration key(s): ${unknown.join(", ")}`);
 if("state" in r && (typeof r.state!=="string" || !r.state.trim())) throw new PublicationError("state must be a non-empty string");
 if("priority" in r && r.priority!==null && (typeof r.priority!=="number" || !Number.isInteger(r.priority) || ![1,2,3,4,5].includes(r.priority))) throw new PublicationError("priority must be null or an integer from 1 to 5");
 if("labels" in r && (!Array.isArray(r.labels) || !r.labels.every(x=>typeof x==="string"))) throw new PublicationError("labels must be a list of strings");
 const overrides=r.property_names??{}; if(!overrides || typeof overrides!=="object" || Array.isArray(overrides) || Object.keys(overrides as object).some(k=>!propKeys.has(k)||typeof (overrides as Record<string,unknown>)[k]!=="string" || !(overrides as Record<string,string>)[k].trim())) throw new PublicationError("property_names must map supported names to non-empty strings");
 const o=overrides as Record<string,string>; const p={...policy,defaultState:("state" in r?r.state:policy.defaultState) as string,defaultPriority:("priority" in r?r.priority:policy.defaultPriority) as number|null,defaultLabels:[...new Set(((r.labels as string[]|undefined)??policy.defaultLabels).map(x=>x.trim()).filter(Boolean))],identifier:o.identifier??policy.identifier,title:o.title??policy.title,state:o.state??policy.state,priority:o.priority??policy.priority,labels:o.labels??policy.labels,blockedBy:o.blocked_by??policy.blockedBy};
 const names=[p.identifier,p.title,p.state,p.priority,p.labels,p.blockedBy].map(x=>x.trim()); if(names.some(x=>!x)) throw new PublicationError("property names must be non-empty"); if(new Set(names).size!==names.length) throw new PublicationError("property_names must resolve to unique property names");
 return {config:{},policy:p};
}
