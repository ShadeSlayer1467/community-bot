import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkoutRepository } from '../src/workout/repository.js';
import { WorkoutService } from '../src/workout/service.js';
import { starterCatalog, starterExercise, filterExercises, normalizeExercise } from '../src/workout/starter.js';
const user = '100000000000000001';
function folder(t) { const dir=fs.mkdtempSync(path.join(os.tmpdir(),'starter-tests-')); t.after(()=>fs.rmSync(dir,{recursive:true,force:true})); return dir; }
test('clean install seeds stable distinct exercises, aliases, neutral defaults and no sessions/programs',t=>{
 const dir=folder(t), repo=new WorkoutRepository(dir,[user]);
 const records=repo.records('exercises');
 assert.equal(records.length,starterCatalog.exercises.length); assert.ok(records.length>=400);
 assert.equal(new Set(records.map(e=>e.id)).size,records.length);
 assert.equal(new Set(records.map(e=>normalizeExercise(e.name))).size,records.length);
 assert.ok(records.every(e=>e.defaults.resistance.value===0 && e.defaults.rule.type==='manual' && !e.defaults.rule.chainId));
 assert.deepEqual(repo.sessions(),[]); assert.deepEqual(repo.records('programs'),[]);
 const second=new WorkoutRepository(dir,[user]); assert.deepEqual(second.records('exercises'),records);
 assert.equal(starterExercise(starterCatalog.exercises[0],user,'lb').id,records[0].id);
});
test('custom exercises remain authoritative, variations stay distinct, archived/deleted starters never return',t=>{
 const dir=folder(t), repo=new WorkoutRepository(dir,[user],{seed:false}), service=new WorkoutService(repo);
 const base=starterExercise(starterCatalog.exercises[0],user,'lb');
 const custom=service.saveRecord('exercises',{...base,id:undefined,name:'Bench Press',notes:'My custom setup',active:false},user);
 const variation=service.saveRecord('exercises',{...base,id:undefined,variation:'Paused custom'},user);
 const initial=repo.records('exercises');
 repo.seedEnabled=true; repo.seedStarters(user);
 assert.deepEqual(repo.records('exercises').find(e=>e.id===custom.id),custom);
 assert.deepEqual(repo.records('exercises').find(e=>e.id===variation.id),variation);
 assert.equal(repo.records('exercises').filter(e=>e.name==='Barbell Bench Press').length,1);
 const starter=repo.records('exercises').find(e=>e.name==='Dead Bug');
 service.saveRecord('exercises',{...starter,active:false},user,starter.revision);
 const removed=repo.records('exercises').find(e=>e.name==='Push-Up');
 repo.commit([{key:'exercises',value:{version:1,records:repo.records('exercises').filter(e=>e.id!==removed.id)}}]);
 const before=repo.records('exercises');
 assert.deepEqual(new WorkoutRepository(dir,[user]).records('exercises'),before);
 assert.equal(before.find(e=>e.id===starter.id).active,false);
 assert.ok(initial.every(e=>before.some(v=>v.id===e.id)));
});
test('seed migration leaves existing sessions/history/programs/preferences byte-for-byte intact',t=>{
 const dir=folder(t), repo=new WorkoutRepository(dir,[user],{seed:false}), service=new WorkoutService(repo);
 service.start(user,{free:true,requestId:'existing'});
 const files=['preferences.json','programs.json',...fs.readdirSync(path.join(dir,'sessions')).map(f=>'sessions/'+f)];
 const before=files.map(f=>fs.readFileSync(path.join(dir,f),'utf8'));
 new WorkoutRepository(dir,[user]);
 assert.deepEqual(files.map(f=>fs.readFileSync(path.join(dir,f),'utf8')),before);
});
test('search handles aliases and category/equipment/archived filters, important historical names remain discoverable',()=>{
 const records=starterCatalog.exercises.map(e=>starterExercise(e,user,'lb'));
 for(const name of ['Bench Press','Incline Bench Press','Incline Chest Press Machine','Decline Chest Press Machine','Supine Chest Press Machine','Incline Dumbbell Fly','Low-High Cable Fly','High-Low Cable Fly','Overhead Cable Triceps Extension','Single-Arm Cable Triceps Extension','Step-Back Single-Arm Cable Triceps Extension','Single-Arm Cable Pushback','Rope Triceps Pushdown','Straight-Bar Triceps Pushdown','V-Bar Triceps Pushdown','Triceps Pressdown Machine','JM Press','Smith Machine JM Press','Overhead Press','Cable Lateral Raise','Upright Row','Landmine Press Through','Single-Arm Landmine Press Through','Single-Arm Landmine Serratus Press','Lat Pulldown','Wide-Grip Lat Pulldown','Narrow-Grip Lat Pulldown','Underhand Lat Pulldown','Paused Lat Pulldown','Single-Arm Lat Pulldown','Single-Arm 45-Degree High Elbow Pull','Curl Machine','Pronated Barbell Curl','Back Squat','Bodyweight Squat','leg curl machine','Leg Extension','Push-Up','Glute Bridge','Dead Bug','Dip','Ab Crunch Machine','OHP','RDL','BSS','BW squat','leg ext','cable lat raise']) assert.ok(filterExercises(records,{search:name}).length,name);
 const filtered=filterExercises(records,{category:'Chest',equipment:'Cable'}); assert.ok(filtered.length); assert.ok(filtered.every(e=>e.category==='Chest'&&e.equipment==='Cable'));
 const archived={...records[0],active:false}; assert.equal(filterExercises([archived]).length,0); assert.equal(filterExercises([archived],{status:'archived'}).length,1); assert.equal(filterExercises([archived],{status:'all'}).length,1);
 assert.ok(filterExercises(records,{search:'bench'}).length<=25);
});

test('starter load placeholder requires actual resistance before recording sets', t=>{
 const repo=new WorkoutRepository(folder(t),[user]), service=new WorkoutService(repo);
 const bench=filterExercises(repo.records('exercises'),{search:'flat bench'})[0];
 let session=service.start(user,{free:true,requestId:'start'});
 session=service.mutate(user,session.id,{action:'add-exercise',exerciseId:bench.id,expectedRevision:session.revision,requestId:'add'});
 assert.throws(()=>service.mutate(user,session.id,{action:'log',reps:8,expectedRevision:session.revision,requestId:'log'}),/Change Weight/);
 assert.equal(repo.getSession(session.id).exercises[0].sets.length,0);
 session=service.mutate(user,session.id,{action:'weight',resistance:{kind:'total',value:135,unit:'lb'},expectedRevision:session.revision,requestId:'weight'});
 session=service.mutate(user,session.id,{action:'log',reps:8,expectedRevision:session.revision,requestId:'actual'});
 assert.equal(session.exercises[0].sets[0].resistance.value,135);
});
