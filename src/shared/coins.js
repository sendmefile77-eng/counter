const crypto=require('node:crypto');
const METHOD='crypto.randomInt/2';
const LIMIT=500;
function flip(state,input={},now=new Date(),randomInt=crypto.randomInt) {
  const question=String(input.question||'').trim();
  if(question.length>300)throw Error('Питання — до 300 символів.');
  const bit=randomInt(2);
  if(bit!==0&&bit!==1)throw Error('Не вдалося отримати випадковий результат.');
  const number=Math.max(state.coinSequence||0,...(state.coinFlips||[]).map(item=>item.number))+1;
  if(!Number.isSafeInteger(number))throw Error('Вичерпано лічильник підкидань.');
  const record={id:crypto.randomUUID(),number,question,answer:bit===0?'yes':'no',method:METHOD,
    createdAt:now.toISOString(),createdBy:String(state.settings.operatorName||'Керівник').trim().slice(0,80)};
  state.coinFlips=[...(state.coinFlips||[]),record].slice(-LIMIT);state.coinSequence=number;
  state.audit.push({id:crypto.randomUUID(),at:now.toISOString(),action:'coin_flipped',details:{...record}});
  state.audit=state.audit.slice(-5000);return record;
}
function normalize(input) {
  if(input==null)return [];
  if(!Array.isArray(input)||input.length>LIMIT)throw Error('Некоректна історія монетки.');
  const ids=new Set(),numbers=new Set();
  return input.map(item=>{
    if(!item||typeof item.id!=='string'||!item.id||ids.has(item.id)||!Number.isSafeInteger(item.number)||item.number<1||numbers.has(item.number)
      ||typeof item.question!=='string'||item.question.length>300||!['yes','no'].includes(item.answer)||item.method!==METHOD
      ||typeof item.createdAt!=='string'||!Number.isFinite(Date.parse(item.createdAt))||typeof item.createdBy!=='string'||!item.createdBy||item.createdBy.length>80)
      throw Error('Пошкоджений запис монетки.');
    ids.add(item.id);numbers.add(item.number);
    return {id:item.id,number:item.number,question:item.question,answer:item.answer,method:METHOD,createdAt:item.createdAt,createdBy:item.createdBy};
  });
}
module.exports={flip,normalize,METHOD,LIMIT};
