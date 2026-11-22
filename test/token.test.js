// 管理员 token 签发/校验逻辑测试
// 运行：node test/token.test.js

process.env.ADMIN_SECRET = 'test-secret-123';

const { signToken, verifyToken } = require('../cloudfunctions/adminLogin/auth');

let pass = 0;
let fail = 0;
function assert(name, cond) {
  if (cond) {
    pass++;
    console.log('  ✓ ' + name);
  } else {
    fail++;
    console.log('  ✗ ' + name);
  }
}

console.log('【管理员 token 逻辑测试】');
const t = signToken({ sub: 'admin', iat: Date.now(), exp: Date.now() + 10000 });
assert('token 正常生成（body.signature 两段）', typeof t === 'string' && t.split('.').length === 2);
assert('正确 token 校验通过', verifyToken(t) === true);
assert('篡改 token 被拒绝', verifyToken(t + 'x') === false);
assert('空 token 被拒绝', verifyToken('') === false);
assert('null token 被拒绝', verifyToken(null) === false);

const expired = signToken({ sub: 'admin', iat: Date.now() - 20000, exp: Date.now() - 10000 });
assert('过期 token 被拒绝', verifyToken(expired) === false);

console.log('\n结果：' + pass + ' 通过，' + fail + ' 失败');
process.exit(fail > 0 ? 1 : 0);
