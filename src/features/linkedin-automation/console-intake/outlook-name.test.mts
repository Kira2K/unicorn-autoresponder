import {test} from 'node:test';
import assert from 'node:assert/strict';
import {outlookLoginMatchesNames,parseIntake} from './contracts.mts';

test('Outlook requires two full continuous name fragments, in either order and case',()=>{
 for(const local of ['ivan.petrov','petrov_ivan99','ivanpetrov','PETROVIVAN','prefix+ivan-123-petrov.suffix'])
  assert.equal(outlookLoginMatchesNames(local+'@outlook.com','Ivan','Petrov'),true,local);
 for(const local of ['ivan','petrov','i.v.a.n.petrov','iv123an.petrov','ivan.p.e.t.r.o.v','another.person'])
  assert.equal(outlookLoginMatchesNames(local+'@outlook.com','Ivan','Petrov'),false,local);
 assert.equal(outlookLoginMatchesNames('ivan.petrov@gmail.com','Ivan','Petrov'),false);
 assert.equal(outlookLoginMatchesNames('outlook@outlook.com','Outlook','Com'),false,'domain is not searched');
});

test('any part of each compound name is accepted without changing the supplied values',()=>{
 for(const local of ['anna.berg','maria_van99','derannamaria','vanderbergmaria'])
  assert.equal(outlookLoginMatchesNames(local+'@outlook.com','Anna-Maria','Van der Berg'),true,local);
 assert.equal(outlookLoginMatchesNames('anna.connor@outlook.com',' Anna Maria ',"O'Connor"),true);
 assert.equal(outlookLoginMatchesNames('anna.unknown@outlook.com','Anna-Maria','Van der Berg'),false);
 for(const [first,last] of [['','Petrov'],['Ivan',''],['Иван','Petrov'],['Ivan','Петров']])
  assert.equal(outlookLoginMatchesNames('ivan.petrov@outlook.com',first,last),false);
});

test('name matches cannot overlap, including equal names and later valid occurrences',()=>{
 for(const local of ['ivan.ivanov','ivanovivan','ivanivanov'])
  assert.equal(outlookLoginMatchesNames(local+'@outlook.com','Ivan','Ivanov'),true,local);
 assert.equal(outlookLoginMatchesNames('ivanov@outlook.com','Ivan','Ivanov'),false);
 assert.equal(outlookLoginMatchesNames('ali@outlook.com','Ali','Ali'),false);
 assert.equal(outlookLoginMatchesNames('aliali@outlook.com','Ali','Ali'),true);
 assert.equal(outlookLoginMatchesNames('ababa@outlook.com','Aba','Bab'),false);
 assert.equal(outlookLoginMatchesNames('ababab@outlook.com','Aba','Bab'),true);
});

test('new and replacement intake enforce Outlook names before storage; existing LinkedIn is unchanged',()=>{
 const draft={scenario:'new',outlookForwardingConfirmed:true,firstName:'Ivan',lastName:'Petrov',outlookLogin:'ivan.petrov@outlook.com',realLocation:'Tbilisi'};
 assert.equal(parseIntake(draft).outlookLogin,draft.outlookLogin);
 for(const replacesLinkedInAccountId of [undefined,42])
  assert.throws(()=>parseIntake({...draft,replacesLinkedInAccountId,outlookLogin:'legacy@outlook.com'}),{code:'linkedin_intake_outlook_name_mismatch'});
 assert.throws(()=>parseIntake({...draft,firstName:'Petr'}),{code:'linkedin_intake_outlook_name_mismatch'});
 assert.throws(()=>parseIntake({...draft,outlookLogin:'ivan.petrov@gmail.com'}),{code:'linkedin_intake_outlook_required'});
 assert.throws(()=>parseIntake({...draft,firstName:''}),{code:'linkedin_intake_identity_required'});
 assert.equal(parseIntake({scenario:'existing',stage:'credentials',url:'https://linkedin.com/in/ivan',login:'other@example.test',password:'fixture'}).login,'other@example.test');
});
