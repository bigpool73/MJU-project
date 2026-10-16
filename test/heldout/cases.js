'use strict';
/**
 * 블라인드 검증 케이스 모음. 원자료는 ./data/*.js (분야별 1개), 조립은 ./lib.js.
 * 각 케이스: { id, field, meta, convs, turns[{id,convId,label,traps}], segments[{kind,start,end,text,from,traps}],
 *             body, makeDoc(text?), chain[{ratio,aiCount,text}] }
 */
const lib = require('./lib.js');

const DATA_FILES = ['essay-cup', 'cs-hash', 'mkt-sns', 'nurs-pressure', 'eng-service', 'psy-dissonance'];
const cases = DATA_FILES.map((f) => lib.build(require(`./data/${f}.js`)));

module.exports = { cases, DATA_FILES, ...lib };
