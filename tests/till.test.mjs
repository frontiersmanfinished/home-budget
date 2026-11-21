// Amount entry like a till. Run: node tests/till.test.mjs
import assert from 'node:assert/strict';
import { till } from '../js/till.js';
let t = till().type('1250'); assert.equal(t.cents, 1250); assert.equal(t.text, '12.50');
assert.equal(till().type('5').text, '0.05'); assert.equal(till().type('123456').text, '1,234.56');
t = till().type('1250').key('Backspace'); assert.equal(t.cents, 125); assert.equal(t.text, '1.25');
t = till().type('4500+1250'); assert.equal(t.cents, 5750); assert.equal(t.text, '45.00 + 12.50'); assert.ok(t.isSum);
t = till().type('45+12.50'); assert.equal(t.cents, 5750); assert.equal(t.text, '45 + 12.50'); // a point anywhere: figures without one are dollars
t = till().type('45.5'); assert.equal(t.cents, 4550); assert.equal(t.text, '45.5');
t = till().type('10000-2550'); assert.equal(t.cents, 7450); assert.equal(t.text, '100.00 − 25.50');
t = till().type('500+').key('Backspace'); assert.equal(t.text, '5.00'); assert.ok(!t.isSum);
t = till().type('500++-'); assert.equal(t.text, '5.00 − ');          // repeated operators replace each other
t = till().type('12.345'); assert.equal(t.cents, 1234);             // no more than two places after a point
// An amount already there: typing replaces it, backspace edits it.
t = till(4550); assert.equal(t.text, '45.50'); t.key('7'); assert.equal(t.cents, 7);
t = till(4550); t.key('Backspace'); assert.equal(t.cents, 455);
t = till(4550); t.key('+'); t.type('500'); assert.equal(t.cents, 5050);
assert.equal(till().paste('$1,234.50').cents, 123450); assert.equal(till().text, '');
console.log('till tests passed');
