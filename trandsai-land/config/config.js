// 开发中？
const develop = true
// http://192.168.77.43:8000/api	
// https://www.crashcheck.net/api
let host = 'https://www.crashcheck.net/api';
if (develop) host = 'https://www.crashcheck.net/api'; 
else '';
console.log = develop ? console.log : () => {};
console.info = develop ? console.info : () => {};
const adPid = '1213639316'; 

export {
	host,
	adPid
}

