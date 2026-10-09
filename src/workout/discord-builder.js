import { randomBytes } from 'node:crypto';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder } from 'discord.js';
import { filterExercises } from './starter.js';
import { parseResistance, formatResistance, prescription } from './model.js';
const row=(...items)=>new ActionRowBuilder().addComponents(items);
const safe=(value,max=100)=>String(value).replace(/@/g,'＠').slice(0,max);
export function createWorkoutBuilder(workout, preview, back) {
  const drafts=new Map();
  const id=(d,action,extra='')=>`wo:build:${d.token}:${d.revision}:${action}${extra?':'+extra:''}`;
  const button=(d,label,action,disabled=false)=>new ButtonBuilder().setLabel(label).setCustomId(id(d,action)).setStyle(ButtonStyle.Secondary).setDisabled(disabled);
  const menu=(d,action,placeholder,options)=>row(new StringSelectMenuBuilder().setCustomId(id(d,action)).setPlaceholder(placeholder).addOptions(options));
  const modal=(d,action,title,fields,extra='')=>{
    const m=new ModalBuilder().setTitle(title).setCustomId(id(d,action,extra));
    for(const [key,label,value='',required=true] of fields) {
      const input=new TextInputBuilder().setCustomId(key).setLabel(label).setStyle(TextInputStyle.Short).setRequired(required).setMaxLength(key==='note'?500:100);
      if(value) input.setValue(String(value)); m.addComponents(row(input));
    }
    return m;
  };
  async function render(i,d) {
    if(d.name) d.page=Math.max(0,Math.min(d.page,Math.max(0,Math.ceil(d.exercises.length/25)-1)));
    const embed=new EmbedBuilder().setTitle(safe(d.name||'Create saved workout',200)).setDescription(d.name?
      safe((d.programName||'New program')+' · Draft only. Add exercises in the order you want. Select an entry to reorder/edit.',1000):'Choose a program, or create a named program. Nothing is saved until Save Workout.').setColor(0x81e2ba);
    const components=[];
    if(!d.name) {
      const programs=workout.catalog(d.userId).programs.filter(p=>p.active && p.templates.length<30);
      d.programChoices=programs.slice(d.page*25,(d.page+1)*25).map(p=>({id:p.id,revision:p.revision}));
      if(d.programChoices.length) components.push(menu(d,'program','Choose an existing program',programs.slice(d.page*25,(d.page+1)*25).map(p=>({label:safe(p.name),value:p.id}))));
      components.push(row(button(d,'New program','new-program'),button(d,'Previous programs','program-back',d.page===0),button(d,'More programs','program-next',(d.page+1)*25>=programs.length),button(d,'Back to workouts','back')));
    } else {
      const lines=d.exercises.map((e,index)=>`${index+1}. ${safe(e.name,60)} · ${e.sets} × ${e.minReps}–${e.maxReps} · ${formatResistance(e.resistance)}`);
      // Large drafts remain fully editable through paginated entry menus.
      embed.setDescription(safe((d.programName||'New program')+' · Draft only · '+d.exercises.length+' exercises.\n'+lines.slice(d.page*25,d.page*25+10).join('\n'),3500));
      const entries=d.exercises.slice(d.page*25,(d.page+1)*25);
      if(entries.length) components.push(menu(d,'entry','Choose an entry to reorder or edit',entries.map((e,index)=>({label:safe(`${d.page*25+index+1}. ${e.name}`),value:String(d.page*25+index)}))));
      components.push(row(button(d,'Add Exercise','add',d.exercises.length>=50),button(d,'Save Workout','save',!d.exercises.length),button(d,'Back to workouts','back')));
      if(d.exercises.length>25) components.push(row(button(d,'Previous entries','entry-back',d.page===0),button(d,'More entries','entry-next',(d.page+1)*25>=d.exercises.length)));
      if(d.selected!=null) components.push(row(button(d,'Move Up','up',d.selected===0),button(d,'Move Down','down',d.selected>=d.exercises.length-1),button(d,'Edit Prescription','edit'),button(d,'Remove from Draft','remove')));
    }
    return i.update({content:'',embeds:[embed],components,allowedMentions:{parse:[]}});
  }
  function prescribe(i,d,e,edit=false) {
    return i.showModal(modal(d,edit?'edit-submit':'prescribe','Exercise prescription',[
      ['sets','Target sets',edit?e.sets:'3'],['min','Minimum reps',edit?e.minReps:'6'],['max','Maximum reps',edit?e.maxReps:'10'],
      ['resistance','Resistance (optional; BW, 135 lb, stack:30)',edit?(e.resistance.kind==='bodyweight'?'BW':e.resistance.kind==='none'?'none':e.resistance.kind==='custom'?'custom:'+e.resistance.display:e.resistance.kind+':'+e.resistance.value+' '+e.resistance.unit):'',false],
      ['note','Prescription note (optional)',edit?e.note:'',false]
    ],edit ? String(d.selected) : e.id));
  }
  return {
    async open(i) {
      for(const [key,d] of drafts) if(d.until<Date.now()) drafts.delete(key);
      if(drafts.size>=200) drafts.delete(drafts.keys().next().value);
      const token=randomBytes(10).toString('hex');
      const d={token,userId:i.user.id,channelId:i.channelId,until:Date.now()+1800000,revision:0,exercises:[],page:0}; drafts.set(token,d);
      return render(i,d);
    },
    async handle(i) {
      const [,,token,revision,action,extra]=i.customId.split(':');
      const d=drafts.get(token);
      if(!d||d.until<Date.now()) throw new Error('Workout draft expired. Open Create Saved Workout again.');
      if(d.userId!==i.user.id||d.channelId!==i.channelId) throw new Error('This workout draft belongs to another user or channel.');
      if(d.saved&&action==='save') return preview(i,workout.selection(d.userId,{programId:d.saved.program.id,templateId:d.saved.template.id}),true);
      if(d.saved||d.revision!==Number(revision)) throw new Error('Workout draft changed. Use its latest controls.');
      const get=key=>i.fields.getTextInputValue(key).trim();
      if(action==='back') {drafts.delete(token);return back(i,true);}
      if(action==='new-program') return i.showModal(modal(d,'name-new','Name your saved workout',[['program','Program name'],['workout','Workout name']]));
      if(action==='program') {
        const selected=d.programChoices.find(p=>p.id===i.values[0]);if(!selected) throw new Error('Choose a listed program.');
        const p=workout.owned('programs',selected.id,d.userId);if(p.revision!==selected.revision) throw new Error('Program changed. Open a new draft.');
        return i.showModal(modal(d,'name-existing','Name your saved workout',[['workout','Workout name']],p.id));
      }
      if(action==='name-new'||action==='name-existing') {
        d.page=0;d.name=get('workout');if(!d.name) throw new Error('Enter a workout name.');
        if(action==='name-existing') {
          const chosen=d.programChoices.find(p=>p.id===extra); if(!chosen) throw new Error('Choose a program again.');
          const p=workout.owned('programs',extra,d.userId);if(p.revision!==chosen.revision) throw new Error('Program changed. Open a new draft.');
          d.programId=p.id;d.programRevision=p.revision;d.programName=p.name;
        }
        if(action==='name-new') {d.programName=get('program');if(!d.programName) throw new Error('Enter a program name.');d.programId=null;}
      } else if(action==='add') return i.showModal(modal(d,'search','Find an exercise',[['search','Exercise name or alias','',false]]));
      else if(action==='search'||action==='search-next'||action==='search-back') {
        if(action==='search') {d.query=get('search');d.searchPage=0;} else d.searchPage=Math.max(0,d.searchPage+(action==='search-next'?1:-1));
        const choices=filterExercises(workout.catalog(d.userId).exercises,{search:d.query});
        const visible=choices.slice(d.searchPage*25,(d.searchPage+1)*25);d.choices=visible.map(e=>({id:e.id,revision:e.revision}));d.revision++;
        const components=[];if(visible.length) components.push(menu(d,'exercise','Choose an exercise',visible.map(e=>({label:safe(e.name),value:e.id,description:safe(e.variation||e.category||'Library')}))));
        components.push(row(button(d,'Search again','add'),button(d,'Back to draft','draft'),button(d,'Earlier','search-back',d.searchPage===0),button(d,'More','search-next',(d.searchPage+1)*25>=choices.length)));
        return i.update({content:visible.length?`${choices.length} matches. Choose an exercise.`:'No matching active exercises. Search again.',embeds:[],components,allowedMentions:{parse:[]}});
      } else if(action==='exercise') {
        const choice=d.choices?.find(e=>e.id===i.values[0]);if(!choice) throw new Error('Choose a listed exercise.');
        const e=workout.owned('exercises',choice.id,d.userId);if(!e.active||e.revision!==choice.revision) throw new Error('Exercise changed. Search again.');
        return prescribe(i,d,e);
      } else if(action==='prescribe'||action==='edit-submit') {
        const source=action==='prescribe'?d.choices?.find(e=>e.id===extra):d.exercises[Number(extra)];
        if(!source) throw new Error('Select an exercise again.');
        const e=workout.owned('exercises',source.id||source.exerciseId,d.userId);
        if(!e.active||e.revision!==source.revision) throw new Error('Exercise changed. Open a new draft.');
        const value=prescription({sets:Number(get('sets')),minReps:Number(get('min')),maxReps:Number(get('max')),
          resistance:get('resistance')?parseResistance(get('resistance'),e.defaults.resistance.unit):e.defaults.resistance,
          rule:{type:'manual',increment:5,loads:[],chainId:''},note:get('note')});
        const entry={...value,exerciseId:e.id,revision:e.revision,name:e.name};
        if(action==='edit-submit') d.exercises[Number(extra)]=entry;
        else {if(d.exercises.length>=50) throw new Error('At most 50 exercises.');d.exercises.push(entry);d.pending=null;}
      } else if(action==='entry') {
        const index=Number(i.values[0]);if(!Number.isInteger(index)||index<d.page*25||index>=Math.min(d.exercises.length,(d.page+1)*25)) throw new Error('Choose a listed entry.');d.selected=index;
      } else if(action==='edit') return prescribe(i,d,d.exercises[d.selected],true);
      else if(action==='up'||action==='down') {
        const next=d.selected+(action==='up'?-1:1);if(!Number.isInteger(d.selected)||next<0||next>=d.exercises.length) throw new Error('Choose an entry to move.');
        [d.exercises[next],d.exercises[d.selected]]=[d.exercises[d.selected],d.exercises[next]];d.selected=next;d.page=Math.floor(next/25);
      } else if(action==='remove') {if(!Number.isInteger(d.selected)) throw new Error('Choose an entry.');d.exercises.splice(d.selected,1);d.selected=null;}
      else if(action==='save') {
        if(!d.exercises.length) throw new Error('Add an exercise before saving.');
        for(const entry of d.exercises) {const e=workout.owned('exercises',entry.exerciseId,d.userId);if(!e.active||e.revision!==entry.revision) throw new Error('Exercise changed. Open a new draft.');}
        const old=d.programId?workout.owned('programs',d.programId,d.userId):null;
        if(old&&old.revision!==d.programRevision) throw new Error('Program changed. Open a new draft; existing templates were preserved.');
        const template={name:d.name,exercises:d.exercises.map(({revision,name,...entry})=>entry)};
        if(old?.templates.some(t=>t.name.toLowerCase()===d.name.toLowerCase())) throw new Error('That workout name already exists in this program. Choose a different name.');
        if(!old&&workout.catalog(d.userId).programs.some(p=>p.name.toLowerCase()===d.programName.toLowerCase())) throw new Error('That program already exists. Choose it from a new draft.');
        const program=workout.saveRecord('programs',old?{...old,templates:[...old.templates,template]}:{name:d.programName,active:true,templates:[template]},d.userId,old?.revision);
        d.saved={program,template:program.templates.at(-1)};
        return preview(i,{kind:'resolved',program,template:d.saved.template},true);
      } else if(['program-next','program-back','entry-next','entry-back'].includes(action)) d.page=Math.max(0,d.page+(action.endsWith('next')?1:-1));
      else if(action!=='draft') throw new Error('Unknown workout draft action.');
      d.revision++;d.until=Date.now()+1800000;return render(i,d);
    }
  };
}
