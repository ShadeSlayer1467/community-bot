import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, EmbedBuilder } from 'discord.js';
import { formatResistance } from './model.js';
const row=(...items)=>new ActionRowBuilder().addComponents(items);
const cid=(s,action,extra='')=>`wo:${s.id}:${s.revision}:${action}${extra?':'+extra:''}`;
const safe=(v,max=1000)=>String(v).replace(/@/g,'＠').slice(0,max);
const button=(s,label,action,extra='')=>new ButtonBuilder().setLabel(label).setCustomId(cid(s,action,extra)).setStyle(action==='log'?ButtonStyle.Primary:ButtonStyle.Secondary);
export const recordedSets=e=>e.sets.map(set=>`${set.order}. ${formatResistance(set.resistance)} × ${set.reps}${set.type==='normal'?'':' ('+set.type+')'}${set.questionable?' ⚠':''}`).join('\n')||'No sets yet.';
const boilerplate=/^(Starter library exercise\b|Configure resistance and program prescriptions\b|Machine settings belong\b|Neutral placeholders\b|Set the actual prescription\b|Alternate three days\/week\b|Week [12]:|Keep roughly 2–3 good reps\b|Use controlled repetitions, not ugly reps\b|Rest (roughly )?\d+|Rep ranges are progression ranges\b|When the top becomes consistently easy\b|Recommendations are optional\b|Recent performance:|Start with (normal )?\b|Progress difficulty manually\b|Progress manually\b)/i;
const safetyInstruction=/\b(secure|safe|safety|unsafe|unstable|requires|never|do not|avoid|warning|caution)\b/i;
export function exerciseInstructions(e) {
  if(!e) return '';
  const sentences=[e.notes,e.planned?.note,e.note].filter(Boolean).flatMap(note=>note.match(/[^.!?\n]+[.!?]?/g)||[]).map(s=>s.trim()).filter(s=>s&&(!boilerplate.test(s)||safetyInstruction.test(s)));
  // Only short instructions stay primary. Safety instructions stay complete even when long.
  return [...new Set(sentences.filter(s=>s.length<=180||safetyInstruction.test(s)))].join('\n');
}
function fieldsFor(name,value) {
  const fields=[];for(let i=0;i<value.length;i+=1000) fields.push({name:safe(name+(i?' (continued)':''),256),value:safe(value.slice(i,i+1000))});return fields;
}
export function moreActions(s) {
  const e=s.exercises[s.currentIndex], actions=[];
  if(e) actions.push(['weight','Change Weight']);
  if(e?.sets.length) actions.push(['edit','Edit Last Set'],['earlier','Edit Earlier Set'],['delete','Delete Set']);
  actions.push(['add','Add Exercise']);
  if(e) actions.push(['skip','Skip Exercise'],['note','Notes / Uncertainty'],['details','Log Details'],['view-details','Exercise Details']);
  actions.push(['finish','Finish Workout'],['abandon','Abandon Workout']);return actions;
}
function shortStatus(e,r) {
  if(!r) return '';
  if(r.outcome==='MAINTAIN') return `MAINTAIN — ${e.planned?'Build toward '+e.planned.sets+' × '+e.planned.maxReps:'Recorded'}`;
  if(r.outcome==='PROGRESS') return 'PROGRESS — '+(r.proposed?.exerciseId!==e.exerciseId&&r.proposed?'Next variation available':r.proposed?'Next resistance available':'Review next difficulty');
  if(r.outcome==='QUESTIONABLE') return 'QUESTIONABLE — Review recorded data';
  return 'REVIEW — '+(/differs|mixed/i.test(r.reason)?'Mixed resistance':/below/i.test(r.reason)?'Below target range':'Review performance');
}
function summaryFields(s) {
  const fields=[];
  for(const e of s.exercises) {
    const r=s.recommendations.find(r=>r.id===e.id);
    const text=recordedSets(e)+(r?'\n'+shortStatus(e,r):'');
    for(const field of fieldsFor(e.name,text)) fields.push({...field,entryId:e.id});
  }
  return fields;
}
export function sessionMessage(s,{page=0}={}) {
  const components=[],embed=new EmbedBuilder().setColor(0x81e2ba).setTitle(safe(s.name,200));
  if(s.state==='active') {
    const e=s.exercises[s.currentIndex];
    embed.setDescription(`Exercise ${e?s.currentIndex+1:0}/${s.exercises.length} · ${s.mode==='free'?'Free workout':'Planned workout'}`);
    if(e) {
      embed.addFields({name:safe(e.name,200),value:safe(`${e.variation?e.variation+'\n':''}${e.planned?`Target: ${e.planned.sets} × ${e.planned.minReps}–${e.planned.maxReps}`:'Unplanned exercise'}\nResistance: ${formatResistance(e.workingResistance)}${e.skipped?' · Skipped':''}${e.questionable?' · ⚠ questionable':''}`)},
        {name:'Previous',value:safe(e.previous?`${e.previous.date.slice(0,10)}${e.previous.questionable?' ⚠':''}\n${e.previous.exercises.map(recordedSets).join('\n')}`:'No completed performance yet.')},
        {name:'Today',value:safe(recordedSets(e))});
      const instruction=exerciseInstructions(e);if(instruction) embed.addFields(fieldsFor('Instruction',instruction));
    } else embed.setDescription('Free workout · Add an exercise to start logging.');
    embed.setFooter({text:'More Actions → Exercise Details for full notes and sets.'});
    const primary=[];
    if(e) primary.push(button(s,'Log Set','log'));
    if(e?.sets.length) primary.push(button(s,'Repeat Last','repeat'));
    if(s.currentIndex>0) primary.push(button(s,'Previous Exercise','prev'));
    if(s.currentIndex<s.exercises.length-1) primary.push(button(s,'Next Exercise','next'));
    if(s.mode==='free') primary.push(button(s,'Add Exercise','add'));
    if(primary.length) components.push(row(...primary));
    components.push(row(new StringSelectMenuBuilder().setCustomId(cid(s,'more')).setPlaceholder('More Actions').addOptions(moreActions(s).map(([value,label])=>({value,label})))));
  } else {
    const all=summaryFields(s),total=Math.max(1,Math.ceil(all.length/4));page=Math.max(0,Math.min(page,total-1));
    const visible=all.slice(page*4,(page+1)*4);
    embed.setTitle(s.state==='completed'?'WORKOUT COMPLETE':'WORKOUT ABANDONED').setDescription(`${safe(s.name,100)} · ${Math.max(0,Math.round((Date.parse(s.finishedAt||s.startedAt)-Date.parse(s.startedAt))/60000))} minutes`)
      .setFooter({text:`Page ${page+1}/${total} · ${s.exercises.length} exercises · Review progression for full reasons`});
    if(visible.length) embed.addFields(visible.map(({entryId,...field})=>field));
    else embed.addFields({name:'Workout',value:'No exercises recorded.'});
    if(total>1) {const nav=[];if(page>0)nav.push(button(s,'Previous exercises','summary-page',String(page-1)));if(page+1<total)nav.push(button(s,'Next exercises','summary-page',String(page+1)));components.push(row(...nav));}
    const pending=s.recommendations.filter(r=>visible.some(f=>f.entryId===r.id)&&!s.decisions.some(d=>d.entryId===r.id&&d.valid!==false));
    if(s.state==='completed'&&pending.length)components.push(row(new StringSelectMenuBuilder().setCustomId(cid(s,'recommend')).setPlaceholder('Review progression details').addOptions(pending.map(r=>({label:safe(s.exercises.find(e=>e.id===r.id)?.name,100),description:safe(shortStatus(s.exercises.find(e=>e.id===r.id),r),100),value:r.id})))));
  }
  return {content:'',embeds:[embed],components,allowedMentions:{parse:[]}};
}
export function sessionDetails(s,page=0) {
  const e=s.exercises[s.currentIndex], fields=[];
  for(const [label,text] of [['Exercise library notes',e?.notes],['Prescription notes / program guidance',e?.planned?.note],['Your exercise notes',e?.note],['Your workout notes',s.note],['Previous performance',e?.previous?e.previous.date+'\n'+e.previous.exercises.map(recordedSets).join('\n'):''],['Today’s full sets',e?recordedSets(e):'']])
    if(text)fields.push(...fieldsFor(label,text));
  const total=Math.max(1,Math.ceil(fields.length/4));page=Math.max(0,Math.min(page,total-1));
  const embed=new EmbedBuilder().setColor(0x81e2ba).setTitle(safe((e?.name||s.name)+' — Details',200)).setFooter({text:`Page ${page+1}/${total} · Stored notes are unchanged`});
  if(fields.length)embed.addFields(fields.slice(page*4,(page+1)*4));else embed.setDescription('No additional notes.');
  const nav=[button(s,'Back to Logger','keep-training')];if(page>0)nav.push(button(s,'Previous details','view-details',String(page-1)));if(page+1<total)nav.push(button(s,'More details','view-details',String(page+1)));
  return {content:'',embeds:[embed],components:[row(...nav)],allowedMentions:{parse:[]}};
}
