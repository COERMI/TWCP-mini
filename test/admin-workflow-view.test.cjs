const test = require('node:test');
const assert = require('node:assert/strict');
test('总部按事件编号及照片时间排序，旧动态事件保持原组，移除照片只在纠正视图显示', async () => {
  const { groupedEvents } = await import('../admin/src/utils/workflow.js');
  const events = [{ id: 'b', event_no: 2, kind: 'legacy' }, { id: 'a', event_no: 1 }, { id: 'cancel', event_no: 3, status: 'cancelled' }];
  const photos = [{ id: 'second', event_id: 'b', created_at: 2 }, { id: 'first', event_id: 'b', created_at: 1 },
    { id: 'removed', event_id: 'b', created_at: 0, removed_at: 5 }];
  const normal = groupedEvents(events, photos);
  assert.deepEqual(normal.map(e => e.id), ['a','b']);
  assert.deepEqual(normal[1].photos.map(p => p.id), ['first','second']);
  assert.equal(normal[1].active_count, 2);
  const corrected = groupedEvents(events, photos, true);
  assert.equal(corrected.length, 3); assert.equal(corrected[1].photos.length, 3); assert.equal(corrected[1].active_count, 2);
});
