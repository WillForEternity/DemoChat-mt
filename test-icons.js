// Quick test to check if specific icons exist
const fa = require('react-icons/fa');
const fa6 = require('react-icons/fa6');

console.log('=== FA5 Icons ===');
console.log('FaBrain:', !!fa.FaBrain);
console.log('FaPuzzlePiece:', !!fa.FaPuzzlePiece);
console.log('FaComment:', !!fa.FaComment);
console.log('FaGamepad:', !!fa.FaGamepad);
console.log('FaFilm:', !!fa.FaFilm);
console.log('FaRocket:', !!fa.FaRocket);

console.log('\n=== FA6 Icons ===');
console.log('FaBrain:', !!fa6.FaBrain);
console.log('FaPuzzlePiece:', !!fa6.FaPuzzlePiece);
console.log('FaComment:', !!fa6.FaComment);
console.log('FaGamepad:', !!fa6.FaGamepad);
console.log('FaFilm:', !!fa6.FaFilm);
console.log('FaRocket:', !!fa6.FaRocket);

console.log('\n=== Available FA icons (first 20) ===');
console.log(Object.keys(fa).slice(0, 20).join(', '));

console.log('\n=== Available FA6 icons (first 20) ===');
console.log(Object.keys(fa6).slice(0, 20).join(', '));
