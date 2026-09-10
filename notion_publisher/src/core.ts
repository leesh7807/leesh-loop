import { createHash } from "node:crypto";
import { URL } from "node:url";

export class PublicationError extends Error {}
export type Policy = { identifier:string; title:string; state:string; priority:string; labels:string; blockedBy:string; description:string; source:string; planHeading:string; workpadHeading:string; defaultState:string; defaultPriority:number|null; defaultLabels:string[]; bootstrapStates:string[] };
export const DEFAULT_POLICY: Policy = {identifier:"Identifier",title:"Title",state:"State",priority:"Priority",labels:"Labels",blockedBy:"Blocked By",description:"Description",source:"Plan Source",planHeading:"Plan",workpadHeading:"Workpad",defaultState:"Ready",defaultPriority:3,defaultLabels:[],bootstrapStates:["Backlog","Ready","In Progress","Blocked","Done"]};
export const NOTION_RICH_TEXT_SAFE_LIMIT=1900;
export const NOTION_TITLE_SAFE_LIMIT=1900;
export const NOTION_APPEND_BATCH_SIZE=50;
export const PUBLISHER_PENDING_STATE="Publisher Pending";
export function notionId(value:string):string { let raw:string; try { const u=new URL(value); const host=u.hostname.toLowerCase().replace(/\.$/,""); const notionHost=host==="notion.so"||host.endsWith(".notion.so")||host==="app.notion.com"||host.endsWith(".notion.site"); if (!["http:","https:"].includes(u.protocol)||!notionHost) throw new Error(); raw=u.pathname.split("/").pop()??""; } catch { throw new PublicationError("invalid database URL: expected an HTTP(S) Notion database URL"); } const match=raw.match(/([\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}|[\da-f]{32})$/i); if(!match) throw new PublicationError("invalid database URL: expected a Notion database URL ending in a 32-character database id"); const compact=match[1].replace(/-/g,""); return `${compact.slice(0,8)}-${compact.slice(8,12)}-${compact.slice(12,16)}-${compact.slice(16,20)}-${compact.slice(20)}`; }
export function resolvePublishDatabase(databaseUrl:string|undefined):{databaseId:string;databaseUrl:string} {
 if(!databaseUrl?.trim()) {
  throw new PublicationError("missing publication database URL");
 }
 return {databaseId:notionId(databaseUrl),databaseUrl};
}
export const deriveIdentifier=(plan:string)=>`PLAN-${createHash("sha256").update(plan,"utf8").digest("hex").slice(0,12).toUpperCase()}`;
export function chunkText(text:string,limit=NOTION_RICH_TEXT_SAFE_LIMIT):string[] { if(limit<2) throw new PublicationError("rich-text chunk limit must be at least 2 UTF-16 code units"); const chunks:string[]=[];let chunk="";for(const point of text){if(chunk&&chunk.length+point.length>limit){chunks.push(chunk);chunk="";}chunk+=point;}if(chunk||!chunks.length)chunks.push(chunk);return chunks; }
export function extractPlanTitle(plan:string,fallbackTitle?:string):string { const heading=plan.split(/\r?\n/).find((line)=>line.startsWith("# "))?.slice(2).trim(); if(heading)return heading; if(fallbackTitle?.trim())return fallbackTitle.trim(); throw new PublicationError("Plan title requires a Markdown H1 or caller-supplied fallback title"); }
export function validatePlanTitle(title:string):void { if(title.length>NOTION_TITLE_SAFE_LIMIT) throw new PublicationError(`plan title exceeds the ${NOTION_TITLE_SAFE_LIMIT}-character Notion title limit`); }
const text=(content:string)=>({type:"text",text:{content}});
export function buildTaskProperties(p:Policy,id:string,title:string,source?:string,state=p.defaultState):Record<string,unknown>{return {[p.identifier]:{rich_text:[text(id)]},[p.title]:{title:[text(title)]},[p.state]:{select:{name:state}},[p.priority]:{number:p.defaultPriority},[p.labels]:{multi_select:p.defaultLabels.map(name=>({name}))},[p.description]:{rich_text:[text("Completed plan artifact; see Plan section.")]},[p.source]:{url:source??null}};}
export function buildPageBlocks(p:Policy,plan:string):Record<string,unknown>[] { return [{object:"block",type:"heading_1",heading_1:{rich_text:[text(p.planHeading)]}},...chunkText(plan).map(part=>({object:"block",type:"paragraph",paragraph:{rich_text:[text(part)]}})),{object:"block",type:"heading_1",heading_1:{rich_text:[text(p.workpadHeading)]}}]; }
